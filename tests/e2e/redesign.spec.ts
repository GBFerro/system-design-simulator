import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import {
  EXPECTED_TOKENS,
  NAMED_MAPPINGS,
  PALETTE_TOKEN,
  THEMES,
  type Theme,
} from "../theme-expected";
import { SYSTEM_COMPONENTS } from "@/data/components";
import { isoArchetypeOf, isoTintOf } from "@/lib/iso";
import { DEFAULT_NODE_SIZE } from "@/lib/placement";
import {
  MOD,
  center,
  clickEmptyPane,
  connect,
  connectSync,
  open,
  openPalette,
  openTab,
  quickAdd,
} from "./helpers";

// Papel quente slice 1 (specs/2026-11-24-redesign-papel-quente.md, criteria 1, 2, 4, 5, 6, 7):
// the tokens, the remapped palettes, the fonts, the canvas colors and the default theme.

const TOGGLE = "Toggle color theme";

async function isDark(page: Page) {
  return page.evaluate(() => document.documentElement.classList.contains("dark"));
}

/** Switch to a theme through the top bar's toggle, as a user would. */
async function setTheme(page: Page, theme: Theme) {
  if ((await isDark(page)) !== (theme === "dark")) {
    await page.getByRole("button", { name: TOGGLE }).click();
  }
  await expect.poll(() => isDark(page)).toBe(theme === "dark");
}

/** Lowercase every hex color of a value, #rgb expanded to #rrggbb (the CSS minifier shortens #ffffff). */
function hex(value: string) {
  return value.toLowerCase().replace(/#([0-9a-f])([0-9a-f])([0-9a-f])\b/g, "#$1$1$2$2$3$3");
}

/** A custom property of the root, trimmed, its hex colors normalized by `hex`. */
async function rootVar(page: Page, name: string) {
  return hex(
    await page.evaluate(
      (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
      name,
    ),
  );
}

/** The stylesheet and the fonts have applied: dev serves the first paint before its CSS lands. */
async function stylesApplied(page: Page) {
  await expect.poll(() => rootVar(page, "--sf-bg")).not.toBe("");
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).fontFamily))
    .not.toContain("Times");
}

/** How the browser computes a color: a hex, an `rgba()` or a `var(--x)` become one `rgb(...)` string. */
function computedColor(page: Page, value: string) {
  return page.evaluate((v) => {
    const probe = document.createElement("span");
    probe.style.color = v;
    document.body.appendChild(probe);
    const out = getComputedStyle(probe).color;
    probe.remove();
    return out;
  }, value);
}

/** The computed property of a throwaway element carrying the given classes. */
function computedOf(page: Page, className: string, property: "color" | "backgroundColor") {
  return page.evaluate(
    ([cls, prop]) => {
      const el = document.createElement("span");
      el.className = cls;
      document.body.appendChild(el);
      const out = getComputedStyle(el)[prop as "color" | "backgroundColor"];
      el.remove();
      return out;
    },
    [className, property] as const,
  );
}

