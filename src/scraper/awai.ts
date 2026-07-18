import type { AvailScrape } from './availability.js';
import type { CabinCode, Combo, FlightSlot } from './types.js';

interface AwaiSegment {
  originLocation?: string;
  destinationLocation?: string;
  destinationDate?: number;
  flightIdentifier?: { marketingAirline?: string; flightNumber?: string; originDate?: number };
  cabins?: Record<string, { status?: string }>;
  bDummy?: boolean;
}

interface AwaiFlight {
  segments?: AwaiSegment[];
  bookable?: boolean;
  flightIdString?: string;
}

interface AwaiBound {
  searchDestination?: { originLocation?: string; destinationLocation?: string; originDate?: number };
  flights?: AwaiFlight[];
}

interface AwaiTier {
  tierCode?: string;
  cabinMap?: Array<{ cabinType?: string; miles?: number; fareFamilyCode?: string }>;
}

export interface AwaiGlobals {
  isAwai: boolean;
  bounds?: AwaiBound[];
  tiersOutbound?: AwaiTier[];
  tiersInbound?: AwaiTier[];
  /** pageBom.modelObject.milesInfoMap — values like "0_0" / "2_1,0_3" (awardSeats_index). */
  milesInfoMap?: Record<string, string>;
}

export function grabAwaiGlobals(): AwaiGlobals {
  const w = window as unknown as {
    pageCode?: string;
    pageBom?: {
      modelObject?: {
        availabilities?: { upsell?: { bounds?: AwaiBound[] } };
        milesInfoMap?: Record<string, string>;
      };
    };
    tiersListOutbound?: AwaiTier[];
    tiersListInbound?: AwaiTier[];
    clientSideData?: Record<string, string>;
  };
  const bounds = w.pageBom?.modelObject?.availabilities?.upsell?.bounds;
  if (w.pageCode !== 'AWAI' || !Array.isArray(bounds)) return { isAwai: false };
  const parse = (v: unknown): AwaiTier[] | undefined => {
    if (Array.isArray(v)) return v as AwaiTier[];
    if (typeof v === 'string') {
      try {
        const p = JSON.parse(v);
        return Array.isArray(p) ? (p as AwaiTier[]) : undefined;
      } catch {
        return undefined;
      }
    }
    return undefined;
  };
  const milesInfoMap = w.pageBom?.modelObject?.milesInfoMap;
  return {
    isAwai: true,
    bounds,
    tiersOutbound: parse(w.tiersListOutbound) ?? parse(w.clientSideData?.DDS_TIERS_LIST_OUTBOUND),
    tiersInbound: parse(w.tiersListInbound) ?? parse(w.clientSideData?.DDS_TIERS_LIST_INBOUND),
    milesInfoMap: milesInfoMap && typeof milesInfoMap === 'object' ? milesInfoMap : undefined,
  };
}

const msToISO = (ms: number | undefined): string => {
  if (typeof ms !== 'number') return '';
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};
const msToHM = (ms: number | undefined): string => {
  if (typeof ms !== 'number') return '';
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};
const locCode = (loc: string | undefined): string => {
  const s = String(loc ?? '');
  const i = s.lastIndexOf('_');
  return i >= 0 ? s.slice(i + 1) : s;
};
const dayDiff = (a: string, b: string): number => {
  if (!a || !b) return 0;
  const ms =
    Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8)) -
    Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8));
  return Math.round(ms / 86_400_000);
};

const FARE_FAMILY: Record<CabinCode, string> = { eco: 'ECO', pey: 'PEY', bus: 'BUS', fir: 'FIR' };

/**
 * Segment cabin keys to read for each search cabin (Amadeus-style status map).
 * Must NOT fall back to Object.values()[0] — that reads unrelated cabins (e.g. R:"9" on a First search).
 */
const CABIN_STATUS_KEYS: Record<CabinCode, readonly string[]> = {
  fir: ['F', 'A'],
  bus: ['J', 'C', 'D', 'I', 'B'],
  pey: ['W', 'R'],
  eco: ['Y', 'B', 'M', 'H', 'K', 'L', 'V', 'S', 'N', 'Q', 'O', 'E'],
};

function tierMiles(tiers: AwaiTier[] | undefined, cabin: CabinCode): number | null {
  const entries = (tiers ?? []).flatMap(t => t.cabinMap ?? []);
  const hit = entries.find(e => String(e.fareFamilyCode ?? '').startsWith(FARE_FAMILY[cabin]));
  const pick = hit ?? (entries.length === 1 ? entries[0] : undefined);
  return typeof pick?.miles === 'number' ? pick.miles : null;
}

