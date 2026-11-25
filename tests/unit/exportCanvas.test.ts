import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Papel quente slice 1, criterion 6: an export's background is the active theme's --sf-bg,
// read when it runs (not a constant of the module).

const toSvg = vi.hoisted(() => vi.fn(async () => "data:image/svg+xml;charset=utf-8,%3Csvg%3E"));
const toPng = vi.hoisted(() => vi.fn(async () => "data:image/png;base64,AAAA"));
vi.mock("html-to-image", () => ({ toSvg, toPng }));

import { useCanvasStore } from "@/store/canvasStore";
import { exportAsPng, exportAsSvg } from "@/lib/exportCanvas";

let tokens: Record<string, string>;

beforeEach(() => {
  tokens = { "--sf-bg": "#EEE8DF" };
  toSvg.mockClear();
  toPng.mockClear();
  vi.stubGlobal("document", {
    documentElement: {},
    querySelector: () => ({}),
    createElement: () => ({ click() {} }),
    body: { appendChild() {}, removeChild() {} },
  });
  vi.stubGlobal("getComputedStyle", () => ({
    getPropertyValue: (name: string) => ` ${tokens[name] ?? ""} `,
  }));
  useCanvasStore.setState({
    nodes: [
      {
        id: "a",
        type: "component",
        position: { x: 0, y: 0 },
        data: {},
        measured: { width: 160, height: 80 },
      },
    ],
  } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the export background", () => {
  it("an SVG export uses the light --sf-bg, then the dark one after a theme change", async () => {
    await exportAsSvg("Design");
    expect(toSvg.mock.calls[0]).toMatchObject([expect.anything(), { backgroundColor: "#EEE8DF" }]);
    tokens = { "--sf-bg": "#1A1714" };
    await exportAsSvg("Design");
    expect(toSvg.mock.calls[1]).toMatchObject([expect.anything(), { backgroundColor: "#1A1714" }]);
  });

  it("a PNG export uses the theme's --sf-bg too", async () => {
    await exportAsPng("Design");
    expect(toPng.mock.calls[0]).toMatchObject([expect.anything(), { backgroundColor: "#EEE8DF" }]);
  });
});
