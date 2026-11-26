import { expect, test, type Page } from "@playwright/test";
import { open, openTab } from "./helpers";

// Papel quente slice 3, criterion 27: the zoom controls sit at the canvas's bottom-left, the
// minimap is off on a fresh load and a toggle shows and hides it, and the chaos timeline covers
// neither (and is covered by neither). Slice 3 has no dock: the timeline sits at the canvas bottom.

type Box = { left: number; top: number; right: number; bottom: number };

const box = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }, sel);

const hit = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** The element at the box's center is the target (or inside it): nothing floats over it. */
const uncovered = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    return !!top && el.contains(top);
  }, sel);

async function openWide(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, "/");
  await expect(page.locator(".react-flow")).toBeVisible();
}

test("the minimap is not rendered on a fresh load, and the zoom controls are at the bottom-left", async ({
  page,
}) => {
  await openWide(page);
  await expect(page.locator(".react-flow__minimap")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show minimap" })).toBeVisible();

  const flow = (await box(page, ".react-flow"))!;
  const controls = (await box(page, ".react-flow__controls"))!;
  expect(controls.left - flow.left, "controls hug the left edge").toBeLessThan(60);
  expect(flow.bottom - controls.bottom, "controls hug the bottom edge").toBeLessThan(60);
  expect(await uncovered(page, ".react-flow__controls")).toBe(true);
});

test("Show minimap renders it uncovered; Hide minimap removes it", async ({ page }) => {
  await openWide(page);
  await page.getByRole("button", { name: "Show minimap" }).click();
  await expect(page.locator(".react-flow__minimap")).toBeVisible();
  await expect(page.getByRole("button", { name: "Hide minimap" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show minimap" })).toHaveCount(0);

  const minimap = (await box(page, ".react-flow__minimap"))!;
  const controls = (await box(page, ".react-flow__controls"))!;
  const toggle = (await box(page, '[data-testid="minimap-toggle"]'))!;
  expect(hit(minimap, controls), "minimap over the controls").toBe(false);
  expect(hit(minimap, toggle), "minimap over the toggle").toBe(false);
  expect(await uncovered(page, ".react-flow__minimap")).toBe(true);
  expect(await uncovered(page, ".react-flow__controls")).toBe(true);

  await page.getByRole("button", { name: "Hide minimap" }).click();
  await expect(page.locator(".react-flow__minimap")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show minimap" })).toBeVisible();
});

test("the chaos timeline covers neither the controls nor the minimap, nor the toggle", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(60_000);
  await openWide(page);
  await page.getByRole("button", { name: "Show minimap" }).click();
  await page.getByTitle("Load reference solution").click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await openTab(page, "Simulate");
  const live = page.getByRole("region", { name: "Live traffic" });
  await live.getByRole("button", { name: "Play live traffic" }).click();
  await expect(live.getByRole("button", { name: "Pause live traffic" })).toBeVisible();
  await openTab(page, /Chaos/);
  const panel = page.getByTestId("chaos-panel");
  await panel.getByRole("button", { name: "Kill node" }).click();
  await panel.getByTestId("chaos-target").selectOption({ label: "App Server" });
  await panel.getByRole("checkbox", { name: "Heal automatically" }).uncheck();
  const inject = panel.getByTestId("chaos-inject");
  await inject.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await inject.click();
  await expect(page.getByTestId("chaos-timeline")).toBeVisible();

  const timeline = (await box(page, '[data-testid="chaos-timeline"]'))!;
  for (const [name, sel] of [
    ["controls", ".react-flow__controls"],
    ["minimap", ".react-flow__minimap"],
    ["toggle", '[data-testid="minimap-toggle"]'],
  ] as const) {
    const other = (await box(page, sel))!;
    expect(hit(timeline, other), `timeline over the ${name}`).toBe(false);
    expect(await uncovered(page, sel), `${name} covered`).toBe(true);
  }
  // The injection's toast sits at the bottom center for four seconds; it is not a card, and the
  // timeline is uncovered once it is gone. A card over it would stay.
  await expect
    .poll(() => uncovered(page, '[data-testid="chaos-timeline"]'), { timeout: 8000 })
    .toBe(true);
});
