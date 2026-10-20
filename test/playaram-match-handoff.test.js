"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../public/playaram.js"), "utf8");
const detail = fs.readFileSync(path.join(__dirname, "../public/playaram-match.js"), "utf8");
const openCode = source.slice(source.indexOf("async function openUploadedMatch("), source.indexOf("function collectFilters("));
const readCode = detail.slice(detail.indexOf("function readMatchPayload("), detail.indexOf("async function init("));
function store() { const data = new Map(); return {getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value)}; }
function fixture(popup = true) {
  const child = { sessionStorage: store(), location: { href: "about:blank" }, close() { this.closed = true; } };
  const window = { open: () => popup ? child : null, sessionStorage: store(), location: { href: "tracker" } };
  const context = vm.createContext({ URL, window, notice() {}, state: {rawData:{}},
    localStorage: {setItem() { throw Error("QuotaExceededError"); }},
    PlayaramCore: {getMatchFromData: () => ({summary:{gameId:123},overview:{teams:[]}})} });
  vm.runInContext(openCode, context);
  return { child, window, context };
}
test("full localStorage does not prevent handoff, detail rendering input, or reload", async () => {
  const f = fixture();
  await f.context.openUploadedMatch({href:"https://example.com/playaram-match.html?gameId=123"});
  assert.match(f.child.location.href, /gameId=123/);
  const ctx = vm.createContext({gameId:"123", sessionStorage:f.child.sessionStorage, localStorage:{getItem(){throw Error("Must not need localStorage");}}});
  vm.runInContext(readCode, ctx);
  assert.equal(ctx.readMatchPayload().summary.gameId, 123);
  assert.equal(ctx.readMatchPayload().summary.gameId, 123);
});
test("blocked popup uses same tab session storage", async () => {
  const f = fixture(false);
  await f.context.openUploadedMatch({href:"https://example.com/playaram-match.html?gameId=123"});
  assert.match(f.window.location.href, /gameId=123/);
  assert.ok(f.window.sessionStorage.getItem("playaram-match-current"));
});
test("handoff errors close blank tab instead of leaving a blank window", async () => {
  const f = fixture();
  f.child.sessionStorage.setItem = () => { throw Error("Storage denied"); };
  await assert.rejects(f.context.openUploadedMatch({href:"https://example.com/?gameId=123"}), /Storage denied/);
  assert.equal(f.child.closed, true);
});
test("detail rejects a different match and supports legacy payloads", () => {
  const sessionStorage=store(), localStorage=store();
  sessionStorage.setItem("playaram-match-current", JSON.stringify({summary:{gameId:999},overview:{}}));
  const ctx=vm.createContext({gameId:"123",sessionStorage,localStorage});
  vm.runInContext(readCode,ctx);
  assert.throws(() => ctx.readMatchPayload(), /開き直して/);
  localStorage.setItem("playaram-match:123", JSON.stringify({summary:{gameId:123},overview:{}}));
  assert.equal(ctx.readMatchPayload().summary.gameId,123);
});
