"use strict";

const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 41731);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const PLAYARAM_PROFILE_DIR = path.join(DATA_DIR, "playaram-profiles");
const PLAYARAM_PATH = path.join(PLAYARAM_PROFILE_DIR, "playaram-local.json");
const PLAYARAM_MANIFEST_PATH = path.join(PLAYARAM_PROFILE_DIR, "index.json");
const DICTIONARY_PATH = path.join(DATA_DIR, "playaram-dictionary.json");
const CHAMPIONS_PATH = path.join(PUBLIC_DIR, "data", "champions.json");
const CHAMPIONS_META_PATH = path.join(PUBLIC_DIR, "data", "champions.meta.json");

const cache = {
  dataset: null,
  datasetMtime: 0,
  dictionary: null,
  dictionaryMtime: 0,
  champions: null,
  championsMtime: 0,
  datasets: new Map(),
};

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function readCached(filePath, key, fallback) {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
  if (cache[key] && cache[`${key}Mtime`] === stat.mtimeMs) return cache[key];
  cache[key] = await readJson(filePath, fallback);
  cache[`${key}Mtime`] = stat.mtimeMs;
  return cache[key];
}

async function profileRegistry() {
  const manifest = await readJson(PLAYARAM_MANIFEST_PATH, { profiles: [] });
  const profiles = [{
    key: "local", filePath: PLAYARAM_PATH, file: "playaram-local.json",
    riotId: "local#JSON", name: "local", partyCount: null, status: "complete",
  }, ...(manifest.profiles || []).map((profile) => ({
    ...profile,
    key: path.basename(profile.file, ".json").replace(/^playaram-/, ""),
    filePath: path.join(PLAYARAM_PROFILE_DIR, profile.file),
  }))];
  return { manifest, profiles };
}

async function loadDataset(profileKey = "local") {
  const { profiles } = await profileRegistry();
  const selected = profiles.find((profile) => profile.key === profileKey) || profiles[0];
  let stat;
  try { stat = await fs.stat(selected.filePath); }
  catch (error) { if (error.code === "ENOENT") throw new Error(`${selected.file} が見つかりません。`); throw error; }
  let value = cache.datasets.get(selected.filePath);
  if (!value || value.mtime !== stat.mtimeMs) {
    value = { mtime: stat.mtimeMs, data: await readJson(selected.filePath, null) };
    cache.datasets.set(selected.filePath, value);
  }
  value = value.data;
  if (!value) throw new Error(`${selected.file} を読み込めません。`);
  return { ...value, summaries: Array.isArray(value.summaries) ? value.summaries : [], details: Array.isArray(value.details) ? value.details : [] };
}

async function readRequestJson(req, maxBytes = 50 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("JSONファイルが大きすぎます（上限50MB）。");
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!Array.isArray(value?.summaries) || !Array.isArray(value?.details)) throw new Error("summaries と details を含むJSONを選択してください。");
  return { ...value, summaries: value.summaries, details: value.details };
}

async function loadDictionary() {
  return readCached(DICTIONARY_PATH, "dictionary", { version: null, items: {}, augments: {} });
}

async function loadChampions() {
  const champions = await readCached(CHAMPIONS_PATH, "champions", {});
  const meta = await readJson(CHAMPIONS_META_PATH, {});
  return { champions: champions || {}, version: meta?.version || null };
}

