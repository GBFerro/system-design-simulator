import { expect, test } from "@playwright/test";

// Spec 09 (phase 6): the failure drill injects the problem's scripted faults
// into the running design and scores each one. Run at 20× so the three
// faults (15 s warm-up, 60 + 60 + 30 s windows, 20 s recovery each) take
// ~12 s of wall time.

test("failure drill: scripted faults, answers, per-fault results and summary", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");
  await expect(page.locator(".react-flow")).toBeVisible();
  await page.getByTitle("Load reference solution").dispatchEvent("click");
  await expect(page.locator(".react-flow__node").first()).toBeVisible();

  await page.getByTitle("Start a guided interview practice").dispatchEvent("click");
  await page.getByRole("button", { name: "Start Interview" }).click();
  await page.getByRole("button", { name: "Go to phase 6: Deep Dive" }).click();

  const drill = page.getByTestId("drill-panel");
  await expect(drill.getByText("Failure drill", { exact: true })).toBeVisible();
  await drill.getByTestId("drill-start").click();
  await drill.getByRole("button", { name: "Speed 20×" }).click();

  // URL Shortener's first fault acts out follow-up q1 (cache flush).
  const active = drill.locator('[data-drill-step="active"]');
  await expect(active.getByText("What happens if your cache goes down?")).toBeVisible({
    timeout: 20_000,
  });
  await active.getByLabel("Your answer").fill("Reads fall through to the database.");

  const results = drill.getByTestId("drill-result");
  await expect(results.first()).toBeVisible({ timeout: 20_000 });
  await results
    .first()
    .getByRole("button", { name: /reference answer/ })
    .click();
  await expect(results.first().getByText(/cache-aside/i)).toBeVisible();

  await expect(drill.getByTestId("drill-summary")).toBeVisible({ timeout: 40_000 });
  await expect(results).toHaveCount(3);
  // The answer written during the fault is kept (read-only now).
  await expect(drill.getByLabel("Your answer").first()).toHaveValue(
    "Reads fall through to the database.",
  );
  expect(errors).toEqual([]);
});

test("a design without the scripted target gets the fallback; edits count as the candidate acting", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await expect(page.locator(".react-flow")).toBeVisible();
  await page.getByRole("button", { name: "Add Client to canvas" }).first().click();
  await page.getByRole("button", { name: "Add App Server to canvas" }).first().click();
  const nodes = page.locator(".react-flow__node");
  const client = nodes.filter({ hasText: "Client" });
  const app = nodes.filter({ hasText: "App Server" });
  const from = (await client.locator(".react-flow__handle.source").boundingBox())!;
  const to = (await app.locator(".react-flow__handle.target").boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  await page.getByTitle("Start a guided interview practice").dispatchEvent("click");
  await page.getByRole("button", { name: "Start Interview" }).click();
  await page.getByRole("button", { name: "Go to phase 6: Deep Dive" }).click();
  const drill = page.getByTestId("drill-panel");
  await drill.getByTestId("drill-start").click();
  await drill.getByRole("button", { name: "Speed 5×" }).click();

  // URL Shortener's first fault needs a cache; this design has none.
  const active = drill.locator('[data-drill-step="active"]');
  await expect(active.getByText(/no Cache \/ Redis/)).toBeVisible({ timeout: 20_000 });
  await expect(active.getByText(/Kill instances · App Server/)).toBeVisible();

  // Mitigate: add a replica to the App Server while the fault is on.
  await app.click();
  await page
    .getByRole("toolbar", { name: "Node actions" })
    .getByRole("button", { name: "Add replica" })
    .click();

  await drill.getByRole("button", { name: "Speed 20×" }).click();
  const result = drill.getByTestId("drill-result").first();
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result.getByText("You acted").locator("xpath=following-sibling::dd")).toHaveText(
    /^\+\d+ s$/,
  );
});
