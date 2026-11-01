// 「やること」画面：月1回の作業、バックアップの警告、確定申告まとめの途中経過（docs/01, docs/05）

import { MEDICAL, SELF_MEDICATION } from '../config/settings.js';
import { activeTransactions } from './transactions.js';
import { exportBackup, daysSinceBackup, backupOverdue } from '../db/backup.js';
import { yen, esc, todayISO, shortDate } from '../utils/format.js';
import { startImport } from './csv-import.js';
import { toast, isCurrent } from '../utils/ui.js';
import { loadMembers, memberName } from './members.js';

export async function renderTodo(el) {
  const txs = await activeTransactions();
  const members = await loadMembers({ includeInactive: true });
  const year = todayISO().slice(0, 4);
  const days = await daysSinceBackup();
  const overdue = await backupOverdue();
  // 最後に取り込んだ日（取り込んだ記録の作成日から）
  const lastImport = {};
  for (const t of txs) {
    const kind = t.importKey?.startsWith('rakuten-card') ? 'card' : t.importKey?.startsWith('rakuten-bank') ? 'bank' : null;
    if (kind && (!lastImport[kind] || t.createdAt > lastImport[kind])) lastImport[kind] = t.createdAt;
  }
  for (const k of Object.keys(lastImport)) lastImport[k] = shortDate(lastImport[k].slice(0, 10));
  if (!isCurrent('todo')) return;
  const pendingCard = txs.filter((t) => t.status === 'pending' && t.fromAccountId === 'rakuten_card').length;

  const med = txs.filter((t) => t.tax?.kind === 'medical' && t.date.startsWith(year));
  // 銀行に入った医療費の払い戻し（子ども医療費助成など）は補てん額として差し引く（docs/05）
  const refunds = txs.filter((t) => t.categoryId === 'medical_refund' && t.date.startsWith(year)).reduce((s, t) => s + t.amount, 0);
  const medPaid = Math.max(0, med.reduce((s, t) => s + t.amount - (t.tax.reimbursed || 0), 0) - refunds);
  const medByPatient = {};
  med.forEach((t) => { medByPatient[t.tax.patient] = (medByPatient[t.tax.patient] || 0) + t.amount - (t.tax.reimbursed || 0); });
  const selfmed = txs.filter((t) => t.tax?.kind === 'selfmed' && t.date.startsWith(year))
    .reduce((s, t) => s + (t.tax.otcAmount || 0), 0);
  const sm = SELF_MEDICATION[year];
  const medDeduction = Math.min(Math.max(0, medPaid - MEDICAL.threshold), MEDICAL.max);
  const smDeduction = sm ? Math.min(Math.max(0, selfmed - sm.floor), sm.max) : null;

  el.innerHTML = `
    <section class="view">
      ${overdue ? `<div class="notice warn">${days === null ? 'まだ一度もバックアップしていません。' : `最後のバックアップから${days}日たっています。`}
        iPhone の不具合やアイコン削除でデータが消えることがあるので、保存しておきましょう。
        <button type="button" class="btn-small" id="backup">今すぐ保存</button></div>` : ''}
      <h2>今月やること</h2>
      <ul class="task-list">
        <li><button type="button" class="task-btn" data-import>楽天銀行の CSV を取り込む</button><small>${lastImport.bank ? `前回 ${lastImport.bank}` : '未実施'}</small></li>
        <li><button type="button" class="task-btn" data-import>楽天カードの CSV を取り込む</button><small>${pendingCard ? `照合待ち ${pendingCard}件・` : ''}${lastImport.card ? `前回 ${lastImport.card}` : '未実施'}</small></li>
        <li><span>楽天ペイの残高・NISA の評価額を入れる</span><small>次の段階で作ります</small></li>
        <li><span>バックアップを保存</span><small>${days === null ? '未実施' : `${days}日前`}</small></li>
      </ul>
      <h2>確定申告まとめ ${year}</h2>
      <div class="card">
        <div class="cat-row"><span>医療費（補てん後）</span><strong>${yen(medPaid)}</strong></div>
        ${Object.entries(medByPatient).map(([p, v]) => `<div class="cat-row sub"><span>${esc(memberName(members, p))}</span><span>${yen(v)}</span></div>`).join('')}
        ${refunds ? `<div class="cat-row sub"><span>医療費の払い戻し（差し引き済み）</span><span>-${yen(refunds)}</span></div>` : ''}
        <div class="cat-row"><span>セルフメディケーション対象</span><strong>${yen(selfmed)}</strong></div>
        <div class="cat-row"><span>控除額の目安</span><span>医療費控除 ${yen(medDeduction)} ／ セルフメディケーション ${smDeduction === null ? '（制度の値を確認中）' : yen(smDeduction)}</span></div>
        <p class="hint">${smDeduction !== null && (medDeduction || smDeduction)
          ? `控除額が大きいのは${medDeduction >= smDeduction ? '医療費控除' : 'セルフメディケーション税制'}です（どちらか一方だけ使えます）。`
          : '医療費控除は年10万円を超えた分が対象です。'}領収書は自宅で5年間保管してください。</p>
      </div>
    </section>`;

  // どちらのボタンでも同じ：ファイルの中身を見て楽天カードか楽天銀行かを自動で判定する
  el.querySelectorAll('[data-import]').forEach((b) => {
    b.onclick = () => startImport(el, { onDone: () => renderTodo(el) });
  });

  el.querySelector('#backup')?.addEventListener('click', async () => {
    if (await exportBackup()) { toast('バックアップを保存しました'); renderTodo(el); }
  });
}
