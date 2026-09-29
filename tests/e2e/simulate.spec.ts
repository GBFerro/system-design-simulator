import { expect, test } from "@playwright/test";

// Spec 04: the "Simulate" button runs analyze() in the engine Web Worker.
test("Simulate analyzes a reference solution in a Web Worker", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  const workers: string[] = [];
  page.on("worker", (w) => workers.push(w.url()));

  await page.goto("/");
  await expect(page.locator(".react-flow")).toBeVisible();
  // The worker is lazy: nothing is spawned before the first simulation.
  expect(workers).toEqual([]);

  // The top bar title can overlap this button at 1280px; dispatch the click directly.
  await page.getByTitle("Load reference solution").dispatchEvent("click");
  await expect(page.locator(".react-flow__node").first()).toBeVisible();

  await page.getByRole("button", { name: "Simulate", exact: true }).click();
  await expect(page.getByText("Simulation complete!")).toBeVisible();
  expect(workers).toHaveLength(1);

  await page.getByRole("tab", { name: "Simulate" }).click();
  await expect(page.getByText("Latency p50")).toBeVisible();
  await expect(page.getByText(/p95 \d+ · p99 \d+ ms/)).toBeVisible();
  await expect(page.getByText("Error rate")).toBeVisible();
  expect(errors).toEqual([]);
});
