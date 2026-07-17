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

/**
 * Calendar cells are only a hint (and often cabin-agnostic / sticky).
 * Once we have flight cards, `found` must mean at least one non-full outbound slot.
 */
export function confirmSeatsFromFlights(result: CxResult): CxResult {
  if (result.flights === undefined) return result;
  const open = result.flights.filter(f => f.dir === 'depart' && !f.full);
  const dates = [...new Set(open.map(f => f.date))].sort();
  const cabin = result.cabin;
  if (!dates.length) {
    return {
      found: false,
      dates: [],
      cabin,
      raw: result.flights.length ? 'RESULT: NONE (no open seats)' : 'RESULT: NONE (no flight cards)',
      flights: result.flights,
    };
  }
  return {
    found: true,
    dates,
    cabin,
    raw: `RESULT: SEATS_FOUND ${dates.join(', ')} ${cabin}`,
    flights: result.flights,
  };
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

/** Label text for CX results "Direct" / 「直航」 filter checkbox. */
export function isDirectFlightFilterLabel(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || t.length > 40) return false;
  return (
    t === '直航' ||
    t === 'Direct' ||
    t === 'Direct flight' ||
    t === 'Direct flights' ||
    /^direct(\s+flights?)?$/i.test(t)
  );
}

export type DirectFilterSetResult = 'ok' | 'unchanged' | 'missing' | 'failed';

/**
 * Toggle CX award-results 「直航」/ Direct checkbox so availability reflects non-stop only.
 * Self-contained for page.evaluate.
 *
 * CX often paints a custom box and hides the real <input> at 0×0 — do not require
 * the input itself to be "visible"; click the label / short text node instead.
 */
export function setCxDirectFlightFilter(wantDirect: boolean): DirectFilterSetResult {
  const isShown = (el: Element | null | undefined): boolean => {
    if (!el) return false;
    let cur: Element | null = el;
    while (cur) {
      if (cur.hasAttribute('hidden')) return false;
      if (cur.getAttribute('aria-hidden') === 'true') return false;
      const cls = typeof (cur as HTMLElement).className === 'string' ? (cur as HTMLElement).className : '';
      if (/\b(d-none|ng-hide)\b/.test(cls)) return false;
      const style = (cur as HTMLElement).style;
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
      cur = cur.parentElement;
    }
    return true;
  };

  const labelMatch = (text: string): boolean => {
    const t = text.replace(/\s+/g, ' ').trim();
    if (!t || t.length > 48) return false;
    return (
      t === '直航' ||
      t === 'Direct' ||
      t === 'Direct flight' ||
      t === 'Direct flights' ||
      /^direct(\s+flights?)?$/i.test(t) ||
      /^直航(\s*航班)?$/.test(t)
    );
  };

  const press = (el: HTMLElement) => {
    el.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    el.focus?.();
    const opts: MouseEventInit = { bubbles: true, cancelable: true, view: window, buttons: 1 };
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const) {
      el.dispatchEvent(new MouseEvent(type, opts));
    }
  };

  const forceInput = (input: HTMLInputElement, on: boolean) => {
    if (input.checked === on) return;
    try {
      input.click();
    } catch {
      // ignore
    }
    if (input.checked === on) return;
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
    desc?.set?.call(input, on);
    input.dispatchEvent(new Event('click', { bubbles: true }));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const readOn = (input: HTMLInputElement | null, roleEl: HTMLElement | null): boolean | null => {
    if (input) return !!input.checked;
    if (roleEl) {
      const aria = roleEl.getAttribute('aria-checked');
      if (aria === 'true') return true;
      if (aria === 'false') return false;
      if (roleEl.classList.contains('checked') || roleEl.getAttribute('data-state') === 'checked') return true;
      if (/\b(is-checked|selected|active)\b/i.test(String(roleEl.className))) return true;
    }
    return null;
  };

  let input: HTMLInputElement | null = null;
  let roleEl: HTMLElement | null = null;
  let clickTarget: HTMLElement | null = null;

  // 1) Exact short labels via XPath (most reliable for 「直航」).
  try {
    const xp =
      "//*[self::label or self::span or self::div or self::button or self::p or self::a]" +
      "[normalize-space()='直航' or normalize-space()='Direct' or normalize-space()='Direct flight' " +
      "or normalize-space()='Direct flights']";
    const snap = document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < snap.snapshotLength; i++) {
      const el = snap.snapshotItem(i) as HTMLElement | null;
      if (!el || !isShown(el)) continue;
      const host = (el.closest('label') as HTMLElement | null) ?? el;
      const forId = host.getAttribute('for');
      input =
        (forId ? (document.getElementById(forId) as HTMLInputElement | null) : null) ??
        host.querySelector<HTMLInputElement>('input[type="checkbox"]') ??
        el.parentElement?.querySelector<HTMLInputElement>('input[type="checkbox"]') ??
        null;
      roleEl = host.matches('[role="checkbox"]')
        ? host
        : (host.querySelector<HTMLElement>('[role="checkbox"]') ??
          (el.matches('[role="checkbox"]') ? el : null));
      clickTarget = host;
      break;
    }
  } catch {
    // XPath unavailable — fall through
  }

  // 2) Walk short text nodes / aria-labels.
  if (!clickTarget) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('label, span, div, button, p, a'))) {
      if (!isShown(el)) continue;
      const own = Array.from(el.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => (n.textContent || '').trim())
        .join(' ');
      const text = (own || (el.textContent || '')).replace(/\s+/g, ' ').trim();
      if (!labelMatch(text) && !labelMatch((el.getAttribute('aria-label') || '').trim())) continue;
      if (el.children.length > 8 && text.length > 16) continue;
      const host = (el.closest('label') as HTMLElement | null) ?? el;
      const forId = host.getAttribute('for');
      input =
        (forId ? (document.getElementById(forId) as HTMLInputElement | null) : null) ??
        host.querySelector<HTMLInputElement>('input[type="checkbox"]') ??
        el.parentElement?.querySelector<HTMLInputElement>('input[type="checkbox"]') ??
        null;
      roleEl = host.matches('[role="checkbox"]')
        ? host
        : (host.querySelector<HTMLElement>('[role="checkbox"]') ??
          (el.matches('[role="checkbox"]') ? el : null));
      clickTarget = host;
      break;
    }
  }

  // 3) Any checkbox whose nearby text mentions Direct / 直航 (input may be 0×0).
  if (!input && !roleEl) {
    for (const cand of Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
      if (!isShown(cand) && !isShown(cand.parentElement)) continue;
      const wrap = (cand.closest('label') as HTMLElement | null) ?? (cand.parentElement as HTMLElement | null);
      const t = (wrap?.textContent || cand.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
      if (!/直航|direct(\s+flights?)?/i.test(t) || t.length > 80) continue;
      input = cand;
      clickTarget = wrap && isShown(wrap) ? wrap : cand;
      break;
    }
  }

  if (!input && !roleEl && !clickTarget) return 'missing';

  const currentlyOn = readOn(input, roleEl);
  if (currentlyOn === wantDirect) return 'unchanged';

  if (input) {
    forceInput(input, wantDirect);
    if (input.checked === wantDirect) return 'ok';
  }

  const target =
    (clickTarget && isShown(clickTarget) ? clickTarget : null) ??
    (roleEl && isShown(roleEl) ? roleEl : null) ??
    input;
  if (!target) return 'failed';
  press(target);

  const after = readOn(input, roleEl);
  if (after === wantDirect) return 'ok';
  if (input && wantDirect) {
    forceInput(input, true);
    if (input.checked) return 'ok';
  }
  // Custom controls often update async — treat a successful click as ok.
  if (after == null) return 'ok';
  return 'failed';
}

