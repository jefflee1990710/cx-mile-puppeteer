import notifier from 'node-notifier';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildCxDisplay } from './scraper/buildUrl.js';
import type { Combo, CxResult } from './scraper/types.js';
import { cxlog } from './scraper/log.js';

const execFileAsync = promisify(execFile);

const HERO = '/System/Library/Sounds/Hero.aiff';
const REMIND_EVERY_MS = 5 * 60_000;

let seatsActive = false;
let lastSummary = '';
let remindTimer: ReturnType<typeof setInterval> | null = null;

/** Desktop notification + Hero ×3 when award seats are found. */
export function notifySeats(combo: Combo, result: CxResult): void {
  const display = buildCxDisplay(combo);
  const title = 'CX Mile — seats found';
  const message = `${display}\n${result.raw}`;
  lastSummary = message;
  cxlog('notify', title, message);

  try {
    notifier.notify({
      title,
      message,
      sound: true,
      wait: false,
    } as notifier.Notification);
  } catch (e) {
    cxlog('notifier error', String(e));
  }

  void playHeroThrice().catch(e => cxlog('alert sound error', String(e)));
  armSeatReminder();
}

/** Keep reminding with Hero every 5m while the current pass still has seats. */
export function armSeatReminder(): void {
  seatsActive = true;
  if (remindTimer) return;
  remindTimer = setInterval(() => {
    if (!seatsActive) {
      clearSeatReminder();
      return;
    }
    cxlog('seat reminder: Hero ×3 (results still have seats)');
    try {
      notifier.notify({
        title: 'CX Mile — seats still available',
        message: lastSummary || 'At least one award match is still in results.',
        sound: true,
        wait: false,
      } as notifier.Notification);
    } catch {
      // ignore
    }
    void playHeroThrice().catch(e => cxlog('alert sound error', String(e)));
  }, REMIND_EVERY_MS);
}

/** Stop 5‑minute Hero reminders (new pass, stop, or no seats). */
export function clearSeatReminder(): void {
  seatsActive = false;
  if (remindTimer) {
    clearInterval(remindTimer);
    remindTimer = null;
  }
}

async function playHeroThrice(): Promise<void> {
  if (process.platform === 'darwin') {
    for (let i = 0; i < 3; i++) {
      await execFileAsync('afplay', [HERO], { timeout: 15_000 }).catch(() => undefined);
    }
    return;
  }
  for (let i = 0; i < 3; i++) {
    process.stdout.write('\x07');
    await new Promise(r => setTimeout(r, 400));
  }
}
