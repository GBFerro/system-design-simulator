import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import {
  EXPECTED_TOKENS,
  NAMED_MAPPINGS,
  PALETTE_TOKEN,
  THEMES,
  type Theme,
} from "../theme-expected";
import { open, openTab } from "./helpers";

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

  const seen: Record<string, string[]> = { edge: [], mask: [], dot: [], line: [], bg: [] };
  for (const theme of THEMES) {
    await setTheme(page, theme);
    const want = {
      edge: await computedColor(page, "var(--edge-idle)"),
      mask: await computedColor(page, "var(--minimap-mask)"),
      dot: await computedColor(page, "var(--grid-dot)"),
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
        dot: css(".react-flow__background-pattern.dots", "fill"),
        line: css(".react-flow__background-pattern.lines", "stroke"),
      };
    });
    expect(got, theme).toEqual(want);
    for (const k of ["edge", "mask", "dot", "line"] as const) seen[k].push(want[k]);

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

/** Open the app in light on a wide screen with the reference loaded (the minimap shows from md). */
async function openReference(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, "/");
  await stylesApplied(page);
  await setTheme(page, "light");
  await page.getByTitle("Load reference solution").click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
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

test("shadows: the node's drop shadow, the empty state's and the accent card's glow follow their tokens", async ({
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
  for (const theme of THEMES) {
    await setTheme(page, theme);
    const shadow = await computedProp(page, "boxShadow", "var(--shadow-e2)");
    const own = await page
      .locator(".react-flow__node-component > div")
      .first()
      .evaluate((el) => getComputedStyle(el).boxShadow);
    expect(own.endsWith(shadow), `${theme} node shadow ${own} vs ${shadow}`).toBe(true);
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
