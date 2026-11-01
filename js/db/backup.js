// バックアップの書き出し・読み込み（JSON）。API キーは書き出さない（docs/07）

import { STORES, SCHEMA_VERSION, getAll, clear, putMany, setMeta, getMeta } from './storage.js';
import { todayISO, daysBetween } from '../utils/format.js';
import { BACKUP_WARN_DAYS } from '../config/settings.js';
import { ensureMembers } from '../features/members.js';

const SECRET_META = ['apiKey'];

export async function buildBackup() {
  const data = {};
  for (const name of STORES) {
    const rows = await getAll(name);
    data[name] = name === 'meta' ? rows.filter((r) => !SECRET_META.includes(r.key)) : rows;
  }
  return { app: 'kakeibo', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data };
}

// iPhone では共有シートから「ファイル」/ iCloud Drive に保存する。共有できない環境ではダウンロード
export async function exportBackup() {
  const json = JSON.stringify(await buildBackup());
  const name = `kakeibo-backup-${todayISO()}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: '家計簿バックアップ' });
    } catch (e) {
      if (e.name === 'AbortError') return false;  // 共有シートを閉じただけ
      throw e;
    }
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  await setMeta('lastBackupAt', todayISO());
  return true;
}

export async function importBackup(file) {
  const backup = JSON.parse(await file.text());
  if (backup.app !== 'kakeibo' || !backup.data) throw new Error('家計簿のバックアップファイルではありません');
  if (backup.schemaVersion > SCHEMA_VERSION) throw new Error('新しい版のアプリで作られたバックアップです。アプリを更新してください');
  const apiKey = await getMeta('apiKey');
  for (const name of STORES) {
    await clear(name);
    await putMany(name, backup.data[name] || []);
  }
  if (apiKey) await setMeta('apiKey', apiKey);  // 端末の API キーは残す
  await ensureMembers();                         // 古い版のバックアップには家族の一覧がないため作り直す
}

// 最終バックアップからの日数（一度もなければ null）
export async function daysSinceBackup() {
  const last = await getMeta('lastBackupAt');
  return last ? daysBetween(last, todayISO()) : null;
}

export async function backupOverdue() {
  const days = await daysSinceBackup();
  return days === null || days >= BACKUP_WARN_DAYS;
}
