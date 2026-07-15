import { describe, expect, it } from 'vitest';
import { humanDelay, sleep } from '../src/scraper/human.js';

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
