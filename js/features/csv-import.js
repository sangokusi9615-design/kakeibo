// 楽天カード・楽天銀行の CSV 取り込み（チャージ・クレカ積立・カード代金は自動で振替）
// 決まり：docs/03_データ設計.md（重複防止・レシートとの照合・定期記録との照合）。ファイルは iPhone の中で読むだけ

import { getAll, put, putMany } from '../db/storage.js';
import { rakutenCard, rakutenBank, normalizeName, transferRules, bankRules, medicalHints } from '../config/csv-formats.js';
import { MATCH_DAYS } from '../config/settings.js';
import { GROUP_LABELS } from '../config/categories.js';
import { loadMasters, newTransaction, guessCategory } from './transactions.js';
import { loadMembers, patientOptions } from './members.js';
import { balances } from './assets.js';
import { decodeCsv, parseCsv, toNumber } from '../utils/csv.js';
import { yen, esc, shortDate, daysBetween } from '../utils/format.js';
import { toast } from '../utils/ui.js';

export function detectFormat(header) {
  if (header.includes(rakutenCard.columns.date) && header.includes(rakutenCard.columns.amount)) return 'card';
  if (header.includes(rakutenBank.columns.date) && header.includes(rakutenBank.columns.balance)) return 'bank';
  return null;
}

const near = (a, b) => Math.abs(daysBetween(a, b)) <= MATCH_DAYS;
// 口座番号などの長い数字は覚える店名に入れない
const rulePattern = (norm) => norm.replace(/\d{4,}/g, '');

// ---- 取り込み計画を作る（まだ保存しない） ----

export async function buildPlan(text) {
  const { header, records } = parseCsv(text);
  const format = detectFormat(header);
  if (!format) throw new Error('楽天カード・楽天銀行の明細 CSV ではないようです');
  const m = await loadMasters();
  const accountId = format === 'card' ? 'rakuten_card' : 'rakuten_bank';  // 妻の口座を足したら選べるようにする（docs/09）
  const account = m.acc[accountId];
  const all = await getAll('transactions');
  const known = new Set(all.map((t) => t.importKey).filter(Boolean));
  const used = new Set();  // この取り込みで照合に使った既存の記録
  const ctx = { m, account, all, known, used, items: [], skipped: 0 };
  if (format === 'card') await planCard(records, ctx);
  else await planBank(records, ctx);
  return { format, account, items: ctx.items, skipped: ctx.skipped, records };
}

