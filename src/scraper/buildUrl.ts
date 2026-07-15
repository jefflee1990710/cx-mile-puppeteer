import { CABINS, REDEEM_PAGE_URL, type CabinCode, type Combo } from './types.js';

const CABIN_CLASS: Record<CabinCode, string> = { eco: 'Y', pey: 'W', bus: 'C', fir: 'F' };
const ERROR_URL =
  'https://www.cathaypacific.com/cx/en_HK/book-a-trip/redeem-flights/redeem-flight-awards.handler.html';
const LOGIN_URL = 'https://www.cathaypacific.com/cx/en_HK/sign-in.html';

export function buildCxDisplay(combo: Combo): string {
  const found = CABINS.find(c => c.code === combo.cabin);
  const cabin = found ? found.label.split(' ')[0] : combo.cabin;
  const dates = combo.range.start === combo.range.end ? combo.range.start : `${combo.range.start}..${combo.range.end}`;
  return `${combo.origin}→${combo.dest} · ${cabin} · ${dates}`;
}

/**
 * One-way award IBEFacade URL (no return-leg [2] params).
 * Param set/order matches a live CX redeem search submit (incl. LOGINURL + isChecked=TRUE).
 */
export function buildAwardSearchUrl(combo: Combo): string {
  const yyyymmdd = (d: string) => d.replace(/-/g, '');
  const p = new URLSearchParams();
  p.set('RETURNURL', REDEEM_PAGE_URL);
  p.set('ENTRYCOUNTRY', 'HK');
  p.set('DESTINATION[1]', combo.dest);
  p.set('DISCOUNTCODE', '');
  p.set('ENTRYPOINT', REDEEM_PAGE_URL);
  p.set('CHILD', '0');
  p.set('ADULT', String(combo.adults));
  p.set('FLEXIBLEDATE', 'true');
  p.set('ENTRYLANGUAGE', 'en');
  p.set('BRAND', 'CX');
  p.set('LOGINURL', LOGIN_URL);
  p.set('ACTION', 'RED_AWARD_SEARCH');
  p.set('CABINCLASS', CABIN_CLASS[combo.cabin] ?? 'Y');
  p.set('ORIGIN[1]', combo.origin);
  p.set('ERRORURL', ERROR_URL);
  p.set('DEPARTUREDATE[1]', yyyymmdd(combo.range.start));
  p.set('isChecked', 'TRUE');
  return `https://api.cathaypacific.com/redibe/IBEFacade?${p.toString()}`;
}
