import { describe, expect, it } from "vitest";
import {
  THEME_COLOR_TOKENS,
  createThemeColorCache,
  readThemeColors,
  type ThemeColors,
} from "@/lib/themeColors";

describe("createThemeColorCache", () => {
  const colorsOf = (tag: string) => readThemeColors((name) => `${tag}${name}`);

  it("reads once up front and serves the cached colors until the theme changes", () => {
    let reads = 0;
    let theme = "light";
    const cache = createThemeColorCache(
      () => {
        reads++;
        return colorsOf(theme);
      },
      () => () => {},
    );
    expect(cache.get().bg).toBe("light--sf-bg");
    theme = "dark";
    expect(cache.get().bg).toBe("light--sf-bg");
    expect(reads).toBe(1);
  });

  it("re-reads on the watcher callback and then calls onChange", () => {
    let theme = "light";
    let fire: () => void = () => {};
    const seen: string[] = [];
    const cache = createThemeColorCache(
      () => colorsOf(theme),
      (cb) => {
        fire = cb;
        return () => {};
      },
      () => seen.push(cache.get().bg),
    );
    theme = "dark";
    fire();
    expect(cache.get().bg).toBe("dark--sf-bg");
    expect(seen).toEqual(["dark--sf-bg"]);
  });

  it("dispose unsubscribes the watcher", () => {
    let unsubscribed = 0;
    const cache = createThemeColorCache(
      () => colorsOf("x") as ThemeColors,
      () => () => {
        unsubscribed++;
      },
    );
    cache.dispose();
    expect(unsubscribed).toBe(1);
  });
});

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
