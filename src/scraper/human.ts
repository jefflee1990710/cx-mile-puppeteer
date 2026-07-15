/** Fixed and randomized pauses + human-like input helpers. */

import { createRequire } from 'node:module';
import type { ElementHandle, Page } from 'puppeteer';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { bezierCurve } = require('ghost-cursor/lib/math.js') as {
  bezierCurve: (
    start: { x: number; y: number },
    finish: { x: number; y: number },
    spreadOverride?: number,
  ) => { getLUT: (steps: number) => Array<{ x: number; y: number }> };
};

export const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

/** Uniform random delay in [minMs, maxMs] (inclusive). */
export async function humanDelay(minMs: number, maxMs: number): Promise<number> {
  const lo = Math.min(minMs, maxMs);
  const hi = Math.max(minMs, maxMs);
  const ms = Math.floor(lo + Math.random() * (hi - lo + 1));
  await sleep(ms);
  return ms;
}

/** Named pause bands used between discrete user-like actions. */
export const pause = {
  /** Brief think / field settle (0.4–1.1s). */
  short: () => humanDelay(400, 1100),
  /** Between form fills / clicks (0.8–2.2s). */
  action: () => humanDelay(800, 2200),
  /** After navigation / waiting for UI (1.2–3.0s). */
  page: () => humanDelay(1200, 3000),
  /** Between combos in a pass (2–6s). */
  combo: () => humanDelay(2000, 6000),
  /** Polling backoff with jitter around a base (e.g. ~1s ±30%). */
  poll: (baseMs = 1000) => {
    const jitter = Math.floor(baseMs * 0.3);
    return humanDelay(Math.max(200, baseMs - jitter), baseMs + jitter);
  },
  /** Per-keystroke jitter (50–200ms). */
  key: () => humanDelay(50, 200),
};

const mouseHelperPages = new WeakSet<Page>();
const lastPos = new WeakMap<Page, { x: number; y: number }>();

/**
 * On-page mirror of the Puppeteer pointer.
 * Uses fixed positioning + explicit __cxSetCursorPos (CDP moves don't always
 * fire DOM mousemove reliably on all CX pages).
 */
function injectArrowCursorHelper(): void {
  const w = window as Window & {
    __cxSetCursorPos?: (x: number, y: number) => void;
    __cxCursorInstalled?: boolean;
  };

  const ensure = (): void => {
    let el = document.getElementById('cx-mouse-cursor');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cx-mouse-cursor';
      const svg = encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
          `<path fill="#fff" stroke="#111" stroke-width="1.25" stroke-linejoin="round" ` +
          `d="M4.2 2.4v17.2l4.3-4.2 2.4 5.7 2.5-1-2.4-5.7h6.8z"/>` +
          `</svg>`,
      );
      el.style.cssText = [
        'pointer-events:none',
        'position:fixed',
        'top:0',
        'left:0',
        'z-index:2147483647',
        'width:24px',
        'height:24px',
        'margin:0',
        'padding:0',
        'transform:translate(-2px,-2px)',
        `background:url("data:image/svg+xml,${svg}") no-repeat 0 0 / 24px 24px`,
        'filter:drop-shadow(0 1px 1px rgba(0,0,0,.4))',
        'will-change:left,top',
      ].join(';');
      (document.documentElement ?? document.body)?.appendChild(el);
    }

    if (!document.getElementById('cx-mouse-cursor-style')) {
      const style = document.createElement('style');
      style.id = 'cx-mouse-cursor-style';
      style.textContent = `
        html.cx-mirror-cursor, html.cx-mirror-cursor * { cursor: none !important; }
        #cx-mouse-cursor.cx-mouse-down { transform: translate(-2px,-2px) scale(0.9); filter: brightness(0.85); }
      `;
      (document.head ?? document.documentElement).appendChild(style);
    }
    document.documentElement?.classList.add('cx-mirror-cursor');

    w.__cxSetCursorPos = (x: number, y: number) => {
      const node = document.getElementById('cx-mouse-cursor');
      if (!node) return;
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
      node.style.display = 'block';
    };

    if (w.__cxCursorInstalled) return;
    w.__cxCursorInstalled = true;

    document.addEventListener(
      'mousemove',
      event => {
        w.__cxSetCursorPos?.(event.clientX, event.clientY);
      },
      true,
    );
    document.addEventListener(
      'mousedown',
      () => document.getElementById('cx-mouse-cursor')?.classList.add('cx-mouse-down'),
      true,
    );
    document.addEventListener(
      'mouseup',
      () => document.getElementById('cx-mouse-cursor')?.classList.remove('cx-mouse-down'),
      true,
    );

    // CX / React may wipe our node — put it back.
    const mo = new MutationObserver(() => {
      if (!document.getElementById('cx-mouse-cursor')) ensure();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', ensure, { once: true });
  } else {
    ensure();
  }
}

/**
 * Show a visible arrow cursor overlay so headed sessions can watch moves.
 * Registers for future documents and re-attaches to the current one after navigations.
 */
export async function ensureVisibleMouse(page: Page): Promise<void> {
  if (!mouseHelperPages.has(page)) {
    mouseHelperPages.add(page);
    await page.evaluateOnNewDocument(injectArrowCursorHelper);
  }
  try {
    await page.bringToFront();
  } catch {
    // ignore
  }
  try {
    await page.evaluate(injectArrowCursorHelper);
  } catch {
    // about:blank / detached — OnNewDocument still covers the next load.
  }
}

async function setMirrorPos(page: Page, x: number, y: number): Promise<void> {
  lastPos.set(page, { x, y });
  try {
    await page.evaluate(
      (px, py) => {
        const w = window as Window & { __cxSetCursorPos?: (a: number, b: number) => void };
        w.__cxSetCursorPos?.(px, py);
      },
      x,
      y,
    );
  } catch {
    // ignore
  }
}

