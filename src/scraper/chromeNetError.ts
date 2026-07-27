/**
 * Detect Chrome interstitial / navigation failures that mean Akamai (or the edge)
 * dropped the HTTP/2 connection — e.g. ERR_HTTP2_PROTOCOL_ERROR on IBEFacade.
 */

export type ChromeNetErrorProbe = {
  url?: string;
  title?: string;
  text?: string;
  code?: string;
};

const NET_ERR_CODE =
  /ERR_HTTP2_PROTOCOL_ERROR|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_CONNECTION_REFUSED|ERR_SSL_PROTOCOL_ERROR|ERR_NETWORK_CHANGED|ERR_EMPTY_RESPONSE|ERR_TIMED_OUT/i;

const CANT_REACH =
  /This site can.?t be reached|webpage at .+ might be temporarily down|took too long to respond/i;

/** Pure matcher for Chrome error-page text (also used in tests). */
export function looksLikeChromeNetError(probe: ChromeNetErrorProbe): boolean {
  const url = probe.url ?? '';
  const blob = `${probe.title ?? ''} ${probe.text ?? ''} ${probe.code ?? ''}`;
  if (/chrome-error:|chromewebdata/i.test(url)) return true;
  if (NET_ERR_CODE.test(blob)) return true;
  if (CANT_REACH.test(blob) && /cathaypacific\.com|IBEFacade|redibe/i.test(url + blob)) return true;
  if (CANT_REACH.test(blob) && NET_ERR_CODE.test(blob)) return true;
  return false;
}

export function isNavigationNetError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /net::ERR_|ERR_HTTP2_PROTOCOL_ERROR|ERR_CONNECTION_|ERR_SSL_PROTOCOL_ERROR/i.test(msg);
}
