import { expect, test, type Page } from "@playwright/test";
import { SCHEMA_VERSION } from "@/domain/persistence/version";
import { MOD, goToStep, open, quickAdd } from "./helpers";

// Papel quente slices 3 and 4 (specs/2026-11-24-redesign-papel-quente.md, criteria 18, 19, 20, 22,
// 24, 26): the stage layout. The canvas fills the screen below the interview bar; the top bar, the
// rail, the panel and the dock float over it as cards. The dock (slice 4, in place of slice 3's
// palette card) is at the bottom of the canvas, opened and closed by the "Toggle sidebar" button.

type Box = { x: number; y: number; width: number; height: number };

const CARDS = ["stage-topbar", "stage-rail", "stage-panel", "stage-dock"] as const;

const boxOf = async (page: Page, testId: string): Promise<Box> => {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`${testId} has no box`);
  return box;
};

const flowBox = async (page: Page): Promise<Box> => {
  const box = await page.locator(".react-flow").boundingBox();
  if (!box) throw new Error(".react-flow has no box");
  return box;
};

const hit = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const inside = (inner: Box, outer: Box) =>
  inner.x >= outer.x - 0.5 &&
  inner.y >= outer.y - 0.5 &&
  inner.x + inner.width <= outer.x + outer.width + 0.5 &&
  inner.y + inner.height <= outer.y + outer.height + 0.5;

/** A canvas step at this viewport, with the stage's cards laid out for it. */
async function openStage(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await open(page, "/", "design");
  await expect(page.getByTestId("stage-rail")).toBeVisible();
  await expect(page.getByTestId("stage-panel")).toBeVisible();
  await expect(page.getByTestId("stage-dock")).toBeVisible();
}

/** No two of the visible cards intersect. */
async function expectNoOverlap(page: Page, label: string) {
  const boxes: [string, Box][] = [];
  for (const id of CARDS) {
    const card = page.getByTestId(id);
    if (await card.isVisible()) boxes.push([id, await boxOf(page, id)]);
  }
  expect(boxes.length, `${label}: the cards`).toBeGreaterThanOrEqual(4);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      expect(hit(boxes[i][1], boxes[j][1]), `${label}: ${boxes[i][0]} over ${boxes[j][0]}`).toBe(
        false,
      );
    }
  }
}

for (const [width, height] of [
  [1440, 900],
  [1280, 800],
] as const) {
  test(`${width}x${height}: a full-bleed canvas with the top bar, rail, panel and palette as cards over it (criterion 18)`, async ({
    page,
  }) => {
    await openStage(page, width, height);

    // The canvas fills the viewport; nothing takes room from it.
    await expect.poll(async () => await flowBox(page)).toEqual({ x: 0, y: 0, width, height });
    const flow = await flowBox(page);

    for (const id of CARDS) {
      expect(inside(await boxOf(page, id), flow), `${id} is inside the canvas`).toBe(true);
    }
    await expectNoOverlap(page, `${width}x${height}`);

    // The mockup's geometry.
    const topbar = await boxOf(page, "stage-topbar");
    expect(topbar.x).toBe(16);
    expect(topbar.y).toBe(16);
    expect(topbar.x + topbar.width).toBe(width - 16);
    const rail = await boxOf(page, "stage-rail");
    expect(rail).toMatchObject({ x: 16, y: 84, width: 210 });
    const panel = await boxOf(page, "stage-panel");
    expect(panel.width).toBe(340);
    expect(panel.x + panel.width).toBe(width - 16);
    expect(panel.y).toBe(84);
    expect(panel.y + panel.height).toBe(height - 16);
    // The dock is a strip at the canvas's bottom, between the zoom controls and the panel.
    const dock = await boxOf(page, "stage-dock");
    expect(dock.height).toBe(100);
    expect(dock.y + dock.height).toBe(height - 16);
    expect(dock.x).toBeGreaterThanOrEqual(238);
    expect(dock.x + dock.width).toBeLessThanOrEqual(panel.x - 16);
  });
}

