# Second Shelf local operations

October 28, 2026. Local synthetic candidate under SS-S6-LOCAL-1. The USD 10 total ceiling is unchanged. Application call counters are not dollar meters, vendor quotas or a guarantee against cloud charges.

## Start and stop the local sample

Use a fresh isolated checkout/candidate without .env files. Run `npm.cmd ci --ignore-scripts`, `npm.cmd run build`, then `npm.cmd run demo`. Keep the terminal open; Ctrl+C stops that owned process. The demo binds 127.0.0.1:4397. Do not kill arbitrary Node processes or unrelated ports. If using a recorded background process, first verify its PID, creation time, command and workspace before stopping it. This workflow's test harness records its ephemeral port/PID and stops only that process tree.

Set `SECOND_SHELF_PROVIDER_MODE=fixture` and `SECOND_SHELF_LIVE_CALLS_AUTHORIZED=false`; clear inherited DATABASE_URL/VERCEL/provider variables for local tests without printing their values. Use a new `SECOND_SHELF_DATA_DIR` under the isolated directory. Never point restoration tests at the owner's database. The existing root node_modules may predate the lockfile; clean-install before using this candidate.

## Bounds and failures

Each store admits at most two unexpired queued/running jobs; a third request returns 429 without a third job. Jobs have a 30-second server deadline. Expired ownership fails closed, and a late provider response cannot publish a result. The client waits at most 35 seconds and respects the server deadline. A received job ID should be read back before creating replacement work. No general cancellation or durable reload recovery is promised. Repeated effectful requests require the same actor, key and exact intent; the response cache is bounded.

Provider attempts and demo-store admission consume persistent allowances. Errors can consume an attempt. Counter persistence and quota exhaustion are locally tested using intercepted providers; this is not proof of vendor billing limits or continuous hosted availability.

## Restart and restoration

Retain the original receipt, candidate digest, job ID, timestamps and error before retrying. Reopen only the owned local data directory. A running job is not automatically safe to reclaim; inspect its deadline and let the existing ownership guard decide. Do not regenerate an original ledger or overwrite user answers.

`npm.cmd run test:restore` creates temporary databases. It verifies disk reopen, current/target store and shopper tombstones, retained original purchase/return/correction events and stock projection, stripped staff sessions/invitations, and monotonically retained provider usage. Real restore requires the latest store-deletion, shopper-deletion and provider-budget manifests. Missing manifests fail closed. Local tests do not prove that a hosted operator possesses complete current manifests or that vendor backups have been purged.

## Cost protection and hosted stop procedure

The owner has accepted personal monitoring and early shutdown when the USD 10 ceiling is threatened. Before any hosted rollout, record the exact project/account, current spend, remaining credits, provider prices and usage, runtime/storage/egress costs, projected judging-period cost, and a shutdown owner. These values are currently UNVERIFIED; no paid/live calls are admitted by this document.

If projected total cost threatens USD 10: preserve a redacted receipt, prevent new provider admissions in the authorized app configuration, stop/pause the specifically authorized hosted service and verify its public entry is unavailable or maintenance-only. Preserve required data and deletion manifests before any destructive cleanup. Do not delete accounts, databases or backups as an assumed shutdown method. Verify vendor-side billable resources and final charges separately; closing a browser or killing local Node does not stop cloud billing. External configuration changes still require authority for the exact target. If availability conflicts with the ceiling, the ceiling wins; record that this may prevent judging access.

## Evidence boundaries

Current source/build/test and candidate identifiers are summarized in [dated verification](VERIFICATION.md); complete private receipts remain with the owner. Public URLs and prior deployment/source receipts are historical unless current candidate alignment is verified. No automated cost monitoring, outreach, deployment or submission is created by this runbook.
