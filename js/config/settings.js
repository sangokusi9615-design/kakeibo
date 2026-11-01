// 制度の値・アプリの設定値。改正があったらここだけ直す（docs/04, docs/05）

// 医療費控除：足切り10万円（所得200万円以上の場合）、上限200万円
export const MEDICAL = { threshold: 100000, max: 2000000 };

// セルフメディケーション税制。2027年分から延長・見直し（対象品が変わる）。下限・上限が変わるかは未確認なので null
export const SELF_MEDICATION = {
  2026: { floor: 12000, max: 88000 },
  2027: null,
};

// ふるさと納税：この数を超えるとワンストップ特例が使えない
export const FURUSATO_ONESTOP_MAX = 5;

// NISA（2026年10月時点）・こどもNISA（2027年1月開始。開始前に金融庁で最終確認）
export const NISA = { annualTsumitate: 1200000, annualGrowth: 2400000, lifetime: 18000000, lifetimeGrowth: 12000000 };
export const KIDS_NISA = { start: '2027-01', annual: 600000, lifetime: 6000000, withdrawAge: 12 };

// 生活防衛資金の目安（月の生活費 × この月数）
export const EMERGENCY_MONTHS = 6;

// 最終バックアップからこの日数を過ぎたら警告する
export const BACKUP_WARN_DAYS = 30;

// レシート読み取り（docs/06）。料金は 100万トークンあたりのドル（2026-11-01 時点）
export const MODELS = {
  'claude-opus-5-5': { label: 'Opus 5.5（正確さ重視）', inUsd: 4, outUsd: 20 },
  'claude-haiku-5-5': { label: 'Haiku 5.5（安さ重視）', inUsd: 0.1, outUsd: 0.5 },
};
export const DEFAULT_MODEL = 'claude-opus-5-5';
export const USD_JPY = 150;

// レシートとカード明細を同じ買い物とみなす日付の幅（docs/03）
export const MATCH_DAYS = 3;
