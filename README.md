# Second Shelf

Second Shelf connects a bookstore's selected inventory with shoppers' film and music tastes through Qloo. Owners approve displays before publication; shoppers choose a budget, reject suggestions and show a counter code.

## Status and limits

The public sample demo is https://second-shelf-liard.vercel.app/. Inventory, receipts and experiment assignment are synthetic. Local mode uses fixtures. The application has no runtime LLM planner or autonomous agent framework; display summaries are templates. The comparison control is alphabetical simulation. No sales benefit or merchant-beta qualification is claimed. Real merchant identity/recovery, POS integration, representative edition accuracy, full disaster recovery and human accessibility acceptance remain open.

## Run locally

Requires Node.js and npm; development evidence used Node 26.4.0.

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd run demo
```

Open http://127.0.0.1:4397 and choose Try a bookstore demo. Local default fixture mode requires no provider credential. Each browser receives an isolated expiring sample store. One process owns the local PGlite database.

## Verify

```powershell
npm.cmd run verify
```

This runs typecheck, lint, unit/API tests, contract validation, local restore, dependency audit and build. Browser suites require an already running isolated target and their specified environment variables. Install the matching Playwright Chromium separately if needed. Do not point scripts at a shared/public environment or run deployment/configuration helpers without explicit authorization and call/store limits.

## Providers and storage

The public demo uses Vercel, Neon PostgreSQL and server-side Qloo calls. The supplied .env.example intentionally contains blank credentials. Keep keys, connection strings, session/invitation secrets, runtime data, exports and browser traces private. Live mode needs the authorized account, API origin, call allowance and credentials; it is not enabled by this source snapshot. Provider errors are reported rather than silently replacing live results with fixtures.

## Evidence boundary

The October 19 deployed runtime passed 84 unit/API tests, seven local gates, 120 seeded browser checks, 10 focused local recovery scenarios and 54 public checks, including actual Qloo mapping/ranking. These are automated checks, not people or real purchases. See [verification and limitations](docs/VERIFICATION.md) for scope, retained failures and remaining gaps. Private traces and original human reports are excluded.

## License

Original project code is MIT licensed; see LICENSE. Third-party dependencies and provider content retain their applicable terms.
