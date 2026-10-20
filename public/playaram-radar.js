(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PlayaramRadar = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const axes = [["Assassin", "アサシン"], ["Support", "サポート"], ["Tank", "タンク"], ["Fighter", "ファイター"], ["Marksman", "マークスマン"], ["Mage", "メイジ"]];
  const normalize = value => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const canonical = value => ({monkeyking:"wukong", nunu:"nunuwillump", renata:"renataglasc"}[normalize(value)] || normalize(value));
  function aggregate(matches, groups, catalog = []) {
    const index = new Map();
    for (const [key] of axes) for (const name of groups[key] || []) {
      const id = canonical(name);
      if (!index.has(id)) index.set(id, new Set());
      index.get(id).add(key);
    }
    const counts = Object.fromEntries(axes.map(([key]) => [key, 0]));
    let unknown = 0;
    for (const match of matches) {
      const champion = catalog.find(c => c.name === match.champion || normalize(c.id) === normalize(match.champion));
      const roles = index.get(canonical(champion?.id || match.champion));
      if (!roles) { unknown++; continue; }
      for (const role of roles) counts[role]++;
    }
    return { total: matches.length, unknown, rows: axes.map(([key, label]) => ({key, label, games: counts[key], rate: matches.length ? counts[key] / matches.length * 100 : 0})) };
  }
  function svg(stats) {
    const ceiling = Math.max(20, Math.ceil(Math.max(...stats.rows.map(row => row.rate)) / 20) * 20);
    const point = (i, r) => [300 + Math.cos(-Math.PI / 2 + i * Math.PI / 3) * r, 205 + Math.sin(-Math.PI / 2 + i * Math.PI / 3) * r];
    const polygon = radius => axes.map((_, i) => point(i, radius).join(",")).join(" ");
    const grid = [1,2,3,4,5].map(n => `<polygon points="${polygon(140*n/5)}" fill="none" stroke="#34445b"/><text x="306" y="${205-140*n/5+12}" fill="#8b9bb3" font-size="11">${ceiling*n/5}%</text>`).join("");
    const spokes = axes.map((_, i) => `<line x1="300" y1="205" x2="${point(i,140)[0]}" y2="${point(i,140)[1]}" stroke="#34445b"/>`).join("");
    const labels = stats.rows.map((row,i) => { const [x,y]=point(i,182); return `<text x="${x}" y="${y}" text-anchor="middle" fill="#e4ecf7" font-size="15">${row.label}<tspan x="${x}" dy="21" fill="#91deda" font-size="13">${row.rate.toFixed(1)}% · ${row.games}試合</tspan></text>`; }).join("");
    const points = stats.rows.map((row,i) => point(i,140*row.rate/ceiling));
    return `<svg viewBox="0 0 600 420" role="img" aria-labelledby="radarTitle radarDescription"><title id="radarTitle">クラス別使用傾向</title><desc id="radarDescription">${stats.rows.map(row => `${row.label} ${row.games}試合 ${row.rate.toFixed(1)}%`).join("、")}</desc>${grid}${spokes}<polygon points="${points.map(p=>p.join(",")).join(" ")}" fill="#53cfc83d" stroke="#53cfc8" stroke-width="3"/>${points.map(([x,y])=>`<circle cx="${x}" cy="${y}" r="4" fill="#93eee8"/>`).join("")}${labels}</svg>`;
  }
  return {aggregate, svg};
});
