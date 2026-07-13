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
  it('builds one-way IBEFacade URL without return leg params', () => {
    const url = buildAwardSearchUrl(combo);
    expect(url).toContain('https://api.cathaypacific.com/redibe/IBEFacade?');
    expect(url).toContain('ACTION=RED_AWARD_SEARCH');
    expect(url).toContain('ORIGIN%5B1%5D=HKG');
    expect(url).toContain('DESTINATION%5B1%5D=NRT');
    expect(url).toContain('DEPARTUREDATE%5B1%5D=20260801');
    expect(url).toContain('CABINCLASS=C');
    expect(url).not.toContain('ORIGIN%5B2%5D');
    expect(url).not.toContain('DEPARTUREDATE%5B2%5D');
  });
});

describe('buildCxDisplay', () => {
  it('formats a readable combo label', () => {
    expect(buildCxDisplay(combo)).toBe('HKG→NRT · Business · 2026-08-01');
  });
});