test("every card has the theme's 14 px radius and 1.5 px border (criterion 18)", async ({
  page,
}) => {
  await openStage(page, 1440, 900);
  const token = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    return {
      width: css.getPropertyValue("--sf-border-w").trim(),
      radius: css.getPropertyValue("--sf-radius").trim(),
    };
  });
  expect(token).toEqual({ width: "1.5px", radius: "14px" });
  for (const id of CARDS) {
    const card = await page.getByTestId(id).evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        // the cards read the tokens (what the author wrote), and the browser draws them
        authoredWidth: (el as HTMLElement).style.borderWidth,
        authoredRadius: (el as HTMLElement).style.borderRadius,
        radius: cs.borderTopLeftRadius,
        width: parseFloat(cs.borderTopWidth),
        style: cs.borderTopStyle,
      };
    });
    expect(card.authoredWidth, `${id} border width`).toBe("var(--sf-border-w)");
    expect(card.authoredRadius, `${id} radius`).toBe("var(--sf-radius)");
    expect(card.radius, `${id} drawn radius`).toBe("14px");
    // Chromium floors a border to whole device pixels at 1x: 1 px drawn for 1.5 px written.
    expect(card.width, `${id} drawn border`).toBeGreaterThanOrEqual(1);
    expect(card.width, `${id} drawn border`).toBeLessThanOrEqual(1.5);
    expect(card.style).toBe("solid");
  }
});

