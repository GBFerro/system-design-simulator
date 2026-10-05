import { expect, test, type Locator, type Page } from "@playwright/test";
import { MOD, connect, open, quickAdd } from "./helpers";

// Request flow, the trace (FLW-33..41): the Flow tab and the edge highlight it drives.

interface HighlightHandle {
  setFlowHighlight(h: { edgeId: string; dir: "req" | "res" } | null): void;
}

async function setHighlight(page: Page, h: { edgeId: string; dir: "req" | "res" } | null) {
  await page.evaluate((value) => {
    (
      window as unknown as { __flowHighlightStore: HighlightHandle }
    ).__flowHighlightStore.setFlowHighlight(value);
  }, h);
}

test("a highlight set from the trace marks the edge and its direction, without an edit (FLW-39)", async ({
  page,
}) => {
  // ?e2e: the test drives the highlight through window.__flowHighlightStore (any build).
  await open(page, "/?e2e");
  await quickAdd(page, "Client");
  await quickAdd(page, "App Server");
  await connect(page, "client", "app-server");
  const edge = page.locator(".react-flow__edge");
  await expect(edge).toHaveCount(1);
  const edgeId = (await edge.getAttribute("data-id"))!;
  const saved = () => page.evaluate(() => localStorage.getItem("systemsim-canvas"));
  await expect.poll(saved).toContain(edgeId);
  const before = await saved();

  await setHighlight(page, { edgeId, dir: "req" });
  await expect(edge.locator('[data-edge-highlight="req"]')).toHaveCount(1);
  await setHighlight(page, { edgeId, dir: "res" });
  await expect(edge.locator('[data-edge-highlight="res"]')).toHaveCount(1);
  expect(await saved()).toBe(before); // canvasStore untouched
  await setHighlight(page, null);
  await expect(page.locator("[data-edge-highlight]")).toHaveCount(0);

  // No undo entry: one undo still removes the connection itself.
  await page.locator(".react-flow__pane").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(`${MOD}+z`);
  await expect(edge).toHaveCount(0);
});

const NO_TIMINGS = "Run the simulation or Analyze to see the timings";
const NO_ENTRY = "No entry point: connect a Client or an entry node";
const CACHE = "Cache / Redis";
const DB = "NoSQL Database";

/** The URL Shortener reference (a read-only tab) with the Flow tab open and its first trace drawn. */
async function referenceFlow(page: Page, scope?: Locator) {
  await page.getByTitle("Load reference solution").click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  const root = scope ?? page;
  await root.getByRole("tab", { name: "Flow" }).click();
  const panel = root.getByTestId("flow-panel");
  // the trace loads the engine lazily (cold chunk in dev)
  await expect(panel.locator("[data-arrow]").first()).toBeVisible({ timeout: 20_000 });
  return panel;
}

