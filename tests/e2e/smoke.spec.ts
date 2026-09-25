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
