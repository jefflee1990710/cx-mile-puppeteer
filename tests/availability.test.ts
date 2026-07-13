import { describe, expect, it } from 'vitest';
import { isAwardDateCellOpen, scrapeToResult, type AvailScrape } from '../src/scraper/availability.js';
import type { Combo } from '../src/scraper/types.js';

const combo: Combo = {
  origin: 'HKG',
  dest: 'NRT',
  cabin: 'bus',
  range: { start: '2026-08-01', end: '2026-08-01' },
  adults: 1,
};

describe('isAwardDateCellOpen', () => {
  it('treats Not available text as closed', () => {
    expect(
      isAwardDateCellOpen({ available: true, disabled: false, text: '1 Not available', className: '' }),
    ).toBe(false);
  });

  it('treats .not-available class as closed', () => {
    expect(
      isAwardDateCellOpen({ available: true, disabled: false, text: '1', className: 'date-card not-available' }),
    ).toBe(false);
  });

  it('keeps open bookable cells', () => {
    expect(isAwardDateCellOpen({ available: true, disabled: false, text: '1 45000', className: 'date-card' })).toBe(
      true,
    );
  });
});

describe('scrapeToResult', () => {
  it('marks found when outbound date in range is available', () => {
    const scrape: AvailScrape = {
      depart: [{ dir: 'depart', date: '2026-08-01', miles: 45000, available: true }],
      ret: [],
    };
    const result = scrapeToResult(scrape, combo);
    expect(result.found).toBe(true);
    expect(result.dates).toEqual(['2026-08-01']);
    expect(result.raw).toContain('SEATS_FOUND');
  });

  it('marks empty when no outbound availability', () => {
    const scrape: AvailScrape = {
      depart: [{ dir: 'depart', date: '2026-08-01', miles: null, available: false }],
      ret: [],
    };
    expect(scrapeToResult(scrape, combo)).toMatchObject({ found: false, dates: [], raw: 'RESULT: NONE' });
  });
});
