/* global document, window */
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { sourceDigest } from "./evidence.mjs";

const base = process.env.ADOPTION_DEMO_URL ?? "http://127.0.0.1:4397";
const target = base.includes("127.0.0.1") ? "local" : "public";
const dir = `output/playwright/adoption-${target}-${new Date().toISOString().replaceAll(":", "-")}`;
await mkdir(dir, { recursive: true });
const healthResponse = await fetch(base + "/api/v1/health"), health = await healthResponse.json();
assert.equal(healthResponse.status, 200); assert.equal(health.app, "Second Shelf");
const subject = await sourceDigest(), browser = await chromium.launch();
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
const page = await context.newPage(), checks = [], errors = [];
page.setDefaultTimeout(20000); page.on("pageerror", e => errors.push(e.message));
await context.tracing.start({ screenshots: true, snapshots: true });
let created = false;
async function check(name, fn) {
  try { await fn(); checks.push({ name, status: "PASS" }); console.log("PASS " + name); }
  catch (e) { checks.push({ name, status: "FAIL", message: e.message }); throw e; }
}
async function overview() { await page.getByRole("button", { name: "Overview", exact: true }).click(); }
try {
  await check("AT01 P01/P05 sees actual capability, fit, safe data and exit before signup", async () => {
    await page.goto(base);
    const copy = await page.locator(".hero-note").innerText();
    assert(copy.includes(health.providerMode === "fixture" ? "Illustrative recommendations" : health.providerMode === "live" ? "Qloo access is enabled" : "Discovery is unavailable"));
    assert((await page.getByRole("region", { name: "Before you start" }).innerText()).includes("POS system"));
    await page.getByRole("heading", { name: "Leave with control" }).waitFor({ state: "visible" });
  });
  await check("AT02 P01 first-value guide reflects inventory, display state and expiry", async () => {
    created = true;
    await page.getByRole("button", { name: "Try a bookstore demo" }).click();
    await page.getByRole("heading", { name: "Your path to a first display" }).waitFor({ state: "visible" });
    const workspace = await (await context.request.get(base + "/api/v1/workspace")).json();
    const guide = await page.locator(".setup-guide").innerText();
    assert(guide.includes(`${workspace.books.filter(b => b.eligible).length} titles currently eligible`));
    assert(guide.includes("No active display yet")); assert(guide.includes("expires at"));
    if (health.providerMode === "unconfigured") assert(guide.includes("Discovery is unavailable"));
    if (health.providerMode === "fixture") assert(guide.includes("not customer demand or sales improvement"));
    assert(!(await page.locator(".sidebar-bottom").innerText()).includes("Stored locally"));
  });
  await check("AT03 P01/P02 inventory handoff uses real navigation", async () => {
    await page.getByRole("button", { name: "Start inventory review", exact: true }).click();
    await page.getByRole("heading", { name: "Your inventory", exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Import inventory", exact: true }).waitFor({ state: "visible" });
  });
  await check("AT04 P01 approval/handoff guidance opens the current display", async () => {
    await overview(); await page.getByRole("button", { name: "Inspect display readiness", exact: true }).click();
    await page.getByRole("heading", { name: "Cultural displays", exact: true }).waitFor({ state: "visible" });
    if (health.providerMode === "unconfigured") assert(await page.getByRole("button", { name: "Generate cultural proposal", exact: true }).isDisabled());
  });
  await check("AT05 P01/P08 evidence and exit navigation is available", async () => {
    await overview(); await page.getByRole("button", { name: "Inspect review evidence", exact: true }).click();
    await page.getByRole("heading", { name: "Weekly review", exact: true }).waitFor({ state: "visible" });
    await overview(); await page.getByRole("button", { name: "Export or delete this demo", exact: true }).click();
    await page.getByRole("heading", { name: "Data & privacy", exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Delete sample bookstore", exact: true }).waitFor({ state: "visible" });
  });
  await check("AT06 P09/P05 narrow-screen controls, axe and voluntary exit", async () => {
    await overview(); await page.setViewportSize({ width: 360, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    await writeFile(`${dir}/axe.json`, JSON.stringify(axe.violations, null, 2)); assert.equal(axe.violations.length, 0);
    await page.keyboard.press("Tab"); assert(await page.locator(":focus").count());
    await page.screenshot({ path: `${dir}/setup-mobile.png`, fullPage: true });
    await page.getByRole("button", { name: "Export or delete this demo", exact: true }).click();
    page.once("dialog", d => d.accept()); await page.getByRole("button", { name: "Delete sample bookstore", exact: true }).click();
    await page.waitForURL(base + "/"); created = false; assert.equal((await context.request.get(base + "/api/v1/workspace")).status(), 401);
    assert.deepEqual(errors, []);
  });
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally {
  if (created) {
    const sessionResponse = await context.request.get(base + "/api/v1/session");
    if (sessionResponse.status() === 200) {
      const session = await sessionResponse.json();
      const cleanup = await context.request.delete(base + "/api/v1/store", { data: { confirm: true }, headers: { origin: base, "x-csrf-token": session.csrfToken, "idempotency-key": randomUUID() } });
      if (cleanup.status() !== 202) { errors.push("Test-store cleanup failed"); process.exitCode = 1; }
    } else if (sessionResponse.status() !== 401) { errors.push("Could not establish cleanup state"); process.exitCode = 1; }
  }
  await context.tracing.stop({ path: `${dir}/trace.zip` }); await browser.close();
  const result = { at: new Date().toISOString(), base, target, health, sourceDigest: subject, oracleHash: createHash("sha256").update(await readFile("scripts/adoption-e2e.mjs")).digest("hex"), checks, errors, humanExperience: "NOT_RUN", scope: "Synthetic owner/evaluator onboarding mechanisms; no merchant demand, human comprehension or live discovery proof" };
  await writeFile(`${dir}/results.json`, JSON.stringify(result, null, 2));
  await writeFile(`output/playwright/adoption-${target}-latest.json`, JSON.stringify({ directory: dir, passed: checks.filter(c => c.status === "PASS").length, failed: checks.filter(c => c.status === "FAIL").length }, null, 2));
  console.log(`Adoption ${target}: ${checks.filter(c => c.status === "PASS").length} PASS, ${checks.filter(c => c.status === "FAIL").length} FAIL; ${dir}`);
}
