import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { AppError, schemas } from "../src/server/domain";

test("frozen recommendation bounds reject duplicate/empty SKUs and preserve long interest IDs", () => {
  const valid = { interestIds: ["i".repeat(200)], budgetMinor: 1_000_000, excludedSkus: ["s".repeat(80)] };
  assert.equal(schemas.recommendation.safeParse(valid).success, true);
  for (const change of [
    { excludedSkus: [""] }, { excludedSkus: ["same", "same"] },
    { excludedSkus: ["s".repeat(81)] }, { budgetMinor: 1_000_001 },
    { interestIds: [] }, { interestIds: ["same", "same"] }, { arm: "treatment" }
  ]) assert.equal(schemas.recommendation.safeParse({ ...valid, ...change }).success, false, JSON.stringify(change));
});

test("public application errors retain stable classification and bounded messages", () => {
  const error = new AppError("INVALID_INPUT", "x".repeat(500), 422, false);
  assert.equal(error.message.length, 200);
  assert.equal(error.code, "INVALID_INPUT");
  assert.equal(error.status, 422);
  assert.equal(error.retryable, false);
});

test("synthetic API read contracts, isolation and validation failures", async t => {
  delete process.env.DATABASE_URL;
  delete process.env.VERCEL;
  delete process.env.SECOND_SHELF_APP_ORIGIN;
  process.env.SECOND_SHELF_PROVIDER_MODE = "fixture";
  process.env.SECOND_SHELF_LIVE_CALLS_AUTHORIZED = "false";
  process.env.QLOO_API_KEY = "";
  process.env.SECOND_SHELF_DATA_DIR = await mkdtemp(path.join(tmpdir(), "ss-contract-alignment-"));
  const originalFetch = globalThis.fetch;
  let networkAttempts = 0;
  globalThis.fetch = async () => { networkAttempts++; throw new Error("Network prohibited in synthetic contract test"); };
  const { dispatch } = await import("../src/server/service");
  const { db, getStore, mutateStore } = await import("../src/server/repository");
  const api = parse(await readFile("docs/prebuild/openapi.yaml", "utf8"));
  type Actor = { cookie: string; csrf: string };
  const owner: Actor = { cookie: "", csrf: "" }, other: Actor = { cookie: "", csrf: "" };
  const origin = "http://127.0.0.1:4397";
  const witnesses: { route: string; schema: string; body: unknown }[] = [];
  async function call(actor: Actor, route: string, body?: unknown, method = "POST") {
    const response = await dispatch(new Request(`${origin}/api/v1/${route}`, {
      method: body === undefined ? "GET" : method,
      headers: { origin, cookie: actor.cookie, "x-csrf-token": actor.csrf, "content-type": "application/json", "idempotency-key": randomUUID() },
      body: body === undefined ? undefined : JSON.stringify(body)
    }), route.split("?")[0].split("/"));
    const cookie = response.headers.get("set-cookie");
    if (cookie) actor.cookie = cookie.split(";")[0];
    const data = response.headers.get("content-type")?.includes("json") ? await response.json() : await response.text();
    return { response, data };
  }
  async function grant(permission: string) {
    const result = await call(owner, "memberships", { identityId: `Synthetic ${permission}`, permissions: [permission] });
    assert.equal(result.response.status, 201);
    const actor: Actor = { cookie: "", csrf: "" };
    assert.equal((await call(actor, "staff-sessions", { inviteToken: new URL(result.data.inviteUrl).hash.slice(8) })).response.status, 201);
    actor.csrf = (await call(actor, "staff/session")).data.csrfToken;
    return { actor, id: result.data.id };
  }
  try {
    const health = await call(owner, "health");
    assert.equal(health.data.app, "Second Shelf");
    assert.equal(health.data.providerMode, "fixture");
    assert.equal(health.data.persistence, "embedded-postgresql");
    const storeId = (await call(owner, "demo-sessions", {})).data.storeId;
    owner.csrf = (await call(owner, "session")).data.csrfToken;
    const otherId = (await call(other, "demo-sessions", {})).data.storeId;
    other.csrf = (await call(other, "session")).data.csrfToken;
    assert.notEqual(storeId, otherId);
    const reviewer = await grant("review_read"), cashier = await grant("outcome_verify");
    const store = await getStore(storeId), campaign = store.campaigns[0];
    // Real API activation, not a forged active-state flag.
    assert.equal((await call(owner, `campaigns/${campaign.id}/approve`, { expectedRevision: campaign.revision })).response.status, 200);
    const approved = (await getStore(storeId)).campaigns[0];
    assert.equal((await call(owner, `campaigns/${campaign.id}/activate`, { expectedRevision: approved.revision })).response.status, 200);
    const shopper: Actor = { cookie: "", csrf: "" };
    assert.equal((await call(shopper, `public/campaigns/${campaign.token}/sessions`, { noticeVersion: "demo-notice-v1", measurementOptIn: false })).response.status, 201);
    shopper.csrf = (await call(shopper, "shopper/session")).data.csrfToken;

    await t.test("missing read operations have role/path/response contracts", () => {
      for (const route of ["/workspace", "/staff/workspace", "/sample-csv", "/staff/sample-csv", "/exports/{id}/download"]) {
        assert.ok(api.paths[route]?.get?.operationId, route);
        assert.ok(api.paths[route].get["x-required-role"], route);
        assert.ok(api.paths[route].get.responses["200"].content, route);
      }
      assert.equal(api.paths["/staff/exports/{id}/download"], undefined);
    });
    await t.test("invalid recommendations create no jobs or assignment", async () => {
      const before = await getStore(storeId);
      for (const excludedSkus of [[""], ["same", "same"], ["x".repeat(81)]]) {
        const result = await call(shopper, "shopper/recommendations", { interestIds: ["fixture-film-miyazaki"], budgetMinor: 2000, excludedSkus });
        assert.equal(result.response.status, 400);
        assert.equal(result.data.code, "INVALID_INPUT");
      }
      const after = await getStore(storeId);
      assert.deepEqual(after.jobs, before.jobs);
      assert.deepEqual(after.assignments, before.assignments);
    });
    await t.test("hostile validation keys are not reflected and errors remain bounded", async () => {
      const marker = "PRIVATE_SYNTHETIC_MARKER_" + "x".repeat(300);
      const result = await call(owner, "campaigns", { title: "", candidateSkus: [], ruleRevisionIds: [], [marker]: marker });
      assert.equal(result.response.status, 400);
      assert.equal(result.data.code, "INVALID_INPUT");
      assert.ok(result.data.message.length <= 200);
      assert.ok(!JSON.stringify(result.data).includes("PRIVATE_SYNTHETIC_MARKER"));
      assert.match(result.data.requestId, /^[\da-f-]{36}$/i);
      witnesses.push({ route: "/campaigns invalid", schema: "Error", body: result.data });
    });
    await t.test("nonempty read models come from the synthetic owner/shopper/counter workflow", async () => {
      const requested = await call(shopper, "shopper/recommendations", { interestIds: ["fixture-film-miyazaki"], budgetMinor: 2000, excludedSkus: [] });
      assert.equal(requested.response.status, 202);
      let job = requested.data;
      for (let i = 0; i < 100 && job.status !== "succeeded" && job.status !== "failed"; i++) {
        await new Promise(resolve => setTimeout(resolve, 10)); job = (await call(shopper, `jobs/${job.id}`)).data;
      }
      assert.equal(job.status, "succeeded");
      const item = job.result.items[0]; assert.ok(item);
      const counter = await call(shopper, "shopper/purchase-code", { runId: job.id }); assert.equal(counter.response.status, 200);
      const purchase = await call(cashier.actor, "staff/outcomes", { type: "purchase", sessionCode: counter.data.code, sku: item.sku, quantity: 1, amountMinor: item.priceMinor, currency: "USD", occurredAt: new Date().toISOString(), receiptReference: "synthetic-contract-receipt" });
      assert.equal(purchase.response.status, 201);
      const current = (await getStore(storeId)).campaigns[0];
      assert.equal((await call(owner, `campaigns/${campaign.id}/review`, { expectedRevision: current.revision, periodStart: new Date(Date.now() - 3600000).toISOString(), periodEnd: new Date(Date.now() + 1000).toISOString(), decision: "keep", rationale: "Synthetic contract fixture only", activeWorkSeconds: 0 })).response.status, 200);
      const policy = await call(owner, `campaigns/${campaign.id}/policy-proposals`, { expectedRevision: current.revision, rationale: "Synthetic unapproved proposal", rankOffsets: [], trainingExperimentIds: [] }); assert.equal(policy.response.status, 201);
      assert.equal((await call(owner, `campaigns/${campaign.id}/experiments`, { campaignVersionId: current.versionId, comparison: "policy_vs_policy", protocolVersion: "synthetic-contract-v1", modelVersion: "fixture", policyVersionIds: [policy.data.id], plannedSampleSize: 20, enrollmentClosesAt: new Date(Date.now() + 3600000).toISOString() })).response.status, 201);
      const rule = await call(owner, "rules", { type: "exclude_sku", operand: "excluded-synthetic-sku", scope: "store", example: { sku: "allowed", language: "en", format: "paperback", priceMinor: 1000, expectedPass: true }, counterexample: { sku: "excluded-synthetic-sku", language: "en", format: "paperback", priceMinor: 1000, expectedPass: false }, reviewAt: new Date(Date.now() + 3600000).toISOString() });
      assert.equal(rule.response.status, 201);
      assert.equal((await call(owner, `rules/${rule.data.id}`, { expectedRevision: 1, active: false }, "PATCH")).response.status, 200);
    });
    await t.test("workspace and CSV obey independent role and tenant projections", async () => {
      const a = await call(owner, "workspace"), b = await call(other, "workspace"), staff = await call(reviewer.actor, "staff/workspace");
      assert.equal(a.data.id, storeId); assert.equal(b.data.id, otherId);
      for (const key of ["outcomes", "reviews", "policies", "experiments", "rules", "audit", "memberships"]) assert.ok(a.data[key].length > 0, key);
      assert.equal("expectedRevision" in a.data.policies[0], false);
      assert.equal(staff.data.actor, "staff"); assert.equal(staff.data.id, storeId);
      for (const key of ["outcomes", "policies", "experiments", "audit", "memberships"]) assert.deepEqual(staff.data[key], []);
      assert.equal("token" in a.data, false);
      for (const [actor, route] of [[owner, "sample-csv"], [reviewer.actor, "staff/sample-csv"]] as const) {
        const csv = await call(actor, route); assert.equal(csv.response.status, 200);
        assert.match(csv.response.headers.get("content-type")!, /text\/csv/);
        assert.match(csv.data, /^sku,isbn13,title,author,/);
      }
      assert.equal((await call(shopper, "workspace")).response.status, 403);
      assert.equal((await call(shopper, "sample-csv")).response.status, 403);
      witnesses.push({ route: "/workspace", schema: "Workspace", body: a.data }, { route: "/staff/workspace", schema: "Workspace", body: staff.data });
      const cashierWorkspace = await call(cashier.actor, "staff/workspace");
      assert.equal(cashierWorkspace.data.outcomes.length, 1);
      assert.deepEqual(cashierWorkspace.data.reviews, []);
      assert.equal(staff.data.reviews.length, 1);
      witnesses.push({ route: "/staff/workspace cashier", schema: "Workspace", body: cashierWorkspace.data });
    });
    await t.test("sample review profiles expose activity rather than effect estimates", async () => {
      for (const [actor, prefix] of [[owner, ""], [reviewer.actor, "staff/"]] as const) {
        const review = await call(actor, `${prefix}campaigns/${campaign.id}/review`);
        assert.equal(review.data.periodBasis, "activity_window");
        assert.equal(review.data.evidenceStatus, "simulation");
        assert.equal(review.data.differencePercentagePoints, null);
        assert.equal(typeof review.data.generationRuns, "number");
        witnesses.push({ route: `${prefix}review`, schema: "DemoReview", body: review.data });
      }
    });
    await t.test("export download requires owner, own ready job and nonexpired lease", async () => {
      for (const format of ["json", "csv"]) {
        const requested = await call(owner, "exports", { format }); assert.equal(requested.response.status, 202);
        let job = requested.data;
        for (let i = 0; i < 100 && job.status !== "succeeded" && job.status !== "failed"; i++) {
          await new Promise(resolve => setTimeout(resolve, 10)); job = (await call(owner, `jobs/${job.id}`)).data;
        }
        assert.equal(job.status, "succeeded");
        const route = `exports/${job.id}/download`, downloaded = await call(owner, route);
        assert.equal(downloaded.response.status, 200);
        assert.equal(downloaded.response.headers.get("cache-control"), "no-store");
        if (format === "json") {
          assert.equal(downloaded.data.dataMode, "demo");
          assert.equal("token" in downloaded.data.campaigns[0], false);
          witnesses.push({ route: "/exports/{id}/download", schema: "DemoExport", body: downloaded.data });
        } else assert.match(downloaded.data, /^data_mode,sku,title,author,price_minor,on_hand/);
        assert.equal((await call(other, route)).response.status, 404);
        assert.equal((await call(reviewer.actor, `staff/${route}`)).response.status, 403);
        assert.equal((await call(cashier.actor, `staff/${route}`)).response.status, 403);
        assert.equal((await call(shopper, route)).response.status, 403);
        await mutateStore(storeId, s => { s.jobs.find(j => j.id === job.id)!.result!.expiresAt = "2000-01-01T00:00:00.000Z"; });
        assert.equal((await call(owner, route)).response.status, 404);
      }
      assert.equal((await call(owner, `exports/${randomUUID()}/download`)).response.status, 404);
    });
    await t.test("revoked staff cannot reuse documented read operations", async () => {
      assert.equal((await call(owner, `memberships/${reviewer.id}`, {}, "DELETE")).response.status, 200);
      for (const route of ["staff/workspace", "staff/sample-csv"]) assert.equal((await call(reviewer.actor, route)).response.status, 401);
      assert.equal((await getStore(otherId)).name, "Juniper & Ink");
    });
    assert.equal(networkAttempts, 0);
    if (process.env.SECOND_SHELF_CONTRACT_EVIDENCE_FILE) await writeFile(process.env.SECOND_SHELF_CONTRACT_EVIDENCE_FILE, JSON.stringify({ kind: "PRIVATE_SYNTHETIC_API_WITNESSES", networkAttempts, witnesses }, null, 2));
  } finally {
    globalThis.fetch = originalFetch;
    await (await db()).close();
  }
});
