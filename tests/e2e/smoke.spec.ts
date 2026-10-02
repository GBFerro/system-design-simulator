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
// Measured with a reference loaded, simulated and a paused live run, so every live item shows.
// 80 px: font metrics differ by OS (the selector is 116 px at 1536 on Windows,
// 98 px on the Linux CI runner); the regressions to catch were 22 and 60 px.
const MIN_SELECTOR_PX = 80;
test("top bar groups never overlap and the problem selector stays readable", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 800 });
  await page.goto("/");
  await expect(page.locator(".react-flow")).toBeVisible();
  await page.getByTitle("Load reference solution").click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await page.getByRole("button", { name: "Simulate", exact: true }).click();
  await expect(page.getByText("Simulation complete!")).toBeVisible();
  // A live run (paused) adds the SLO chip (Spec 11).
  await page.getByRole("button", { name: "Play live traffic" }).first().click();
  await expect(page.getByTestId("slo-mini")).toBeVisible();
  await page.getByRole("button", { name: "Pause live traffic" }).first().click();

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
      expect(s.width, `${width}px: problem selector`).toBeGreaterThanOrEqual(MIN_SELECTOR_PX);
    }).toPass({ timeout: 2000 });
  }
});
