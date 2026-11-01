// 支出・収入の入力（2〜3タップ・楽天ペイ初期値）と、固定費・定期収入の自動記録（docs/01, docs/03）

import { getAll, put, del, uid, findByImportKey, getMeta, setMeta } from '../db/storage.js';
import { ICONS, GROUP_LABELS, PAYMENT_ACCOUNTS, defaultAccounts } from '../config/categories.js';

const ACCOUNT_ORDER = defaultAccounts.map((a) => a.id);
import { initialMerchantRules, normalizeName } from '../config/csv-formats.js';
import { yen, esc, todayISO, monthKey, addMonths, dayInMonth, shortDate } from '../utils/format.js';
import { toast, chips, isCurrent } from '../utils/ui.js';
import { loadMembers, patientOptions } from './members.js';

// ---- データ ----

export async function loadMasters() {
  const [categories, accounts] = await Promise.all([getAll('categories'), getAll('accounts')]);
  categories.sort((a, b) => a.order - b.order);
  // 後から追加した口座（2人目のこどもNISA など）は最後に並べる
  const rank = (a) => { const i = ACCOUNT_ORDER.indexOf(a.id); return i < 0 ? ACCOUNT_ORDER.length : i; };
  accounts.sort((a, b) => rank(a) - rank(b));
  return {
    categories,
    accounts,
    cat: Object.fromEntries(categories.map((c) => [c.id, c])),
    acc: Object.fromEntries(accounts.map((a) => [a.id, a])),
  };
}

// まとめた側（mergedInto あり）は集計に入れない
export async function activeTransactions() {
  return (await getAll('transactions')).filter((t) => !t.mergedInto);
}

export function newTransaction(fields) {
  return {
    id: uid(),
    date: todayISO(),
    type: 'expense',
    amount: 0,
    categoryId: 'other',
    fromAccountId: null,
    toAccountId: null,
    owner: 'self',
    memo: '',
    source: 'manual',
    importKey: null,
    status: 'confirmed',
    mergedInto: null,
    tax: null,
    createdAt: new Date().toISOString(),
    ...fields,
  };
}

// 楽天カード払いはカード明細と照合するまで「仮」（docs/03 レシートとカード CSV の突き合わせ）
export function statusFor(accountId) {
  return accountId === 'rakuten_card' ? 'pending' : 'confirmed';
}

// 店名から費目を推定する。iPhone 内で覚えた店名 → 初期ルールの順
export async function guessCategory(storeName, categories) {
  const name = normalizeName(storeName || '');
  if (!name) return null;
  const learned = await getAll('merchantRules');
  const hit = learned.find((r) => name.includes(r.pattern));
  if (hit) return hit.categoryId;
  const rule = initialMerchantRules.find((r) => r.test.test(name));
  return rule ? categories.find((c) => c.name === rule.category)?.id ?? null : null;
}

export async function learnCategory(storeName, categoryId) {
  const pattern = normalizeName(storeName || '');
  if (!pattern) return;
  await put('merchantRules', { id: `learned:${pattern}`, pattern, categoryId, kind: 'expense', learned: true });
}

// 引き落とし日を過ぎた分の固定費・定期収入を作る。importKey があるので何度呼んでも二重にならない
export async function runRecurring(today = todayISO()) {
  const thisMonth = monthKey(today);
  let created = 0;
  for (const r of await getAll('recurring')) {
    if (!r.active) continue;
    for (let ym = r.startMonth; ym <= thisMonth; ym = addMonths(ym, 1)) {
      if (r.endMonth && ym > r.endMonth) break;
      if (monthsBetween(r.startMonth, ym) % (r.everyMonths || 1) !== 0) continue;
      const date = dayInMonth(ym, r.dayOfMonth);
      if (date > today) continue;
      const importKey = `recurring:${r.id}:${ym}`;
      if (await findByImportKey(importKey)) continue;
      await put('transactions', newTransaction({
        date,
        type: r.type,
        amount: r.amount,
        categoryId: r.categoryId,
        fromAccountId: r.type === 'expense' ? r.accountId : null,
        toAccountId: r.type === 'income' ? r.accountId : null,
        memo: r.label,
        source: 'recurring',
        importKey,
        status: 'pending',               // 銀行 CSV で確定する（docs/03）
        needsConfirm: !!r.variable,      // 給与など毎回変わるものは金額を確認
      }));
      created++;
    }
  }
  return created;
}

