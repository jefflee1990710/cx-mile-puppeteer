import { describe, expect, it } from 'vitest';
import {
  userAgentForChromeVersion,
  FINGERPRINT,
  fingerprintForPlatform,
  buildFingerprintInitScript,
} from '../src/scraper/fingerprint.js';

describe('fingerprint', () => {
  it('builds a UA matching the Chrome version label for the host OS family', () => {
    expect(userAgentForChromeVersion('Chrome/131.0.6778.86', 'darwin')).toContain(
      'Chrome/131.0.6778.86',
    );
    expect(userAgentForChromeVersion('HeadlessChrome/120.0.0.0', 'win32')).toContain(
      'Chrome/120.0.0.0',
    );
    expect(userAgentForChromeVersion('Chrome/131.0.0.0', 'win32')).toContain('Windows NT 10.0');
    expect(userAgentForChromeVersion('Chrome/131.0.0.0', 'darwin')).toContain('Macintosh');
    expect(userAgentForChromeVersion('Chrome/131.0.0.0', 'linux')).toContain('Linux');
  });

  it('exposes a consistent desktop profile for the current host', () => {
    expect(FINGERPRINT.viewport.width).toBeGreaterThan(1000);
    expect(FINGERPRINT.locale).toBe('en-HK');
    if (FINGERPRINT.webgl) {
      expect(FINGERPRINT.webgl.renderer).toMatch(/Apple|ANGLE|NVIDIA|Intel/i);
    }
  });

  it('uses Windows platform signals on win32 (no Apple WebGL spoof)', () => {
    const win = fingerprintForPlatform('win32');
    expect(win.platform).toBe('Win32');
    expect(win.userAgent).toContain('Windows NT 10.0');
    expect(win.webgl).toBeNull();
    expect(win.viewport.deviceScaleFactor).toBe(1);
    expect(buildFingerprintInitScript(win)).not.toContain('Apple M1');
    expect(buildFingerprintInitScript(win)).toContain('Win32');
  });

  it('keeps Mac profile on darwin', () => {
    const mac = fingerprintForPlatform('darwin');
    expect(mac.platform).toBe('MacIntel');
    expect(mac.webgl?.renderer).toMatch(/Apple M1/i);
  });
});
