/** Network-capability spellings shared by architectural source guards. */

/**
 * A reach into the network, spelled any way first-party Deno source can spell
 * it. Guards intentionally scan raw source, including comments.
 */
export const NETWORK_TOKEN =
  /\bfetch\s*\(|\bDeno\.(connect|connectTls|connectQuic|listen|listenTls|listenDatagram|resolveDns|createHttpClient|serve|serveHttp|upgradeWebSocket|startTls)\b|\bnew\s+WebSocket\b|\bWebSocketStream\b|\bXMLHttpRequest\b|\bEventSource\b|\bsendBeacon\b|\bnode:(http|https|net|tls|dgram|dns)\b/;
