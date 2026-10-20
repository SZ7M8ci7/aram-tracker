(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PlayaramRemote = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function parseSource(search) {
    const params = new URLSearchParams(search);
    const input = params.get("drive") || params.get("src");
    if (!input) return null;
    let url;
    try { url = new URL(input); } catch { throw new Error("Google Driveの共有URLを指定してください。"); }
    if (url.protocol !== "https:" || url.hostname !== "drive.google.com" || url.username || url.password || url.port) throw new Error("読み込み元にはGoogle DriveのHTTPS共有URLを指定してください。");
    const folder = url.pathname.match(/\/folders\/([A-Za-z0-9_-]+)/);
    const file = url.pathname.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
    const id = folder?.[1] || file?.[1] || url.searchParams.get("id");
    if (!id || !/^[A-Za-z0-9_-]{10,200}$/.test(id)) throw new Error("Google Driveのファイルまたはフォルダー共有URLを指定してください。");
    const kind = folder ? "folder" : "file";
    const view = new URL(kind === "folder" ? `https://drive.google.com/drive/folders/${id}` : `https://drive.google.com/file/d/${id}/view`);
    const resourceKey = url.searchParams.get("resourcekey");
    if (resourceKey) view.searchParams.set("resourcekey", resourceKey);
    return { kind, viewUrl: view.href };
  }
  return { parseSource };
});
