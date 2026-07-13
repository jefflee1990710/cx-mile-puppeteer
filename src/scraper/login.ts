import type { Page } from 'puppeteer';
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

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export async function performCxLogin(page: Page, creds: CxCreds): Promise<'ok' | 'failed'> {
  if (!creds.mobile || !creds.password) {
    cxlog('login: missing credentials');
    return 'failed';
  }

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
    await sleep(500);
  }
  if (!step) {
    cxlog('login: no mobile/password form detected');
    return 'failed';
  }

  if (step === 'mobile') {
    const filled = (await pageEval(page, fillMobileNumber, creds.countryCode, creds.mobile)) === true;
    if (!filled) {
      cxlog('login: could not fill the mobile number');
      return 'failed';
    }
    await sleep(400);

    let continued = false;
    for (let i = 0; i < 8 && !continued; i++) {
      continued = (await pageEval(page, clickMobileContinue)) === true;
      if (!continued) await sleep(400);
    }
    if (!continued) {
      cxlog('login: could not click Continue after filling mobile');
      return 'failed';
    }

    let hasPw = false;
    for (let i = 0; i < 30 && !hasPw; i++) {
      await sleep(500);
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

  let pwFilled = false;
  for (let i = 0; i < 8 && !pwFilled; i++) {
    pwFilled = (await pageEval(page, fillPasswordValue, creds.password)) === true;
    if (!pwFilled) await sleep(400);
  }
  if (!pwFilled) {
    cxlog('login: could not fill the password field');
    return 'failed';
  }
  await sleep(400);

  let signedInClick = false;
  for (let i = 0; i < 8 && !signedInClick; i++) {
    signedInClick = (await pageEval(page, clickPasswordSignIn)) === true;
    if (!signedInClick) await sleep(400);
  }
  if (!signedInClick) {
    cxlog('login: could not click Sign in on the password step');
    return 'failed';
  }

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await sleep(1000);
    let path = '';
    try {
      path = new URL(page.url()).pathname;
    } catch {
      return 'failed';
    }
    if (!/sign-in|\/login/i.test(path)) {
      cxlog('login: signed in, left the sign-in page');
      return 'ok';
    }
    try {
      if ((await pageEval(page, detectLoginProblem)) === true) {
        cxlog('login: CAPTCHA challenge or error banner after submit');
        return 'failed';
      }
    } catch (e) {
      // Mid-navigation documents can throw; keep polling until URL leaves sign-in.
      cxlog('login: post-submit poll skipped', String(e));
    }
  }
  cxlog('login: timed out still on the sign-in page');
  return 'failed';
}
