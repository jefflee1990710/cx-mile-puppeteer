# CX Mile Puppeteer — Design

Date: 2026-07-13  
Status: Approved — implemented (v1 scaffold)  
Location: `/Users/jefflee/Projects/HKSG/cx-mile-puppeteer` (sibling of `cx-mile-flight-scanner`)

## Goal

A **standalone Node.js app** with a **local web UI** that drives **headed Puppeteer** to deterministically scan Cathay Pacific **award (Asia Miles) one-way** availability — same product intent as the Chrome extension `cx-mile-flight-scanner`, without LLM automation and without depending on `CXBrowserUse`.

User fills a form in the browser → Start → visible Chromium automates CX search in a loop → results stream back to the UI; OS notification + alert sound when seats are found.

## Decisions (locked)

| Topic | Decision |
|---|---|
| Approach | A — independent sibling project, deterministic scrape |
| UI | Local web app (`localhost`), form + Start/Stop + results |
| Automation | Puppeteer + bundled Chromium, **headed** (visible window) |
| Search mode | Award only (v1) |
| Trip type | One-way; discrete multi-date picks per task (not round-trip range) |
| Engine | Deterministic URL + DOM scrape (port logic from extension) |
| Not in v1 | Cash mode, LLM/browser-use, Chrome extension bridge, headless default |
| Package manager | pnpm + TypeScript |
| Parent folder | `/Users/jefflee/Projects/HKSG/` next to `cx-mile-flight-scanner` |

## Relationship to existing projects

| Project | Role |
|---|---|
| `cx-mile-flight-scanner` | Chrome extension reference — URL builders, login selectors, availability/AWAI parsers, loop semantics |
| `CXBrowserUse` | Out of scope — LLM-driven; do not reuse |
| `cx-mile-puppeteer` (this) | New Puppeteer + local web control panel |

Logic is **ported and adapted** (e.g. `page.evaluate` instead of `chrome.scripting.executeScript`), not imported as a workspace dependency of the extension monorepo.

## Architecture

```
┌─────────────────────────────┐
│  UI (localhost)             │
│  form · Start/Stop · results│
│  live log via SSE           │
└──────────────┬──────────────┘
               │ HTTP + SSE
               ▼
┌─────────────────────────────┐
│  Node server                │
│  /api/start /api/stop       │
│  /api/events (SSE)          │
│  search loop orchestration  │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  Puppeteer (headed)         │
│  one-way IBEFacade URL      │
│  auto-login on /sign-in     │
│  scrape date strip / AWAI   │
│  return to redeem form      │
└─────────────────────────────┘
```

### Control flow

1. User opens UI, fills award form (persisted in `localStorage` and/or server `config.json`).
2. **Start** → `POST /api/start` with form payload → server launches (or reuses) headed browser → runs search loop.
3. Each combo: build one-way award URL → navigate → if login wall, auto-login with saved creds → scrape → emit result event → navigate back to redeem search form.
4. On seats found: SSE event + desktop notification + longer alert sound.
5. Sleep `intervalMin`, next pass until **Stop** (`POST /api/stop`) or process exit.

## UI (v1 fields)

Mirror extension award form:

- **Auto sign-in**: checkbox, country code, mobile, password  
- **Tasks**: origin, destination, discrete departure dates (chips + add)  
- **Cabins**: eco / pey / bus / fir (multi)  
- **Adults**, **interval (minutes)**  
- **Start** / **Stop**  
- **Results**: every combo outcome (found + Not available)  
- **Log**: newest-first or append SSE lines  

No cash / max-price fields in v1.

## Server API (minimal)

| Endpoint | Purpose |
|---|---|
| `GET /` | Serve UI |
| `POST /api/start` | Body = form; start loop if idle |
| `POST /api/stop` | Stop loop; optionally close browser |
| `GET /api/events` | SSE: `log`, `result`, `passStart`, `status`, `error` |
| `GET /api/status` | `{ running, lastPassAt? }` |

Only one loop at a time. Second Start while running → 409 or no-op with status.

## Scraper modules (port from extension)

| Module | Source reference | Notes |
|---|---|---|
| `buildAwardUrl` | `buildCxPrompt.ts` | One-way: no `[2]` params; `DEPARTUREDATE[1]=date` |
| `expandCombos` | `combos.ts` + `types.ts` | Task dates × cabins |
| `login` | `cxLogin.ts` | Visible fields only; React fill; Continue / Sign in; ignore reCAPTCHA badge |
| `readAvailability` | `readAvailabilityDom.ts` / `readAwaiDom.ts` | `page.evaluate`; Not available text/class |
| `loop` | `searchLoop.ts` | Always emit result; leave results page after combo |
| `notify` | `notify.ts` + `alertSound.ts` | `node-notifier` (or similar) + optional local sound |

### Found semantics

- One-way: any bookable outbound date in the scraped strip that matches the searched date (combo `range.start === range.end === date`) counts as found.  
- Date cell with “Not available” / `.not-available` → not bookable.  
- UI still lists empty outcomes.

## Tech stack

- **Runtime**: Node 22 (match extension `.nvmrc` family; document in README)  
- **Language**: TypeScript  
- **Package manager**: pnpm  
- **Browser**: `puppeteer` (headed `headless: false`)  
- **Server**: Express (or native `node:http` if kept tiny)  
- **UI**: Vite + lightweight React **or** single HTML+TS page — prefer Vite+React only if form complexity warrants it; otherwise static TS is fine  
- **Realtime**: SSE  
- **Tests**: Vitest — pure unit tests for URL/combos/parsers with HTML fixtures; no Puppeteer in default CI  

## Project layout (proposed)

```
cx-mile-puppeteer/
  package.json
  pnpm-workspace.yaml   # optional single-package; keep simple
  tsconfig.json
  README.md
  src/
    server/
      index.ts          # HTTP + SSE + start/stop
      loopRunner.ts
    scraper/
      browser.ts        # launch/reuse headed browser
      buildUrl.ts
      combos.ts
      login.ts
      readAvailability.ts
      loop.ts
      types.ts
    notify.ts
    ui/                 # Vite app or static assets
  docs/superpowers/
    specs/
    plans/
  tests/
    fixtures/
```

## Config & secrets

- Form credentials stored locally (browser `localStorage` and/or gitignored `config.local.json`).  
- Never commit passwords.  
- README warns: personal CX account only; auto-login may hit CAPTCHA (headed window allows manual solve, then resume/retry).

## Success criteria (v1)

1. `pnpm dev` serves UI; Start opens a **visible** Chromium window.  
2. One-way award search runs for configured tasks/dates/cabins.  
3. Login wall uses saved mobile/password (Continue + password fill).  
4. Results appear in UI for both available and Not available.  
5. Stop ends the loop cleanly.  
6. Unit tests cover URL builder, combo expansion, and availability helpers.

## Out of scope (explicit)

- Cash / TSP scraping  
- Round-trip  
- LLM agents / CXBrowserUse code  
- Publishing as Chrome extension  
- Cloud deploy  
- Multi-user auth for the local UI  

## Self-review

- No placeholders for trip type / UI / headed mode.  
- Award-only v1 matches user choice.  
- Deterministic scrape only — no LLM path.  
- Sibling path and independence from extension monorepo documented.  
- CAPTCHA: headed + fail/pause behavior inherited from extension login design (manual intervene possible).
