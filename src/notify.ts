import notifier from 'node-notifier';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildCxDisplay } from './scraper/buildUrl.js';
import type { Combo, CxResult } from './scraper/types.js';
import { cxlog } from './scraper/log.js';

const execFileAsync = promisify(execFile);

/** Loud, repeating desktop + audio alert when award seats are found. */
export function notifySeats(combo: Combo, result: CxResult): void {
  const display = buildCxDisplay(combo);
  const title = '🚨 CX MILES — SEATS FOUND';
  const message = `${display}\n${result.raw}`;
  cxlog('notify', title, message);

  // Burst of OS banners (macOS stacks / re-pings Attention).
  for (let i = 0; i < 3; i++) {
    setTimeout(() => {
      try {
        notifier.notify({
          title: i === 0 ? title : `${title} (${i + 1}/3)`,
          message,
          sound: true,
          wait: false,
          timeout: 30,
          urgency: 'critical',
        } as notifier.Notification);
      } catch (e) {
        cxlog('notifier error', String(e));
      }
    }, i * 1200);
  }

  void playLoudAlert(display).catch(e => cxlog('alert sound error', String(e)));
}

async function playLoudAlert(display: string): Promise<void> {
  if (process.platform === 'darwin') {
    // Max output volume, long system-sound loop, then spoken alert.
    const sounds = [
      '/System/Library/Sounds/Sosumi.aiff',
      '/System/Library/Sounds/Glass.aiff',
      '/System/Library/Sounds/Funk.aiff',
      '/System/Library/Sounds/Hero.aiff',
      '/System/Library/Sounds/Submarine.aiff',
    ];
    const playLoop = sounds
      .map(s => `try\n    do shell script "afplay " & quoted form of "${s}"\n  end try`)
      .join('\n  delay 0.12\n  ');

    const script = `
      set oldVol to output volume of (get volume settings)
      set volume output volume 100
      repeat 4 times
        ${playLoop}
        delay 0.2
        beep 5
        delay 0.25
      end repeat
      set volume output volume oldVol
    `;
    await execFileAsync('osascript', ['-e', script], { timeout: 120_000 }).catch(() => undefined);

    // Spoken alert (noisy + hard to miss if muted notification banners).
    const spoken = `Attention. Cathay miles seats found. ${display.replace(/[·|]/g, ' ')}. Check now.`;
    await execFileAsync('say', ['-v', 'Samantha', '-r', '200', spoken], { timeout: 30_000 }).catch(
      () => undefined,
    );
    // Second pass of alerts after speech.
    await execFileAsync(
      'osascript',
      [
        '-e',
        `set volume output volume 100
         repeat 2 times
           beep 8
           delay 0.2
           do shell script "afplay /System/Library/Sounds/Sosumi.aiff"
           delay 0.15
         end repeat`,
      ],
      { timeout: 30_000 },
    ).catch(() => undefined);
    return;
  }

  // Non-macOS: terminal bells + best-effort paplay
  for (let i = 0; i < 20; i++) {
    process.stdout.write('\x07');
    await new Promise(r => setTimeout(r, 200));
  }
  await execFileAsync('paplay', ['/usr/share/sounds/freedesktop/stereo/alarm-clock-elapsed.oga']).catch(
    () => undefined,
  );
}