function cabinStatus(seg: AwaiSegment, cabin: CabinCode): string | null {
  const cabins = seg.cabins ?? {};
  for (const key of CABIN_STATUS_KEYS[cabin]) {
    const st = cabins[key]?.status;
    if (typeof st === 'string') return st;
  }
  return null;
}

/** Parse milesInfoMap values like "0_0" / "2_1,0_3" → max award-seat count, or null if unknown. */
export function awardSeatsFromMilesInfo(
  milesInfoMap: Record<string, string> | undefined,
  flightId: string | undefined,
): number | null {
  if (!milesInfoMap || !flightId) return null;
  const raw = milesInfoMap[flightId];
  if (raw == null || raw === '') return null;
  const seats = String(raw)
    .split(',')
    .map(part => Number.parseInt(part.split('_')[0] ?? '', 10));
  if (!seats.length || seats.some(n => Number.isNaN(n))) return null;
  return Math.max(...seats);
}

/**
 * Award seat openness for the searched cabin only.
 * Digits 1-9 = open seat count; 0 / C / N / missing cabin key = closed.
 * When milesInfoMap lists the flight, a max of 0 forces closed (waitlist / no award).
 */
export function openAwaiFlightStatus(
  f: AwaiFlight,
  cabin: CabinCode,
  milesInfoMap?: Record<string, string>,
): { open: boolean; seats: number | null } {
  if (f.bookable === false) return { open: false, seats: null };

  const mapSeats = awardSeatsFromMilesInfo(milesInfoMap, f.flightIdString);
  if (mapSeats === 0) return { open: false, seats: null };

  const statuses = (f.segments ?? [])
    .filter(s => !s.bDummy)
    .map(s => cabinStatus(s, cabin));
  if (statuses.length === 0) return { open: false, seats: null };
  // Every marketing segment must expose the searched cabin with a positive digit status.
  if (statuses.some(s => s == null || !/^\d$/.test(s) || s === '0')) {
    return { open: false, seats: null };
  }
  const cabinSeats = Math.min(...statuses.map(s => Number(s)));
  const seats = mapSeats == null ? cabinSeats : Math.min(cabinSeats, mapSeats);
  if (seats <= 0) return { open: false, seats: null };
  return { open: true, seats };
}

export function parseAwaiBootstrap(raw: AwaiGlobals, combo: Combo): { scrape: AvailScrape; flights: FlightSlot[] } {
  if (!raw.isAwai || !Array.isArray(raw.bounds)) return { scrape: { depart: [], ret: [] }, flights: [] };

  const scrape: AvailScrape = { depart: [], ret: [] };
  const flights: FlightSlot[] = [];

  raw.bounds.forEach((bound, bi) => {
    const dir: 'depart' | 'return' = bi === 0 ? 'depart' : 'return';
    const miles = tierMiles(bi === 0 ? raw.tiersOutbound : raw.tiersInbound, combo.cabin);
    const boundDate = msToISO(bound.searchDestination?.originDate);
    let anyOpen = false;

    for (const f of bound.flights ?? []) {
      const segs = (f.segments ?? []).filter(s => !s.bDummy);
      if (segs.length === 0) continue;
      const { open, seats } = openAwaiFlightStatus(f, combo.cabin, raw.milesInfoMap);
      if (!open) continue;
      anyOpen = true;
      const first = segs[0];
      const last = segs[segs.length - 1];
      const date = msToISO(first.flightIdentifier?.originDate) || boundDate;
      const arrDate = msToISO(last.destinationDate);
      flights.push({
        dir,
        date,
        flightNo: segs
          .map(s => `${s.flightIdentifier?.marketingAirline ?? ''}${s.flightIdentifier?.flightNumber ?? ''}`)
          .join('+'),
        depTime: msToHM(first.flightIdentifier?.originDate),
        arrTime: msToHM(last.destinationDate),
        arrDayOffset: dayDiff(date, arrDate),
        from: locCode(first.originLocation),
        to: locCode(last.destinationLocation),
        miles,
        stops: segs.length - 1,
        full: false,
        seatsLeft: seats,
      });
    }

    if (boundDate) {
      (dir === 'depart' ? scrape.depart : scrape.ret).push({ dir, date: boundDate, miles, available: anyOpen });
    }
  });

  flights.sort((a, b) =>
    a.dir !== b.dir
      ? a.dir === 'depart'
        ? -1
        : 1
      : a.date < b.date
        ? -1
        : a.date > b.date
          ? 1
          : a.depTime < b.depTime
            ? -1
            : 1,
  );
  return { scrape, flights };
}
