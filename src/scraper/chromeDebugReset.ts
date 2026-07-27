import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cxlog } from './log.js';

const scriptsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts');

function runPs1(scriptName: string): Promise<void> {
  const script = path.join(scriptsDir, scriptName);
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: process.env,
      },
    );
    let stderr = '';
    child.stdout?.on('data', (buf: Buffer) => {
      const line = buf.toString().trimEnd();
      if (line) cxlog(line);
    });
    child.stderr?.on('data', (buf: Buffer) => {
      stderr += buf.toString();
      const line = buf.toString().trimEnd();
      if (line) cxlog(line);
    });
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`${scriptName} exited ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
    });
  });
}

export function cleanProfileBetweenPassesEnabled(): boolean {
  return process.env.CX_CLEAN_PROFILE_BETWEEN_PASSES?.trim() === '1';
}

/** Stop CDP Chrome and delete the debug profile (cookies + cache). */
export async function cleanChromeDebugProfile(): Promise<void> {
  cxlog('cleaning Chrome debug profile + cache');
  await runPs1('clean-chrome-debug-profile.ps1');
}

/** Launch Chrome with remote debugging (same as launch-chrome-debug.ps1). */
export async function launchChromeDebug(): Promise<void> {
  cxlog('relaunching Chrome with CDP');
  await runPs1('launch-chrome-debug.ps1');
  // Give CDP a moment to bind before Puppeteer connects.
  await new Promise<void>(r => setTimeout(r, 2000));
}
