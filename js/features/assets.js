// 口座ごとの残高・純資産・生活防衛資金（docs/03 口座、docs/04 指標）
// 残高 ＝ 使い始めの残高 ＋ 入ってきた額 − 出ていった額（カードは未払い額をマイナスで持つ）

import { EMERGENCY_MONTHS, KIDS_NISA } from '../config/settings.js';
import { loadMasters, activeTransactions } from './transactions.js';
import { getMeta } from '../db/storage.js';
import { yen, esc, todayISO, monthKey, addMonths } from '../utils/format.js';
import { applyWidths, isCurrent } from '../utils/ui.js';

export function balances(accounts, txs) {
  const bal = Object.fromEntries(accounts.map((a) => [a.id, a.openingBalance || 0]));
  for (const t of txs) {
    const since = (id) => !accounts.find((a) => a.id === id)?.openingDate || t.date >= accounts.find((a) => a.id === id).openingDate;
    if (t.fromAccountId && t.fromAccountId in bal && since(t.fromAccountId)) bal[t.fromAccountId] -= t.amount;
    if (t.toAccountId && t.toAccountId in bal && since(t.toAccountId)) bal[t.toAccountId] += t.amount;
  }
  return bal;
}

export async function renderAssets(el) {
  const m = await loadMasters();
  const txs = await activeTransactions();
  const bal = balances(m.accounts, txs);
  const net = Object.values(bal).reduce((s, v) => s + v, 0);
  const liquid = m.accounts.filter((a) => a.liquid).reduce((s, a) => s + bal[a.id], 0);

  // 月の生活費＝直近3か月（今月を除く）の支出の平均
  const thisMonth = monthKey(todayISO());
  const last3 = [1, 2, 3].map((n) => addMonths(thisMonth, -n));
  const monthly = last3.map((ym) => txs.filter((t) => t.type === 'expense' && monthKey(t.date) === ym).reduce((s, t) => s + t.amount, 0));
  const recorded = monthly.filter((v) => v > 0).length;
  const avg = recorded ? monthly.reduce((s, v) => s + v, 0) / recorded : 0;
  const target = avg * EMERGENCY_MONTHS;
  const pct = target ? Math.min(100, Math.round((liquid / target) * 100)) : 0;

  const childBirth = await getMeta('childBirth');
  const withdrawFrom = childBirth
    ? `${Number(childBirth.slice(0, 4)) + KIDS_NISA.withdrawAge}${childBirth.slice(4)}` : null;
  if (!isCurrent('assets')) return;

  el.innerHTML = `
    <section class="view">
      <div class="metric big"><span>純資産</span><strong>${yen(net)}</strong></div>
      <ul class="cat-list">${m.accounts.map((a) => `
        <li><div class="cat-row"><span>${esc(a.name)}${a.id === 'kids_nisa' && withdrawFrom ? `<small>${withdrawFrom.slice(0, 7).replace('-', '年')}月まで引き出せません</small>` : ''}</span>
        <span class="${bal[a.id] < 0 ? 'minus' : ''}">${yen(bal[a.id])}</span></div></li>`).join('')}
      </ul>
      <h3 class="section-title">生活防衛資金（生活費の${EMERGENCY_MONTHS}か月分）</h3>
      ${recorded ? `
        <div class="bar-track"><div class="bar" data-w="${pct}"></div></div>
        <p class="hint">すぐ使えるお金 ${yen(liquid)} ／ 目安 ${yen(target)}（月の生活費 ${yen(avg)}）。${liquid >= target
          ? '目安に届いています。'
          : `あと ${yen(target - liquid)}。届くまでは投資より預金を優先するのが基本です。`}</p>`
        : '<p class="hint">月の生活費の平均を出すため、先月までの記録がたまると表示されます。</p>'}
      <p class="hint">残高は設定画面の「使い始めの残高」に記録を足し引きした値です。銀行 CSV・残高合わせ・目標・将来の見込みは次の段階で作ります。</p>
    </section>`;
  applyWidths(el);
}
