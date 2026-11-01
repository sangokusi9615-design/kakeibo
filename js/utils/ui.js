// 画面部品（トースト・選択チップ）。CSP で inline style を禁止しているため、見た目はすべて class で付ける

import { esc } from './format.js';

let toastTimer;

// action を渡すと「取り消し」などのボタンが付く
export function toast(message, action) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button" class="toast-btn">${esc(action.label)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { el.classList.remove('show'); action.run(); };
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 5000 : 2500);
}

// options: [{ value, label }]。選択中の value を返す getter と、変更時の onChange
export function chips(container, options, selected, onChange) {
  container.innerHTML = options.map((o) => (
    `<button type="button" class="chip${o.value === selected ? ' on' : ''}" data-v="${esc(o.value)}">${esc(o.label)}</button>`
  )).join('');
  let value = selected;
  container.onclick = (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    value = b.dataset.v;
    container.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
    onChange?.(value);
  };
  return () => value;
}

// 読み込みの途中で別のタブに移ったら描画しない（遅れて終わった描画が今の画面を上書きしないように）
export function isCurrent(tab) {
  return (location.hash.slice(1) || 'input') === tab;
}

// 棒の長さなど、計算で決まる幅は描画後に style へ入れる（CSSOM 経由なら CSP に触れない）
export function applyWidths(root) {
  root.querySelectorAll('[data-w]').forEach((el) => { el.style.width = `${el.dataset.w}%`; });
  root.querySelectorAll('[data-h]').forEach((el) => { el.style.height = `${el.dataset.h}%`; });
}
