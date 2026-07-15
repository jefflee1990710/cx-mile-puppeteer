import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Browser, LaunchOptions, Page } from 'puppeteer';
import {
  FINGERPRINT,
  buildFingerprintInitScript,
  userAgentForChromeVersion,
} from './fingerprint.js';
import { ensureVisibleMouse } from './human.js';
import { cxlog } from './log.js';
import { installEvalShims } from './pageEval.js';

// puppeteer-extra is CJS; load via require for stable .use/.launch typings under NodeNext.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const puppeteerStealth = require('puppeteer-extra') as {
  use: (plugin: unknown) => void;
  launch: (options?: LaunchOptions) => Promise<Browser>;
  connect: (options: { browserWSEndpoint: string; defaultViewport?: null }) => Promise<Browser>;
};
// Vanilla Puppeteer — stealth/fingerprint patches themselves trip Akamai on CX.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const puppeteerVanilla = require('puppeteer') as {
  launch: (options?: LaunchOptions) => Promise<Browser>;
  connect: (options: { browserWSEndpoint: string; defaultViewport?: null }) => Promise<Browser>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const StealthPlugin = require('puppeteer-extra-plugin-stealth') as () => unknown;
puppeteerStealth.use(StealthPlugin());

let browser: Browser | null = null;
let page: Page | null = null;
/** True when attached to an already-running Chrome (extension-like path). */
let cdpAttached = false;
/**
 * True when we launched system Google Chrome without stealth/fingerprint.
 * Same philosophy as CDP: leave the real browser alone.
 */
let nativeChrome = false;
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

/** Opt back into stealth + spoofed fingerprint (debug only — usually worsens Akamai). */
function forceFingerprint(): boolean {
  return process.env.CX_FORCE_FINGERPRINT?.trim() === '1';
}

async function connectViaCdpHttp(httpBase: string): Promise<Browser> {
  const base = httpBase.replace(/\/$/, '');
  const res = await fetch(`${base}/json/version`);
  if (!res.ok) throw new Error(`CDP /json/version failed HTTP ${res.status}`);
  const json = (await res.json()) as { webSocketDebuggerUrl?: string };
  if (!json.webSocketDebuggerUrl) throw new Error('CDP response missing webSocketDebuggerUrl');
  cxlog('connecting to existing Chrome via CDP (no stealth)', base);
  return puppeteerVanilla.connect({
    browserWSEndpoint: json.webSocketDebuggerUrl,
    defaultViewport: null,
  });
}

