import type { Page } from 'puppeteer';
import { isMidOAuthNavigation } from './cxBounce.js';
import { ensureVisibleMouse, humanClick, humanTypeInto, pause, warmSession } from './human.js';
import { cxlog } from './log.js';
import {
  clickMobileContinue,
  clickPasswordSignIn,
  detectLoginProblem,
  detectLoginStep,
  fillMobileNumber,
  fillPasswordValue,
  hasVisiblePasswordField,
} from './loginPageFns.js';
import { pageEval } from './pageEval.js';

export interface CxCreds {
  countryCode: string;
  mobile: string;
  password: string;
}

const MOBILE_SEL = 'input[type="tel"][name="mobile"], input[type="tel"]';
const PASSWORD_SEL = 'input#Password, input[name="password"][type="password"], input[type="password"]';
const CONTINUE_SEL =
  '[data-tealium-event-action*="CONTINUE_BTN"], button.masterSignIn__submitBtn';
const SIGNIN_SEL = '[data-tealium-event-action*="SIGN_IN_WITH_PASSWORD_BTN"]';

async function readInputValue(page: Page, selector: string): Promise<string> {
  return page.$eval(selector, el => (el as HTMLInputElement).value).catch(() => '');
}

async function fillMobileHuman(page: Page, countryCode: string, mobile: string): Promise<boolean> {
  // Prefer real cursor + keystrokes; fall back to React-aware evaluate fill.
  const typed = await humanTypeInto(page, MOBILE_SEL, mobile);
  if (typed) {
    const v = await readInputValue(page, MOBILE_SEL);
    if (v.replace(/\D/g, '') === mobile.replace(/\D/g, '')) return true;
  }
  cxlog('login: human mobile type incomplete — falling back to evaluate fill');
  return (await pageEval(page, fillMobileNumber, countryCode, mobile)) === true;
}

async function fillPasswordHuman(page: Page, password: string): Promise<boolean> {
  const typed = await humanTypeInto(page, PASSWORD_SEL, password);
  if (typed) {
    const v = await readInputValue(page, PASSWORD_SEL);
    if (v === password) return true;
  }
  cxlog('login: human password type incomplete — falling back to evaluate fill');
  return (await pageEval(page, fillPasswordValue, password)) === true;
}

async function clickContinueHuman(page: Page): Promise<boolean> {
  if (await humanClick(page, CONTINUE_SEL)) return true;
  return (await pageEval(page, clickMobileContinue)) === true;
}

async function clickSignInHuman(page: Page): Promise<boolean> {
  if (await page.$(SIGNIN_SEL)) {
    if (await humanClick(page, SIGNIN_SEL)) return true;
  }
  const handles = await page.$$('button.masterSignIn__btn, button, [role="button"]');
  for (const h of handles) {
    const text = await h.evaluate(el => (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase());
    if (text === 'sign in' || text === 'log in' || text === 'login' || text === '登入') {
      if (await humanClick(page, h)) return true;
    }
  }
  return (await pageEval(page, clickPasswordSignIn)) === true;
}

export async function performCxLogin(page: Page, creds: CxCreds): Promise<'ok' | 'failed'> {
  if (!creds.mobile || !creds.password) {
    cxlog('login: missing credentials');
    return 'failed';
  }

  // Award bounce may land on redeem RETURNURL — only then go to bare sign-in.
  // If already on sign-in?goto=oauth… KEEP that URL (createSession depends on it).
  const SIGN_IN = 'https://www.cathaypacific.com/cx/en_HK/sign-in.html';
  try {
    const path = new URL(page.url()).pathname;
    if (!/sign-in|\/login/i.test(path)) {
      cxlog('login: navigating to sign-in page');
      await page.goto(SIGN_IN, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await pause.page();
    } else {
      cxlog('login: staying on sign-in URL (preserving goto/OAuth state)', page.url().slice(0, 180));
    }
  } catch {
    cxlog('login: navigating to sign-in page');
    await page.goto(SIGN_IN, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => undefined);
    await pause.page();
  }

  // Visible cursor + Bezier moves for login fills (including CDP attach).
  await ensureVisibleMouse(page);
  await warmSession(page);

  let step: 'mobile' | 'password' | null = null;
  for (let i = 0; i < 20 && !step; i++) {
    const detected = await pageEval(page, detectLoginStep);
    if (detected === 'mobile' || detected === 'password') {
      step = detected;
      break;
    }
    if ((await pageEval(page, detectLoginProblem)) === true) {
      cxlog('login: CAPTCHA or error banner before form ready');
      return 'failed';
    }
    await pause.poll(600);
  }
  if (!step) {
    cxlog('login: no mobile/password form detected');
    return 'failed';
  }

  if (step === 'mobile') {
    await pause.short();
    const filled = await fillMobileHuman(page, creds.countryCode, creds.mobile);
    if (!filled) {
      cxlog('login: could not fill the mobile number');
      return 'failed';
    }
    await pause.action();

    let continued = false;
    for (let i = 0; i < 8 && !continued; i++) {
      continued = await clickContinueHuman(page);
      if (!continued) await pause.short();
    }
    if (!continued) {
      cxlog('login: could not click Continue after filling mobile');
      return 'failed';
    }

    await pause.page();

    let hasPw = false;
    for (let i = 0; i < 30 && !hasPw; i++) {
      await pause.poll(700);
      if ((await pageEval(page, detectLoginProblem)) === true) {
        cxlog('login: real CAPTCHA challenge or error banner at step 1');
        return 'failed';
      }
      hasPw = (await pageEval(page, hasVisiblePasswordField)) === true;
    }
    if (!hasPw) {
      cxlog('login: password field never appeared');
      return 'failed';
    }
  }

  await pause.short();
  let pwFilled = false;
  for (let i = 0; i < 8 && !pwFilled; i++) {
    pwFilled = await fillPasswordHuman(page, creds.password);
    if (!pwFilled) await pause.short();
  }
  if (!pwFilled) {
    cxlog('login: could not fill the password field');
    return 'failed';
  }
  await pause.action();

  let signedInClick = false;
  for (let i = 0; i < 8 && !signedInClick; i++) {
    signedInClick = await clickSignInHuman(page);
    if (!signedInClick) await pause.short();
  }
  if (!signedInClick) {
    cxlog('login: could not click Sign in on the password step');
    return 'failed';
  }

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await pause.poll(1200);
    let href = '';
    let path = '';
    try {
      const u = new URL(page.url());
      href = u.href;
      path = u.pathname;
    } catch {
      return 'failed';
    }
    // Still on the membership sign-in form.
    if (/sign-in|\/login/i.test(path)) {
      try {
        if ((await pageEval(page, detectLoginProblem)) === true) {
          cxlog('login: CAPTCHA challenge or error banner after submit');
          return 'failed';
        }
      } catch (e) {
        cxlog('login: post-submit poll skipped', String(e));
      }
      continue;
    }
    // OAuth / RIBE createSession in progress — wait (host/path only; not goto= query).
    if (isMidOAuthNavigation(href)) {
      cxlog('login: OAuth/createSession in progress…');
      continue;
    }
    if (/\/availability/i.test(path)) {
      cxlog('login: signed in — landed on availability');
      return 'ok';
    }
    if (/cathaypacific\.com/i.test(href)) {
      cxlog('login: signed in — landed on', path);
      return 'ok';
    }
  }
  cxlog('login: timed out waiting for OAuth/session settle', page.url());
  return 'failed';
}
