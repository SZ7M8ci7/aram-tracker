"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const radar = require("../public/playaram-radar");
const {groups} = require("../public/data/wiki-champion-classes.json");
const catalog = Object.values(require("../public/data/champions.json"));
test("wiki memberships, overlapping classes and percentages are respected", () => {
  const stats = radar.aggregate([{champion:"Ashe"},{champion:"Ashe"},{champion:"Zed"}], groups);
  assert.equal(stats.rows.length, 6);
  assert.equal(stats.rows.find(r => r.key === "Marksman").games, 2);
  assert.equal(stats.rows.find(r => r.key === "Support").games, 2);
  assert.equal(stats.rows.find(r => r.key === "Assassin").games, 1);
  assert.ok(Math.abs(stats.rows.find(r => r.key === "Marksman").rate - 200/3) < 1e-10);
});
test("wiki name aliases and Japanese champion names resolve", () => {
  for (const champion of ["MonkeyKing", "Nunu", "Renata", "Chogath", "FiddleSticks", "アッシュ"]) {
    assert.equal(radar.aggregate([{champion}],groups,catalog).unknown,0,champion);
  }
});
test("all locally known champions are covered by the supplied wiki snapshot", () => {
  for (const champion of catalog.filter(c => !c.id.startsWith("Jade_"))) {
    assert.equal(radar.aggregate([{champion:champion.id}],groups,catalog).unknown,0,champion.id);
  }
});
test("empty and unknown matches are safe; chart has six vertices and accessible labels", () => {
  const empty = radar.aggregate([],groups);
  assert.ok(empty.rows.every(r=>r.rate===0));
  assert.equal(radar.aggregate([{champion:"FutureChampion"}],groups).unknown,1);
  const svg = radar.svg(empty);
  assert.doesNotMatch(svg,/NaN|Infinity/);
  assert.match(svg,/role="img"/);
  assert.equal((svg.match(/<circle /g)||[]).length,6);
});
