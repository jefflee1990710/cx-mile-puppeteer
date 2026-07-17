import type { ElementHandle, Page } from 'puppeteer';
import {
  applyDirectOnlyFilter,
  availableDates,
  checkCxResultsState,
  clickCxDateCell,
  confirmSeatsFromFlights,
  hasCxDirectFlightFilter,
  isCxDirectFlightFilterOn,
  scrapeCxAvailability,
  scrapeCxFlightCards,
  scrapeToResult,
  setCxDirectFlightFilter,
} from './availability.js';
import { grabAwaiGlobals, parseAwaiBootstrap } from './awai.js';
import { isCdpAttached, isNativeBrowser } from './browser.js';
import { buildAwardSearchUrl } from './buildUrl.js';
import { classifyCxBounce, isMidOAuthNavigation } from './cxBounce.js';
import { humanClick, pause, warmSession } from './human.js';
import { detectSuspiciousActivity } from './loginPageFns.js';
import { cxlog } from './log.js';
import type { OpenSearchOutcome } from './loop.js';
import { pageEval } from './pageEval.js';
import type { Combo, CxResult, FlightSlot } from './types.js';
import { REDEEM_PAGE_URL } from './types.js';

const DIRECT_LABEL_XPATH =
  "//*[self::label or self::span or self::div or self::button or self::p or self::a]" +
  "[normalize-space()='直航' or normalize-space()='Direct' or normalize-space()='Direct flight' " +
  "or normalize-space()='Direct flights']";

/** Cursor-click the Direct / 直航 control via ElementHandle (no id required). */
async function humanClickDirectFilter(page: Page): Promise<boolean> {
  const handle = await page.evaluateHandle((xp: string) => {
    try {
      const snap = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      const node = snap.singleNodeValue as HTMLElement | null;
      if (!node) return null;
      const host = (node.closest('label') as HTMLElement | null) ?? node;
      return host;
    } catch {
      return null;
    }
  }, DIRECT_LABEL_XPATH);
  try {
    const el = handle.asElement() as ElementHandle<Element> | null;
    if (!el) return false;
    return await humanClick(page, el);
  } finally {
    await handle.dispose().catch(() => undefined);
  }
}

/**
 * Enable CX results 「直航」checkbox before scraping when directOnly is on.
 * Returns true when the filter is confirmed on (or already on).
 * The control often mounts only after the flight list (beside 推薦) — wait + retry.
 */
async function ensureDirectFlightCheckbox(
  page: Page,
  wantDirect: boolean,
  opts?: { waitMs?: number; label?: string },
): Promise<boolean> {
  if (!wantDirect) return true;

  const waitMs = opts?.waitMs ?? 12_000;
  const tag = opts?.label ? ` (${opts.label})` : '';
  const deadline = Date.now() + waitMs;

  const already = await pageEval(page, isCxDirectFlightFilterOn);
  if (already === true) {
    cxlog(`direct filter checkbox already on${tag}`);
    return true;
  }

  // Wait for the control — calendar view may not have it yet.
  while (!(await pageEval(page, hasCxDirectFlightFilter)) && Date.now() < deadline) {
    await pause.poll(500);
  }

  if (!(await pageEval(page, hasCxDirectFlightFilter))) {
    cxlog(`direct filter checkbox missing${tag} — will rely on stops filter`);
    return false;
  }

  if ((await pageEval(page, isCxDirectFlightFilterOn)) === true) {
    cxlog(`direct filter checkbox already on${tag}`);
    return true;
  }

  const accepted = async (via: string): Promise<boolean> => {
    const on = await pageEval(page, isCxDirectFlightFilterOn);
    if (on === true) {
      cxlog(`direct filter checkbox enabled via ${via}${tag}`);
      await pause.page();
      return true;
    }
    // Custom controls may not expose checked/aria — treat a successful click as applied.
    if (on == null) {
      cxlog(`direct filter checkbox clicked via ${via}${tag} (state unreadable — assuming on)`);
      await pause.page();
      return true;
    }
    return false;
  };

  // Prefer a real cursor click on the label / text node.
  if (await humanClickDirectFilter(page)) {
    await pause.short();
    if (await accepted('human click')) return true;
  }

  let status = await pageEval(page, setCxDirectFlightFilter, true);
  cxlog(`direct filter checkbox${tag}`, status);
  if (status === 'ok' || status === 'unchanged') {
    if (await accepted(status)) return true;
  }

  for (let i = 0; i < 12 && Date.now() < deadline + 5_000; i++) {
    if ((await pageEval(page, isCxDirectFlightFilterOn)) === true) {
      await pause.page();
      return true;
    }
    await pause.short();
    if (i % 3 === 2) await humanClickDirectFilter(page).catch(() => false);
    status = await pageEval(page, setCxDirectFlightFilter, true);
    if (status === 'ok' || status === 'unchanged') {
      if (await accepted(status)) return true;
    }
  }

  const finalOn = await pageEval(page, isCxDirectFlightFilterOn);
  if (finalOn === true) return true;
  if (finalOn == null && (status === 'ok' || status === 'unchanged')) {
    cxlog(`direct filter checkbox assumed on after retries${tag}`, status);
    return true;
  }
  cxlog(`direct filter checkbox not confirmed on after retries${tag}`, status, finalOn);
  return false;
}

