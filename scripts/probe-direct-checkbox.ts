/**
 * Probe CX award results for the Direct / 直航 checkbox.
 *   pnpm exec tsx scripts/probe-direct-checkbox.ts
 */
import puppeteer from 'puppeteer';
import { installEvalShims } from '../src/scraper/pageEval.js';

async function main() {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    defaultViewport: null,
  });
  const pages = await browser.pages();
  const page =
    pages.find(p => /cathaypacific|availability|awai|redeem/i.test(p.url())) ?? pages[0];
  await installEvalShims(page);
  console.log('url', page.url());

  const info = await page.evaluate(() => {
    const summarize = (el: Element) => {
      const h = el as HTMLInputElement;
      return {
        tag: el.tagName,
        type: h.type || null,
        name: h.name || null,
        id: el.id || null,
        checked: !!h.checked,
        role: el.getAttribute('role'),
        ariaChecked: el.getAttribute('aria-checked'),
        ariaLabel: el.getAttribute('aria-label'),
        cls: String(el.className || '').slice(0, 120),
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        forAttr: el.getAttribute('for'),
      };
    };
    const body = (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 500);
    const nodes = [...document.querySelectorAll('input,label,button,[role=checkbox],span,div')]
      .filter(el => {
        const t = `${el.textContent || ''} ${el.getAttribute('aria-label') || ''} ${el.id} ${(el as HTMLInputElement).name || ''}`;
        return /直航|direct|non-?stop/i.test(t);
      })
      .slice(0, 40)
      .map(summarize);
    const checkboxes = [...document.querySelectorAll('input[type=checkbox],[role=checkbox]')].map(summarize);
    return { body, nodes, checkboxes, title: document.title };
  });
  console.log(JSON.stringify(info, null, 2));
  browser.disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