test("1024x768: the rail starts collapsed to icons and expands, the panel is 300 px, no card meets another (criterion 19)", async ({
  page,
}) => {
  await openStage(page, 1024, 768);
  await expect.poll(async () => (await boxOf(page, "stage-rail")).width).toBeLessThanOrEqual(56);
  expect((await boxOf(page, "stage-panel")).width).toBe(300);
  await expectNoOverlap(page, "1024 collapsed rail");
  // Collapsed, every step is still a named button.
  const bar = page.getByTestId("step-bar");
  await expect(bar.locator("[data-step]")).toHaveCount(5);
  await expect(bar.getByRole("button", { name: "Next", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Expand steps" }).click();
  await expect.poll(async () => (await boxOf(page, "stage-rail")).width).toBe(210);
  await expectNoOverlap(page, "1024 expanded rail");

  await page.getByRole("button", { name: "Collapse steps" }).click();
  await expect.poll(async () => (await boxOf(page, "stage-rail")).width).toBeLessThanOrEqual(56);
});

test("1024x768: the dock scrolls sideways, every tile and the All components button can be brought into view, and nothing meets the panel opened over it (criterion 19, moved from slice 3)", async ({
  page,
}) => {
  await openStage(page, 1024, 768);
  const dock = page.getByTestId("stage-dock");
  expect(await dock.evaluate((el) => getComputedStyle(el).overflowX)).toBe("auto");
  // more tiles than the room between the controls and the panel holds
  expect(await dock.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

  const flow = await flowBox(page);
  for (const name of [
    "Add Client to canvas",
    "Add Message Queue to canvas",
    "All components",
  ] as const) {
    const control = dock.getByRole("button", { name, exact: true });
    await control.scrollIntoViewIfNeeded();
    const b = (await control.boundingBox())!;
    const d = await boxOf(page, "stage-dock");
    expect(inside(b, d), `${name} is inside the dock once scrolled to`).toBe(true);
    expect(inside(d, flow), "the dock stays on the canvas").toBe(true);
  }

  // with the panel open above it, still no two cards meet (the expanded rail is the widest left card)
  await page.getByRole("button", { name: "Expand steps" }).click();
  await expect.poll(async () => (await boxOf(page, "stage-rail")).width).toBe(210);
  await page.getByRole("button", { name: "All components", exact: true }).click();
  await expect(page.getByTestId("stage-dock-panel")).toBeVisible();
  const boxes: [string, Box][] = [];
  for (const id of [...CARDS, "stage-dock-panel"]) {
    if (await page.getByTestId(id).isVisible()) boxes.push([id, await boxOf(page, id)]);
  }
  expect(boxes.length).toBe(5);
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      expect(hit(boxes[i][1], boxes[j][1]), `${boxes[i][0]} over ${boxes[j][0]}`).toBe(false);
});

test("no two cards meet at 1024x768 with a reference open either (criterion 19)", async ({
  page,
}) => {
  await openStage(page, 1024, 768);
  // under 1280 px the reference loads from the top bar's overflow menu
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Load reference solution" }).click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await expectNoOverlap(page, "1024 with a reference");
});

test("the rail holds the problem and the steps, and Back / Next keep navigating in order (criterion 20)", async ({
  page,
}) => {
  await openStage(page, 1440, 900);
  const rail = page.getByTestId("stage-rail");
  await expect(rail.getByTestId("rail-problem")).toBeVisible();
  // exactly one step bar on the page, and it is in the rail
  await expect(page.getByTestId("step-bar")).toHaveCount(1);
  await expect(rail.getByTestId("step-bar")).toBeVisible();
  await expect(rail.getByTestId("step-bar").locator("[data-step]")).toHaveText([
    /Problem/,
    /Design/,
    /Simulate/,
    /Failures/,
    /Evaluate/,
  ]);

  const next = rail.getByRole("button", { name: "Next", exact: true });
  const back = rail.getByRole("button", { name: "Back", exact: true });
  await next.click();
  await expect(rail.locator('[aria-current="step"]')).toHaveAttribute("data-step", "simulate");
  // a step ahead is not a way to get there
  const failures = rail.locator('[data-step="failures"]');
  await expect(failures).toBeDisabled();
  await back.click();
  await expect(rail.locator('[aria-current="step"]')).toHaveAttribute("data-step", "design");
  await rail.locator('[data-step="problem"]').click();
  await expect(page.getByTestId("problem-step")).toBeVisible();
});

test("opening or closing the rail, the panel or the palette shows or hides its card and never resizes the canvas (criterion 22)", async ({
  page,
}) => {
  await openStage(page, 1440, 900);
  const before = await flowBox(page);
  const rf = async () => expect(await flowBox(page)).toEqual(before);

  // the dock: the top bar's "Toggle sidebar"
  const palette = page.getByTestId("stage-dock");
  // the stage sets its insets on the canvas's wrapper, the one element with a "--stage-inset-bottom:" in its style
  const stageVars = page.locator('[style*="--stage-inset-bottom:"]');
  await expect(stageVars).toHaveCount(1);
  const varOf = (name: string) =>
    stageVars.evaluate((el, n) => getComputedStyle(el).getPropertyValue(n).trim(), name);

  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await expect(palette).toBeHidden();
  // the dock is gone, so the canvas gives its bottom strip back
  await expect.poll(() => varOf("--stage-inset-bottom")).toBe("0px");
  await expect.poll(() => varOf("--toast-bottom")).toBe("");
  await rf();
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await expect(palette).toBeVisible();
  await expect.poll(() => varOf("--stage-inset-bottom")).toBe("116px");
  await expect.poll(() => varOf("--toast-bottom")).toBe("128px");
  await rf();

  // the panel: "Toggle properties panel"
  const panel = page.getByTestId("stage-panel");
  await page.getByRole("button", { name: "Toggle properties panel" }).click();
  await expect(panel).toBeHidden();
  await rf();
  await page.getByRole("button", { name: "Toggle properties panel" }).click();
  await expect(panel).toBeVisible();
  await rf();

  // the rail: its own toggle collapses it to the icon column and back
  const rail = page.getByTestId("stage-rail");
  await page.getByRole("button", { name: "Collapse steps" }).click();
  await expect.poll(async () => (await boxOf(page, "stage-rail")).width).toBeLessThanOrEqual(56);
  await expect(rail).toBeVisible();
  await rf();
  await page.getByRole("button", { name: "Expand steps" }).click();
  await expect.poll(async () => (await boxOf(page, "stage-rail")).width).toBe(210);
  await rf();

  // with the three cards closed together, the canvas is still the same box
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await page.getByRole("button", { name: "Toggle properties panel" }).click();
  await expect(palette).toBeHidden();
  await expect(panel).toBeHidden();
  await rf();
});

test("changing step moves no card and does not resize the canvas (criterion 22, AD-004)", async ({
  page,
}) => {
  await openStage(page, 1440, 900);
  const before = await flowBox(page);
  const rail = await boxOf(page, "stage-rail");
  const topbar = await boxOf(page, "stage-topbar");
  await goToStep(page, "simulate");
  await expect(page.getByTestId("stage-panel")).toBeVisible();
  expect(await flowBox(page)).toEqual(before);
  expect(await boxOf(page, "stage-rail")).toEqual(rail);
  expect(await boxOf(page, "stage-topbar")).toEqual(topbar);
  // the dock is the Design step's tool
  await expect(page.getByTestId("stage-dock")).toHaveCount(0);
});

test("the Problem step is full screen with no canvas and no card (criterion 24)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/", "problem");
  await expect(page.getByTestId("problem-step")).toBeVisible();
  await expect(page.locator(".react-flow")).toHaveCount(0);
  for (const id of [...CARDS, "stage-dock"]) await expect(page.getByTestId(id)).toHaveCount(0);
  // the top bar is the plain bar across the top, not a floating card
  const header = await page.locator("header").first().boundingBox();
  expect(header).toMatchObject({ x: 0, y: 0, width: 1440 });
});

test("interview phases 1-4 are full screen with no canvas; the canvas phases get the stage (criterion 24)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/", "design");
  await page.getByTitle("Start a guided interview practice").click();
  await page.getByRole("button", { name: "Start Interview" }).click();

  await expect(page.getByTestId("interview-screen")).toBeVisible();
  await expect(page.locator(".react-flow")).toHaveCount(0);
  for (const id of CARDS) await expect(page.getByTestId(id)).toHaveCount(0);

  const bar = page.getByTestId("step-bar");
  for (let i = 0; i < 4; i++) {
    await bar.getByRole("button", { name: "Next", exact: true }).click();
  }
  // High-Level Design: the canvas, full-bleed below the interview bar, with the cards over it
  await expect(page.locator(".react-flow")).toBeVisible();
  const flow = await flowBox(page);
  expect(flow.x).toBe(0);
  expect(flow.width).toBe(1440);
  expect(flow.y).toBeGreaterThan(0); // the interview bar is above it
  expect(flow.y + flow.height).toBe(900);
  await expect(page.getByTestId("stage-rail")).toBeVisible();
  await expect(page.getByTestId("stage-rail").getByTestId("step-bar")).toBeVisible();
  await expect(page.getByTestId("stage-panel")).toBeVisible();
  await expectNoOverlap(page, "interview HLD");
});

