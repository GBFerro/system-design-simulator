import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Download, type Page } from "@playwright/test";
import { open, goToStep } from "./helpers";

// Spec 05: export → fresh storage → import, and a real v1 localStorage opening in v2.

const V1_FIXTURE = JSON.parse(
  readFileSync(join(__dirname, "../unit/fixtures/v1-localStorage.json"), "utf8"),
) as Record<string, string>;

// Wide enough that the top bar's Reference button isn't covered by the problem title.
test.use({ viewport: { width: 1600, height: 900 } });

const nodes = (page: Page) => page.locator(".react-flow__node");
const edges = (page: Page) => page.locator(".react-flow__edge");

async function readJson(download: Download) {
  const path = await download.path();
  return JSON.parse(readFileSync(path, "utf8"));
}

async function exportMenu(page: Page, item: "Export as JSON" | "Export as SVG") {
  await page.getByTitle("Export design (Ctrl+E)").click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: item }).click();
  return downloaded;
}

/** Contents of the app's IndexedDB key-value store. */
function readIdb(page: Page, key: string) {
  return page.evaluate(
    (k) =>
      new Promise<unknown>((resolve, reject) => {
        const req = indexedDB.open("systemforge");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("kv")) return resolve(undefined);
          const get = db.transaction("kv").objectStore("kv").get(k);
          get.onsuccess = () => resolve(get.result);
          get.onerror = () => reject(get.error);
        };
      }),
    key,
  );
}

test("export JSON → clear storage → import restores the design", async ({ page, browser }) => {
  await open(page);
  await page.getByTitle("Load reference solution").click();
  await expect(nodes(page).first()).toBeVisible();
  const nodeCount = await nodes(page).count();
  const edgeCount = await edges(page).count();
  expect(nodeCount).toBeGreaterThan(1);
  expect(edgeCount).toBeGreaterThan(0);

  const exported = await readJson(await exportMenu(page, "Export as JSON"));
  expect(exported.schemaVersion).toBe(4);
  // each call that is not async is saved with its response as an edge of its own
  expect(exported.edges.some((e: { data: { responseTo?: string } }) => e.data.responseTo)).toBe(
    true,
  );
  expect(exported.nodes).toHaveLength(nodeCount);
  expect(exported.nodes[0].data.params).toBeDefined();
  expect(exported.edges[0].data.rule).toBeDefined();

  // A fresh context = cleared localStorage and IndexedDB
  const context = await browser.newContext();
  const fresh = await context.newPage();
  await open(fresh);
  await expect(nodes(fresh)).toHaveCount(0);

  await fresh.getByTitle("Load design (Ctrl+O)").click();
  await fresh.locator('input[type="file"][accept=".json"]').setInputFiles({
    name: "design.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  const row = fresh.getByRole("button", { name: /^(?!Export |Delete ).*\(imported\)/ });
  await expect(row).toBeVisible();

  // Re-exporting the imported design gives back the same graph
  const exportRow = fresh.waitForEvent("download");
  await fresh.getByRole("button", { name: /^Export .* as JSON$/ }).click();
  const reExported = await readJson(await exportRow);
  expect(reExported.nodes).toEqual(exported.nodes);
  expect(reExported.edges).toEqual(exported.edges);

  await row.click();
  await expect(nodes(fresh)).toHaveCount(nodeCount);
  await expect(edges(fresh)).toHaveCount(edgeCount);

  // Saved designs live in IndexedDB now, not localStorage
  expect(await fresh.evaluate(() => localStorage.getItem("systemsim-saved-designs"))).toBeNull();
  const stored = JSON.parse((await readIdb(fresh, "systemsim-saved-designs")) as string);
  expect(stored.version).toBe(4);
  expect(stored.state.designs).toHaveLength(1);
  await context.close();
});

test("a v1 localStorage opens in v2 and saved designs move to IndexedDB", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.addInitScript((fixture) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    for (const [k, v] of Object.entries(fixture)) localStorage.setItem(k, v);
  }, V1_FIXTURE);
  // (the v1 fixture carries its own app state: it opens on the Problem step)
  await open(page, "/", "problem");
  await goToStep(page, "design");

  // Live canvas: 5 components + 1 text note, 5 calls (labels intact); the 4 that are
  // not async come out of the v4 migration with their response drawn
  await expect(nodes(page)).toHaveCount(6);
  await expect(edges(page)).toHaveCount(9);
  await expect(page.getByText("Read-heavy: cache-aside in front of the DB")).toBeVisible();
  await expect(page.getByText("click events")).toBeVisible();
  await expect(page.getByText("URL Shortener (Reference)")).toBeVisible();

  const canvas = JSON.parse(
    (await page.evaluate(() => localStorage.getItem("systemsim-canvas"))) as string,
  );
  expect(canvas.version).toBe(4);
  expect(canvas.state.nodes[1].data.params.instances).toBe(4);
  expect(canvas.state.nodes[1].data).not.toHaveProperty("replicas");

  // Saved designs: listed, moved to IndexedDB, removed from localStorage
  await page.getByTitle("Load design (Ctrl+O)").click();
  await expect(page.getByRole("button", { name: /^URL shortener v3/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Old custom idea/ })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("systemsim-saved-designs")))
    .toBeNull();
  const stored = JSON.parse((await readIdb(page, "systemsim-saved-designs")) as string);
  expect(stored.version).toBe(4);
  expect(stored.state.designs.map((d: { name: string }) => d.name)).toEqual([
    "URL shortener v3",
    "Old custom idea",
  ]);
  expect(errors).toEqual([]);
});

test("SVG export includes the pen strokes", async ({ page }) => {
  await page.addInitScript((fixture) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    for (const [k, v] of Object.entries(fixture)) localStorage.setItem(k, v);
  }, V1_FIXTURE);
  // (the v1 fixture carries its own app state: it opens on the Problem step)
  await open(page, "/", "problem");
  await goToStep(page, "design");
  await expect(nodes(page)).toHaveCount(6);

  const download = await exportMenu(page, "Export as SVG");
  expect(download.suggestedFilename()).toMatch(/\.svg$/);
  const svg = readFileSync(await download.path(), "utf8");
  expect(svg).toContain("<foreignObject");
  // Both fixture strokes, drawn after (on top of) the captured canvas
  expect(svg).toContain('fill="#f43f5e"');
  expect(svg).toContain('fill="#22d3ee"');
  expect(svg.lastIndexOf("<path")).toBeGreaterThan(svg.indexOf("<foreignObject"));
});
