import { closeBrowser, getPage } from '../scraper/browser.js';
import { openAwardSearch, readAwardResults, returnToRedeem } from '../scraper/awardSearch.js';
import { buildCxDisplay } from '../scraper/buildUrl.js';
import { performCxLogin } from '../scraper/login.js';
import { runSearchLoop } from '../scraper/loop.js';
import type { CxForm } from '../scraper/types.js';
import { notifySeats } from '../notify.js';
import { broadcast, emitLog } from './events.js';

let running = false;
let stopFlag = false;
let lastPassAt: string | undefined;
let loopPromise: Promise<void> | null = null;

export function getStatus(): { running: boolean; lastPassAt?: string } {
  return { running, lastPassAt };
}

export async function startLoop(form: CxForm): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (running) return { ok: false, status: 409, error: 'Loop already running' };
  if (!form.tasks?.length) return { ok: false, status: 400, error: 'Add at least one task' };
  if (!form.cabins?.length) return { ok: false, status: 400, error: 'Select at least one cabin' };
  if (!form.intervalMin || form.intervalMin < 1) {
    return { ok: false, status: 400, error: 'intervalMin must be >= 1' };
  }

  running = true;
  stopFlag = false;
  broadcast({ type: 'status', running: true, message: 'Starting…', at: new Date().toISOString() });
  emitLog('Search loop starting');

  loopPromise = (async () => {
    try {
      const page = await getPage();
      const outcome = await runSearchLoop(form, {
        openSearch: c => openAwardSearch(page, c),
        readResults: c => readAwardResults(page, c),
        login:
          form.autoLogin && form.mobile && form.password
            ? () =>
                performCxLogin(page, {
                  countryCode: form.countryCode || '852',
                  mobile: form.mobile,
                  password: form.password,
                })
            : undefined,
        onLoginNeeded: () => {
          emitLog('Auto sign-in failed — sign in manually in the Chromium window, then Start again');
          broadcast({
            type: 'status',
            running: false,
            message: 'Paused for login',
            at: new Date().toISOString(),
          });
        },
        notify: (combo, result) => notifySeats(combo, result),
        onResult: (combo, result) => {
          broadcast({
            type: 'result',
            display: buildCxDisplay(combo),
            found: result.found,
            raw: result.raw,
            at: new Date().toISOString(),
          });
        },
        leaveResults: async () => {
          await returnToRedeem(page);
        },
        onPassStart: () => {
          lastPassAt = new Date().toISOString();
          broadcast({ type: 'passStart', at: lastPassAt });
          emitLog(`Pass started at ${lastPassAt}`);
        },
        sleep: ms =>
          new Promise(resolve => {
            const start = Date.now();
            const tick = () => {
              if (stopFlag || Date.now() - start >= ms) {
                resolve();
                return;
              }
              setTimeout(tick, Math.min(1000, ms - (Date.now() - start)));
            };
            tick();
          }),
        isStopped: () => stopFlag,
      });
      if (outcome.pausedForLogin) {
        emitLog('Loop paused for login');
      } else {
        emitLog('Loop stopped');
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      emitLog(`Loop error: ${message}`);
      broadcast({ type: 'error', message, at: new Date().toISOString() });
    } finally {
      running = false;
      stopFlag = false;
      loopPromise = null;
      broadcast({ type: 'status', running: false, message: 'Idle', at: new Date().toISOString() });
    }
  })();

  return { ok: true };
}

export async function stopLoop(): Promise<void> {
  if (!running) return;
  stopFlag = true;
  emitLog('Stop requested');
  if (loopPromise) await loopPromise.catch(() => undefined);
}

export async function shutdown(): Promise<void> {
  await stopLoop();
  await closeBrowser();
}