test("tokens: the --sf values, the ramps and the shadcn tokens in both themes", async ({
  page,
}) => {
  await open(page, "/");
  await stylesApplied(page);
  for (const theme of THEMES) {
    await setTheme(page, theme);
    for (const [name, value] of Object.entries(EXPECTED_TOKENS[theme])) {
      expect(await rootVar(page, name), `${theme} ${name}`).toBe(hex(value));
    }
    for (const [name, token] of NAMED_MAPPINGS) {
      expect(await rootVar(page, name), `${theme} ${name}`).toBe(await rootVar(page, token));
    }
    // The steps not named stay hex values (between their neighbours: the unit test).
    for (const n of [50, 200, 300, 600, 700]) {
      expect(await rootVar(page, `--z-${n}`), `${theme} --z-${n}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  }
});

test("status palettes: rose, amber, emerald, violet, orange and blue follow the tokens", async ({
  page,
}) => {
  await open(page, "/");
  await stylesApplied(page);
  for (const theme of THEMES) {
    await setTheme(page, theme);
    for (const [palette, token] of Object.entries(PALETTE_TOKEN)) {
      const want = await computedColor(page, await rootVar(page, token));
      expect(
        await computedOf(page, `text-${palette}-400`, "color"),
        `${theme} text-${palette}-400`,
      ).toBe(want);
      expect(
        await computedOf(page, `bg-${palette}-500`, "backgroundColor"),
        `${theme} bg-${palette}-500`,
      ).toBe(want);
    }
  }
});

test("fonts: Inter, Bricolage Grotesque and IBM Plex Mono, no Hanken or Geist", async ({
  page,
}) => {
  await open(page, "/");
  await stylesApplied(page);
  // next/font names a family `__Inter_a1b2c3` (spaces become underscores): compare as words.
  const families = await page.evaluate(() => {
    const fam = (el: Element) =>
      getComputedStyle(el).fontFamily.replace(/_/g, " ").replace(/["']/g, "");
    const make = (cls: string) => {
      const el = document.createElement("span");
      el.className = cls;
      el.textContent = "x";
      document.body.appendChild(el);
      return el;
    };
    const heading = make("font-heading");
    const display = make("font-display");
    const mono = make("font-mono");
    const out = {
      body: fam(document.body),
      heading: fam(heading),
      display: fam(display),
      mono: fam(mono),
      // (not Next's own dev overlay, a `nextjs-portal` that sets Geist for its indicator)
      all: [...document.querySelectorAll("*:not(nextjs-portal, nextjs-portal *)")].map(fam),
    };
    for (const el of [heading, display, mono]) el.remove();
    return out;
  });
  expect(families.body.split(",")[0]).toContain("Inter");
  expect(families.heading).toContain("Bricolage Grotesque");
  expect(families.display).toContain("Bricolage Grotesque");
  expect(families.mono).toContain("IBM Plex Mono");
  expect(families.all.filter((f) => /Hanken|Geist/i.test(f))).toEqual([]);
});

test("canvas colors: edges, minimap, background and the SVG export follow the theme", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, "/");
  await stylesApplied(page);
  await page.getByTitle("Load reference solution").click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await showMinimap(page);

  const seen: Record<string, string[]> = {
    edge: [],
    mask: [],
    line: [],
    bg: [],
  };
  for (const theme of THEMES) {
    await setTheme(page, theme);
    const want = {
      edge: await computedColor(page, "var(--edge-idle)"),
      mask: await computedColor(page, "var(--minimap-mask)"),
      line: await computedColor(page, "var(--grid-line)"),
    };
    const got = await page.evaluate(() => {
      const css = (sel: string, prop: "stroke" | "fill") => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el)[prop] : null;
      };
      return {
        edge: css(".react-flow__edge-path", "stroke"),
        mask: css(".react-flow__minimap-mask", "fill"),
        // the isometric background's lines (slice 2 replaced the dot and line patterns)
        line: css("[data-iso-grid] path", "stroke"),
      };
    });
    expect(got, theme).toEqual(want);
    for (const k of ["edge", "mask", "line"] as const) seen[k].push(want[k]);

    // The export's background is the theme's --sf-bg (an SVG made by html-to-image).
    await page.getByTitle("Export design (Ctrl+E)").click();
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export as SVG" }).click();
    const svg = readFileSync(await (await downloaded).path(), "utf8").toLowerCase();
    const bg = await rootVar(page, "--sf-bg");
    const rgb = await computedColor(page, bg);
    expect(
      svg.includes(bg.toLowerCase()) || svg.includes(rgb.toLowerCase()),
      `${theme} svg bg`,
    ).toBe(true);
    seen.bg.push(bg);
  }
  // Switching theme changed every one of them, with no reload.
  for (const [k, [light, dark]] of Object.entries(seen)) expect(light, k).not.toBe(dark);
});

/** The minimap is off on a fresh load (slice 3): show it through its toggle, as a user would. */
async function showMinimap(page: Page) {
  await page.getByRole("button", { name: "Show minimap" }).click();
  await expect(page.locator(".react-flow__minimap")).toBeVisible();
}

/** Open the app in light on a wide screen with the reference loaded and the minimap shown. */
async function openReference(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, "/");
  await stylesApplied(page);
  await setTheme(page, "light");
  await page.getByTitle("Load reference solution").click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await showMinimap(page);
}

/** Play the reference's live traffic from the Simulate tab; returns the panel. */
async function playLive(page: Page) {
  await openTab(page, "Simulate");
  const panel = page.getByRole("region", { name: "Live traffic" });
  await panel.getByRole("button", { name: "Play live traffic" }).click();
  await expect(panel.getByRole("button", { name: "Pause live traffic" })).toBeVisible();
  return panel;
}

/** The `--sf-bg` the particle overlay says its last frame was drawn in (hex, normalized). */
async function overlayBg(page: Page) {
  return hex((await page.getByTestId("flow-particles").getAttribute("data-theme-bg")) ?? "");
}

/** Let frames, observers and timers settle (paused: nothing should be left to draw). */
function settle(page: Page, ms = 300) {
  return page.evaluate(
    (t) =>
      new Promise<void>((done) =>
        setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => done())), t),
      ),
    ms,
  );
}

/** A live run, paused, its last frame drawn in the light theme. */
async function pausedInLight(page: Page) {
  const panel = await playLive(page);
  const light = await rootVar(page, "--sf-bg");
  await expect.poll(() => overlayBg(page)).toBe(light);
  await panel.getByRole("button", { name: "Pause live traffic" }).click();
  await expect(panel.getByRole("button", { name: "Play live traffic" })).toBeVisible();
  await settle(page);
  return light;
}

test("particle overlay: a theme switch redraws a paused frame in the new colors", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(60_000);
  await openReference(page);
  const light = await pausedInLight(page);

  // Paused, so only the theme watcher can ask for another frame.
  await setTheme(page, "dark");
  const dark = await rootVar(page, "--sf-bg");
  expect(dark).not.toBe(light);
  await expect.poll(() => overlayBg(page)).toBe(dark);
  await setTheme(page, "light");
  await expect.poll(() => overlayBg(page)).toBe(light);
});

test("particle overlay: once torn down it stops watching the theme", async ({ page }, testInfo) => {
  testInfo.setTimeout(60_000);
  await openReference(page);
  const light = await pausedInLight(page);

  // Reduced motion tears the overlay's effect down (and draws nothing from then on).
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByTestId("flow-particles")).toHaveAttribute("data-reduced-motion", "true");
  await settle(page);
  await setTheme(page, "dark");
  await settle(page);
  expect(await overlayBg(page)).toBe(light);
});

test("minimap: nodes are muted before a run and take their status color during one", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(60_000);
  await openReference(page);
  const fills = () =>
    page
      .locator(".react-flow__minimap-node")
      .evaluateAll((rects) => rects.map((r) => getComputedStyle(r).fill));
  const muted = await computedColor(page, "var(--sf-muted)");
  const ok = await computedColor(page, "var(--sf-ok)");
  expect(muted).not.toBe(ok);

  await expect.poll(async () => (await fills()).length).toBeGreaterThan(0);
  expect((await fills()).every((f) => f === muted)).toBe(true);

  await playLive(page);
  await expect
    .poll(async () => (await fills()).some((f) => f === ok), {
      timeout: 20_000,
    })
    .toBe(true);
  expect((await fills()).every((f) => f !== muted)).toBe(true);
});

test("flow tab: the highlighted edge is traced in the request color of the theme", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(60_000);
  await openReference(page);
  await openTab(page, "Flow");
  const panel = page.getByTestId("flow-panel");
  await expect(panel.locator("[data-arrow]").first()).toBeVisible({
    timeout: 20_000,
  });
  for (const theme of THEMES) {
    await setTheme(page, theme);
    const want = await computedColor(page, "var(--sf-req)");
    await panel.locator('[data-arrow="call"]').first().hover();
    const edge = page.locator('.react-flow__edge [data-edge-highlight="req"]');
    await expect(edge).toHaveCount(1);
    const got = await edge.evaluate((g) => ({
      stroke: getComputedStyle(g.querySelector("path[stroke-dasharray]")!).stroke,
      arrow: getComputedStyle(g.querySelector('marker[id^="flow-hl-"] path')!).fill,
    }));
    expect(got, theme).toEqual({ stroke: want, arrow: want });
  }
});

/** How the browser computes a CSS property set to a value (a `var()` becomes its resolved form). */
function computedProp(page: Page, prop: "boxShadow" | "borderTopColor", value: string) {
  return page.evaluate(
    ([p, v]) => {
      const probe = document.createElement("span");
      probe.style.setProperty(p === "boxShadow" ? "box-shadow" : "border-top-color", v);
      if (p === "borderTopColor") probe.style.borderTopStyle = "solid";
      document.body.appendChild(probe);
      const out = getComputedStyle(probe)[p as "boxShadow" | "borderTopColor"];
      probe.remove();
      return out;
    },
    [prop, value] as const,
  );
}

/** Every edge's line stroke and arrowhead fill, with the runtime state its group reports. */
function readEdges(page: Page) {
  return page.locator(".react-flow__edge").evaluateAll((els) =>
    els.map((el) => {
      const g = el.querySelector("g");
      const line = el.querySelector("path.react-flow__edge-path")!;
      const head = el.querySelector("marker path")!;
      return {
        id: el.getAttribute("data-id") ?? "",
        ret: (el.getAttribute("data-id") ?? "").startsWith("ret:"),
        status: g?.getAttribute("data-edge-status") ?? null,
        rps: Number(g?.getAttribute("data-edge-rps") ?? 0),
        stroke: getComputedStyle(line).stroke,
        fill: getComputedStyle(head).fill,
      };
    }),
  );
}

test("edges: idle lines and their arrowheads, requests and responses alike, are the idle color", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(60_000);
  await openReference(page);
  for (const theme of THEMES) {
    await setTheme(page, theme);
    const idle = await computedColor(page, "var(--edge-idle)");
    const edges = await readEdges(page);
    expect(edges.some((e) => e.ret)).toBe(true);
    expect(edges.some((e) => !e.ret)).toBe(true);
    for (const e of edges) {
      expect({ stroke: e.stroke, fill: e.fill }, `${theme} ${e.id}`).toEqual({
        stroke: idle,
        fill: idle,
      });
    }
  }
});

test("edges: during a run each line and its arrowhead take the color of its status", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(60_000);
  await openReference(page);
  const want: Record<string, string> = {
    ok: await computedColor(page, "var(--sf-req)"),
    slow: await computedColor(page, "var(--sf-slow)"),
    error: await computedColor(page, "var(--sf-err)"),
  };
  const idle = await computedColor(page, "var(--edge-idle)");
  await playLive(page);

  // Requests (with load) are in the color of their status; so is a response, or idle when
  // nothing comes back; an arrowhead is the color of its line. Both kinds must have been seen.
  await expect
    .poll(
      async () => {
        const edges = await readEdges(page);
        let requests = 0;
        let responses = 0;
        for (const e of edges) {
          if (e.fill !== e.stroke) return `${e.id}: head ${e.fill} is not its line ${e.stroke}`;
          const color = e.status ? want[e.status] : idle;
          if (!e.ret && e.rps > 0) {
            if (e.stroke !== color) return `${e.id}: ${e.status} line is ${e.stroke}`;
            requests++;
          }
          if (e.ret && e.stroke !== idle) {
            if (e.stroke !== color) return `${e.id}: ${e.status} response is ${e.stroke}`;
            responses++;
          }
        }
        return requests > 0 && responses > 0
          ? "ok"
          : `requests ${requests}, responses ${responses}`;
      },
      { timeout: 30_000 },
    )
    .toBe("ok");
});

/** Kill App Server from its context menu, in a live run of the reference. */
async function killAppServer(page: Page) {
  await openReference(page);
  await playLive(page);
  const app = page.locator(".react-flow__node").filter({ hasText: "App Server" }).first();
  await app.click({ button: "right" });
  await page.getByRole("menuitem", { name: /Kill node/ }).click();
  await expect(page.locator('[data-blast="target"]')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator('[data-blast="affected"]').first()).toBeVisible();
}

test("blast radius: the target, the affected nodes and their edges are outlined in the err color", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(60_000);
  await killAppServer(page);
  const err = await computedColor(page, "var(--sf-err)");
  const outline = (kind: "target" | "affected") =>
    page
      .locator(`[data-blast="${kind}"] > div[aria-hidden]`)
      .first()
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return { color: s.borderTopColor, style: s.borderTopStyle };
      });
  expect(await outline("target")).toEqual({ color: err, style: "dashed" });
  expect(await outline("affected")).toEqual({ color: err, style: "solid" });

  const edge = await page
    .locator("g[data-edge-blast] > path[aria-hidden]")
    .first()
    .evaluate((p) => getComputedStyle(p).stroke);
  expect(edge).toBe(err);
});

test("flow overlay legend: the response ring symbol is the response color in both themes", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(60_000);
  await openReference(page);
  await playLive(page);
  const legend = page.getByTestId("ball-legend");
  await expect(legend).toBeVisible({ timeout: 20_000 });
  for (const theme of THEMES) {
    await setTheme(page, theme);
    const want = await computedColor(page, "var(--sf-resp)");
    await expect(legend.locator("span[style]")).toHaveText("○");
    expect(
      await legend.locator("span[style]").evaluate((el) => getComputedStyle(el).color),
      theme,
    ).toBe(want);
  }
});

test("shadows: the node's ground shadow, the empty state's and the accent card's glow follow their tokens", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, "/");
  await stylesApplied(page);
  for (const theme of THEMES) {
    await setTheme(page, theme);
    const hero = page
      .getByRole("heading", { name: "Build an architecture that scales" })
      .locator("xpath=../preceding-sibling::*[1]");
    await expect(hero).toBeVisible();
    expect(await hero.evaluate((el) => getComputedStyle(el).boxShadow), `${theme} hero glow`).toBe(
      await computedProp(page, "boxShadow", "0 0 40px -10px var(--sf-accent)"),
    );

    const card = page.getByRole("button", { name: /Practice interview/ });
    await card.hover();
    const glow = await computedProp(page, "boxShadow", "0 0 24px -8px var(--sf-accent)");
    await expect
      .poll(() => card.evaluate((el) => getComputedStyle(el).boxShadow), {
        message: theme,
      })
      .toBe(glow);
    await page.mouse.move(0, 0);
  }

  await page.getByTitle("Load reference solution").click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  // A node has no card, so no box shadow: its shadow is the model's hard ground shadow, `--iso-shadow`.
  for (const theme of THEMES) {
    await setTheme(page, theme);
    const want = await computedColor(page, "var(--iso-shadow)");
    const own = await page
      .locator(".react-flow__node-component svg[data-iso-kind] > polygon")
      .first()
      .evaluate((el) => getComputedStyle(el).fill);
    expect(own, `${theme} node ground shadow`).toBe(want);
  }
});

test.describe("default theme", () => {
  test("a fresh visitor opens in light, with no flash of dark and the light theme-color", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        (window as unknown as { __darkAtDCL: boolean }).__darkAtDCL =
          document.documentElement.classList.contains("dark");
      });
    });
    await page.goto("/");
    await expect(page.getByRole("button", { name: TOGGLE })).toBeVisible();
    expect(
      await page.evaluate(() => (window as unknown as { __darkAtDCL: boolean }).__darkAtDCL),
    ).toBe(false);
    expect(await isDark(page)).toBe(false);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#EEE8DF");
    await stylesApplied(page);
    expect(await rootVar(page, "--sf-bg")).toBe("#eee8df");

    // The toggle switches every token to dark and back.
    await page.getByRole("button", { name: TOGGLE }).click();
    await expect.poll(() => isDark(page)).toBe(true);
    for (const [name, value] of Object.entries(EXPECTED_TOKENS.dark)) {
      expect(await rootVar(page, name), name).toBe(hex(value));
    }

    // The choice survives a reload, dark from the first paint.
    await page.reload();
    await expect(page.getByRole("button", { name: TOGGLE })).toBeVisible();
    expect(await isDark(page)).toBe(true);

    await page.getByRole("button", { name: TOGGLE }).click();
    await expect.poll(() => isDark(page)).toBe(false);
    for (const [name, value] of Object.entries(EXPECTED_TOKENS.light)) {
      expect(await rootVar(page, name), name).toBe(hex(value));
    }
    await page.reload();
    await expect(page.getByRole("button", { name: TOGGLE })).toBeVisible();
    expect(await isDark(page)).toBe(false);
    await context.close();
  });
});

// Papel quente slice 2 (criteria 10, 12, 13, 14, 16, 17): the isometric models, the status halo,
// the selected ring, the fixed 160 x 120 box, the rest/hover details, the background and the
// palette's chips.

type RuntimeHandle = { getState(): { pushSnapshot(s: unknown): void } };

/** One snapshot: each node id gets the base metrics plus its own fields (no entry, no snapshot for it). */
function pushNodes(page: Page, nodes: Record<string, Record<string, unknown>>) {
  return page.evaluate((extra) => {
    const store = (window as unknown as { __runtimeStore: RuntimeHandle }).__runtimeStore;
    const base = {
      rpsIn: 1234,
      rpsOut: 1234,
      utilization: 0.634,
      queueDepth: 0,
      p50: 5,
      p95: 9,
      p99: 12.4,
      errorRate: 0,
      drops: 0,
      status: "ok",
    };
    const metrics: Record<string, unknown> = {};
    for (const [id, fields] of Object.entries(extra)) metrics[id] = { ...base, ...fields };
    store.getState().pushSnapshot({
      t: 0,
      offeredRps: 1000,
      nodes: metrics,
      edges: {},
      global: {
        throughput: 1000,
        goodput: 1000,
        errorRate: 0,
        p50: 5,
        p95: 9,
        p99: 12,
        availability: 1,
      },
    });
  }, nodes);
}

/** The React Flow node of a component id (node ids start with it). */
const nodeOf = (page: Page, componentId: string) =>
  page.locator(`.react-flow__node[data-id^="${componentId}-"]`);

type NodeLocator = ReturnType<typeof nodeOf>;

/** The node's id, from its data-id. */
async function idOf(node: NodeLocator) {
  return (await node.getAttribute("data-id"))!;
}

/** A node's measured layout size (unscaled by the viewport zoom). */
function sizeOf(node: NodeLocator) {
  return node.evaluate((el) => ({
    width: (el as HTMLElement).offsetWidth,
    height: (el as HTMLElement).offsetHeight,
  }));
}

/** Park the pointer over the top-left corner of the window, away from every node. */
const parkMouse = (page: Page) => page.mouse.move(2, 2);

/** Click the empty canvas to deselect everything (the pane fills the screen under the cards: find a free spot). */
const deselect = (page: Page) => clickEmptyPane(page);

const opacityOf = (el: NodeLocator) => el.evaluate((e) => getComputedStyle(e).opacity);

/** The three elements a node reveals on hover, focus and selection. */
function detailsOf(node: NodeLocator) {
  return {
    capacity: node.getByText(/k qps$/),
    tech: node.locator("[data-technology]"),
    metrics: node.getByTestId("node-metrics"),
  };
}

test("models: every catalog kind draws one svg of its archetype, tint and viewBox", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/");
  for (const c of SYSTEM_COMPONENTS) await quickAdd(page, c.label);
  const nodes = page.locator(".react-flow__node");
  await expect(nodes).toHaveCount(SYSTEM_COMPONENTS.length);

  const got = await nodes.evaluateAll((els) =>
    els.map((el) => {
      const svgs = el.querySelectorAll("svg[data-iso-kind]");
      const svg = svgs[0];
      return {
        id: el.getAttribute("data-id") ?? "",
        count: svgs.length,
        kind: svg?.getAttribute("data-iso-kind"),
        tint: svg?.getAttribute("data-iso-tint"),
        viewBox: svg?.getAttribute("viewBox"),
        markup: svg?.innerHTML ?? "",
      };
    }),
  );
  // A node id is the component id, a dash and a 36-character uuid
  const byComponent = new Map(got.map((g) => [g.id.slice(0, -37), g]));
  expect(byComponent.size).toBe(SYSTEM_COMPONENTS.length);
  for (const c of SYSTEM_COMPONENTS) {
    const g = byComponent.get(c.id)!;
    expect(g.count, `${c.id} svgs`).toBe(1);
    expect(g.kind, `${c.id} archetype`).toBe(isoArchetypeOf(c.id));
    expect(g.tint, `${c.id} tint`).toBe(isoTintOf(c.id, c.category));
    expect(g.viewBox, `${c.id} viewBox`).toBe("0 0 160 160");
  }
  // The catalog reaches all 15 archetypes, and kinds of one archetype share its markup only
  const kindsOfMarkup = new Map<string, Set<string>>();
  for (const g of got) {
    kindsOfMarkup.set(g.markup, (kindsOfMarkup.get(g.markup) ?? new Set()).add(g.kind!));
  }
  expect(new Set(got.map((g) => g.kind)).size).toBe(15);
  for (const kinds of kindsOfMarkup.values()) expect([...kinds], "shared markup").toHaveLength(1);
});

test("status halo: ok, slow and err in the status token, none without a snapshot", async ({
  page,
}) => {
  await open(page, "/?e2e=1");
  await stylesApplied(page);
  await quickAdd(page, "App Server");
  await quickAdd(page, "Cache / Redis");
  const app = nodeOf(page, "app-server");
  const cache = nodeOf(page, "cache");
  const appId = await idOf(app);

  // No snapshot: no halo
  await expect(app.locator("[data-iso-status]")).toHaveCount(0);
  await expect(cache.locator("[data-iso-status]")).toHaveCount(0);

  const cases = [
    { status: "ok", halo: "ok", token: "--sf-ok", label: "OK" },
    { status: "warn", halo: "slow", token: "--sf-slow", label: "Warning" },
    { status: "critical", halo: "err", token: "--sf-err", label: "Critical" },
    { status: "down", halo: "err", token: "--sf-err", label: "Down" },
  ];
  for (const theme of THEMES) {
    await setTheme(page, theme);
    for (const c of cases) {
      await pushNodes(page, { [appId]: { status: c.status } });
      const halo = app.locator("[data-iso-status]");
      await expect(halo, `${theme} ${c.status}`).toHaveAttribute("data-iso-status", c.halo);
      const want = await computedColor(page, `var(${c.token})`);
      expect(await halo.evaluate((g) => getComputedStyle(g).stroke), `${theme} ${c.status}`).toBe(
        want,
      );
      // Status stays color AND icon
      await expect(
        app.getByTestId("node-metrics").getByRole("img", { name: `Status: ${c.label}` }),
      ).toBeAttached();
      // A node the snapshot does not mention has no halo
      await expect(cache.locator("[data-iso-status]")).toHaveCount(0);
    }
  }
});

test("selected ring: dashed, in the accent color, only while selected", async ({ page }) => {
  await open(page, "/");
  await stylesApplied(page);
  await quickAdd(page, "App Server");
  await quickAdd(page, "Cache / Redis");
  const app = nodeOf(page, "app-server");
  const cache = nodeOf(page, "cache");
  await deselect(page);
  await expect(app.locator("[data-iso-selected]")).toHaveCount(0);

  for (const theme of THEMES) {
    await setTheme(page, theme);
    await app.click();
    const ring = app.locator("[data-iso-selected]");
    await expect(ring, theme).toHaveCount(1);
    await expect(app, theme).toHaveClass(/\bselected\b/);
    const style = await ring.evaluate((el) => {
      const s = getComputedStyle(el);
      return { stroke: s.stroke, dash: s.strokeDasharray };
    });
    expect(style.stroke, theme).toBe(await computedColor(page, "var(--sf-accent)"));
    expect(style.dash, theme).not.toBe("none");
    // The other node has none, and neither does this one once the selection moves
    await expect(cache.locator("[data-iso-selected]")).toHaveCount(0);
    await cache.click();
    await expect(app.locator("[data-iso-selected]")).toHaveCount(0);
    await expect(app).not.toHaveClass(/\bselected\b/);
    await expect(cache.locator("[data-iso-selected]")).toHaveCount(1);
  }
});

test("size: every node is 160 x 120 whatever its label, technology, instances, status, hover or selection", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/?e2e=1");
  const long = "Recommendation Feature Store Gateway Service Of Many Words";
  await openPalette(page);
  await page.getByRole("button", { name: "Create custom component" }).click();
  await page.getByPlaceholder("e.g. Vector Database").fill(long);
  await page.getByRole("button", { name: "Create Component" }).click();
  await quickAdd(page, long);
  await quickAdd(page, "NoSQL Database"); // carries a technology tag
  await quickAdd(page, "App Server");
  await quickAdd(page, "Client");

  const all = page.locator(".react-flow__node");
  const expectAllFixed = async (when: string) => {
    for (const el of await all.all()) {
      expect(await sizeOf(el), when).toEqual(DEFAULT_NODE_SIZE);
    }
  };
  await expect(all).toHaveCount(4);
  expect(DEFAULT_NODE_SIZE).toEqual({ width: 160, height: 120 });
  await expectAllFixed("at rest");

  const app = nodeOf(page, "app-server");
  const nosql = nodeOf(page, "nosql-db");
  // Instances: a x6 button
  await app.click();
  for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "Add replica" }).click();
  await expect(app.getByRole("button", { name: "Show the 6 instances" })).toBeVisible();
  await expectAllFixed("with instances");

  // Status: a snapshot with every status and the metrics badge
  const ids = await Promise.all((await all.all()).map((el) => idOf(el)));
  const statuses = ["ok", "warn", "critical", "down"];
  await pushNodes(
    page,
    Object.fromEntries(ids.map((id, i) => [id, { status: statuses[i % 4], p99: 123456 }])),
  );
  await expect(app.getByTestId("node-metrics")).toBeAttached();
  await expectAllFixed("with status");

  // Hover and selection (reveal the details, which overflow the box)
  await nosql.hover();
  await expect.poll(() => opacityOf(detailsOf(nosql).metrics)).toBe("1");
  await expectAllFixed("hovered");
  await nosql.click();
  await parkMouse(page);
  await expectAllFixed("selected");
  // The node wrapper's rendered box is the same one
  const box = (await nosql.boundingBox())!;
  const scale = await page
    .locator(".react-flow__viewport")
    .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
  expect(box.width / scale).toBeCloseTo(160, 0);
  expect(box.height / scale).toBeCloseTo(120, 0);
});

test("rest and hover: headline per archetype; capacity, tag and badge fade in on hover, focus and selection", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/?e2e=1");
  await quickAdd(page, "App Server");
  await quickAdd(page, "NoSQL Database");
  await quickAdd(page, "Client");
  const app = nodeOf(page, "app-server");
  const db = nodeOf(page, "nosql-db");
  const client = nodeOf(page, "client");
  const headline = (n: NodeLocator) => n.locator("[data-node-headline]");

  // Without a snapshot the headline row exists and is empty
  for (const n of [app, db, client]) await expect(headline(n)).toHaveText("");
  await expect(headline(app)).toHaveAttribute("data-node-headline", "p99");
  await expect(headline(db)).toHaveAttribute("data-node-headline", "utilization");
  await expect(headline(client)).toHaveAttribute("data-node-headline", "rpsIn");

  await pushNodes(page, {
    [await idOf(app)]: {},
    [await idOf(db)]: {},
    [await idOf(client)]: {},
  });
  await expect(headline(app)).toHaveText("p99 12 ms");
  await expect(headline(db)).toHaveText("util 63%");
  await expect(headline(client)).toHaveText("1.2K/s");

  // At rest the three details are in the DOM with opacity 0
  await deselect(page);
  await parkMouse(page);
  const d = detailsOf(db);
  const keys = ["capacity", "tech", "metrics"] as const;
  for (const k of keys) {
    await expect(d[k], k).toHaveCount(1);
    await expect.poll(() => opacityOf(d[k]), { message: `${k} at rest` }).toBe("0");
  }
  // The name pill and the headline stay visible at rest
  await expect(db.getByText("NoSQL Database", { exact: true })).toHaveCSS("opacity", "1");
  await expect(headline(db)).toHaveCSS("opacity", "1");

  // Hover reveals them, leaving hides them again
  await db.hover();
  for (const k of keys) {
    await expect.poll(() => opacityOf(d[k]), { message: `${k} hovered` }).toBe("1");
  }
  await parkMouse(page);
  for (const k of keys) {
    await expect.poll(() => opacityOf(d[k]), { message: `${k} left` }).toBe("0");
  }

  // Selection reveals them with the pointer away
  await db.click();
  await parkMouse(page);
  for (const k of keys) {
    await expect.poll(() => opacityOf(d[k]), { message: `${k} selected` }).toBe("1");
  }

  // Focus within reveals them too: the x2 button of a node with replicas
  await deselect(page); // the selected node's insight card would cover the next one
  await app.click();
  await page.getByRole("button", { name: "Add replica" }).click();
  await deselect(page);
  await parkMouse(page);
  const da = detailsOf(app);
  await expect.poll(() => opacityOf(da.metrics)).toBe("0");
  await app.getByRole("button", { name: "Show the 2 instances" }).focus();
  await expect.poll(() => opacityOf(da.metrics), { message: "focus-within" }).toBe("1");
  await expect.poll(() => opacityOf(da.capacity), { message: "focus-within" }).toBe("1");
});

test.describe("coarse pointer", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: true });

  test("only selection reveals the details", async ({ page }) => {
    await open(page, "/?e2e=1");
    // hasTouch makes Chromium report a coarse primary pointer
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    await quickAdd(page, "NoSQL Database");
    const db = nodeOf(page, "nosql-db");
    await pushNodes(page, { [await idOf(db)]: {} });
    await deselect(page);
    await parkMouse(page);
    const d = detailsOf(db);
    const keys = ["capacity", "tech", "metrics"] as const;
    for (const k of keys) {
      await expect.poll(() => opacityOf(d[k]), { message: `${k} at rest` }).toBe("0");
    }
    // A mouse over the node (hover) does not reveal on a coarse pointer
    await db.hover();
    await page.waitForTimeout(400);
    for (const k of keys) {
      expect(await opacityOf(d[k]), `${k} hovered`).toBe("0");
    }
    // A tap selects it, and selection reveals them
    await db.tap();
    await expect(db).toHaveClass(/\bselected\b/);
    for (const k of keys) {
      await expect.poll(() => opacityOf(d[k]), { message: `${k} selected` }).toBe("1");
    }
  });
});

test("custom node: double-click renames it, and the box stays 160 x 120", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(60_000);
  await open(page, "/");
  await quickAdd(page, "Custom Component");
  const node = nodeOf(page, "custom");
  await expect(node.locator("svg[data-iso-kind]")).toHaveAttribute("data-iso-kind", "api");
  await node.getByText("Custom Component", { exact: true }).dblclick();
  const input = node.locator("input");
  await expect(input).toBeFocused();
  await input.fill("Embeddings Store");
  await input.press("Enter");
  await expect(node.getByText("Embeddings Store", { exact: true })).toBeVisible();
  await expect(input).toHaveCount(0);
  expect(await sizeOf(node)).toEqual(DEFAULT_NODE_SIZE);
});

test("handles: at the slab's mid-height, and the connect helper still links two nodes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/");
  await quickAdd(page, "Client");
  await quickAdd(page, "App Server");
  const client = nodeOf(page, "client");
  const box = (await client.boundingBox())!;
  const source = (await client.locator(".source:not([data-return-handle])").boundingBox())!;
  const target = (await client.locator(".target:not([data-return-handle])").boundingBox())!;
  // Right and left of the box, at about the model's slab (54% of the height)
  for (const [h, side] of [
    [source, "right"],
    [target, "left"],
  ] as const) {
    const cy = (h.y + h.height / 2 - box.y) / box.height;
    expect(cy, `${side} handle height`).toBeGreaterThan(0.5);
    expect(cy, `${side} handle height`).toBeLessThan(0.6);
  }
  await connect(page, "client", "app-server");
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
});

test("palette chips: each item's chip is its family's tint, from the same table as the nodes", async ({
  page,
}) => {
  await open(page, "/");
  await stylesApplied(page);
  await openPalette(page);
  for (const theme of THEMES) {
    await setTheme(page, theme);
    for (const c of ["sql-db", "app-server", "cache", "message-queue", "load-balancer"]) {
      const comp = SYSTEM_COMPONENTS.find((s) => s.id === c)!;
      const tint = isoTintOf(comp.id, comp.category);
      const chip = page.locator(`[data-palette-item="${c}"] [data-palette-tint]`);
      await expect(chip, `${theme} ${c}`).toHaveAttribute("data-palette-tint", tint);
      expect(await chip.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
        await computedColor(page, `var(--sf-cat-${tint})`),
      );
    }
  }
});

test("background: lines at 30 and 150 degrees, 26 px, in --grid-line; nodes still snap to 16 px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/");
  await stylesApplied(page);
  await quickAdd(page, "App Server");

  const grid = await page.locator("[data-iso-grid]").evaluate((svg) => {
    const pattern = svg.querySelector("pattern")!;
    const path = svg.querySelector("path")!;
    const zoom = new DOMMatrix(
      getComputedStyle(document.querySelector(".react-flow__viewport")!).transform,
    ).a;
    return {
      w: Number(pattern.getAttribute("width")),
      h: Number(pattern.getAttribute("height")),
      d: path.getAttribute("d")!,
      zoom,
    };
  });
  // Two lines per tile: (0,0)-(w,h) and (0,h)-(w,0), each at atan(h / w) = 30 degrees to the horizontal
  expect(grid.h / grid.zoom).toBeCloseTo(26, 3);
  expect((Math.atan2(grid.h, grid.w) * 180) / Math.PI).toBeCloseTo(30, 3);
  const nums = grid.d.match(/-?[\d.]+/g)!.map(Number);
  expect(nums).toHaveLength(8);
  expect(nums[2]).toBeCloseTo(grid.w, 3);
  expect(nums[3]).toBeCloseTo(grid.h, 3);
  for (const theme of THEMES) {
    await setTheme(page, theme);
    expect(
      await page.locator("[data-iso-grid] path").evaluate((p) => getComputedStyle(p).stroke),
    ).toBe(await computedColor(page, "var(--grid-line)"));
  }

  // The pattern is decorative: a dragged node lands on the 16 px snap grid
  const node = nodeOf(page, "app-server");
  const c = await center(node);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 41, c.y + 27, { steps: 6 });
  await page.mouse.up();
  const pos = await node.evaluate((el) => {
    const m = (el as HTMLElement).style.transform.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/)!;
    return { x: Number(m[1]), y: Number(m[2]) };
  });
  expect(pos.x % 16, "x on the 16 px grid").toBe(0);
  expect(pos.y % 16, "y on the 16 px grid").toBe(0);
});

const TAP_ADD_COUNT = 16;
const TAP_ADD_LABELS = [
  "App Server",
  "Cache / Redis",
  "SQL Database",
  "Load Balancer",
  "Auth Service",
];

/** Every node (and its handles) is clear of the minimap, the zoom controls and the floating cards, and of each other. */
async function expectClearOfOverlays(page: Page) {
  await expect(page.locator(".react-flow__node")).toHaveCount(TAP_ADD_COUNT);

  const boxes = await page.evaluate(() => {
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const overlay = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? rect(el) : null;
    };
    return {
      minimap: overlay(".react-flow__minimap"),
      controls: overlay(".react-flow__controls"),
      cards: [...document.querySelectorAll("[data-stage-card]")]
        .filter((c) => c.getBoundingClientRect().width > 0)
        .map((c) => [c.getAttribute("data-testid")!, rect(c)] as const),
      nodes: [...document.querySelectorAll(".react-flow__node")].map((n) => ({
        node: rect(n),
        handles: [...n.querySelectorAll(".react-flow__handle")].map(rect),
      })),
    };
  });
  expect(boxes.minimap, "the minimap is on screen").not.toBeNull();
  expect(boxes.controls, "the zoom controls are on screen").not.toBeNull();

  type Box = { left: number; top: number; right: number; bottom: number };
  const hit = (a: Box, b: Box) =>
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  boxes.nodes.forEach(({ node, handles }, i) => {
    for (const [name, overlay] of [
      ["minimap", boxes.minimap!],
      ["controls", boxes.controls!],
      // the floating cards of the stage layout: a node under one is hidden by it
      ...boxes.cards,
    ] as const) {
      expect(hit(node, overlay), `node ${i} under the ${name}`).toBe(false);
      handles.forEach((h, k) =>
        expect(hit(h, overlay), `node ${i} handle ${k} under the ${name}`).toBe(false),
      );
    }
    boxes.nodes.slice(i + 1).forEach((other, j) => {
      expect(hit(node, other.node), `node ${i} on node ${i + 1 + j}`).toBe(false);
    });
  });
}

test("tap-add: sixteen nodes at 1280 x 720 never land under the minimap or the zoom controls, nor on each other", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await open(page, "/");
  await stylesApplied(page);
  await showMinimap(page);
  for (let i = 0; i < TAP_ADD_COUNT; i++) await quickAdd(page, TAP_ADD_LABELS[i % 5]);
  await expectClearOfOverlays(page);
});

test("tap-add through the command palette: sixteen nodes at 1280 x 720 stay clear of the overlays", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await open(page, "/");
  await stylesApplied(page);
  await showMinimap(page);
  const palette = page.getByRole("dialog", { name: "Command palette" });
  for (let i = 0; i < TAP_ADD_COUNT; i++) {
    await page.keyboard.press(`${MOD}+k`);
    await palette
      .getByPlaceholder("Search problems, components, actions…")
      .fill(TAP_ADD_LABELS[i % 5]);
    await page.keyboard.press("Enter");
    await expect(palette).toHaveCount(0);
    await expect(page.locator(".react-flow__node")).toHaveCount(i + 1);
  }
  await expectClearOfOverlays(page);
});

test("tap-add through the top bar's Add Note: sixteen notes at 1280 x 720 stay clear of the overlays", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await open(page, "/");
  await stylesApplied(page);
  await showMinimap(page);
  for (let i = 0; i < TAP_ADD_COUNT; i++) {
    await page.getByRole("button", { name: "Add Note" }).click();
    await expect(page.locator(".react-flow__node")).toHaveCount(i + 1);
  }
  await expectClearOfOverlays(page);
});

// ---------------------------------------------------------------------------------------------
// Slice 4, the dock (criteria 28, 29, 30, 31, 33 press and +1, 36). The geometry of the dock (a box
// inside the canvas, 14 px radius, 1.5 px border, scrolling at 1024, clear of the timeline) is in
// stage.spec.ts and stage-minimap.spec.ts.
// ---------------------------------------------------------------------------------------------

const DOCK_TILES = [
  ["client", "Client"],
  ["cdn", "CDN"],
  ["load-balancer", "Load Balancer"],
  ["app-server", "App Server"],
  ["cache", "Cache / Redis"],
  ["sql-db", "SQL Database"],
  ["read-replica", "Read Replica"],
  ["message-queue", "Message Queue"],
] as const;

/** Half a cell of the canvas's 16 px snap grid: how far a dropped node's center is from the pointer, at most. */
const SNAP = 8;

const dockOf = (page: Page) => page.getByTestId("stage-dock");
const tileOf = (page: Page, label: string) =>
  dockOf(page).getByRole("button", {
    name: `Add ${label} to canvas`,
    exact: true,
  });
const allNodes = (page: Page) => page.locator(".react-flow__node");
const announcer = (page: Page) => page.getByTestId("add-announcer");
const allComponents = (page: Page) =>
  page.getByRole("button", { name: "All components", exact: true });

async function openDesign(page: Page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await open(page, "/");
  await stylesApplied(page);
  await expect(dockOf(page)).toBeVisible();
}

/** Wait for the viewport to stop moving: the first node of a canvas fits the view (300 ms). */
async function settled(page: Page) {
  const read = () =>
    page.locator(".react-flow__viewport").evaluate((el) => (el as HTMLElement).style.transform);
  let last = await read();
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(150);
    const now = await read();
    if (now === last) return;
    last = now;
  }
  throw new Error("the viewport never settled");
}

/** A mouse drag with the moves dnd-kit needs (it starts after 6 px); `hold` leaves the button down. */
async function dragTo(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  hold = false,
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y - 10, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 10 });
  if (!hold) await page.mouse.up();
}

/**
 * A spot on the empty canvas, clear of every card and of the first node (which sits at the visible
 * center): the center of what the rail, the panel, the top bar and the dock leave, moved by dx, dy.
 */
async function freeSpot(page: Page, dx = 260, dy = -100) {
  return page.evaluate(
    ([ox, oy]) => {
      const rect = (id: string) => {
        const r = document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
        return r && r.width > 0 ? r : null;
      };
      const flow = document.querySelector(".react-flow")!.getBoundingClientRect();
      const left = rect("stage-rail")?.right ?? flow.left;
      const right = rect("stage-panel")?.left ?? flow.right;
      const top = rect("stage-topbar")?.bottom ?? flow.top;
      const bottom = rect("stage-dock")?.top ?? flow.bottom;
      return { x: (left + right) / 2 + ox, y: (top + bottom) / 2 + oy };
    },
    [dx, dy],
  );
}

test("dock (28): a toolbar named Components with the eight tiles in order, each a model, a name and a button", async ({
  page,
}) => {
  await openDesign(page);
  const toolbar = page.getByRole("toolbar", { name: "Components" });
  await expect(toolbar).toBeVisible();
  expect(await toolbar.getAttribute("data-testid")).toBe("stage-dock");

  const tiles = toolbar.locator("[data-palette-item]");
  await expect(tiles).toHaveCount(8);
  await expect(tiles).toHaveText(DOCK_TILES.map(([, label]) => label));
  for (const [i, [id, label]] of DOCK_TILES.entries()) {
    const tile = tiles.nth(i);
    await expect(tile, id).toHaveAttribute("data-palette-item", id);
    // a button named "Add {label} to canvas", showing the kind's isometric model
    await expect(tileOf(page, label), id).toHaveCount(1);
    await expect(tile.locator(`svg[data-iso-kind="${isoArchetypeOf(id)}"]`), id).toHaveCount(1);
  }
  // After the tiles, the All components button
  const all = allComponents(page);
  await expect(all).toHaveAttribute("aria-expanded", "false");
  const lastTile = (await tiles.nth(7).boundingBox())!;
  expect((await all.boundingBox())!.x).toBeGreaterThan(lastTile.x + lastTile.width - 1);
});

test("dock (28): All components opens the panel with the palette and its search; the button, Escape and a drag from it close it", async ({
  page,
}) => {
  await openDesign(page);
  const panel = page.getByTestId("stage-dock-panel");
  const all = allComponents(page);
  const search = page.getByPlaceholder("Search components...");

  // Mounted while closed, its items hidden
  await expect(panel).toHaveCount(1);
  await expect(panel).toBeHidden();
  await expect(panel).toHaveAttribute("inert", "");
  await expect(panel).toHaveAttribute("aria-hidden", "true");
  await expect(search).toBeHidden();
  await expect(panel.locator('[data-palette-item="sql-db"]')).toBeHidden();

  await all.click();
  await expect(all).toHaveAttribute("aria-expanded", "true");
  await expect(panel).toBeVisible();
  await expect(panel).not.toHaveAttribute("inert");
  await expect(panel).not.toHaveAttribute("aria-hidden");
  await expect(search).toBeVisible();
  await expect(panel.locator('[data-palette-item="sql-db"]')).toBeVisible();
  // it floats over the canvas above the dock
  const p = (await panel.boundingBox())!;
  const d = (await dockOf(page).boundingBox())!;
  expect(p.y + p.height).toBeLessThanOrEqual(d.y);
  // the search keeps working
  await search.fill("kafka");
  await expect(panel.locator('[data-palette-item="message-queue:kafka"]')).toBeVisible();
  await search.fill("");

  // the button closes it
  await all.click();
  await expect(all).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toBeHidden();

  // Escape closes it, with the focus in the search field or on the page
  await all.click();
  await expect(search).toBeVisible();
  await search.focus();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(all).toHaveAttribute("aria-expanded", "false");
  await all.click();
  await expect(panel).toBeVisible();
  await page.locator("body").press("Escape");
  await expect(panel).toBeHidden();

  // the start of a drag from it closes it (and the drop still adds the node)
  await all.click();
  const item = panel.locator('[data-palette-item="sql-db"]');
  await item.scrollIntoViewIfNeeded(); // the panel is a short card: the item may be below its edge
  const from = await center(item);
  await dragTo(page, from, await freeSpot(page), true);
  await expect(panel).toBeHidden();
  await expect(all).toHaveAttribute("aria-expanded", "false");
  await page.mouse.up();
  await expect(allNodes(page)).toHaveCount(1);
});

test("dock (29): a click on a tile adds one node and announces it; one Undo removes it", async ({
  page,
}) => {
  await openDesign(page);
  const live = announcer(page);
  await expect(live).toHaveAttribute("role", "status");
  await expect(live).toHaveAttribute("aria-live", "polite");
  await expect(live).toHaveText("");

  await tileOf(page, "App Server").click();
  await expect(allNodes(page)).toHaveCount(1);
  await expect(live).toHaveText("Added App Server");
  await expect(nodeOf(page, "app-server")).toHaveCount(1);

  await page.keyboard.press(`${MOD}+z`);
  await expect(allNodes(page)).toHaveCount(0);
});

test("dock (29): Enter and Space on a focused tile each add one node", async ({ page }) => {
  await openDesign(page);
  await tileOf(page, "Cache / Redis").focus();
  await page.keyboard.press("Enter");
  await expect(allNodes(page)).toHaveCount(1);
  await expect(announcer(page)).toHaveText("Added Cache / Redis");

  await tileOf(page, "SQL Database").focus();
  await page.keyboard.press("Space");
  await expect(allNodes(page)).toHaveCount(2);
  await expect(announcer(page)).toHaveText("Added SQL Database");
  await expect(nodeOf(page, "sql-db")).toHaveCount(1);

  // one Undo per add
  await page.keyboard.press(`${MOD}+z`);
  await expect(allNodes(page)).toHaveCount(1);
  await page.keyboard.press(`${MOD}+z`);
  await expect(allNodes(page)).toHaveCount(0);
});

test("dock (29): a tap on a palette row's add button goes the same way, announces too, and closes the panel", async ({
  page,
}) => {
  await openDesign(page);
  await allComponents(page).click();
  const panel = page.getByTestId("stage-dock-panel");
  await panel.getByRole("button", { name: "Add Auth Service to canvas" }).click();
  await expect(allNodes(page)).toHaveCount(1);
  await expect(announcer(page)).toHaveText("Added Auth Service");
  await expect(panel).toBeHidden();
  await page.keyboard.press(`${MOD}+z`);
  await expect(allNodes(page)).toHaveCount(0);
});

test("dock (30): dragging a tile adds one node centered under the pointer, announced; one Undo removes it", async ({
  page,
}) => {
  await openDesign(page);
  // the first node of an empty canvas fits the view: add one, let it settle, then drag
  await tileOf(page, "Client").click();
  await expect(allNodes(page)).toHaveCount(1);
  await settled(page);

  const to = await freeSpot(page);
  await dragTo(page, await center(tileOf(page, "Cache / Redis")), to);
  await expect(allNodes(page)).toHaveCount(2);
  await expect(announcer(page)).toHaveText("Added Cache / Redis");
  const dropped = await center(nodeOf(page, "cache"));
  // (the drop point snaps to the canvas's 16 px grid, so up to half a cell off)
  expect(Math.abs(dropped.x - to.x), "x under the pointer").toBeLessThanOrEqual(SNAP);
  expect(Math.abs(dropped.y - to.y), "y under the pointer").toBeLessThanOrEqual(SNAP);

  await page.keyboard.press(`${MOD}+z`);
  await expect(allNodes(page)).toHaveCount(1);
  await expect(nodeOf(page, "cache")).toHaveCount(0);
});

test("dock (29, 30): a tile starts a central type with its default technology, clicked or dragged, as the palette does", async ({
  page,
}) => {
  await openDesign(page);
  await tileOf(page, "Load Balancer").click();
  await expect(allNodes(page)).toHaveCount(1);
  await settled(page);
  await dragTo(page, await center(tileOf(page, "Load Balancer")), await freeSpot(page));
  await expect(allNodes(page)).toHaveCount(2);
  await expect(page.locator('.react-flow__node [data-technology="aws-alb"]')).toHaveCount(2);
});

test("dock (30): a palette item dragged from the panel goes the same way, and the panel closes", async ({
  page,
}) => {
  await openDesign(page);
  await tileOf(page, "Client").click();
  await expect(allNodes(page)).toHaveCount(1);
  await settled(page);

  await allComponents(page).click();
  const to = await freeSpot(page);
  const item = page.getByTestId("stage-dock-panel").locator('[data-palette-item="auth-service"]');
  await item.scrollIntoViewIfNeeded(); // the panel is a short card: the item may be below its edge
  await dragTo(page, await center(item), to);
  await expect(allNodes(page)).toHaveCount(2);
  await expect(announcer(page)).toHaveText("Added Auth Service");
  const dropped = await center(nodeOf(page, "auth-service"));
  expect(Math.abs(dropped.x - to.x)).toBeLessThanOrEqual(SNAP);
  expect(Math.abs(dropped.y - to.y)).toBeLessThanOrEqual(SNAP);
  await expect(page.getByTestId("stage-dock-panel")).toBeHidden();
  await page.keyboard.press(`${MOD}+z`);
  await expect(allNodes(page)).toHaveCount(1);
});

test("dock (30): a drop on a floating card, the dock included, adds nothing", async ({ page }) => {
  await openDesign(page);
  const tile = tileOf(page, "App Server");
  for (const id of ["stage-panel", "stage-topbar", "stage-rail", "stage-dock"]) {
    await dragTo(page, await center(tile), await center(page.getByTestId(id)));
    await page.waitForTimeout(100);
    await expect(allNodes(page), `a drop on ${id}`).toHaveCount(0);
  }
  await expect(announcer(page)).toHaveText("");
  // and the same drop on the free canvas does add
  await dragTo(page, await center(tile), await freeSpot(page));
  await expect(allNodes(page)).toHaveCount(1);
});

test("dock (31): a dragged tile is lifted, and the canvas is drop-active only over a place that takes the drop", async ({
  page,
}) => {
  await openDesign(page);
  const canvas = page.locator("[data-canvas-drop]");
  await expect(canvas).not.toHaveAttribute("data-drop-active", /.*/);
  await expect(page.locator("[data-drag-lift]")).toHaveCount(0);

  const free = await freeSpot(page);
  const panel = await center(page.getByTestId("stage-panel"));
  await dragTo(page, await center(tileOf(page, "Load Balancer")), free, true);

  // the model, lifted: scaled 1.06 with a ground shadow
  const lift = page.locator("[data-drag-lift]");
  await expect(lift).toBeVisible();
  await expect(lift.locator(`svg[data-iso-kind="${isoArchetypeOf("load-balancer")}"]`)).toHaveCount(
    1,
  );
  await expect(lift.locator("[data-drag-shadow]")).toHaveCount(1);
  const matrix = await lift.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform));
  expect(matrix.a).toBeCloseTo(1.06, 2);
  expect(matrix.d).toBeCloseTo(1.06, 2);
  await expect(canvas).toHaveAttribute("data-drop-active", "true");

  // over a floating card: not active
  await page.mouse.move(panel.x, panel.y, { steps: 5 });
  await expect(canvas).not.toHaveAttribute("data-drop-active", /.*/);
  // and active again over the free canvas
  await page.mouse.move(free.x, free.y, { steps: 5 });
  await expect(canvas).toHaveAttribute("data-drop-active", "true");

  await page.mouse.up();
  await expect(canvas).not.toHaveAttribute("data-drop-active", /.*/);
  await expect(page.locator("[data-drag-lift]")).toHaveCount(0);
  await expect(allNodes(page)).toHaveCount(1);
});

test("dock (33): a clicked tile is pressed and shows a +1 badge, both gone within a second", async ({
  page,
}) => {
  await openDesign(page);
  const tile = tileOf(page, "App Server");
  await expect(tile).not.toHaveAttribute("data-pressed", /.*/);
  await expect(tile.locator("[data-dock-plus]")).toHaveCount(0);

  // The click and both readings happen inside the page, so the dev server's slowness cannot eat
  // into the second the feedback has to be gone in.
  const seen = await tile.evaluate(async (el) => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
    const read = () => {
      const plus = el.querySelector("[data-dock-plus]");
      const model = el.querySelector("[data-dock-model]")!;
      const press = model
        .getAnimations()
        .find((a) => (a as CSSAnimation).animationName === "dock-press");
      const frames = (press?.effect as KeyframeEffect | undefined)?.getKeyframes() ?? [];
      return {
        pressed: el.hasAttribute("data-pressed"),
        plus: plus?.textContent ?? null,
        plusHidden: plus?.getAttribute("aria-hidden") ?? null,
        duration: press ? Number(press.effect?.getTiming().duration) : null,
        scales: frames.map((f) => String(f.transform)),
      };
    };
    (el as HTMLElement).click();
    await frame();
    await frame();
    const during = read();
    await new Promise((r) => setTimeout(r, 1000));
    return { during, after: read() };
  });
  expect(seen.during.pressed).toBe(true);
  expect(seen.during.plus).toBe("+1");
  expect(seen.during.plusHidden).toBe("true");
  // scale 0.92 and back, 300 ms
  expect(seen.during.duration).toBe(300);
  expect(seen.during.scales).toEqual(["scale(1)", "scale(0.92)", "scale(1)"]);
  // gone within a second
  expect(seen.after).toMatchObject({
    pressed: false,
    plus: null,
    duration: null,
  });

  // a second click plays it again
  await tile.click();
  await expect(tile.locator("[data-dock-plus]")).toHaveCount(1);
});

test("dock (33, 37): with reduced motion a click still adds and announces, with no press and no +1", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDesign(page);
  const tile = tileOf(page, "App Server");
  // (read in the page, a few frames after the click: the press and the +1 would last 900 ms)
  const feedback = await tile.evaluate(async (el) => {
    (el as HTMLElement).click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return {
      plus: el.querySelector("[data-dock-plus]") !== null,
      pressed: el.hasAttribute("data-pressed"),
      press: el.querySelector(".dock-press") !== null,
    };
  });
  expect(feedback).toEqual({ plus: false, pressed: false, press: false });
  await expect(allNodes(page)).toHaveCount(1);
  await expect(announcer(page)).toHaveText("Added App Server");
});

test("dock (36): on a reference tab the tiles are disabled, a click says it is read-only, a drag adds nothing", async ({
  page,
}) => {
  await openDesign(page);
  await page.getByTitle("Load reference solution").click();
  await expect(allNodes(page).first()).toBeVisible();
  await settled(page);
  const before = await allNodes(page).count();
  await expect(page.getByTestId("readonly-hint")).toBeVisible();

  for (const [, label] of DOCK_TILES) {
    await expect(tileOf(page, label), label).toHaveAttribute("aria-disabled", "true");
  }

  // a click: the toast, no node, no announcement, no press
  const tile = tileOf(page, "App Server");
  // (aria-disabled, not disabled: the click still lands, and says why nothing happens; Playwright
  // calls an aria-disabled button not enabled, so the click is forced)
  // (read in the page, a few frames after the click: the press and the +1 would last 900 ms)
  const feedback = await tile.evaluate(async (el) => {
    (el as HTMLElement).click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return {
      plus: el.querySelector("[data-dock-plus]") !== null,
      pressed: el.hasAttribute("data-pressed"),
    };
  });
  expect(feedback).toEqual({ plus: false, pressed: false });
  await expect(page.getByText("Reference tabs are read-only")).toBeVisible();
  await expect(allNodes(page)).toHaveCount(before);
  await expect(announcer(page)).toHaveText("");
  // Enter does the same
  await tile.focus();
  await page.keyboard.press("Enter");
  await expect(allNodes(page)).toHaveCount(before);

  // a drag: nothing is added, and the canvas is never drop-active
  const canvas = page.locator("[data-canvas-drop]");
  await dragTo(page, await center(tile), await freeSpot(page), true);
  await expect(canvas).not.toHaveAttribute("data-drop-active", /.*/);
  await page.mouse.up();
  await page.waitForTimeout(100);
  await expect(allNodes(page)).toHaveCount(before);
  await expect(announcer(page)).toHaveText("");
});

test("dock: a toast rides above the dock, so it never covers a tile", async ({ page }) => {
  await openDesign(page);
  await page.getByTitle("Load reference solution").click();
  await expect(allNodes(page).first()).toBeVisible();
  await tileOf(page, "App Server").click({ force: true });
  const toast = page.getByText("Reference tabs are read-only");
  await expect(toast).toBeVisible();
  // (past its 0.2 s entrance, which slides it up from below)
  await page.waitForTimeout(400);
  const t = (await toast.boundingBox())!;
  const d = (await dockOf(page).boundingBox())!;
  expect(t.y + t.height, "the toast ends above the dock").toBeLessThanOrEqual(d.y);
});

test("dock (36): the design tab's tiles are enabled again after a reference tab", async ({
  page,
}) => {
  await openDesign(page);
  await page.getByTitle("Load reference solution").click();
  await expect(tileOf(page, "App Server")).toHaveAttribute("aria-disabled", "true");
  await page.locator("[data-canvas-tabs]").getByText("My Design").click();
  await expect(tileOf(page, "App Server")).not.toHaveAttribute("aria-disabled", /.*/);
  await tileOf(page, "App Server").click();
  await expect(allNodes(page)).toHaveCount(1);
});

// ---------------------------------------------------------------------------------------------
// Slice 4, motion (criteria 32, 33 flash, 34, 35, 37). Every transient attribute is read inside the
// page, by a sampler that starts before the action: the dev server is too slow to catch a 600 ms
// landing from a Playwright poll.
// ---------------------------------------------------------------------------------------------

type MotionSample = {
  t: number;
  landing: boolean;
  ripple: boolean;
  flash: boolean;
  drawing: string[];
  size: { width: number; height: number } | null;
};
type MotionProbe = {
  /** Each edge that drew, by test id: its animation name, duration and the path's pathLength. */
  drawn: Record<string, string>;
  samples: MotionSample[];
  landing: {
    name: string;
    duration: string;
    easing: string;
    rippleName: string;
    ripplePosition: string;
  } | null;
};

/** Start sampling the page every frame: before the action. `stopMotion` ends it and returns what it saw. */
async function watchMotion(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __probe?: { done: boolean; result: Promise<MotionProbe> };
    };
    const probe = { done: false } as {
      done: boolean;
      result: Promise<MotionProbe>;
    };
    probe.result = new Promise<MotionProbe>((resolve) => {
      const t0 = performance.now();
      const samples: MotionSample[] = [];
      let landing: MotionProbe["landing"] = null;
      const drawn = new Map<string, string>();
      const frame = () => {
        const wrap = document.querySelector<HTMLElement>("[data-landing]");
        const ripple = document.querySelector<HTMLElement>("[data-landing-ripple]");
        const node = wrap?.closest<HTMLElement>(".react-flow__node");
        if (wrap && !landing) {
          const cs = getComputedStyle(wrap);
          landing = {
            name: cs.animationName,
            duration: cs.animationDuration,
            easing: cs.animationTimingFunction,
            rippleName: ripple ? getComputedStyle(ripple).animationName : "",
            ripplePosition: ripple ? getComputedStyle(ripple).position : "",
          };
        }
        samples.push({
          t: performance.now() - t0,
          landing: !!wrap,
          ripple: !!ripple,
          flash: !!document.querySelector("[data-testid=cost-mini][data-flash]"),
          drawing: [...document.querySelectorAll("path[data-drawing]")].map(
            (p) => p.closest(".react-flow__edge")?.getAttribute("data-testid") ?? "?",
          ),
          size: node ? { width: node.offsetWidth, height: node.offsetHeight } : null,
        });
        for (const p of document.querySelectorAll("path[data-drawing]")) {
          const key = p.closest(".react-flow__edge")?.getAttribute("data-testid") ?? "?";
          if (drawn.has(key)) continue;
          const cs = getComputedStyle(p);
          drawn.set(
            key,
            `${cs.animationName}|${cs.animationDuration}|${p.getAttribute("pathLength")}`,
          );
        }
        if (probe.done) resolve({ samples, landing, drawn: Object.fromEntries(drawn) });
        else requestAnimationFrame(frame);
      };
      frame();
    });
    w.__probe = probe;
  });
}

/** Let the effects run their course (past a second), stop the sampler and return its samples. */
async function stopMotion(page: Page): Promise<MotionProbe> {
  await page.waitForTimeout(1600);
  return page.evaluate(() => {
    const w = window as unknown as {
      __probe: { done: boolean; result: Promise<MotionProbe> };
    };
    w.__probe.done = true;
    return w.__probe.result;
  });
}

/** How long a flag stayed up: from its first sample to its last, in ms (null when never seen). */
function lasted(samples: MotionSample[], on: (s: MotionSample) => boolean): number | null {
  const up = samples.filter(on);
  return up.length ? up[up.length - 1].t - up[0].t : null;
}

async function waitForQuiet(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector("[data-landing], [data-drawing]") !== null),
    )
    .toBe(false);
}

test("motion (32): an added node lands for 600 ms with a ground ripple, and its size never changes", async ({
  page,
}) => {
  await openDesign(page, 1920, 1000);
  await watchMotion(page);
  await tileOf(page, "App Server").click();
  const { samples, landing } = await stopMotion(page);
  expect(landing).toEqual({
    name: "node-land",
    duration: "0.6s",
    easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
    rippleName: "node-ripple",
    ripplePosition: "absolute",
  });
  expect(samples.some((s) => s.landing && s.ripple)).toBe(true);
  // gone within a second, both of them
  expect(lasted(samples, (s) => s.landing)).toBeLessThan(1000);
  expect(lasted(samples, (s) => s.ripple)).toBeLessThan(1000);
  expect(samples[samples.length - 1]).toMatchObject({
    landing: false,
    ripple: false,
  });
  // the box is the node's 160 x 120 all along: only a transform moves
  const sizes = samples.filter((s) => s.size).map((s) => s.size);
  expect(sizes.length).toBeGreaterThan(0);
  for (const size of sizes) expect(size).toEqual({ width: 160, height: 120 });
});

test("motion (32): only the node just added lands: the first one does not land again", async ({
  page,
}) => {
  await openDesign(page, 1920, 1000);
  await quickAdd(page, "Client");
  await waitForQuiet(page);
  await watchMotion(page);
  await tileOf(page, "Cache / Redis").click();
  const { samples } = await stopMotion(page);
  expect(samples.some((s) => s.landing)).toBe(true);
  expect(await page.locator("[data-landing]").count()).toBe(0);
  // the first node was never marked again
  expect(await page.evaluate(() => document.querySelectorAll("[data-landing-ripple]").length)).toBe(
    0,
  );
});

test("motion (33): the cost chip flashes when an add changes its figure, not on a load", async ({
  page,
}) => {
  await openDesign(page, 1920, 1000);
  await quickAdd(page, "Client");
  await waitForQuiet(page);
  const chip = page.getByTestId("cost-mini");
  await expect(chip).toBeVisible();
  const before = await chip.innerText();
  await expect(chip).not.toHaveAttribute("data-flash", /.*/);
  await watchMotion(page);
  await tileOf(page, "App Server").click();
  const { samples } = await stopMotion(page);
  expect(await chip.innerText()).not.toBe(before);
  expect(samples.some((s) => s.flash)).toBe(true);
  expect(lasted(samples, (s) => s.flash)).toBeLessThan(1000);
  expect(samples[samples.length - 1].flash).toBe(false);

  // loading a reference changes the figure too, and must not flash
  await waitForQuiet(page);
  await watchMotion(page);
  await page.getByTitle("Load reference solution").click();
  await expect(allNodes(page).first()).toBeVisible();
  expect((await stopMotion(page)).samples.some((s) => s.flash)).toBe(false);
});

test("motion (34): a connection the user draws draws itself for 450 ms; only that edge does", async ({
  page,
}) => {
  await openDesign(page, 1920, 1000);
  await quickAdd(page, "Client");
  await quickAdd(page, "App Server");
  await quickAdd(page, "SQL Database");
  await waitForQuiet(page);
  await watchMotion(page);
  await connect(page, "client", "app-server");
  const a = await stopMotion(page);
  const edge = Object.keys(a.drawn);
  expect(edge).toHaveLength(1);
  expect(a.drawn[edge[0]]).toBe("edge-draw|0.45s|1");
  expect(lasted(a.samples, (s) => s.drawing.length > 0)).toBeLessThan(1000);
  expect(a.samples[a.samples.length - 1].drawing).toEqual([]);

  // a second connection: only the new edge draws, the first one (already there) does not
  await watchMotion(page);
  await connect(page, "app-server", "sql-db");
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  const b = await stopMotion(page);
  expect(Object.keys(b.drawn)).toHaveLength(1);
  expect(Object.keys(b.drawn)).not.toContain(edge[0]);
});

test("motion (34): edges that load with a design, a reference or a quick fix never draw", async ({
  page,
}) => {
  await openDesign(page, 1920, 1000);
  await quickAdd(page, "Client");
  await quickAdd(page, "App Server");
  await quickAdd(page, "SQL Database");
  await connectSync(page, "client", "app-server");
  await connectSync(page, "app-server", "sql-db");
  await waitForQuiet(page);
  await expect(page.locator(".react-flow__edge")).toHaveCount(4);

  // a reload restores the design with its edges
  await page.reload();
  await expect(page.locator(".react-flow__edge")).toHaveCount(4);
  await watchMotion(page);
  expect((await stopMotion(page)).samples.some((s) => s.drawing.length)).toBe(false);

  // a reference solution
  await watchMotion(page);
  await page.getByTitle("Load reference solution").click();
  await expect(allNodes(page).first()).toBeVisible();
  expect((await stopMotion(page)).samples.some((s) => s.drawing.length)).toBe(false);
  await page.locator("[data-canvas-tabs]").getByText("My Design").click();

  // the Advisor's quick fix adds a node and edges
  await openTab(page, /Advisor/);
  const panel = page.getByTestId("advisor-panel");
  const readCache = panel.locator('[data-finding^="read-cache:"]');
  await expect(readCache).toBeVisible();
  await readCache.getByRole("button", { name: /^Preview/ }).click();
  await expect(page.getByTestId("advisor-preview")).toBeVisible();
  await watchMotion(page);
  await page.getByTestId("advisor-preview").getByRole("button", { name: "Apply" }).click();
  await expect(page.locator('.react-flow__node[data-id^="cache-"]')).toHaveCount(1);
  const done = await stopMotion(page);
  expect(done.samples.some((s) => s.drawing.length)).toBe(false);
  expect(done.samples.some((s) => s.landing)).toBe(false);
});

test("motion (35): the marks are never saved, and an add is one undo entry", async ({ page }) => {
  await openDesign(page, 1920, 1000);
  await quickAdd(page, "Client");
  await quickAdd(page, "App Server");
  await connect(page, "client", "app-server");
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  // read right away, while the landing and the drawing may still be running
  const saved = await page.evaluate(() =>
    JSON.stringify(Object.fromEntries(Object.entries(localStorage))),
  );
  expect(saved).toContain("app-server");
  expect(saved).not.toMatch(/landing|drawing|flash|ripple|justAdded|motion/i);
  await waitForQuiet(page);
  // client, app server, edge: three entries, no more
  await page.keyboard.press(`${MOD}+z`);
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await expect(allNodes(page)).toHaveCount(2);
  await page.keyboard.press(`${MOD}+z`);
  await expect(allNodes(page)).toHaveCount(1);
  await page.keyboard.press(`${MOD}+z`);
  await expect(allNodes(page)).toHaveCount(0);
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("motion (37): an add and a connection still happen, but nothing animates", async ({
    page,
  }) => {
    await openDesign(page, 1920, 1000);
    await watchMotion(page);
    await tileOf(page, "Client").click();
    await expect(allNodes(page)).toHaveCount(1);
    await expect(announcer(page)).toHaveText("Added Client");
    await tileOf(page, "App Server").click();
    await expect(allNodes(page)).toHaveCount(2);
    await expect(announcer(page)).toHaveText("Added App Server");
    await connect(page, "client", "app-server");
    await expect(page.locator(".react-flow__edge")).toHaveCount(1);
    const { samples } = await stopMotion(page);
    expect(samples.length).toBeGreaterThan(10);
    expect(samples.some((s) => s.landing || s.ripple || s.flash || s.drawing.length)).toBe(false);
    // the dock's press and +1 stay off as well
    await expect(page.locator("[data-dock-plus]")).toHaveCount(0);
  });
});