test("below 768 px nothing changes: drawers and a bottom sheet, no cards, no dock (criterion 26)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "/", "design");
  for (const id of [...CARDS, "stage-dock"]) await expect(page.getByTestId(id)).toHaveCount(0);

  // the palette opens as a drawer
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await expect(page.getByRole("button", { name: "Close sidebar" })).toBeVisible();
  await expect(page.getByPlaceholder("Search components...")).toBeVisible();
  await page.getByRole("button", { name: "Close sidebar" }).click();

  // the panel opens as the bottom sheet
  await page.getByRole("button", { name: "Toggle properties panel" }).click();
  await expect(page.locator("[data-bottom-sheet]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close panel" })).toBeVisible();

  // the compact step bar, not the rail's
  await expect(page.locator('[data-testid="step-bar"][data-compact]')).toBeVisible();
  await expect(page.locator('[data-testid="step-bar"][data-orientation]')).toHaveCount(0);
});

// The support button would sit on the stage panel's corner, so the stage hides it (the top bar and
// its menu carry the same action). Everywhere else it keeps its old behaviour.
// The floating button, not the top bar's own "Buy me a coffee" (which stays on every step).
const supportFab = (page: Page) =>
  page.locator('button[aria-label="Buy me a coffee"]:not(header button)');

test("the floating Buy me a coffee button is not rendered on the stage at 1440x900", async ({
  page,
}) => {
  await openStage(page, 1440, 900);
  await expect(supportFab(page)).toHaveCount(0);
});

