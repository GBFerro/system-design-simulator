import { expect, test, type Page } from "@playwright/test";
import { analyze, MOD } from "./helpers";

// Spec 10: live cost, its breakdown, the budget and right-size with one undo step.

type RuntimeHandle = {
  getState(): { pushSnapshot(s: unknown): void };
};

/** One analyze-style snapshot where `nodeId` handles `rps` req/s. */
function pushLoad(page: Page, nodeId: string, rps: number) {
  return page.evaluate(
    ({ id, load }) => {
      const store = (window as unknown as { __runtimeStore: RuntimeHandle }).__runtimeStore;
      const metrics = {
        rpsIn: load,
        rpsOut: load,
        utilization: 0.5,
        queueDepth: 0,
        p50: 20,
        p95: 60,
        p99: 90,
        errorRate: 0,
        drops: 0,
        status: "ok",
      };
      store.getState().pushSnapshot({
        t: 0,
        offeredRps: load,
        nodes: { [id]: metrics },
        edges: {},
        global: {
          throughput: load,
          goodput: load,
          errorRate: 0,
          p50: 20,
          p95: 60,
          p99: 90,
          availability: 1,
        },
      });
    },
    { id: nodeId, load: rps },
  );
}

test("cost follows instances and load; right-size applies in one undo step", async ({ page }) => {
  // `?e2e` installs window.__runtimeStore in production builds too (CI).
  await page.goto("/?e2e=1");
  await expect(page.locator(".react-flow")).toBeVisible();
  await page.getByRole("button", { name: "Add App Server to canvas" }).first().click();
  const node = page.locator(".react-flow__node").first();
  await expect(node).toBeVisible();
  const nodeId = (await node.getAttribute("data-id"))!;

  await page.getByRole("tab", { name: "Cost" }).click();
  const panel = page.getByTestId("cost-panel");
  const monthly = panel.getByTestId("cost-monthly");
  // m5.large: 1 × $0.096/h × 730 h
  await expect(monthly).toHaveText("$70.08");
  await expect(panel.getByTestId("cost-per-million")).toHaveText("—");
  await expect(panel.getByText("Simulate first: right-size needs the load.")).toBeVisible();

  // A replica doubles the instance cost.
  await node.click();
  await page
    .getByRole("toolbar", { name: "Node actions" })
    .getByRole("button", { name: "Add replica" })
    .click();
  await expect(monthly).toHaveText("$140");

  // The breakdown line shows the arithmetic and the assumptions.
  await panel.getByRole("button", { name: /App Server ×2/ }).click();
  await expect(panel.getByText("2 × $0.096/h × 730 h = $140")).toBeVisible();
  await expect(panel.getByText(/m5\.large/)).toBeVisible();

  // Under 20k rps, right-size wants ⌈20000 / (0.45 × 5000)⌉ = 9 instances.
  await pushLoad(page, nodeId, 20_000);
  const rightSize = page.getByTestId("right-size");
  await expect(rightSize.getByText("2→9")).toBeVisible();
  await expect(rightSize.getByTestId("right-size-delta")).toHaveText("Adds $491/month");
  await expect(panel.getByTestId("cost-per-million")).not.toHaveText("—");

  await rightSize.getByRole("button", { name: "Apply right-size" }).click();
  await expect(monthly).toHaveText("$631");
  await expect(rightSize.getByText("Every tier is already sized for this load.")).toBeVisible();

  // One ⌘Z undoes the whole right-size.
  await page.locator(".react-flow__pane").click({ position: { x: 20, y: 20 } });
  await page.keyboard.press(`${MOD}+z`);
  await expect(monthly).toHaveText("$140");

  // Currency: shown converted, prices stay in USD underneath.
  await panel.getByRole("radio", { name: "BRL" }).click();
  await expect(monthly).toHaveText(/^R\$/);
});

test("the reference shows its budget and right-size is read-only there", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".react-flow")).toBeVisible();
  await page.getByTitle("Load reference solution").click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await analyze(page);

  await page.getByRole("tab", { name: "Cost" }).click();
  const panel = page.getByTestId("cost-panel");
  await expect(panel.getByTestId("cost-budget")).toContainText("$360K");
  await expect(panel.getByTestId("cost-lines").getByText("CDN")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Apply right-size" })).toBeDisabled();
});
