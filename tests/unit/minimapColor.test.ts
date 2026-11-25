import { describe, expect, it } from "vitest";
import { minimapNodeColor } from "@/lib/minimapColor";

describe("minimapNodeColor", () => {
  it("maps every runtime status to its token and anything else to muted", () => {
    expect(minimapNodeColor("ok")).toBe("var(--sf-ok)");
    expect(minimapNodeColor("warn")).toBe("var(--sf-slow)");
    expect(minimapNodeColor("critical")).toBe("var(--sf-err)");
    expect(minimapNodeColor("down")).toBe("var(--sf-err)");
    expect(minimapNodeColor(undefined)).toBe("var(--sf-muted)");
  });
});
