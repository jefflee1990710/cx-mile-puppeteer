export type CabinCode = 'eco' | 'pey' | 'bus' | 'fir';

/** CX sign-in identifier: mobile (default) or membership number. */
export type LoginMethod = 'mobile' | 'membership';

export interface DateRange {
  start: string;
  end: string;
}

export interface CxTask {
  id: string;
  origin: string;
  dest: string;
  range: DateRange;
  dates?: string[];
}

export interface CxForm {
  autoLogin: boolean;
  loginMethod: LoginMethod;
  countryCode: string;
  mobile: string;
  /** Cathay membership / Asia Miles number (used when loginMethod is membership). */
  membership: string;
  password: string;
  tasks: CxTask[];
  cabins: CabinCode[];
  adults: number;
  intervalMin: number;
}

export interface Combo {
  origin: string;
  dest: string;
  cabin: CabinCode;
  range: DateRange;
  adults: number;
}

export interface FlightSlot {
  dir: 'depart' | 'return';
  date: string;
  flightNo: string;
  depTime: string;
  arrTime: string;
  arrDayOffset: number;
  from: string;
  to: string;
  miles: number | null;
  stops: number;
  full: boolean;
  seatsLeft?: number | null;
}

export interface CxResult {
  found: boolean;
  dates: string[];
  cabin: string;
  raw: string;
  flights?: FlightSlot[];
}

export const CABINS: { code: CabinCode; label: string }[] = [
  { code: 'eco', label: 'Economy 經濟' },
  { code: 'pey', label: 'Premium Eco 特選經濟' },
  { code: 'bus', label: 'Business 商務' },
  { code: 'fir', label: 'First 頭等' },
];

export const REDEEM_PAGE_URL =
  'https://www.cathaypacific.com/cx/en_HK/book-a-trip/redeem-flights/redeem-flight-awards.html';

let taskSeq = 0;
export const newTaskId = (): string => {
  taskSeq += 1;
  return `t${Date.now().toString(36)}${taskSeq.toString(36)}`;
};

export const makeCxTask = (partial?: Partial<Omit<CxTask, 'id'>> & { id?: string }): CxTask => {
  const range = partial?.range ?? { start: '', end: '' };
  const dates = partial?.dates !== undefined ? [...partial.dates] : range.start ? [range.start] : [];
  return {
    id: partial?.id ?? newTaskId(),
    origin: partial?.origin ?? 'HKG',
    dest: partial?.dest ?? '',
    range: { start: range.start, end: range.end },
    dates,
  };
};

export function taskAwardDates(task: CxTask): string[] {
  const raw = task.dates?.length ? task.dates : task.range.start ? [task.range.start] : [];
  return [...new Set(raw.filter(Boolean))].sort();
}

export function syncTaskRangeFromDates(dates: string[]): DateRange {
  const sorted = [...new Set(dates.filter(Boolean))].sort();
  if (sorted.length === 0) return { start: '', end: '' };
  return { start: sorted[0], end: sorted[sorted.length - 1] };
}

export function cabinWord(code: string): string {
  return CABINS.find(c => c.code === code)?.label.split(' ')[0] ?? code;
}
