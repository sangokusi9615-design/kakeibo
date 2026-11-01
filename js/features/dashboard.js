// 週・月・年の集計（費目別）。年は1〜12月で区切る（確定申告と同じ。docs/01 年の集計）

import { GROUP_LABELS } from '../config/categories.js';
import { MEDICAL } from '../config/settings.js';
import { loadMasters, activeTransactions, renderRecent } from './transactions.js';
import { weeklyReview } from './review.js';
import { yen, todayISO, addDays, weekStart, monthKey, addMonths, shortDate, esc } from '../utils/format.js';
import { chips, applyWidths, isCurrent } from '../utils/ui.js';

let state = { period: 'month', anchor: todayISO() };

function range(period, anchor) {
  if (period === 'week') {
    const from = weekStart(anchor);
    return { from, to: addDays(from, 6), label: `${shortDate(from)}〜${shortDate(addDays(from, 6))}` };
  }
  if (period === 'month') {
    const ym = monthKey(anchor);
    return { from: `${ym}-01`, to: `${ym}-31`, label: `${ym.slice(0, 4)}年${Number(ym.slice(5))}月` };
  }
  const y = anchor.slice(0, 4);
  return { from: `${y}-01-01`, to: `${y}-12-31`, label: `${y}年` };
}

function shift(period, anchor, n) {
  if (period === 'week') return addDays(anchor, 7 * n);
  if (period === 'month') return `${addMonths(monthKey(anchor), n)}-01`;
  return `${Number(anchor.slice(0, 4)) + n}-01-01`;
}

const inRange = (t, r) => t.date >= r.from && t.date <= r.to;

export async function renderSummary(el) {
  const m = await loadMasters();
  const all = await activeTransactions();
  if (!isCurrent('summary')) return;
  const r = range(state.period, state.anchor);
  const txs = all.filter((t) => inRange(t, r));
  // 会社負担・立替（excluded の費目）は生活費・収入に数えず、別枠で出す
  const excluded = (t) => m.cat[t.categoryId]?.excluded;
  const expenses = txs.filter((t) => t.type === 'expense' && !excluded(t));
  const incomes = txs.filter((t) => t.type === 'income' && !excluded(t));
  const reimbursed = txs.filter((t) => t.type === 'expense' && excluded(t)).reduce((s, t) => s + t.amount, 0);
  const spend = expenses.reduce((s, t) => s + t.amount, 0);
  // 給付金・還付金は一時的な収入なので、貯蓄率の計算からは外して別枠で見せる（docs/04）
  const regularIncome = incomes.filter((t) => !m.cat[t.categoryId]?.oneOff).reduce((s, t) => s + t.amount, 0);
  const oneOffIncome = incomes.filter((t) => m.cat[t.categoryId]?.oneOff).reduce((s, t) => s + t.amount, 0);
  const net = regularIncome + oneOffIncome - spend;
  const rate = regularIncome ? Math.round(((regularIncome - spend) / regularIncome) * 1000) / 10 : null;

  const byCat = {};
  expenses.forEach((t) => { byCat[t.categoryId] = (byCat[t.categoryId] || 0) + t.amount; });
  const rows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const max = rows[0]?.[1] || 1;
  const months = state.period === 'year'
    ? Math.max(1, new Set(expenses.map((t) => monthKey(t.date))).size) : 1;

  const byGroup = {};
  expenses.forEach((t) => { const g = m.cat[t.categoryId]?.group || 'variable'; byGroup[g] = (byGroup[g] || 0) + t.amount; });

  el.innerHTML = `
    <section class="view">
      <div class="chips" id="period"></div>
      <div class="period-nav">
        <button type="button" id="prev" aria-label="前へ">‹</button>
        <strong>${r.label}</strong>
        <button type="button" id="next" aria-label="次へ">›</button>
      </div>
      <div class="metrics">
        <div class="metric"><span>収入</span><strong>${yen(regularIncome + oneOffIncome)}</strong></div>
        <div class="metric"><span>支出</span><strong>${yen(spend)}</strong></div>
        <div class="metric"><span>収支</span><strong class="${net >= 0 ? 'plus' : 'minus'}">${net >= 0 ? '+' : ''}${yen(net)}</strong></div>
        <div class="metric"><span>貯蓄率</span><strong>${rate === null ? '—' : `${rate}%`}</strong></div>
      </div>
      ${oneOffIncome ? `<p class="hint">収入のうち給付金・還付金・払い戻し ${yen(oneOffIncome)} は一時的なものなので、貯蓄率には入れていません</p>` : ''}
      ${reimbursed ? `<p class="hint">会社負担・立替 ${yen(reimbursed)} は会社から戻るので、支出に含めていません</p>` : ''}
      ${state.period === 'week' ? weekReviewHtml(all, r, m) : ''}
      ${state.period === 'year' ? yearBars(all.filter((t) => !excluded(t)), r.from.slice(0, 4)) : ''}
      ${state.period === 'year' ? medicalHtml(all, r.from.slice(0, 4)) : ''}
      <h3 class="section-title">費目別</h3>
      <ul class="cat-list">${rows.length ? rows.map(([id, v]) => `
        <li>
          <div class="cat-row"><span>${esc(m.cat[id]?.name || id)}</span>
          <span>${yen(v)}${state.period === 'year' ? `<small>月${yen(Math.round(v / months))}</small>` : ''}</span></div>
          <div class="bar-track"><div class="bar" data-w="${Math.round((v / max) * 100)}"></div></div>
        </li>`).join('') : '<li class="empty">この期間の支出はまだありません</li>'}</ul>
      ${spend ? `<p class="hint">${Object.entries(byGroup).sort((a, b) => b[1] - a[1])
        .map(([g, v]) => `${GROUP_LABELS[g]} ${Math.round((v / spend) * 100)}%`).join(' ／ ')}</p>` : ''}
      <h3 class="section-title">この期間の記録</h3>
      <ul class="tx-list" id="list"></ul>
    </section>`;

  chips(el.querySelector('#period'), [
    { value: 'week', label: '週' }, { value: 'month', label: '月' }, { value: 'year', label: '年' },
  ], state.period, (v) => { state = { period: v, anchor: todayISO() }; renderSummary(el); });
  el.querySelector('#prev').onclick = () => { state.anchor = shift(state.period, state.anchor, -1); renderSummary(el); };
  el.querySelector('#next').onclick = () => { state.anchor = shift(state.period, state.anchor, 1); renderSummary(el); };
  renderRecent(el.querySelector('#list'), txs, m, () => renderSummary(el), 200);
  applyWidths(el);
}

