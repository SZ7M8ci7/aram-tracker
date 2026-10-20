(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PlayaramCache = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  // 大きなJSONをlocalStorageへ入れず、IndexedDBに最新3ファイルだけ保存する。
  function createStore(env = globalThis) {
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
            if (!saved || typeof saved.version !== "string" || !saved.version || now() - saved.savedAt < 0 || now() - saved.savedAt > 7 * 86400000) saved = null;
            if (saved) validate(saved.data);
          } catch (_) { saved = null; }
        }
        const result = await request(endpoint, { ...params, action: "read", fileId, ...(force ? { refresh: "1" } : {}), ...(saved ? { knownVersion: saved.version } : {}) });
        if (result.notModified) {
          if (!saved || result.version !== saved.version) throw new Error("更新確認の応答が不正です。「最新を取得」をお試しください。");
          return { data: validate(saved.data), reused: true };
        }
        const data = validate(result.data);
        let stored = false;
        if (typeof result.version === "string" && result.version) {
          try { await store.put({ key, version: result.version, data, savedAt: now() }); stored = true; } catch (_) { /* 容量不足や保存拒否でも表示は続行 */ }
        }
        return { data, reused: false, stored };
      }
    };
  }
  return { createStore, createReader };
});
