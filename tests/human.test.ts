import { describe, expect, it } from 'vitest';
import { humanDelay, randomViewportPoint, sleep } from '../src/scraper/human.js';

describe('humanDelay', () => {
  it('waits within the requested range', async () => {
    const t0 = Date.now();
    const waited = await humanDelay(40, 80);
    const elapsed = Date.now() - t0;
    expect(waited).toBeGreaterThanOrEqual(40);
    expect(waited).toBeLessThanOrEqual(80);
    expect(elapsed).toBeGreaterThanOrEqual(35);
  });

  it('sleep resolves', async () => {
    const t0 = Date.now();
    await sleep(30);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25);
  });
});

describe('randomViewportPoint', () => {
  it('stays inside the viewport with edge padding', () => {
    for (let i = 0; i < 40; i++) {
      const p = randomViewportPoint(1440, 900);
      expect(p.x).toBeGreaterThanOrEqual(16);
      expect(p.y).toBeGreaterThanOrEqual(16);
      expect(p.x).toBeLessThanOrEqual(1440 - 16);
      expect(p.y).toBeLessThanOrEqual(900 - 16);
    }
  });
});
