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
    return { kind, id, viewUrl: view.href };
  }
  function endpointUrl(endpoint) {
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint || "")) throw new Error("管理者によるGAS公開URLの設定が必要です。");
    return new URL(endpoint);
  }
  let sequence = 0;
  function request(endpoint, params, env = globalThis, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const url = endpointUrl(endpoint);
      const callback = `playaram_${Date.now()}_${++sequence}`;
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      url.searchParams.set("callback", callback);
      const script = env.document.createElement("script");
      // Googleへのログイン状態に依存させず、クロスオリジンCookieを送らない。
      script.crossOrigin = "anonymous";
      let timer;
      const cleanup = () => { env.clearTimeout(timer); script.remove(); delete env[callback]; };
      env[callback] = (result) => {
        cleanup();
        if (result?.ok === true) resolve(result);
        else reject(new Error(result?.error || "Driveから取得できませんでした。"));
      };
      script.onerror = () => { cleanup(); reject(new Error("GASに接続できません。公開設定と通信環境を確認してください。")); };
      timer = env.setTimeout(() => { cleanup(); reject(new Error("取得がタイムアウトしました。もう一度お試しください。")); }, timeoutMs);
      script.src = url.href;
      env.document.head.appendChild(script);
    });
  }
  return { parseSource, endpointUrl, request };
});
