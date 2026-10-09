import { expect, test, type Page } from "@playwright/test";
import { currentStep, open } from "./helpers";

// Spec 09: a whole interview on URL Shortener — answer phases 1–4, run the
// failure drill at 20× (~12 s of wall time), finish, and read the report
// with the points lost, the process score and the attempt history.

const bar = (page: Page) => page.getByTestId("step-bar");
const nextPhase = (page: Page) =>
  bar(page).getByRole("button", { name: "Next", exact: true }).click();

test("full interview: phase answers, drill, report and attempt history", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await open(page, "/");
  await expect(page.locator(".react-flow")).toBeVisible();
  await page.getByTitle("Load reference solution").click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();

  await page.getByTitle("Start a guided interview practice").click();
  await page.getByRole("button", { name: "Start Interview" }).click();

  // Phases 1–4 fill the screen: no canvas, the six phases in the bar (WIZ-20, WIZ-21).
  await expect(page.getByTestId("interview-screen")).toBeVisible();
  await expect(page.locator(".react-flow")).toHaveCount(0);
  await expect(bar(page).locator("[data-step]")).toHaveText([
    /Requirements/,
    /Estimation/,
    /API Design/,
    /Data Model/,
    /High-Level Design/,
    /Deep Dive/,
  ]);

  // Phase 1: pick requirements.
  const requirements = page.getByTestId("requirements-form");
  await expect(requirements).toBeVisible();
  const boxes = requirements.getByRole("checkbox");
  for (let i = 0; i < 3; i++) await boxes.nth(i).check();

  // Phase 2: estimates (k/M accepted); the effective load follows them.
  await nextPhase(page);
  const estimation = page.getByTestId("estimation-form");
  await estimation.getByLabel("Daily active users").fill("100M");
  await estimation.getByLabel("Peak reads").fill("100k");
  await estimation.getByLabel("Peak writes").fill("1k");
  await expect(page.getByText(/Load for your design:/)).toContainText("101");

  // Phase 3: one endpoint matching the reference, one with the wrong verb.
  await nextPhase(page);
  await page.getByRole("button", { name: "Add endpoint" }).click();
  await page.getByLabel("Method of endpoint 1").selectOption("POST");
  await page.getByLabel("Path of endpoint 1").fill("/urls");
  await page.getByRole("button", { name: "Add endpoint" }).click();
  await page.getByLabel("Method of endpoint 2").selectOption("PUT");
  await page.getByLabel("Path of endpoint 2").fill("/urls/{id}");

  // Phase 4: one entity.
  await nextPhase(page);
  await page.getByRole("button", { name: "Add entity" }).click();
  await page.getByLabel("Entity 1 name").fill("URLs");
  await page.getByLabel("Entity 1 store").selectOption("nosql");
  await page.getByLabel("Entity 1 partition key").fill("short_code");

  // Answers survive a reload (persisted with the interview).
  await page.reload();
  await expect(page.getByLabel("Entity 1 partition key")).toHaveValue("short_code");

  // The bar only goes back: a later phase is not a button that works (WIZ-25).
  await expect(bar(page).locator('[data-step="Deep Dive"]')).toBeDisabled();
  await expect(bar(page).locator('[aria-current="step"]')).toHaveText(/Data Model/);

  // Phase 5: the canvas appears, with the palette (WIZ-22).
  await nextPhase(page);
  await expect(page.locator(".react-flow")).toBeVisible();
  await expect(page.getByPlaceholder("Search components...")).toBeVisible();
  await expect(page.getByTestId("interview-screen")).toHaveCount(0);

  // Phase 6: the drill at 20×, on the canvas, with Finish (WIZ-23).
  await nextPhase(page);
  await expect(page.locator(".react-flow")).toBeVisible();
  await expect(page.getByPlaceholder("Search components...")).toHaveCount(0);
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
  // The interview is over: the free-mode steps are back, on Evaluate (WIZ-26).
  await expect(page.getByTitle("Finish the interview and see the report")).toBeHidden();
  expect(await currentStep(page)).toBe("evaluate");

  // A second attempt joins the history (IndexedDB), newest first.
  await page.getByTitle("Start a guided interview practice").click();
  await page.getByRole("button", { name: "Start Interview" }).click();
  await page.getByTitle("Finish the interview and see the report").click();
  await expect(report).toBeVisible({ timeout: 30_000 });
  await expect(report.getByTestId("report-history").locator("tbody tr")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("a reload in the middle of an interview reopens the same phase; abandoning goes back to the step the user was on (WIZ-27, WIZ-28)", async ({
  page,
}) => {
  await open(page, "/", "simulate");
  await page.getByTitle("Start a guided interview practice").click();
  await page.getByRole("button", { name: "Start Interview" }).click();
  await nextPhase(page);
  await expect(bar(page).locator('[aria-current="step"]')).toHaveText(/Estimation/);

  await page.reload();
  await expect(bar(page).locator('[aria-current="step"]')).toHaveText(/Estimation/);
  await expect(page.getByTestId("estimation-form")).toBeVisible();
  await expect(page.locator(".react-flow")).toHaveCount(0);

  await page.getByTitle("End interview").click();
  await expect(page.getByTestId("interview-screen")).toHaveCount(0);
  await expect(page.locator(".react-flow")).toBeVisible();
  expect(await currentStep(page)).toBe("simulate");
});
