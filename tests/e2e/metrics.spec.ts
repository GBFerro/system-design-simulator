import { expect, test, type Page } from "@playwright/test";
import { analyze, connectSync, open, quickAdd } from "./helpers";

// Spec 07 (OBS-01..04): runtime metrics on nodes, in the Sim panel, and the
// particle overlay — all read from runtimeStore, never from node.data.

// Wide enough that the top bar's Reference button isn't covered by the problem title.
test.use({ viewport: { width: 1600, height: 900 } });

interface RuntimeHandle {
  getState(): {
    latest: {
      nodes: Record<string, unknown>;
      edges: Record<string, unknown>;
      global: unknown;
    } | null;
    pushSnapshot(s: unknown): void;
    setPlayback(p: string): void;
    clear(): void;
  };
}

async function loadReferenceAndSimulate(page: Page) {
  await page.getByTitle("Load reference solution").click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await analyze(page);
}

const particleCount = (page: Page) =>
  page
    .getByTestId("flow-particles")
    .getAttribute("data-particle-count")
    .then((v) => Number(v));

/** Pushes `count` synthetic snapshots over the current graph, 0.5 s simulated apart. */
function pushSyntheticRun(page: Page, count: number) {
  return page.evaluate((n) => {
    const store = (window as unknown as { __runtimeStore: RuntimeHandle }).__runtimeStore;
    const base = store.getState().latest!;
    for (let i = 0; i < n; i++) {
      const nodes: Record<string, unknown> = {};
      for (const [id, m] of Object.entries(base.nodes)) {
        const k = 1 + 0.5 * Math.sin(i / 3);
        const metrics = m as { rpsIn: number; rpsOut: number };
        nodes[id] = { ...metrics, rpsIn: metrics.rpsIn * k, rpsOut: metrics.rpsOut * k };
      }
      const g = base.global as { throughput: number; p99: number };
      const global = { ...g, throughput: g.throughput * (1 + 0.3 * Math.cos(i / 4)) };
      store.getState().pushSnapshot({ ...base, t: i * 0.5, nodes, global });
    }
  }, count);
}

test("Simulate: node badges, global + per-node panel metrics, particles", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await open(page, "/?e2e=1");
  await loadReferenceAndSimulate(page);

  // OBS-01 badge: RPS in > 0 and a p99 on at least one node, status icon labelled.
  const badges = page.getByTestId("node-metrics");
  await expect(badges.first()).toBeVisible();
  const rps = await badges.evaluateAll((els) => els.map((e) => Number(e.dataset.rpsIn)));
  expect(Math.max(...rps)).toBeGreaterThan(0);
  await expect(badges.first()).toContainText("p99");
  await expect(badges.first().getByRole("img", { name: /^Status: / })).toBeVisible();

  // No metrics in node.data: the persisted canvas carries none.
  const persisted = await page.evaluate(() => localStorage.getItem("systemsim-canvas") ?? "");
  expect(persisted).not.toMatch(/"utilization"|"isBottleneck"/);

  // OBS-02: the Sim panel shows global throughput and p99.
  await page.getByRole("tab", { name: "Simulate" }).click();
  await expect(page.getByTestId("global-throughput")).toContainText("req/s");
  await expect(page.getByTestId("global-latency")).toContainText(/p99 \d+ ms/);
  await expect(page.getByText("Availability")).toBeVisible();

  // Selecting a node (from the panel list) shows its metrics.
  await page
    .getByRole("button", { name: /RPS in/ })
    .first()
    .click();
  const detail = page.getByTestId("selected-node-metrics");
  await expect(detail).toBeVisible();
  for (const label of ["RPS in", "RPS out", "Queue", "p50", "p95", "p99", "Errors", "Drops"]) {
    await expect(
      detail.getByTestId("node-metric-grid").getByText(label, { exact: true }),
    ).toBeVisible();
  }

  // OBS-04: edges get status + load, and the overlay draws particles.
  await expect(page.locator("[data-edge-status]").first()).toBeAttached();
  await expect.poll(() => particleCount(page)).toBeGreaterThan(0);
  expect(await particleCount(page)).toBeLessThanOrEqual(2000);

  expect(errors).toEqual([]);
});

