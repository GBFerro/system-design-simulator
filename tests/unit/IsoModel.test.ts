import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IsoModel } from "@/components/canvas/nodes/IsoModel";
import { ISO_ORIGIN, pt, quad, type IsoArchetype, type IsoTint } from "@/lib/iso";

// Papel quente slice 2 (specs/2026-11-24-redesign-papel-quente.md, criteria 10 to 13): the
// markup of the fifteen isometric models, their face/stroke/shadow variables, the status halo,
// the selected ring and the reduced-motion rule.

const ARCHETYPES: IsoArchetype[] = [
  "client",
  "dns",
  "cdn",
  "lb",
  "gateway",
  "api",
  "worker",
  "cache",
  "db",
  "replica",
  "bucket",
  "search",
  "queue",
  "monitor",
  "control",
];
const TINTS: IsoTint[] = ["client", "network", "compute", "cache", "data", "messaging", "infra"];
const STATUSES = ["ok", "slow", "err"] as const;

type Props = {
  archetype: IsoArchetype;
  tint: IsoTint;
  status?: "ok" | "slow" | "err";
  selected?: boolean;
};
const render = (p: Props) => renderToStaticMarkup(createElement(IsoModel, p));
const of = (archetype: IsoArchetype, tint: IsoTint = "data", rest: Partial<Props> = {}) =>
  render({ archetype, tint, ...rest });

type Tag = { name: string; attrs: Record<string, string> };
/** Every opening tag of the markup with its attributes. */
function tags(markup: string): Tag[] {
  return [...markup.matchAll(/<([a-z]+)((?:\s[^>]*?)?)\/?>/g)].map((m) => ({
    name: m[1],
    attrs: Object.fromEntries([...m[2].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])),
  }));
}
/** The markup inside the root svg: what each archetype draws. */
const body = (markup: string) => markup.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");

const root = fileURLToPath(new URL("../../", import.meta.url));
const css = readFileSync(root + "src/app/globals.css", "utf8").replace(/\r\n/g, "\n");

describe("the root svg (criterion 10)", () => {
  it.each(ARCHETYPES)("%s renders exactly one svg with its kind, tint and viewBox", (a) => {
    const markup = of(a, "cache");
    expect(markup.match(/<svg/g)).toHaveLength(1);
    const svg = tags(markup)[0];
    expect(svg.name).toBe("svg");
    expect(svg.attrs["viewBox"]).toBe("0 0 160 160");
    expect(svg.attrs["data-iso-kind"]).toBe(a);
    expect(svg.attrs["data-iso-tint"]).toBe("cache");
    expect(svg.attrs["aria-hidden"]).toBe("true");
  });

  it("applies the className to the svg", () => {
    const markup = renderToStaticMarkup(
      createElement(IsoModel, { archetype: "api", tint: "compute", className: "h-24 w-24" }),
    );
    expect(tags(markup)[0].attrs["class"]).toBe("h-24 w-24");
  });

  it("draws 15 different shapes: no two archetypes share their markup", () => {
    const bodies = ARCHETYPES.map((a) => body(of(a, "data")));
    expect(new Set(bodies).size).toBe(ARCHETYPES.length);
    for (const b of bodies) expect(b.length).toBeGreaterThan(400);
  });

  it("is deterministic: the same props give the same markup", () => {
    for (const a of ARCHETYPES) expect(of(a, "infra")).toBe(of(a, "infra"));
  });
});

