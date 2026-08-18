"use strict";

(function expose(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PlayaramCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCore() {
  function normalizeName(value) { return String(value || "").normalize("NFKC").toLocaleLowerCase("ja").replace(/[\s#_\-]/g, ""); }
  function focusName(data) { return data?.profile?.name || String(data?.profile?.riotId || "アップロードユーザー").split("#")[0]; }
  function parseRelativeTime(value, anchor) { const match = String(value || "").toLowerCase().match(/(\d+)\s*(mo|w|d|h|m)\s*ago/); if (!match) return new Date(anchor); const units = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000, mo: 2_592_000_000 }; return new Date(anchor - Number(match[1]) * units[match[2]]); }
  function mapMatches(summary, mapFilter) { if (mapFilter === "all") return true; if (mapFilter === "aram") return summary.map === "ARAM"; return String(summary.map || "").includes("Mayhem"); }
  function playerFromOverview(detail, playerName) { return (detail?.overview?.teams || []).flatMap((team) => team.players || []).find((player) => normalizeName(player.name) === normalizeName(playerName)) || null; }
  function opponentChampionsFromOverview(detail, playerName) {
    const teams = detail?.overview?.teams || [];
    const ownTeamIndex = teams.findIndex((team) => (team.players || []).some((player) => normalizeName(player.name) === normalizeName(playerName)));
    if (ownTeamIndex < 0) return [];
    return [...new Set(teams.filter((_, index) => index !== ownTeamIndex).flatMap((team) => (team.players || []).map((player) => player.champion).filter(Boolean)))];
  }
  function parseDuration(value) { const match = String(value || "").match(/(\d+)m\s*(\d+)s/i); return match ? Number(match[1]) * 60 + Number(match[2]) : null; }
  function entryFromSummary(summary, detail, index, anchor, playerName) {
    if (summary.playedAt) anchor = Date.parse(summary.playedAt) - parseRelativeTime(summary.relativeTime, 0).getTime();
    const focus = playerFromOverview(detail, playerName);
    const ownTeam = (summary.teams || []).find((team) => team.some((name) => normalizeName(name) === normalizeName(playerName))) || [];
    const kills = Number(focus?.kills ?? summary.kills ?? 0), deaths = Number(focus?.deaths ?? summary.deaths ?? 0), assists = Number(focus?.assists ?? summary.assists ?? 0);
    return { gameId: Number(summary.gameId), map: summary.map || "ARAM: Mayhem", result: summary.result || (summary.resultCode === "win" ? "Victory" : "Defeat"), victory: summary.resultCode === "win" || summary.result === "Victory", relativeTime: summary.relativeTime || null, playedAt: parseRelativeTime(summary.relativeTime, anchor).toISOString(), dateApproximate: true, durationText: summary.durationText || null, durationSeconds: parseDuration(summary.durationText), champion: summary.champion || focus?.champion || "Unknown", level: Number(summary.level || focus?.level || 0) || null, spells: summary.spells || focus?.spells || [], augments: summary.augments || focus?.augments || [], items: [...new Set(summary.items || focus?.items || [])], kills, deaths, assists, kdaRatio: focus?.kda == null ? (kills + assists) / Math.max(1, deaths) : Number(focus.kda), damageDealt: focus?.damageDealt ?? null, damageTaken: focus?.damageTaken ?? null, gold: focus?.gold ?? null, cs: focus?.cs ?? summary.cs ?? null, badges: summary.badges || [], teammates: [...new Set(ownTeam.filter((name) => normalizeName(name) !== normalizeName(playerName)))], opponentChampions: opponentChampionsFromOverview(detail, playerName), teams: summary.teams || [], detailed: Boolean(focus), order: index };
  }
  function calculateWinRateSeries(matches, windowSize = 100) {
    const size = Math.max(1, Math.floor(Number(windowSize) || 100));
    let cumulativeWins = 0;
    let windowWins = 0;
    return matches.map((match, index) => {
      const win = match.victory ? 1 : 0;
      cumulativeWins += win;
      windowWins += win;
      if (index >= size) windowWins -= matches[index - size].victory ? 1 : 0;
      return {
        cumulativeRate: cumulativeWins / (index + 1) * 100,
        movingRate: index + 1 >= size ? windowWins / size * 100 : null,
      };
    });
  }
  function validateData(value) { if (!Array.isArray(value?.summaries) || !Array.isArray(value?.details)) throw new Error("summaries と details を含むJSONを選択してください。"); return value; }
  function buildStatsFromData(input, query = {}, catalog = { champions: {} }) {
    const data = validateData(input), details = new Map(data.details.map((detail) => [Number(detail.gameId), detail])), anchor = Date.parse(data.fetchedAt || new Date().toISOString()), playerName = focusName(data);
    const filters = { map: ["mayhem", "aram", "all"].includes(query.map) ? query.map : "mayhem", from: query.from || null, to: query.to || null };
    const from = filters.from ? new Date(filters.from + "T00:00:00+09:00").getTime() : null, to = filters.to ? new Date(filters.to + "T23:59:59+09:00").getTime() : null;
    const allEntries = data.summaries.map((summary, index) => entryFromSummary(summary, details.get(Number(summary.gameId)), index, anchor, playerName));
    const periodEntries = allEntries.filter((entry) => { const time = Date.parse(entry.playedAt); return (from == null || time >= from) && (to == null || time <= to); });
    const entries = periodEntries.filter((entry) => mapMatches(entry, filters.map));
    const minGames = Math.max(0, Number(query.minGames || 0)), minWinRate = Math.min(100, Math.max(0, Number(query.minWinRate || 0)));
    const champions = new Map(), items = new Map(), augments = new Map(), teammates = new Map(), opponents = new Map();
    for (const entry of entries) {
      const champion = champions.get(entry.champion) || { champion: entry.champion, games: 0, wins: 0, losses: 0, detailedGames: 0, kills: 0, deaths: 0, assists: 0, damageDealt: 0, damageTaken: 0, gold: 0, cs: 0, dpmTotal: 0, dpmGames: 0, gpmTotal: 0, gpmGames: 0, duration: 0, durationGames: 0, lastOrder: entry.order, lastPlayed: entry.relativeTime };
      champion.games++; champion.wins += entry.victory ? 1 : 0; champion.losses += entry.victory ? 0 : 1;
      if (entry.order < champion.lastOrder) { champion.lastOrder = entry.order; champion.lastPlayed = entry.relativeTime; }
      if (entry.detailed) { champion.detailedGames++; champion.kills += entry.kills; champion.deaths += entry.deaths; champion.assists += entry.assists; champion.damageDealt += entry.damageDealt || 0; champion.damageTaken += entry.damageTaken || 0; champion.gold += entry.gold || 0; champion.cs += entry.cs || 0; if (entry.durationSeconds > 0 && entry.damageDealt != null) { champion.dpmTotal += entry.damageDealt * 60 / entry.durationSeconds; champion.dpmGames++; } if (entry.durationSeconds > 0 && entry.gold != null) { champion.gpmTotal += entry.gold * 60 / entry.durationSeconds; champion.gpmGames++; } }
      if (entry.durationSeconds != null) { champion.duration += entry.durationSeconds; champion.durationGames++; }
      champions.set(entry.champion, champion);
      for (const item of entry.items) { const stat = items.get(item) || { item, games: 0, wins: 0, kdaTotal: 0, kdaGames: 0 }; stat.games++; stat.wins += entry.victory ? 1 : 0; if (entry.detailed) { stat.kdaTotal += entry.kdaRatio; stat.kdaGames++; } items.set(item, stat); }
      for (const augment of new Set(entry.augments || [])) { const stat = augments.get(augment) || { augment, games: 0, wins: 0, kdaTotal: 0, kdaGames: 0 }; stat.games++; stat.wins += entry.victory ? 1 : 0; if (entry.detailed) { stat.kdaTotal += entry.kdaRatio; stat.kdaGames++; } augments.set(augment, stat); }
      for (const teammate of entry.teammates) { const stat = teammates.get(teammate) || { name: teammate, games: 0, wins: 0, losses: 0 }; stat.games++; stat.wins += entry.victory ? 1 : 0; stat.losses += entry.victory ? 0 : 1; teammates.set(teammate, stat); }
      for (const opponent of entry.opponentChampions) { const stat = opponents.get(opponent) || { champion: opponent, games: 0, wins: 0, losses: 0 }; stat.games++; stat.wins += entry.victory ? 1 : 0; stat.losses += entry.victory ? 0 : 1; opponents.set(opponent, stat); }
    }
    const championRows = [...champions.values()].map((row) => ({ ...row, usageRate: entries.length ? row.games / entries.length * 100 : 0, winRate: row.games ? row.wins / row.games * 100 : 0, avgKills: row.detailedGames ? row.kills / row.detailedGames : null, avgDeaths: row.detailedGames ? row.deaths / row.detailedGames : null, avgAssists: row.detailedGames ? row.assists / row.detailedGames : null, kdaRatio: row.detailedGames ? (row.kills + row.assists) / Math.max(.01, row.deaths) : null, avgDamageDealt: row.detailedGames ? row.damageDealt / row.detailedGames : null, avgDpm: row.dpmGames ? row.dpmTotal / row.dpmGames : null, avgDamageTaken: row.detailedGames ? row.damageTaken / row.detailedGames : null, avgGold: row.detailedGames ? row.gold / row.detailedGames : null, avgGpm: row.gpmGames ? row.gpmTotal / row.gpmGames : null, avgCs: row.detailedGames ? row.cs / row.detailedGames : null, avgDurationSeconds: row.durationGames ? row.duration / row.durationGames : null })).filter((row) => row.games >= minGames && row.winRate >= minWinRate).sort((a, b) => b.games - a.games || b.winRate - a.winRate || a.lastOrder - b.lastOrder);
    const itemRows = [...items.values()].map((row) => ({ ...row, purchaseRate: entries.length ? row.games / entries.length * 100 : 0, winRate: row.games ? row.wins / row.games * 100 : 0, avgKdaRatio: row.kdaGames ? row.kdaTotal / row.kdaGames : null })).filter((row) => row.games >= minGames && row.winRate >= minWinRate).sort((a, b) => b.games - a.games || b.winRate - a.winRate);
    const augmentRows = [...augments.values()].map((row) => ({ ...row, acquisitionRate: entries.length ? row.games / entries.length * 100 : 0, winRate: row.games ? row.wins / row.games * 100 : 0, avgKdaRatio: row.kdaGames ? row.kdaTotal / row.kdaGames : null })).filter((row) => row.games >= minGames && row.winRate >= minWinRate).sort((a, b) => b.games - a.games || b.winRate - a.winRate);
    const teammateRows = [...teammates.values()].filter((row) => row.games >= 10).map((row) => ({ ...row, winRate: row.wins / row.games * 100 })).filter((row) => row.games >= minGames && row.winRate >= minWinRate).sort((a, b) => b.games - a.games || b.winRate - a.winRate);
    const opponentRows = [...opponents.values()].map((row) => ({ ...row, winRate: row.games ? row.wins / row.games * 100 : 0 })).filter((row) => row.games >= minGames && row.winRate >= minWinRate).sort((a, b) => b.games - a.games || b.winRate - a.winRate || a.champion.localeCompare(b.champion));
    const played = new Set(entries.map((entry) => normalizeName(entry.champion))), unusedChampions = Object.values(catalog.champions || {}).filter((champion) => !/^Jade_/i.test(champion.id) && !played.has(normalizeName(champion.id))).map((champion) => ({ id: champion.id, name: champion.name, key: champion.id })), wins = entries.filter((entry) => entry.victory).length;
    return { profile: data.profile, source: data.source, fetchedAt: data.fetchedAt, filters, summary: { totalGames: entries.length, wins, losses: entries.length - wins, winRate: entries.length ? wins / entries.length * 100 : 0, detailedGames: entries.filter((entry) => entry.detailed).length, uniqueChampions: championRows.length, approximateDates: true }, champions: championRows, items: itemRows, augments: augmentRows, teammates: teammateRows, opponents: opponentRows, unusedChampions, matches: entries, recent: entries.slice(0, 60), maps: { mayhem: periodEntries.filter((entry) => mapMatches(entry, "mayhem")).length, aram: periodEntries.filter((entry) => mapMatches(entry, "aram")).length, all: periodEntries.length } };
  }
  function getMatchFromData(input, gameId) { const data = validateData(input), index = data.summaries.findIndex((summary) => Number(summary.gameId) === Number(gameId)); if (index < 0) return null; const detail = data.details.find((entry) => Number(entry.gameId) === Number(gameId)); if (!detail?.overview) return null; return { summary: entryFromSummary(data.summaries[index], detail, index, Date.parse(data.fetchedAt || new Date().toISOString()), focusName(data)), overview: detail.overview, profile: data.profile }; }
  return { buildStatsFromData, calculateWinRateSeries, getMatchFromData, parseRelativeTime, validateData };
});
