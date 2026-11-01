// レシート撮影 → 読み取り → 確認 → 保存（医療費・セルフメディケーション対象の判定を含む）
// 仕様：docs/06_レシート読み取り仕様.md、個人情報：docs/07_個人情報の扱い.md

import { put, getMeta, setMeta } from '../db/storage.js';
import { MODELS, DEFAULT_MODEL, USD_JPY } from '../config/settings.js';
import { PAYMENT_ACCOUNTS } from '../config/categories.js';
import { loadMasters, newTransaction, statusFor, guessCategory, learnCategory } from './transactions.js';
import { yen, esc, todayISO } from '../utils/format.js';
import { toast, chips } from '../utils/ui.js';
import { loadMembers, patientOptions } from './members.js';

const LONG_SIDE = 1500;

const SCHEMA = {
  type: 'object',
  properties: {
    store: { type: 'string' },
    date: { type: 'string', description: 'YYYY-MM-DD。読めなければ空文字' },
    total: { type: 'integer' },
    paymentMethod: { type: 'string', enum: ['rakuten_pay', 'rakuten_card', 'other_card', 'cash', 'other', 'unknown'] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          amount: { type: 'integer' },
          selfMedication: { type: 'boolean' },
        },
        required: ['name', 'amount', 'selfMedication'],
        additionalProperties: false,
      },
    },
    selfMedicationTotal: { type: 'integer' },
    isMedical: { type: 'boolean' },
    confidence: { type: 'string', enum: ['high', 'low'] },
    notes: { type: 'string' },
  },
  required: ['store', 'date', 'total', 'paymentMethod', 'items', 'selfMedicationTotal', 'isMedical', 'confidence', 'notes'],
  additionalProperties: false,
};

const PROMPT = `日本のレシートの画像です。家計簿に記録するため、指定の JSON で内容を返してください。
- total はレシートの「合計」（税込）。小計・お預かり・お釣り・ポイント利用額・割引前の額と取り違えない
- date は購入日を YYYY-MM-DD で。年が書かれていなければ ${new Date().getFullYear()} 年とする
- paymentMethod：楽天ペイ・R Pay なら rakuten_pay、楽天カードなら rakuten_card、楽天以外のクレジットカードなら other_card、現金なら cash、交通系 IC・他の QR 決済などは other、書かれていなければ unknown
- items は品目ごと。値引きはその品目の額から引く。品目が多ければ主なものだけでよい
- selfMedication：品名の前後に ★・◆ などの印があり、レシートにセルフメディケーション税制対象の説明がある品だけ true
- isMedical：病院・クリニック・調剤薬局の領収書なら true
- confidence：合計や日付がはっきり読めなければ low
- 人名・住所・電話番号・会員番号・カード番号・レシート番号は、どの欄にも書かない
- notes は読めなかった箇所を 40 文字以内で。なければ空文字`;

// ---- 撮影 ----

export function pickImage() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}

// 端末内で縮小して JPEG の base64 にする。元の画像はどこにも保存しない
async function toJpegBase64(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, LONG_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
  canvas.width = canvas.height = 0;
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

// ---- 読み取り ----

async function readReceipt(base64) {
  const apiKey = await getMeta('apiKey');
  if (!apiKey) throw new Error('設定画面で Claude の API キーを入れてください');
  let Anthropic;
  try {
    ({ default: Anthropic } = await import('../vendor/anthropic-sdk/index.mjs'));
  } catch {
    throw new Error('読み取り用の部品（SDK）がまだ入っていません');
  }
  const model = await getMeta('model', DEFAULT_MODEL);
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const response = await client.messages.create({
    model,
    max_tokens: 4000,  // Opus 5.5 は思考を止められず、その分も出力に数えられるため余裕を持たせる
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
        { type: 'text', text: PROMPT },
      ],
    }],
  });
  await recordUsage(model, response.usage);
  if (response.stop_reason === 'refusal') throw new Error('読み取れませんでした');
  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('読み取れませんでした');
  return scrub(JSON.parse(text));
}

