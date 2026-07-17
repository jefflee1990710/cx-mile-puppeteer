/**
 * Explore CX sign-in membership-number switch (no credentials needed).
 *   pnpm exec tsx scripts/probe-membership-login.ts
 */
import puppeteer from 'puppeteer';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { installEvalShims } from '../src/scraper/pageEval.js';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function dumpSignIn(page: import('puppeteer').Page, label: string) {
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
    const summarize = (el: Element) => {
      const h = el as HTMLElement & { type?: string; disabled?: boolean };
      return {
        tag: el.tagName,
        type: h.type || null,
        name: el.getAttribute('name'),
        id: el.id || null,
        role: el.getAttribute('role'),
        href: el.getAttribute('href'),
        ariaLabel: el.getAttribute('aria-label'),
        placeholder: el.getAttribute('placeholder'),
        dataTealium: el.getAttribute('data-tealium-event-action'),
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140),
        cls: String(el.className || '').slice(0, 140),
        visible: isVisible(el),
        disabled: !!h.disabled,
      };
    };
    const root = document.querySelector('.masterSignIn') || document.body;
    if (!root) return { error: 'no root' };
    const clickables = [...root.querySelectorAll('a,button,[role=button],label,span')]
      .filter(el => {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const teal = (el.getAttribute('data-tealium-event-action') || '').toLowerCase();
        return (
          /membership|member|mobile|email|phone|sign.?in|login|account|號碼|會員|手機|電郵|use |switch/.test(t) ||
          /membership|member|mobile|email/.test(teal) ||
          /membership|member|mobile|email/.test(el.id || '') ||
          /membership|member|mobile|email/.test(String(el.className || ''))
        );
      })
      .slice(0, 80)
      .map(summarize);
    const inputs = [...document.querySelectorAll('input,select,textarea')].map(summarize);
    const masterHtml = (document.querySelector('.masterSignIn')?.innerHTML || '').slice(0, 4000);
    return {
      url: location.href,
      title: document.title,
      body: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 2000),
      inputs,
      clickables,
      hasMaster: !!document.querySelector('.masterSignIn'),
      masterHtml,
    };
  });
  console.log('===', label, '===');
  console.log(JSON.stringify(probe, null, 2));
  return probe;
}

async function main() {
  const userDataDir = path.join(os.homedir(), '.cx-mile-puppeteer', 'chrome-profile-probe');
  fs.mkdirSync(userDataDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless: false,
    channel: 'chrome',
    defaultViewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-default-browser-check',
      '--no-first-run',
      '--window-size=1280,900',
    ],
    userDataDir,
  });
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  await installEvalShims(page);

  console.log('goto sign-in...');
  await page.goto('https://www.cathaypacific.com/cx/en_HK/sign-in.html', {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
  });

  // Wait for login form to hydrate
  for (let i = 0; i < 40; i++) {
    const ready = await page.evaluate(() => {
      const tel = document.querySelector('input[type="tel"]');
      const master = document.querySelector('.masterSignIn');
      return !!(tel || master);
    });
    if (ready) break;
    await sleep(500);
  }
  await sleep(1500);
  await dumpSignIn(page, 'initial');

  const clicked = await page.evaluate(() => {
    const isVisible = (el: Element | null) => {
      if (!el) return false;
      let cur: Element | null = el;
      while (cur) {
        if (cur.hasAttribute('hidden') || cur.getAttribute('aria-hidden') === 'true') return false;
        const cls = typeof (cur as HTMLElement).className === 'string' ? (cur as HTMLElement).className : '';
        if (/\b(hidden|d-none|ng-hide)\b/.test(cls)) return false;
        cur = cur.parentElement;
      }
      const r = (el as HTMLElement).getBoundingClientRect?.();
      return !r || (r.width > 0 && r.height > 0);
    };
    const candidates = [...document.querySelectorAll('a,button,[role=button],label,span,div')];
    const scored = candidates
      .map(el => {
        if (!isVisible(el)) return null;
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const teal = (el.getAttribute('data-tealium-event-action') || '').toLowerCase();
        let score = 0;
        if (/membership number|member number|membership no|會員編號|會員號碼/.test(t)) score += 10;
        if (/use (my )?membership|sign in with membership|login with membership/.test(t)) score += 8;
        if (t.includes('membership') && t.length < 80) score += 5;
        if (/membership/.test(teal)) score += 6;
        if (/mobile|email|phone/.test(t) && /instead|or |use /.test(t)) score += 3;
        // Prefer leafy controls
        if (el.children.length > 3) score -= 2;
        if (!score) return null;
        return { el, score, t: t.slice(0, 120), tag: el.tagName, teal };
      })
      .filter(Boolean)
      .sort((a, b) => (b!.score - a!.score)) as Array<{
      el: Element;
      score: number;
      t: string;
      tag: string;
      teal: string;
    }>;

    console.log(
      'membership candidates',
      scored.slice(0, 10).map(s => ({ score: s.score, t: s.t, tag: s.tag, teal: s.teal })),
    );
    const hit = scored[0]?.el as HTMLElement | undefined;
    if (!hit) return { ok: false, reason: 'no membership control found', top: scored.slice(0, 5) };
    hit.click();
    return {
      ok: true,
      text: (hit.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      tag: hit.tagName,
      id: hit.id,
      cls: String(hit.className || '').slice(0, 120),
      teal: hit.getAttribute('data-tealium-event-action'),
      score: scored[0].score,
    };
  });
  console.log('CLICK RESULT', clicked);
  await sleep(2500);
  await dumpSignIn(page, 'after-membership-click');

  // Also try clicking links containing "membership" inside masterSignIn only
  if (!clicked || !(clicked as { ok?: boolean }).ok) {
    const alt = await page.evaluate(() => {
      const root = document.querySelector('.masterSignIn') || document;
      const links = [...root.querySelectorAll('a,button,[role=button]')];
      const hit = links.find(el => /membership/i.test(el.textContent || ''));
      if (!hit) return { ok: false };
      (hit as HTMLElement).click();
      return { ok: true, text: (hit.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) };
    });
    console.log('ALT CLICK', alt);
    await sleep(2500);
    await dumpSignIn(page, 'after-alt-click');
  }

  await sleep(2000);
  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
