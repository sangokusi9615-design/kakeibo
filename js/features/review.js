// 週1回の振り返り：今週と先週の比較、増えた費目を1行で伝える（責めない書き方にする。docs/01）

import { yen } from '../utils/format.js';

export function weeklyReview(thisWeek, lastWeek, cat) {
  const sum = (list) => list.reduce((s, t) => s + t.amount, 0);
  const now = sum(thisWeek);
  const before = sum(lastWeek);
  if (!thisWeek.length && !lastWeek.length) return '';

  const byCat = (list) => list.reduce((o, t) => ({ ...o, [t.categoryId]: (o[t.categoryId] || 0) + t.amount }), {});
  const a = byCat(thisWeek);
  const b = byCat(lastWeek);
  const grew = Object.keys(a)
    .map((id) => ({ id, diff: a[id] - (b[id] || 0) }))
    .sort((x, y) => y.diff - x.diff)[0];

  const diff = now - before;
  const lines = [
    before
      ? `先週より ${yen(Math.abs(diff))} ${diff > 0 ? '多め' : '少なめ'}です。`
      : '今週から記録が始まりました。',
  ];
  if (grew && grew.diff > 0 && before) lines.push(`いちばん増えたのは「${cat[grew.id]?.name || 'その他'}」（+${yen(grew.diff)}）。`);
  return `<div class="notice info">${lines.join('')}</div>`;
}
