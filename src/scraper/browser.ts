import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Browser, LaunchOptions, Page } from 'puppeteer';
import { FINGERPRINT, FINGERPRINT_INIT_SCRIPT, userAgentForChromeVersion } from './fingerprint.js';
import { ensureVisibleMouse } from './human.js';
import { cxlog } from './log.js';
import { installEvalShims } from './pageEval.js';

// puppeteer-extra is CJS; load via require for stable .use/.launch typings under NodeNext.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const puppeteer = require('puppeteer-extra') as {
  use: (plugin: unknown) => void;
  launch: (options?: LaunchOptions) => Promise<Browser>;
  connect: (options: { browserWSEndpoint: string; defaultViewport?: null }) => Promise<Browser>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const StealthPlugin = require('puppeteer-extra-plugin-stealth') as () => unknown;
puppeteer.use(StealthPlugin());

let browser: Browser | null = null;
let page: Page | null = null;
/** Session-pinned proxy / CDP endpoint for this process (set at first launch). */
let sessionMeta: { proxy?: string; browserWs?: string } | null = null;

function readProxyServer(): string | undefined {
  const raw =
    process.env.CX_PROXY_SERVER?.trim() || process.env.HTTPS_PROXY?.trim() || process.env.HTTP_PROXY?.trim();
  return raw || undefined;
}

function readBrowserWs(): string | undefined {
  return process.env.CX_BROWSER_WS?.trim() || process.env.BROWSERLESS_WS?.trim() || undefined;
}

/** Attach to an already-running Chrome (same as the extension: real profile + cookies). */
function readCdpHttp(): string | undefined {
  return process.env.CX_CDP_URL?.trim() || process.env.CX_CHROME_CDP?.trim();
}

async function connectViaCdpHttp(httpBase: string): Promise<Browser> {
  const base = httpBase.replace(/\/$/, '');
  const res = await fetch(`${base}/json/version`);
  if (!res.ok) throw new Error(`CDP /json/version failed HTTP ${res.status}`);
  const json = (await res.json()) as { webSocketDebuggerUrl?: string };
  if (!json.webSocketDebuggerUrl) throw new Error('CDP response missing webSocketDebuggerUrl');
  cxlog('connecting to existing Chrome via CDP', base);
  return puppeteer.connect({
    browserWSEndpoint: json.webSocketDebuggerUrl,
    defaultViewport: null,
  });
}

/** Persistent profile so Akamai/_abck cookies survive between runs (closer to the extension). */
function chromeUserDataDir(): string {
  const override = process.env.CX_CHROME_PROFILE?.trim();
  const dir = override || path.join(os.homedir(), '.cx-mile-puppeteer', 'chrome-profile');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function applyPageFingerprint(p: Page, ua: string): Promise<void> {
  await p.setUserAgent(ua);
  await p.setViewport({ ...FINGERPRINT.viewport });
  await p.setExtraHTTPHeaders({
    'Accept-Language': FINGERPRINT.languages.join(','),
  });
  await p.evaluateOnNewDocument(FINGERPRINT_INIT_SCRIPT);
  await installEvalShims(p);
  // Before any CX navigation so the debug pointer appears on every document.
  await ensureVisibleMouse(p);
  try {
    await p.evaluate(FINGERPRINT_INIT_SCRIPT);
  } catch {
    // about:blank mid-load
  }
}

async function launchLocalBrowser(): Promise<Browser> {
  const proxy = readProxyServer();
  const args = [
    '--disable-blink-features=AutomationControlled',
    '--no-default-browser-check',
    '--no-first-run',
    `--lang=${FINGERPRINT.locale}`,
    `--window-size=${FINGERPRINT.viewport.width},${FINGERPRINT.viewport.height}`,
  ];
  if (proxy) {
    args.push(`--proxy-server=${proxy}`);
    cxlog('using session-pinned proxy', proxy.replace(/:[^:@/]+@/, ':***@'));
  }

  const userDataDir = chromeUserDataDir();
  // Prefer installed Google Chrome (real TLS + cookies) — bundled Chromium is what Akamai
  // often Access-Denies. Falls back to Puppeteer's Chromium if Chrome is missing.
  const preferChrome = process.env.CX_USE_BUNDLED_CHROMIUM?.trim() !== '1';
  const opts: LaunchOptions = {
    headless: false,
    defaultViewport: null,
    args,
    ignoreDefaultArgs: ['--enable-automation'],
    userDataDir,
  };
  if (preferChrome) {
    opts.channel = 'chrome';
    cxlog('launching system Chrome with persistent profile', userDataDir);
  } else {
    cxlog('launching bundled Chromium (CX_USE_BUNDLED_CHROMIUM=1)', userDataDir);
  }

  try {
    const b = await puppeteer.launch(opts);
    const user = process.env.CX_PROXY_USER?.trim();
    const pass = process.env.CX_PROXY_PASS?.trim();
    if (proxy && user) {
      b.on('targetcreated', async target => {
        try {
          const p = await target.page();
          if (p) await p.authenticate({ username: user, password: pass ?? '' });
        } catch {
          // ignore
        }
      });
    }
    return b;
  } catch (e) {
    if (preferChrome) {
      cxlog('system Chrome unavailable, falling back to bundled Chromium', String(e));
      delete opts.channel;
      const b = await puppeteer.launch(opts);
      return b;
    }
    throw e;
  }
}

async function connectRemoteBrowser(ws: string): Promise<Browser> {
  cxlog('connecting remote browser (TLS fingerprint via provider)', ws.replace(/token=[^&]+/i, 'token=***'));
  return puppeteer.connect({
    browserWSEndpoint: ws,
    defaultViewport: null,
  });
}

export async function getPage(): Promise<Page> {
  if (page && !page.isClosed()) return page;

  if (!browser || !browser.connected) {
    const browserWs = readBrowserWs();
    const cdpHttp = readCdpHttp();
    const proxy = readProxyServer();
    sessionMeta = { proxy, browserWs: browserWs || cdpHttp };

    if (browserWs) {
      browser = await connectRemoteBrowser(browserWs);
    } else if (cdpHttp) {
      browser = await connectViaCdpHttp(cdpHttp);
    } else {
      cxlog('launching headed browser (stealth + fingerprint)');
      browser = await launchLocalBrowser();
    }
  }

  const pages = await browser.pages();
  page = pages[0] ?? (await browser.newPage());

  const user = process.env.CX_PROXY_USER?.trim();
  const pass = process.env.CX_PROXY_PASS?.trim();
  if (sessionMeta?.proxy && user) {
    await page.authenticate({ username: user, password: pass ?? '' });
  }

  let ua: string = FINGERPRINT.userAgent;
  try {
    ua = userAgentForChromeVersion(await browser.version());
  } catch {
    // keep default
  }
  await applyPageFingerprint(page, ua);

  try {
    const client = await page.createCDPSession();
    await client.send('Emulation.setTimezoneOverride', { timezoneId: FINGERPRINT.timezoneId });
    await client.send('Emulation.setLocaleOverride', { locale: FINGERPRINT.locale });
  } catch (e) {
    cxlog('locale/timezone override skipped', String(e));
  }

  return page;
}

export function getSessionMeta(): { proxy?: string; browserWs?: string } | null {
  return sessionMeta;
}

export async function closeBrowser(): Promise<void> {
  page = null;
  if (browser) {
    try {
      if (sessionMeta?.browserWs) {
        browser.disconnect();
      } else {
        await browser.close();
      }
    } catch (e) {
      cxlog('browser close error', String(e));
    }
    browser = null;
  }
}