function weekReviewHtml(all, r, m) {
  const exp = (from, to) => all.filter((t) => t.type === 'expense' && !m.cat[t.categoryId]?.excluded
    && t.date >= from && t.date <= to);
  return weeklyReview(exp(r.from, r.to), exp(addDays(r.from, -7), addDays(r.from, -1)), m.cat);
}

function yearBars(all, year) {
  const totals = Array.from({ length: 12 }, (_, i) => {
    const ym = `${year}-${String(i + 1).padStart(2, '0')}`;
    return all.filter((t) => t.type === 'expense' && monthKey(t.date) === ym).reduce((s, t) => s + t.amount, 0);
  });
  const max = Math.max(...totals, 1);
  return `
    <h3 class="section-title">月ごとの支出</h3>
    <div class="month-bars">${totals.map((v, i) => `
      <div class="month-bar" title="${i + 1}月 ${yen(v)}"><div class="bar-v" data-h="${Math.round((v / max) * 100)}"></div><span>${i + 1}</span></div>`).join('')}
    </div>`;
}

// 医療費控除の目安（10万円）までの進み具合。補てん額は差し引く（docs/05）
function medicalHtml(all, year) {
  const med = all.filter((t) => t.tax?.kind === 'medical' && t.date.startsWith(year));
  if (!med.length) return '';
  const paid = med.reduce((s, t) => s + t.amount - (t.tax.reimbursed || 0), 0);
  const left = MEDICAL.threshold - paid;
  return `<p class="notice ${left <= 0 ? 'ok' : 'info'}">医療費 ${yen(paid)}。${left > 0
    ? `医療費控除の目安（10万円）まで あと ${yen(left)}`
    : '医療費控除の目安（10万円）を超えています。確定申告で戻る可能性があります'}</p>`;
}
