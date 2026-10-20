"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const remote = require("../public/playaram-remote");
const source = fs.readFileSync(require("node:path").join(__dirname, "../public/playaram.js"), "utf8");
const init = source.slice(source.indexOf("async function initialize()"), source.indexOf("assetsReady.catch"));
function fixture(search) {
  const elements = new Map(), calls = [], state = {};
  const $ = id => {
    if (!elements.has(id)) elements.set(id, {
      classList: { add() {}, remove() {} }, events: {},
      addEventListener(type, fn) { this.events[type] = fn; },
      replaceChildren(...options) { this.value = options[0]?.value || ""; this.selectedOptions = options.slice(0, 1); }
    });
    return elements.get(id);
  };
  const context = vm.createContext({ $, state, location: { search }, window: { PlayaramConfig: { gasEndpoint: "configured" } },
    Option: function(text, value) { this.textContent = text; this.value = value; },
    PlayaramRemote: { parseSource: remote.parseSource, request: async (endpoint, p) => { calls.push(p); return p.action === "list" ? { files: [{ id: "file123", name: "test.json" }] } : { data: { matches: [] } }; } },
    PlayaramCore: { validateData: data => data }, assetsReady: Promise.resolve(), uploadGeneration: 0,
    load: async () => { state.rendered = true; }
  });
  vm.runInContext(init, context);
  return { context, calls, $, state };
}
test("opening shared page lists only; clicking load reads selected JSON; refreshing lists only", async () => {
  const f = fixture("?src=" + encodeURIComponent("https://drive.google.com/drive/folders/abcdefghij123"));
  await f.context.initialize();
  assert.deepEqual(f.calls.map(p => p.action), ["list"]);
  assert.equal(f.state.rendered, undefined);
  await f.$("remoteLoad").events.click();
  assert.deepEqual(f.calls.map(p => p.action), ["list", "read"]);
  assert.equal(f.calls[1].fileId, "file123");
  assert.equal(f.state.rendered, true);
  assert.equal(f.$("remoteLoad").disabled, false);
  await f.$("remoteRefresh").events.click();
  assert.deepEqual(f.calls.map(p => p.action), ["list", "read", "list"]);
});
test("ordinary page never requests GAS", async () => {
  const f = fixture("");
  await f.context.initialize();
  assert.equal(f.calls.length, 0);
});