test("the floating Buy me a coffee button is visible on the Problem step at 1440x900", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/", "problem");
  await expect(page.getByTestId("problem-step")).toBeVisible();
  await expect(supportFab(page)).toBeVisible();
});

test("below 768 px the floating Buy me a coffee button is visible unless a drawer or the sheet is open", async ({
  page,
}) => {
  const fab = supportFab(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "/", "design");
  await expect(page.locator('[data-testid="step-bar"][data-compact]')).toBeVisible();
  await expect(fab).toBeVisible();

  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await expect(page.getByRole("button", { name: "Close sidebar" })).toBeVisible();
  await expect(fab).toHaveCount(0);
  await page.getByRole("button", { name: "Close sidebar" }).click();
  await expect(fab).toBeVisible();

  await page.getByRole("button", { name: "Toggle properties panel" }).click();
  await expect(page.locator("[data-bottom-sheet]")).toBeVisible();
  await expect(fab).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------
// Criterion 23 and the canvas under the cards: fitView and tap-add know about the open cards, and
// the canvas's own overlays (the read-only hint, the pen toolbar, the welcome) sit in what they leave.
// ---------------------------------------------------------------------------------------------

const APP_KEY = "systemsim-app";

/** Open the Design step at this size with `problemId` picked, so "Load reference" loads its solution. */
async function openWithProblem(page: Page, width: number, height: number, problemId: string) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(
    ({ key, id, version }) => {
      if (!localStorage.getItem(key)) {
        localStorage.setItem(
          key,
          JSON.stringify({ state: { step: "design", selectedProblemId: id }, version }),
        );
      }
    },
    { key: APP_KEY, id: problemId, version: SCHEMA_VERSION },
  );
  await open(page, "/", "design");
  await expect(page.getByTestId("stage-dock")).toBeVisible();
}

/** The boxes of every component node on screen. */
const nodeBoxes = (page: Page): Promise<Box[]> =>
  page.locator(".react-flow__node").evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }),
  );

/** The boxes of the cards that are showing. */
async function openCards(page: Page): Promise<[string, Box][]> {
  const out: [string, Box][] = [];
  for (const id of CARDS) {
    if (await page.getByTestId(id).isVisible()) out.push([id, await boxOf(page, id)]);
  }
  return out;
}

/** Wait for the viewport to stop moving (fitView animates for 300 ms). */
async function viewportSettled(page: Page) {
  const read = () =>
    page.locator(".react-flow__viewport").evaluate((el) => (el as HTMLElement).style.transform);
  let last = await read();
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(150);
    const now = await read();
    if (now === last) return now;
    last = now;
  }
  throw new Error("the viewport never settled");
}

/** Every node box that meets a card, as `node i under card`. */
async function nodesUnderCards(page: Page): Promise<string[]> {
  const cards = await openCards(page);
  const out: string[] = [];
  (await nodeBoxes(page)).forEach((n, i) => {
    for (const [id, card] of cards) if (hit(n, card)) out.push(`node ${i} under ${id}`);
  });
  return out;
}

