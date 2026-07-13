# CX Mile Puppeteer

Standalone local web UI + **headed Puppeteer** scanner for Cathay Pacific **award (one-way)** Asia Miles availability.

Deterministic scrape only (no LLM). Sibling of [`cx-mile-flight-scanner`](../cx-mile-flight-scanner).

## Requirements

- Node 22+ (`nvm use` with `.nvmrc`)
- pnpm 9+

## Quick start

```bash
pnpm install
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

## Notes

- Credentials stay in browser `localStorage` (never commit passwords).
- If reCAPTCHA / MFA blocks auto-login, complete it in the headed Chromium window, then Start again.
- Personal CX account use only; scraping may break when CX changes DOM.

## Docs

- Design: [`docs/superpowers/specs/2026-07-13-cx-mile-puppeteer-design.md`](docs/superpowers/specs/2026-07-13-cx-mile-puppeteer-design.md)
- Plan: [`docs/superpowers/plans/2026-07-13-cx-mile-puppeteer.md`](docs/superpowers/plans/2026-07-13-cx-mile-puppeteer.md)
