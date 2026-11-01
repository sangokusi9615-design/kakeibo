// 起動処理・画面切り替え。起動したらすぐ入力画面（docs/01 操作の原則）

import { openDB, getAll, putMany, getMeta, setMeta, requestPersist, SCHEMA_VERSION } from './db/storage.js';
import { defaultCategories, defaultAccounts } from './config/categories.js';
import { backupOverdue } from './db/backup.js';
import { renderInput, runRecurring } from './features/transactions.js';
import { startScan } from './features/receipt-scan.js';
import { renderSummary } from './features/dashboard.js';
import { renderTodo } from './features/todo.js';
import { renderAssets } from './features/assets.js';
import { renderSettings } from './features/settings.js';
import { ensureMembers } from './features/members.js';

const TABS = [
  { id: 'input', label: '入力', icon: '✏️' },
  { id: 'summary', label: '集計', icon: '📊' },
  { id: 'todo', label: 'やること', icon: '✅' },
  { id: 'assets', label: '資産', icon: '🐷' },
  { id: 'settings', label: '設定', icon: '⚙️' },
];

const main = document.getElementById('app');

async function seed() {
  if ((await getAll('categories')).length === 0) await putMany('categories', defaultCategories);
  if ((await getAll('accounts')).length === 0) await putMany('accounts', defaultAccounts);
  if (!(await getMeta('schemaVersion'))) await setMeta('schemaVersion', SCHEMA_VERSION);
}

function currentTab() {
  const id = location.hash.slice(1);
  return TABS.some((t) => t.id === id) ? id : 'input';
}

async function show(tab = currentTab()) {
  document.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  window.scrollTo(0, 0);
  if (tab === 'input') {
    await renderInput(main, {
      onScan: () => startScan(main, { onDone: () => show('input'), onFallback: () => show('input') }),
    });
  }
  if (tab === 'summary') await renderSummary(main);
  if (tab === 'todo') await renderTodo(main);
  if (tab === 'assets') await renderAssets(main);
  if (tab === 'settings') await renderSettings(main);
}

function renderNav() {
  const nav = document.createElement('nav');
  nav.className = 'nav';
  nav.innerHTML = TABS.map((t) => (
    `<button type="button" data-tab="${t.id}"><span aria-hidden="true">${t.icon}</span>${t.label}<i class="dot" hidden></i></button>`
  )).join('');
  nav.onclick = (e) => {
    const b = e.target.closest('button');
    if (b) location.hash = b.dataset.tab;
  };
  document.body.append(nav);
}

async function boot() {
  await openDB();
  await seed();
  await ensureMembers();
  await requestPersist();
  await runRecurring();
  renderNav();
  if (await backupOverdue()) document.querySelector('[data-tab="todo"] .dot').hidden = false;
  window.addEventListener('hashchange', () => show());
  await show();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot().catch((e) => {
  main.textContent = `起動できませんでした：${e.message}`;
});
