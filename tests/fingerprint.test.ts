import { describe, expect, it } from 'vitest';
import { userAgentForChromeVersion, FINGERPRINT } from '../src/scraper/fingerprint.js';

describe('fingerprint', () => {
  it('builds a UA matching the Chrome version label', () => {
    expect(userAgentForChromeVersion('Chrome/131.0.6778.86')).toContain('Chrome/131.0.6778.86');
    expect(userAgentForChromeVersion('HeadlessChrome/120.0.0.0')).toContain('Chrome/120.0.0.0');
  });

  it('exposes a consistent desktop profile', () => {
    expect(FINGERPRINT.viewport.width).toBeGreaterThan(1000);
    expect(FINGERPRINT.locale).toBe('en-HK');
    expect(FINGERPRINT.webgl.renderer).toMatch(/Apple|ANGLE|NVIDIA|Intel/i);
  });
});
