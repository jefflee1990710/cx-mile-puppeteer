import { cabinWord, type Combo, type CxResult, type DateRange, type FlightSlot } from './types.js';

export interface AvailCell {
  dir: 'depart' | 'return';
  date: string;
  miles: number | null;
  available: boolean;
}

export interface AvailScrape {
  depart: AvailCell[];
  ret: AvailCell[];
}

export function isAwardDateCellOpen(input: {
  available: boolean;
  disabled: boolean;
  text?: string;
  className?: string;
}): boolean {
  const label = (input.text ?? '').replace(/\s+/g, ' ').toLowerCase();
  const textSaysNo = /not available|未能提供|沒有空位|不可用/.test(label);
  const classSaysNo = /\bnot-available\b/.test(input.className ?? '');
  return !!input.available && !input.disabled && !textSaysNo && !classSaysNo;
}

export function availableDates(cells: AvailCell[], range: DateRange): string[] {
  const dates = cells.filter(c => c.available && c.date >= range.start && c.date <= range.end).map(c => c.date);
  return [...new Set(dates)].sort();
}

export function scrapeToResult(scrape: AvailScrape, combo: Combo): CxResult {
  const depDates = availableDates(scrape.depart, combo.range);
  const cabin = cabinWord(combo.cabin);
  const found = depDates.length > 0;
  const raw = found ? `RESULT: SEATS_FOUND ${depDates.join(', ')} ${cabin}` : 'RESULT: NONE';
  return { found, dates: depDates, cabin, raw };
}

/** Keep only non-stop flights when directOnly is on; recompute found/dates from those slots. */
export function applyDirectOnlyFilter(result: CxResult, directOnly: boolean | undefined): CxResult {
  if (!directOnly) return result;
  const flights = (result.flights ?? []).filter(f => f.stops === 0);
  const openDates = [...new Set(flights.filter(f => !f.full).map(f => f.date))].sort();
  const cabin = result.cabin;
  if (!openDates.length) {
    return {
      found: false,
      dates: [],
      cabin,
      raw: 'RESULT: NONE (no direct)',
      flights,
    };
  }
  return {
    found: true,
    dates: openDates,
    cabin,
    raw: `RESULT: SEATS_FOUND ${openDates.join(', ')} ${cabin} (direct)`,
    flights,
  };
}

