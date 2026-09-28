import { expect, test, type Page } from "@playwright/test";

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

async function open(page: Page) {
  // `?e2e` installs window.__runtimeStore in production builds too (CI).
  await page.goto("/?e2e=1");
  await expect(page.locator(".react-flow")).toBeVisible();
}

async function loadReferenceAndSimulate(page: Page) {
  await page.getByTitle("Load reference solution").dispatchEvent("click");
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await page.getByRole("button", { name: "Simulate", exact: true }).click();
  await expect(page.getByText("Simulation complete!")).toBeVisible();
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

  await open(page);
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
  await open(page);
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
  await open(page);
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
  await open(page);
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
  await open(page);
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
test("particle overlay keeps frame time low with 100 edges at the 2,000 cap", async ({ page }) => {
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
    const link = (a: string, b: string) =>
      edges.push({ id: `p-${a}-${b}`, source: a, target: b, type: "animated", data: {} });
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
  await open(page);
  await expect(page.locator(".react-flow__edge")).toHaveCount(100);

  await page.evaluate(() => {
    const store = (window as unknown as { __runtimeStore: RuntimeHandle }).__runtimeStore;
    const edgeIds = [...document.querySelectorAll(".react-flow__edge[data-id]")].map(
      (e) => (e as SVGGElement).dataset.id!,
    );
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
  await expect.poll(() => particleCount(page)).toBe(2000);

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
    `particles (100 edges, 2000): draw ${drawMs.toFixed(2)} ms/frame, rAF p95 ${p95.toFixed(1)} ms`,
  );
  expect(drawMs).toBeLessThan(8);
  expect(p95).toBeLessThan(100);
});
