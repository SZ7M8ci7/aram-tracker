"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const code = fs.readFileSync(require("node:path").join(__dirname, "../gas-reader/Code.gs"), "utf8");
function setup(options = {}) {
  let reads = 0;
  const calls = [];
  const cache = new Map();
  const file = (id, name) => `<div data-id="${id.padEnd(12, '0')}" data-tooltip="${name} Unknown"></div>`;
  let html = options.html ?? [file("a", "a.json"), file("b", "b.json"), file("index", "index.json"), file("large", "large.json"), file("bad", "bad.json")].join("");
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => "allowed-folder" }) },
    CacheService: { getScriptCache: () => ({ get: key => cache.get(key), put: (key, value, ttl) => { assert.equal(ttl, 60); cache.set(key, value); } }) },
    UrlFetchApp: { fetch: (url, config) => {
      calls.push(url);
      assert.deepEqual(Object.keys(config).sort(), ["followRedirects", "muteHttpExceptions"]);
      const folder = url === "https://drive.google.com/drive/folders/allowed-folder";
      if (!folder) reads++;
      return { getResponseCode: () => options.status ?? 200,
        getContentText: () => folder ? html : url.includes("id=bad") ? "not JSON" : '{"matches":[]}',
        getContent: () => ({ length: url.includes("id=large") ? 30 * 1024 * 1024 : 100 }) };
    } },
    ContentService: { MimeType: { JSON: "json", JAVASCRIPT: "js" }, createTextOutput: text => ({ text, setMimeType(type) { this.type = type; return this; } }) }
  });
  vm.runInContext(code, context);
  return { call: p => context.doGet({ parameter: { kind: "folder", sourceId: "allowed-folder", ...p } }), reads: () => reads, calls, context, cache, setHtml: value => { html = value; } };
}
test("GAS list returns metadata without reading JSON blobs", () => {
  const s = setup(), result = JSON.parse(s.call({ action: "list" }).text);
  assert.equal(result.ok, true);
  assert.equal(result.files.length, 4);
  assert.equal(s.reads(), 0);
  assert.equal(result.data, undefined);
});
test("GAS reads only the selected file", () => {
  const s = setup();
  assert.equal(JSON.parse(s.call({ action: "read", fileId: "a00000000000" }).text).ok, true);
  assert.equal(s.reads(), 1);
});
test("GAS rejects outside files, folders, mismatched file sources, invalid and oversized JSON", () => {
  const s = setup();
  for (const p of [
    { action: "read", fileId: "outside" }, { action: "list", sourceId: "outside" },
    { action: "read", fileId: "a00000000000", kind: "file", sourceId: "b00000000000" },
    { action: "read", fileId: "index0000000" }, { action: "read", fileId: "large0000000" },
    { action: "read", fileId: "bad000000000" }, { action: "delete", fileId: "a00000000000" }
  ]) assert.equal(JSON.parse(s.call(p).text).ok, false);
});
test("anonymous reader has no Drive scope or DriveApp dependency", () => {
  const manifest = JSON.parse(fs.readFileSync(require("node:path").join(__dirname, "../gas-reader/appsscript.json"), "utf8"));
  assert.deepEqual(manifest.oauthScopes, ["https://www.googleapis.com/auth/script.external_request"]);
  assert.doesNotMatch(code, /DriveApp|ScriptApp\.getOAuthToken|Authorization/);
});
test("login pages, changed HTML and HTTP errors fail closed", () => {
  for (const options of [{ html: "Sign in" }, { status: 403 }, { status: 429 }]) {
    const s = setup(options);
    assert.equal(JSON.parse(s.call({ action: "list" }).text).ok, false);
    assert.equal(s.reads(), 0);
  }
});
test("public HTML parser deduplicates IDs and decodes filenames", () => {
  const html = '<div data-id="abcdefghij12" data-tooltip="a&amp;b.json Unknown"></div>'.repeat(2);
  const s = setup({ html });
  assert.deepEqual(JSON.parse(s.call({ action: "list" }).text).files, [{ id: "abcdefghij12", name: "a&b.json", version: null }]);
});
function versionHtml(stamp = 1792456446052) {
  const row = ["a00000000000", ["allowed-folder"], "a.json", "application/json", 0, null, 0, 0, 0, stamp, 1792456333477, null, null, 100];
  const escaped = JSON.stringify([[row]]).replace(/./g, c => /[\[\]"]/.test(c) ? "\\x" + c.charCodeAt(0).toString(16) : c);
  return `<div data-id="a00000000000" data-tooltip="a.json Unknown"></div><script>window['_DRIVE_ivd'] = '${escaped}';</script>`;
}
test("list cache avoids repeated fetches, expires after 60s, manual refresh bypasses", () => {
  const s = setup();
  assert.equal(JSON.parse(s.call({ action: "list" }).text).cached, false);
  assert.equal(JSON.parse(s.call({ action: "list" }).text).cached, true);
  assert.equal(s.calls.length, 1);
  const key = [...s.cache.keys()][0], expired = JSON.parse(s.cache.get(key));
  expired.checkedAt = Date.now() - 61000;
  s.cache.set(key, JSON.stringify(expired));
  assert.equal(JSON.parse(s.call({ action: "list" }).text).cached, false);
  s.call({ action: "list", refresh: "1" });
  assert.equal(s.calls.length, 3);
});
test("unchanged JSON skips body; changed metadata bypasses list cache and downloads new body", () => {
  const s = setup({ html: versionHtml() });
  const version = JSON.parse(s.call({ action: "list" }).text).files[0].version;
  assert.equal(version, "v1:1792456446052:1792456333477:100");
  const same = JSON.parse(s.call({ action: "read", fileId: "a00000000000", knownVersion: version }).text);
  assert.equal(same.notModified, true);
  assert.equal(s.reads(), 0);
  s.setHtml(versionHtml(1792456446053)); // same size, timestamp differs by 1ms
  const changed = JSON.parse(s.call({ action: "read", fileId: "a00000000000", knownVersion: version }).text);
  assert.equal(changed.ok, true);
  assert.notEqual(changed.version, version);
  assert.equal(s.reads(), 1);
  s.call({ action: "read", fileId: "a00000000000", knownVersion: changed.version, refresh: "1" });
  assert.equal(s.reads(), 2);
});
test("missing metadata never returns notModified, removed file cannot use stale listing", () => {
  const s = setup({ html: versionHtml() });
  const version = JSON.parse(s.call({ action: "list" }).text).files[0].version;
  s.setHtml('<div data-id="a00000000000" data-tooltip="a.json Unknown"></div>');
  assert.equal(JSON.parse(s.call({ action: "read", fileId: "a00000000000", knownVersion: version }).text).notModified, undefined);
  assert.equal(s.reads(), 1);
  s.setHtml('<div data-id="b00000000000" data-tooltip="b.json Unknown"></div>');
  assert.equal(JSON.parse(s.call({ action: "read", fileId: "a00000000000", knownVersion: version }).text).ok, false);
});
test("GAS validates callbacks before any file reads", () => {
  const s = setup();
  assert.equal(s.call({ action: "list", callback: "alert(1)//" }).type, "json");
  const response = s.call({ action: "list", callback: "playaram_123_1" });
  assert.equal(response.type, "js");
  assert.match(response.text, /^playaram_123_1\(/);
  assert.equal(s.reads(), 0);
});
