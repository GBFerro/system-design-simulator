import { expect, test, type Page } from "@playwright/test";
import { MOD, center, open, quickAdd } from "./helpers";

// Spec 02: one test per editor bug from the diagnosis (B1–B6) plus the CAN-05 shortcuts.

const nodes = (page: Page) => page.locator(".react-flow__node");
/** Mouse drag with intermediate moves (dnd-kit needs > 6px of movement to start). */
async function mouseDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  mods: string[] = [],
) {
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  for (const m of mods) await page.keyboard.up(m);
}

async function dragFromPalette(page: Page, componentId: string, to: { x: number; y: number }) {
  await mouseDrag(
    page,
    await center(page.locator(`[data-palette-item="${componentId}"]`).first()),
    to,
  );
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

test("B1: dropping on the center of the empty canvas (over the empty state) adds a node", async ({
  page,
}) => {
  await open(page);
  await expect(
    page.getByRole("heading", { name: "Build an architecture that scales" }),
  ).toBeVisible();
  // Releasing outside the canvas (back over the palette) adds nothing
  const row = await center(page.locator('[data-palette-item="app-server"]').first());
  await mouseDrag(page, row, { x: row.x + 20, y: row.y + 80 });
  await expect(nodes(page)).toHaveCount(0);
  await dragFromPalette(page, "app-server", await center(page.locator(".react-flow")));
  await expect(nodes(page)).toHaveCount(1);
});

test("B2: Delete works right after dragging a node, and one undo restores it", async ({ page }) => {
  await open(page);
  await dragFromPalette(page, "app-server", await center(page.locator(".react-flow")));
  const node = nodes(page).first();
  const c = await center(node);
  await mouseDrag(page, c, { x: c.x + 120, y: c.y + 60 });
  await expect(node).toHaveClass(/selected/);
  await page.keyboard.press("Delete");
  await expect(nodes(page)).toHaveCount(0);
  await page.keyboard.press(`${MOD}+z`);
  await expect(nodes(page)).toHaveCount(1);
});

test("B3: Shift+click and box selection pick several nodes; Delete removes all in one undo step", async ({
  page,
}) => {
  await open(page);
  await quickAdd(page, "App Server");
  await quickAdd(page, "Cache / Redis");
  await expect(nodes(page)).toHaveCount(2);

  await nodes(page).nth(0).click();
  await nodes(page)
    .nth(1)
    .click({ modifiers: ["Shift"] });
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(2);
  await expect(page.getByText("2 items selected").first()).toBeAttached();
  await page.keyboard.press("Delete");
  await expect(nodes(page)).toHaveCount(0);
  await page.keyboard.press(`${MOD}+z`);
  await expect(nodes(page)).toHaveCount(2);

  // Box selection: drag on the empty pane around both nodes
  await page.locator(".react-flow__pane").click({ position: { x: 5, y: 5 } });
  const boxes = await Promise.all([
    nodes(page).nth(0).boundingBox(),
    nodes(page).nth(1).boundingBox(),
  ]);
  const left = Math.min(...boxes.map((b) => b!.x)) - 30;
  const top = Math.min(...boxes.map((b) => b!.y)) - 30;
  const right = Math.max(...boxes.map((b) => b!.x + b!.width)) + 30;
  const bottom = Math.max(...boxes.map((b) => b!.y + b!.height)) + 30;
  await mouseDrag(page, { x: left, y: top }, { x: right, y: bottom });
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(2);
  await page.keyboard.press("Backspace");
  await expect(nodes(page)).toHaveCount(0);
});

test("B4: delete from the context menu and from the node toolbar", async ({ page }) => {
  await open(page);
  await quickAdd(page, "App Server");
  await nodes(page).first().click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Canvas actions" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(nodes(page)).toHaveCount(2);

  await nodes(page).first().click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Delete" }).click();
  await expect(nodes(page)).toHaveCount(1);

  await nodes(page).first().click();
  const toolbar = page.getByRole("toolbar", { name: "Node actions" });
  await toolbar.getByRole("button", { name: "Add replica" }).click();
  await expect(toolbar.getByText("×2")).toBeVisible();
  await toolbar.getByRole("button", { name: "Delete" }).click();
  await expect(nodes(page)).toHaveCount(0);

  // Pane menu + keyboard: Shift+F10 opens it, Escape closes it
  await page.locator(".react-flow__pane").click({ position: { x: 20, y: 20 } });
  await page.keyboard.press("Shift+F10");
  await expect(menu.getByRole("menuitem", { name: "Add note" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});

test("B5: first node is not zoomed in and tap-add never stacks nodes", async ({ page }) => {
  await open(page);
  await dragFromPalette(page, "app-server", await center(page.locator(".react-flow")));
  await expect(nodes(page)).toHaveCount(1);
  const scale = await page
    .locator(".react-flow__viewport")
    .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
  expect(scale).toBeLessThanOrEqual(1);

  for (let i = 0; i < 10; i++) await quickAdd(page, "Cache / Redis");
  await expect(nodes(page)).toHaveCount(11);
  const rects = await nodes(page).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }),
  );
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++)
      expect(overlaps(rects[i], rects[j]), `${i} vs ${j}`).toBe(false);
});

