/**
 * Capture redirect chain + cookies for award search (diagnose Akamai Access Denied).
 *   pnpm exec tsx scripts/probe-network-award.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { buildAwardSearchUrl } from '../src/scraper/buildUrl.js';
import { installEvalShims } from '../src/scraper/pageEval.js';
import type { Combo } from '../src/scraper/types.js';

puppeteer.use(StealthPlugin());

const REDEEM =
  'https://www.cathaypacific.com/cx/en_HK/book-a-trip/redeem-flights/redeem-flight-awards.html';
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function main() {
  const iso = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const combo: Combo = {
    origin: 'HKG',
    dest: 'NRT',
    cabin: 'eco',
    range: { start: iso, end: iso },
    adults: 1,
  };
  const searchUrl = buildAwardSearchUrl(combo);
  console.log('searchUrl', searchUrl);

  const profile = path.join(os.homedir(), '.cx-mile-puppeteer', 'chrome-profile-probe');
  fs.mkdirSync(profile, { recursive: true });

  const browser = await puppeteer.launch({
    headless: false,
    channel: 'chrome',
    userDataDir: profile,
    defaultViewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--window-size=1280,900',
    ],
  });

  const page = (await browser.pages())[0] ?? (await browser.newPage());
  await installEvalShims(page);

  const events: Array<Record<string, unknown>> = [];
  const log = (row: Record<string, unknown>) => {
    events.push(row);
    console.log(JSON.stringify(row));
  };

  page.on('request', req => {
    const u = req.url();
    if (/IBEFacade|availability|queue\.|redibe|edgesuite|Access/i.test(u)) {
      log({
        t: 'req',
        method: req.method(),
        url: u.slice(0, 400),
        resourceType: req.resourceType(),
        headers: {
          referer: req.headers().referer,
          origin: req.headers().origin,
          'user-agent': (req.headers()['user-agent'] || '').slice(0, 80),
          cookie: (req.headers().cookie || '').slice(0, 200),
        },
      });
    }
  });
  page.on('response', async res => {
    const u = res.url();
    if (/IBEFacade|availability|queue\.|redibe|edgesuite/i.test(u)) {
      log({
        t: 'res',
        status: res.status(),
        url: u.slice(0, 400),
        location: res.headers().location?.slice(0, 300),
      });
    }
  });
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) log({ t: 'nav', url: frame.url().slice(0, 400) });
  });

  console.log('\n=== STEP 1: redeem page ===');
  await page.goto(REDEEM, { waitUntil: 'networkidle2', timeout: 120_000 });
  await sleep(3000);
  const cookies1 = await page.cookies(
    'https://www.cathaypacific.com',
    'https://api.cathaypacific.com',
    'https://book.cathaypacific.com',
  );
  log({
    t: 'cookies-after-redeem',
    names: cookies1.map(c => `${c.name}@${c.domain}`).sort(),
  });

  console.log('\n=== STEP 2A: page.goto(IBEFacade) like puppeteer ===');
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(e =>
    log({ t: 'goto-error', error: String(e) }),
  );
  await sleep(5000);
  const titleA = await page.title();
  const bodyA = await page.evaluate(() => (document.body?.innerText || '').slice(0, 300));
  log({ t: 'after-goto', url: page.url(), title: titleA, body: bodyA });

  console.log('\n=== STEP 2B: back to redeem, then location.assign with referrer ===');
  await page.goto(REDEEM, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await sleep(2000);
  await page.evaluate(`(url => { window.location.assign(url); })(${JSON.stringify(searchUrl)})`);
  await sleep(8000);
  const titleB = await page.title();
  const bodyB = await page.evaluate(() => (document.body?.innerText || '').slice(0, 300));
  log({ t: 'after-assign', url: page.url(), title: titleB, body: bodyB });

  console.log('\n=== STEP 2C: fill hidden form + submit (true browser submit) ===');
  await page.goto(REDEEM, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await sleep(2500);
  const submitted = await page.evaluate(
    (origin: string, dest: string, ymd: string, cabin: string) => {
      const forms = [...document.querySelectorAll('form')].filter(f =>
        (f.getAttribute('action') || '').includes('IBEFacade'),
      );
      const form =
        forms.find(f => f.querySelector('input[name="ORIGIN[1]"]') && !f.querySelector('input[name="ORIGIN[2]"]')) ??
        forms[0];
      if (!form) return { ok: false, reason: 'no form' };
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
      set('ORIGIN[1]', origin);
      set('DESTINATION[1]', dest);
      set('DEPARTUREDATE[1]', ymd);
      set('CABINCLASS', cabin);
      set('ADULT', '1');
      set('CHILD', '0');
      set('FLEXIBLEDATE', 'true');
      set('BRAND', 'CX');
      set('ACTION', 'RED_AWARD_SEARCH');
      set('isChecked', 'TRUE');
      set('LOGINURL', 'https://www.cathaypacific.com/cx/en_HK/sign-in.html');
      // Prefer native submit so Referer is the redeem page
      form.submit();
      return { ok: true };
    },
    combo.origin,
    combo.dest,
    iso.replace(/-/g, ''),
    'Y',
  );
  log({ t: 'form-submit', submitted });
  await sleep(10000);
  const titleC = await page.title();
  const bodyC = await page.evaluate(() => (document.body?.innerText || '').slice(0, 300));
  log({ t: 'after-form-submit', url: page.url(), title: titleC, body: bodyC });

  const out = path.join(os.tmpdir(), 'cx-award-network.json');
  fs.writeFileSync(out, JSON.stringify(events, null, 2));
  console.log('\nWrote', out, 'events', events.length);
  await browser.close();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
