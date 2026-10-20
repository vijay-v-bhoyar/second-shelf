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