test("hovering a node badge shows a sparkline of the recent run", async ({ page }) => {
  await open(page, "/?e2e=1");
  await loadReferenceAndSimulate(page);
  await pushSyntheticRun(page, 40);

  await page.getByTestId("node-metrics").first().hover();
  const spark = page.getByTestId("node-sparkline");
  await expect(spark).toBeVisible();
  await expect(spark.locator("path")).toHaveAttribute("d", /^M[\d.]+ [\d.]+ L/);

  // The panel charts become time series too.
  await page.getByRole("tab", { name: "Simulate" }).click();
  await expect(page.getByTestId("chart-throughput").locator("svg path")).toHaveAttribute(
    "d",
    /^M[\d.]+ [\d.]+( L[\d.]+ [\d.]+){10,}/,
  );
});

test("prefers-reduced-motion: no particles, edges still show status and load", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "/?e2e=1");
  await loadReferenceAndSimulate(page);

  const overlay = page.getByTestId("flow-particles");
  await expect(overlay).toHaveAttribute("data-reduced-motion", "true");
  await pushSyntheticRun(page, 10);
  // Give the (absent) loop a few frames to prove nothing gets drawn.
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  expect(await particleCount(page)).toBe(0);

  const loaded = page.locator("[data-edge-rps]:not([data-edge-rps='0'])").first();
  await expect(loaded).toHaveAttribute("data-edge-status", /ok|slow|error/);
  const width = await loaded
    .locator("path.react-flow__edge-path")
    .evaluate((p) => parseFloat(getComputedStyle(p).strokeWidth));
  expect(width).toBeGreaterThan(1.5);
});

test("pushing snapshots never rewrites the persisted canvas", async ({ page }) => {
  await page.addInitScript(() => {
    const writes: string[] = [];
    (window as unknown as { __storageWrites: string[] }).__storageWrites = writes;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      writes.push(key);
      return original.call(this, key, value);
    };
  });
  await open(page, "/?e2e=1");
  await loadReferenceAndSimulate(page);

  const canvasWrites = () =>
    page.evaluate(
      () =>
        (window as unknown as { __storageWrites: string[] }).__storageWrites.filter(
          (k) => k === "systemsim-canvas",
        ).length,
    );
  // Let the one-off re-measure (badges appear under the nodes) settle first.
  await page.waitForTimeout(500);
  const before = await canvasWrites();
  await page.evaluate(() => {
    (window as unknown as { __runtimeStore: RuntimeHandle }).__runtimeStore
      .getState()
      .setPlayback("running");
  });
  await pushSyntheticRun(page, 50);
  await page.waitForTimeout(300);
  expect(await canvasWrites()).toBe(before);
});

test("tab switch clears runtime metrics", async ({ page }) => {
  await open(page, "/?e2e=1");
  await loadReferenceAndSimulate(page);
  await expect(page.getByTestId("node-metrics").first()).toBeVisible();

  await page.getByRole("button", { name: "My Design", exact: true }).click();
  await expect(page.getByTestId("node-metrics")).toHaveCount(0);
  const latest = await page.evaluate(
    () => (window as unknown as { __runtimeStore: RuntimeHandle }).__runtimeStore.getState().latest,
  );
  expect(latest).toBeNull();
  expect(await particleCount(page)).toBe(0);
});