for (const problem of ["url-shortener", "chat-system", "video-streaming", "reddit"]) {
  test(`1440x900: after loading the ${problem} reference no node meets the top bar, rail, panel or palette (criterion 23)`, async ({
    page,
  }) => {
    await openWithProblem(page, 1440, 900, problem);
    await page.getByTitle("Load reference solution").click();
    await expect(page.locator(".react-flow__node").first()).toBeVisible();
    await viewportSettled(page);

    expect(await nodesUnderCards(page)).toEqual([]);

    // framed, not pushed away: every node is on the canvas
    const flow = await flowBox(page);
    for (const n of await nodeBoxes(page)) expect(inside(n, flow), "node on screen").toBe(true);
  });
}

test("1440x900: a design saved with the page is framed clear of the cards when the page opens (criterion 23)", async ({
  page,
}) => {
  await openWithProblem(page, 1440, 900, "reddit");
  await page.getByTitle("Load reference solution").click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await viewportSettled(page);
  await page.reload();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await viewportSettled(page);

  expect(await nodesUnderCards(page)).toEqual([]);
  const flow = await flowBox(page);
  for (const n of await nodeBoxes(page)) expect(inside(n, flow), "node on screen").toBe(true);
});

test("1440x900: a reference opened over a design, and the design when its tab is back, are framed clear of the cards (criterion 23)", async ({
  page,
}) => {
  await openWithProblem(page, 1440, 900, "reddit");
  // a design first, so the first fit is spent: the tab switches are what frame from here on
  for (const label of ["Client", "App Server", "SQL Database"]) await quickAdd(page, label);
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await viewportSettled(page);
  expect(await nodesUnderCards(page)).toEqual([]);

  await page.getByTitle("Load reference solution").click();
  await expect(page.locator(".react-flow__node")).not.toHaveCount(3);
  await page.waitForTimeout(500);
  await viewportSettled(page);
  expect(await nodesUnderCards(page)).toEqual([]);
  const flow = await flowBox(page);
  for (const n of await nodeBoxes(page))
    expect(inside(n, flow), "reference node on screen").toBe(true);

  // back to the design tab
  await page.locator("[data-canvas-tabs]").getByText("My Design").click();
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await page.waitForTimeout(500);
  await viewportSettled(page);
  expect(await nodesUnderCards(page)).toEqual([]);
  for (const n of await nodeBoxes(page))
    expect(inside(n, flow), "design node on screen").toBe(true);
});

test("1024x768: a reference fits in what the rail, the palette and the panel leave (criterion 23)", async ({
  page,
}) => {
  await openWithProblem(page, 1024, 768, "url-shortener");
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Load reference solution" }).click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await viewportSettled(page);
  expect(await nodesUnderCards(page)).toEqual([]);
});

test("opening or closing a card never re-fits; the controls' fit-view button frames what is open (criteria 22, 23)", async ({
  page,
}) => {
  await openWithProblem(page, 1440, 900, "url-shortener");
  await page.getByTitle("Load reference solution").click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  // A tab's own fit may zoom in past 1 where the button's never does (the dock leaves the free area
  // wider than the palette card did): the baseline is the button's frame.
  await viewportSettled(page);
  await page.getByRole("button", { name: /fit view/i }).click();
  const framed = await viewportSettled(page);

  // Closing and reopening the dock, the panel and the rail moves no node: the viewport is the
  // user's, and no toggle asks for a fit.
  for (const name of ["Toggle sidebar", "Toggle properties panel", "Collapse steps"]) {
    await page.getByRole("button", { name }).click();
  }
  await page.waitForTimeout(600);
  expect(await viewportSettled(page)).toBe(framed);
  for (const name of ["Toggle sidebar", "Toggle properties panel", "Expand steps"]) {
    await page.getByRole("button", { name }).click();
  }
  await page.waitForTimeout(600);
  expect(await viewportSettled(page)).toBe(framed);

  // The user pans away, then asks for a fit: it is the frame that clears the open cards.
  await page.mouse.move(720, 450);
  await page.mouse.wheel(700, 0);
  expect(await viewportSettled(page)).not.toBe(framed);
  await page.getByRole("button", { name: /fit view/i }).click();
  expect(await viewportSettled(page)).toBe(framed);
  expect(await nodesUnderCards(page)).toEqual([]);
});

