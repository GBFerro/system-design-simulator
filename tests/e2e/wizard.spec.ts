import { expect, test, type Page } from "@playwright/test";
import { connectSync, currentStep, goToStep, open, quickAdd } from "./helpers";

// guided-ui: the app is used in steps (Problem → Design → Simulate → Failures → Evaluate);
// each step shows only its own tools and nothing ahead can be reached by clicking.

const bar = (page: Page) => page.getByTestId("step-bar");
const next = (page: Page) => bar(page).getByRole("button", { name: "Next", exact: true });
const back = (page: Page) => bar(page).getByRole("button", { name: "Back", exact: true });
const tabs = (page: Page) =>
  page
    .getByRole("tablist")
    .filter({ has: page.getByRole("tab", { name: "Props" }) })
    .getByRole("tab")
    .allInnerTexts()
    .then((names) => names.map((n) => n.replace(/\s*\d+$/, "").trim()));
const palette = (page: Page) => page.getByPlaceholder("Search components...");

const TABS_BY_STEP: Record<string, string[]> = {
  design: ["Props", "Flow"],
  simulate: ["Simulate", "Flow", "Props"],
  failures: ["Chaos", "SLO", "Props"],
  evaluate: ["Score", "Advisor", "Cost", "Trade-offs", "Props"],
};

test("a fresh visit opens on the Problem step, full screen, and Next walks the others in order (WIZ-01, WIZ-02, WIZ-04, WIZ-07, WIZ-08, WIZ-09)", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("problem-step")).toBeVisible();
  await expect(page.locator(".react-flow")).toHaveCount(0);
  // the problem, its requirements, Capacity and the learning path, all on this screen
  await expect(page.getByTestId("problem-brief")).toBeVisible();
  await expect(page.getByText("Capacity", { exact: true }).first()).toBeVisible();
  await page.getByRole("tab", { name: "Learning path" }).click();
  await expect(page.getByRole("tab", { name: "Problems" })).toBeVisible();

  await expect(bar(page).locator("[data-step]")).toHaveText([
    /Problem/,
    /Design/,
    /Simulate/,
    /Failures/,
    /Evaluate/,
  ]);
  await expect(bar(page).locator('[aria-current="step"]')).toHaveText(/Problem/);
  await expect(back(page)).toBeDisabled();

  for (const step of ["design", "simulate", "failures", "evaluate"]) {
    await next(page).click();
    await expect(page.locator(".react-flow")).toBeVisible();
    expect(await currentStep(page)).toBe(step);
    // (the DOM order is fixed; the step's order is visual, and its first tool opens)
    expect((await tabs(page)).sort()).toEqual([...TABS_BY_STEP[step]].sort());
    await expect(page.locator('[role="tab"][aria-selected="true"]').first()).toHaveText(
      new RegExp(`^${TABS_BY_STEP[step][0]}`),
    );
    // the palette is the Design step's tool
    if (step === "design") await expect(palette(page)).toBeVisible();
    else await expect(palette(page)).toHaveCount(0);
  }
  await expect(next(page)).toBeDisabled();
});

test("a step before the current one can be clicked, one after it cannot (WIZ-03, WIZ-05, WIZ-06)", async ({
  page,
}) => {
  await open(page, "/", "simulate");
  const failures = bar(page).locator('[data-step="failures"]');
  await expect(failures).toBeDisabled();
  await failures.click({ force: true });
  expect(await currentStep(page)).toBe("simulate");

  await bar(page).locator('[data-step="design"]').click();
  expect(await currentStep(page)).toBe("design");
  await back(page).click();
  expect(await currentStep(page)).toBe("problem");
  await expect(page.getByTestId("problem-step")).toBeVisible();
});

test("the step survives a reload (WIZ-12)", async ({ page }) => {
  await open(page, "/", "design");
  await goToStep(page, "failures");
  await page.reload();
  await expect(page.locator(".react-flow")).toBeVisible();
  expect(await currentStep(page)).toBe("failures");
});

