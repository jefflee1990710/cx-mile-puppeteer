/** Proxy CX redibe airport lists (avoids browser CORS). */

export interface Airport {
  code: string;
  label: string;
  search: string;
}

interface RawAirport {
  airportCode: string;
  shortName: string;
  countryName: string;
  name: string;
}

const REDIBE_BASE = 'https://api.cathaypacific.com/redibe';
const DAY = 86_400_000;

const cache = new Map<string, { t: number; v: Airport[] }>();

function mapAirports(json: unknown): Airport[] {
  const airports = (json as { airports?: RawAirport[] })?.airports ?? [];
  return airports.map(a => ({
    code: a.airportCode,
    label: `${a.shortName} · ${a.countryName}`,
    search: `${a.airportCode} ${a.name} ${a.shortName} ${a.countryName}`.toLowerCase(),
  }));
}

async function fetchAirports(path: string): Promise<Airport[]> {
  const res = await fetch(`${REDIBE_BASE}${path}`);
  if (!res.ok) throw new Error(`Airport list failed (HTTP ${res.status})`);
  return mapAirports(await res.json());
}

async function cached(key: string, loader: () => Promise<Airport[]>): Promise<Airport[]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 7 * DAY) return hit.v;
  const v = await loader();
  cache.set(key, { t: Date.now(), v });
  return v;
}

export function fetchOrigins(): Promise<Airport[]> {
  return cached('origins', () => fetchAirports('/airport/origin/en_HK'));
}

export function fetchDestinations(origin: string): Promise<Airport[]> {
  const code = origin.toUpperCase().trim();
  return cached(`dest.${code}`, () => fetchAirports(`/airport/destination/${code}/en_HK/`));
}
