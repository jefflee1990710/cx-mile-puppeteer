/**
 * Probe CX award results for the Direct / 直航 checkbox.
 * Leave an availability/results tab open, then:
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
    pages.find(p => /availability|awai|book\.cathay|redeem|sign-in/i.test(p.url()) && p.url() !== 'about:blank') ??
    pages[0];
  if (!page) throw new Error('no page');
  await installEvalShims(page);
  console.log('url', page.url());

  const info = await page.evaluate(() => {
    const body = (document.body?.innerText || '').replace(/\s+/g, ' ');
    const hasDirectWord = /直航|Direct flight|Direct\b/i.test(body);
    const hits: unknown[] = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let n = walk.nextNode();
    while (n && hits.length < 40) {
      const el = n as HTMLElement;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const aria = el.getAttribute('aria-label') || '';
      if (/直航|^Direct(\s+flights?)?$/i.test(t) || /直航|Direct/i.test(aria)) {
        if (t.length <= 80) {
          hits.push({
            tag: el.tagName,
            cls: String(el.className || '').slice(0, 100),
            id: el.id || null,
            role: el.getAttribute('role'),
            ariaChecked: el.getAttribute('aria-checked'),
            ariaLabel: aria || null,
            text: t.slice(0, 80),
            html: el.outerHTML.slice(0, 280),
          });
        }
      }
      n = walk.nextNode();
    }
    const inputs = [...document.querySelectorAll('input')].map(i => ({
      type: i.type,
      name: i.name,
      id: i.id,
      checked: i.checked,
      cls: String(i.className).slice(0, 80),
      aria: i.getAttribute('aria-label'),
    }));
    return { hasDirectWord, hits, inputs: inputs.slice(0, 40), title: document.title };
  });
  console.log(JSON.stringify(info, null, 2));
  browser.disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
