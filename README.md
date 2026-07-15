# CX Mile Puppeteer

Standalone local web UI + **headed Puppeteer** scanner for Cathay Pacific **award (one-way)** Asia Miles availability.

Deterministic scrape only (no LLM). Sibling of [`cx-mile-flight-scanner`](../cx-mile-flight-scanner).

## Requirements

- Node 22+ (`nvm use` with `.nvmrc`)
- pnpm 9+

## Quick start

```bash
pnpm install
cp .env.example .env.local   # optional: proxy / Browserless
pnpm dev
```

Open [http://localhost:3847](http://localhost:3847), fill the award form, click **Start**. A visible Chromium window opens and runs the search loop.

| Script | Purpose |
|---|---|
| `pnpm dev` | Server + UI with hot reload (`tsx watch`) |
| `pnpm test` | Unit tests (URL / combos / availability — no browser) |
| `pnpm type-check` | TypeScript |
| `pnpm build` / `pnpm start` | Compile then run from `dist/` |

## Behaviour (v1)

- Award only, one-way, discrete multi-date × cabin combos
- Auto sign-in on CX `/sign-in` (mobile → Continue → password)
- Results stream to the UI (found + Not available)
- OS notification + alert sound when seats are found
- After each combo, browser returns to the redeem search form
- Loop sleeps `intervalMin` between passes until **Stop**

## Anti-bot / CAPTCHA hardening

All five layers below are wired in. Layers 2 and 5 need **your** credentials/endpoints.

| Layer | What we do | Config |
|---|---|---|
| **1. JS leaks** | `puppeteer-extra-plugin-stealth` + patches for `navigator.webdriver`, `chrome.runtime` / `csi`, languages/platform | automatic |
| **2. Residential proxy** | Session-pinned `--proxy-server` for the whole process (no per-click rotate) | `CX_PROXY_SERVER`, optional `CX_PROXY_USER` / `CX_PROXY_PASS` |
| **3. Hardware fingerprint** | UA matched to launched Chrome version; fixed viewport/locale/`Asia/Hong_Kong`; WebGL vendor/renderer spoof | automatic |
| **4. Human behaviour** | Random pauses, `ghost-cursor` Bezier clicks, 50–200ms keystroke jitter, scroll warm-up before login/search | automatic |
| **5. TLS / JA fingerprint** | Optional CDP connect to Browserless (or similar) so TLS ClientHello matches a real browser pool | `CX_BROWSER_WS` or `BROWSERLESS_WS` |

Notes:

- Local headed Chromium already has a real Chrome TLS stack; stealth + UA alignment help, but **IP reputation** (residential proxy) and **remote browser** (Browserless) matter most against hard CAPTCHAs.
- Sticky residential sessions only — rotating IP every request looks bot-like.
- Credentials stay in UI `localStorage` / `.env.local` (never commit).

## Notes

- If reCAPTCHA / MFA still blocks auto-login, complete it in the headed Chromium window, then Start again.
- Personal CX account use only; scraping may break when CX changes DOM.

## Docs

- Design: [`docs/superpowers/specs/2026-07-13-cx-mile-puppeteer-design.md`](docs/superpowers/specs/2026-07-13-cx-mile-puppeteer-design.md)
- Plan: [`docs/superpowers/plans/2026-07-13-cx-mile-puppeteer.md`](docs/superpowers/plans/2026-07-13-cx-mile-puppeteer.md)
