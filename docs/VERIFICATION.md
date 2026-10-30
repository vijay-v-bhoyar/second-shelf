# Second Shelf: verification of the October 29 live release

The deployed application code matches `54862acb8052fbe34fb4931840ae5d377aa80db9`. Documentation-only updates do not imply another application deployment. The public app uses live Qloo with synthetic bookstore data; local reproduction defaults to fixtures.

| Evidence | Recorded result | Scope and limit |
|---|---|---|
| Exact public source package | 128 files; 176 configured automated tests PASS | Isolated Node 24 runtime with declared dependencies; not a new human or hosted test |
| Stale-availability repair | Selected-book and cached handoff rechecks; affected API/browser/build/type/lint/contract/restore checks PASS | Synthetic inputs; the repair requires both runId and sku |
| Successful live hosted workflow | All eleven checks PASS | Live Qloo plus fictional stores and outcomes; details below |
| Rendered public page | Sample label, live-Qloo disclosure, real film lookup, selected film and enabled discovery action PASS | Recommendation and counter actions were covered through the hosted API workflow, not this bounded rendered check |
| Cleanup and preservation | Both transient stores absent, corresponding tombstones present; source/configuration/protection and unrelated aliases preserved | One explicitly labeled synthetic judge display was retained with normal 24-hour expiry |
| Submission | Qloo entry 1246680 accepted October 29, 2026 at 19:22 Eastern and independently read back | A submission receipt is not an organizer eligibility judgment or award |

The eleven hosted checks cover live health/database persistence; isolated bootstrap and idempotency; inventory preview/commit; mapping, approval/activation and cross-store isolation; staff permissions; shopper recommendations/rejection; MCP protocol/tools/recommendations/rejection; stale-availability handoff; purchase/return/correction arithmetic; scoped export; and deletion/access revocation.

The successful release verification used seven actual Qloo calls: six in the hosted API workflow and one rendered film lookup. The shared counter ended at 16 on that dated run, including preserved earlier usage. This is a historical reading, not a current account balance or proof of unlimited access. Complete private receipts remain outside the source distribution.

An earlier release attempt failed a synthetic stock assertion, was rolled back, and its two transient stores and deployment were removed. Local clock-skew reproduction motivated ordering synthetic verifier transactions strictly after the observed inventory snapshot. The corrected verifier passed the full hosted workflow without changing application accounting. The exact original hosted cause remains unconfirmed; its failure was not erased or converted into a pass.

## Remaining coverage and operating limits

- No new full rendered fresh-store-to-counter live journey has been recorded for this release. The API workflow and selected browser checks above are distinct evidence.
- Demo stores and dated-stock eligibility expire after 24 hours. Start from the canonical app to create a fresh demo; do not rely on an old display token staying valid through judging.
- The owner-confirmed outside walkthrough used automation. A separate human test is waived. Physical bookstore use, representative assistive-technology acceptance and business benefit remain unproven.
- The agentic integration is an external agent using bounded MCP tools. There is no embedded LLM planner, genuine LLM-only comparator or real-merchant beta.
- The health endpoint's static publicRelease field still reports not-verified. Source identity, deployment/workflow and cleanup receipts supply release evidence; that field is not the release oracle.
- Provider licensing, account limits and service availability remain subject to applicable terms. Private caching guidance does not authorize arbitrary public redistribution. No raw provider responses or credentials are published here.

## Historical verification — older candidates

The dated reports below describe their original source and configuration. Their statements about current deployment, remaining test allowance or pending submission are historical; the October 29 release summary above governs the current status. Preserve them as evidence, not as new authorization to run old live/hosted scripts.

# October 28, 2026: MCP candidate verification

Candidate SS-RC-20261028-MCP-42b03880b645. Runtime SHA-256: `42b03880b6453acc075a038962bd87be1b5a68899f078e25209bdb14cc987fbe`.

Three bounded read-only MCP discovery tools are implemented over Streamable HTTP. An external agent can inspect an active public display, resolve a movie/music interest and request eligible books constrained by stock, budget and work rejection. Approval, activation, purchase, payment, private-store enumeration and export are not agent tools. Daily usage accounting remains an effect. See [agent guide](MCP_AGENT_GUIDE.md).

Observed checks on this candidate: 159 configured unit/API tests, 92 maintained browser scenarios, nine production HTTP MCP steps, build, typecheck, lint, REST structural contract and isolated restore passed. The recorded dependency audit found zero known vulnerabilities. A sanitized 125-file source archive was extracted, hash-checked, installed afresh and passed all 159 tests. An actual assistant-selected MCP walkthrough used fixture data and is distinct from the scripted protocol check. Private complete logs and receipts are retained by the owner.

An additional unchanged-candidate Windows Node 24.22.1 run passed production build, all 159 tests and nine HTTP MCP checks. This is local compatibility evidence, not the target Linux/serverless verification.

A separately authorized private live-Qloo MCP check passed search, stock/budget-constrained ranking and work rejection on a synthetic shop with two resolved book identities. Six total Qloo calls were consumed across two explicitly approved runs, including the preserved initial stop on an ambiguous third book title. No retries or fallback were used. Inventory, prices and outcomes remain synthetic. This was a scripted MCP client; the actual assistant-selected fixture walkthrough is separate evidence. Exact provider responses and identifiers remain private.

