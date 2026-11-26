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
import { MOD, center, clickEmptyPane, connect, open, openTab, quickAdd } from "./helpers";

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

  const seen: Record<string, string[]> = { edge: [], mask: [], line: [], bg: [] };
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
    .poll(async () => (await fills()).some((f) => f === ok), { timeout: 20_000 })
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
  await expect(panel.locator("[data-arrow]").first()).toBeVisible({ timeout: 20_000 });
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
  await expect(page.locator('[data-blast="target"]')).toBeVisible({ timeout: 10_000 });
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
      .poll(() => card.evaluate((el) => getComputedStyle(el).boxShadow), { message: theme })
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
  for (const c of SYSTEM_COMPONENTS) {
    await page.getByRole("button", { name: `Add ${c.label} to canvas`, exact: true }).click();
  }
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
