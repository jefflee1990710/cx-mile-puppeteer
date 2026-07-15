/** Fixed and randomized pauses + human-like input helpers. */

import { createCursor, type GhostCursor } from 'ghost-cursor';
import type { ElementHandle, Page } from 'puppeteer';

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

const cursors = new WeakMap<Page, GhostCursor>();
const mouseHelperPages = new WeakSet<Page>();

/**
 * Classic arrow cursor (SVG) — tip is at the hot-spot (pageX/pageY).
 * Runs in the browser context via evaluate / evaluateOnNewDocument.
 */
function injectArrowCursorHelper(): void {
  const FLAG = 'data-cx-arrow-cursor';
  if (document.documentElement?.getAttribute(FLAG) === '1') return;
  document.documentElement?.setAttribute(FLAG, '1');

  const attach = (): void => {
    if (document.querySelector('cx-mouse-cursor')) return;

    const cursor = document.createElement('cx-mouse-cursor');
    const style = document.createElement('style');
    // White fill + black outline arrow; tip at top-left (0,0) = click hot-spot.
    const svg = encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
        `<path fill="#fff" stroke="#111" stroke-width="1.25" stroke-linejoin="round" ` +
        `d="M4.2 2.4v17.2l4.3-4.2 2.4 5.7 2.5-1-2.4-5.7h6.8z"/>` +
        `</svg>`,
    );
    style.textContent = `
      cx-mouse-cursor {
        pointer-events: none !important;
        position: absolute;
        top: 0;
        left: 0;
        z-index: 2147483647;
        width: 24px;
        height: 24px;
        margin: 0;
        padding: 0;
        background: url("data:image/svg+xml,${svg}") no-repeat 0 0 / 24px 24px;
        filter: drop-shadow(0 1px 1px rgba(0,0,0,.35));
        transition: transform .08s ease-out, filter .08s ease-out;
        will-change: left, top, transform;
      }
      cx-mouse-cursor.button-1 {
        transform: scale(0.9);
        filter: drop-shadow(0 0 0 rgba(0,0,0,0)) brightness(0.85);
      }
      cx-mouse-cursor.cx-mouse-hide {
        display: none;
      }
    `;

    const root = document.documentElement;
    (document.head ?? root).appendChild(style);
    (document.body ?? root).appendChild(cursor);

    const updateButtons = (buttons: number): void => {
      for (let i = 0; i < 5; i++) {
        cursor.classList.toggle(`button-${i}`, Boolean(buttons & (1 << i)));
      }
    };

    document.addEventListener(
      'mousemove',
      event => {
        cursor.style.left = `${event.pageX}px`;
        cursor.style.top = `${event.pageY}px`;
        cursor.classList.remove('cx-mouse-hide');
        updateButtons(event.buttons);
      },
      true,
    );
    document.addEventListener(
      'mousedown',
      event => {
        updateButtons(event.buttons);
        cursor.classList.add(`button-${event.which}`);
        cursor.classList.remove('cx-mouse-hide');
      },
      true,
    );
    document.addEventListener(
      'mouseup',
      event => {
        updateButtons(event.buttons);
        cursor.classList.remove(`button-${event.which}`);
        cursor.classList.remove('cx-mouse-hide');
      },
      true,
    );
    document.addEventListener(
      'mouseleave',
      () => {
        cursor.classList.add('cx-mouse-hide');
      },
      true,
    );
    document.addEventListener(
      'mouseenter',
      () => {
        cursor.classList.remove('cx-mouse-hide');
      },
      true,
    );
  };

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', attach, { once: true });
  } else {
    attach();
  }
}

/**
 * Show a visible arrow cursor overlay so headed sessions can watch moves.
 * Registers for future documents and attaches to the current one when possible.
 */
export async function ensureVisibleMouse(page: Page): Promise<void> {
  if (mouseHelperPages.has(page)) return;
  mouseHelperPages.add(page);
  await page.evaluateOnNewDocument(injectArrowCursorHelper);
  try {
    await page.evaluate(injectArrowCursorHelper);
  } catch {
    // about:blank / detached — OnNewDocument still covers the next navigation.
  }
}

export function getCursor(page: Page): GhostCursor {
  let cursor = cursors.get(page);
  if (!cursor) {
    // visible helper is installed separately (once) via ensureVisibleMouse
    cursor = createCursor(page);
    cursors.set(page, cursor);
  }
  return cursor;
}

/** Bezier-curve mouse move + click (ghost-cursor). Falls back to element.click(). */
export async function humanClick(
  page: Page,
  target: string | ElementHandle<Element>,
): Promise<boolean> {
  try {
    await ensureVisibleMouse(page);
    const cursor = getCursor(page);
    await cursor.click(target as never, { paddingPercentage: 20 });
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
