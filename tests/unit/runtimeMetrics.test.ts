import { describe, expect, it } from "vitest";
import { fmtStaleReads } from "@/lib/runtimeMetrics";

// Criterion 9: the Sim panel's "Stale reads" cell (replica loss / CAP) reads as
// reads per second and their share of the served reads.
describe("fmtStaleReads", () => {
  it("shows reads per second and the share of served reads", () => {
    expect(fmtStaleReads(1200, 1 / 3)).toBe("1.2K/s · 33%");
    expect(fmtStaleReads(5.5, 0.125)).toBe("5.5/s · 13%");
  });

  it("keeps a zero reading readable (the cell's absent case never calls it, but 0% must not round up)", () => {
    expect(fmtStaleReads(0, 0)).toBe("0/s · 0%");
  });
});
