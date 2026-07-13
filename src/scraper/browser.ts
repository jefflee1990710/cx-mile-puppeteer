import puppeteer, { type Browser, type Page } from 'puppeteer';
import { cxlog } from './log.js';
import { installEvalShims } from './pageEval.js';

let browser: Browser | null = null;
let page: Page | null = null;

export async function getPage(): Promise<Page> {
  if (page && !page.isClosed()) return page;
  if (!browser || !browser.connected) {
    cxlog('launching headed Chromium');
    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: { width: 1280, height: 900 },
      args: ['--disable-blink-features=AutomationControlled'],
    });
  }
  const pages = await browser.pages();
  page = pages[0] ?? (await browser.newPage());
  await installEvalShims(page);
  return page;
}

export async function closeBrowser(): Promise<void> {
  page = null;
  if (browser) {
    try {
      await browser.close();
    } catch (e) {
      cxlog('browser close error', String(e));
    }
    browser = null;
  }
}
