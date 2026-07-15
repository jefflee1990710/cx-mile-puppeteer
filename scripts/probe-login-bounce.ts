/**
 * Verify unauthenticated award search is classified as login (IBE_USR005), not timeout.
 *   pnpm exec tsx scripts/probe-login-bounce.ts
 */
import puppeteer from 'puppeteer';
import { openAwardSearch } from '../src/scraper/awardSearch.js';
import { installEvalShims } from '../src/scraper/pageEval.js';
import type { Combo } from '../src/scraper/types.js';

async function main() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 14);
  const iso = tomorrow.toISOString().slice(0, 10);

  const combo: Combo = {
    origin: 'HKG',
    dest: 'NRT',
    cabin: 'bus',
    range: { start: iso, end: iso },
    adults: 1,
  };

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  await installEvalShims(page);

  console.log('combo', combo);
  const t0 = Date.now();
  const nav = await openAwardSearch(page, combo);
  console.log('outcome', nav, 'in', Date.now() - t0, 'ms');
  console.log('url', page.url());
  await browser.close();
  if (nav !== 'login') {
    console.error('EXPECTED login (IBE_USR005 bounce), got', nav);
    process.exit(1);
  }
  console.log('OK: login bounce detected');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
