"use strict";

const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const target = path.join(root, "public", "data");
fs.mkdirSync(target, { recursive: true });
fs.copyFileSync(path.join(root, "data", "playaram-dictionary.json"), path.join(target, "playaram-dictionary.json"));
for (const file of ["champions.json", "champions.meta.json"]) {
  if (!fs.existsSync(path.join(target, file))) throw new Error(`Missing static asset: public/data/${file}`);
}
fs.writeFileSync(path.join(root, "public", ".nojekyll"), "", "utf8");
console.log("Static assets prepared in public/.");