const CABIN_CLASS: Record<string, string> = { eco: 'Y', pey: 'W', bus: 'C', fir: 'F' };

export async function returnToRedeem(page: Page): Promise<void> {
  cxlog('returnToRedeem', REDEEM_PAGE_URL);
  await pause.action();
  try {
    await page.goto(REDEEM_PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await pause.page();
    if (!isNativeBrowser()) await warmSession(page);
  } catch (e) {
    cxlog('returnToRedeem failed', String(e));
  }
}

/**
 * Watch the current tab until CX award search settles (used after OAuth login return).
 * Does not navigate — the extension's success path is login→OAuth→availability in-place.
 */
export async function settleAwardSearch(page: Page, timeoutMs = 90_000): Promise<OpenSearchOutcome> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await pause.poll(1000);
    if (await isAkamaiDenied(page)) {
      cxlog('settleAwardSearch: Akamai Access Denied', page.url());
      if (!isCdpAttached()) {
        cxlog(
          'hint: set CX_CDP_URL after .\\scripts\\launch-chrome-debug.ps1 (or ./scripts/launch-chrome-debug.sh); wipe chrome-profile if cookies are burned',
        );
      }
      return 'error';
    }
    let path = '';
    let query = '';
    let href = '';
    try {
      const u = new URL(page.url());
      path = u.pathname;
      query = u.search;
      href = u.href;
    } catch {
      continue;
    }

    // Sign-in wall first (path only). Never match oauth strings inside ?goto=.
    if (/sign-in|\/login/i.test(path)) {
      if ((await pageEval(page, detectSuspiciousActivity)) === true) {
        cxlog('settleAwardSearch: suspicious activity page');
        return 'suspicious';
      }
      return 'login';
    }

    const bounce = classifyCxBounce(path, query);
    if (bounce === 'login') {
      cxlog('settleAwardSearch: login required', /error_list=([^&]+)/i.exec(query)?.[1] ?? 'unknown');
      return 'login';
    }
    if (bounce === 'rejected') {
      cxlog('settleAwardSearch: rejected by CX', /error_list=([^&]+)/i.exec(query)?.[1] ?? 'unknown');
      return 'rejected';
    }

    // Mid OAuth / createSession on the *current* host — keep waiting.
    if (isMidOAuthNavigation(href)) continue;

    if (/\/availability/i.test(path)) {
      const state = await waitForResults(page);
      if (state === 'noflights') {
        cxlog('settleAwardSearch: no flights');
        return 'noflights';
      }
      if (state === 'cells') return 'ok';
    }
  }
  cxlog('settleAwardSearch timeout', page.url());
  return 'error';
}

