import { describe, expect, it } from "vitest";
import { THEME_COLOR_TOKENS, readThemeColors } from "@/lib/themeColors";

// Papel quente slice 1, criterion 6: the 2D particle canvas and the export read the theme's
// colors from the CSS tokens instead of holding color literals.

describe("readThemeColors", () => {
  it("reads each color from its --sf token, trimmed", () => {
    const asked: string[] = [];
    const colors = readThemeColors((name) => {
      asked.push(name);
      return `  value-of${name}  `;
    });
    expect(colors.bg).toBe("value-of--sf-bg");
    expect(colors.panel).toBe("value-of--sf-panel");
    expect(colors.ink).toBe("value-of--sf-ink");
    expect(colors.req).toBe("value-of--sf-req");
    expect(colors.resp).toBe("value-of--sf-resp");
    expect(colors.ok).toBe("value-of--sf-ok");
    expect(colors.slow).toBe("value-of--sf-slow");
    expect(colors.err).toBe("value-of--sf-err");
    expect(asked.sort()).toEqual(THEME_COLOR_TOKENS.map((t) => `--sf-${t}`).sort());
  });

  it("follows the theme it is asked in: a second read sees the new values", () => {
    let theme: "light" | "dark" = "light";
    const read = (name: string) => `${theme}${name}`;
    expect(readThemeColors(read).bg).toBe("light--sf-bg");
    theme = "dark";
    expect(readThemeColors(read).bg).toBe("dark--sf-bg");
  });
});
