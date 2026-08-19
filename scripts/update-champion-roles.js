"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const metaPath = path.join(root, "public", "data", "champions.meta.json");
const targets = [
  path.join(root, "data", "champions.json"),
  path.join(root, "public", "data", "champions.json"),
];

async function main() {
  const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
  const response = await fetch(`https://ddragon.leagueoflegends.com/cdn/${meta.version}/data/ja_JP/champion.json`);
  if (!response.ok) throw new Error(`Data Dragon: HTTP ${response.status}`);
  const payload = await response.json();
  const tagsById = new Map(Object.values(payload.data || {}).map((champion) => [champion.id, champion.tags || []]));

  for (const target of targets) {
    const catalog = JSON.parse(await fs.readFile(target, "utf8"));
    for (const champion of Object.values(catalog)) champion.roles = tagsById.get(champion.id) || [];
    await fs.writeFile(target, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  }
  console.log(`Updated roles for ${tagsById.size} champions.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