async function planCard(records, ctx) {
  const c = rakutenCard.columns;
  const seen = {};
  for (const rec of records) {
    if (!rec[c.date] || !rec[c.amount]) continue;
    const date = rec[c.date].replace(/\//g, '-');
    const name = rec[c.name];
    const norm = normalizeName(name);
    const amount = toNumber(rec[c.amount]);
    const user = rec[c.user];
    const occ = `${date}|${norm}|${amount}|${user}`;
    seen[occ] = (seen[occ] || 0) + 1;
    // 同じ日・同じ店・同じ金額が2件あっても消えないよう、出現番号を入れる（docs/03）
    const importKey = `rakuten-card:${ctx.account.id}:${date}:${norm}:${amount}:${user}:${seen[occ]}`;
    if (ctx.known.has(importKey)) { ctx.skipped++; continue; }
    const owner = user === '家族' ? (ctx.account.familyCardMember || 'family') : (ctx.account.owner || 'self');

    const transfer = transferRules.find((r) => r.test.test(norm));
    if (transfer) {
      ctx.items.push({ name, tx: newTransaction({
        date, type: 'transfer', amount, categoryId: null, fromAccountId: ctx.account.id, toAccountId: transfer.to,
        owner, memo: name, source: 'csv', importKey,
      }) });
      continue;
    }

    const medical = medicalHints.test(norm);
    const guessed = await guessCategory(name, ctx.m.categories);
    const categoryId = guessed || (medical ? 'hospital' : null);
    const item = { name, norm, learnable: true, tx: newTransaction({
      date, amount, categoryId: categoryId || 'other', fromAccountId: ctx.account.id, owner, memo: name, source: 'csv', importKey,
      tax: ctx.m.cat[categoryId]?.tax === 'medical' ? { kind: 'medical', patient: 'self', provider: name, medicalType: '診療・治療', reimbursed: 0 } : null,
    }) };
    if (!categoryId) item.needCategory = true;
    if (item.tx.tax) item.needPatient = true;
    if (owner === 'family' || (user === '家族' && ctx.account.familyCardMember)) item.familyCard = true;

    // レシート・手入力で「楽天カード」と記録した仮の取引と照合（金額一致・日付差3日以内）
    const pending = ctx.all.filter((t) => !t.mergedInto && !ctx.used.has(t.id) && t.status === 'pending'
      && t.fromAccountId === ctx.account.id && t.amount === amount && near(t.date, date) && !t.importKey);
    if (pending.length === 1) {
      ctx.used.add(pending[0].id);
      item.mergeInto = pending[0];  // 自動でまとめる（レシート側の費目・品目・税金の印を残す）
      item.needCategory = false;
      item.needPatient = false;
    } else if (pending.length > 1) {
      item.pick = pending;          // どれと同じか選んでもらう
    } else {
      // 楽天ペイ・現金などで記録した中に同じ金額のものがあれば「同じ買い物？」と聞く（支払い方法の選び間違いの保険）
      const same = ctx.all.filter((t) => !t.mergedInto && !ctx.used.has(t.id) && t.type === 'expense'
        && t.fromAccountId !== ctx.account.id && ['manual', 'receipt'].includes(t.source) && t.amount === amount && near(t.date, date));
      if (same.length) {
        item.maybeSame = same;
        ctx.used.add(same[0].id);  // 同じ記録を2つの明細に重ねて聞かない
      }
    }
    ctx.items.push(item);

    const fee = toNumber(rec[c.fee]);
    if (fee > 0) {
      ctx.items.push({ name: `${name}（手数料）`, tx: newTransaction({
        date, amount: fee, categoryId: 'fee', fromAccountId: ctx.account.id, owner, memo: `${name} 手数料`, source: 'csv', importKey: `${importKey}:fee`,
      }) });
    }
  }
}

async function planBank(records, ctx) {
  const c = rakutenBank.columns;
  const learned = await getAll('merchantRules');
  for (const rec of records) {
    if (!rec[c.date] || rec[c.amount] === '') continue;
    const d = rec[c.date];
    const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    const signed = toNumber(rec[c.amount]);
    const amount = Math.abs(signed);
    const balance = toNumber(rec[c.balance]);
    const name = rec[c.name];
    const norm = normalizeName(name);
    // 取引後残高が行ごとに違うので、同じ日・同じ金額が2件あっても区別できる（docs/03）
    const importKey = `rakuten-bank:${ctx.account.id}:${date}:${signed}:${balance}`;
    if (ctx.known.has(importKey)) { ctx.skipped++; continue; }
    const base = { date, amount, owner: ctx.account.owner || 'self', memo: name, source: 'csv', importKey };
    const item = { name, norm, balance, signed };

    const mine = learned.find((r) => r.pattern && norm.includes(r.pattern));
    const rule = bankRules.find((r) => r.test.test(norm));
    if (!mine && rule?.kind === 'transfer') {
      item.tx = newTransaction({ ...base, type: 'transfer', categoryId: null,
        fromAccountId: signed < 0 ? ctx.account.id : rule.to, toAccountId: signed < 0 ? rule.to : ctx.account.id });
      // ほとんど使わない他社カード：明細は取り込まないので、記録していない分を「他社カード（内訳なし）」で補う（docs/03）
      if (rule.to === 'other_card' && signed < 0) {
        const recorded = ctx.all.filter((t) => !t.mergedInto && t.type === 'expense' && t.fromAccountId === 'other_card'
          && t.date <= date && daysBetween(t.date, date) <= 45).reduce((s, t) => s + t.amount, 0);
        const unknown = amount - recorded;
        ctx.items.push(item);
        if (unknown > 0) {
          ctx.items.push({ name: `${name}（内訳なし）`, tx: newTransaction({
            date, amount: unknown, categoryId: 'card_unknown', fromAccountId: 'other_card', owner: base.owner,
            memo: 'その他のカード（内訳なし）', source: 'csv', importKey: `${importKey}:unknown`,
          }) });
        }
        continue;
      }
    } else if (signed > 0) {
      const categoryId = (mine && ctx.m.cat[mine.categoryId]?.group === 'income' ? mine.categoryId : null) || rule?.category || null;
      item.tx = newTransaction({ ...base, type: 'income', categoryId: categoryId || 'income_other', toAccountId: ctx.account.id });
      item.learnable = true;
      if (!categoryId) item.needCategory = true;
    } else {
      const categoryId = (mine && ctx.m.cat[mine.categoryId]?.group !== 'income' ? mine.categoryId : null);
      item.tx = newTransaction({ ...base, type: 'expense', categoryId: categoryId || 'other', fromAccountId: ctx.account.id });
      item.learnable = true;
      if (!categoryId) item.needCategory = true;
    }

    // 家賃・給与などの定期記録（仮）と照合：金額一致・日付差3日以内、または同じ費目・同じ月（給与のように額が変わるもの）
    if (item.tx.type !== 'transfer') {
      const side = item.tx.type === 'income' ? 'toAccountId' : 'fromAccountId';
      const rec2 = ctx.all.filter((t) => !t.mergedInto && !ctx.used.has(t.id) && t.source === 'recurring' && t.status === 'pending'
        && t.type === item.tx.type && t[side] === ctx.account.id);
      const hit = rec2.find((t) => t.amount === amount && near(t.date, date))
        || rec2.find((t) => !item.needCategory && t.categoryId === item.tx.categoryId && t.date.slice(0, 7) === date.slice(0, 7));
      if (hit) {
        ctx.used.add(hit.id);
        item.mergeInto = hit;
        if (item.needCategory) { item.tx.categoryId = hit.categoryId; item.needCategory = false; }
      }
    }
    ctx.items.push(item);
  }
}

// ---- 保存 ----

export async function commitPlan(plan) {
  const toPut = [];
  const rules = [];
  let merged = 0;
  for (const item of plan.items) {
    if (item.drop) continue;
    const t = item.tx;
    const target = item.mergeInto || item.chosen;
    if (target) {
      // 既存の記録（レシート・定期記録）を明細の日付・金額で確定し、費目や品目はそのまま残す
      const keepCategory = target.source !== 'recurring' || !item.changed;
      toPut.push({ ...target, date: t.date, amount: t.amount, status: 'confirmed', importKey: t.importKey, needsConfirm: false,
        categoryId: keepCategory ? target.categoryId : t.categoryId });
      merged++;
      continue;
    }
    if (item.sameAs) {
      // 「同じ買い物」：手入力の記録を隠し、明細の記録に費目を引き継ぐ（取り消せるよう削除はしない）
      toPut.push({ ...item.sameAs, mergedInto: t.id });
      if (!item.changed) t.categoryId = item.sameAs.categoryId;
      t.tax = t.tax || item.sameAs.tax;
      t.items = item.sameAs.items;
      merged++;
    }
    toPut.push(t);
    if (item.learnable && (item.changed || item.needCategory) && t.categoryId && t.categoryId !== 'other' && t.categoryId !== 'income_other') {
      const pattern = rulePattern(item.norm);
      if (pattern.length >= 2) rules.push({ id: `learned:${pattern}`, pattern, categoryId: t.categoryId, kind: t.type, learned: true });
    }
  }
  await putMany('transactions', toPut);
  if (rules.length) await putMany('merchantRules', rules);

  // 銀行は、使い始めの残高をまだ入れていなければ、明細の最初の行から逆算する（docs/03）
  if (plan.format === 'bank' && !plan.account.openingDate) {
    const first = plan.items.filter((i) => i.balance !== undefined).sort((a, b) => a.tx.date.localeCompare(b.tx.date))[0];
    if (first) await put('accounts', { ...plan.account, openingBalance: first.balance - first.signed, openingDate: first.tx.date });
  }
  return { added: toPut.length - merged, merged };
}

// ---- 画面 ----

export function startImport(el, { onDone }) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,text/csv,text/comma-separated-values';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const plan = await buildPlan(decodeCsv(await file.arrayBuffer()));
      await renderPlan(el, plan, { onDone });
    } catch (e) {
      toast(e.message || '読み込めませんでした');
    }
  };
  input.click();
}