/** Injected into the page — must be self-contained. */
export function scrapeCxAvailability(): AvailScrape {
  const ng = (window as unknown as { angular?: { element: (el: Element) => { scope: () => Record<string, unknown> } } })
    .angular;
  if (!ng) return { depart: [], ret: [] };

  const toISO = (v: unknown): string => {
    const m = /([A-Z][a-z]{2}) (\d{1,2}) (\d{4})/.exec(String(v));
    if (!m) return '';
    const months: Record<string, string> = {
      Jan: '01',
      Feb: '02',
      Mar: '03',
      Apr: '04',
      May: '05',
      Jun: '06',
      Jul: '07',
      Aug: '08',
      Sep: '09',
      Oct: '10',
      Nov: '11',
      Dec: '12',
    };
    const mm = months[m[1]];
    return mm ? `${m[3]}-${mm}-${m[2].padStart(2, '0')}` : '';
  };

  const depart: AvailCell[] = [];
  const ret: AvailCell[] = [];
  for (const c of Array.from(document.querySelectorAll('.date-wrapper-outer'))) {
    const sc = ng.element(c).scope();
    const it = (sc && (sc.outboundDate || sc.dateCard || sc.inboundDate)) as
      | { date?: unknown; miles?: unknown; available?: unknown; disabled?: unknown }
      | undefined;
    if (!it) continue;
    const date = toISO(it.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const miles = typeof it.miles === 'number' ? it.miles : null;
    const card = (c.closest('.date-card') as HTMLElement | null) ?? (c as HTMLElement);
    const label = (card.textContent || '').replace(/\s+/g, ' ');
    const cell: AvailCell = {
      dir: sc.outboundDate ? 'depart' : 'return',
      date,
      miles,
      available:
        !!it.available &&
        !it.disabled &&
        !/not available|未能提供|沒有空位|不可用/i.test(label) &&
        !card.classList.contains('not-available'),
    };
    (cell.dir === 'depart' ? depart : ret).push(cell);
  }
  const byDate = (a: AvailCell, b: AvailCell) => (a.date < b.date ? -1 : 1);
  return { depart: depart.sort(byDate), ret: ret.sort(byDate) };
}

export function clickCxDateCell(dir: 'depart' | 'return', iso: string): boolean {
  const ng = (window as unknown as { angular?: { element: (el: Element) => { scope: () => Record<string, unknown> } } })
    .angular;
  if (!ng) return false;
  const months: Record<string, string> = {
    Jan: '01',
    Feb: '02',
    Mar: '03',
    Apr: '04',
    May: '05',
    Jun: '06',
    Jul: '07',
    Aug: '08',
    Sep: '09',
    Oct: '10',
    Nov: '11',
    Dec: '12',
  };
  const toISO = (v: unknown): string => {
    const m = /([A-Z][a-z]{2}) (\d{1,2}) (\d{4})/.exec(String(v));
    return m && months[m[1]] ? `${m[3]}-${months[m[1]]}-${m[2].padStart(2, '0')}` : '';
  };
  for (const c of Array.from(document.querySelectorAll('.date-wrapper-outer'))) {
    const sc = ng.element(c).scope();
    if (!sc) continue;
    const it = (sc.outboundDate || sc.dateCard || sc.inboundDate) as { date?: unknown } | undefined;
    if (!it) continue;
    if ((sc.outboundDate ? 'depart' : 'return') !== dir) continue;
    if (toISO(it.date) !== iso) continue;
    const target = c.closest('.date-card') ?? c;
    for (const t of ['mousedown', 'mouseup', 'click']) {
      target.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    }
    return true;
  }
  return false;
}

export function scrapeCxFlightCards(): FlightSlot[] {
  const ng = (window as unknown as { angular?: { element: (el: Element) => { scope: () => Record<string, unknown> } } })
    .angular;
  if (!ng) return [];
  const months: Record<string, string> = {
    Jan: '01',
    Feb: '02',
    Mar: '03',
    Apr: '04',
    May: '05',
    Jun: '06',
    Jul: '07',
    Aug: '08',
    Sep: '09',
    Oct: '10',
    Nov: '11',
    Dec: '12',
  };
  const toISO = (v: unknown): string => {
    const m = /([A-Z][a-z]{2}) (\d{1,2}) (\d{4})/.exec(String(v));
    return m && months[m[1]] ? `${m[3]}-${months[m[1]]}-${m[2].padStart(2, '0')}` : '';
  };
  const hhmm = (v: unknown): string => {
    const s = String(v ?? '');
    return /^\d{4}$/.test(s) ? `${s.slice(0, 2)}:${s.slice(2)}` : s;
  };
  const dayDiff = (a: string, b: string): number => {
    if (!a || !b) return 0;
    const ms =
      Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8)) -
      Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8));
    return Math.round(ms / 86_400_000);
  };

  const out: FlightSlot[] = [];
  for (const card of Array.from(document.querySelectorAll('.row-flight-card-wrapper'))) {
    const sc = ng.element(card).scope();
    if (!sc) continue;
    const f = sc.flight as
      | { startDate?: unknown; endDate?: unknown; segments?: Array<Record<string, unknown>> }
      | undefined;
    const segs = (f?.segments ?? []).filter(s => !s.bDummy);
    if (!f || segs.length === 0) continue;
    const first = segs[0];
    const last = segs[segs.length - 1];
    const date = toISO(f.startDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.push({
      dir: sc.travelType === 'DEP' ? 'depart' : 'return',
      date,
      flightNo: segs
        .map(s => String(s.airlineCompleteCode || `${s.marketingAirlineCode ?? ''}${s.flightNumber ?? ''}`))
        .join('+'),
      depTime: hhmm(first.beginTime),
      arrTime: hhmm(last.endTime),
      arrDayOffset: dayDiff(date, toISO(f.endDate)),
      from: String(first.beginAirportCode ?? ''),
      to: String(last.endAirportCode ?? ''),
      miles: typeof sc.milesInfo === 'number' ? sc.milesInfo : null,
      stops: segs.length - 1,
      full: !!sc.isFull,
    });
  }
  return out;
}

export function checkCxResultsState(): 'cells' | 'noflights' | 'pending' {
  const bom = (window as unknown as { pageBom?: { modelObject?: { availabilities?: unknown } } }).pageBom;
  if (bom?.modelObject?.availabilities) return 'cells';
  if (document.querySelectorAll('.date-wrapper-outer').length > 0) return 'cells';
  const text = document.body ? document.body.innerText : '';
  if (/ERR_DDS_9100|no flights available for the dates/i.test(text)) return 'noflights';
  return 'pending';
}
