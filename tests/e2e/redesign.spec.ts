import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import {
  EXPECTED_TOKENS,
  NAMED_MAPPINGS,
  PALETTE_TOKEN,
  THEMES,
  type Theme,
} from "../theme-expected";
import { open } from "./helpers";

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
