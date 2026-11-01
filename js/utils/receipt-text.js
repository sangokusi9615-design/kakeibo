// レシートの文字（iPhone の「テキスト認識表示」でコピーしたもの）から、合計・日付・店名・支払い方法を拾う
// すべて端末の中で処理する（費用ゼロ。docs/06）。拾えなかった項目は確認画面で入れてもらう

const TOTAL_WORDS = /(総合計|合計|お買上げ?計|お買い?上げ?金額|ご請求額|お支払い?金額|領収金額|請求額)/;
const NOT_TOTAL = /(小計|お預り|お預かり|預り|釣|おつり|対象|内税|外税|消費税|税額|点数|ポイント|値引|割引)/;
const SKIP_ITEM = /(合計|小計|預り|預かり|釣|消費税|内税|外税|税率|対象|ポイント|残高|TEL|電話|No\.|レジ|担当|責|楽天ペイ|R\s?Pay|クレジット|カード|現金|お支払|電子マネー|\d{1,2}:\d{2}|\d+\s*[年/]\s*\d+\s*[月/])/i;
const AMOUNT = /[¥\\]?\s*(\d{1,3}(?:,\d{3})+|\d+)\s*円?/g;

// 全角数字・記号を半角に。「¥」はそのまま残す
function normalize(text) {
  return text.normalize('NFKC').replace(/\r/g, '').replace(/[－−―]/g, '-');
}

function amountsIn(line) {
  return [...line.matchAll(AMOUNT)]
    .map((m) => Number(m[1].replace(/,/g, '')))
    .filter((n) => n > 0 && n < 10000000);
}

// 行末の金額（品目の値段）。「¥」や「円」が付いているか、末尾にある数字だけを見る
function trailingAmount(line) {
  const m = line.match(/[¥\\]\s*(\d{1,3}(?:,\d{3})+|\d+)\s*[※*外内軽]*\s*$|(\d{1,3}(?:,\d{3})+|\d+)\s*円?\s*[※*外内軽]*\s*$/);
  if (!m) return null;
  const n = Number((m[1] || m[2]).replace(/,/g, ''));
  return n > 0 ? n : null;
}

function findTotal(lines) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!TOTAL_WORDS.test(line) || NOT_TOTAL.test(line.replace(TOTAL_WORDS, ''))) continue;
    if (/小計/.test(line)) continue;
    const here = amountsIn(line.replace(/\d+点/g, ''));
    if (here.length) return Math.max(...here);
    // テキスト認識では「合計」と金額が別の行になることがある
    const next = lines[i + 1] && amountsIn(lines[i + 1]);
    if (next?.length) return Math.max(...next);
  }
  return null;
}

function findDate(text) {
  const thisYear = new Date().getFullYear();
  const pad = (n) => String(n).padStart(2, '0');
  const ok = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= thisYear + 1;
  let m = text.match(/(20\d{2})\s*[年/.\-]\s*(\d{1,2})\s*[月/.\-]\s*(\d{1,2})/);
  if (m && ok(+m[1], +m[2], +m[3])) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = text.match(/令和\s*(\d{1,2}|元)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/);
  if (m) {
    const y = 2018 + (m[1] === '元' ? 1 : Number(m[1]));
    if (ok(y, +m[2], +m[3])) return `${y}-${pad(m[2])}-${pad(m[3])}`;
  }
  m = text.match(/(?:^|[^\d])(\d{2})[/.](\d{1,2})[/.](\d{1,2})(?![\d])/);
  if (m && ok(2000 + Number(m[1]), +m[2], +m[3])) return `${2000 + Number(m[1])}-${pad(m[2])}-${pad(m[3])}`;
  m = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m && ok(thisYear, +m[1], +m[2])) return `${thisYear}-${pad(m[1])}-${pad(m[2])}`;
  return '';
}

// 店名：先頭のほうで、日付・電話・番号・決まり文句でない最初の行
function findStore(lines) {
  const skip = /(領収|レシート|receipt|ありがとう|いらっしゃいませ|TEL|電話|〒|登録番号|^T\d|\d{2,4}-\d{2,4}-\d{3,4}|^\d+$|^[\d\s/:.\-年月日時分()（）]+$)/i;
  return lines.slice(0, 8).find((l) => l.length >= 2 && !skip.test(l) && !/[¥\\]\s*\d/.test(l)) || '';
}

function findPayment(text) {
  if (/楽天ペイ|R\s?Pay|楽天Pay/i.test(text)) return 'rakuten_pay';
  if (/楽天カード/.test(text)) return 'rakuten_card';
  if (/クレジット|VISA|Master|JCB|AMEX|カード支払|クレカ/i.test(text)) return 'rakuten_card';  // ふだんのカードは楽天カード。違えば確認画面で直す
  if (/(お預り|お預かり|預り金|現金)/.test(text)) return 'cash';
  if (/(Suica|PASMO|ICOCA|交通系|PayPay|d払い|au\s?PAY|iD|QUICPay|nanaco|WAON|Edy)/i.test(text)) return 'other';
  return 'unknown';
}

export function parseReceiptText(raw) {
  const text = normalize(raw || '');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  const items = [];
  for (const line of lines) {
    if (SKIP_ITEM.test(line) || TOTAL_WORDS.test(line)) continue;
    const amount = trailingAmount(line);
    if (!amount) continue;
    const name = line.replace(/[¥\\]?\s*[\d,]+\s*円?\s*[※*外内軽]*\s*$/, '').trim();
    if (!name || /^[\d\s,.:/\-]+$/.test(name)) continue;
    // ★・◆ などの印はセルフメディケーション税制の対象品
    items.push({ name: name.replace(/^[★☆◆◇●]\s*/, ''), amount, selfMedication: /^[★☆◆◇●]|[★☆◆◇]/.test(name) });
  }

  const total = findTotal(lines) ?? (items.length ? items.reduce((s, i) => s + i.amount, 0) : 0);
  const date = findDate(text);
  const selfMedicationTotal = items.filter((i) => i.selfMedication).reduce((s, i) => s + i.amount, 0);

  return {
    store: findStore(lines),
    date,
    total,
    paymentMethod: findPayment(text),
    items,
    selfMedicationTotal,
    isMedical: /(調剤|処方|保険点数|患者負担|診療|医療機関)/.test(text),
    confidence: total && date && findTotal(lines) !== null ? 'high' : 'low',
    notes: findTotal(lines) === null ? '「合計」が見つからなかったので品目の合計を入れました' : '',
  };
}
