"use strict";

const fs = require("node:fs");
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../public/playaram-core");
const data = JSON.parse(fs.readFileSync("test/fixtures/sample-playaram.json", "utf8"));
const champions = JSON.parse(fs.readFileSync("public/data/champions.json", "utf8"));

test("static browser core builds the complete Mayhem dashboard", () => {
  const stats = core.buildStatsFromData(data, { map: "mayhem" }, { champions });
  assert.equal(stats.summary.totalGames, 2);
  assert.equal(stats.summary.wins, 1);
  assert.equal(stats.summary.losses, 1);
  assert.ok(stats.champions.length > 0);
  assert.ok(stats.items.length > 0);
  assert.ok(stats.augments.length > 0);
});

test("static browser core restores match Overview", () => {
  const match = core.getMatchFromData(data, data.summaries.find((entry) => data.details.some((detail) => Number(detail.gameId) === Number(entry.gameId)))?.gameId);
  assert.ok(match?.overview?.teams?.length);
});
