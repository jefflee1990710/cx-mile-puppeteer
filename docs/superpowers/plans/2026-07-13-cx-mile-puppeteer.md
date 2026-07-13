# CX Mile Puppeteer Implementation Plan

> **For agentic workers:** Execute task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standalone Node app with local web UI + headed Puppeteer that deterministically scans CX award one-way availability.

**Architecture:** Express serves static UI and SSE; one search loop drives a headed Puppeteer page; scrape/login logic ported from `cx-mile-flight-scanner` (`page.evaluate` instead of `chrome.scripting`).

**Tech Stack:** Node 22, TypeScript, pnpm, Express, SSE, Puppeteer (headed), Vitest, static HTML/JS UI.

## Global Constraints

- Award only, one-way, multi-date × cabin combos
- Headed Chromium (`headless: false`)
- Deterministic scrape only — no LLM
- Sibling project at `/Users/jefflee/Projects/HKSG/cx-mile-puppeteer`
- Never commit passwords; gitignore `config.local.json`

---

### Task 1: Scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.nvmrc`, `README.md`

- [ ] Init package with scripts: `dev`, `build`, `start`, `test`, `type-check`
- [ ] Dependencies: `puppeteer`, `express`, `node-notifier`; dev: `typescript`, `tsx`, `vitest`, `@types/express`, `@types/node`

### Task 2: Pure scrape core

**Files:**
- Create: `src/scraper/types.ts`, `combos.ts`, `buildUrl.ts`, `availability.ts`, `awai.ts`, `log.ts`
- Test: `tests/combos.test.ts`, `tests/buildUrl.test.ts`, `tests/availability.test.ts`

Port award-only shapes from extension. `expandCombos`, `buildAwardSearchUrl`, `scrapeToResult`, `isAwardDateCellOpen`, AWAI bootstrap parse.

### Task 3: Puppeteer driver

**Files:**
- Create: `src/scraper/browser.ts`, `login.ts`, `awardSearch.ts`, `loop.ts`
- Port: `src/scraper/loginPageFns.ts` (injected funcs from extension `cxLogin.ts`)

`openAwardSearch` / `readAwardResults` / `returnToRedeem` / `performLogin` via `page.evaluate`.
Reuse `runSearchLoop` semantics from extension `searchLoop.ts`.

### Task 4: Server + UI + notify

**Files:**
- Create: `src/server/index.ts`, `src/server/loopRunner.ts`, `src/server/events.ts`, `src/notify.ts`
- Create: `src/ui/index.html`, `src/ui/app.js`, `src/ui/styles.css`

API: `POST /api/start`, `POST /api/stop`, `GET /api/events`, `GET /api/status`.
UI: auto-login, tasks, dates chips, cabins, adults, interval, Start/Stop, results, log.

### Task 5: Verify

- [ ] `pnpm test` passes
- [ ] `pnpm type-check` passes
- [ ] README documents `pnpm dev` and CAPTCHA/manual login note