// Performance sanity (NFR: 60 fps with 100 edges + 2,000 particles). Headless
// frame pacing varies by machine, so the bound is loose; the p95 is logged.
test("ball overlay keeps frame time low with 100 edges near the 2,000 cap", async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    const nodes: unknown[] = [];
    const edges: unknown[] = [];
    for (let c = 0; c < 10; c++) {
      for (let r = 0; r < 5; r++) {
        nodes.push({
          id: `n${c}-${r}`,
          type: "component",
          position: { x: c * 360, y: r * 200 },
          data: {
            componentId: "app-server",
            label: `S${c}${r}`,
            icon: "Server",
            category: "compute",
            scalable: true,
            params: {},
          },
        });
      }
    }
    // Every call at step 1: a node calls all its dependencies in parallel
    // (without a step they'd go one after another, request-flow FLW-31).
    const parallel = {
      calls: [{ kind: "always", step: 1, callsPerRequest: 1 }],
      networkLatencyMs: 1,
      packetLoss: 0,
    };
    const link = (a: string, b: string) =>
      edges.push({
        id: `p-${a}-${b}`,
        source: a,
        target: b,
        type: "animated",
        data: { rule: parallel },
      });
    for (let c = 0; c < 9; c++) {
      for (let r = 0; r < 5; r++) {
        link(`n${c}-${r}`, `n${c + 1}-${r}`);
        link(`n${c}-${r}`, `n${c + 1}-${(r + 1) % 5}`);
        if (c < 2) link(`n${c}-${r}`, `n${c + 1}-${(r + 2) % 5}`);
      }
    }
    localStorage.setItem(
      "systemsim-canvas",
      JSON.stringify({
        state: {
          nodes,
          edges,
          tabs: [{ id: "my-design", label: "My Design", nodes: [], edges: [] }],
          activeTabId: "my-design",
        },
        version: 2,
      }),
    );
  });
  await open(page, "/?e2e=1");
  // 100 calls, each drawn with its response (the v2 design gets them on migration)
  await expect(page.locator(".react-flow__edge")).toHaveCount(200);

  await page.evaluate(() => {
    const store = (window as unknown as { __runtimeStore: RuntimeHandle }).__runtimeStore;
    const edgeIds = [...document.querySelectorAll(".react-flow__edge[data-id]")]
      .filter((e) => !e.querySelector("[data-edge-response]"))
      .map((e) => (e as SVGGElement).dataset.id!);
    const edges: Record<string, unknown> = {};
    edgeIds.forEach((id, i) => {
      edges[id] = { rps: 1_000_000, status: i % 7 === 0 ? "error" : i % 5 === 0 ? "slow" : "ok" };
    });
    store.getState().pushSnapshot({
      t: 0,
      offeredRps: 1_000_000,
      nodes: {},
      edges,
      global: {
        throughput: 1e6,
        goodput: 1e6,
        errorRate: 0,
        p50: 1,
        p95: 2,
        p99: 3,
        availability: 1,
      },
    });
  });
  // Every node fans out ×2–3 at full load: the balls pile up toward the cap.
  await expect.poll(() => particleCount(page), { timeout: 15_000 }).toBeGreaterThan(1000);

  const p95 = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const deltas: number[] = [];
        let last = performance.now();
        const tick = (now: number) => {
          deltas.push(now - last);
          last = now;
          if (deltas.length < 180) requestAnimationFrame(tick);
          else resolve(deltas.sort((a, b) => a - b)[Math.floor(deltas.length * 0.95)]);
        };
        requestAnimationFrame(tick);
      }),
  );
  // The overlay's own cost per frame is the stable signal; the rAF p95 also
  // depends on the machine and on parallel test workers, so it is only logged
  // (with a loose bound against a runaway loop).
  await expect
    .poll(() => page.getByTestId("flow-particles").getAttribute("data-draw-ms"))
    .not.toBeNull();
  const drawMs = Number(await page.getByTestId("flow-particles").getAttribute("data-draw-ms"));
  console.log(
    `balls (100 edges, ≤ 2000): draw ${drawMs.toFixed(2)} ms/frame, rAF p95 ${p95.toFixed(1)} ms`,
  );
  expect(drawMs).toBeLessThan(8);
  expect(await particleCount(page)).toBeLessThanOrEqual(2000);
  expect(p95).toBeLessThan(100);
});

// OBS-04: the ×N badge opens a node into one card per instance, each with its own edges.
test("the ×N badge opens a node into instance cards, also on a read-only reference, without an undo entry", async ({
  page,
}) => {
  await open(page, "/?e2e=1");
  await page.getByTitle("Load reference solution").click();
  const app = page.locator('.react-flow__node[data-id^="app-server-"]');
  await expect(app).toBeVisible();
  const edgesBefore = await page.locator(".react-flow__edge").count();

  await app.getByRole("button", { name: "Show the 45 instances" }).click();
  const cards = page.getByTestId("instance-card");
  // 4 instance cards and one stacked card with the other 41.
  await expect(cards).toHaveCount(5);
  await expect(cards.last()).toContainText("+41 instances");
  await expect(cards.first()).toContainText("App Server #1");
  // Every edge of the node is drawn once per card.
  const appEdges = await page.locator('.react-flow__edge[data-id^="e-"]').count();
  expect(await page.locator(".react-flow__edge").count()).toBeGreaterThan(edgesBefore);
  expect(appEdges).toBeLessThan(edgesBefore);

  // Dragging a card moves the group, on a read-only tab too, with no undo entry.
  const first = cards.first();
  const box = (await first.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + 60, { steps: 6 });
  await page.mouse.up();
  const moved = (await first.boundingBox())!;
  expect(moved.x).toBeGreaterThan(box.x + 60);
  const second = (await cards.nth(1).boundingBox())!;
  expect(Math.abs(second.x - moved.x)).toBeLessThan(2);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

  await first.getByRole("button", { name: "Hide the 45 instances" }).click();
  await expect(cards).toHaveCount(0);
  await expect(app).toBeVisible();
});

