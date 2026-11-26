import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StepBar } from "@/components/layout/StepBar";

// Papel quente slice 3, criterion 20: the rail holds a vertical StepBar. It keeps the roles, the
// names and "only the order" navigation of the horizontal one (the wizard spec is the proof in a
// browser). Collapsed to icons, the names stay for assistive tech.

const STEPS = [
  { id: "problem", label: "Problem" },
  { id: "design", label: "Design" },
  { id: "simulate", label: "Simulate" },
];
const noop = () => {};

const bar = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(StepBar, {
      steps: STEPS,
      current: 1,
      onGo: noop,
      onBack: noop,
      onNext: noop,
      label: "Steps",
      ...props,
    }),
  );

/** The `<button …>…</button>` of a step, by its `data-step`. */
const stepButton = (html: string, id: string) =>
  html.match(new RegExp(`<button[^>]*data-step="${id}"[^>]*>.*?</button>`))?.[0] ?? "";

/** The Back or Next button's whole markup: the one whose text (not its title) is `name`. */
const navButton = (html: string, name: string) =>
  (html.match(/<button[^>]*>.*?<\/button>/g) ?? []).find(
    (b) => !b.includes("data-step") && b.replace(/<[^>]*>/g, "") === name,
  ) ?? "";

describe("StepBar, vertical", () => {
  it("is the same nav, test id and step buttons, stacked", () => {
    const html = bar({ orientation: "vertical" });
    expect(html).toContain('data-testid="step-bar"');
    expect(html).toContain('aria-label="Steps"');
    expect(html).toContain('data-orientation="vertical"');
    for (const s of STEPS) expect(html).toContain(`data-step="${s.id}"`);
    expect(html).toMatch(/<nav[^>]*class="[^"]*\bflex-col\b/);
  });

  it("has no chevron between the stacked steps, only the one on Next", () => {
    expect(bar({ orientation: "vertical" }).match(/lucide-chevron-right/g)).toHaveLength(1);
    // the row keeps one after each step but the last (3 steps), plus Next's
    expect(bar().match(/lucide-chevron-right/g)).toHaveLength(STEPS.length - 1 + 1);
  });

  it("the horizontal bar is not marked vertical and is not a column", () => {
    const html = bar();
    expect(html).not.toContain("data-orientation");
    expect(html).not.toMatch(/<nav[^>]*class="[^"]*\bflex-col\b/);
  });

  it("marks the current step, and only a step up to the current one is a working button", () => {
    const html = bar({ orientation: "vertical" });
    expect(stepButton(html, "design")).toContain('aria-current="step"');
    expect(stepButton(html, "problem")).not.toContain("disabled");
    expect(stepButton(html, "problem")).not.toContain("aria-current");
    expect(stepButton(html, "simulate")).toContain("disabled");
    expect(stepButton(html, "simulate")).toContain("Use Next to get here");
  });

  it("keeps Back and Next, each disabled at its end", () => {
    const first = bar({ orientation: "vertical", current: 0 });
    expect(navButton(first, "Back")).toContain('disabled=""');
    expect(navButton(first, "Next")).not.toContain('disabled=""');
    const last = bar({ orientation: "vertical", current: 2 });
    expect(navButton(last, "Next")).toContain('disabled=""');
    expect(navButton(last, "Back")).not.toContain('disabled=""');
  });

  it("shows the labels and Back / Next text when open", () => {
    const html = bar({ orientation: "vertical" });
    expect(stepButton(html, "design")).not.toContain("sr-only");
    expect(html).not.toContain("data-collapsed");
  });

  it("collapsed to icons: no visible text, but every name stays for assistive tech", () => {
    const html = bar({ orientation: "vertical", collapsed: true });
    expect(html).toContain("data-collapsed");
    for (const s of STEPS) {
      const b = stepButton(html, s.id);
      expect(b).toContain(`<span class="sr-only">${s.label}</span>`);
      expect(b).toContain(`title="${s.label}`);
    }
    expect(html).toContain('<span class="sr-only">Back</span>');
    expect(html).toContain('<span class="sr-only">Next</span>');
  });

  it("collapsed does nothing to the horizontal bar", () => {
    expect(bar({ collapsed: true })).not.toContain("data-collapsed");
    expect(bar({ collapsed: true })).not.toContain("sr-only");
  });
});
