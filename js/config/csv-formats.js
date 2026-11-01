// 取り込み元ごとの CSV 列定義と自動判定ルール
// 楽天カードは 2026年10月請求分の実データで形式を確認済み（docs/03_データ設計.md）

// 店名の照合用。全角英数→半角、半角カナ→全角にそろえ、空白を詰める
// 銀行明細は濁点が別の文字（ト゛）で入るため、空白を詰めた後に NFC で「ド」にまとめ直す
export function normalizeName(name) {
  return name.normalize('NFKC').replace(/\s+/g, '').normalize('NFC');
}

export const rakutenCard = {
  id: 'rakuten-card',
  label: '楽天カード（楽天 e-NAVI 利用明細）',
  encoding: 'utf-8',
  // 「◯月支払金額」「◯月繰越残高」は請求月で列名が変わるので読まない
  columns: {
    date: '利用日',
    name: '利用店名・商品名',
    user: '利用者',
    method: '支払方法',
    amount: '利用金額',
    fee: '手数料/利息',
  },
  dateFormat: 'YYYY/MM/DD',
  owner: { '本人': 'self', '家族': 'family' },
  singlePayment: '1回払い',
  account: '楽天カード',
};

// 楽天銀行（入出金明細）。2026年1〜10月の実データで形式を確認済み（docs/03_データ設計.md）
export const rakutenBank = {
  id: 'rakuten-bank',
  label: '楽天銀行（入出金明細）',
  encoding: 'shift_jis',          // BOM なし。TextDecoder('shift_jis') で読む
  columns: {
    date: '取引日',
    amount: '入出金(円)',         // 入金はプラス、出金はマイナス
    balance: '取引後残高(円)',    // 月末残高・使い始めの残高にそのまま使う
    name: '入出金内容',
  },
  dateFormat: 'YYYYMMDD',
  account: '楽天銀行',
};

// 楽天銀行の入出金内容の判定（normalizeName 後）。上から順に判定する
// 公開ファイルなので、勤務先・自治体名・口座番号など個人に結びつく語は書かない。それらは iPhone 内で学習する
export const bankRules = [
  { test: /^ラクテンカ-ドサ-ビス/, kind: 'transfer', to: 'rakuten_card' },    // カード代金の引き落とし
  { test: /^カ-ド出金|ATM/, kind: 'transfer', to: 'cash' },                  // 現金の引き出し
  // 楽天以外のカード会社の引き落とし（「〇〇カ-ド」で終わる）。会社名は書かない。明細は取り込まず、
  // 支払いは「他社カード」口座への振替にして、記録のない分を「他社カード（内訳なし）」の支出で補う（docs/03）
  { test: /カ-ド$/, kind: 'transfer', to: 'other_card' },
  { test: /^給与/, kind: 'income', category: 'salary' },
  { test: /^賞与/, kind: 'income', category: 'bonus' },
  { test: /ジドウテアテ|児童手当/, kind: 'income', category: 'child_allowance' },
  { test: /コドモイリヨウヒ|子ども医療費/, kind: 'income', category: 'medical_refund' },  // 子ども医療費助成の払い戻し → 医療費の補てん
  { test: /ゼイムシヨ|税務署/, kind: 'income', category: 'tax_refund' },
  { test: /シヨクギヨウアンテイ|職業安定/, kind: 'income', category: 'benefit' },       // 育児休業給付金など（非課税）
  { test: /利息|現金プレゼント/, kind: 'income', category: 'interest' },
];

// 上から順に判定し、最初に当たったものを使う（照合は normalizeName 後の店名）。to は口座の id
export const transferRules = [
  { test: /^楽天ペイ残高/, to: 'rakuten_pay' },   // 「オートチャージ」「チャージ」の両方
  { test: /楽天証券/, to: 'nisa' },               // クレカ積立
];

// 初期の店名ルール。公開するファイルなので全国チェーンなど一般的な名前だけにする（docs/07_個人情報の扱い.md）
// 自分がよく行く店は、確認画面で選んだ費目を iPhone 内の merchantRules に追加して学習する
export const initialMerchantRules = [
  { test: /イオン|イトーヨーカド|西友|ライフ|マルエツ|業務スーパー/, category: '食費' },
  { test: /マクドナルド|スターバツクス|スターバックス|すき家|吉野家/, category: '外食' },
  { test: /ドンキ|ダイソー|ニトリ|無印良品/, category: '日用品' },
  { test: /NTT|ドコモ|docomo|ソフトバンク|SoftBank|UQmobile|楽天モバイル/i, category: '通信' },
  { test: /エナジ-|エナジー|電力|ガス|水道/, category: '水道光熱' },
  { test: /APPLECOMBILL|GOOGLE|NETFLIX|SPOTIFY/i, category: 'サブスク' },
  { test: /アマゾンプライムカイヒ/, category: '特別費' },  // 年会費。特別費の年間予定にも登録を促す
  { test: /交通局|コウツウキヨク|JR|メトロ|PASMO|SUICA/i, category: '交通' },
];

// 医療費控除の候補。当たったら tax=medical で確認画面へ（医療を受けた人・補てん額を聞く）
export const medicalHints = /イリヨ|医療|病院|ビヨウイン|医院|イイン|クリニツク|クリニック|歯科|シカ|薬局|ヤツキヨク/;
