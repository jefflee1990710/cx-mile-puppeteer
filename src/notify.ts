import notifier from 'node-notifier';
import { execFile } from 'node:child_process';
import { buildCxDisplay } from './scraper/buildUrl.js';
import type { Combo, CxResult } from './scraper/types.js';
import { cxlog } from './scraper/log.js';

export function notifySeats(combo: Combo, result: CxResult): void {
  const title = 'CX Mile — seats found';
  const message = `${buildCxDisplay(combo)}\n${result.raw}`;
  cxlog('notify', title, message);
  try {
    notifier.notify({ title, message, sound: true, wait: false });
  } catch (e) {
    cxlog('notifier error', String(e));
  }
  playAlertSound();
}

function playAlertSound(): void {
  // macOS: longer beep sequence via afplay /say fallback
  if (process.platform === 'darwin') {
    const script = [
      'set volume output volume 80',
      'beep 3',
      'delay 0.35',
      'beep 3',
    ].join('\n');
    execFile('osascript', ['-e', script], err => {
      if (err) cxlog('alert sound error', String(err));
    });
    return;
  }
  // Linux: try paplay / aplay bell
  execFile('printf', ['\\a'], () => undefined);
}
