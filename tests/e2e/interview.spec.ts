import { expect, test } from "@playwright/test";

// Spec 09: a whole interview on URL Shortener — answer phases 1–4, run the
// failure drill at 20× (~12 s of wall time), finish, and read the report
// with the points lost, the process score and the attempt history.

test("full interview: phase answers, drill, report and attempt history", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");
  await expect(page.locator(".react-flow")).toBeVisible();
  await page.getByTitle("Load reference solution").click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();

  await page.getByTitle("Start a guided interview practice").click();
  await page.getByRole("button", { name: "Start Interview" }).click();

  // Phase 1: pick requirements.
  const requirements = page.getByTestId("requirements-form");
  await expect(requirements).toBeVisible();
  const boxes = requirements.getByRole("checkbox");
  for (let i = 0; i < 3; i++) await boxes.nth(i).check();

  // Phase 2: estimates (k/M accepted); the effective load follows them.
  await page.getByRole("button", { name: "Next phase" }).click();
  const estimation = page.getByTestId("estimation-form");
  await estimation.getByLabel("Daily active users").fill("100M");
  await estimation.getByLabel("Peak reads").fill("100k");
  await estimation.getByLabel("Peak writes").fill("1k");
  await expect(page.getByText(/Load for your design:/)).toContainText("101");

  // Phase 3: one endpoint matching the reference, one with the wrong verb.
  await page.getByRole("button", { name: "Next phase" }).click();
  await page.getByRole("button", { name: "Add endpoint" }).click();
  await page.getByLabel("Method of endpoint 1").selectOption("POST");
  await page.getByLabel("Path of endpoint 1").fill("/urls");
  await page.getByRole("button", { name: "Add endpoint" }).click();
  await page.getByLabel("Method of endpoint 2").selectOption("PUT");
  await page.getByLabel("Path of endpoint 2").fill("/urls/{id}");

  // Phase 4: one entity.
  await page.getByRole("button", { name: "Next phase" }).click();
  await page.getByRole("button", { name: "Add entity" }).click();
  await page.getByLabel("Entity 1 name").fill("URLs");
  await page.getByLabel("Entity 1 store").selectOption("nosql");
  await page.getByLabel("Entity 1 partition key").fill("short_code");

  // Answers survive a reload (persisted with the interview).
  await page.reload();
  await expect(page.getByLabel("Entity 1 partition key")).toHaveValue("short_code");

  // Phase 6: the drill at 20×.
  await page.getByRole("button", { name: "Go to phase 6: Deep Dive" }).click();
  const drill = page.getByTestId("drill-panel");
  await drill.getByTestId("drill-start").click();
  await drill.getByRole("button", { name: "Speed 20×" }).click();
  await expect(drill.getByTestId("drill-summary")).toBeVisible({ timeout: 60_000 });

  await page.getByTitle("Finish the interview and see the report").click();
  const report = page.getByTestId("interview-report");
  await expect(report).toBeVisible({ timeout: 30_000 });
  await expect(report.getByTestId("report-design")).toContainText("/100");
  await expect(report.getByTestId("report-process")).toContainText("/100");
  await expect(report.locator("[data-report-category]")).toHaveCount(5);
  await expect(
    report.getByText(/^Wrong verb: (GET|DELETE) \/api\/v1\/urls\/\{shortCode\} \(you: PUT\)$/),
  ).toHaveCount(1);
  await expect(
    report.getByText(/urls: named · store nosql · partition key short_code/),
  ).toBeVisible();
  await expect(report.getByRole("region", { name: "Failure drill" }).locator("li")).toHaveCount(3);
  // Spec 11: the live run (the drill) against the problem's SLO.
  await expect(report.getByTestId("report-slo")).toContainText(
    /SLO (met|violated) over \d+ simulated seconds \(p99 ≤ 100 ms · 99\.99% availability · 5-minute window\)/,
  );
  await expect(report.getByTestId("report-history").locator("tbody tr")).toHaveCount(1);
  await report.getByRole("button", { name: "Done" }).click();
  await expect(report).toBeHidden();
  // The interview is over.
  await expect(page.getByTitle("Finish the interview and see the report")).toBeHidden();

  // A second attempt joins the history (IndexedDB), newest first.
  await page.getByTitle("Start a guided interview practice").click();
  await page.getByRole("button", { name: "Start Interview" }).click();
  await page.getByTitle("Finish the interview and see the report").click();
  await expect(report).toBeVisible({ timeout: 30_000 });
  await expect(report.getByTestId("report-history").locator("tbody tr")).toHaveCount(2);
  expect(errors).toEqual([]);
});
