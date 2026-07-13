export function cxlog(...args: unknown[]): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[cx ${ts}]`, ...args);
}
