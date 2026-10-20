"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSource } = require("../public/playaram-remote");
const query = value => `?src=${encodeURIComponent(value)}`;
test("ordinary URL keeps the local-file page", () => {
  assert.equal(parseSource(""), null);
  assert.equal(parseSource("?rev=123"), null);
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
