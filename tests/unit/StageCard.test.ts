import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StageCard } from "@/components/layout/StageCard";

// Papel quente slice 3, criteria 18 and 22: every floating card has the 14 px radius and the 1.5 px
// border of the theme tokens, and a closed one is hidden (not resized) and inert.

const card = (props: Partial<ComponentProps<typeof StageCard>> = {}) =>
  renderToStaticMarkup(
    createElement(
      StageCard,
      { testId: "stage-x", ...props } as ComponentProps<typeof StageCard>,
      createElement("span", null, "hi"),
    ),
  );

describe("StageCard", () => {
  it("is a box with its test id and its children", () => {
    const html = card();
    expect(html).toContain('data-testid="stage-x"');
    expect(html).toContain("<span>hi</span>");
  });

  it("takes the radius, the border width and the line color from the theme tokens", () => {
    const html = card();
    expect(html).toContain("border-radius:var(--sf-radius)");
    expect(html).toContain("border-width:var(--sf-border-w)");
    expect(html).toContain("border-style:solid");
    expect(html).toContain("border-color:var(--sf-line)");
  });

  it("keeps the position and size the shell gives it, next to the chrome", () => {
    const html = card({
      style: { left: 16, top: 84, width: 210 },
      className: "absolute z-20",
    });
    expect(html).toContain("left:16px");
    expect(html).toContain("top:84px");
    expect(html).toContain("width:210px");
    expect(html).toContain("border-radius:var(--sf-radius)");
    expect(html).toContain("absolute z-20");
  });

  it("is marked as a card, so a palette drop over it does not reach the canvas", () => {
    expect(card()).toContain("data-stage-card");
  });

  it("can be a landmark of its own: the dock is a toolbar named Components (slice 4, criterion 28)", () => {
    const html = card({ role: "toolbar", ariaLabel: "Components" });
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('aria-label="Components"');
    expect(card()).not.toContain("role=");
  });

  it("flat: a display:contents wrapper with no test id, no chrome and no card mark", () => {
    const html = card({
      flat: true,
      className: "absolute",
      style: { left: 16 },
    });
    expect(html).toContain('class="contents"');
    expect(html).toContain("<span>hi</span>");
    expect(html).not.toContain("data-testid");
    expect(html).not.toContain("data-stage-card");
    expect(html).not.toContain("border");
    expect(html).not.toContain("left:16px");
  });

  it("is not hidden while open", () => {
    const html = card({ open: true });
    expect(html).not.toContain("display:none");
    expect(html).not.toContain("inert");
    expect(html).not.toContain("aria-hidden");
  });

  it("is display:none, inert and aria-hidden when closed, even if the caller sets a display", () => {
    const html = card({ open: false, style: { display: "flex" } });
    expect(html).toContain("display:none");
    expect(html).not.toContain("display:flex");
    expect(html).toContain("inert");
    expect(html).toContain('aria-hidden="true"');
  });
});
