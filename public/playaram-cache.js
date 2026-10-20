(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PlayaramCache = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const TTL = 24 * 60 * 60 * 1000;
  const PREFIX = "playaram-public-json-v2:";
  function createStore(env = globalThis, fallback = createIndexedStore(env)) {
    return {
      async get(key) {
        try {
          const raw = env.localStorage.getItem(PREFIX + key);
          if (raw) return JSON.parse(raw);
        } catch (_) {}
        return fallback.get(key);
      },
      async put(entry) {
        try {
          const storage = env.localStorage;
          storage.setItem(PREFIX + entry.key, JSON.stringify(entry));
          const entries = [];
          for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (key.startsWith(PREFIX)) {
              try { entries.push({ key, savedAt: JSON.parse(storage.getItem(key)).savedAt || 0 }); } catch (_) {}
            }
          }
          entries.sort((a, b) => b.savedAt - a.savedAt);
          entries.slice(3).forEach(item => storage.removeItem(item.key));
          return;
        } catch (_) {
          // 古いlocalStorageを新しいIndexedDBより優先しない。
          try { env.localStorage.removeItem(PREFIX + entry.key); } catch (_) {}
          await fallback.put(entry);
        }
      }
    };
  }
  // localStorageの容量を超えるJSON用の保存先。
  function createIndexedStore(env = globalThis) {
    let opening;
    function open() {
      if (!env.indexedDB) return Promise.reject(new Error("Storage unavailable"));
      if (!opening) opening = new Promise((resolve, reject) => {
        const request = env.indexedDB.open("playaram-public-json-v1", 1);
        const timer = env.setTimeout(() => reject(new Error("Storage timeout")), 3000);
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore("files", { keyPath: "key" });
          store.createIndex("savedAt", "savedAt");
        };
        request.onsuccess = () => { env.clearTimeout(timer); resolve(request.result); };
        request.onerror = request.onblocked = () => { env.clearTimeout(timer); reject(new Error("Storage unavailable")); };
      });
      return opening;
    }
    async function transaction(mode, action) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("files", mode);
        let value;
        const timer = env.setTimeout(() => { try { tx.abort(); } catch (_) {} reject(new Error("Storage timeout")); }, 5000);
        tx.oncomplete = () => { env.clearTimeout(timer); resolve(value); };
        tx.onerror = tx.onabort = () => { env.clearTimeout(timer); reject(tx.error || new Error("Storage failed")); };
        action(tx.objectStore("files"), result => { value = result; });
      });
    }
    return {
      get: key => transaction("readonly", (store, done) => { const req = store.get(key); req.onsuccess = () => done(req.result || null); }),
      put: entry => transaction("readwrite", store => {
        store.put(entry);
        const count = store.count();
        count.onsuccess = () => {
          let excess = count.result - 3;
          if (excess <= 0) return;
          const cursor = store.index("savedAt").openCursor();
          cursor.onsuccess = () => { if (cursor.result && excess-- > 0) { cursor.result.delete(); cursor.result.continue(); } };
        };
      })
    };
  }
  function createReader({ endpoint, params, request, validate, store = createStore(), now = Date.now }) {
    return {
      async read(fileId, force = false) {
        const key = JSON.stringify([endpoint, params.sourceId, params.kind, fileId]);
        let saved = null;
        if (!force) {
          try {
            saved = await store.get(key);
            if (!saved || !Number.isFinite(saved.savedAt) || now() - saved.savedAt < 0 || now() - saved.savedAt >= TTL) saved = null;
            if (saved) validate(saved.data);
          } catch (_) { saved = null; }
        }
        if (saved) return { data: validate(saved.data), reused: true, stored: true };
        const result = await request(endpoint, { ...params, action: "read", fileId, refresh: "1" });
        const data = validate(result.data);
        let stored = false;
        try { await store.put({ key, version: result.version || null, data, savedAt: now() }); stored = true; } catch (_) { /* 容量不足や保存拒否でも表示は続行 */ }
        return { data, reused: false, stored };
      }
    };
  }
  return { createStore, createReader };
});