/** The visible center: the canvas minus the open cards (the rail, the panel, the top bar, the dock). */
async function visibleCenter(page: Page) {
  const cards = new Map(await openCards(page));
  const flow = await flowBox(page);
  const rail = cards.get("stage-rail");
  const panel = cards.get("stage-panel");
  const top = cards.get("stage-topbar");
  const dock = cards.get("stage-dock");
  return {
    x: ((rail ? rail.x + rail.width : 0) + (panel ? panel.x : flow.x + flow.width)) / 2,
    y: ((top ? top.y + top.height : flow.y) + (dock ? dock.y : flow.y + flow.height)) / 2,
  };
}

const lastNodeCenter = async (page: Page) => {
  const boxes = await nodeBoxes(page);
  const n = boxes[boxes.length - 1];
  return { x: n.x + n.width / 2, y: n.y + n.height / 2 };
};

test("tap-add lands at the center of the canvas minus the open cards, and follows them (criterion 23)", async ({
  page,
}) => {
  await openStage(page, 1440, 900);
  // The first node on an empty canvas triggers the one-time fit: add one and take it away,
  // so what follows is placed by `placeNode` alone.
  await page.getByRole("button", { name: "Add App Server to canvas" }).first().click();
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await viewportSettled(page);
  await page.keyboard.press(`${MOD}+z`);
  await expect(page.locator(".react-flow__node")).toHaveCount(0);

  await page.getByRole("button", { name: "Add Cache / Redis to canvas" }).first().click();
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  let want = await visibleCenter(page);
  let got = await lastNodeCenter(page);
  expect(Math.abs(got.x - want.x), "x, every card open").toBeLessThanOrEqual(2);
  expect(Math.abs(got.y - want.y), "y, every card open").toBeLessThanOrEqual(2);
  // and not where the whole canvas's center is
  expect(Math.abs(want.x - 720) + Math.abs(want.y - 450)).toBeGreaterThan(40);

  // With the panel and the dock closed, the visible area is bigger and so is where it centers.
  await page.keyboard.press(`${MOD}+z`);
  await expect(page.locator(".react-flow__node")).toHaveCount(0);
  await page.getByRole("button", { name: "Toggle properties panel" }).click();
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await expect(page.getByTestId("stage-panel")).toBeHidden();
  await expect(page.getByTestId("stage-dock")).toBeHidden();
  await page.getByRole("button", { name: "Add Note" }).click();
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  want = await visibleCenter(page);
  got = await lastNodeCenter(page);
  // (a note is placed by its 272 x 48 estimate and then measured by its content: a few px apart)
  expect(Math.abs(got.x - want.x), "x, panel and dock closed").toBeLessThanOrEqual(12);
  expect(Math.abs(got.y - want.y), "y, panel and dock closed").toBeLessThanOrEqual(12);
});

test("1024x768: sixteen tap-adds never land under a card, nor on each other (criterion 23)", async ({
  page,
}) => {
  await openStage(page, 1024, 768);
  const labels = ["App Server", "Cache / Redis", "SQL Database", "Load Balancer"];
  for (let i = 0; i < 16; i++) await quickAdd(page, labels[i % 4]);
  await expect(page.locator(".react-flow__node")).toHaveCount(16);
  await viewportSettled(page);
  expect(await nodesUnderCards(page)).toEqual([]);
  const boxes = await nodeBoxes(page);
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      expect(hit(boxes[i], boxes[j]), `node ${i} on node ${j}`).toBe(false);
});

// The canvas's own overlays: they are laid out in the part of the canvas the cards leave.

