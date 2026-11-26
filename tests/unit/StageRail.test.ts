import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StageRail } from "@/components/layout/StageRail";

// Papel quente slice 3, criteria 19 and 20: the rail holds the problem and the steps, collapses to
// icons and can be expanded again.

const noop = () => {};
const STEPS = [
  { id: "problem", label: "Problem" },
  { id: "design", label: "Design" },
];

const rail = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(StageRail, {
      problemTitle: "Design Twitter",
      collapsed: false,
      onToggleCollapsed: noop,
      steps: STEPS,
      current: 1,
      onGo: noop,
      onBack: noop,
      onNext: noop,
      label: "Steps",
      ...props,
    }),
  );

describe("StageRail", () => {
  it("holds the problem's title and the vertical step bar", () => {
    const html = rail();
    expect(html).toContain('data-testid="rail-problem"');
    expect(html).toContain("Design Twitter");
    expect(html).toContain('data-testid="step-bar"');
    expect(html).toContain('data-orientation="vertical"');
    expect(html).toContain('data-step="design"');
  });

  it("says so when no problem is picked", () => {
    expect(rail({ problemTitle: undefined })).toContain("No problem picked");
  });

  it("offers to collapse when open, with aria-expanded true", () => {
    const html = rail();
    expect(html).toContain('aria-label="Collapse steps"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain("data-collapsed");
  });

  it("collapsed: icons only, the title kept for assistive tech, offers to expand", () => {
    const html = rail({ collapsed: true });
    expect(html).toContain('aria-label="Expand steps"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("data-collapsed");
    const problem = html.match(/<div[^>]*data-testid="rail-problem"[^>]*>.*?<\/div>/)?.[0] ?? "";
    expect(problem).toContain('<span class="sr-only">Design Twitter</span>');
    expect(problem).toContain('title="Design Twitter"');
  });
});