function normalizeName(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("ja").replace(/[\s#_\-]/g, "");
}

function focusName(data) {
  return data?.profile?.name || String(data?.profile?.riotId || "アップロードユーザー").split("#")[0];
}

function parseRelativeTime(value, anchor) {
  const source = String(value || "").toLowerCase();
  const match = source.match(/(\d+)\s*(mo|w|d|h|m)\s*ago/);
  if (!match) return new Date(anchor);
  const amount = Number(match[1]);
  const units = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000, mo: 2_592_000_000 };
  return new Date(anchor - amount * units[match[2]]);
}

function mapMatches(summary, mapFilter) {
  if (mapFilter === "all") return true;
  if (mapFilter === "aram") return summary.map === "ARAM";
  return String(summary.map || "").includes("Mayhem");
}

function playerFromOverview(detail, playerName) {
  const players = (detail?.overview?.teams || []).flatMap((team) => team.players || []);
  return players.find((player) => normalizeName(player.name) === normalizeName(playerName)) || null;
}

function parseDuration(value) {
  const match = String(value || "").match(/(\d+)m\s*(\d+)s/i);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function entryFromSummary(summary, detail, index, anchor, playerName) {
  const focus = playerFromOverview(detail, playerName);
  const ownTeam = (summary.teams || []).find((team) => team.some((name) => normalizeName(name) === normalizeName(playerName))) || [];
  const teammates = [...new Set(ownTeam.filter((name) => normalizeName(name) !== normalizeName(playerName)))];
  const playedAt = parseRelativeTime(summary.relativeTime, anchor);
  const kills = Number(focus?.kills ?? summary.kills ?? 0);
  const deaths = Number(focus?.deaths ?? summary.deaths ?? 0);
  const assists = Number(focus?.assists ?? summary.assists ?? 0);
  const kdaRatio = focus?.kda == null ? (kills + assists) / Math.max(1, deaths) : Number(focus.kda);
  return {
    gameId: Number(summary.gameId),
    map: summary.map || "ARAM: Mayhem",
    result: summary.result || (summary.resultCode === "win" ? "Victory" : "Defeat"),
    victory: summary.resultCode === "win" || summary.result === "Victory",
    relativeTime: summary.relativeTime || null,
    playedAt: playedAt.toISOString(),
    dateApproximate: true,
    durationText: summary.durationText || null,
    durationSeconds: parseDuration(summary.durationText),
    champion: summary.champion || focus?.champion || "Unknown",
    level: Number(summary.level || focus?.level || 0) || null,
    spells: summary.spells || focus?.spells || [],
    augments: summary.augments || focus?.augments || [],
    items: [...new Set(summary.items || focus?.items || [])],
    kills, deaths, assists, kdaRatio,
    damageDealt: focus?.damageDealt ?? null,
    damageTaken: focus?.damageTaken ?? null,
    gold: focus?.gold ?? null,
    cs: focus?.cs ?? summary.cs ?? null,
    badges: summary.badges || [],
    teammates,
    teams: summary.teams || [],
    detailed: Boolean(focus),
    order: index,
  };
}

function filterEntries(entries, filters) {
  const from = filters.from ? new Date(`${filters.from}T00:00:00+09:00`).getTime() : null;
  const to = filters.to ? new Date(`${filters.to}T23:59:59+09:00`).getTime() : null;
  return entries.filter((entry) => {
    const time = Date.parse(entry.playedAt);
    return mapMatches(entry, filters.map) && (from == null || time >= from) && (to == null || time <= to);
  });
}

function validFilter(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

async function buildStatsFromData(data, query = {}) {
  const catalog = await loadChampions();
  const details = new Map(data.details.map((detail) => [Number(detail.gameId), detail]));
  const anchor = Date.parse(data.fetchedAt || new Date().toISOString());
  const filters = {
    map: validFilter(query.map, ["mayhem", "aram", "all"], "mayhem"),
    from: query.from || null,
    to: query.to || null,
  };
  const playerName = focusName(data);
  const allEntries = data.summaries.map((summary, index) => entryFromSummary(summary, details.get(Number(summary.gameId)), index, anchor, playerName));
  const entries = filterEntries(allEntries, filters);
  const minGames = Math.max(0, Number(query.minGames || 0));
  const minWinRate = Math.min(100, Math.max(0, Number(query.minWinRate || 0)));
  const champions = new Map();
  const items = new Map();
  const augments = new Map();
  const teammates = new Map();
  for (const entry of entries) {
    const champion = champions.get(entry.champion) || { champion: entry.champion, games: 0, wins: 0, losses: 0, detailedGames: 0, kills: 0, deaths: 0, assists: 0, damageDealt: 0, damageTaken: 0, gold: 0, cs: 0, duration: 0, durationGames: 0, lastOrder: entry.order, lastPlayed: entry.relativeTime };
    champion.games += 1;
    champion.wins += entry.victory ? 1 : 0;
    champion.losses += entry.victory ? 0 : 1;
    if (entry.order < champion.lastOrder) { champion.lastOrder = entry.order; champion.lastPlayed = entry.relativeTime; }
    if (entry.detailed) {
      champion.detailedGames += 1; champion.kills += entry.kills; champion.deaths += entry.deaths; champion.assists += entry.assists;
      champion.damageDealt += entry.damageDealt || 0; champion.damageTaken += entry.damageTaken || 0; champion.gold += entry.gold || 0; champion.cs += entry.cs || 0;
    }
    if (entry.durationSeconds != null) { champion.duration += entry.durationSeconds; champion.durationGames += 1; }
    champions.set(entry.champion, champion);
    for (const item of entry.items) {
      const stat = items.get(item) || { item, games: 0, wins: 0, kdaTotal: 0, kdaGames: 0 };
      stat.games += 1; stat.wins += entry.victory ? 1 : 0;
      if (entry.detailed) { stat.kdaTotal += entry.kdaRatio; stat.kdaGames += 1; }
      items.set(item, stat);
    }
    for (const augment of new Set(entry.augments || [])) {
      const stat = augments.get(augment) || { augment, games: 0, wins: 0, kdaTotal: 0, kdaGames: 0 };
      stat.games += 1; stat.wins += entry.victory ? 1 : 0;
      if (entry.detailed) { stat.kdaTotal += entry.kdaRatio; stat.kdaGames += 1; }
      augments.set(augment, stat);
    }
    for (const teammate of entry.teammates) {
      const stat = teammates.get(teammate) || { name: teammate, games: 0, wins: 0, losses: 0 };
      stat.games += 1; stat.wins += entry.victory ? 1 : 0; stat.losses += entry.victory ? 0 : 1; teammates.set(teammate, stat);
    }
  }
  const championRows = [...champions.values()].map((row) => ({
    ...row, usageRate: entries.length ? row.games / entries.length * 100 : 0, winRate: row.games ? row.wins / row.games * 100 : 0,
    avgKills: row.detailedGames ? row.kills / row.detailedGames : null, avgDeaths: row.detailedGames ? row.deaths / row.detailedGames : null,
    avgAssists: row.detailedGames ? row.assists / row.detailedGames : null, kdaRatio: row.detailedGames ? ((row.kills / row.detailedGames) + (row.assists / row.detailedGames)) / Math.max(0.01, row.deaths / row.detailedGames) : null, avgDamageDealt: row.detailedGames ? row.damageDealt / row.detailedGames : null,
    avgDamageTaken: row.detailedGames ? row.damageTaken / row.detailedGames : null, avgGold: row.detailedGames ? row.gold / row.detailedGames : null,
    avgCs: row.detailedGames ? row.cs / row.detailedGames : null, avgDurationSeconds: row.durationGames ? row.duration / row.durationGames : null,
  })).filter((row) => row.games >= minGames && row.winRate >= minWinRate).sort((a, b) => b.games - a.games || b.winRate - a.winRate || a.lastOrder - b.lastOrder);
  const itemRows = [...items.values()].map((row) => ({ ...row, purchaseRate: entries.length ? row.games / entries.length * 100 : 0, winRate: row.games ? row.wins / row.games * 100 : 0, avgKdaRatio: row.kdaGames ? row.kdaTotal / row.kdaGames : null })).filter((row) => row.games >= minGames && row.winRate >= minWinRate).sort((a, b) => b.games - a.games || b.winRate - a.winRate);
  const augmentRows = [...augments.values()].map((row) => ({ ...row, acquisitionRate: entries.length ? row.games / entries.length * 100 : 0, winRate: row.games ? row.wins / row.games * 100 : 0, avgKdaRatio: row.kdaGames ? row.kdaTotal / row.kdaGames : null })).filter((row) => row.games >= minGames && row.winRate >= minWinRate).sort((a, b) => b.games - a.games || b.winRate - a.winRate);
  const teammateRows = [...teammates.values()].filter((row) => row.games >= 10).map((row) => ({ ...row, winRate: row.wins / row.games * 100 })).filter((row) => row.games >= minGames && row.winRate >= minWinRate).sort((a, b) => b.games - a.games || b.winRate - a.winRate);
  const played = new Set(entries.map((entry) => normalizeName(entry.champion)));
  const unusedChampions = Object.values(catalog.champions || {}).filter((champion) => !/^Jade_/i.test(champion.id) && !played.has(normalizeName(champion.id))).map((champion) => ({ id: champion.id, name: champion.name, key: champion.id }));
  const wins = entries.filter((entry) => entry.victory).length;
  return {
    profile: data.profile, source: data.source, fetchedAt: data.fetchedAt, filters,
    summary: { totalGames: entries.length, wins, losses: entries.length - wins, winRate: entries.length ? wins / entries.length * 100 : 0, detailedGames: entries.filter((entry) => entry.detailed).length, uniqueChampions: championRows.length, approximateDates: true },
    champions: championRows, items: itemRows, augments: augmentRows, teammates: teammateRows, unusedChampions, matches: entries, recent: entries.slice(0, 60),
    maps: { mayhem: data.summaries.filter((entry) => mapMatches(entry, "mayhem")).length, aram: data.summaries.filter((entry) => mapMatches(entry, "aram")).length, all: data.summaries.length },
  };
}

async function buildStats(query = {}) {
  return buildStatsFromData(await loadDataset(query.profile), query);
}

function getMatchFromData(data, gameId) {
  const index = data.summaries.findIndex((summary) => Number(summary.gameId) === Number(gameId));
  if (index < 0) return null;
  const detail = data.details.find((entry) => Number(entry.gameId) === Number(gameId));
  if (!detail?.overview) return null;
  const anchor = Date.parse(data.fetchedAt || new Date().toISOString());
  return { summary: entryFromSummary(data.summaries[index], detail, index, anchor, focusName(data)), overview: detail.overview, profile: data.profile };
}

async function getMatch(gameId, profileKey) {
  return getMatchFromData(await loadDataset(profileKey), gameId);
}

function jsonResponse(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function mimeType(filePath) {
  return { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" }[path.extname(filePath)] || "application/octet-stream";
}

async function serveStatic(req, res) {
  const rawPath = new URL(req.url, `http://${HOST}:${PORT}`).pathname;
  const relative = rawPath === "/" ? "playaram.html" : decodeURIComponent(rawPath.slice(1));
  const filePath = path.resolve(PUBLIC_DIR, relative);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) { res.writeHead(403).end("Forbidden"); return; }
  try { const body = await fs.readFile(filePath); res.writeHead(200, { "Content-Type": mimeType(filePath), "Cache-Control": "no-cache" }); res.end(body); }
  catch (error) { res.writeHead(error.code === "ENOENT" ? 404 : 500).end("Not found"); }
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (url.pathname === "/api/playaram/profiles") {
    const { profiles } = await profileRegistry();
    const rows = [];
    for (const profile of profiles) {
      try {
        const data = await loadDataset(profile.key);
        rows.push({ key: profile.key, riotId: data.profile?.riotId || profile.riotId, name: data.profile?.name || profile.name, partyCount: profile.partyCount, status: data.unavailable ? "unavailable" : data.completed === false ? "partial" : "complete", summaryCount: data.summaries.length, detailCount: data.details.length, capped: Boolean(data.capped), unavailableReason: data.unavailableReason || null });
      } catch { rows.push({ key: profile.key, riotId: profile.riotId, name: profile.name, partyCount: profile.partyCount, status: "pending", summaryCount: 0, detailCount: 0, capped: false }); }
    }
    jsonResponse(res, 200, { profiles: rows }); return;
  }
  if (url.pathname === "/api/playaram/status") {
    const data = await loadDataset(url.searchParams.get("profile")); jsonResponse(res, 200, { profile: data.profile, summaryCount: data.summaries.length, detailCount: data.details.filter((entry) => entry.overview).length, fetchedAt: data.fetchedAt, maps: { mayhem: data.summaries.filter((entry) => mapMatches(entry, "mayhem")).length, aram: data.summaries.filter((entry) => mapMatches(entry, "aram")).length, all: data.summaries.length } }); return;
  }
  if (url.pathname === "/api/playaram/stats") {
    const query = Object.fromEntries(url.searchParams);
    jsonResponse(res, 200, req.method === "POST" ? await buildStatsFromData(await readRequestJson(req), query) : await buildStats(query)); return;
  }
  if (url.pathname === "/api/playaram/matches") {
    const stats = await buildStats(Object.fromEntries(url.searchParams));
    const champion = url.searchParams.get("champion"); jsonResponse(res, 200, { matches: champion ? stats.matches.filter((entry) => entry.champion === champion) : stats.matches }); return;
  }
  if (url.pathname === "/api/playaram/match") {
    const match = req.method === "POST" ? getMatchFromData(await readRequestJson(req), url.searchParams.get("gameId")) : await getMatch(url.searchParams.get("gameId"), url.searchParams.get("profile")); if (!match) { jsonResponse(res, 404, { error: "指定試合のOverviewが見つかりません。" }); return; } jsonResponse(res, 200, match); return;
  }
  if (url.pathname === "/api/dictionary") { jsonResponse(res, 200, await loadDictionary()); return; }
  if (url.pathname === "/api/champions") { jsonResponse(res, 200, await loadChampions()); return; }
  await serveStatic(req, res);
}

async function main() {
  await loadDataset();
  const server = http.createServer((req, res) => { handleRequest(req, res).catch((error) => jsonResponse(res, 500, { error: error.message })); });
  server.listen(PORT, HOST, () => {
    const url = `http://${HOST}:${PORT}`;
    console.log(`PlayARAM Local Stats: ${url}`);
    if (process.env.NO_OPEN !== "1") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  });
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });

module.exports = { buildStats, buildStatsFromData, getMatch, getMatchFromData, loadDataset, loadDictionary, loadChampions, parseRelativeTime };
