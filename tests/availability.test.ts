import { describe, expect, it } from 'vitest';
import {
  applyDirectOnlyFilter,
  confirmSeatsFromFlights,
  isAwardDateCellOpen,
  isDirectFlightFilterLabel,
  scrapeToResult,
  type AvailScrape,
} from '../src/scraper/availability.js';
import type { Combo, CxResult, FlightSlot } from '../src/scraper/types.js';

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

describe('confirmSeatsFromFlights', () => {
  const slot = (over: Partial<FlightSlot> = {}): FlightSlot => ({
    dir: 'depart',
    date: '2026-12-23',
    flightNo: 'CX100',
    depTime: '10:00',
    arrTime: '20:00',
    arrDayOffset: 0,
    from: 'HKG',
    to: 'SYD',
    miles: 110000,
    stops: 0,
    full: false,
    ...over,
  });

  it('keeps calendar-only results when flights were not scraped', () => {
    const result: CxResult = {
      found: true,
      dates: ['2026-12-23'],
      cabin: 'First',
      raw: 'RESULT: SEATS_FOUND 2026-12-23 First',
    };
    expect(confirmSeatsFromFlights(result).found).toBe(true);
  });

  it('rejects calendar hits when flight cards are all full', () => {
    const result: CxResult = {
      found: true,
      dates: ['2026-12-23'],
      cabin: 'First',
      raw: 'RESULT: SEATS_FOUND 2026-12-23 First',
      flights: [slot({ full: true })],
    };
    expect(confirmSeatsFromFlights(result)).toMatchObject({
      found: false,
      dates: [],
      raw: 'RESULT: NONE (no open seats)',
    });
  });

  it('rejects calendar hits when no flight cards were found', () => {
    const result: CxResult = {
      found: true,
      dates: ['2026-12-23'],
      cabin: 'First',
      raw: 'RESULT: SEATS_FOUND 2026-12-23 First',
      flights: [],
    };
    expect(confirmSeatsFromFlights(result).found).toBe(false);
  });
});

describe('isDirectFlightFilterLabel', () => {
  it('matches CX Direct / 直航 checkbox labels', () => {
    expect(isDirectFlightFilterLabel('直航')).toBe(true);
    expect(isDirectFlightFilterLabel('Direct')).toBe(true);
    expect(isDirectFlightFilterLabel('Direct flight')).toBe(true);
  });

  it('rejects unrelated labels', () => {
    expect(isDirectFlightFilterLabel('推薦')).toBe(false);
    expect(isDirectFlightFilterLabel('經濟客艙')).toBe(false);
  });
});

describe('applyDirectOnlyFilter', () => {
  const baseFlight = (over: Partial<FlightSlot>): FlightSlot => ({
    dir: 'depart',
    date: '2026-08-01',
    flightNo: 'CX500',
    depTime: '10:00',
    arrTime: '15:00',
    arrDayOffset: 0,
    from: 'HKG',
    to: 'NRT',
    miles: 38000,
    stops: 0,
    full: false,
    ...over,
  });

  it('passes through when directOnly is off', () => {
    const result: CxResult = {
      found: true,
      dates: ['2026-08-01'],
      cabin: 'Business',
      raw: 'RESULT: SEATS_FOUND 2026-08-01 Business',
      flights: [baseFlight({ stops: 1 })],
    };
    expect(applyDirectOnlyFilter(result, false)).toEqual(result);
  });

  it('keeps only non-stop open flights', () => {
    const result: CxResult = {
      found: true,
      dates: ['2026-08-01', '2026-08-02'],
      cabin: 'Business',
      raw: 'RESULT: SEATS_FOUND 2026-08-01, 2026-08-02 Business',
      flights: [
        baseFlight({ date: '2026-08-01', stops: 0 }),
        baseFlight({ date: '2026-08-01', flightNo: 'CX501', stops: 1 }),
        baseFlight({ date: '2026-08-02', stops: 0, full: true }),
      ],
    };
    const filtered = applyDirectOnlyFilter(result, true);
    expect(filtered.found).toBe(true);
    expect(filtered.dates).toEqual(['2026-08-01']);
    expect(filtered.flights?.every(f => f.stops === 0)).toBe(true);
    expect(filtered.raw).toContain('(direct)');
  });

  it('returns none when only connecting flights exist', () => {
    const result: CxResult = {
      found: true,
      dates: ['2026-08-01'],
      cabin: 'Business',
      raw: 'RESULT: SEATS_FOUND 2026-08-01 Business',
      flights: [baseFlight({ stops: 1 })],
    };
    const filtered = applyDirectOnlyFilter(result, true);
    expect(filtered.found).toBe(false);
    expect(filtered.dates).toEqual([]);
    expect(filtered.raw).toBe('RESULT: NONE (no direct)');
  });
});
