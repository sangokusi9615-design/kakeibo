// CSV の読み込み。文字コードを判定して文字にし、ダブルクォート付きの項目も正しく分ける

// 楽天カードは UTF-8（BOM 付き）、楽天銀行は Shift_JIS。UTF-8 として読めなければ Shift_JIS で読む
export function decodeCsv(buffer) {
  const bytes = new Uint8Array(buffer);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('shift_jis').decode(bytes);
  }
}

// 1行目を見出しにして、行ごとのオブジェクトの配列を返す
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }

  const [header, ...body] = rows.filter((r) => r.some((v) => v.trim() !== ''));
  if (!header) return { header: [], records: [] };
  const keys = header.map((h) => h.trim());
  return { header: keys, records: body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()]))) };
}

export const toNumber = (s) => Number(String(s ?? '').replace(/[,円\s]/g, '')) || 0;
