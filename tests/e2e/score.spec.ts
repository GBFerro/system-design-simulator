import { expect, test } from "@playwright/test";

// Spec 09: the Score button measures the design (analyze() at the problem's
// peak, 2× and under its drill faults) before applying the rubric.

test("the reference solution holds its own peak: full scalability and latency", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".react-flow")).toBeVisible();
  await page.getByTitle("Load reference solution").click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();

  await page.getByRole("button", { name: "Score" }).click();
  const scalability = page.locator('[data-category="Scalability"]');
  await expect(scalability).toContainText("20/20", { timeout: 20_000 });
  await expect(page.locator('[data-category="Latency"]')).toContainText("20/20");

  // The measured feedback names the load it was measured at.
  await scalability.getByRole("button").click();
  await expect(scalability).toContainText(/Holds the peak \(101k rps\)/);
});

test("an unwired component scores nothing on the measured checks", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".react-flow")).toBeVisible();
  await page.getByRole("button", { name: "Add App Server to canvas" }).first().click();
  await page.getByRole("button", { name: "Score" }).click();
  const scalability = page.locator('[data-category="Scalability"]');
  await expect(scalability).toContainText("0/20", { timeout: 20_000 });
  await expect(page.locator('[data-category="Latency"]')).toContainText("0/20");
  await expect(page.locator('[data-category="Availability"]')).toContainText("0/20");
});
