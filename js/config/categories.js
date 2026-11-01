// 費目の初期値（docs/04_FP設計方針.md）。visible=false の費目は「その他」の一覧から選ぶ
// group: income 収入 / saving 先取り / fixed 固定費 / variable 変動費 / medical 医療 / child 子ども / special 特別費

export const GROUP_LABELS = {
  income: '収入', saving: '先取り貯蓄・投資', fixed: '固定費', variable: '変動費',
  medical: '医療', child: '子ども', special: '特別費',
};

export const defaultCategories = [
  { id: 'salary', name: '給与', group: 'income' },
  { id: 'bonus', name: '賞与', group: 'income' },
  { id: 'child_allowance', name: '児童手当', group: 'income' },
  { id: 'benefit', name: '給付金', group: 'income', oneOff: true },     // 育児休業給付金・自治体の給付など
  { id: 'tax_refund', name: '還付金', group: 'income', oneOff: true },
  { id: 'interest', name: '利息', group: 'income' },
  { id: 'income_other', name: 'その他の収入', group: 'income' },

  { id: 'saving', name: '貯蓄', group: 'saving' },
  { id: 'nisa', name: 'NISA', group: 'saving' },

  { id: 'housing', name: '住居', group: 'fixed', icon: 'home' },
  { id: 'telecom', name: '通信', group: 'fixed', icon: 'wifi' },
  { id: 'insurance', name: '保険', group: 'fixed', icon: 'shield' },
  { id: 'subscription', name: 'サブスク', group: 'fixed', icon: 'repeat' },
  { id: 'utilities', name: '水道光熱', group: 'fixed', icon: 'bolt' },

  { id: 'food', name: '食費', group: 'variable', icon: 'cart', visible: true },
  { id: 'eatout', name: '外食', group: 'variable', icon: 'cup', visible: true },
  { id: 'daily', name: '日用品', group: 'variable', icon: 'bag', visible: true },
  { id: 'transport', name: '交通', group: 'variable', icon: 'train', visible: true },
  { id: 'social', name: '交際', group: 'variable', icon: 'gift' },
  { id: 'hobby', name: '趣味・娯楽', group: 'variable', icon: 'star' },
  { id: 'beauty', name: '理美容', group: 'variable', icon: 'scissors' },
  { id: 'other', name: 'その他', group: 'variable', icon: 'dots' },
  { id: 'fee', name: '手数料', group: 'variable', icon: 'dots' },

  { id: 'hospital', name: '医療', group: 'medical', icon: 'cross', visible: true, tax: 'medical' },
  { id: 'pharmacy', name: '薬局（処方）', group: 'medical', icon: 'cross', tax: 'medical' },
  { id: 'otc', name: '市販薬', group: 'medical', icon: 'cross', tax: 'medical' },
  { id: 'medical_transport', name: '通院の交通費', group: 'medical', icon: 'train', tax: 'medical' },

  { id: 'childcare', name: '保育料・園', group: 'child', icon: 'baby' },
  { id: 'child_goods', name: '子ども', group: 'child', icon: 'baby', visible: true },  // おむつ・ミルク・衣類
  { id: 'lessons', name: '習い事', group: 'child', icon: 'baby' },
  { id: 'child_leisure', name: 'おもちゃ・レジャー', group: 'child', icon: 'baby' },

  { id: 'special', name: '特別費', group: 'special', icon: 'gift', visible: true },
  { id: 'card_unknown', name: '他社カード（内訳なし）', group: 'variable', icon: 'dots' },
  { id: 'pay_unknown', name: '楽天ペイ（内訳なし）', group: 'variable', icon: 'dots' },
].map((c, i) => ({ visible: false, icon: 'dots', ...c, order: i }));

// 費目アイコン（外部のアイコンフォントは読み込まない方針のため絵文字を使う）
export const ICONS = {
  cart: '🛒', cup: '🍽️', bag: '🧴', train: '🚃', cross: '💊', baby: '👶', gift: '🎁', dots: '…',
  home: '🏠', wifi: '📱', shield: '🛡️', repeat: '🔁', bolt: '💡', star: '🎮', scissors: '✂️',
};

// 口座の初期値（docs/03_データ設計.md）。liquid＝すぐ使えるお金（生活防衛資金に数える）
export const defaultAccounts = [
  { id: 'rakuten_pay', name: '楽天ペイ', kind: 'wallet', liquid: true },
  { id: 'rakuten_card', name: '楽天カード', kind: 'card', liquid: false },
  { id: 'cash', name: '現金', kind: 'cash', liquid: true },
  { id: 'other_card', name: 'その他のカード', kind: 'card', liquid: false },
  { id: 'rakuten_bank', name: '楽天銀行', kind: 'bank', liquid: true },
  { id: 'nisa', name: '楽天証券 NISA', kind: 'nisa', liquid: false },
  { id: 'kids_nisa', name: 'こどもNISA', kind: 'kids_nisa', liquid: false, owner: 'family' },
].map((a) => ({ owner: 'self', openingBalance: 0, openingDate: null, ...a }));

// 入力画面で支払い方法として出す口座（並び順どおり）
export const PAYMENT_ACCOUNTS = ['rakuten_pay', 'rakuten_card', 'cash', 'other_card'];
