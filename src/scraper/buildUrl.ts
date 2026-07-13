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

/** One-way award IBEFacade URL (no return-leg [2] params). */
export function buildAwardSearchUrl(combo: Combo): string {
  const yyyymmdd = (d: string) => d.replace(/-/g, '');
  const p = new URLSearchParams({
    ACTION: 'RED_AWARD_SEARCH',
    'ORIGIN[1]': combo.origin,
    'DESTINATION[1]': combo.dest,
    'DEPARTUREDATE[1]': yyyymmdd(combo.range.start),
    CABINCLASS: CABIN_CLASS[combo.cabin] ?? 'Y',
    ADULT: String(combo.adults),
    CHILD: '0',
    FLEXIBLEDATE: 'true',
    BRAND: 'CX',
    ENTRYCOUNTRY: 'HK',
    ENTRYLANGUAGE: 'en',
    ENTRYPOINT: REDEEM_PAGE_URL,
    RETURNURL: REDEEM_PAGE_URL,
    ERRORURL: ERROR_URL,
    LOGINURL: LOGIN_URL,
    DISCOUNTCODE: '',
    isChecked: 'TRUE',
  });
  return `https://api.cathaypacific.com/redibe/IBEFacade?${p.toString()}`;
}
