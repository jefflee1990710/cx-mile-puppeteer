import { closeBrowser, getPage } from '../scraper/browser.js';
import { openAwardSearch, readAwardResults, returnToRedeem, settleAwardSearch } from '../scraper/awardSearch.js';
import { buildCxDisplay } from '../scraper/buildUrl.js';
import {
  cleanChromeDebugProfile,
  cleanProfileBetweenPassesEnabled,
  launchChromeDebug,
} from '../scraper/chromeDebugReset.js';
import { isNavigationNetError } from '../scraper/chromeNetError.js';
import { sleep, wanderWhileWaiting } from '../scraper/human.js';
import { performCxLogin } from '../scraper/login.js';
import { runSearchLoop } from '../scraper/loop.js';
import type { CxForm } from '../scraper/types.js';
import { notifySeats, clearSeatReminder } from '../notify.js';
import { broadcast, emitLog } from './events.js';

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function assertSearchableDates(form: CxForm): string | null {
  const today = todayIso();
  for (let i = 0; i < form.tasks.length; i += 1) {
    const dates = form.tasks[i].dates ?? [];
    if (!dates.length) return `Task ${i + 1}: add at least one departure date`;
    if (dates.some(d => d < today)) {
      return `Task ${i + 1}: dates must be today or later (got ${dates.filter(d => d < today).join(', ')})`;
    }
  }
  return null;
}

