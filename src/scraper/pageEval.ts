import type { Page } from 'puppeteer';

/**
 * tsx/esbuild keepNames rewrites exported functions to call `__name(fn, "fn")`.
 * Puppeteer serializes those functions into the page, where `__name` does not exist,
 * so every `page.evaluate(importedFn)` throws `ReferenceError: __name is not defined`.
 * Install a no-op shim before any evaluate / on every new document.
 */
const SHIM = `(() => {
  const g = globalThis;
  if (typeof g.__name !== 'function') g.__name = (t) => t;
})()`;

export async function installEvalShims(page: Page): Promise<void> {
  await page.evaluateOnNewDocument(SHIM);
  try {
    await page.evaluate(SHIM);
  } catch {
    // about:blank / mid-navigation — evaluateOnNewDocument covers the next load
  }
}

/** Ensure shim, then evaluate. Prefer this over bare page.evaluate for imported fns. */
export async function pageEval<Args extends unknown[], R>(
  page: Page,
  // Puppeteer's EvaluateFunc typing is stricter than our imported helpers; cast at the call.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: (...args: Args) => R,
  ...args: Args
): Promise<R> {
  try {
    await page.evaluate(SHIM);
  } catch {
    // ignore
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return page.evaluate(fn as any, ...(args as any[])) as Promise<R>;
}
