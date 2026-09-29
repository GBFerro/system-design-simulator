import { expect, test, type Locator, type Page } from "@playwright/test";

// Spec 08 (CHS-01/02/04): faults injected into the live run, blast radius and
// timeline. Spec 12 (ADV-03): structure hints in the Advisor tab.

const nodes = (page: Page) => page.locator(".react-flow__node");

async function center(locator: Locator) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function loadReferenceAndPlay(page: Page) {
  await page.goto("/");
  await expect(page.locator(".react-flow")).toBeVisible();
  // The top bar title can overlap this button at 1280px; dispatch the click directly.
  await page.getByTitle("Load reference solution").dispatchEvent("click");
  await expect(nodes(page).first()).toBeVisible();
  await page.getByRole("tab", { name: "Simulate" }).click();
  const live = page.getByRole("region", { name: "Live traffic" });
  // 20×: this reference is already overloaded at the default load, so after a
  // heal the blast radius clears by the runner's 60 s simulated tail, not by
  // a return to baseline; at 1× that would take a real minute.
  await live.getByRole("button", { name: "Speed 20×" }).click();
  await live.getByRole("button", { name: "Play live traffic" }).click();
  await expect(live.getByRole("button", { name: "Pause live traffic" })).toBeVisible();
}

test("inject a fault from the Chaos tab: blast radius, timeline, then heal", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await loadReferenceAndPlay(page);
  await page.getByRole("tab", { name: /Chaos/ }).click();
  const panel = page.getByTestId("chaos-panel");
  await panel.getByRole("button", { name: "Kill node" }).click();
  await panel.getByTestId("chaos-target").selectOption({ label: "App Server" });
  await panel.getByRole("checkbox", { name: "Heal automatically" }).uncheck();
  const inject = panel.getByTestId("chaos-inject");
  // Scroll it clear of the Support FAB (the tab body's bottom padding makes room).
  await inject.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await inject.click();

  const active = panel.getByTestId("chaos-active");
  await expect(active.getByText("Kill node · App Server")).toBeVisible();
  await expect(page.getByRole("tab", { name: /Chaos/ })).toContainText("1");

  // Blast radius: the target is outlined, its callers pulse; the timeline has a lane.
  const target = nodes(page).filter({ hasText: "App Server" }).locator("[data-blast]");
  await expect(target).toHaveAttribute("data-blast", "target", { timeout: 10_000 });
  await expect(page.locator('[data-blast="affected"]').first()).toBeVisible();
  const timeline = page.getByTestId("chaos-timeline");
  await expect(timeline.getByText("Kill node · App Server")).toBeVisible();

  await active.getByRole("button", { name: /Heal Kill node/ }).click();
  await expect(active).toHaveCount(0);
  await expect(panel.getByText("This run")).toBeVisible();
  // Recovered (or past the 60 s simulated tail): no blast radius left.
  await expect(page.locator("[data-blast]")).toHaveCount(0, { timeout: 15_000 });

  // Reset clears the run's faults (and the timeline).
  await page.getByRole("tab", { name: "Simulate" }).click();
  await page
    .getByRole("region", { name: "Live traffic" })
    .getByRole("button", { name: "Reset simulation" })
    .click();
  await expect(timeline).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Kill/Restore from the context menu; faults need a live run", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("Load reference solution").dispatchEvent("click");
  const app = nodes(page).filter({ hasText: "App Server" }).first();
  await expect(app).toBeVisible();

  // Idle: offered but disabled.
  await app.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: /Kill node/ })).toBeDisabled();
  await page.keyboard.press("Escape");

  await page.getByRole("tab", { name: "Simulate" }).click();
  await page
    .getByRole("region", { name: "Live traffic" })
    .getByRole("button", { name: "Play live traffic" })
    .click();
  await app.click({ button: "right" });
  await page.getByRole("menuitem", { name: /Kill node/ }).click();
  await expect(app.locator("[data-blast]")).toHaveAttribute("data-blast", "target", {
    timeout: 10_000,
  });

  await app.click({ button: "right" });
  await page.getByRole("menuitem", { name: /Restore node/ }).click();
  await expect(page.locator('[data-blast="target"]')).toHaveCount(0);
});

test("Advisor: structure hints appear and go away when fixed", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".react-flow")).toBeVisible();
  await page.getByRole("tab", { name: /Advisor/ }).click();
  const panel = page.getByTestId("advisor-panel");
  await expect(panel.getByText("Add components to the canvas")).toBeVisible();

  await page.getByRole("button", { name: "Add Client to canvas" }).first().click();
  await page.getByRole("button", { name: "Add App Server to canvas" }).first().click();
  await expect(panel.locator('[data-finding="no-entry"]')).toBeVisible();
  await expect(page.locator('.react-flow__node [data-finding="critical"]')).toHaveCount(2);

  // Wire Client → App Server: an entry point, everything reachable.
  const client = nodes(page).filter({ hasText: "Client" });
  const app = nodes(page).filter({ hasText: "App Server" });
  const from = await center(client.locator(".react-flow__handle.source"));
  const to = await center(app.locator(".react-flow__handle.target"));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  await expect(panel.getByText("No structural issues")).toBeVisible();
  await expect(page.locator(".react-flow__node [data-finding]")).toHaveCount(0);
});