Current hosted alignment, applicable public-output/retention terms, account costs and unassisted human acceptance remain unverified. There is no embedded LLM planner, genuine same-LLM comparator, measured business benefit or completed merchant pilot. A successful bounded check does not establish organizer acceptance or submission. USD 10 remains the owner's ceiling; no further provider call is authorized by the exhausted test allowance.

The CLI examples require an active disposable display on a local fixture server. No credentials or personal data are needed. Do not run historical live/hosted mutation scripts without their separate authorization and limits. This report does not authorize provider calls, publication or deployment.

---

The following dated records are preserved historical evidence for older source; statements describing their current state do not describe the MCP candidate above.

# October 20, 2026: current source verification

Runtime SHA-256: `12a293b0c502102475f83f4141ccd1fc79ed9ed2022a7745f0d756cc9ef0256d`.

Duplicate editions: filter eligibility first, then choose the cheapest edition per confirmed work with an ordinal SKU tie break. Preserve provider work order, deduplicate request/result work IDs, reject out-of-pool IDs, retain the existing 50 eligible-row limit.

Rejection: retain original SKU feedback, additionally store the work identity from the actual offered result, and exclude matching editions both before ranking and before asynchronous commit. Legacy history is interpreted without rewriting it. Start-fresh and privacy deletion remain explicit. Incorrectly split work identities and missing/ambiguous legacy evidence remain limitations; title strings are not treated as identity.

Executed on this source:
- 96 unit/API tests, including 12 focused edition/rejection tests.
- Seven gates: typecheck, lint, unit/API, contract, restore, dependency audit and production build.
- 120 checks across eight existing seeded browser suites, 10 CSV recovery checks, and 8 new edition/rejection browser checks: 138 total.
- Original answer/submission records and all 24 existing test oracles preserved.

Tests use isolated local databases. Qloo contracts intercept network calls; browsers use fixture mode. This is not live-provider proof or physical Android/human accessibility acceptance. Public deployment and public regression tests for this candidate have NOT RUN. Organizer clarification remains unsent and agentic eligibility unresolved. No agent framework or runtime LLM was added.

Both defects were reproduced before repair. The first expanded test run contained fixture/helper errors (missing synthetic store token; reused shopper cookie); corrected without weakening assertions. An evidence aggregation directory-filter error was also corrected. Failed logs, passing results, screenshots, traces and hash manifests are retained privately, not published with session data.

The new browser suite is `scripts/edition-rejection-e2e.mjs`; it requires an isolated loopback fixture server. Unit regressions are included in `npm test`. Never run public mutation suites without an explicit allowance.

---

The following is historical evidence for the older deployed runtime, not this source:

# Verification and current limitations

On October 19, 2026, the deployed runtime source SHA-256 was:

`7726d01f6b420681a6b8f8922740b2fbb1231cf6dd0db141f7267a66d9c5b3a9`

The runtime digest covers src and the package/build configuration files using scripts/evidence.mjs; it is not the Git commit hash.

## Executed checks

| Environment | Result |
|---|---|
| Isolated local | 84 unit/API tests, seven verification gates, 120 existing seeded browser checks and 10 CSV recovery scenarios passed |
| Hosted public app, same runtime source | 54 checks passed: 29 live persona, six review, six onboarding, 11 startup and two CSV recovery checks |
| Hosted test accounting | 15 synthetic stores; 27 Qloo application reservations; all test stores removed |

The live journeys used actual Qloo search/ranking and independent sample staff credentials. Inventory, receipts and experimental assignments remain synthetic. Automated accessibility covers axe, keyboard and viewport/CSS sizing; it does not certify human accessibility, native browser zoom or physical-device acceptance. Private receipts, screenshots, exports and traces are retained separately rather than published with potentially sensitive session data.

## CSV recovery

Owner and curator uploads retain the selected file and operation key for deliberate Retry preview or Discard. Preview does not reload the workspace; explicit activation still does. Controlled tests delay delivery after the real server commits. Both roles recover the same preview without duplicate import or automatic activation, then explicitly activate successfully. The original intermittent transport cause remains unknown.

The new scripts are scripts/csv-preview-recovery-e2e.mjs for an isolated local fixture target and scripts/public-csv-recovery-e2e.mjs for explicitly authorized hosted testing. They create/delete synthetic records; do not run against shared data without explicit approval and resource bounds. No scripts run automatically by reading this report.

## Retained failures and boundaries

The initial parallel Node test run encountered an out-of-memory failure. The same ten test files passed all 84 tests using serial test concurrency; no test assertions were weakened. The first local recovery test had an ambiguous alert selector; after targeting the validation alert, all ten scenarios passed. Earlier failed evidence remains retained privately.

No runtime LLM planner or autonomous agent framework is implemented. Display summaries are templates; the comparison control is alphabetical simulation. Genuine prospective evaluation, real merchant identity/account recovery, POS integration, production disaster recovery/support and measured business benefit remain incomplete. A controlled hackathon demo is not a production merchant beta or evidence of sales uplift. Contest qualification and final acceptance are separate from these automated results.