/** e.g. 185s → "3:05" */
function formatCountdown(msLeft: number): string {
  const totalSec = Math.max(0, Math.ceil(msLeft / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Countdown wait without a live page (used after Chrome profile wipe). */
async function countdownWhileWaiting(
  durationMs: number,
  opts: { isStopped: () => boolean; onTick?: (msLeft: number) => void },
): Promise<void> {
  const start = Date.now();
  while (!opts.isStopped()) {
    const left = durationMs - (Date.now() - start);
    if (left <= 0) break;
    opts.onTick?.(left);
    await sleep(Math.min(1000, left));
  }
}

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
  const dateErr = assertSearchableDates(form);
  if (dateErr) return { ok: false, status: 400, error: dateErr };

  running = true;
  stopFlag = false;
  broadcast({ type: 'status', running: true, message: 'Starting…', at: new Date().toISOString() });
  emitLog('Search loop starting');

  loopPromise = (async () => {
    try {
      let page = await getPage();
      const loginMethod = form.loginMethod === 'membership' ? 'membership' : 'mobile';
      const hasIdentifier =
        loginMethod === 'membership' ? !!form.membership?.trim() : !!form.mobile;
      const canAutoLogin = !!(form.autoLogin && hasIdentifier && form.password);
      if (!canAutoLogin) {
        emitLog(
          form.autoLogin
            ? `Auto-login on, but ${loginMethod === 'membership' ? 'membership' : 'mobile'}/password empty — will pause on sign-in wall`
            : 'Auto-login off — will pause on sign-in wall',
        );
      }
      if (cleanProfileBetweenPassesEnabled()) {
        emitLog('Between-pass Chrome profile wipe enabled (CX_CLEAN_PROFILE_BETWEEN_PASSES=1)');
      }

      const wipeAndRelaunchChrome = async (): Promise<void> => {
        await closeBrowser();
        await cleanChromeDebugProfile();
        await launchChromeDebug();
        page = await getPage();
      };

      const outcome = await runSearchLoop(form, {
        openSearch: c => openAwardSearch(page, c),
        readResults: c => readAwardResults(page, c),
        settleAfterLogin: () => settleAwardSearch(page),
        login: canAutoLogin
          ? () =>
              performCxLogin(page, {
                loginMethod,
                countryCode: form.countryCode || '852',
                mobile: form.mobile,
                membership: form.membership,
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
        onSuspiciousBackoff: ms => {
          const mins = Math.round(ms / 60_000);
          emitLog(`Suspicious activity detected — waiting ${mins}m then retrying`);
          broadcast({
            type: 'status',
            running: true,
            message: `Suspicious activity — retry in ${mins}m`,
            at: new Date().toISOString(),
          });
        },
        restartChrome: async () => {
          emitLog('Edge block detected — closing Chrome, wiping debug profile, relaunching via CDP');
          broadcast({
            type: 'status',
            running: true,
            message: 'Blocked — restarting Chrome…',
            at: new Date().toISOString(),
          });
          await wipeAndRelaunchChrome();
          emitLog('Chrome CDP relaunch complete — retrying search');
        },
        onBlockedRestart: attempt => {
          emitLog(`Chrome restart after block (attempt ${attempt})`);
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
          clearSeatReminder();
          lastPassAt = new Date().toISOString();
          broadcast({ type: 'passStart', at: lastPassAt });
          broadcast({
            type: 'status',
            running: true,
            message: 'Searching…',
            at: lastPassAt,
          });
          emitLog(`Pass started at ${lastPassAt}`);
        },
        sleep: async ms => {
          const onTick = (left: number) => {
            broadcast({
              type: 'status',
              running: true,
              message: `Next round in ${formatCountdown(left)}`,
              at: new Date().toISOString(),
            });
          };

          if (cleanProfileBetweenPassesEnabled()) {
            emitLog('Scan pass ended — cleaning Chrome profile + cache');
            broadcast({
              type: 'status',
              running: true,
              message: 'Cleaning Chrome profile…',
              at: new Date().toISOString(),
            });
            await closeBrowser();
            await cleanChromeDebugProfile();
            await countdownWhileWaiting(ms, { isStopped: () => stopFlag, onTick });
            if (stopFlag) return;
            emitLog('Relaunching Chrome for next scan');
            broadcast({
              type: 'status',
              running: true,
              message: 'Relaunching Chrome…',
              at: new Date().toISOString(),
            });
            await launchChromeDebug();
            page = await getPage();
          } else {
            await wanderWhileWaiting(page, ms, { isStopped: () => stopFlag, onTick });
          }

          if (!stopFlag) {
            broadcast({
              type: 'status',
              running: true,
              message: 'Searching…',
              at: new Date().toISOString(),
            });
          }
        },
        isStopped: () => stopFlag,
      });
      if (outcome.pausedForLogin) {
        emitLog('Loop paused for login');
      } else {
        emitLog('Loop stopped');
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Last-resort: if a net::ERR_* escaped the loop, wipe + relaunch once then continue.
      if (isNavigationNetError(e) && !stopFlag) {
        emitLog(`Loop caught net error — wiping profile and relaunching Chrome: ${message}`);
        broadcast({
          type: 'status',
          running: true,
          message: 'Blocked — restarting Chrome…',
          at: new Date().toISOString(),
        });
        try {
          await closeBrowser();
          await cleanChromeDebugProfile();
          await launchChromeDebug();
          emitLog('Chrome CDP relaunch complete after escaped net error — restart Start to resume');
        } catch (re) {
          emitLog(`Chrome restart failed: ${re instanceof Error ? re.message : String(re)}`);
        }
      }
      emitLog(`Loop error: ${message}`);
      broadcast({ type: 'error', message, at: new Date().toISOString() });
    } finally {
      clearSeatReminder();
      running = false;
      stopFlag = false;
      loopPromise = null;
      broadcast({ type: 'status', running: false, message: 'Idle', at: new Date().toISOString() });
    }
  })();

  return { ok: true };
}

export async function stopLoop(): Promise<void> {
  clearSeatReminder();
  if (!running) {
    await closeBrowser();
    return;
  }
  stopFlag = true;
  emitLog('Stop requested');
  if (loopPromise) await loopPromise.catch(() => undefined);
  await closeBrowser();
}

export async function shutdown(): Promise<void> {
  await stopLoop();
  await closeBrowser();
}
