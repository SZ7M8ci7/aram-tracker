"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createReader, createStore } = require("../public/playaram-cache");
function fixture() {
  const storage = new Map(), calls = [];
  let version = "v1", broken = false, stamp = 1000000;
  const options = {
    endpoint: "trusted", params: { sourceId: "folder", kind: "folder" }, now: () => stamp,
    validate: data => { if (!Array.isArray(data?.summaries)) throw new Error("Invalid data"); return data; },
    store: { get: async key => storage.get(key), put: async value => storage.set(value.key, value) },
    request: async (endpoint, params) => {
      calls.push(params);
      if (broken) throw new Error("Offline");
      return params.knownVersion === version && !params.refresh ? { notModified: true, version } : { data: { summaries: [version] }, version };
    }
  };
  return { options, storage, calls, version: v => { version = v; }, offline: () => { broken = true; }, advance: ms => { stamp += ms; } };
}
test("browser reuses persisted JSON without any request for 24 hours, then downloads updates", async () => {
  const f = fixture();
  assert.equal((await createReader(f.options).read("file")).stored, true);
  const second = await createReader(f.options).read("file");
  assert.equal(second.reused, true);
  assert.equal(f.calls.length, 1);
  f.version("v2");
  f.advance(86400000 - 1);
  assert.equal((await createReader(f.options).read("file")).reused, true);
  assert.equal(f.calls.length, 1);
  f.advance(1);
  const changed = await createReader(f.options).read("file");
  assert.equal(changed.reused, false);
  assert.deepEqual(changed.data.summaries, ["v2"]);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].knownVersion, undefined);
  assert.equal((await createReader(f.options).read("file")).reused, true);
  assert.equal(f.calls.length, 2);
});
test("force reload ignores local version; other files and sources never share cache", async () => {
  const f = fixture(), reader = createReader(f.options);
  await reader.read("file");
  await reader.read("file", true);
  assert.equal(f.calls[1].knownVersion, undefined);
  assert.equal(f.calls[1].refresh, "1");
  await reader.read("other");
  await createReader({ ...f.options, endpoint: "different" }).read("file");
  assert.equal(f.calls[2].knownVersion, undefined);
  assert.equal(f.calls[3].knownVersion, undefined);
});
test("fresh cache works offline, expired cache fails offline, and storage failure is nonfatal", async () => {
  const f = fixture(), reader = createReader(f.options);
  await reader.read("file");
  f.offline();
  assert.equal((await reader.read("file")).reused, true);
  f.advance(86400000);
  await assert.rejects(reader.read("file"), /Offline/);
  const good = fixture();
  const result = await createReader({ ...good.options, store: { get: async () => { throw Error(); }, put: async () => { throw Error(); } } }).read("file");
  assert.equal(result.stored, false);
  assert.equal(result.reused, false);
});

test("localStorage persists JSON and falls back when quota is exceeded", async () => {
  const local = new Map(), large = new Map();
  let full = false;
  const env = { localStorage: {
    get length() { return local.size; }, key: i => [...local.keys()][i],
    getItem: key => local.get(key), removeItem: key => local.delete(key),
    setItem: (key, value) => { if (full) throw Error("QuotaExceededError"); local.set(key, value); }
  } };
  const fallback = { get: async key => large.get(key), put: async entry => large.set(entry.key, entry) };
  const store = createStore(env, fallback);
  await store.put({ key: "a", data: { summaries: [1] }, savedAt: 1 });
  assert.deepEqual((await createStore(env, fallback).get("a")).data, { summaries: [1] });
  assert.equal(large.size, 0);
  full = true;
  await store.put({ key: "a", data: { summaries: [2] }, savedAt: 2 });
  assert.equal(local.size, 0);
  assert.deepEqual((await store.get("a")).data, { summaries: [2] });
});

test("invalid timestamps are not reused and missing server version still permits caching", async () => {
  const f = fixture(), reader = createReader(f.options);
  await reader.read("file");
  [...f.storage.values()][0].savedAt = undefined;
  await reader.read("file");
  assert.equal(f.calls.length, 2);
  [...f.storage.values()][0].savedAt = 2000000;
  await reader.read("file");
  assert.equal(f.calls.length, 3);
  f.version(null);
  await reader.read("file", true);
  assert.equal((await reader.read("file")).reused, true);
  assert.equal(f.calls.length, 4);
});
test("expired and malformed cached JSON are downloaded again", async () => {
  const f = fixture(), reader = createReader(f.options);
  await reader.read("file");
  [...f.storage.values()][0].data = {};
  await reader.read("file");
  assert.equal(f.calls[1].knownVersion, undefined);
  f.advance(8 * 86400000);
  await reader.read("file");
  assert.equal(f.calls[2].knownVersion, undefined);
});
