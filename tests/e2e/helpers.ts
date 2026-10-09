import { expect, type Locator, type Page } from "@playwright/test";

/** Shared E2E helpers: import these instead of redefining them in each spec. */

/** The platform's shortcut modifier (⌘ on macOS, Ctrl elsewhere). */
export const MOD = process.platform === "darwin" ? "Meta" : "Control";

export type StepId = "problem" | "design" | "simulate" | "failures" | "evaluate";
const STEP_ORDER: StepId[] = ["problem", "design", "simulate", "failures", "evaluate"];

/**
 * Open the app and wait for its first screen. `?e2e` installs the test store handles in any
 * build. A fresh browser opens on the Problem step (the guided layout); most specs work on
 * the canvas, so unless the test says otherwise the saved step is Design (the palette's step).
 */
export async function open(page: Page, path = "/", step: StepId = "design") {
  await page.addInitScript((initial) => {
    try {
      if (!localStorage.getItem("systemsim-app")) {
        localStorage.setItem(
          "systemsim-app",
          JSON.stringify({ state: { step: initial }, version: 4 }),
        );
      }
    } catch {
      // storage blocked: the app starts on its default step
    }
  }, step);
  await page.goto(path);
  if (step === "problem") await expect(page.getByTestId("problem-step")).toBeVisible();
  else await expect(page.locator(".react-flow")).toBeVisible();
}

/** The current step of the step bar. */
export async function currentStep(page: Page): Promise<StepId> {
  const id = await page
    .locator('[data-testid="step-bar"] [aria-current="step"]')
    .getAttribute("data-step");
  return id as StepId;
}

/** Walk to a step: back by its button, forward with Next (the only way ahead). */
export async function goToStep(page: Page, target: StepId) {
  const bar = page.getByTestId("step-bar");
  for (let i = 0; i < STEP_ORDER.length; i++) {
    const here = await currentStep(page);
    if (here === target) return;
    if (STEP_ORDER.indexOf(target) < STEP_ORDER.indexOf(here)) {
      await bar.locator(`[data-step="${target}"]`).click();
    } else {
      await bar.getByRole("button", { name: "Next", exact: true }).click();
    }
  }
  throw new Error(`could not reach step ${target}`);
}

const STEP_OF_TAB: [RegExp, StepId][] = [
  [/^Props$/, "design"],
  [/^Simulate$/, "simulate"],
  [/^Flow$/, "simulate"],
  [/^(Chaos|SLO)/, "failures"],
  [/^(Score|Advisor|Cost|Trade-offs)/, "evaluate"],
];

/** Click a tab of the right panel, moving to the step that shows it first. */
export async function openTab(page: Page, name: string | RegExp) {
  const label = typeof name === "string" ? name : (name.source.replace(/[\^$]/g, "") as string);
  const step = STEP_OF_TAB.find(([re]) => re.test(label))?.[1];
  const tab = page.getByRole("tab", { name });
  if (step && !(await tab.isVisible())) await goToStep(page, step);
  await tab.click();
}

/** Add a component through the palette's "Add X to canvas" button. */
export async function quickAdd(page: Page, label: string) {
  await page
    .getByRole("button", { name: `Add ${label} to canvas` })
    .first()
    .click();
}

export async function center(locator: Locator) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Drag from one node's source handle to another's target handle (node ids start with the component id). */
export async function connect(page: Page, from: string, to: string) {
  const a = await center(
    page.locator(`.react-flow__node[data-id^="${from}-"] .source:not([data-return-handle])`),
  );
  const b = await center(
    page.locator(`.react-flow__node[data-id^="${to}-"] .target:not([data-return-handle])`),
  );
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}

/** A point on an edge's path (default: the first edge) that isn't covered by a node or the label. */
export async function edgePoint(
  page: Page,
  edge: Locator = page.locator(".react-flow__edge").first(),
) {
  return edge.locator("path.react-flow__edge-interaction").evaluate((path: SVGPathElement) => {
    const m = path.getScreenCTM()!;
    const length = path.getTotalLength();
    for (let i = 1; i < 20; i++) {
      const p = path.getPointAtLength((length * i) / 20);
      const x = p.x * m.a + p.y * m.c + m.e;
      const y = p.x * m.b + p.y * m.d + m.f;
      const hit = document.elementFromPoint(x, y)?.closest(".react-flow__edge");
      if (hit && hit === path.closest(".react-flow__edge")) return { x, y };
    }
    throw new Error("edge is fully covered");
  });
}

/** Instant steady-state analysis: the Sim panel's Analyze button (the top bar's Simulate starts the live run). */
export async function analyze(page: Page) {
  await openTab(page, "Simulate");
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.getByText("Analysis complete!")).toBeVisible();
}

/** Draw the response of a call: drag from the callee's return handle to the caller's (guided-ui, RET-01). */
export async function answer(page: Page, callee: string, caller: string) {
  const a = await center(
    page.locator(`.react-flow__node[data-id^="${callee}-"] [data-return-handle="out"]`),
  );
  const b = await center(
    page.locator(`.react-flow__node[data-id^="${caller}-"] [data-return-handle="in"]`),
  );
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}

/** A synchronous call: the request, then its response. A bare `connect` is an async call. */
export async function connectSync(page: Page, from: string, to: string) {
  await connect(page, from, to);
  await answer(page, to, from);
}
