/**
 * The theme's colors for code that cannot use `var(--…)`: the 2D particle canvas and the image
 * export. SVG and DOM read the tokens through CSS; these read the same `--sf-*` tokens of
 * globals.css, resolved for the active theme (`:root` or `.dark`), so no color literal lives in
 * the canvas code and a theme switch only needs one more read.
 */

/** The tokens the canvas code reads: `--sf-<name>`. */
export const THEME_COLOR_TOKENS = [
  "bg",
  "panel",
  "ink",
  "req",
  "resp",
  "ok",
  "slow",
  "err",
] as const;

export type ThemeColorToken = (typeof THEME_COLOR_TOKENS)[number];
export type ThemeColors = Record<ThemeColorToken, string>;

/** The CSS reference of a token, for SVG and DOM styles. */
export function cssVar(token: ThemeColorToken): string {
  return `var(--sf-${token})`;
}

/** Read every token through `read` (a custom property name → its value), trimmed. */
export function readThemeColors(read: (name: string) => string): ThemeColors {
  const colors = {} as ThemeColors;
  for (const token of THEME_COLOR_TOKENS) colors[token] = read(`--sf-${token}`).trim();
  return colors;
}

/**
 * The active theme's colors, from the root element's computed style. Outside a browser (no
 * document) every color is empty. Read again after a theme change (`watchTheme`).
 */
export function themeColors(): ThemeColors {
  if (typeof document === "undefined") return readThemeColors(() => "");
  const style = getComputedStyle(document.documentElement);
  return readThemeColors((name) => style.getPropertyValue(name));
}

/**
 * The colors read once and re-read whenever `watch` fires (then `onChange`). `read` and `watch`
 * are injected (`themeColors`, `watchTheme` in the app) so the refresh is testable.
 */
export function createThemeColorCache(
  read: () => ThemeColors,
  watch: (onChange: () => void) => () => void,
  onChange?: () => void,
): { get: () => ThemeColors; dispose: () => void } {
  let colors = read();
  const dispose = watch(() => {
    colors = read();
    onChange?.();
  });
  return { get: () => colors, dispose };
}

/**
 * Call `onChange` after the theme class of `<html>` changes (the toggle, the persisted theme
 * applied on load). Returns the unsubscribe.
 */
export function watchTheme(onChange: () => void): () => void {
  if (typeof MutationObserver === "undefined" || typeof document === "undefined") return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}