export async function openAwardSearch(page: Page, combo: Combo): Promise<OpenSearchOutcome> {
  const url = buildAwardSearchUrl(combo);
  cxlog('openAwardSearch navigate', url);
  await pause.combo();

  try {
    await page.evaluate(`(() => { window.__cxStalePage = true; })()`);
  } catch {
    // ignore
  }

  // CDP attach: mirror the extension — chrome.tabs.update(IBEFacade URL) only.
  // No redeem warm, form fill, ghost cursor, or fingerprint (those trip Akamai).
  if (isCdpAttached()) {
    cxlog('openAwardSearch: CDP — tabs.update-style goto (extension path)');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await pause.page();
    return settleAwardSearch(page);
  }

  // Always start from the redeem document so the IBEFacade hit carries a real Referer
  // (extension navigates inside an already-open CX tab — cold CDP goto is what Akamai flags).
  try {
    const onRedeem = /redeem-flight-awards\.html/i.test(page.url());
    if (!onRedeem) {
      cxlog('openAwardSearch: open redeem page before search submit');
      await page.goto(REDEEM_PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await pause.page();
    }
    // Mouse/scroll warming injects DOM observers — skip on native/system Chrome.
    if (!isNativeBrowser()) await warmSession(page);
  } catch (e) {
    cxlog('openAwardSearch: redeem warm failed', String(e));
  }

  // Prefer in-page form submit (same as clicking Search on the site). Fallback: assign URL.
  const submitted = await submitRedeemSearchForm(page, combo).catch(() => false);
  if (!submitted) {
    cxlog('openAwardSearch: form submit unavailable — location.assign from redeem');
    await page.evaluate(`(u => { window.location.assign(u); })(${JSON.stringify(url)})`);
  }
  await pause.page();
  return settleAwardSearch(page);
}

/** Fill the live redeem IBEFacade form and submit — preserves Referer like a real click. */
async function submitRedeemSearchForm(page: Page, combo: Combo): Promise<boolean> {
  const ymd = combo.range.start.replace(/-/g, '');
  const cabin = CABIN_CLASS[combo.cabin] ?? 'Y';
  const result = await pageEval(
    page,
    (origin: string, dest: string, departure: string, cabinClass: string, adults: number) => {
      const forms = [...document.querySelectorAll('form')].filter(f =>
        (f.getAttribute('action') || '').includes('IBEFacade'),
      );
      const form =
        forms.find(
          f => f.querySelector('input[name="ORIGIN[1]"]') && !f.querySelector('input[name="ORIGIN[2]"]'),
        ) ?? forms[0];
      if (!form) return false;
      const set = (name: string, value: string) => {
        let el = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
        if (!el) {
          el = document.createElement('input');
          el.type = 'hidden';
          el.name = name;
          form.appendChild(el);
        }
        el.value = value;
      };
      set('ACTION', 'RED_AWARD_SEARCH');
      set('ORIGIN[1]', origin);
      set('DESTINATION[1]', dest);
      set('DEPARTUREDATE[1]', departure);
      set('CABINCLASS', cabinClass);
      set('ADULT', String(adults));
      set('CHILD', '0');
      set('FLEXIBLEDATE', 'true');
      set('BRAND', 'CX');
      set('DISCOUNTCODE', '');
      set('isChecked', 'TRUE');
      set('LOGINURL', 'https://www.cathaypacific.com/cx/en_HK/sign-in.html');
      set('ENTRYPOINT', location.href.split('?')[0]);
      set('RETURNURL', location.href.split('?')[0]);
      set(
        'ERRORURL',
        'https://www.cathaypacific.com/cx/en_HK/book-a-trip/redeem-flights/redeem-flight-awards.handler.html',
      );
      set('ENTRYCOUNTRY', 'HK');
      set('ENTRYLANGUAGE', 'en');
      form.submit();
      return true;
    },
    combo.origin,
    combo.dest,
    ymd,
    cabin,
    combo.adults,
  );
  cxlog('openAwardSearch: redeem form submit', result === true ? 'ok' : 'failed');
  return result === true;
}

async function isAkamaiDenied(page: Page): Promise<boolean> {
  try {
    const text = await page.evaluate(
      `(() => ((document.title || '') + ' ' + (document.body?.innerText || '')).slice(0, 500))()`,
    );
    return /Access Denied|errors\.edgesuite\.net|You don't have permission to access/i.test(String(text));
  } catch {
    return false;
  }
}

async function waitForResults(page: Page): Promise<'cells' | 'noflights' | 'pending'> {
  for (let i = 0; i < 20; i++) {
    try {
      const state = await pageEval(page, checkCxResultsState);
      if (state === 'cells' || state === 'noflights') return state;
    } catch {
      // mid-nav
    }
    await pause.poll(1000);
  }
  return 'pending';
}

export async function readAwardResults(page: Page, combo: Combo): Promise<CxResult> {
  try {
    await pause.short();
    // Match the CX UI: tick 「直航」 so calendar / flight list are already direct-only.
    let directOn = await ensureDirectFlightCheckbox(page, !!combo.directOnly, {
      waitMs: 8_000,
      label: 'calendar',
    });

    const scrape = (await pageEval(page, scrapeCxAvailability)) ?? { depart: [], ret: [] };

    if (scrape.depart.length === 0) {
      const probe = await pageEval(page, grabAwaiGlobals);
      if (probe?.isAwai) {
        cxlog('award layout: AWAI — reading pageBom bootstrap');
        const { scrape: awaiScrape, flights } = parseAwaiBootstrap(probe, combo);
        const result = scrapeToResult(awaiScrape, combo);
        const withFlights = { ...result, flights };
        // AWAI bootstrap ignores the UI checkbox — filter stops, then require open seats.
        return confirmSeatsFromFlights(applyDirectOnlyFilter(withFlights, combo.directOnly));
      }
    }

    const result = scrapeToResult(scrape, combo);
    // Calendar "available" alone is not enough (often not cabin-accurate).
    if (!result.found) {
      return confirmSeatsFromFlights(applyDirectOnlyFilter({ ...result, flights: [] }, combo.directOnly));
    }

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

    // 「直航」often sits beside 推薦 on the flight list — retry once cards appear.
    if (combo.directOnly && !directOn) {
      directOn = await ensureDirectFlightCheckbox(page, true, {
        waitMs: 10_000,
        label: 'flight-list',
      });
    }

    let initial: FlightSlot[] = [];
    for (let i = 0; i < 10; i++) {
      if (combo.directOnly && !directOn && i === 3) {
        directOn = await ensureDirectFlightCheckbox(page, true, {
          waitMs: 6_000,
          label: 'flight-list-retry',
        });
      }
      initial = (await pageEval(page, scrapeCxFlightCards)) ?? [];
      if (initial.length > 0 && initial.every(s => s.miles != null)) break;
      await pause.poll(500);
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
      await pause.action();
      const slots = await scrapeFlightsForDate(page, 'depart', date, {
        ensureDirect: !!combo.directOnly && !directOn,
        onDirectOk: () => {
          directOn = true;
        },
      });
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
    // Prefer flight-card truth over calendar flags (fixes First sold-out false positives).
    return confirmSeatsFromFlights(applyDirectOnlyFilter({ ...result, flights }, combo.directOnly));
  } catch (e) {
    cxlog('readAwardResults error', String(e));
    return { found: false, dates: [], cabin: '', raw: 'RESULT: NONE (scrape error)' };
  }
}

async function scrapeFlightsForDate(
  page: Page,
  dir: 'depart' | 'return',
  date: string,
  opts?: { ensureDirect?: boolean; onDirectOk?: () => void },
): Promise<FlightSlot[]> {
  try {
    const clicked = await pageEval(page, clickCxDateCell, dir, date);
    if (clicked !== true) {
      cxlog(`timeslots: date cell not found ${dir} ${date}`);
      return [];
    }
    await pause.short();
    if (opts?.ensureDirect) {
      const ok = await ensureDirectFlightCheckbox(page, true, {
        waitMs: 8_000,
        label: `date-${date}`,
      });
      if (ok) opts.onDirectOk?.();
    }
    let best: FlightSlot[] = [];
    for (let i = 0; i < 16; i++) {
      await pause.poll(500);
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
