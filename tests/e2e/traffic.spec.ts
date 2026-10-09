import { expect, test, type Locator, type Page } from "@playwright/test";
import { open, openTab } from "./helpers";

// Spec 06 (TRF-01..03): live traffic runs the tick loop in the engine worker.

function clockSeconds(text: string | null): number {
  const [m, s] = (text ?? "00:00").split(":").map(Number);
  return m * 60 + s;
}

async function readClock(clock: Locator): Promise<number> {
  return clockSeconds(await clock.textContent());
}

async function openLiveTraffic(page: Page): Promise<Locator> {
  await open(page, "/");
  await expect(page.locator(".react-flow")).toBeVisible();
  await page.getByTitle("Load reference solution").click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await openTab(page, "Simulate");
  const panel = page.getByRole("region", { name: "Live traffic" });
  await expect(panel).toBeVisible();
  return panel;
}

test("play advances the simulated clock and streams metrics; pause stops it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  const workers: string[] = [];
  page.on("worker", (w) => workers.push(w.url()));

  const panel = await openLiveTraffic(page);
  const clock = panel.getByTestId("sim-clock");
  await expect(clock).toHaveText("00:00");
  expect(workers).toEqual([]); // the engine loads on first play

  await panel.getByRole("button", { name: "Play live traffic" }).click();
  await expect(panel.getByRole("button", { name: "Pause live traffic" })).toBeVisible();
  await expect.poll(() => readClock(clock), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  expect(workers).toHaveLength(1);

  // Live global metrics from the snapshots in runtimeStore
  await expect(panel.getByTestId("live-offered")).toHaveText(/\d/);
  await expect(panel.getByTestId("live-throughput")).toHaveText(/\d/);
  await expect(panel.getByTestId("live-p99")).toHaveText(/\d+(\.\d+)? (ms|s|min)/);

  await panel.getByRole("button", { name: "Pause live traffic" }).click();
  await expect(panel.getByRole("button", { name: "Play live traffic" })).toBeVisible();
  // pause() still delivers the last computed frame; let it land before reading.
  await page.waitForTimeout(300);
  const paused = await readClock(clock);
  await page.waitForTimeout(1500);
  expect(await readClock(clock)).toBe(paused);

  // Reset rewinds and clears the live numbers
  await panel.getByRole("button", { name: "Stop simulation" }).click();
  await expect(clock).toHaveText("00:00");
  await expect(panel.getByTestId("live-offered")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("speed 20× runs the clock faster; the P shortcut toggles playback", async ({ page }) => {
  const panel = await openLiveTraffic(page);
  const clock = panel.getByTestId("sim-clock");

  await panel.getByRole("button", { name: "Speed 20×" }).click();
  await expect(panel.getByRole("button", { name: "Speed 20×" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // Focus the canvas area (not an input) and press P
  await page.locator(".react-flow__pane").click({ position: { x: 20, y: 20 } });
  await page.keyboard.press("p");
  await expect(panel.getByRole("button", { name: "Pause live traffic" })).toBeVisible();
  // ~20 simulated seconds per wall second
  await expect.poll(() => readClock(clock), { timeout: 10_000 }).toBeGreaterThanOrEqual(20);

  await page.keyboard.press("p");
  await expect(panel.getByRole("button", { name: "Play live traffic" })).toBeVisible();
  // pause() still delivers the last computed frame; let it land before reading.
  await page.waitForTimeout(300);
  const paused = await readClock(clock);
  await page.waitForTimeout(800);
  expect(await readClock(clock)).toBe(paused);

  // P is ignored while typing in an input
  const numberInput = panel.getByRole("spinbutton").first();
  await numberInput.focus();
  await page.keyboard.press("p");
  await expect(panel.getByRole("button", { name: "Play live traffic" })).toBeVisible();
});

test("the RPS slider changes the load live while playing", async ({ page }) => {
  const panel = await openLiveTraffic(page);
  const slider = panel.getByRole("slider");
  const offered = panel.getByTestId("live-offered");

  await panel.getByRole("button", { name: "Play live traffic" }).click();
  await expect(offered).toHaveText(/^(9\.\d|10(\.\d)?)k$|^1\dk$/, { timeout: 10_000 }); // ~10k default

  // Max out the slider with the keyboard: 1M rps
  await slider.focus();
  await page.keyboard.press("End");
  await expect(panel.getByTestId("live-rps")).toHaveText("1M rps");
  await expect(offered).toHaveText(/^(0\.9\d|1(\.0\d?)?)M$/, { timeout: 10_000 });

  // Down to the minimum: 10 rps
  await page.keyboard.press("Home");
  await expect(panel.getByTestId("live-rps")).toHaveText("10 rps");
  await expect
    .poll(async () => (await offered.textContent()) ?? "", { timeout: 10_000 })
    .not.toMatch(/k|M/);
});

test("pattern selector edits a spike and previews λ(t)", async ({ page }) => {
  const panel = await openLiveTraffic(page);
  await panel.getByLabel("Load pattern").selectOption("spike");
  await expect(panel.getByLabel(/^Multiplier/)).toHaveValue("5");
  await expect(panel.getByRole("img", { name: /Spike load curve/ })).toBeVisible();
  await expect(panel.getByText("peak 50k rps")).toBeVisible();

  await panel.getByLabel(/^Multiplier/).fill("10");
  await expect(panel.getByText("peak 100k rps")).toBeVisible();

  await panel.getByRole("button", { name: "Play live traffic" }).click();
  // The playhead (a zero-width SVG line) moves along the curve as the pattern's clock runs.
  const playhead = panel.getByTestId("pattern-playhead");
  await expect(playhead).toBeAttached({ timeout: 10_000 });
  await expect
    .poll(async () => Number(await playhead.getAttribute("x1")), { timeout: 10_000 })
    .toBeGreaterThan(10);
});

// request-flow (FLW-01/02/04/48): calls go out as solid balls and their
// responses come back as rings; async edges are dashed and get no response.

/** The URL Shortener reference (the default problem), playing live in the Sim panel. */
async function playReference(page: Page): Promise<Locator> {
  await open(page, "/?e2e=1");
  await page.getByTitle("Load reference solution").click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await openTab(page, "Simulate");
  const panel = page.getByRole("region", { name: "Live traffic" });
  await panel.getByRole("button", { name: "Play live traffic" }).click();
  await expect(panel.getByRole("button", { name: "Pause live traffic" })).toBeVisible();
  return panel;
}

const ballCount = (page: Page, dir: "req" | "res") =>
  page
    .getByTestId("flow-particles")
    .getAttribute(`data-balls-${dir}`)
    .then((v) => Number(v));

/** Dash pattern of the first edge from `source` to `target` (component ids). */
const dashArray = (page: Page, source: string, target: string, prefix = "") =>
  page
    .locator(
      `.react-flow__edge[data-id^="${prefix}e-${source}-"][data-id*="-${target}-"] path.react-flow__edge-path`,
    )
    .first()
    .evaluate((p) => getComputedStyle(p).strokeDasharray);

test("responses come back as rings, with both symbols in the legend; pausing holds them still", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  const panel = await playReference(page);
  await expect.poll(() => ballCount(page, "res"), { timeout: 15_000 }).toBeGreaterThan(0);
  expect(await ballCount(page, "req")).toBeGreaterThan(0);
  const total = Number(
    await page.getByTestId("flow-particles").getAttribute("data-particle-count"),
  );
  expect(total).toBeLessThanOrEqual(2000);

  const legend = page.getByTestId("ball-legend");
  await expect(legend).toBeVisible();
  await expect(legend).toContainText("request ●");
  await expect(legend).toContainText("response ○");
  await expect(legend).toContainText(/1 ball = .+ req\/s/);

  // FLW-48: paused, requests and responses hold still.
  await panel.getByRole("button", { name: "Pause live traffic" }).click();
  await expect(panel.getByRole("button", { name: "Play live traffic" })).toBeVisible();
  await page.waitForTimeout(400);
  const held = [await ballCount(page, "req"), await ballCount(page, "res")];
  await page.waitForTimeout(1000);
  expect([await ballCount(page, "req"), await ballCount(page, "res")]).toEqual(held);
  expect(held[1]).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});

test("prefers-reduced-motion: no balls either way, responses dashed, a call without one a single solid line (FLW-04, RET-04)", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const panel = await playReference(page);
  await expect
    .poll(async () => readClock(panel.getByTestId("sim-clock")), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(2);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const overlay = page.getByTestId("flow-particles");
  await expect(overlay).toHaveAttribute("data-reduced-motion", "true");
  expect(await ballCount(page, "req")).toBe(0);
  expect(await ballCount(page, "res")).toBe(0);
  await expect(page.getByTestId("ball-legend")).toBeHidden();

  // app-server → monitoring is async: one solid line, no response. load-balancer →
  // rate-limiter is sync: a solid request and a dashed response back.
  expect(await dashArray(page, "app-server", "monitoring")).toBe("none");
  expect(await dashArray(page, "load-balancer", "rate-limiter")).toBe("none");
  expect(await dashArray(page, "load-balancer", "rate-limiter", "ret:")).not.toBe("none");
  await expect(
    page.locator('.react-flow__edge[data-id^="ret:e-app-server-"][data-id*="-monitoring-"]'),
  ).toHaveCount(0);
});
