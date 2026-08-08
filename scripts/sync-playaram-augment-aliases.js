"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dictionaryPath = path.join(root, "data", "playaram-dictionary.json");
const version = "16.15";
const baseUrl = "https://raw.communitydragon.org/" + version + "/plugins/rcp-be-lol-game-data/global/";
const locales = ["default", "ja_jp", "vi_vn", "en_gb", "cs_cz", "de_de", "el_gr", "es_ar", "es_es", "es_mx", "fr_fr", "hu_hu", "it_it", "ko_kr", "pl_pl", "pt_br", "ro_ro", "ru_ru", "th_th", "tr_tr", "zh_cn", "zh_my", "zh_tw"];

async function fetchLocale(locale) {
  const response = await fetch(baseUrl + locale + "/v1/cherry-augments.json");
  if (!response.ok) throw new Error(response.status + " while loading " + locale);
  return [locale, await response.json()];
}

function names(row) {
  return [row.nameTRA, row.simpleNameTRA].map((value) => String(value || "").trim()).filter(Boolean);
}

async function main() {
  const dictionary = JSON.parse(await fs.readFile(dictionaryPath, "utf8"));
  const localized = await Promise.all(locales.map(fetchLocale));
  const japaneseRows = localized.find(([locale]) => locale === "ja_jp")[1];
  const englishRows = localized.find(([locale]) => locale === "default")[1];
  const japaneseByStableKey = new Map();
  for (const row of japaneseRows) {
    const key = String(row.augmentNameId || "");
    const japanese = names(row)[0];
    if (!key || !japanese) continue;
    const previous = japaneseByStableKey.get(key);
    if (previous && previous !== japanese) throw new Error("Conflicting Japanese names for " + key);
    japaneseByStableKey.set(key, japanese);
  }

  const candidates = new Map();
  for (const [, rows] of localized) {
    for (const row of rows) {
      const stableKey = String(row.augmentNameId || "");
      const japanese = japaneseByStableKey.get(stableKey);
      if (!japanese) continue;
      for (const name of names(row)) {
        if (!candidates.has(name)) candidates.set(name, new Map());
        candidates.get(name).set(stableKey, japanese);
      }
    }
  }

  const augments = {};
  const augmentEnglish = {};
  const ambiguous = [];
  for (const [name, choices] of candidates) {
    const aramTranslations = new Set([...choices].filter(([stableKey]) => stableKey.startsWith("ARAM_")).map(([, japanese]) => japanese));
    const allTranslations = new Set(choices.values());
    if (aramTranslations.size === 1) { augments[name] = [...aramTranslations][0]; continue; }
    if (allTranslations.size === 1) { augments[name] = [...allTranslations][0]; continue; }
    ambiguous.push({ name, translations: [...allTranslations] });
  }
  const englishByStableKey = new Map(englishRows.map((row) => [String(row.augmentNameId || ""), names(row)[0]]));
  for (const [stableKey, japanese] of japaneseByStableKey) {
    const english = englishByStableKey.get(stableKey);
    if (!english) continue;
    if (!augmentEnglish[japanese] || stableKey.startsWith("ARAM_")) augmentEnglish[japanese] = english;
  }
  dictionary.augments = Object.fromEntries(Object.entries(augments).sort(([a], [b]) => a.localeCompare(b, "en")));
  dictionary.augmentEnglish = Object.fromEntries(Object.entries(augmentEnglish).sort(([a], [b]) => a.localeCompare(b, "ja")));
  await fs.writeFile(dictionaryPath, JSON.stringify(dictionary, null, 2) + "\n", "utf8");
  const summaryOnly = process.argv.includes("--summary");
  console.log(JSON.stringify({ version, locales: localized.length, aliases: Object.keys(augments).length, stableKeys: japaneseByStableKey.size, ambiguous: summaryOnly ? ambiguous.length : ambiguous }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
