(() => {
  const DEFAULT_RELAY_URL = "wss://dlctheail-production.up.railway.app/ws";
  const LOCAL_RELAY_URL = /^wss?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/ws\/?$/i;

  function normalizeRelayUrl(savedRelayUrl) {
    const url = typeof savedRelayUrl === "string" ? savedRelayUrl.trim() : "";
    return !url || LOCAL_RELAY_URL.test(url) ? DEFAULT_RELAY_URL : url;
  }

  const api = { DEFAULT_RELAY_URL, normalizeRelayUrl };
  globalThis.CompanionConfig = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
