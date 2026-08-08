"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { buildStatsFromData, parseRelativeTime } = require("../server");
const data = JSON.parse(fs.readFileSync("test/fixtures/sample-playaram.json", "utf8"));

test("relative time is converted against an anchor", () => {
  const anchor = Date.parse("2026-08-08T10:00:00.000Z");
  assert.equal(parseRelativeTime("2h ago", anchor).toISOString(), "2026-08-08T08:00:00.000Z");
});

test("stats are built from the saved JSON", async () => {
  const stats = await buildStatsFromData(data, { map: "mayhem", minGames: "0", minWinRate: "0" });
  assert.equal(stats.summary.totalGames, 2);
  assert.ok(stats.champions.length > 0);
  assert.ok(stats.items.length > 0);
  assert.ok(stats.augments.length > 0);
  assert.ok(stats.augments.every((augment) => augment.games > 0 && augment.acquisitionRate > 0));
  assert.ok(stats.matches.every((match) => match.map.includes("Mayhem")));
});
