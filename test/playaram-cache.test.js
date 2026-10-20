"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createReader } = require("../public/playaram-cache");
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
test("browser reuses persisted JSON only after server verifies its version", async () => {
  const f = fixture();
  assert.equal((await createReader(f.options).read("file")).stored, true);
  const second = await createReader(f.options).read("file");
  assert.equal(second.reused, true);
  assert.equal(f.calls[1].knownVersion, "v1");
  f.version("v2");
  const changed = await createReader(f.options).read("file");
  assert.equal(changed.reused, false);
  assert.deepEqual(changed.data.summaries, ["v2"]);
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
test("storage failure is nonfatal; network failure never displays unverified old data", async () => {
  const f = fixture(), reader = createReader(f.options);
  await reader.read("file");
  f.offline();
  await assert.rejects(reader.read("file"), /Offline/);
  const good = fixture();
  const result = await createReader({ ...good.options, store: { get: async () => { throw Error(); }, put: async () => { throw Error(); } } }).read("file");
  assert.equal(result.stored, false);
  assert.equal(result.reused, false);
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
