/**
 * Full scan probe: award search → login if needed → scrape → leave results.
 *   CX_CC=852 CX_MOBILE=... CX_PASSWORD=... pnpm exec tsx scripts/probe-scan.ts
 */
import puppeteer from 'puppeteer';
import { openAwardSearch, readAwardResults, returnToRedeem } from '../src/scraper/awardSearch.js';
import { installEvalShims, pageEval } from '../src/scraper/pageEval.js';
import { performCxLogin } from '../src/scraper/login.js';
import {
  clickMobileContinue,
  detectLoginProblem,
  detectLoginStep,
  fillMobileNumber,
  hasVisiblePasswordField,
} from '../src/scraper/loginPageFns.js';
import type { Combo } from '../src/scraper/types.js';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function dumpLoginDom(page: import('puppeteer').Page, label: string) {
  const info = await page.evaluate(() => {
    const isVisible = (el: Element | null) => {
      if (!el) return false;
      let cur: Element | null = el;
      while (cur) {
        if (cur.hasAttribute('hidden')) return false;
        if (cur.getAttribute('aria-hidden') === 'true') return false;
        const cls = typeof (cur as HTMLElement).className === 'string' ? (cur as HTMLElement).className : '';
        if (/\b(hidden|d-none|ng-hide)\b/.test(cls)) return false;
        cur = cur.parentElement;
      }
      const r = (el as HTMLElement).getBoundingClientRect?.();
      return !!(r && r.width > 0 && r.height > 0);
    };
    const mobile = document.querySelector<HTMLInputElement>('input[type="tel"][name="mobile"]');
    const pw = document.querySelector<HTMLInputElement>('input#Password, input[type="password"]');
    const continueBtn =
      document.querySelector<HTMLButtonElement>('[data-tealium-event-action*="CONTINUE_BTN"]') ??
      document.querySelector<HTMLButtonElement>('button.masterSignIn__submitBtn');
    return {
      url: location.href,
      stepHint: {
        mobileVisible: isVisible(mobile),
        mobileValue: mobile?.value ?? '',
        pwVisible: isVisible(pw),
        continueDisabled: continueBtn?.disabled ?? null,
        continueText: (continueBtn?.textContent || '').trim(),
      },
      snippet: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 400),
    };
  });
  console.log(`[dump ${label}]`, JSON.stringify(info, null, 2));
}

async function main() {
  const countryCode = process.env.CX_CC ?? '852';
  const mobile = process.env.CX_MOBILE ?? '';
  const password = process.env.CX_PASSWORD ?? '';
  if (!mobile || !password) {
    console.error('Set CX_MOBILE and CX_PASSWORD');
    process.exit(1);
  }

  const combo: Combo = {
    origin: process.env.CX_ORIGIN ?? 'HKG',
    dest: process.env.CX_DEST ?? 'NRT',
    cabin: 'bus',
    range: {
      start: process.env.CX_DATE ?? '2026-09-11',
      end: process.env.CX_DATE ?? '2026-09-11',
    },
    adults: 1,
  };

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  await installEvalShims(page);

  console.log('=== openAwardSearch', combo);
  let nav = await openAwardSearch(page, combo);
  console.log('nav1', nav, page.url());

  if (nav === 'login') {
    console.log('=== login wall — diagnosing');
    await dumpLoginDom(page, 'before-login');
    console.log('step', await pageEval(page, detectLoginStep));
    console.log('problem', await pageEval(page, detectLoginProblem));

    // Step-through fill for diagnostics
    const filled = await pageEval(page, fillMobileNumber, countryCode, mobile);
    console.log('filled mobile', filled);
    await sleep(500);
    await dumpLoginDom(page, 'after-fill');
    let continued = false;
    for (let i = 0; i < 8 && !continued; i++) {
      continued = (await pageEval(page, clickMobileContinue)) === true;
      console.log('continue try', i, continued);
      if (!continued) await sleep(400);
    }
    await dumpLoginDom(page, 'after-continue');
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const hasPw = await pageEval(page, hasVisiblePasswordField);
      const step = await pageEval(page, detectLoginStep);
      const problem = await pageEval(page, detectLoginProblem);
      console.log(`wait pw ${i}`, { hasPw, step, problem, url: page.url() });
      if (hasPw || problem || !/sign-in|\/login/i.test(new URL(page.url()).pathname)) break;
    }

    // Full login path (page may already be mid-flow — reload sign-in if needed)
    if (!(await pageEval(page, hasVisiblePasswordField)) && /sign-in/i.test(page.url())) {
      console.log('=== retry performCxLogin from current page');
    }
    const login = await performCxLogin(page, { countryCode, mobile, password });
    console.log('login', login, page.url());
    if (login !== 'ok') {
      await dumpLoginDom(page, 'login-failed');
      await sleep(3000);
      await browser.close();
      process.exit(2);
    }
    nav = await openAwardSearch(page, combo);
    console.log('nav2', nav, page.url());
  }

  if (nav !== 'ok') {
    console.log('SEARCH FAILED', nav);
    await sleep(3000);
    await browser.close();
    process.exit(3);
  }

  console.log('=== readAwardResults');
  const result = await readAwardResults(page, combo);
  console.log('RESULT', JSON.stringify(result, null, 2));

  console.log('=== returnToRedeem');
  await returnToRedeem(page);
  console.log('final url', page.url());

  await sleep(2000);
  await browser.close();
  console.log('=== DONE ok');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
