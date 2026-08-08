"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dictionaryPath = path.join(root, "data", "playaram-dictionary.json");

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(response.status + " " + url);
  return response.json();
}

async function main() {
  const dictionary = JSON.parse(await fs.readFile(dictionaryPath, "utf8"));
  const version = dictionary.version;
  const languages = await getJson("https://ddragon.leagueoflegends.com/cdn/languages.json");
  const localeData = await Promise.all(languages.map(async (locale) => {
    const url = "https://ddragon.leagueoflegends.com/cdn/" + version + "/data/" + locale + "/item.json";
    const payload = await getJson(url);
    return [locale, payload.data || {}];
  }));
  const japanese = localeData.find(([locale]) => locale === "ja_JP");
  const english = localeData.find(([locale]) => locale === "en_US");
  const japaneseItems = Object.fromEntries(Object.entries(japanese ? japanese[1] : {}).map(([id, item]) => [id, item.name]));
  const englishItems = Object.fromEntries(Object.entries(english ? english[1] : {}).map(([id, item]) => [id, item.name]));
  let added = 0;
  for (const [, items] of localeData) {
    for (const [id, item] of Object.entries(items)) {
      const name = String(item.name || "").trim();
      if (!name || dictionary.items[name]) continue;
      dictionary.items[name] = { ja: japaneseItems[id] || name, en: englishItems[id] || name, id };
      added += 1;
    }
  }
  for (const item of Object.values(dictionary.items)) {
    if (!item?.id) continue;
    item.ja = japaneseItems[item.id] || item.ja;
    item.en = englishItems[item.id] || item.en || item.ja;
  }
  const orderedItems = Object.fromEntries(Object.entries(dictionary.items).sort(([a], [b]) => a.localeCompare(b, "en")));
  await fs.writeFile(dictionaryPath, JSON.stringify({ ...dictionary, items: orderedItems }, null, 2) + "\n", "utf8");
  console.log("Added " + added + " localized item aliases from " + languages.length + " locales.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