function categoryOptions(m, type, selected) {
  const groups = type === 'income' ? ['income'] : ['fixed', 'variable', 'medical', 'child', 'special', 'reimbursed', 'saving'];
  return groups.map((g) => `<optgroup label="${GROUP_LABELS[g]}">${m.categories.filter((c) => c.group === g)
    .map((c) => `<option value="${c.id}"${c.id === selected ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`).join('');
}

export async function renderPlan(el, plan, { onDone }) {
  const m = await loadMasters();
  const members = await loadMembers();
  const items = plan.items;
  const needs = items.filter((i) => i.needCategory || i.needPatient || i.pick || i.maybeSame);
  const auto = items.filter((i) => !needs.includes(i));
  const mergedCount = items.filter((i) => i.mergeInto).length;
  const label = plan.format === 'card' ? '楽天カード' : '楽天銀行';
  const dates = items.map((i) => i.tx.date).sort();

  const line = (i) => `<span class="tx-date">${shortDate(i.tx.date)}</span><span class="tx-main">${esc(i.name)}</span>
    <span class="tx-amt${i.tx.type === 'income' ? ' plus' : ''}">${i.tx.type === 'income' ? '+' : ''}${yen(i.tx.amount)}</span>`;

  const row = (i, idx) => {
    const t = i.tx;
    const parts = [`<div class="import-line">${line(i)}</div>`];
    if (i.mergeInto) parts.push(`<p class="hint">${i.mergeInto.source === 'recurring' ? '定期記録' : 'レシート'}「${esc(i.mergeInto.memo || m.cat[i.mergeInto.categoryId]?.name)}」とまとめます</p>`);
    if (t.type === 'transfer') {
      parts.push(`<p class="hint">振替：${esc(m.acc[t.fromAccountId]?.name)} → ${esc(m.acc[t.toAccountId]?.name)}（支出に数えない）</p>`);
    } else if (!i.mergeInto) {
      parts.push(`<select data-i="${idx}" data-f="category" aria-label="費目">${i.needCategory ? '<option value="" selected>費目を選ぶ</option>' : ''}${categoryOptions(m, t.type, i.needCategory ? '' : t.categoryId)}</select>`);
    }
    if (i.needPatient) {
      parts.push(`<label class="label">誰の医療費？<select data-i="${idx}" data-f="patient">${patientOptions(members)
        .map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select></label>`);
    }
    if (i.pick) {
      parts.push(`<label class="label">同じ金額の記録が複数あります。どれと同じ？<select data-i="${idx}" data-f="pick">
        ${i.pick.map((p, k) => `<option value="${k}">${shortDate(p.date)} ${esc(p.memo || m.cat[p.categoryId]?.name)}</option>`).join('')}
        <option value="none">どれとも別</option></select></label>`);
    }
    if (i.maybeSame) {
      const s = i.maybeSame[0];
      parts.push(`<label class="label">${esc(m.acc[s.fromAccountId]?.name)}で記録した「${esc(s.memo || m.cat[s.categoryId]?.name)}」（${shortDate(s.date)}）と同じ買い物？
        <select data-i="${idx}" data-f="same"><option value="no">別の買い物</option><option value="yes">同じ（支払い方法を楽天カードに直す）</option></select></label>`);
    }
    if (i.familyCard) parts.push('<p class="hint">家族カードの利用</p>');
    return `<li class="import-item">${parts.join('')}</li>`;
  };

  el.innerHTML = `
    <section class="view">
      <h2>${label}の明細</h2>
      <p class="hint">${dates.length ? `${shortDate(dates[0])}〜${shortDate(dates[dates.length - 1])}・` : ''}新しく入る ${items.length}件（うち記録とまとめる ${mergedCount}件）${plan.skipped ? `・取り込み済みで飛ばす ${plan.skipped}件` : ''}</p>
      ${items.length ? '' : '<p class="notice ok">新しい明細はありませんでした</p>'}
      ${needs.length ? `<h3 class="section-title">確認が必要（${needs.length}件）</h3><ul class="import-list">${needs.map((i) => row(i, items.indexOf(i))).join('')}</ul>
        <p class="hint">選んだ費目は覚えて、次回から自動で振り分けます（この iPhone の中だけ）</p>` : ''}
      ${auto.length ? `<details><summary>自動で振り分けた分（${auto.length}件・変えたいときだけ開く）</summary>
        <ul class="import-list">${auto.map((i) => row(i, items.indexOf(i))).join('')}</ul></details>` : ''}
      <div class="btn-row">
        <button type="button" id="cancel">やめる</button>
        ${items.length ? '<button type="button" class="primary" id="commit">取り込む</button>' : ''}
      </div>
    </section>`;

  el.querySelector('#cancel').onclick = onDone;
  el.querySelector('#commit')?.addEventListener('click', async () => {
    for (const s of el.querySelectorAll('select[data-i]')) {
      const item = items[Number(s.dataset.i)];
      const v = s.value;
      if (s.dataset.f === 'category') {
        if (!v) { toast('費目を選んでいない明細があります'); s.focus(); return; }
        if (v !== item.tx.categoryId || item.needCategory) item.changed = true;
        item.tx.categoryId = v;
        if (m.cat[v]?.tax === 'medical' && !item.tx.tax) item.tx.tax = { kind: 'medical', patient: 'self', provider: item.name, medicalType: '診療・治療', reimbursed: 0 };
        if (m.cat[v]?.tax !== 'medical') item.tx.tax = null;
      }
      if (s.dataset.f === 'patient' && item.tx.tax) item.tx.tax.patient = v;
      if (s.dataset.f === 'pick' && v !== 'none') item.chosen = item.pick[Number(v)];
      if (s.dataset.f === 'same' && v === 'yes') item.sameAs = item.maybeSame[0];
    }
    const result = await commitPlan(plan);
    let note = '';
    if (plan.format === 'bank') {
      const last = items.filter((i) => i.balance !== undefined).sort((a, b) => a.tx.date.localeCompare(b.tx.date)).pop();
      // 明細の最後の日までの記録で比べる（それより後の定期記録などは含めない）
      const upto = (await getAll('transactions')).filter((t) => !t.mergedInto && t.date <= last?.tx.date);
      const now = balances((await loadMasters()).accounts, upto)[plan.account.id];
      if (last && last.balance !== now) note = `（銀行の残高 ${yen(last.balance)} とアプリの計算 ${yen(now)} に差があります）`;
    }
    toast(`${result.added}件を取り込みました${result.merged ? `・${result.merged}件をまとめました` : ''}${note}`);
    onDone();
  });
}
