import { describe, expect, it } from "vitest";
import { minimapFill, minimapNodeColor } from "@/lib/minimapColor";

describe("minimapNodeColor", () => {
  it("maps every runtime status to its token and anything else to muted", () => {
    expect(minimapNodeColor("ok")).toBe("var(--sf-ok)");
    expect(minimapNodeColor("warn")).toBe("var(--sf-slow)");
    expect(minimapNodeColor("critical")).toBe("var(--sf-err)");
    expect(minimapNodeColor("down")).toBe("var(--sf-err)");
    expect(minimapNodeColor(undefined)).toBe("var(--sf-muted)");
  });
});

describe("minimapFill", () => {
  const nodes = { a: { status: "ok" }, b: { status: "warn" }, c: { status: "down" } } as const;

  it("colors a node by its own status in the snapshot", () => {
    expect(minimapFill("a", nodes)).toBe("var(--sf-ok)");
    expect(minimapFill("b", nodes)).toBe("var(--sf-slow)");
    expect(minimapFill("c", nodes)).toBe("var(--sf-err)");
  });

  it("is muted for a node the snapshot does not know, and before any snapshot", () => {
    expect(minimapFill("z", nodes)).toBe("var(--sf-muted)");
    expect(minimapFill("a", undefined)).toBe("var(--sf-muted)");
    expect(minimapFill("a", {})).toBe("var(--sf-muted)");
  });
});
