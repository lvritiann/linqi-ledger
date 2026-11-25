/* 本地数据存储：IndexedDB，键为单号 */
(function (global) {
  'use strict';
  const DB_NAME = 'linqi_ledger_db';
  const STORE = 'orders';
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      let result;
      try { result = fn(store); } catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('事务中止'));
    }));
  }

  const DB = {
    async all() {
      return tx('readonly', store => store.getAll()).then(rows =>
        rows.sort((a, b) => String(b.id).localeCompare(String(a.id), 'zh-CN'))
      );
    },
    async get(id) { return tx('readonly', store => store.get(id)); },
    async put(order) { return tx('readwrite', store => store.put(order)); },
    async remove(id) { return tx('readwrite', store => store.delete(id)); },
    async clear() { return tx('readwrite', store => store.clear()); },
    async count() { return tx('readonly', store => store.count()); }
  };

  global.LQDB = DB;
})(window);
