// レシートを読む：iPhone の「テキスト認識表示」でコピーした文字を貼り付け → 端末内で読み取り → 確認 → 保存
// 費用ゼロ・画像は使わない（docs/06_レシート読み取り仕様.md、docs/07_個人情報の扱い.md）

import { put, getMeta, setMeta } from '../db/storage.js';
import { PAYMENT_ACCOUNTS } from '../config/categories.js';
import { loadMasters, newTransaction, statusFor, guessCategory, learnCategory } from './transactions.js';
import { parseReceiptText } from '../utils/receipt-text.js';
import { yen, esc, todayISO } from '../utils/format.js';
import { toast, chips } from '../utils/ui.js';
import { loadMembers, patientOptions } from './members.js';

// 念のため、8桁以上の数字の並びと電話番号の形は保存前に消す（docs/07）
const SECRET = /(\d[\d-]{7,}\d)|(0\d{1,4}-\d{1,4}-\d{3,4})/g;
function scrub(r) {
  const clean = (s) => String(s || '').replace(SECRET, '').trim();
  return { ...r, store: clean(r.store), items: r.items.map((i) => ({ ...i, name: clean(i.name) })) };
}

// ---- 貼り付け画面 ----

export function startScan(el, { onDone, onFallback }) {
  el.innerHTML = `
    <section class="view">
      <h2>レシートを読む</h2>
      <ol class="steps">
        <li>iPhone の「カメラ」をレシートに向ける（撮らなくてよい）</li>
        <li>右下の「テキスト認識表示」ボタン（文字のマーク）を押す</li>
        <li>「すべてをコピー」を押す</li>
        <li>このアプリに戻って下のボタンを押す</li>
      </ol>
      <button type="button" class="scan-btn" id="paste">📋 貼り付けて読む</button>
      <label class="label" for="text">うまく貼り付けられないときは、ここを長押しして「ペースト」</label>
      <textarea id="text" rows="6" placeholder="レシートの文字"></textarea>
      <div class="btn-row">
        <button type="button" id="cancel">手入力に戻る</button>
        <button type="button" class="primary" id="read">読む</button>
      </div>
    </section>`;

  const textarea = el.querySelector('#text');
  const read = (text) => {
    if (!text.trim()) { toast('レシートの文字を貼り付けてください'); textarea.focus(); return; }
    renderConfirm(el, scrub(parseReceiptText(text)), { onDone, onRetake: () => startScan(el, { onDone, onFallback }) });
  };

  el.querySelector('#paste').onclick = async () => {
    try {
      read(await navigator.clipboard.readText());
    } catch {
      toast('下の枠を長押しして「ペースト」してください');
      textarea.focus();
    }
  };
  el.querySelector('#read').onclick = () => read(textarea.value);
  el.querySelector('#cancel').onclick = onFallback;
}

// ---- 確認画面 ----

const PAY_FROM_RESULT = { rakuten_pay: 'rakuten_pay', rakuten_card: 'rakuten_card', other_card: 'other_card', cash: 'cash' };

async function renderConfirm(el, r, { onDone, onRetake }) {
  const m = await loadMasters();
  const guessed = await guessCategory(r.store, m.categories);
  let categoryId = guessed || (r.isMedical ? 'pharmacy' : r.selfMedicationTotal ? 'otc' : 'daily');
  let pay = PAY_FROM_RESULT[r.paymentMethod] || 'rakuten_pay';  // 書いていなければ一番使う楽天ペイ
  let patient = await getMeta('lastPatient', 'self');
  const members = await loadMembers();
  const lowDate = !/^\d{4}-\d{2}-\d{2}$/.test(r.date);
  const lowTotal = r.confidence === 'low' || !r.total;
  const needsPatient = r.selfMedicationTotal > 0 || r.isMedical;

  el.innerHTML = `
    <section class="view">
      <h2>読み取り結果</h2>
      ${lowDate || lowTotal ? '<p class="notice warn">読み取れなかった欄があります。色の付いた欄を確認してください</p>' : ''}
      <div class="form">
        <label>店名<input id="store" value="${esc(r.store)}"></label>
        <label class="${lowDate ? 'check' : ''}">日付<input type="date" id="date" value="${lowDate ? todayISO() : esc(r.date)}"></label>
        <label class="${lowTotal ? 'check' : ''}">合計<input id="total" inputmode="numeric" value="${r.total || ''}"></label>
      </div>
      <p class="label">支払い方法</p>
      <div class="chips" id="pay"></div>
      <p class="hint" id="pay-hint"></p>
      <p class="label">費目</p>
      <div class="chips" id="cat"></div>
      ${needsPatient ? `
        <div class="notice warn">
          ${r.selfMedicationTotal > 0 ? `★ セルフメディケーション対象 ${yen(r.selfMedicationTotal)}。` : '医療費の領収書です。'}誰の分？
          <div class="chips" id="patient"></div>
        </div>` : ''}
      <ul class="item-list">${r.items.map((i) => `<li><span>${i.selfMedication ? '★ ' : ''}${esc(i.name)}</span><span>${yen(i.amount)}</span></li>`).join('')}</ul>
      ${r.notes ? `<p class="hint">${esc(r.notes)}</p>` : ''}
      <div class="btn-row">
        <button type="button" id="retake">やり直す</button>
        <button type="button" class="primary" id="save">保存</button>
      </div>
    </section>`;

  const payHint = el.querySelector('#pay-hint');
  const hint = () => { payHint.textContent = pay === 'rakuten_card' ? 'カード明細の取り込み時に自動で照合します' : ''; };
  chips(el.querySelector('#pay'), PAYMENT_ACCOUNTS.map((id) => ({ value: id, label: m.acc[id].name })), pay, (v) => { pay = v; hint(); });
  hint();

  const catIds = [...new Set([categoryId, 'food', 'daily', 'eatout', 'child_goods', 'otc', 'pharmacy', 'other'])];
  chips(el.querySelector('#cat'), catIds.map((id) => ({ value: id, label: m.cat[id].name })), categoryId, (v) => { categoryId = v; });
  if (needsPatient) {
    chips(el.querySelector('#patient'), patientOptions(members), patient, (v) => { patient = v; });
  }

  el.querySelector('#retake').onclick = onRetake;
  el.querySelector('#save').onclick = async () => {
    const store = el.querySelector('#store').value.trim();
    const total = Number(el.querySelector('#total').value.replace(/[^\d]/g, ''));
    if (!total) { toast('合計を入れてください'); return; }
    let tax = null;
    if (r.isMedical) {
      tax = { kind: 'medical', patient, provider: store, medicalType: '診療・治療', reimbursed: 0 };
    } else if (r.selfMedicationTotal > 0) {
      tax = { kind: 'selfmed', patient, provider: store, otcAmount: r.selfMedicationTotal };
    }
    await put('transactions', newTransaction({
      date: el.querySelector('#date').value || todayISO(),
      amount: total,
      categoryId,
      fromAccountId: pay,
      memo: store,
      source: 'receipt',
      status: statusFor(pay),
      items: r.items,
      tax,
    }));
    if (store && categoryId !== guessed) await learnCategory(store, categoryId);
    await setMeta('lastPayAccount', pay);
    if (needsPatient) await setMeta('lastPatient', patient);
    toast(`${store || 'レシート'} ${yen(total)} を保存しました`);
    onDone();
  };
}
