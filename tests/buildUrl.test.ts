import { describe, expect, it } from 'vitest';
import { buildAwardSearchUrl, buildCxDisplay } from '../src/scraper/buildUrl.js';
import type { Combo } from '../src/scraper/types.js';

const combo: Combo = {
  origin: 'HKG',
  dest: 'NRT',
  cabin: 'bus',
  range: { start: '2026-08-01', end: '2026-08-01' },
  adults: 1,
};

describe('buildAwardSearchUrl', () => {
  it('builds one-way IBEFacade URL matching the live CX search link', () => {
    const url = buildAwardSearchUrl(combo);
    const q = new URL(url).searchParams;
    expect(url.startsWith('https://api.cathaypacific.com/redibe/IBEFacade?')).toBe(true);
    expect(q.get('ACTION')).toBe('RED_AWARD_SEARCH');
    expect(q.get('ORIGIN[1]')).toBe('HKG');
    expect(q.get('DESTINATION[1]')).toBe('NRT');
    expect(q.get('DEPARTUREDATE[1]')).toBe('20260801');
    expect(q.get('CABINCLASS')).toBe('C');
    expect(q.get('LOGINURL')).toBe('https://www.cathaypacific.com/cx/en_HK/sign-in.html');
    expect(q.get('isChecked')).toBe('TRUE');
    expect(q.get('FLEXIBLEDATE')).toBe('true');
    expect(q.get('ORIGIN[2]')).toBeNull();
    expect(q.get('DEPARTUREDATE[2]')).toBeNull();
  });
});

describe('buildCxDisplay', () => {
  it('formats a readable combo label', () => {
    expect(buildCxDisplay(combo)).toBe('HKG→NRT · Business · 2026-08-01');
  });
});
