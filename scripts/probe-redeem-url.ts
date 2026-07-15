/**
 * Fill redeem form, click search, capture the real IBEFacade URL.
 *   pnpm exec tsx scripts/probe-redeem-url.ts
 */
import puppeteer from 'puppeteer';
import { installEvalShims, pageEval } from '../src/scraper/pageEval.js';

const REDEEM =
  'https://www.cathaypacific.com/cx/en_HK/book-a-trip/redeem-flights/redeem-flight-awards.html';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function main() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run'],
  });
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  await installEvalShims(page);

  const urls: string[] = [];
  page.on('request', req => {
    const u = req.url();
    if (/IBEFacade/i.test(u)) {
      console.log('\n=== IBEFacade REQUEST ===');
      console.log(req.method(), u);
      urls.push(u);
      const post = req.postData();
      if (post) console.log('POST', post.slice(0, 2000));
    }
  });
  page.on('framenavigated', frame => {
    if (frame !== page.mainFrame()) return;
    const u = frame.url();
    if (/IBEFacade|availability|handler|sign-in/i.test(u)) {
      console.log('\n=== NAV ===');
      console.log(u);
      urls.push(u);
    }
  });

  console.log('goto redeem…');
  await page.goto(REDEEM, { waitUntil: 'networkidle2', timeout: 120_000 });
  await sleep(2500);

  // Dump full hidden field values (no truncation) from redemption forms
  const before = await pageEval(page, () => {
    const forms = [...document.querySelectorAll('form')].filter(
      f => (f.getAttribute('action') || '').includes('IBEFacade'),
    );
    return forms.map(f => {
      const fields: Record<string, string> = {};
      for (const el of f.querySelectorAll('input, select')) {
        const name = el.getAttribute('name');
        if (!name) continue;
        fields[name] = (el as HTMLInputElement).value ?? '';
      }
      return { action: f.getAttribute('action'), method: f.method, fields };
    });
  });
  console.log('\n=== FORMS BEFORE ===');
  console.log(JSON.stringify(before, null, 2));

  // Click One way if present, set OD via UI if possible, else set hidden fields + submit
  await pageEval(page, () => {
    const clickText = (re: RegExp) => {
      const el = [...document.querySelectorAll('button, label, span, a, div')].find(n =>
        re.test((n.textContent || '').replace(/\s+/g, ' ').trim()),
      ) as HTMLElement | undefined;
      el?.click();
      return !!el;
    };
    clickText(/^one[\s-]?way$/i);
  });
  await sleep(800);

  // Prefer the redemption search button path: set values on the redemption form then click
  const prepared = await pageEval(
    page,
    (origin: string, dest: string, dateIso: string) => {
      const ymd = dateIso.replace(/-/g, '');
      // Prefer form that has ORIGIN[1] and is near redemption button
      const forms = [...document.querySelectorAll('form')].filter(f =>
        (f.getAttribute('action') || '').includes('IBEFacade'),
      );
      const form =
        forms.find(f => {
          const hasOrigin = !!f.querySelector('input[name="ORIGIN[1]"]');
          const hasCabin = !!f.querySelector('input[name="CABINCLASS"]');
          const hasNoLeg2 = !f.querySelector('input[name="ORIGIN[2]"]');
          return hasOrigin && hasCabin && hasNoLeg2;
        }) ?? forms[0];
      if (!form) return { ok: false, reason: 'no form' };

      const set = (name: string, value: string) => {
        const el = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
        if (el) el.value = value;
      };
      set('ORIGIN[1]', origin);
      set('DESTINATION[1]', dest);
      set('DEPARTUREDATE[1]', ymd);
      set('CABINCLASS', 'C');
      set('ADULT', '1');
      set('CHILD', '0');
      set('FLEXIBLEDATE', 'true');
      set('BRAND', 'CX');

      const fields: Record<string, string> = {};
      for (const el of form.querySelectorAll('input, select')) {
        const name = el.getAttribute('name');
        if (!name) continue;
        fields[name] = (el as HTMLInputElement).value ?? '';
      }

      const btn = document.querySelector<HTMLButtonElement>('#redemption-booking-search-btn');
      return {
        ok: true,
        fields,
        btnText: (btn?.textContent || '').trim(),
        btnDisabled: btn?.disabled ?? null,
      };
    },
    'HKG',
    'NRT',
    '2026-09-11',
  );
  console.log('\n=== PREPARED ===');
  console.log(JSON.stringify(prepared, null, 2));

  // Build URL the same way the browser would from the form fields (GET)
  const builtFromDom = await pageEval(page, () => {
    const forms = [...document.querySelectorAll('form')].filter(f =>
      (f.getAttribute('action') || '').includes('IBEFacade'),
    );
    const form =
      forms.find(f => {
        const hasOrigin = !!f.querySelector('input[name="ORIGIN[1]"]');
        const hasNoLeg2 = !f.querySelector('input[name="ORIGIN[2]"]');
        return hasOrigin && hasNoLeg2;
      }) ?? forms[0];
    if (!form) return null;
    const action = form.getAttribute('action') || '';
    const params = new URLSearchParams();
    for (const el of form.querySelectorAll('input, select')) {
      const name = el.getAttribute('name');
      if (!name) continue;
      params.append(name, (el as HTMLInputElement).value ?? '');
    }
    return `${action}?${params.toString()}`;
  });
  console.log('\n=== URL BUILT FROM DOM FORM ===');
  console.log(builtFromDom);

  // Click real search button and wait for navigation
  console.log('\nclicking #redemption-booking-search-btn…');
  try {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => null),
      page.click('#redemption-booking-search-btn'),
    ]);
  } catch (e) {
    console.log('click/nav error', String(e));
    // Fallback: navigate to DOM-built URL
    if (builtFromDom) {
      console.log('fallback goto built URL');
      await page.goto(builtFromDom, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    }
  }
  await sleep(5000);
  console.log('\n=== FINAL PAGE URL ===');
  console.log(page.url());
  console.log('\n=== CAPTURED IBEFacade URLs ===');
  for (const u of urls) console.log(u);

  await sleep(2000);
  await browser.close();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
