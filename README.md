# CX Mile Puppeteer

Standalone local web UI + **headed Puppeteer** scanner for Cathay Pacific **award (one-way)** Asia Miles availability.

Deterministic scrape only (no LLM). Sibling of [`cx-mile-flight-scanner`](../cx-mile-flight-scanner).

## Requirements

- Node 22+ (`nvm use` with `.nvmrc`)
- pnpm 9+

## Quick start

Run these from the **repo root** (the folder that contains `package.json`):

```bash
git clone https://github.com/jefflee1990710/cx-mile-puppeteer.git
cd cx-mile-puppeteer
pnpm install
cp .env.example .env.local   # optional: proxy / Browserless
pnpm start                   # or: pnpm dev (hot reload)
```

Open [http://localhost:3847](http://localhost:3847), fill the award form, click **Start**. A visible **Google Chrome** window opens (persistent profile) and runs the search loop.

| Script | Purpose |
|---|---|
| `pnpm start` | Run the app (`server.js` → `dist/` if built, else `tsx` source) |
| `pnpm dev` | Server + UI with hot reload (`tsx watch`) |
| `pnpm test` | Unit tests (URL / combos / availability — no browser) |
| `pnpm type-check` | TypeScript |
| `pnpm build` / `pnpm start:dist` | Compile then run only from `dist/` |

If you see `Missing script start or file server.js`, you are not in the project root — `cd` into `cx-mile-puppeteer` (where `package.json` and `server.js` live) and retry.

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
| **4. Human behaviour** | Random pauses, `ghost-cursor` Bezier clicks, 50–200ms keystroke jitter, scroll warm-up on redeem before IBEFacade | automatic |
| **5. TLS / JA fingerprint** | Default: **system Google Chrome** + persistent profile (closer to the extension). Optional CDP to Browserless | `CX_BROWSER_WS` / `CX_CHROME_PROFILE` |

Notes:

- The Chrome **extension** works because it drives **your real Chrome tab** (real TLS, cookies, Akamai `_abck`, and the OAuth `goto`→`createSession` chain). A fresh Puppeteer window often gets **Access Denied** on `book.cathaypacific.com/.../availability` even with the same URL.
- Closest match (recommended on Windows if Access Denied): launch Chrome with debug port, set `CX_CDP_URL=http://127.0.0.1:9222`, then Start (attaches to that Chrome; skips stealth/fingerprint).
  - macOS/Linux: `./scripts/launch-chrome-debug.sh`
  - Windows: `.\scripts\launch-chrome-debug.ps1`
- Local headed Chrome already has a real Chrome TLS stack; **do not spoof a Mac fingerprint on Windows** (fixed in code). **System Chrome launches vanilla (no stealth/fingerprint)** — if you still see `applying fingerprint`, you are on bundled Chromium. Prefer CDP on hard blocks. **IP reputation** (residential proxy) still matters.
- Sticky residential sessions only — rotating IP every request looks bot-like.
- Credentials stay in UI `localStorage` / `.env.local` (never commit).

## Notes

- If reCAPTCHA / MFA still blocks auto-login, complete it in the headed Chromium window, then Start again.
- Personal CX account use only; scraping may break when CX changes DOM.

## Docs

- Design: [`docs/superpowers/specs/2026-07-13-cx-mile-puppeteer-design.md`](docs/superpowers/specs/2026-07-13-cx-mile-puppeteer-design.md)
- Plan: [`docs/superpowers/plans/2026-07-13-cx-mile-puppeteer.md`](docs/superpowers/plans/2026-07-13-cx-mile-puppeteer.md)
