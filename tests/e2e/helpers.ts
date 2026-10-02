import { expect, type Locator, type Page } from "@playwright/test";

/** Shared E2E helpers: import these instead of redefining them in each spec. */

/** The platform's shortcut modifier (⌘ on macOS, Ctrl elsewhere). */
export const MOD = process.platform === "darwin" ? "Meta" : "Control";

/** Open the app and wait for the canvas. `?e2e` installs the test store handles in any build. */
export async function open(page: Page, path = "/") {
  await page.goto(path);
  await expect(page.locator(".react-flow")).toBeVisible();
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
  const a = await center(page.locator(`.react-flow__node[data-id^="${from}-"] .source`));
  const b = await center(page.locator(`.react-flow__node[data-id^="${to}-"] .target`));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}

/** Instant steady-state analysis: the Sim panel's Analyze button (the top bar's Simulate starts the live run). */
export async function analyze(page: Page) {
  await page.getByRole("tab", { name: "Simulate" }).click();
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.getByText("Analysis complete!")).toBeVisible();
}