function monthsBetween(a, b) {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

// ---- 入力画面 ----

export async function renderInput(el, { onScan }) {
  const m = await loadMasters();
  const txs = await activeTransactions();
  const thisMonth = monthKey(todayISO());
  const monthSpend = txs.filter((t) => t.type === 'expense' && monthKey(t.date) === thisMonth)
    .reduce((s, t) => s + t.amount, 0);
  const toConfirm = txs.filter((t) => t.needsConfirm);
  const lastPay = await getMeta('lastPayAccount', 'rakuten_pay');
  const members = await loadMembers();
  if (!isCurrent('input')) return;

  el.innerHTML = `
    <section class="view input-view">
      <div class="month-total">${Number(thisMonth.slice(5))}月の支出 <strong>${yen(monthSpend)}</strong></div>
      <div id="confirm-list"></div>
      <button type="button" class="scan-btn" id="scan">🧾 レシートを読む</button>
      <div class="kind-row" id="kind"></div>
      <label class="amount-row"><input id="amount" inputmode="numeric" autocomplete="off" placeholder="0" aria-label="金額"><span>円</span></label>
      <div class="sub-row"><input type="date" id="date" value="${todayISO()}" aria-label="日付"></div>
      <div class="chips" id="pay"></div>
      <p class="hint" id="pay-hint"></p>
      <div class="tiles" id="tiles"></div>
      <div class="panel" id="more" hidden></div>
      <div class="panel" id="patient" hidden>
        <p>誰の医療費？（医療費控除は家族の分も合算できます）</p>
        <div class="chips" id="patient-chips"></div>
      </div>
      <h3 class="section-title">最近の記録</h3>
      <ul class="tx-list" id="recent"></ul>
    </section>`;

  el.querySelector('#scan').onclick = onScan;
  renderConfirmList(el.querySelector('#confirm-list'), toConfirm, m, () => renderInput(el, { onScan }));

  const amountInput = el.querySelector('#amount');
  amountInput.oninput = () => { amountInput.value = amountInput.value.replace(/[^\d]/g, ''); };

  let kind = 'expense';
  let pay = PAYMENT_ACCOUNTS.includes(lastPay) ? lastPay : 'rakuten_pay';
  const payHint = el.querySelector('#pay-hint');

  const drawPay = () => {
    const ids = kind === 'expense' ? PAYMENT_ACCOUNTS : ['rakuten_bank', 'cash', 'rakuten_pay'];
    if (!ids.includes(pay)) pay = ids[0];
    chips(el.querySelector('#pay'), ids.map((id) => ({ value: id, label: m.acc[id].name })), pay, (v) => { pay = v; hint(); });
    hint();
  };
  const hint = () => {
    payHint.textContent = kind === 'expense' && pay === 'rakuten_card' ? 'カード明細の取り込み時に自動で照合します' : '';
  };

  const drawTiles = () => {
    const list = m.categories.filter((c) => (kind === 'expense'
      ? c.visible && c.group !== 'income'
      : c.group === 'income' && !c.oneOff && c.id !== 'interest'));
    el.querySelector('#tiles').innerHTML = list.map((c) => (
      `<button type="button" class="tile" data-id="${c.id}"><span class="tile-icon">${ICONS[c.icon] || '…'}</span>${esc(c.name)}</button>`
    )).join('') + '<button type="button" class="tile" data-id="__more"><span class="tile-icon">…</span>ほか</button>';
  };

  chips(el.querySelector('#kind'), [{ value: 'expense', label: '支出' }, { value: 'income', label: '収入' }], kind, (v) => {
    kind = v; drawPay(); drawTiles(); el.querySelector('#more').hidden = true;
  });
  drawPay();
  drawTiles();

  const readAmount = () => {
    const amount = Number(amountInput.value);
    if (!amount) { toast('金額を入れてください'); amountInput.focus(); return 0; }
    return amount;
  };

  const save = async (categoryId, patient) => {
    const amount = readAmount();
    if (!amount) return;
    const category = m.cat[categoryId];
    const t = newTransaction({
      date: el.querySelector('#date').value || todayISO(),
      type: kind,
      amount,
      categoryId,
      fromAccountId: kind === 'expense' ? pay : null,
      toAccountId: kind === 'income' ? pay : null,
      status: kind === 'expense' ? statusFor(pay) : 'confirmed',
      tax: category.tax === 'medical'
        ? { kind: 'medical', patient: patient || 'self', medicalType: categoryId === 'otc' ? '医薬品購入' : '診療・治療', reimbursed: 0 }
        : null,
    });
    await put('transactions', t);
    await setMeta('lastPayAccount', pay);
    toast(`${category.name} ${yen(amount)} を保存しました`, {
      label: '取り消し',
      run: async () => { await del('transactions', t.id); renderInput(el, { onScan }); },
    });
    renderInput(el, { onScan });
  };

  el.querySelector('#tiles').onclick = (e) => {
    const b = e.target.closest('.tile');
    if (!b) return;
    if (b.dataset.id === '__more') { showMore(); return; }
    choose(b.dataset.id);
  };

  const choose = (categoryId) => {
    if (!readAmount()) return;
    if (m.cat[categoryId].tax === 'medical') {
      const box = el.querySelector('#patient');
      box.hidden = false;
      chips(box.querySelector('#patient-chips'), patientOptions(members), null, (v) => save(categoryId, v));
      box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    save(categoryId);
  };

  const showMore = () => {
    const box = el.querySelector('#more');
    const groups = kind === 'expense'
      ? ['fixed', 'variable', 'medical', 'child', 'special']
      : ['income'];
    box.innerHTML = groups.map((g) => `
      <p class="group-label">${GROUP_LABELS[g]}</p>
      <div class="chips">${m.categories.filter((c) => c.group === g)
        .map((c) => `<button type="button" class="chip" data-id="${c.id}">${esc(c.name)}</button>`).join('')}</div>`).join('');
    box.hidden = false;
    box.onclick = (e) => { const b = e.target.closest('.chip'); if (b) choose(b.dataset.id); };
  };

  renderRecent(el.querySelector('#recent'), txs, m, () => renderInput(el, { onScan }));
}

// 給与など金額が毎回変わる定期記録の確認（銀行 CSV を取り込めばそちらで確定する）
function renderConfirmList(box, list, m, refresh) {
  box.innerHTML = list.map((t) => `
    <div class="notice info" data-id="${t.id}">
      <span>${esc(t.memo || m.cat[t.categoryId]?.name)}（${shortDate(t.date)}）の金額は？</span>
      <span class="notice-row"><input inputmode="numeric" value="${t.amount}" aria-label="金額">円
      <button type="button" class="btn-small">確定</button></span>
    </div>`).join('');
  box.onclick = async (e) => {
    if (!e.target.matches('button')) return;
    const row = e.target.closest('[data-id]');
    const t = list.find((x) => x.id === row.dataset.id);
    t.amount = Number(row.querySelector('input').value.replace(/[^\d]/g, '')) || t.amount;
    t.needsConfirm = false;
    await put('transactions', t);
    toast('金額を確定しました');
    refresh();
  };
}

export function txLine(t, m) {
  const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '' : '→';
  const acc = m.acc[t.type === 'income' ? t.toAccountId : t.fromAccountId]?.name || '';
  const tags = [
    t.status === 'pending' ? '<span class="tag">仮</span>' : '',
    t.tax ? '<span class="tag tax">申告</span>' : '',
  ].join('');
  return `<span class="tx-date">${shortDate(t.date)}</span>
    <span class="tx-main">${esc(t.memo || m.cat[t.categoryId]?.name || '')}${tags}<small>${esc(m.cat[t.categoryId]?.name || '')}・${esc(acc)}</small></span>
    <span class="tx-amt${t.type === 'income' ? ' plus' : ''}">${sign}${yen(t.amount)}</span>`;
}

export function renderRecent(ul, txs, m, refresh, limit = 8) {
  const list = [...txs].sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt)).slice(0, limit);
  ul.innerHTML = list.length
    ? list.map((t) => `<li><button type="button" class="tx" data-id="${t.id}">${txLine(t, m)}</button></li>`).join('')
    : '<li class="empty">まだ記録がありません。金額を入れて費目を押すと保存されます。</li>';
  ul.onclick = async (e) => {
    const b = e.target.closest('.tx');
    if (!b) return;
    const t = list.find((x) => x.id === b.dataset.id);
    if (!confirm(`${shortDate(t.date)} ${m.cat[t.categoryId]?.name} ${yen(t.amount)} を削除しますか？`)) return;
    await del('transactions', t.id);
    toast('削除しました', { label: '元に戻す', run: async () => { await put('transactions', t); refresh(); } });
    refresh();
  };
}
