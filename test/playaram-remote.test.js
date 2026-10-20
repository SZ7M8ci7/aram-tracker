"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSource, endpointUrl, request } = require("../public/playaram-remote");
const query = value => `?src=${encodeURIComponent(value)}`;
test("ordinary URL keeps the local-file page", () => {
  assert.equal(parseSource(""), null);
  assert.equal(parseSource("?rev=123"), null);
});
test("only a configured GAS deployment can execute JSONP", () => {
  for (const endpoint of ["", "https://evil.test/exec", "https://script.google.com/macros/s/test/dev", "https://script.google.com/macros/s/test/exec?x=1"]) assert.throws(() => endpointUrl(endpoint));
  assert.equal(endpointUrl("https://script.google.com/macros/s/test/exec").hostname, "script.google.com");
});
function transport(mode) {
  let removed = false, timer;
  const env = { setTimeout: fn => { timer = fn; return 1; }, clearTimeout: () => {}, document: {
    createElement: () => ({ remove: () => { removed = true; } }),
    head: { appendChild: script => {
      const url = new URL(script.src), callback = url.searchParams.get("callback");
      if (mode === "timeout") timer();
      else if (mode === "network") script.onerror();
      else env[callback](mode === "error" ? { ok: false, error: "Denied" } : { ok: true, files: [] });
    } }
  } };
  return { env, removed: () => removed };
}
test("JSONP success cleans up scripts and callbacks", async () => {
  const t = transport("success");
  assert.deepEqual(await request("https://script.google.com/macros/s/test/exec", { action: "list" }, t.env), { ok: true, files: [] });
  assert.equal(t.removed(), true);
  assert.equal(Object.keys(t.env).some(k => k.startsWith("playaram_")), false);
});
test("JSONP server errors, network errors and timeouts clean up", async () => {
  for (const mode of ["error", "network", "timeout"]) {
    const t = transport(mode);
    await assert.rejects(request("https://script.google.com/macros/s/test/exec", {}, t.env));
    assert.equal(t.removed(), true);
    assert.equal(Object.keys(t.env).some(k => k.startsWith("playaram_")), false);
  }
});
test("Drive folder and individual share links resolve without an API key", () => {
  const folder = parseSource(query("https://drive.google.com/drive/u/1/folders/abcdefghij123?usp=sharing"));
  assert.equal(folder.kind, "folder");
  assert.equal(folder.viewUrl, "https://drive.google.com/drive/folders/abcdefghij123");
  const file = parseSource(query("https://drive.google.com/file/d/abcdefghij123/view?resourcekey=key123"));
  assert.equal(file.kind, "file");
  assert.equal(new URL(file.viewUrl).searchParams.get("resourcekey"), "key123");
  assert.equal(parseSource(query("https://drive.google.com/open?id=abcdefghij123")).kind, "file");
});
test("untrusted schemes, hosts, credentials and missing IDs are rejected", () => {
  for (const url of ["javascript:alert(1)", "http://drive.google.com/file/d/abcdefghij123/view", "https://drive.google.com.evil.test/file/d/abcdefghij123/view", "https://user@drive.google.com/file/d/abcdefghij123/view", "https://drive.google.com/", "not a url"]) {
    assert.throws(() => parseSource(query(url)));
  }
});
