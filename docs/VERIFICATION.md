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
