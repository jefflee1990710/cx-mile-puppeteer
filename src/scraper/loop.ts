import { expandCombos } from './combos.js';
import { buildCxDisplay } from './buildUrl.js';
import { pause } from './human.js';
import { cxlog } from './log.js';
import type { Combo, CxForm, CxResult } from './types.js';

export type OpenSearchOutcome = 'ok' | 'login' | 'error' | 'noflights' | 'rejected';

export interface LoopDeps {
  openSearch: (combo: Combo) => Promise<OpenSearchOutcome>;
  readResults: (combo: Combo) => Promise<CxResult>;
  login?: () => Promise<'ok' | 'failed'>;
  onLoginNeeded?: () => void;
  notify: (combo: Combo, result: CxResult) => void;
  onResult?: (combo: Combo, result: CxResult) => void;
  leaveResults?: (combo: Combo) => Promise<void>;
  onPassStart?: () => void;
  sleep: (ms: number) => Promise<void>;
  isStopped: () => boolean;
}

export interface LoopOutcome {
  foundAny: boolean;
  pausedForLogin?: boolean;
}

export async function runSearchLoop(form: CxForm, deps: LoopDeps): Promise<LoopOutcome> {
  const combos = expandCombos(form);
  let foundAny = false;
  let pass = 0;

  cxlog(`loop start: ${combos.length} combo(s), interval ${form.intervalMin}m`);

  while (!deps.isStopped()) {
    pass += 1;
    cxlog(`loop pass ${pass} begin`);
    deps.onPassStart?.();
    const notified = new Set<string>();
    for (let i = 0; i < combos.length; i += 1) {
      const combo = combos[i];
      if (deps.isStopped()) {
        cxlog('loop stopped mid-pass');
        return { foundAny };
      }
      const display = buildCxDisplay(combo);
      cxlog(`combo ${i + 1}/${combos.length} run`, display);
      let nav = await deps.openSearch(combo);
      if (nav === 'login' && deps.login) {
        cxlog('login wall hit — attempting auto sign-in');
        const signedIn = (await deps.login()) === 'ok' ? await deps.openSearch(combo) : 'login';
        if (signedIn === 'login') {
          cxlog('auto sign-in failed — pausing loop for manual login');
          deps.onLoginNeeded?.();
          return { foundAny, pausedForLogin: true };
        }
        nav = signedIn;
      }
      if (deps.isStopped()) {
        cxlog('loop stopped after navigation');
        return { foundAny };
      }
      const result: CxResult =
        nav === 'ok'
          ? await deps.readResults(combo)
          : { found: false, dates: [], cabin: '', raw: `RESULT: NONE (${nav})` };
      cxlog(`combo ${i + 1}/${combos.length} result: found=${result.found}`, result.raw);
      deps.onResult?.(combo, result);
      if (result.found) {
        foundAny = true;
        const dates = result.dates.length ? result.dates : ['?'];
        for (const d of dates) {
          const key = `${combo.dest}|${d}|${combo.cabin}`;
          if (!notified.has(key)) {
            notified.add(key);
            cxlog('notify seats', key);
            deps.notify(combo, result);
          }
        }
      }
      await deps.leaveResults?.(combo);
      if (i < combos.length - 1 && !deps.isStopped()) {
        await pause.combo();
      }
    }
    if (deps.isStopped()) return { foundAny };
    cxlog(`loop pass ${pass} done; sleeping ${form.intervalMin}m`);
    await pause.page();
    await deps.sleep(form.intervalMin * 60_000);
  }
  cxlog('loop exited (stopped)');
  return { foundAny };
}
