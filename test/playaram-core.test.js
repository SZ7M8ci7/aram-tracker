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

test("100-match moving win rate starts at the 100th match", () => {
  const matches = Array.from({ length: 105 }, (_, index) => ({ victory: index >= 100 }));
  const series = core.calculateWinRateSeries(matches, 100);

  assert.equal(series[98].movingRate, null);
  assert.equal(series[99].movingRate, 0);
  assert.equal(series[100].movingRate, 1);
  assert.equal(series[104].movingRate, 5);
  assert.equal(series[104].cumulativeRate, 5 / 105 * 100);
});

test("date range recalculates every dashboard statistic", () => {
  const rangedData = structuredClone(data);
  rangedData.summaries[0].relativeTime = "1d ago";
  rangedData.summaries[1].relativeTime = "2d ago";
  const stats = core.buildStatsFromData(rangedData, { map: "mayhem", from: "2026-08-07", to: "2026-08-07" }, { champions });

  assert.deepEqual(stats.summary, {
    totalGames: 1,
    wins: 1,
    losses: 0,
    winRate: 100,
    detailedGames: 1,
    uniqueChampions: 1,
    approximateDates: true,
  });
  assert.equal(stats.champions.length, 1);
  assert.equal(stats.champions[0].champion, "Jinx");
  assert.equal(stats.champions[0].avgKills, 10);
  assert.equal(stats.champions[0].avgDeaths, 5);
  assert.equal(stats.champions[0].avgAssists, 20);
  assert.equal(stats.champions[0].avgDpm, 40000 * 60 / 930);
  assert.equal(stats.champions[0].avgGpm, 15000 * 60 / 930);
  assert.deepEqual(stats.items.map((row) => row.item), ["Infinity Edge"]);
  assert.deepEqual(stats.augments.map((row) => row.augment), ["Critical Missile"]);
  assert.deepEqual(stats.matches.map((row) => row.gameId), [1]);
  assert.deepEqual(stats.recent.map((row) => row.gameId), [1]);
  assert.deepEqual(stats.maps, { mayhem: 1, aram: 0, all: 1 });
});
