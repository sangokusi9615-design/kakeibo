// IndexedDB への保存・読み込み（起動時に navigator.storage.persist() を要求）
// ストアの中身は docs/03_データ設計.md

const DB_NAME = 'kakeibo';
const DB_VERSION = 2;           // 2：members（家族）を追加
export const SCHEMA_VERSION = 2;

export const STORES = [
  'transactions', 'categories', 'merchantRules', 'accounts', 'balances', 'budgets',
  'templates', 'specialPlans', 'recurring', 'goals', 'members', 'meta',
];

let dbPromise;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, { keyPath: name === 'meta' ? 'key' : 'id' });
        if (name === 'transactions') {
          store.createIndex('date', 'date');
          store.createIndex('importKey', 'importKey');
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(storeName, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const result = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export const getAll = (store) => run(store, 'readonly', (s) => s.getAll());
export const get = (store, key) => run(store, 'readonly', (s) => s.get(key));
export const put = (store, value) => run(store, 'readwrite', (s) => { s.put(value); return value; });
export const del = (store, key) => run(store, 'readwrite', (s) => s.delete(key));
export const clear = (store) => run(store, 'readwrite', (s) => s.clear());
export const putMany = (store, values) => run(store, 'readwrite', (s) => { values.forEach((v) => s.put(v)); });

export async function findByImportKey(key) {
  return run('transactions', 'readonly', (s) => s.index('importKey').get(key));
}

export async function getMeta(key, fallback = null) {
  const row = await get('meta', key);
  return row ? row.value : fallback;
}

export function setMeta(key, value) {
  return put('meta', { key, value });
}

export function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// 起動のたびに呼ぶ（一度の許可が続くとは限らないため。docs/02）
export async function requestPersist() {
  if (!navigator.storage?.persist) return 'unsupported';
  if (await navigator.storage.persisted()) return 'granted';
  return (await navigator.storage.persist()) ? 'granted' : 'denied';
}
