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
  const html = fetchPublic_("https://drive.google.com/drive/folders/" + folderId).getContentText("UTF-8");
  const entries = parsePublicFiles_(html).filter(file => p.kind === "folder" || file.id === p.sourceId);
  if (p.action === "list") return { ok: true, files: entries };
  const selected = entries.find(file => file.id === p.fileId);
  if (!selected) throw new Error("File not found in public folder");
  const response = fetchPublic_("https://drive.google.com/uc?export=download&id=" + encodeURIComponent(selected.id));
  if (response.getContent().length > 25 * 1024 * 1024) throw new Error("File too large");
  const data = JSON.parse(response.getContentText("UTF-8").replace(/^\uFEFF/, ""));
  return { ok: true, data };
}

function fetchPublic_(url) {
  const response = UrlFetchApp.fetch(url, { followRedirects: true, muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error("Public download failed");
  return response;
}

function parsePublicFiles_(html) {
  const files = new Map();
  const tags = html.match(/<[^>]+\bdata-id="[A-Za-z0-9_-]+"[^>]*>/g) || [];
  for (const tag of tags) {
    const id = tag.match(/\bdata-id="([A-Za-z0-9_-]{10,200})"/)?.[1];
    const title = tag.match(/\bdata-tooltip="([^"]*)"/)?.[1];
    if (!id || !title) continue;
    const decoded = title.replace(/&#(x[0-9a-f]+|[0-9]+);|&(quot|amp|lt|gt|apos);/gi, (all, num, named) => num ? String.fromCodePoint(num[0].toLowerCase() === "x" ? parseInt(num.slice(1), 16) : Number(num)) : ({ quot: '"', amp: '&', lt: '<', gt: '>', apos: "'" })[named.toLowerCase()]);
    const name = decoded.match(/^(.*\.json)(?:\s|$)/i)?.[1];
    if (name && !/^index\.json$/i.test(name)) files.set(id, { id, name });
  }
  // ログイン画面やHTMLの構造変更を「空の一覧」として黙って扱わない。
  if (!files.size) throw new Error("No public JSON files found");
  return Array.from(files.values()).sort((a, b) => a.name.localeCompare(b.name, "ja"));
}