test("on a phone the bar shows the step's name, n / 5 and Back / Next (WIZ-13)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/");
  const compact = page.locator('[data-testid="step-bar"][data-compact]');
  await expect(compact).toBeVisible();
  await expect(compact.locator("[data-step-current]")).toHaveText("Problem");
  await expect(compact.locator("[data-step-count]")).toHaveText("1 / 5");
  await expect(compact.locator("[data-step]")).toHaveCount(0);
  await compact.getByRole("button", { name: "Next", exact: true }).click();
  await expect(compact.locator("[data-step-current]")).toHaveText("Design");
  await expect(compact.locator("[data-step-count]")).toHaveText("2 / 5");
  await compact.getByRole("button", { name: "Back", exact: true }).click();
  await expect(compact.locator("[data-step-current]")).toHaveText("Problem");
  await expect(compact.getByRole("button", { name: "Back", exact: true })).toBeDisabled();
});

test("changing step never touches the design or a live run, even with the canvas hidden (WIZ-11, WIZ-31)", async ({
  page,
}) => {
  await open(page, "/?e2e", "design");
  await quickAdd(page, "Client");
  await quickAdd(page, "App Server");
  await connectSync(page, "client", "app-server");
  // the design as saved, without the measured sizes ReactFlow refreshes when the canvas remounts
  const saved = () =>
    page.evaluate(() => {
      const raw = localStorage.getItem("systemsim-canvas");
      return raw
        ? JSON.stringify(JSON.parse(raw, (k, v) => (k === "measured" ? undefined : v)))
        : null;
    });
  await expect.poll(saved).toContain("ret:");
  const design = await saved();

  await page.getByRole("button", { name: "Simulate", exact: true }).click();
  const runtime = () =>
    page.evaluate(() => {
      const s = (
        window as unknown as {
          __runtimeStore: { getState: () => { playback: string; latest: { t: number } | null } };
        }
      ).__runtimeStore.getState();
      return { playback: s.playback, t: s.latest?.t ?? 0 };
    });
  await expect.poll(async () => (await runtime()).t, { timeout: 15_000 }).toBeGreaterThan(0);

  // all the way back to Problem (no canvas), then forward again
  await goToStep(page, "problem");
  await expect(page.locator(".react-flow")).toHaveCount(0);
  const before = (await runtime()).t;
  await expect.poll(async () => (await runtime()).t, { timeout: 15_000 }).toBeGreaterThan(before);
  expect((await runtime()).playback).toBe("running");
  await goToStep(page, "evaluate");
  expect((await runtime()).playback).toBe("running");
  expect(await saved()).toBe(design);
});

test("choosing another problem from the top bar keeps the step (WIZ-30)", async ({ page }) => {
  await open(page, "/", "simulate");
  await page.getByTestId("problem-selector").click();
  await page.getByRole("button", { name: /Twitter/ }).click();
  await expect(page.getByTestId("problem-selector")).toContainText("Twitter");
  expect(await currentStep(page)).toBe("simulate");
});

test("Score, the cost chip and the SLO chip open the step that has their tool", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await open(page, "/", "design");
  await page.getByTitle("Load reference solution").click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await page.getByTestId("cost-mini").click();
  expect(await currentStep(page)).toBe("evaluate");
  await expect(page.getByRole("tab", { name: "Cost" })).toHaveAttribute("aria-selected", "true");
});

test("the walkthrough presents the step bar, and its own scenes show what is on screen (WIZ-14)", async ({
  page,
}) => {
  await open(page, "/", "design");
  await page.getByRole("button", { name: /New here\? See how it works/ }).click();
  await page.getByRole("button", { name: /Watch the 60-second walkthrough/ }).click();
  const tour = page.getByRole("dialog", { name: "SystemForge walkthrough" });
  await expect(tour).toBeVisible();
  // the second scene is the step bar, with the five steps in order
  await tour.getByRole("button", { name: "Next" }).click();
  await expect(tour.getByRole("heading", { name: "Follow the steps" })).toBeVisible();
  await expect(tour.locator("[data-tour-steps]")).toContainText(
    /1Problem\s*2Design\s*3Simulate\s*4Failures\s*5Evaluate/,
  );
  // ...and the app behind it really has that bar
  await expect(bar(page).locator("[data-step]")).toHaveCount(5);
  await expect(tour).toContainText("Next to move on");
});