test.describe("B6: touch", () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

  test("press-and-hold drags a component from the palette onto the canvas", async ({ page }) => {
    await open(page);
    // The first node on an empty canvas triggers the initial fitView (which recenters
    // it), so add one first and then check the dragged node lands under the finger
    await page.getByRole("button", { name: "Add Cache / Redis to canvas" }).first().tap();
    await expect(nodes(page)).toHaveCount(1);
    const row = page.locator('[data-palette-item="app-server"]').first();
    await row.scrollIntoViewIfNeeded(); // the tap above may have scrolled the palette
    const from = await center(row);
    // Off-center on purpose: a tap-add lands in the center instead
    const c = await center(page.locator(".react-flow"));
    const to = { x: c.x + 150, y: c.y + 120 };
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", p?: { x: number; y: number }) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: p ? [{ x: Math.round(p.x), y: Math.round(p.y), id: 1 }] : [],
      });
    await touch("touchStart", from);
    await page.waitForTimeout(350); // hold past the activation delay
    for (let i = 1; i <= 12; i++) {
      await touch("touchMove", {
        x: from.x + ((to.x - from.x) * i) / 12,
        y: from.y + ((to.y - from.y) * i) / 12,
      });
    }
    await touch("touchEnd");
    await expect(nodes(page)).toHaveCount(2);
    const dropped = await center(page.locator('.react-flow__node[data-id^="app-server-"]'));
    expect(Math.abs(dropped.x - to.x)).toBeLessThan(40);
    expect(Math.abs(dropped.y - to.y)).toBeLessThan(40);
  });
});

test("CAN-05: copy/paste, duplicate, select all and arrow nudges", async ({ page }) => {
  await open(page);
  await quickAdd(page, "App Server");
  const first = nodes(page).first();
  await first.click();

  const before = (await first.boundingBox())!;
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  const after = (await first.boundingBox())!;
  expect(Math.round(after.x - before.x)).toBeGreaterThan(0);
  expect(Math.round(after.y - before.y)).toBeGreaterThan(Math.round(after.x - before.x));
  await page.keyboard.press(`${MOD}+z`);
  await expect
    .poll(async () => Math.round((await first.boundingBox())!.x))
    .toBe(Math.round(before.x));

  await first.click();
  await page.keyboard.press(`${MOD}+c`);
  await page.keyboard.press(`${MOD}+v`);
  await expect(nodes(page)).toHaveCount(2);
  await page.keyboard.press(`${MOD}+d`);
  await expect(nodes(page)).toHaveCount(3);
  await page.keyboard.press(`${MOD}+a`);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(3);
  await page.keyboard.press("Delete");
  await expect(nodes(page)).toHaveCount(0);

  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
});
