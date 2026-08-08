"use strict";

const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const target = path.join(root, "public", "data");
fs.mkdirSync(target, { recursive: true });
for (const file of ["playaram-dictionary.json", "champions.json", "champions.meta.json"]) fs.copyFileSync(path.join(root, "data", file), path.join(target, file));
fs.writeFileSync(path.join(root, "public", ".nojekyll"), "", "utf8");
console.log("Static assets prepared in public/.");