// 月ごとの使用量と費用の目安を残す（設定画面に表示。docs/06）
async function recordUsage(model, usage) {
  if (!usage) return;
  const month = todayISO().slice(0, 7);
  const all = await getMeta('apiUsage', {});
  const u = all[month] || { count: 0, inTok: 0, outTok: 0, yen: 0 };
  const price = MODELS[model] || MODELS[DEFAULT_MODEL];
  u.count += 1;
  u.inTok += usage.input_tokens || 0;
  u.outTok += usage.output_tokens || 0;
  u.yen += (((usage.input_tokens || 0) * price.inUsd + (usage.output_tokens || 0) * price.outUsd) / 1e6) * USD_JPY;
  all[month] = u;
  await setMeta('apiUsage', all);
}

// 念のため、8桁以上の数字の並びと電話番号の形は保存前に消す（docs/07）
const SECRET = /(\d[\d-]{7,}\d)|(0\d{1,4}-\d{1,4}-\d{3,4})/g;
function scrub(r) {
  const clean = (s) => String(s || '').replace(SECRET, '').trim();
  return {
    ...r,
    store: clean(r.store),
    notes: clean(r.notes),
    items: (r.items || []).map((i) => ({ ...i, name: clean(i.name) })),
  };
}

// ---- 確認画面 ----

export async function startScan(el, { onDone, onFallback }) {
  const file = await pickImage();
  if (!file) return;
  el.innerHTML = '<section class="view"><div class="loading">読み取り中…<small>10秒ほどかかります</small></div></section>';
  let result;
  try {
    let base64 = await toJpegBase64(file);
    result = await readReceipt(base64);
    base64 = null;
  } catch (e) {
    toast(`${e.message || '読み取りに失敗しました'}。手入力に切り替えます`);
    onFallback();
    return;
  }
  await renderConfirm(el, result, { onDone, onRetake: () => startScan(el, { onDone, onFallback }) });
}

const PAY_FROM_RESULT = { rakuten_pay: 'rakuten_pay', rakuten_card: 'rakuten_card', other_card: 'other_card', cash: 'cash' };

async function renderConfirm(el, r, { onDone, onRetake }) {
  const m = await loadMasters();
  const guessed = await guessCategory(r.store, m.categories);
  let categoryId = guessed || (r.isMedical ? 'pharmacy' : r.selfMedicationTotal ? 'otc' : 'daily');
  let pay = PAY_FROM_RESULT[r.paymentMethod] || 'rakuten_pay';  // 書いていなければ一番使う楽天ペイ
  let patient = await getMeta('lastPatient', 'self');
  const members = await loadMembers();
  const itemSum = r.items.reduce((s, i) => s + i.amount, 0);
  const mismatch = r.items.length > 0 && itemSum !== r.total;
  const lowDate = r.confidence === 'low' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date);
  const needsPatient = r.selfMedicationTotal > 0 || r.isMedical;

  el.innerHTML = `
    <section class="view">
      <h2>読み取り結果</h2>
      ${r.confidence === 'low' ? '<p class="notice warn">読み取りに自信がない箇所があります。色の付いた欄を確認してください</p>' : ''}
      <div class="form">
        <label>店名<input id="store" value="${esc(r.store)}"></label>
        <label class="${lowDate ? 'check' : ''}">日付<input type="date" id="date" value="${lowDate && !r.date ? todayISO() : esc(r.date)}"></label>
        <label class="${mismatch || r.confidence === 'low' ? 'check' : ''}">合計<input id="total" inputmode="numeric" value="${r.total}"></label>
        ${mismatch ? `<p class="hint">品目の合計（${yen(itemSum)}）と合計が違います</p>` : ''}
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
        <button type="button" id="retake">撮り直す</button>
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
