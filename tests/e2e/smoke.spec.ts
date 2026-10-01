import { expect, test } from "@playwright/test";

test("app loads with an empty canvas and no runtime errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("/");

  await expect(page.locator(".react-flow")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Build an architecture that scales" }),
  ).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(0);
  expect(errors).toEqual([]);
});

// The top bar overflowed between 768 and 1536 px once (a156ffb), and a new
// item squeezed the problem selector to 60 px at 1280 (Spec 10's cost chip).
// Measured with a reference loaded and simulated, so every live item shows.
test("top bar groups never overlap and the problem selector stays readable", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 800 });
  await page.goto("/");
  await expect(page.locator(".react-flow")).toBeVisible();
  await page.getByTitle("Load reference solution").click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await page.getByRole("button", { name: "Simulate", exact: true }).click();
  await expect(page.getByText("Simulation complete!")).toBeVisible();

  const left = page.getByTestId("topbar-left");
  const right = page.getByTestId("topbar-right");
  const selector = page.getByTestId("problem-selector");
  await expect(page.getByTestId("cost-mini")).toBeVisible();
  for (const width of [768, 1024, 1280, 1440, 1536, 1680, 1920]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(async () => {
      const l = (await left.boundingBox())!;
      const r = (await right.boundingBox())!;
      const s = (await selector.boundingBox())!;
      expect(l.x + l.width, `${width}px: groups overlap`).toBeLessThanOrEqual(r.x);
      expect(s.width, `${width}px: problem selector`).toBeGreaterThanOrEqual(100);
    }).toPass({ timeout: 2000 });
  }
});
