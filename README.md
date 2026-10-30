# Second Shelf: bookstore discovery with MCP tools

Second Shelf connects a shopper's films or musicians with books in a reviewed bookstore display. The bookseller controls identities, dated inventory, approval and activation. Shoppers choose a budget and can reject a work; authorized staff record fictional purchases, returns and corrections.

**Public demo:** https://second-shelf-liard.vercel.app/  
**Project:** https://devpost.com/software/second-shelf  
**License:** [MIT](LICENSE), covering the original application code. Provider content and third-party software retain their applicable terms.

## Current public release — October 29, 2026

The public app uses **live Qloo search and cultural ranking** with synthetic bookstore inventory, prices and outcomes. The deployed application code matches commit `54862acb8052fbe34fb4931840ae5d377aa80db9`, including the stale-availability handoff repair. Later documentation-only commits may have a different source-repository head without changing this deployed application code.

The exact 128-file source package passed 176 automated tests. The successful release passed eleven hosted workflow checks using six Qloo calls; a separate rendered-page check used one live film lookup. The two transient test stores were independently confirmed deleted. These checks establish specific technical behavior, not human usability, real commerce or comparative business benefit. [Verification and limits](docs/VERIFICATION.md).

## Try the bookstore workflow

1. Choose **Try a bookstore demo** at the public app. Use fictional data only.
2. In **Your inventory**, review the identities for Piranesi and The Night Circus. Confirm only the matching book results; leave ambiguous or unmatched identities unresolved.
3. In **Cultural displays**, retain the eligible books, save the draft, approve it and activate it. Approval and activation are separate actions.
4. Open the shopper experience. Choose a film or musician and a budget, then request books. Results label their source. Rejecting a work excludes its other confirmed editions for that visit.
5. Explore the counter workflow with fictional outcomes. A handoff rechecks current availability, including cached retries. It does not reserve stock or process payment.

Demo stores and stock eligibility expire after 24 hours. Create a fresh demo from the canonical app if a saved display expires. Each new live store requires identity review and display approval. The instance has a persistent 100-Qloo-call limit per UTC day; quota and upstream errors are shown explicitly. Availability and account capacity can change.

## Agent access

The public Streamable HTTP endpoint is https://second-shelf-liard.vercel.app/mcp. Three read-only discovery tools inspect an active public display, resolve a film/music interest and recommend eligible books. The external agent supplies the public display token and uses its own client/account. Owner or staff credentials must never be passed to an agent. [Connection guide and tool boundaries](docs/MCP_AGENT_GUIDE.md).

The app has no embedded LLM planner. Tools cannot approve displays, enumerate private stores, export records, reserve stock, take payment or record purchases. Qloo usage counters are still effects of discovery calls.

## Reproduce locally on Windows

Use Node.js 24 and npm in a clean directory. Do not copy private environment files, credentials or production databases. These commands use local fixture data and make no live Qloo calls:

```powershell
Get-ChildItem Env: | Where-Object { $_.Name -match '^(SECOND_SHELF_|QLOO_|NEXT_PUBLIC_)' -or $_.Name -in @('DATABASE_URL','VERCEL','DEMO_BASE_URL','NODE_OPTIONS') } | ForEach-Object { Remove-Item -LiteralPath ('Env:' + $_.Name) }
$env:SECOND_SHELF_PROVIDER_MODE='fixture'
$env:SECOND_SHELF_LIVE_CALLS_AUTHORIZED='false'
$env:SECOND_SHELF_DATA_DIR=Join-Path (Get-Location) '.data/local-synthetic'
$env:NEXT_TELEMETRY_DISABLED='1'
npm.cmd ci --ignore-scripts
npm.cmd run build -- --webpack
npm.cmd run typecheck
npm.cmd run lint
$candidateTests=((Get-Content package.json -Raw | ConvertFrom-Json).scripts.test -split ' ') | Select-Object -Skip 2
node --import tsx --test --test-concurrency=1 @candidateTests
npm.cmd run verify:contract
npm.cmd run test:restore
npm.cmd run demo
```

Open http://127.0.0.1:4397 on this computer. Ctrl+C stops the owned server. Fixture results are illustrative and must not be described as live Qloo results. Browser suites additionally require their documented local server and installed Chromium. The runtime uses Next.js 16.4.3 and exact-pinned MCP SDK 2.4.0.

## Evidence boundaries

The outside tester's walkthrough is owner-confirmed automated feedback. A separate unassisted human test was waived; no human-usability or accessibility pass is claimed. An embedded planner, genuine LLM-only comparison and real-merchant beta are deferred. No sales uplift, time saving or comparative superiority has been measured.

Keep API credentials and raw Qloo responses out of public source. Event-specific guidance supports private server-side caching; it is not blanket permission to redistribute provider datasets, media or logos. An instance's configured cap is not proof of the provider account's quota or a monetary limit.
