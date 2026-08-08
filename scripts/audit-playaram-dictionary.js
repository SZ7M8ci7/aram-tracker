"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dictionary = JSON.parse(fs.readFileSync(path.join(root, "data", "playaram-dictionary.json"), "utf8"));
const requested = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const summaryOnly = process.argv.includes("--summary");
const profileDir = path.join(root, "data", "playaram-profiles");
const files = requested
  ? fs.readdirSync(profileDir).filter((file) => file.includes(requested))
  : fs.readdirSync(profileDir).filter((file) => file.endsWith(".json") && file !== "index.json");

function collect(map, value, location) {
  if (value == null || value === "") return;
  const key = typeof value === "string" ? value : JSON.stringify(value);
  const current = map.get(key) || { count: 0, locations: [] };
  current.count += 1;
  if (current.locations.length < 3) current.locations.push(location);
  map.set(key, current);
}

for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(profileDir, file), "utf8"));
  const items = new Map();
  const augments = new Map();
  for (const [index, summary] of (data.summaries || []).entries()) {
    for (const item of summary.items || []) collect(items, item, `summary:${index}`);
    for (const augment of summary.augments || []) collect(augments, augment, `summary:${index}`);
  }
  for (const [detailIndex, detail] of (data.details || []).entries()) {
    for (const [teamIndex, team] of (detail.overview?.teams || []).entries()) {
      for (const [playerIndex, player] of (team.players || []).entries()) {
        const location = `detail:${detailIndex}/team:${teamIndex}/player:${playerIndex}`;
        for (const item of player.items || []) collect(items, item, location);
        for (const augment of player.augments || []) collect(augments, augment, location);
      }
    }
  }
  const missingItems = [...items].filter(([name]) => !dictionary.items?.[name]).map(([name, value]) => ({ name, ...value })).sort((a, b) => b.count - a.count);
  const missingAugments = [...augments].filter(([name]) => !dictionary.augments?.[name]).map(([name, value]) => ({ name, ...value })).sort((a, b) => b.count - a.count);
  console.log(JSON.stringify(summaryOnly
    ? { file, missingItems: missingItems.length, missingAugments: missingAugments.length }
    : { file, profile: data.profile, missingItems, missingAugments }, null, summaryOnly ? 0 : 2));
}