/** Prefer an existing CX tab (same idea as the extension's active tab). */
async function pickCxPage(b: Browser): Promise<Page> {
  const pages = await b.pages();
  const cx =
    pages.find(p => /cathaypacific\.com/i.test(p.url())) ??
    pages.find(p => !/^chrome:\/\//i.test(p.url()) && p.url() !== 'about:blank');
  return cx ?? pages[0] ?? b.newPage();
}

/** Persistent profile so Akamai/_abck cookies survive between runs (closer to the extension). */
function chromeUserDataDir(): string {
  const override = process.env.CX_CHROME_PROFILE?.trim();
  const dir = override || path.join(os.homedir(), '.cx-mile-puppeteer', 'chrome-profile');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function baseLaunchArgs(proxy?: string): string[] {
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
  return args;
}

function attachProxyAuth(b: Browser, proxy: string | undefined): void {
  const user = process.env.CX_PROXY_USER?.trim();
  const pass = process.env.CX_PROXY_PASS?.trim();
  if (!proxy || !user) return;
  b.on('targetcreated', async target => {
    try {
      const p = await target.page();
      if (p) await p.authenticate({ username: user, password: pass ?? '' });
    } catch {
      // ignore
    }
  });
}

async function applyPageFingerprint(p: Page, ua: string): Promise<void> {
  const initScript = buildFingerprintInitScript(FINGERPRINT);
  await p.setUserAgent(ua);
  await p.setViewport({ ...FINGERPRINT.viewport });
  await p.setExtraHTTPHeaders({
    'Accept-Language': FINGERPRINT.languages.join(','),
  });
  await p.evaluateOnNewDocument(initScript);
  await installEvalShims(p);
  await ensureVisibleMouse(p);
  try {
    await p.evaluate(initScript);
  } catch {
    // about:blank mid-load
  }
}

type LocalLaunch = { browser: Browser; systemChrome: boolean };

async function launchLocalBrowser(): Promise<LocalLaunch> {
  const proxy = readProxyServer();
  const userDataDir = chromeUserDataDir();
  const preferChrome = process.env.CX_USE_BUNDLED_CHROMIUM?.trim() !== '1';
  const opts: LaunchOptions = {
    headless: false,
    defaultViewport: null,
    args: baseLaunchArgs(proxy),
    ignoreDefaultArgs: ['--enable-automation'],
    userDataDir,
  };

  if (preferChrome) {
    opts.channel = 'chrome';
    // System Chrome: vanilla Puppeteer — no stealth. Patches diverge from real TLS/JS.
    cxlog('launching system Chrome (vanilla, no stealth)', userDataDir);
    try {
      const b = await puppeteerVanilla.launch(opts);
      attachProxyAuth(b, proxy);
      return { browser: b, systemChrome: true };
    } catch (e) {
      cxlog('system Chrome unavailable, falling back to bundled Chromium + stealth', String(e));
      delete opts.channel;
      const b = await puppeteerStealth.launch(opts);
      attachProxyAuth(b, proxy);
      return { browser: b, systemChrome: false };
    }
  }

  cxlog('launching bundled Chromium with stealth (CX_USE_BUNDLED_CHROMIUM=1)', userDataDir);
  const b = await puppeteerStealth.launch(opts);
  attachProxyAuth(b, proxy);
  return { browser: b, systemChrome: false };
}

async function connectRemoteBrowser(ws: string): Promise<Browser> {
  cxlog('connecting remote browser (TLS fingerprint via provider)', ws.replace(/token=[^&]+/i, 'token=***'));
  return puppeteerStealth.connect({
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
    cdpAttached = false;
    nativeChrome = false;

    if (browserWs) {
      browser = await connectRemoteBrowser(browserWs);
    } else if (cdpHttp) {
      browser = await connectViaCdpHttp(cdpHttp);
      cdpAttached = true;
    } else {
      const launched = await launchLocalBrowser();
      browser = launched.browser;
      nativeChrome = launched.systemChrome && !forceFingerprint();
    }
  }

  page = cdpAttached ? await pickCxPage(browser) : ((await browser.pages())[0] ?? (await browser.newPage()));

  const user = process.env.CX_PROXY_USER?.trim();
  const pass = process.env.CX_PROXY_PASS?.trim();
  if (sessionMeta?.proxy && user) {
    await page.authenticate({ username: user, password: pass ?? '' });
  }

  // CDP or native system Chrome: only the tsx __name shim. No UA/WebGL/mouse/emulation.
  if (cdpAttached || nativeChrome) {
    cxlog(
      cdpAttached
        ? 'CDP attach: leaving browser fingerprint untouched'
        : 'native Chrome: leaving browser fingerprint untouched (no stealth)',
    );
    await installEvalShims(page);
    return page;
  }

  let ua: string = FINGERPRINT.userAgent;
  try {
    ua = userAgentForChromeVersion(await browser.version());
  } catch {
    // keep default
  }
  cxlog('applying fingerprint (bundled/remote path)', FINGERPRINT.platform, ua.slice(0, 72));
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

/** True when controlling a user-launched Chrome via CX_CDP_URL (extension-like). */
export function isCdpAttached(): boolean {
  return cdpAttached;
}

/**
 * True when the browser should be left unpatched (CDP attach or system Chrome launch).
 * Skip warm-session mouse overlays that can trip Akamai sensors.
 */
export function isNativeBrowser(): boolean {
  return cdpAttached || nativeChrome;
}

export async function closeBrowser(): Promise<void> {
  page = null;
  cdpAttached = false;
  nativeChrome = false;
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