// The selected resource's metrics in a card beside it on the canvas.
test("selecting a node during a run shows its metrics in a card beside it", async ({ page }) => {
  await open(page, "/?e2e=1");
  await page.getByTitle("Load reference solution").click();
  const lb = page.locator('.react-flow__node[data-id^="load-balancer-"]');
  await expect(lb).toBeVisible();

  // No run yet: selecting shows nothing.
  await lb.click();
  const card = page.getByTestId("node-insight-card");
  await expect(card).toHaveCount(0);

  await analyze(page);
  await expect(card).toBeVisible();
  await expect(card).toContainText("Load Balancer");
  await expect(card.getByTestId("node-throughput")).toContainText("req/s");
  await expect(card.getByTestId("node-latency")).toContainText("p99");
  // Beside the node, to its right.
  const nodeBox = (await lb.boundingBox())!;
  const cardBox = (await card.boundingBox())!;
  expect(cardBox.x).toBeGreaterThan(nodeBox.x + nodeBox.width);

  await card.getByRole("button", { name: "Close metrics" }).click();
  await expect(card).toHaveCount(0);

  // Another node opens it again; Escape (clear selection) closes it.
  await page.locator('.react-flow__node[data-id^="dns-"]').click();
  await expect(card).toContainText("DNS");
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
});

test("Analyze publishes each edge's link failure: the caller's timeout fails its calls (FLW-05)", async ({
  page,
}) => {
  await open(page, "/?e2e=1");
  // client → app (timeout 5 ms) → SQL (200 ms per request, room to spare): every app → SQL call times out.
  await quickAdd(page, "Client");
  await quickAdd(page, "App Server");
  await quickAdd(page, "SQL Database");
  await connectSync(page, "client", "app-server");
  await connectSync(page, "app-server", "sql-db");
  await expect(page.locator(".react-flow__edge")).toHaveCount(4);

  const setParam = async (node: string, label: string, value: string) => {
    await page.locator(`.react-flow__node[data-id^="${node}-"]`).click();
    const field = page.getByLabel(label, { exact: true });
    await field.fill(value);
    await field.press("Enter");
    await expect(field).toHaveValue(value);
  };
  await setParam("app-server", "Instances", "4");
  await setParam("app-server", "Timeout", "5");
  await setParam("sql-db", "Instances", "4");
  await setParam("sql-db", "Read service time", "200");
  await setParam("sql-db", "Write service time", "200");

  const edgeId = (source: string, target: string) =>
    page.evaluate(
      ([s, t]) => {
        const { state } = JSON.parse(localStorage.getItem("systemsim-canvas")!) as {
          state: { edges: { id: string; source: string; target: string }[] };
        };
        return state.edges.find((e) => e.source.startsWith(`${s}-`) && e.target.startsWith(`${t}-`))
          ?.id;
      },
      [source, target] as const,
    );
  const appToDb = await edgeId("app-server", "sql-db");
  const clientToApp = await edgeId("client", "app-server");
  expect(appToDb).toBeTruthy();
  expect(clientToApp).toBeTruthy();

  await page.getByRole("tab", { name: "Simulate" }).click();
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  // the first Analyze loads the engine lazily (cold chunk in dev)
  await expect(page.getByText("Analysis complete!")).toBeVisible({ timeout: 20_000 });
  const linkFailure = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __runtimeStore: {
              getState(): { latest: { edgeLinkFailure?: Record<string, number> } | null };
            };
          }
        ).__runtimeStore.getState().latest?.edgeLinkFailure ?? null,
    );
  await expect.poll(linkFailure, { timeout: 20_000 }).not.toBeNull();
  const failure = (await linkFailure())!;
  expect(failure[appToDb!]).toBeGreaterThan(0.99);
  // No timeout and no loss on client → app: its link doesn't fail.
  expect(failure[clientToApp!]).toBe(0);
});
