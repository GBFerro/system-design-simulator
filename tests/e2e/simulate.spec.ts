import { expect, test } from "@playwright/test";
import { analyze, open } from "./helpers";

// Spec 04: the Sim panel's "Analyze" button runs analyze() in the engine Web Worker.
test("Analyze runs a reference solution in a Web Worker", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  const workers: string[] = [];
  page.on("worker", (w) => workers.push(w.url()));

  await open(page, "/");
  await expect(page.locator(".react-flow")).toBeVisible();
  // The worker is lazy: nothing is spawned before the first simulation.
  expect(workers).toEqual([]);

  await page.getByTitle("Load reference solution").click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();

  await analyze(page);
  expect(workers).toHaveLength(1);

  await expect(page.getByText("Latency p50")).toBeVisible();
  await expect(page.getByText(/p95 \d+ · p99 \d+ ms/)).toBeVisible();
  await expect(page.getByText("Error rate")).toBeVisible();
  expect(errors).toEqual([]);
});