test("the read-only hint and the pen toolbar sit under the top bar, clear of the panel (criterion 23)", async ({
  page,
}) => {
  await openWithProblem(page, 1440, 900, "url-shortener");
  await page.getByTitle("Load reference solution").click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  const hint = page.getByTestId("readonly-hint");
  const pen = page.getByTestId("pen-toolbar");
  await expect(hint).toBeVisible();
  await expect(pen).toBeVisible();

  const topbar = await boxOf(page, "stage-topbar");
  const bar = topbar.y + topbar.height;
  // the tab bar (a reference is open) floats at the top of what the cards leave, centered in it
  const tabs = (await page.locator("[data-canvas-tabs]").boundingBox())!;
  for (const [id, card] of await openCards(page)) {
    expect(hit(tabs, card), `the tab bar under ${id}`).toBe(false);
  }
  expect(tabs.y).toBeGreaterThanOrEqual(bar);
  const panelNow = await boxOf(page, "stage-panel");
  const railNow = await boxOf(page, "stage-rail");
  expect(tabs.x + tabs.width / 2).toBeCloseTo((railNow.x + railNow.width + panelNow.x) / 2, -1);
  for (const open of [true, false]) {
    if (!open) {
      await page.getByRole("button", { name: "Toggle properties panel" }).click();
      await expect(page.getByTestId("stage-panel")).toBeHidden();
    }
    for (const [name, loc] of [
      ["the read-only hint", hint],
      ["the pen toolbar", pen],
    ] as const) {
      const b = (await loc.boundingBox())!;
      // nothing peeks out above the floating top bar, or sits under it or the tab bar
      expect(b.y, `${name} starts below the top bar`).toBeGreaterThanOrEqual(bar);
      expect(b.y, `${name} starts below the tab bar`).toBeGreaterThanOrEqual(tabs.y + tabs.height);
      for (const [id, card] of await openCards(page)) {
        expect(hit(b, card), `${name} under ${id} (panel open: ${open})`).toBe(false);
      }
    }
  }
  // closed, the pen toolbar goes back to the canvas's own corner
  const penBox = (await pen.boundingBox())!;
  expect(penBox.x + penBox.width).toBeGreaterThan(1440 - 40);
  // the hint is centered on the part of the canvas the rail and the panel leave
  const hintBox = (await hint.boundingBox())!;
  const rail = await boxOf(page, "stage-rail");
  const leftEdge = rail.x + rail.width;
  expect(hintBox.x + hintBox.width / 2).toBeCloseTo((leftEdge + 1440) / 2, -1);
});

for (const [width, height] of [
  [1440, 900],
  [1024, 768],
] as const) {
  test(`${width}x${height}: the welcome is centered in what the cards leave, under none of them (criterion 23)`, async ({
    page,
  }) => {
    await openStage(page, width, height);
    const welcome = page.getByTestId("empty-state");
    await expect(welcome).toBeVisible();
    // the staggered reveal moves the children by a few pixels at first: wait for the end of it
    await expect(
      page.getByRole("heading", { name: "Build an architecture that scales" }),
    ).toBeVisible();
    await page.waitForTimeout(1200);

    const box = (await welcome.locator("> div").boundingBox())!;
    for (const [id, card] of await openCards(page)) {
      expect(hit(box, card), `the welcome under ${id}`).toBe(false);
    }
    const cards = new Map(await openCards(page));
    const left = (cards.get("stage-rail")?.x ?? 0) + (cards.get("stage-rail")?.width ?? 0);
    const right = cards.get("stage-panel")!.x;
    expect(box.x + box.width / 2).toBeCloseTo((left + right) / 2, -1);
    // and down the free area: from the top bar's row (the rail's top) to the dock's top
    const top = cards.get("stage-rail")!.y;
    const dockTop = cards.get("stage-dock")!.y;
    expect(box.y + box.height / 2).toBeCloseTo((top + dockTop) / 2, -1);
  });
}
