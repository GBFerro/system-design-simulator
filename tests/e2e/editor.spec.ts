import { expect, test, type Page } from "@playwright/test";
import { MOD, center, connect, edgePoint, open, quickAdd } from "./helpers";

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

// Request-flow (FLW-08/17/25/26/44): the Props panel edits every call an edge carries.

/** App Server → SQL DB, then App Server → Cache: the DB call runs at step 1, the cache's at 2. */
async function serviceWithDbAndCache(page: Page) {
  await open(page);
  await quickAdd(page, "App Server");
  await quickAdd(page, "Cache / Redis");
  await quickAdd(page, "SQL Database");
  await expect(nodes(page)).toHaveCount(3);
  await connect(page, "app-server", "sql-db");
  await connect(page, "app-server", "cache");
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
}

const edgeTo = (page: Page, target: string) =>
  page.locator(`.react-flow__edge[data-id*="${target}-"]`);

async function selectEdge(page: Page, target?: string) {
  const point = await edgePoint(page, target ? edgeTo(page, target) : undefined);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId("edge-calls")).toBeVisible();
}

const call = (page: Page, n: number) => page.getByRole("group", { name: `Call ${n}` });

test("FLW-25: the Props panel edits an edge's calls, one undo step per edit", async ({ page }) => {
  await serviceWithDbAndCache(page);

  // The cache call: its source calls no other cache, so no "reads after a miss" (FLW-08)
  await selectEdge(page, "cache");
  await expect(
    call(page, 1).getByLabel("Call rule").locator("option", { hasText: "Reads after a miss in" }),
  ).toHaveCount(0);

  await selectEdge(page, "sql-db");
  await expect(call(page, 2)).toHaveCount(0);
  // An edge keeps at least one call (FLW-44)
  await expect(call(page, 1).getByRole("button", { name: "Remove call 1" })).toBeDisabled();
  await call(page, 1).getByLabel("Call rule").selectOption("writes");

  await page.getByRole("button", { name: "Add call" }).click();
  await expect(call(page, 2)).toBeVisible();
  await expect(call(page, 1).getByRole("button", { name: "Remove call 1" })).toBeEnabled();
  await call(page, 2).getByLabel("Call rule").selectOption("after_miss");
  // The look-aside call names the cache the service calls (FLW-08)
  await expect(call(page, 2).getByLabel("Cache")).toHaveValue(/^cache-/);
  await expect(call(page, 2).getByLabel("Cache").locator("option:checked")).toHaveText(
    "Cache / Redis",
  );
  await expect(call(page, 1).getByLabel("Call rule")).toHaveValue("writes");

  // One undo reverts exactly the last edit
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(call(page, 2).getByLabel("Call rule")).toHaveValue("always");
  await expect(call(page, 2).getByLabel("Cache")).toHaveCount(0);
  await expect(call(page, 1).getByLabel("Call rule")).toHaveValue("writes");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(call(page, 2)).toHaveCount(0);

  // At most MAX_EDGE_CALLS (8) calls per edge
  const add = page.getByRole("button", { name: "Add call" });
  for (let n = 2; n <= 8; n++) {
    await add.click();
    await expect(call(page, n)).toBeVisible();
  }
  await expect(add).toBeDisabled();
});

test("FLW-26: the first explicit step pins the node's other calls where they run", async ({
  page,
}) => {
  await serviceWithDbAndCache(page);
  await selectEdge(page, "cache");
  await expect(call(page, 1).getByLabel("Step")).toHaveValue("2");

  await selectEdge(page, "sql-db");
  const step = call(page, 1).getByLabel("Step");
  await expect(step).toHaveValue("1");
  await step.fill("2");
  await step.press("Enter");
  await expect(step).toHaveValue("2");
  // The cache call keeps step 2 (pinned) instead of moving after the explicit one
  await selectEdge(page, "cache");
  await expect(call(page, 1).getByLabel("Step")).toHaveValue("2");

  // Pinning and the edit are one undo step
  await page.getByRole("button", { name: "Undo" }).click();
  await selectEdge(page, "sql-db");
  await expect(call(page, 1).getByLabel("Step")).toHaveValue("1");
  await selectEdge(page, "cache");
  await expect(call(page, 1).getByLabel("Step")).toHaveValue("2");
});

test("FLW-25: on a read-only reference the calls can't be edited", async ({ page }) => {
  await open(page);
  await page.getByTitle("Load reference solution").click();
  await expect(nodes(page).first()).toBeVisible();
  await selectEdge(page);
  await expect(call(page, 1).getByLabel("Call rule")).toBeDisabled();
  await expect(call(page, 1).getByLabel("Calls per request")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add call" })).toBeDisabled();
  await expect(call(page, 1).getByRole("button", { name: "Remove call 1" })).toBeDisabled();
});

test("FLW-17: the context menu edits a one-call edge and sends a several-call edge to the panel", async ({
  page,
}) => {
  await serviceWithDbAndCache(page);
  const menu = page.getByRole("menu", { name: "Canvas actions" });
  const rightClick = async (target: string) => {
    const point = await edgePoint(page, edgeTo(page, target));
    await page.mouse.click(point.x, point.y, { button: "right" });
    await expect(menu).toBeVisible();
  };

  // One call: the menu switches its condition, the look-aside included
  await rightClick("sql-db");
  await expect(
    menu.getByRole("menuitemradio", { name: "Reads after a miss in Cache / Redis" }),
  ).toBeVisible();
  await menu.getByRole("menuitemradio", { name: "Writes only" }).click();
  await expect(menu).toHaveCount(0);
  await selectEdge(page, "sql-db");
  await expect(call(page, 1).getByLabel("Call rule")).toHaveValue("writes");

  // Two calls: the menu offers the panel instead of one call's condition
  await page.getByRole("button", { name: "Add call" }).click();
  await expect(call(page, 2)).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator(".react-flow__pane").click({ position: { x: 20, y: 20 } });
  await expect(page.getByTestId("edge-calls")).toHaveCount(0);
  await rightClick("sql-db");
  await expect(menu.getByRole("menuitemradio", { name: "Writes only" })).toHaveCount(0);
  await menu.getByRole("menuitem", { name: /Edit calls in the panel/ }).click();
  await expect(menu).toHaveCount(0);
  await expect(call(page, 2)).toBeVisible();
  await expect(call(page, 1).getByLabel("Call rule")).toHaveValue("writes");
});
