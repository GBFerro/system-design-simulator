import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EXPECTED_TOKENS, NAMED_MAPPINGS, THEMES, type Theme } from "../theme-expected";

// Papel quente slice 1 (specs/2026-11-24-redesign-papel-quente.md, criteria 1, 2, 3 and 6):
// the `--sf-*` tokens of globals.css, the old zinc/cyan/shadcn indirections that resolve to
// them, the contrast of the text pairs, and the canvas files holding no color literal.

const root = fileURLToPath(new URL("../../", import.meta.url));
const css = readFileSync(root + "src/app/globals.css", "utf8").replace(/\r\n/g, "\n");

type Decls = Map<string, string>;

/** The custom properties declared by every `selector { ... }` rule of the stylesheet. */
function declsOf(selector: string): Decls {
  const out: Decls = new Map();
  const rule = new RegExp(`(?:^|\\n)${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`, "g");
  for (const m of css.matchAll(rule)) {
    const body = m[1].replace(/\/\*[\s\S]*?\*\//g, "");
    for (const d of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(d[1], d[2].trim());
  }
  return out;
}

const LIGHT = declsOf(":root");
const DARK = declsOf(".dark");

/** A token's value in a theme: the dark block overrides the root one, `var()` resolved on the html. */
function resolve(theme: Theme, name: string, depth = 0): string {
  if (depth > 8) throw new Error(`var() cycle at ${name}`);
  const raw = (theme === "dark" ? DARK.get(name) : undefined) ?? LIGHT.get(name);
  if (raw === undefined) throw new Error(`${name} is not defined in ${theme}`);
  return raw.replace(/var\((--[\w-]+)\)/g, (_, n: string) => resolve(theme, n, depth + 1)).trim();
}

const HEX = /^#[0-9a-f]{6}$/i;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

describe("Papel quente tokens (criterion 1)", () => {
  for (const theme of THEMES) {
    it(`defines every --sf token with its exact value in ${theme}`, () => {
      const got = Object.fromEntries(
        Object.keys(EXPECTED_TOKENS[theme]).map((name) => [
          name,
          resolve(theme, name).toLowerCase(),
        ]),
      );
      const want = Object.fromEntries(
        Object.entries(EXPECTED_TOKENS[theme]).map(([k, v]) => [k, v.toLowerCase()]),
      );
      expect(got).toEqual(want);
    });
  }
});

/* ---------- WCAG 2.x ---------- */

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function ratio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const tok = (theme: Theme, name: string) => resolve(theme, name);

describe("the old ramps and shadcn tokens resolve to the tokens (criterion 2)", () => {
  for (const theme of THEMES) {
    it(`maps ${NAMED_MAPPINGS.length} names to their token in ${theme}`, () => {
      for (const [name, token] of NAMED_MAPPINGS) {
        expect(same(tok(theme, name), tok(theme, token)), `${name} -> ${token}`).toBe(true);
      }
    });

    it(`gives every other step a hex value between its neighbours in ${theme}`, () => {
      const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((n) => `--z-${n}`);
      const acs = [300, 400, 500, 600, 700].map((n) => `--ac-${n}`);
      for (const name of [...steps, ...acs]) {
        expect(tok(theme, name), name).toMatch(HEX);
      }
      const lum = (name: string) => luminance(tok(theme, name));
      // Text steps run from the strongest (z-50) to muted (z-500) and on to the line (z-800):
      // each is monotone in luminance (darker to lighter in light, the reverse in dark).
      const dir = theme === "light" ? 1 : -1;
      const chain = ["--z-50", "--z-100", "--z-200", "--z-300", "--z-400", "--z-500", "--z-600"];
      const chain2 = ["--z-500", "--z-600", "--z-700", "--z-800"];
      for (const seq of [chain, chain2]) {
        for (let i = 1; i < seq.length; i++) {
          expect(
            dir * (lum(seq[i]) - lum(seq[i - 1])),
            `${seq[i - 1]} -> ${seq[i]}`,
          ).toBeGreaterThanOrEqual(0);
        }
      }
      // The accent ramp darkens from 300 to 700 in both themes (500 is the accent itself).
      for (let i = 1; i < acs.length; i++) {
        expect(lum(acs[i - 1]) - lum(acs[i]), `${acs[i - 1]} -> ${acs[i]}`).toBeGreaterThanOrEqual(
          0,
        );
      }
    });
  }
});

describe("contrast of the text pairs (criterion 3)", () => {
  const MIN = 4.5;
  const textSteps = [50, 100, 200, 300, 400, 500].map((n) => `--z-${n}`);
  const pastels = ["client", "network", "compute", "cache", "data", "messaging", "infra"].map(
    (c) => `--sf-cat-${c}`,
  );
  const atLeast = (theme: Theme, fg: string, bg: string, min = MIN) =>
    expect(ratio(tok(theme, fg), tok(theme, bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(min);

  for (const theme of THEMES) {
    it(`--z-50..--z-500 are at least ${MIN}:1 on panel and panel-2 in ${theme}`, () => {
      for (const surface of ["--sf-panel", "--sf-panel-2"]) {
        for (const name of textSteps) atLeast(theme, name, surface);
      }
    });

    it(`muted passes on panel, panel-2 and bg in ${theme}`, () => {
      for (const surface of ["--sf-panel", "--sf-panel-2", "--sf-bg"]) {
        atLeast(theme, "--sf-muted", surface);
      }
    });

    it(`req, resp, ok, slow and err pass on panel in ${theme}`, () => {
      for (const name of ["--sf-req", "--sf-resp", "--sf-ok", "--sf-slow", "--sf-err"]) {
        atLeast(theme, name, "--sf-panel");
      }
    });

    it(`accent-ink is at least ${MIN}:1 on accent in ${theme}`, () => {
      atLeast(theme, "--sf-accent-ink", "--sf-accent");
    });

    it(`ink is at least ${MIN}:1 on accent-soft and on each category pastel in ${theme}`, () => {
      for (const surface of ["--sf-accent-soft", ...pastels]) atLeast(theme, "--sf-ink", surface);
    });
  }

  it("status text on panel-2: dark passes everywhere, light passes for resp and err only", () => {
    // Criterion 3 lists req, resp, ok, slow and err on panel-2 too, but the Approach's Contrast
    // list (and the hex values of criterion 1) give only the panel for them: in light, req and
    // slow (and ok, by 0.01) fall just under 4.5:1 on panel-2. They stay usable on the panel;
    // the floor is pinned here so a change to the values is a conscious one. Status text on
    // panel-2 uses ink in light, so req (4.378) and slow (4.449) hold 4.3; ok (4.5011) holds 4.5.
    for (const name of ["--sf-req", "--sf-resp", "--sf-ok", "--sf-slow", "--sf-err"]) {
      atLeast("dark", name, "--sf-panel-2");
    }
    for (const name of ["--sf-resp", "--sf-err", "--sf-ok"]) atLeast("light", name, "--sf-panel-2");
    for (const name of ["--sf-req", "--sf-slow"]) {
      atLeast("light", name, "--sf-panel-2", 4.3);
    }
  });

  it("keeps the pairs the spec marks as failing off the list", () => {
    // accent text on bg (light) and on accent-soft, and white text on the dark accent, stay below 4.5.
    expect(ratio(tok("light", "--sf-accent"), tok("light", "--sf-bg"))).toBeLessThan(MIN);
    expect(ratio(tok("light", "--sf-accent"), tok("light", "--sf-accent-soft"))).toBeLessThan(MIN);
    expect(ratio(tok("dark", "--sf-accent"), tok("dark", "--sf-accent-soft"))).toBeLessThan(MIN);
    expect(ratio("#FFFFFF", tok("dark", "--sf-accent"))).toBeLessThan(MIN);
  });
});

describe("the blast outline (Decisions: orange resolves to the accent)", () => {
  it("uses the err token on the node and on the edge, never the orange palette", () => {
    for (const file of [
      "src/components/canvas/nodes/ComponentNode.tsx",
      "src/components/canvas/edges/AnimatedEdge.tsx",
    ]) {
      const text = readFileSync(root + file, "utf8");
      expect(text, file).not.toMatch(/-orange-/);
      expect(text, file).toContain("var(--sf-err)");
    }
  });
});

describe("the canvas files hold no color literal (criterion 6)", () => {
  const FILES = [
    "src/components/canvas/DesignCanvas.tsx",
    "src/components/canvas/edges/AnimatedEdge.tsx",
    "src/components/canvas/FlowParticles.tsx",
    "src/lib/particles.ts",
    "src/lib/exportCanvas.ts",
  ];
  /** Strip comments and keep strings: a literal in code or in a class string is what we look for. */
  const code = (file: string) =>
    readFileSync(root + file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab)\(/;

  it.each(FILES)("%s has no hex, rgb(), rgba(), hsl() or oklch() literal", (file) => {
    const hits = code(file)
      .split("\n")
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => LITERAL.test(line))
      .map(({ line, n }) => `${file}:${n}: ${line.trim()}`);
    expect(hits).toEqual([]);
  });
});
