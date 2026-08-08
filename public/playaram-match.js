"use strict";

const params = new URLSearchParams(location.search);
const gameId = params.get("gameId");
const uploadedSource = params.get("source") === "upload";
const root = document.getElementById("playaramMatchRoot");
let dictionary = { version: "16.15.1", items: {}, augments: {} };
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const number = (value) => value == null || !Number.isFinite(Number(value)) ? "—" : Math.round(Number(value)).toLocaleString("ja-JP");
const stat = (label, value) => `<div class="detail-stat"><span>${escapeHtml(label)}</span><strong>${value ?? "—"}</strong></div>`;
function itemInfo(name) { return dictionary.items?.[name] || { ja: name, id: null }; }
function itemIcon(name, size = "") { const info = itemInfo(name); const label = info.ja || name; return info.id ? `<img class="item-icon ${size}" src="https://ddragon.leagueoflegends.com/cdn/${dictionary.version || "16.15.1"}/img/item/${info.id}.png" alt="${escapeHtml(label)}" title="${escapeHtml(label)}" loading="lazy" />` : `<span class="item-icon-fallback ${size}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"></span>`; }
let focusName = "アップロードユーザー";
function normalizeName(value) { return String(value || "").normalize("NFKC").toLocaleLowerCase("ja").replace(/[\s#_\-]/g, ""); }
function playerRow(player) {
  const focus = normalizeName(player.name) === normalizeName(focusName);
  const augments = (player.augments || []).map((augment) => `<span class="playaram-augment-chip">${escapeHtml(dictionary.augments?.[augment] || `オーグメント「${augment}」`)}</span>`).join("") || "—";
  const items = (player.items || []).map((item) => `<span class="playaram-item-chip" title="${escapeHtml(itemInfo(item).ja || item)}">${itemIcon(item, "tiny")}<span>${escapeHtml(itemInfo(item).ja || item)}</span></span>`).join("") || "—";
  return `<tr class="${focus ? "is-focus" : ""}"><td><div class="overview-player"><strong>${escapeHtml(player.name || "不明")}</strong><small>${escapeHtml(player.champion || "—")} · Lv.${player.level ?? "—"}</small><small>${(player.spells || []).map(escapeHtml).join(" / ") || "—"}</small></div></td><td><div class="overview-chips">${augments}</div></td><td><strong>${player.kills ?? "—"}/${player.deaths ?? "—"}/${player.assists ?? "—"}</strong><small>${player.kda == null ? "—" : `${Number(player.kda).toFixed(2)} KDA`}</small></td><td><strong>${number(player.damageDealt)}</strong><small>与ダメージ</small><strong>${number(player.damageTaken)}</strong><small>被ダメージ</small></td><td>${number(player.gold)}</td><td>${number(player.cs)}</td><td><div class="overview-chips">${items}</div></td></tr>`;
}
function render(payload) {
  const summary = payload.summary;
  const overview = payload.overview;
  focusName = payload.profile?.name || String(payload.profile?.riotId || "アップロードユーザー").split("#")[0];
  root.innerHTML = `<section class="playaram-match-head"><div><p class="eyebrow">MATCH ${summary.gameId} · ${escapeHtml(summary.map)}</p><h1>${escapeHtml(summary.champion)}</h1><p class="subtitle">${escapeHtml(payload.profile?.riotId || "アップロードユーザー")} · ${escapeHtml(summary.relativeTime || "—")} · ${escapeHtml(summary.durationText || "—")}</p></div><span class="detail-result ${summary.victory ? "victory" : "defeat"}">${summary.victory ? "VICTORY" : "DEFEAT"}</span></section><section class="detail-grid playaram-detail-grid">${stat("K / D / A", `${summary.kills} / ${summary.deaths} / ${summary.assists}`)}${stat("KDAレシオ", summary.kdaRatio == null ? "—" : Number(summary.kdaRatio).toFixed(2))}${stat("与ダメージ", number(summary.damageDealt))}${stat("被ダメージ", number(summary.damageTaken))}${stat("ゴールド", number(summary.gold))}${stat("CS", number(summary.cs))}${stat("レベル", summary.level)}${stat("オーグメント", (summary.augments || []).length)}</section><section class="detail-build"><h2>自分のビルド</h2><div class="detail-build-icons">${(summary.items || []).map((item) => `<span title="${escapeHtml(itemInfo(item).ja || item)}">${itemIcon(item, "large")}<small>${escapeHtml(itemInfo(item).ja || item)}</small></span>`).join("") || "—"}</div></section>${(overview.teams || []).map((team) => `<section class="overview-team"><header><div><p class="eyebrow">${escapeHtml(team.side || "TEAM")}</p><h2>${escapeHtml(team.result || "—")}</h2></div><strong class="overview-kills">${team.kills ?? "—"} KILLS</strong></header><div class="table-wrap"><table class="overview-table"><thead><tr><th>プレイヤー</th><th>オーグメント</th><th>KDA</th><th>ダメージ</th><th>ゴールド</th><th>CS</th><th>アイテムビルド</th></tr></thead><tbody>${(team.players || []).map(playerRow).join("")}</tbody></table></div></section>`).join("")}`;
}
async function init() { if (!gameId) throw new Error("試合が指定されていません。"); const dictionaryResponse = await fetch("./data/playaram-dictionary.json"); if (!dictionaryResponse.ok) throw new Error("表示用辞書を読み込めませんでした。"); dictionary = await dictionaryResponse.json(); const saved = sessionStorage.getItem(`playaram-match:${gameId}`) || localStorage.getItem(`playaram-match:${gameId}`); if (!saved) throw new Error("試合データがありません。JSONファイルを選び直してください。"); render(JSON.parse(saved)); }
document.querySelector(".back-link").addEventListener("click", (event) => { if (!uploadedSource) return; event.preventDefault(); window.close(); });
init().catch((error) => { root.innerHTML = `<p class="detail-message">${escapeHtml(error.message)}</p>`; });