/** Read whether the Direct / 直航 filter is currently on. */
export function isCxDirectFlightFilterOn(): boolean | null {
  for (const cand of Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
    const wrap = (cand.closest('label') as HTMLElement | null) ?? (cand.parentElement as HTMLElement | null);
    const t = (wrap?.textContent || cand.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    if (/直航|direct(\s+flights?)?/i.test(t) && t.length <= 80) return !!cand.checked;
  }
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[role="checkbox"]'))) {
    const t = (el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    if (!/直航|^direct(\s+flights?)?$/i.test(t) || t.length > 80) continue;
    return el.getAttribute('aria-checked') === 'true';
  }
  // Visible label present but state unknown.
  try {
    const xp =
      "//*[normalize-space()='直航' or normalize-space()='Direct' or normalize-space()='Direct flight']";
    const snap = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    if (snap.singleNodeValue) return null;
  } catch {
    // ignore
  }
  return null;
}

/** True when a Direct / 直航 filter control is present in the DOM. */
export function hasCxDirectFlightFilter(): boolean {
  try {
    const xp =
      "//*[self::label or self::span or self::div or self::button or self::p or self::a]" +
      "[normalize-space()='直航' or normalize-space()='Direct' or normalize-space()='Direct flight' " +
      "or normalize-space()='Direct flights']";
    const snap = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    if (snap.singleNodeValue) return true;
  } catch {
    // ignore
  }
  for (const cand of Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
    const wrap = (cand.closest('label') as HTMLElement | null) ?? (cand.parentElement as HTMLElement | null);
    const t = (wrap?.textContent || cand.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    if (/直航|direct(\s+flights?)?/i.test(t) && t.length <= 80) return true;
  }
  return false;
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
