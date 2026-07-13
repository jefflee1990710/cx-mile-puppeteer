/**
 * One-off login probe. Pass creds via env — never commit secrets.
 *   CX_CC=852 CX_MOBILE=... CX_PASSWORD=... pnpm exec tsx scripts/probe-login.ts
 */
import puppeteer from 'puppeteer';
import { performCxLogin } from '../src/scraper/login.js';
import {
  detectLoginProblem,
  detectLoginStep,
  hasVisiblePasswordField,
} from '../src/scraper/loginPageFns.js';
import { installEvalShims, pageEval } from '../src/scraper/pageEval.js';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function main() {
  const countryCode = process.env.CX_CC ?? '852';
  const mobile = process.env.CX_MOBILE ?? '';
  const password = process.env.CX_PASSWORD ?? '';
  if (!mobile || !password) {
    console.error('Set CX_MOBILE and CX_PASSWORD');
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  await installEvalShims(page);
  page.on('console', msg => console.log('PAGE:', msg.type(), msg.text()));

  console.log('goto sign-in...');
  await page.goto('https://www.cathaypacific.com/cx/en_HK/sign-in.html', {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await sleep(4000);
  console.log('url', page.url());
  console.log('step', await pageEval(page, detectLoginStep));
  console.log('problem', await pageEval(page, detectLoginProblem));

  const probe = await page.evaluate(() => {
    const isVisible = (el: Element | null) => {
      if (!el) return false;
      let cur: Element | null = el;
      while (cur) {
        if (cur.hasAttribute('hidden')) return false;
        if (cur.getAttribute('aria-hidden') === 'true') return false;
        const cls = typeof (cur as HTMLElement).className === 'string' ? (cur as HTMLElement).className : '';
        if (/\b(hidden|d-none|ng-hide)\b/.test(cls)) return false;
        const style = (cur as HTMLElement).style;
        if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
        cur = cur.parentElement;
      }
      const r = (el as HTMLElement).getBoundingClientRect?.();
      if (r && (r.width === 0 || r.height === 0)) return false;
      return true;
    };
    const inputs = [...document.querySelectorAll('input')].slice(0, 40).map(i => ({
      type: i.type,
      name: i.name,
      id: i.id,
      visible: isVisible(i),
      valueLen: i.value.length,
      cls: String(i.className).slice(0, 80),
    }));
    const buttons = [...document.querySelectorAll('button,[role=button]')].slice(0, 25).map(b => ({
      text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50),
      visible: isVisible(b),
      disabled: (b as HTMLButtonElement).disabled,
      ariaDisabled: b.getAttribute('aria-disabled'),
    }));
    return {
      title: document.title,
      inputs,
      buttons,
      bodySnippet: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 800),
    };
  });
  console.log(JSON.stringify(probe, null, 2));

  const result = await performCxLogin(page, { countryCode, mobile, password });
  console.log('LOGIN RESULT', result);
  console.log('final url', page.url());
  console.log('hasPw', await pageEval(page, hasVisiblePasswordField));
  console.log('step after', await pageEval(page, detectLoginStep));
  console.log('problem after', await pageEval(page, detectLoginProblem));

  const after = await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 800));
  console.log('body after', after);

  await sleep(8000);
  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