describe("faces, stroke and ground shadow (criterion 11)", () => {
  it.each(ARCHETYPES)("%s fills its faces with the three variables of its tint", (a) => {
    for (const tint of TINTS) {
      const markup = of(a, tint);
      for (const f of ["top", "left", "right"]) {
        expect(markup, `${a} ${tint} ${f}`).toContain(`var(--iso-${tint}-${f})`);
      }
      for (const other of TINTS.filter((t) => t !== tint)) {
        expect(markup, `${a} ${tint} leaks ${other}`).not.toContain(`var(--iso-${other}-`);
      }
    }
  });

  it.each(ARCHETYPES)("%s strokes with the iso stroke variable", (a) => {
    expect(of(a)).toContain('stroke="var(--iso-stroke)"');
  });

  it.each(ARCHETYPES)("%s casts the hard shadow offset (3, 5) at opacity 0.9", (a) => {
    const C = ISO_ORIGIN;
    const slab = [pt(C, -37, 37, -8), pt(C, 37, 37, -8), pt(C, 37, -37, -8), pt(C, -37, -37, -8)];
    const want = quad(slab.map((p): [number, number] => [p[0] + 3, p[1] + 5]));
    const shadows = tags(of(a)).filter((t) => t.attrs["fill"] === "var(--iso-shadow)");
    expect(shadows).toHaveLength(1);
    expect(shadows[0].name).toBe("polygon");
    expect(shadows[0].attrs["points"]).toBe(want);
    expect(shadows[0].attrs["fill-opacity"]).toBe("0.9");
  });

  it("paints the shadow first, under the slab and the body", () => {
    const all = tags(of("api"));
    const first = all.find((t) => t.name === "polygon");
    expect(first?.attrs["fill"]).toBe("var(--iso-shadow)");
  });

  it("holds no color literal: every color is a variable", () => {
    for (const a of ARCHETYPES) {
      const markup = of(a, "data", { status: "err", selected: true });
      expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch)\(/);
      for (const t of tags(markup)) {
        for (const k of ["fill", "stroke"]) {
          const v = t.attrs[k];
          if (v === undefined || v === "none") continue;
          expect(v, `${a} ${k}`).toMatch(/^(?:var\(|color-mix\()/);
        }
      }
    }
  });

  it("only names variables that globals.css defines", () => {
    const names = new Set<string>();
    for (const a of ARCHETYPES) {
      for (const tint of TINTS) {
        for (const m of of(a, tint, { status: "slow", selected: true }).matchAll(
          /var\((--[\w-]+)\)/g,
        )) {
          names.add(m[1]);
        }
      }
    }
    expect(names.size).toBeGreaterThan(10);
    for (const n of names) {
      expect(css, n).toMatch(new RegExp(`\\n\\s*${n}\\s*:`));
    }
    // the slab and gold variables are themed: the dark block redefines them
    for (const n of ["--iso-slab-top", "--iso-slab-left", "--iso-slab-right", "--iso-gold"]) {
      expect(css.match(new RegExp(`\\n\\s*${n}\\s*:`, "g")), n).toHaveLength(2);
    }
  });
});

describe("the status halo (criterion 12)", () => {
  it.each(ARCHETYPES)("%s has no halo without a status", (a) => {
    expect(of(a)).not.toContain("data-iso-status");
  });

  it.each(STATUSES)("a %s status draws one halo in the status token", (status) => {
    for (const a of ARCHETYPES) {
      const halos = tags(of(a, "data", { status })).filter(
        (t) => t.attrs["data-iso-status"] !== undefined,
      );
      expect(halos, a).toHaveLength(1);
      expect(halos[0].attrs["data-iso-status"]).toBe(status);
      expect(halos[0].attrs["stroke"]).toBe(`var(--sf-${status})`);
    }
  });

  it("paints the halo before the body, so the model stays on top of it", () => {
    const all = tags(of("api", "data", { status: "ok", selected: true }));
    const halo = all.findIndex((t) => t.attrs["data-iso-status"] !== undefined);
    const ring = all.findIndex((t) => t.attrs["data-iso-selected"] !== undefined);
    const model = all.findIndex((t) => t.attrs["fill"] === "var(--sf-ok)");
    expect(halo).toBeGreaterThan(0);
    expect(ring).toBeGreaterThan(halo);
    expect(model).toBeGreaterThan(ring);
  });
});

describe("the selected ring (criterion 13)", () => {
  it.each(ARCHETYPES)("%s has no ring unless selected", (a) => {
    expect(of(a)).not.toContain("data-iso-selected");
    expect(of(a, "data", { selected: false })).not.toContain("data-iso-selected");
  });

  it.each(ARCHETYPES)("%s draws one dashed accent ring when selected", (a) => {
    const rings = tags(of(a, "data", { selected: true })).filter(
      (t) => t.attrs["data-iso-selected"] !== undefined,
    );
    expect(rings).toHaveLength(1);
    expect(rings[0].attrs["stroke"]).toBe("var(--sf-accent)");
    expect(rings[0].attrs["stroke-dasharray"]).toBeTruthy();
  });

  it("shows the halo and the ring together", () => {
    const markup = of("db", "data", { status: "err", selected: true });
    expect(markup).toContain("data-iso-status");
    expect(markup).toContain("data-iso-selected");
  });
});

describe("motion", () => {
  const KEYFRAMES = ["iso-conv", "iso-halo", "iso-dash"];

  it("tags every animated element with iso-motion", () => {
    const markup = of("queue", "messaging", { status: "slow", selected: true });
    const animated = tags(markup).filter((t) =>
      KEYFRAMES.some((k) => (t.attrs["class"] ?? "").split(" ").includes(k)),
    );
    const used = animated.map((t) =>
      t.attrs["class"]?.split(" ").find((c) => KEYFRAMES.includes(c)),
    );
    expect(used.sort()).toEqual(["iso-conv", "iso-dash", "iso-halo"]);
    for (const t of animated) expect(t.attrs["class"]).toContain("iso-motion");
  });

  it("moves only the queue's cubes, and only the halo and ring on request", () => {
    for (const a of ARCHETYPES.filter((x) => x !== "queue")) {
      expect(of(a)).not.toContain("iso-motion");
    }
    expect(of("queue")).toContain("iso-conv");
  });

  it("defines the keyframes and the rules that run them", () => {
    for (const k of KEYFRAMES) {
      expect(css, k).toMatch(new RegExp(`@keyframes ${k}\\s*\\{`));
      expect(css, k).toMatch(new RegExp(`\\.${k}\\s*\\{[^}]*animation:[^;}]*${k}`));
    }
  });

  it("switches the animation off under prefers-reduced-motion", () => {
    const blocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)];
    const rule = blocks.map((b) => b[1]).find((b) => /\.iso-motion\b/.test(b));
    expect(rule, "a reduced-motion block names .iso-motion").toBeDefined();
    expect(rule).toMatch(/\.iso-motion\s*\{[^}]*animation:\s*none/);
  });
});
