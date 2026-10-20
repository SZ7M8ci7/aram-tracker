// 公開してよい戦績JSON専用。既存の収集用GASとは別プロジェクトに配置する。
function doGet(e) {
  const p = (e && e.parameter) || {};
  const callback = p.callback || "";
  if (callback && !/^playaram_[0-9]+_[0-9]+$/.test(callback)) {
    return ContentService.createTextOutput('{"ok":false,"error":"Invalid callback"}').setMimeType(ContentService.MimeType.JSON);
  }
  let result;
  try { result = handleRequest_(p); }
  catch (error) { result = { ok: false, error: "公開URLから取得できません。公開設定・ダウンロード制限・ファイル形式、またはDriveのページ形式変更を確認してください。" }; }
  const json = JSON.stringify(result).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return ContentService.createTextOutput(callback ? `${callback}(${json});` : json)
    .setMimeType(callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}

function handleRequest_(p) {
  if (!["list", "read"].includes(p.action)) throw new Error("Invalid action");
  const folderId = PropertiesService.getScriptProperties().getProperty("PUBLIC_FOLDER_ID");
  if (!folderId) throw new Error("Missing folder configuration");
  if (p.kind !== "folder" && p.kind !== "file") throw new Error("Invalid source");
  if (p.kind === "folder" && p.sourceId !== folderId) throw new Error("Forbidden folder");
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(folderId)) throw new Error("Invalid folder");
  // Cookie、OAuthトークン、APIキーは送らない。公開ページに見えるファイルだけが対象。
  // 読み込み時は必ず最新メタデータを確認。一覧キャッシュの古さで更新を見逃さない。
  const listing = publicListing_(folderId, p.action === "read" || p.refresh === "1");
  const entries = listing.files.filter(file => p.kind === "folder" || file.id === p.sourceId);
  if (p.action === "list") return { ok: true, files: entries, checkedAt: listing.checkedAt, cached: listing.cached };
  const selected = entries.find(file => file.id === p.fileId);
  if (!selected) throw new Error("File not found in public folder");
  if (p.refresh !== "1" && selected.version && p.knownVersion === selected.version) {
    return { ok: true, notModified: true, version: selected.version };
  }
  const response = fetchPublic_("https://drive.google.com/uc?export=download&id=" + encodeURIComponent(selected.id));
  if (response.getContent().length > 25 * 1024 * 1024) throw new Error("File too large");
  const data = JSON.parse(response.getContentText("UTF-8").replace(/^\uFEFF/, ""));
  return { ok: true, data, version: selected.version || null };
}

function publicListing_(folderId, fresh) {
  const cache = CacheService.getScriptCache(), key = "public-list-v2:" + folderId;
  if (!fresh) {
    try {
      const saved = JSON.parse(cache.get(key) || "null");
      if (saved && Array.isArray(saved.files) && Date.now() - saved.checkedAt >= 0 && Date.now() - saved.checkedAt < 60000) return { ...saved, cached: true };
    } catch (_) { /* 壊れたキャッシュは使わない */ }
  }
  const html = fetchPublic_("https://drive.google.com/drive/folders/" + folderId).getContentText("UTF-8");
  const result = { files: parsePublicFiles_(html), checkedAt: Date.now() };
  try { cache.put(key, JSON.stringify(result), 60); } catch (_) { /* キャッシュ上限でも取得は続行 */ }
  return { ...result, cached: false };
}

function fetchPublic_(url) {
  const response = UrlFetchApp.fetch(url, { followRedirects: true, muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error("Public download failed");
  return response;
}

function parsePublicFiles_(html) {
  const files = new Map();
  const versions = publicVersions_(html);
  const tags = html.match(/<[^>]+\bdata-id="[A-Za-z0-9_-]+"[^>]*>/g) || [];
  for (const tag of tags) {
    const id = tag.match(/\bdata-id="([A-Za-z0-9_-]{10,200})"/)?.[1];
    const title = tag.match(/\bdata-tooltip="([^"]*)"/)?.[1];
    if (!id || !title) continue;
    const decoded = title.replace(/&#(x[0-9a-f]+|[0-9]+);|&(quot|amp|lt|gt|apos);/gi, (all, num, named) => num ? String.fromCodePoint(num[0].toLowerCase() === "x" ? parseInt(num.slice(1), 16) : Number(num)) : ({ quot: '"', amp: '&', lt: '<', gt: '>', apos: "'" })[named.toLowerCase()]);
    const name = decoded.match(/^(.*\.json)(?:\s|$)/i)?.[1];
    if (name && !/^index\.json$/i.test(name)) files.set(id, { id, name, version: versions[id]?.name === name ? versions[id].version : null });
  }
  // ログイン画面やHTMLの構造変更を「空の一覧」として黙って扱わない。
  if (!files.size) throw new Error("No public JSON files found");
  return Array.from(files.values()).sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

function publicVersions_(html) {
  // 公開ページ内の表示用メタデータ。形式が変わった場合は再利用を無効化する。
  const versions = {};
  try {
    const encoded = html.match(/window\['_DRIVE_ivd'\]\s*=\s*'([^']*)'/)?.[1];
    if (!encoded) return versions;
    const decoded = JSON.parse('"' + encoded.replace(/\\x([0-9a-f]{2})/gi, "\\u00$1").replace(/\\'/g, "'") + '"');
    const rows = JSON.parse(decoded)[0];
    if (!Array.isArray(rows)) return versions;
    for (const row of rows) {
      if (!Array.isArray(row) || typeof row[0] !== "string" || typeof row[2] !== "string" || row[3] !== "application/json") continue;
      const stampA = row[9], stampB = row[10], size = row[13];
      if (![stampA, stampB].every(value => Number.isSafeInteger(value) && value > 1000000000000) || !Number.isSafeInteger(size) || size < 0) continue;
      versions[row[0]] = { name: row[2], version: `v1:${stampA}:${stampB}:${size}` };
    }
  } catch (_) { /* 更新情報が不明ならJSON本体を再取得 */ }
  return versions;
}