/**
 * Single Bezier mouse path, with the on-page mirror updated on every step
 * so you can see the pointer move even when DOM mousemove is unreliable.
 */
export async function mirroredMoveTo(page: Page, dest: { x: number; y: number }): Promise<void> {
  await ensureVisibleMouse(page);
  const from = lastPos.get(page) ?? { x: 80 + Math.random() * 40, y: 80 + Math.random() * 40 };
  const curve = bezierCurve(from, dest);
  const steps = Math.max(18, Math.min(55, Math.floor(Math.hypot(dest.x - from.x, dest.y - from.y) / 8)));
  const points = curve.getLUT(steps);

  for (const p of points) {
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    try {
      await page.mouse.move(x, y);
    } catch {
      // ignore
    }
    await setMirrorPos(page, x, y);
    await sleep(4 + Math.floor(Math.random() * 10));
  }
  await setMirrorPos(page, Math.round(dest.x), Math.round(dest.y));
}

/** One Bezier move to the target, then click in place. Falls back to element.click(). */
export async function humanClick(
  page: Page,
  target: string | ElementHandle<Element>,
): Promise<boolean> {
  try {
    await ensureVisibleMouse(page);
    const handle = typeof target === 'string' ? await page.$(target) : target;
    if (!handle) return false;
    const box = await handle.boundingBox();
    if (box) {
      await mirroredMoveTo(page, {
        x: box.x + box.width * (0.3 + Math.random() * 0.4),
        y: box.y + box.height * (0.3 + Math.random() * 0.4),
      });
      const hold = 40 + Math.floor(Math.random() * 80);
      await page.mouse.down();
      await sleep(hold);
      await page.mouse.up();
      return true;
    }
    await handle.click({ delay: 40 + Math.floor(Math.random() * 80) });
    return true;
  } catch {
    try {
      if (typeof target === 'string') {
        const el = await page.$(target);
        if (!el) return false;
        await el.click({ delay: 40 + Math.floor(Math.random() * 80) });
        return true;
      }
      await target.click({ delay: 40 + Math.floor(Math.random() * 80) });
      return true;
    } catch {
      return false;
    }
  }
}

/** Type one character at a time with 50–200ms jitter (not instant paste). */
export async function typeHuman(page: Page, text: string): Promise<void> {
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: 0 });
    await pause.key();
  }
}

/** Focus field via cursor, clear, then jitter-type. */
export async function humanTypeInto(
  page: Page,
  selector: string,
  text: string,
): Promise<boolean> {
  const el = await page.$(selector);
  if (!el) return false;
  await humanClick(page, el);
  await pause.short();
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.down(mod);
  await page.keyboard.press('KeyA');
  await page.keyboard.up(mod);
  await page.keyboard.press('Backspace');
  await pause.short();
  await typeHuman(page, text);
  return true;
}

/**
 * Session warming: rest, scroll with the mouse wheel a few times, return to top.
 * Call before login walls / important forms.
 */
export async function warmSession(page: Page): Promise<void> {
  await ensureVisibleMouse(page);
  await pause.page();
  const scrolls = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < scrolls; i++) {
    const delta = 180 + Math.floor(Math.random() * 420);
    await page.mouse.wheel({ deltaY: i % 2 === 0 ? delta : -Math.floor(delta * 0.6) });
    await pause.short();
  }
  try {
    await page.evaluate(`(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); })()`);
  } catch {
    // ignore
  }
  await pause.action();
}

/** Pick a random on-viewport point with padding from edges. */
export function randomViewportPoint(width: number, height: number): { x: number; y: number } {
  const padX = Math.min(80, Math.max(16, width * 0.08));
  const padY = Math.min(80, Math.max(16, height * 0.08));
  const w = Math.max(1, width - padX * 2);
  const h = Math.max(1, height - padY * 2);
  return {
    x: padX + Math.random() * w,
    y: padY + Math.random() * h,
  };
}

/**
 * Idle between search passes: Bezier moves to random points,
 * occasional light scrolls. Calls onTick ~every second with ms remaining.
 */
export async function wanderWhileWaiting(
  page: Page,
  durationMs: number,
  opts: {
    isStopped: () => boolean;
    onTick?: (msLeft: number) => void;
  },
): Promise<void> {
  const start = Date.now();
  let nextMoveAt = 0;

  try {
    await ensureVisibleMouse(page);
  } catch {
    // page may be mid-nav
  }

  while (!opts.isStopped()) {
    const left = durationMs - (Date.now() - start);
    if (left <= 0) break;
    opts.onTick?.(left);

    if (Date.now() >= nextMoveAt) {
      try {
        if (!page.isClosed()) {
          await ensureVisibleMouse(page);
          const size = await page.evaluate(() => ({
            w: window.innerWidth || 1200,
            h: window.innerHeight || 800,
          }));
          const dest = randomViewportPoint(size.w, size.h);
          await mirroredMoveTo(page, dest);
          if (Math.random() < 0.3) {
            const delta = (Math.random() < 0.5 ? 1 : -1) * (40 + Math.floor(Math.random() * 140));
            await page.mouse.wheel({ deltaY: delta });
          }
        }
      } catch {
        // redeem page reload / detach — keep waiting
      }
      // Next wander in 2.5–9s (don't spam moves for a 30m wait).
      nextMoveAt = Date.now() + 2500 + Math.floor(Math.random() * 6500);
    }

    const leftAfter = durationMs - (Date.now() - start);
    if (leftAfter <= 0) break;
    await sleep(Math.min(1000, leftAfter));
  }
}
