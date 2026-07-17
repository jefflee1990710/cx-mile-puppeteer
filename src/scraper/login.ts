import type { Page } from 'puppeteer';
import { isMidOAuthNavigation } from './cxBounce.js';
import { ensureVisibleMouse, humanClick, humanTypeInto, pause, warmSession } from './human.js';
import { cxlog } from './log.js';
import {
  clickMobileContinue,
  clickPasswordSignIn,
  detectLoginProblem,
  detectLoginStep,
  fillMembershipNumber,
  fillMobileNumber,
  fillPasswordValue,
  hasVisiblePasswordField,
  switchToMembershipLogin,
  switchToMobileLogin,
  type CxLoginStep,
} from './loginPageFns.js';
import { pageEval } from './pageEval.js';
import type { LoginMethod } from './types.js';

export interface CxCreds {
  loginMethod?: LoginMethod;
  countryCode: string;
  mobile: string;
  membership?: string;
  password: string;
}

const MOBILE_SEL = 'input[type="tel"][name="mobile"], input[type="tel"]';
const MEMBERSHIP_SEL = 'input[name="membership"]';
const PASSWORD_SEL = 'input#Password, input[name="password"][type="password"], input[type="password"]';
const CONTINUE_SEL =
  '[data-tealium-event-action*="CONTINUE_BTN"], button.masterSignIn__submitBtn';
const MEMBERSHIP_METHOD_SEL = '[data-tealium-event-action*="METHOD_CHANGE::MEMBERNUMBER"]';
const MOBILE_METHOD_SEL = '[data-tealium-event-action*="METHOD_CHANGE::MOBILE"]';
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

async function fillMembershipHuman(page: Page, membership: string): Promise<boolean> {
  const typed = await humanTypeInto(page, MEMBERSHIP_SEL, membership);
  if (typed) {
    const v = await readInputValue(page, MEMBERSHIP_SEL);
    if (v.replace(/\s+/g, '') === membership.replace(/\s+/g, '')) return true;
  }
  cxlog('login: human membership type incomplete — falling back to evaluate fill');
  return (await pageEval(page, fillMembershipNumber, membership)) === true;
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

async function switchToMembershipHuman(page: Page): Promise<boolean> {
  if (await page.$(MEMBERSHIP_METHOD_SEL)) {
    if (await humanClick(page, MEMBERSHIP_METHOD_SEL)) return true;
  }
  return (await pageEval(page, switchToMembershipLogin)) === true;
}

async function switchToMobileHuman(page: Page): Promise<boolean> {
  if (await page.$(MOBILE_METHOD_SEL)) {
    if (await humanClick(page, MOBILE_METHOD_SEL)) return true;
  }
  return (await pageEval(page, switchToMobileLogin)) === true;
}

async function ensureLoginMethod(page: Page, method: LoginMethod, step: CxLoginStep): Promise<boolean> {
  const want: CxLoginStep = method === 'membership' ? 'membership' : 'mobile';
  if (step === want) return true;

  cxlog(`login: switching to ${want} method (was ${step})`);
  let switched = false;
  for (let i = 0; i < 8 && !switched; i++) {
    switched = method === 'membership' ? await switchToMembershipHuman(page) : await switchToMobileHuman(page);
    if (!switched) await pause.short();
  }
  if (!switched) {
    cxlog(`login: could not switch to ${want} login`);
    return false;
  }
  for (let i = 0; i < 20; i++) {
    await pause.poll(400);
    if ((await pageEval(page, detectLoginStep)) === want) return true;
  }
  cxlog(`login: ${want} field never appeared after method switch`);
  return false;
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

async function waitForPasswordStep(page: Page): Promise<boolean> {
  for (let i = 0; i < 30; i++) {
    await pause.poll(700);
    if ((await pageEval(page, detectLoginProblem)) === true) {
      cxlog('login: real CAPTCHA challenge or error banner at step 1');
      return false;
    }
    if ((await pageEval(page, hasVisiblePasswordField)) === true) return true;
  }
  cxlog('login: password field never appeared');
  return false;
}

async function completeIdentifierThenContinue(
  page: Page,
  fill: () => Promise<boolean>,
  label: string,
): Promise<boolean> {
  await pause.short();
  const filled = await fill();
  if (!filled) {
    cxlog(`login: could not fill the ${label}`);
    return false;
  }
  await pause.action();

  let continued = false;
  for (let i = 0; i < 8 && !continued; i++) {
    continued = await clickContinueHuman(page);
    if (!continued) await pause.short();
  }
  if (!continued) {
    cxlog(`login: could not click Continue after filling ${label}`);
    return false;
  }

  await pause.page();
  return waitForPasswordStep(page);
}

export async function performCxLogin(page: Page, creds: CxCreds): Promise<'ok' | 'failed'> {
  const method: LoginMethod = creds.loginMethod === 'membership' ? 'membership' : 'mobile';
  const identifier = method === 'membership' ? (creds.membership ?? '').trim() : creds.mobile;
  if (!identifier || !creds.password) {
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

  let step: CxLoginStep | null = null;
  for (let i = 0; i < 20 && !step; i++) {
    const detected = await pageEval(page, detectLoginStep);
    if (detected === 'mobile' || detected === 'membership' || detected === 'password') {
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
    cxlog('login: no mobile/membership/password form detected');
    return 'failed';
  }

  if (step !== 'password') {
    if (!(await ensureLoginMethod(page, method, step))) return 'failed';
    const ok =
      method === 'membership'
        ? await completeIdentifierThenContinue(
            page,
            () => fillMembershipHuman(page, identifier),
            'membership number',
          )
        : await completeIdentifierThenContinue(
            page,
            () => fillMobileHuman(page, creds.countryCode, identifier),
            'mobile number',
          );
    if (!ok) return 'failed';
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
