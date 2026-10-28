# Second Shelf: local MCP candidate

Candidate SS-RC-20261028-MCP-42b03880b645, October 28, 2026. MIT-licensed prototype for reviewed bookstore discovery displays, with bounded read-only MCP tools for an external agent. This package is a local candidate, not a verified public release.

## Latest bounded verification

The unchanged candidate also passed a Windows Node 24.22.1 build, 159 tests and nine HTTP MCP checks. A separately authorized private MCP client passed live Qloo search, constrained ranking and rejection on a synthetic shop. Six provider calls were used across two approved runs, preserving an initial stop on an ambiguous book title. This is not current hosted, general provider-rights, human or benefit proof. See [dated verification](docs/VERIFICATION.md). No further provider calls are authorized by the exhausted test allowance.

## Reproduce on Windows

Use Node.js and npm in a clean directory. Do not copy private environment files, credentials or production databases. In a fresh PowerShell session:

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

Open http://127.0.0.1:4397 on this computer. Ctrl+C stops the owned server. Create a disposable bookstore, review identities and inventory, approve and activate its display, then use the public display token with the MCP client. See [agent connection guide](docs/MCP_AGENT_GUIDE.md) for tool names, invocation and boundaries. No Qloo credential is needed for fixture mode. USD 2000 minor units means USD 20; recommendations do not reserve inventory or create purchases.

The app uses Next.js 16.4.3 and the exact-pinned MCP SDK 2.4.0. Three tools inspect an active display, resolve a movie/music interest and recommend eligible books. There are no agent approval, payment, export, private enumeration or purchase tools. Quota accounting remains an effect. The adapter introduces no paid runtime model service; any calling agent has its own account and terms.

Current local evidence includes 159 unit/API tests, 92 maintained browser scenarios, nine production HTTP MCP steps, build/type/lint/REST-contract/restore and a zero-known-vulnerability audit. A separate actual assistant-selected MCP walkthrough used synthetic data. This is not live Qloo, independent human evaluation, an embedded LLM planner, a genuine LLM-only comparison or measured sales lift. Current public alignment, organizer interpretation, provider rights, operating costs and human acceptance remain unresolved.

This sanitized archive excludes credentials, private evidence, original project records, databases, build caches and Git history. The original source and earlier artifacts remain in the owner's workspace. Parent-workspace evidence links in operational guides are intentionally unavailable in this package. Historical live/hosted scripts are retained for reproducibility; their presence grants no permission to run them. Browser suites require a local test server and an installed Chromium; no browser download is triggered by this README.