/** "Another request" until the trace shows a cache miss (seeded: same requests every run). */
async function untilMiss(panel: Locator) {
  await expect(async () => {
    if ((await panel.locator('[data-mark="miss"]').count()) === 0) {
      await panel.getByRole("button", { name: "Another request" }).click();
    }
    await expect(panel.locator('[data-mark="miss"]')).toHaveCount(1, { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
}

const arrow = (panel: Locator, kind: string, end: "from" | "to", label: string) =>
  panel.locator(`[data-arrow="${kind}"][data-${end}-label="${label}"]`);

test("a read of the reference: cache then database on a miss, async monitoring without a response, no timings without a snapshot (FLW-33..35, 37, 41)", async ({
  page,
}) => {
  await open(page, "/?e2e");
  const panel = await referenceFlow(page);
  await expect(page.getByText("Read-only reference")).toBeVisible(); // FLW-41: a read-only tab
  await expect(panel.getByRole("button", { name: "Read" })).toHaveAttribute("aria-pressed", "true");
  // no snapshot: the structure without times (FLW-37)
  await expect(panel.getByTestId("flow-no-timings")).toHaveText(NO_TIMINGS);
  await expect(panel.locator("[data-ms]")).toHaveCount(0);

  await untilMiss(panel);
  const cacheCall = arrow(panel, "call", "to", CACHE);
  const dbCall = arrow(panel, "call", "to", DB);
  await expect(cacheCall).toHaveCount(1);
  await expect(dbCall).toHaveCount(1);
  expect(Number(await dbCall.getAttribute("data-n"))).toBeGreaterThan(
    Number(await cacheCall.getAttribute("data-n")),
  );
  await expect(arrow(panel, "response", "from", DB)).toHaveCount(1);
  await expect(arrow(panel, "response", "from", CACHE)).toHaveCount(1);
  // monitoring is async: one arrow there, none back
  await expect(arrow(panel, "async", "to", "Monitoring")).toHaveCount(1);
  await expect(arrow(panel, "response", "from", "Monitoring")).toHaveCount(0);

  // a write skips the cache and writes to the database
  await panel.getByRole("button", { name: "Write" }).click();
  await expect(panel.getByRole("button", { name: "Write" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(arrow(panel, "call", "to", CACHE)).toHaveCount(0);
  await expect(arrow(panel, "call", "to", DB)).toHaveCount(1);
});

test("after Analyze each call shows its time and the total matches the entry's response (FLW-36)", async ({
  page,
}) => {
  await open(page, "/?e2e");
  await page.getByTitle("Load reference solution").click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await page.getByRole("tab", { name: "Simulate" }).click();
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.getByText("Analysis complete!")).toBeVisible({ timeout: 20_000 });

  await page.getByRole("tab", { name: "Flow" }).click();
  const panel = page.getByTestId("flow-panel");
  const total = panel.getByTestId("flow-total");
  await expect(total).toBeVisible({ timeout: 20_000 });
  await expect(total).toHaveText(/\d+(\.\d)? ms/);
  await expect(panel.getByTestId("flow-no-timings")).toHaveCount(0);
  const calls = panel.locator('[data-arrow="call"]');
  await expect(panel.locator("[data-ms]")).toHaveCount(await calls.count());

  const totalMs = Number(await total.getAttribute("data-total-ms"));
  const backAtEntry = await arrow(panel, "response", "to", "DNS").evaluateAll((els) =>
    Math.max(...els.map((el) => Number(el.getAttribute("data-at")))),
  );
  expect(totalMs).toBeGreaterThan(0);
  expect(backAtEntry).toBeCloseTo(totalMs, 6);
});

interface RuntimeHandle {
  getState(): {
    latest: { offeredRps: number; t: number } | null;
    pushSnapshot(s: unknown): void;
  };
}

/** Pushes `count` copies of the latest snapshot, `offeredRps` × `factor`, as later ticks. */
function pushTicks(page: Page, count: number, factor: number) {
  return page.evaluate(
    ([n, k]) => {
      const store = (window as unknown as { __runtimeStore: RuntimeHandle }).__runtimeStore;
      const base = store.getState().latest!;
      for (let i = 1; i <= n; i++) {
        // ±3% noise, like Poisson arrivals tick to tick
        const noise = 1 + 0.03 * Math.sin(i);
        store
          .getState()
          .pushSnapshot({ ...base, t: base.t + i * 0.05, offeredRps: base.offeredRps * k * noise });
      }
    },
    [count, factor] as const,
  );
}

/** Pushes one later tick per load (req/s), each a copy of the latest snapshot otherwise. */
function pushLoads(page: Page, loads: number[]) {
  return page.evaluate((values) => {
    const store = (window as unknown as { __runtimeStore: RuntimeHandle }).__runtimeStore;
    const base = store.getState().latest!;
    values.forEach((offeredRps, i) =>
      store.getState().pushSnapshot({ ...base, t: base.t + (i + 1) * 0.05, offeredRps }),
    );
  }, loads);
}

/** The reference after Analyze with the Flow tab showing the timed trace; returns the panel and the snapshot's load. */
async function analyzedFlow(page: Page) {
  await page.getByTitle("Load reference solution").click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await page.getByRole("tab", { name: "Simulate" }).click();
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.getByText("Analysis complete!")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("tab", { name: "Flow" }).click();
  const panel = page.getByTestId("flow-panel");
  await expect(panel.getByTestId("flow-total")).toBeVisible({ timeout: 20_000 });
  const load = await page.evaluate(
    () =>
      (window as unknown as { __runtimeStore: RuntimeHandle }).__runtimeStore.getState().latest!
        .offeredRps,
  );
  expect(load).toBeGreaterThan(1);
  return { panel, load };
}

test("the trace runs at the snapshot's load, and follows it when it changes (FLW-36)", async ({
  page,
}) => {
  await open(page, "/?e2e");
  const { panel, load } = await analyzedFlow(page);
  const total = panel.getByTestId("flow-total");
  const totalMs = async () => Number(await total.getAttribute("data-total-ms"));
  const atPeak = await totalMs();
  expect(atPeak).toBeGreaterThan(0);

  // The run's load drops to 1 req/s: request #1 is traced again at that load, with other times.
  await pushLoads(page, [1]);
  await expect(async () => {
    const idle = await totalMs();
    expect(idle).toBeGreaterThan(0);
    expect(idle).not.toBe(atPeak);
  }).toPass({ timeout: 15_000 });
  // Back at the peak: the same request at the same load gives the same total again.
  await pushLoads(page, [load]);
  await expect(total).toHaveAttribute("data-total-ms", String(atPeak), { timeout: 15_000 });
  await expect(panel.getByTestId("flow-request")).toHaveText("Request #1");
});

test("the trace isn't recomputed on every tick, only when the load really moves", async ({
  page,
}) => {
  await open(page, "/?e2e");
  await page.getByTitle("Load reference solution").click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await page.getByRole("tab", { name: "Simulate" }).click();
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.getByText("Analysis complete!")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("tab", { name: "Flow" }).click();
  const panel = page.getByTestId("flow-panel");
  await expect(panel.getByTestId("flow-total")).toBeVisible({ timeout: 20_000 });
  const runs = async () => Number(await panel.getAttribute("data-traces"));
  const before = await runs();

  // 30 ticks at the same load (with noise): no new trace. "Another request" is
  // the barrier: once it shows, everything the ticks triggered has rendered.
  await pushTicks(page, 30, 1);
  await panel.getByRole("button", { name: "Another request" }).click();
  await expect(panel.getByTestId("flow-request")).toHaveText("Request #2");
  expect(await runs()).toBe(before + 1);

  // the load doubles: one new trace at the new load, then none for the noise around it
  await pushTicks(page, 30, 2);
  await panel.getByRole("button", { name: "Another request" }).click();
  await expect(panel.getByTestId("flow-request")).toHaveText("Request #3");
  expect(await runs()).toBe(before + 3);
});

test("a design without an entry point says so instead of a diagram (FLW-40)", async ({ page }) => {
  await open(page, "/?e2e");
  await quickAdd(page, "App Server");
  await page.getByRole("tab", { name: "Flow" }).click();
  const panel = page.getByTestId("flow-panel");
  await expect(panel.getByText(NO_ENTRY)).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByTestId("sequence-diagram")).toHaveCount(0);
});

test("hovering a step highlights its edge and direction on the canvas (FLW-39)", async ({
  page,
}) => {
  await open(page, "/?e2e");
  const panel = await referenceFlow(page);
  const highlighted = (dir: string) =>
    page.locator(`.react-flow__edge [data-edge-highlight="${dir}"]`);

  await panel.locator('[data-arrow="call"]').first().hover();
  await expect(highlighted("req")).toHaveCount(1);
  await panel.locator('[data-arrow="response"]').last().hover();
  await expect(highlighted("res")).toHaveCount(1);
  await expect(highlighted("req")).toHaveCount(0);
  await page.getByTestId("flow-request").hover();
  await expect(page.locator("[data-edge-highlight]")).toHaveCount(0);
});

test.describe("on a phone", () => {
  test.use({ hasTouch: true });

  test("the Flow tab works in the bottom sheet and a tap highlights the edge (FLW-41)", async ({
    page,
  }) => {
    await open(page, "/?e2e");
    // (the reference button lives in the wide top bar: load it, then go phone-sized)
    await page.getByTitle("Load reference solution").click();
    await expect(page.locator(".react-flow__node").first()).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Toggle properties panel" }).click();
    const sheet = page.locator("[data-bottom-sheet]");
    await sheet.getByRole("tab", { name: "Flow" }).click();
    const panel = sheet.getByTestId("flow-panel");
    await expect(panel.locator("[data-arrow]").first()).toBeVisible({ timeout: 20_000 });
    await expect(panel.getByTestId("flow-no-timings")).toHaveText(NO_TIMINGS);

    await panel.locator('[data-arrow="call"]').first().tap();
    await expect(page.locator('.react-flow__edge [data-edge-highlight="req"]')).toHaveCount(1);
  });
});
