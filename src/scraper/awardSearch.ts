import type { Page } from 'puppeteer';
import {
  availableDates,
  checkCxResultsState,
  clickCxDateCell,
  scrapeCxAvailability,
  scrapeCxFlightCards,
  scrapeToResult,
} from './availability.js';
import { grabAwaiGlobals, parseAwaiBootstrap } from './awai.js';
import { buildAwardSearchUrl } from './buildUrl.js';
import { cxlog } from './log.js';
import type { OpenSearchOutcome } from './loop.js';
import { pageEval } from './pageEval.js';
import type { Combo, CxResult, FlightSlot } from './types.js';
import { REDEEM_PAGE_URL } from './types.js';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export async function returnToRedeem(page: Page): Promise<void> {
  cxlog('returnToRedeem', REDEEM_PAGE_URL);
  try {
    await page.goto(REDEEM_PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  } catch (e) {
    cxlog('returnToRedeem failed', String(e));
  }
}

export async function openAwardSearch(page: Page, combo: Combo): Promise<OpenSearchOutcome> {
  const url = buildAwardSearchUrl(combo);
  cxlog('openAwardSearch navigate', url);
  try {
    await page.evaluate(`(() => { window.__cxStalePage = true; })()`);
  } catch {
    // ignore
  }
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await sleep(1000);
    let path = '';
    let query = '';
    try {
      const u = new URL(page.url());
      path = u.pathname;
      query = u.search;
    } catch {
      continue;
    }
    if (/sign-in|\/login/i.test(path)) return 'login';
    if (/\.handler\.html/i.test(path) && /error_list=/i.test(query)) {
      cxlog('openAwardSearch: rejected by CX', /error_list=([^&]+)/i.exec(query)?.[1] ?? 'unknown');
      return 'rejected';
    }
    if (/\/availability/i.test(path)) {
      const stale = await page.evaluate(`(() => window.__cxStalePage === true)()`);
      if (stale) continue;
      const state = await waitForResults(page);
      if (state === 'noflights') {
        cxlog('openAwardSearch: no flights');
        return 'noflights';
      }
      if (state === 'cells') return 'ok';
    }
  }
  cxlog('openAwardSearch timeout');
  return 'error';
}

async function waitForResults(page: Page): Promise<'cells' | 'noflights' | 'pending'> {
  for (let i = 0; i < 20; i++) {
    try {
      const state = await pageEval(page, checkCxResultsState);
      if (state === 'cells' || state === 'noflights') return state;
    } catch {
      // mid-nav
    }
    await sleep(1000);
  }
  return 'pending';
}

export async function readAwardResults(page: Page, combo: Combo): Promise<CxResult> {
  try {
    const scrape = (await pageEval(page, scrapeCxAvailability)) ?? { depart: [], ret: [] };

    if (scrape.depart.length === 0) {
      const probe = await pageEval(page, grabAwaiGlobals);
      if (probe?.isAwai) {
        cxlog('award layout: AWAI — reading pageBom bootstrap');
        const { scrape: awaiScrape, flights } = parseAwaiBootstrap(probe, combo);
        const result = scrapeToResult(awaiScrape, combo);
        return result.found ? { ...result, flights } : result;
      }
    }

    const result = scrapeToResult(scrape, combo);
    if (!result.found) return result;

    const flights: FlightSlot[] = [];
    const covered = new Set<string>();
    const inRange = (d: string) => d >= combo.range.start && d <= combo.range.end;
    const bank = (slots: FlightSlot[]) => {
      for (const s of slots) {
        if (!inRange(s.date)) continue;
        if (!covered.has(`${s.dir}|${s.date}`)) flights.push(s);
      }
      for (const s of slots) covered.add(`${s.dir}|${s.date}`);
    };

    let initial: FlightSlot[] = [];
    for (let i = 0; i < 10; i++) {
      initial = (await pageEval(page, scrapeCxFlightCards)) ?? [];
      if (initial.length > 0 && initial.every(s => s.miles != null)) break;
      await sleep(500);
    }
    cxlog(`timeslots initial: ${initial.length}`, initial[0]);
    bank(initial);

    const dates = availableDates(scrape.depart, combo.range);
    let misses = 0;
    for (const date of dates) {
      if (covered.has(`depart|${date}`)) continue;
      if (misses >= 2) {
        cxlog('timeslots: page looks wedged, skipping remaining dates');
        break;
      }
      const slots = await scrapeFlightsForDate(page, 'depart', date);
      cxlog(`timeslots depart ${date}: ${slots.length}`, slots[0]);
      if (slots.length === 0) {
        misses += 1;
        continue;
      }
      misses = 0;
      bank(slots);
    }

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
    return { ...result, flights };
  } catch (e) {
    cxlog('readAwardResults error', String(e));
    return { found: false, dates: [], cabin: '', raw: 'RESULT: NONE (scrape error)' };
  }
}

async function scrapeFlightsForDate(
  page: Page,
  dir: 'depart' | 'return',
  date: string,
): Promise<FlightSlot[]> {
  try {
    const clicked = await pageEval(page, clickCxDateCell, dir, date);
    if (clicked !== true) {
      cxlog(`timeslots: date cell not found ${dir} ${date}`);
      return [];
    }
    let best: FlightSlot[] = [];
    for (let i = 0; i < 16; i++) {
      await sleep(500);
      const slots = ((await pageEval(page, scrapeCxFlightCards)) ?? []).filter(s => s.dir === dir);
      if (slots.length === 0 || !slots.every(s => s.date === date)) continue;
      best = slots;
      if (slots.every(s => s.miles != null)) return slots;
    }
    return best;
  } catch (e) {
    cxlog('scrapeFlightsForDate error', String(e));
  }
  return [];
}
