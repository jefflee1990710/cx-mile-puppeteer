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
}

export function grabAwaiGlobals(): AwaiGlobals {
  const w = window as unknown as {
    pageCode?: string;
    pageBom?: { modelObject?: { availabilities?: { upsell?: { bounds?: AwaiBound[] } } } };
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
  return {
    isAwai: true,
    bounds,
    tiersOutbound: parse(w.tiersListOutbound) ?? parse(w.clientSideData?.DDS_TIERS_LIST_OUTBOUND),
    tiersInbound: parse(w.tiersListInbound) ?? parse(w.clientSideData?.DDS_TIERS_LIST_INBOUND),
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

function tierMiles(tiers: AwaiTier[] | undefined, cabin: CabinCode): number | null {
  const entries = (tiers ?? []).flatMap(t => t.cabinMap ?? []);
  const hit = entries.find(e => String(e.fareFamilyCode ?? '').startsWith(FARE_FAMILY[cabin]));
  const pick = hit ?? (entries.length === 1 ? entries[0] : undefined);
  return typeof pick?.miles === 'number' ? pick.miles : null;
}

function openStatus(f: AwaiFlight): { open: boolean; seats: number | null } {
  if (f.bookable === false) return { open: false, seats: null };
  const statuses = (f.segments ?? [])
    .filter(s => !s.bDummy)
    .map(s => Object.values(s.cabins ?? {})[0]?.status)
    .filter((s): s is string => typeof s === 'string');
  if (statuses.some(s => !/^\d$/.test(s) || s === '0')) return { open: false, seats: null };
  const seats = statuses.length ? Math.min(...statuses.map(Number)) : null;
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
      const { open, seats } = openStatus(f);
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
