import { describe, expect, it } from "vitest";
import { spreadReferenceLayout } from "@/lib/loadReference";

const SIZE = { width: 160, height: 120 };
const GAP = 16;

const clear = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) >= SIZE.width + GAP || Math.abs(a.y - b.y) >= SIZE.height + GAP;

function expectSpread(out: { x: number; y: number }[]) {
  for (let i = 0; i < out.length; i++)
    for (let j = i + 1; j < out.length; j++)
      expect(clear(out[i], out[j]), `${i}/${j}: ${JSON.stringify([out[i], out[j]])}`).toBe(true);
}

describe("spreadReferenceLayout", () => {
  it("leaves a layout that already fits untouched (k = 1, no snapping)", () => {
    const fits = [
      { x: 50, y: 250 },
      { x: 250, y: 250 },
      { x: 250, y: 100 },
    ];
    expect(spreadReferenceLayout(fits, SIZE, GAP)).toEqual(fits);
  });

  it("spreads a known tight pair to exactly width + gap", () => {
    const out = spreadReferenceLayout(
      [
        { x: 0, y: 0 },
        { x: 150, y: 0 },
      ],
      SIZE,
      GAP,
    );
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 176, y: 0 },
    ]);
  });

  it("scales about the layout's top-left bound and snaps to the 16 px grid", () => {
    const out = spreadReferenceLayout(
      [
        { x: 50, y: 250 },
        { x: 200, y: 250 },
        { x: 350, y: 250 },
      ],
      SIZE,
      GAP,
    );
    expect(out.every((p) => p.x % 16 === 0 && p.y % 16 === 0)).toBe(true);
    expect(out[0].x).toBe(48);
    expectSpread(out);
  });

  it("raises k when snapping would reintroduce an overlap", () => {
    // dy = 100 needs k = 1.36; unsnapped y = 8 and 144, snapped 16 and 144 = 128 apart (< 136).
    const out = spreadReferenceLayout(
      [
        { x: 0, y: 8 },
        { x: 0, y: 108 },
      ],
      SIZE,
      GAP,
    );
    expectSpread(out);
    expect(out.every((p) => p.x % 16 === 0 && p.y % 16 === 0)).toBe(true);
  });

  it("uses the smallest k that clears every pair (the largest per-pair need)", () => {
    // A/B need k = 176 / 105 = 1.676; B/C only 1.121, listed later; C lands at 262 * 1.676 = 439.2 -> 432.
    const out = spreadReferenceLayout(
      [
        { x: 0, y: 0 },
        { x: 105, y: 0 },
        { x: 262, y: 0 },
      ],
      SIZE,
      GAP,
    );
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 176, y: 0 },
      { x: 432, y: 0 },
    ]);
  });

  it("keeps a pair with identical positions without hanging", () => {
    const same = [
      { x: 10, y: 10 },
      { x: 10, y: 10 },
    ];
    expect(spreadReferenceLayout(same, SIZE, GAP)).toEqual(same);
  });

  it("is deterministic and does not mutate its input", () => {
    const input = [
      { x: 50, y: 250 },
      { x: 200, y: 250 },
      { x: 200, y: 80 },
      { x: 350, y: 250 },
    ];
    const copy = JSON.parse(JSON.stringify(input));
    const a = spreadReferenceLayout(input, SIZE, GAP);
    const b = spreadReferenceLayout(input, SIZE, GAP);
    expect(a).toEqual(b);
    expect(input).toEqual(copy);
    expectSpread(a);
  });
});
