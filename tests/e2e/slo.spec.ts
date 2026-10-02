import { expect, test, type Page } from "@playwright/test";

// Spec 11: the problem's SLO, editing it, and the error budget / burn rate /
// verdict reacting to a run (synthetic snapshots through window.__runtimeStore).

type RuntimeHandle = {
  getState(): {
    pushSnapshot(s: unknown): void;
    setPlayback(p: "idle" | "running" | "paused"): void;
  };
};

/** Snapshots every 0.5 s from `from` to `to` at 1000 rps with this error rate. */
function pushRun(page: Page, from: number, to: number, errorRate: number) {
  return page.evaluate(
    ({ from, to, errorRate }) => {
      const store = (window as unknown as { __runtimeStore: RuntimeHandle }).__runtimeStore;
      for (let t = from + 0.5; t <= to + 1e-9; t += 0.5) {
        const throughput = 1000 * (1 - errorRate);
        store.getState().pushSnapshot({
          t,
          offeredRps: 1000,
          nodes: {},
          edges: {},
          global: {
            throughput,
            goodput: throughput,
            errorRate,
            p50: 20,
            p95: 40,
            p99: 60,
            availability: 1,
          },
        });
      }
    },
    { from, to, errorRate },
  );
}

test("SLO tab: problem targets, override, budget, burn rate and verdict", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  // `?e2e` installs window.__runtimeStore in production builds too (CI).
  await page.goto("/?e2e=1");
  await expect(page.locator(".react-flow")).toBeVisible();

  await page.getByRole("tab", { name: "SLO" }).click();
  const panel = page.getByTestId("slo-panel");
  // URL shortener: < 100 ms at p99, 99.99% availability (its statement).
  await expect(panel.getByTestId("slo-source")).toHaveText("Problem's SLO");
  await expect(panel.getByTestId("slo-percentile")).toHaveValue("99");
  await expect(panel.getByTestId("slo-threshold")).toHaveValue("100");
  await expect(panel.getByTestId("slo-availability")).toHaveValue("0.9999");
  await expect(panel.getByText(/Play live traffic/)).toBeVisible();

  // A clean minute: SLO met, budget untouched, no chip outside a run.
  await pushRun(page, 0, 60, 0);
  await expect(panel.getByTestId("slo-verdict")).toHaveAttribute("data-verdict", "met");
  await expect(panel.getByTestId("slo-remaining")).toHaveText("100%");
  await expect(panel.getByTestId("slo-burn")).toHaveText("0×");
  await expect(page.getByTestId("slo-mini")).toHaveCount(0);

  // 30 s of 1% errors against 99.99%: burning at 100×, the 5-minute budget is gone.
  await page.evaluate(() =>
    (window as unknown as { __runtimeStore: RuntimeHandle }).__runtimeStore
      .getState()
      .setPlayback("paused"),
  );
  await pushRun(page, 60, 90, 0.01);
  await expect(panel.getByTestId("slo-burn")).toHaveText("100×");
  await expect(panel.getByTestId("slo-verdict")).toHaveAttribute("data-verdict", "violated");
  await expect(panel.getByTestId("slo-verdict")).toContainText("availability budget used up");
  await expect(panel.getByTestId("slo-remaining")).toHaveText("0%");
  await expect(panel.getByTestId("slo-burn-chart")).toBeVisible();
  const chip = page.getByTestId("slo-mini");
  await expect(chip).toHaveText("0%");

  // Loosen it to 99%: the same errors now burn at 1× and the SLO holds.
  await panel.getByTestId("slo-availability").selectOption("0.99");
  await expect(panel.getByTestId("slo-source")).toHaveText("Custom");
  await expect(panel.getByTestId("slo-burn")).toHaveText("1×");
  await expect(panel.getByTestId("slo-verdict")).toHaveAttribute("data-verdict", "met");

  // The latency threshold commits on Enter; an invalid one snaps back.
  await panel.getByTestId("slo-threshold").fill("50");
  await panel.getByTestId("slo-threshold").press("Enter");
  await expect(panel.getByTestId("slo-threshold")).toHaveValue("50");
  await panel.getByTestId("slo-threshold").fill("-3");
  await panel.getByTestId("slo-threshold").press("Enter");
  await expect(panel.getByTestId("slo-threshold")).toHaveValue("50");

  // Back to the problem's SLO.
  await panel.getByTestId("slo-reset").click();
  await expect(panel.getByTestId("slo-source")).toHaveText("Problem's SLO");
  await expect(panel.getByTestId("slo-threshold")).toHaveValue("100");
  await expect(panel.getByTestId("slo-verdict")).toHaveAttribute("data-verdict", "violated");

  // The chip opens the SLO tab from elsewhere.
  await page.getByRole("tab", { name: "Cost" }).click();
  await chip.click();
  await expect(panel).toBeVisible();
});
