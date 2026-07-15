/** Classify CX award-search bounce URLs (error_list / login walls). */

export type CxBounceKind = 'login' | 'rejected';

/**
 * When LOGINURL is empty (live redeem form), an unsigned session is bounced to
 * RETURNURL with error_list=IBE_USR005_* instead of /sign-in.
 * Other IBE_* codes on redeem/handler pages are hard rejections.
 */
export function classifyCxBounce(path: string, query: string): CxBounceKind | null {
  const code = /(?:^|[?&])error_list=([^&]*)/i.exec(query)?.[1];
  if (!code) return null;
  const decoded = decodeURIComponent(code);
  // Not signed in / session required
  if (/IBE_USR005/i.test(decoded) || /IBE_USR001/i.test(decoded)) return 'login';
  // Any other explicit error bounce from redeem / handler / IBE
  if (/redeem-flight|\.handler\.html|\/availability/i.test(path) || /error_list=/i.test(query)) {
    return 'rejected';
  }
  return null;
}
