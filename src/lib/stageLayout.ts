/**
 * The stage layout (Papel quente slice 3): the canvas fills the screen and the top bar, the rail,
 * the panel and the palette float over it as cards. These are the numbers the cards are laid out
 * with; AppShell turns them into inline styles. Nothing here depends on the React Flow host, so
 * toggling a card never resizes it.
 */

/** Distance of the rail, the panel and the palette from the screen's edges. */
export const STAGE_SIDE = 16;
/** Top of the rail, the panel and the palette: under the top bar. */
export const STAGE_TOP = 84;
/** The top bar's distance from the edges at 1024 px and up (under it the bar needs the room). */
export const TOPBAR_INSET = 16;
export const TOPBAR_INSET_NARROW = 8;

export const RAIL_WIDTH = 210;
/** The rail collapsed to an icon column (at most 56 px). */
export const RAIL_ICON_WIDTH = 56;
export const PANEL_WIDTH_WIDE = 340;
export const PANEL_WIDTH_NARROW = 300;
export const PALETTE_WIDTH = 260;
/**
 * The palette card ends this far above the screen's bottom: the zoom controls, the minimap toggle
 * and the minimap (stacked above them, up to ~240 px) stay uncovered at the canvas's bottom-left.
 */
export const PALETTE_BOTTOM = 256;

/** Viewport widths from which the layout grows. */
export const MEDIUM_MIN = 1024;
export const WIDE_MIN = 1280;

export interface PlainRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const inRect = (p: { x: number; y: number }, r: PlainRect) =>
  p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;

/**
 * Whether a palette drop at `p` lands on the canvas: inside its rect and under no floating card
 * (the canvas runs under the cards, which cover part of it).
 */
export function pointOverCanvas(
  p: { x: number; y: number },
  canvas: PlainRect | undefined,
  cards: readonly PlainRect[],
): boolean {
  if (!canvas || !inRect(p, canvas)) return false;
  return !cards.some((card) => inRect(p, card));
}

/** How far floating cards cover each edge of the canvas box, in px. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** A card this wide (or tall) as a share of the canvas spans it: a bar, not a corner card. */
const STRIP_SHARE = 0.6;

/**
 * How much of each edge of `canvas` the `cards` cover (all in the same coordinates): the part of
 * the canvas the cards leave is the box inside these insets, which is where fitView and tap-add
 * work. A card counts for the edge it belongs to: a bar across the canvas (the top bar, a dock)
 * for the nearer of the top and bottom, a column down it (the panel) for the nearer of the left and
 * right, any other card (the rail, the palette) for the nearest edge. A card with no size (a closed
 * one) or none on the canvas counts for nothing.
 */
export function cardInsets(canvas: PlainRect, cards: readonly PlainRect[]): Insets {
  const insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  const width = canvas.right - canvas.left;
  const height = canvas.bottom - canvas.top;
  for (const card of cards) {
    const w = card.right - card.left;
    const h = card.bottom - card.top;
    if (w <= 0 || h <= 0) continue;
    if (card.right <= canvas.left || card.left >= canvas.right) continue;
    if (card.bottom <= canvas.top || card.top >= canvas.bottom) continue;

    // distance from each canvas edge to the card's nearer side
    const gap = {
      left: card.left - canvas.left,
      right: canvas.right - card.right,
      top: card.top - canvas.top,
      bottom: canvas.bottom - card.bottom,
    };
    const horizontal = w >= STRIP_SHARE * width;
    const vertical = !horizontal && h >= STRIP_SHARE * height;
    const edges = horizontal
      ? (["top", "bottom"] as const)
      : vertical
        ? (["left", "right"] as const)
        : (["left", "right", "top", "bottom"] as const);
    const edge = edges.reduce((best, e) => (gap[e] < gap[best] ? e : best));
    if (edge === "left") insets.left = Math.max(insets.left, card.right - canvas.left);
    else if (edge === "right") insets.right = Math.max(insets.right, canvas.right - card.left);
    else if (edge === "top") insets.top = Math.max(insets.top, card.bottom - canvas.top);
    else insets.bottom = Math.max(insets.bottom, canvas.bottom - card.top);
  }
  return insets;
}

/**
 * What the canvas's own overlays (the read-only hint, the pen toolbar, the welcome) keep clear of,
 * from the stage's metrics and which cards are open: AppShell sets these as the CSS variables
 * `--stage-inset-top/-left/-right` on the canvas layer. The rail is always there; the palette
 * (260 px) is wider than the rail when it is open under it.
 */
export function stageInsets(
  metrics: StageMetrics,
  open: { palette: boolean; panel: boolean },
): { top: number; left: number; right: number } {
  return {
    top: metrics.top,
    left: metrics.side + Math.max(metrics.railWidth, open.palette ? metrics.paletteWidth : 0),
    right: open.panel ? metrics.side + metrics.panelWidth : 0,
  };
}

/** The canvas's tab bar (open with a reference) floats at the top of the free area: this tall with its gap. */
export const STAGE_TABS_HEIGHT = 40;

/**
 * The CSS variables AppShell sets on the canvas layer, for the canvas's own overlays: the free
 * area's three insets, and how far down the tab bar takes the top of it (0 with a single tab).
 */
export function stageCssVars(
  insets: { top: number; left: number; right: number },
  tabBar: boolean,
): Record<`--stage-${string}`, string> {
  return {
    "--stage-inset-top": `${insets.top}px`,
    "--stage-inset-left": `${insets.left}px`,
    "--stage-inset-right": `${insets.right}px`,
    "--stage-tabs": `${tabBar ? STAGE_TABS_HEIGHT : 0}px`,
  };
}

export interface StageMetrics {
  topbarInset: number;
  side: number;
  top: number;
  railCollapsed: boolean;
  railWidth: number;
  panelWidth: number;
  paletteWidth: number;
  paletteBottom: number;
}

/**
 * The cards' sizes for a viewport. `railCollapsedOverride` is the user's choice (the rail's
 * toggle): `null` follows the screen (collapsed under 1280 px, open from 1280 px).
 */
export function stageMetrics(
  viewport: { medium: boolean; wide: boolean },
  railCollapsedOverride: boolean | null,
): StageMetrics {
  const railCollapsed = railCollapsedOverride ?? !viewport.wide;
  return {
    topbarInset: viewport.medium ? TOPBAR_INSET : TOPBAR_INSET_NARROW,
    side: STAGE_SIDE,
    top: STAGE_TOP,
    railCollapsed,
    railWidth: railCollapsed ? RAIL_ICON_WIDTH : RAIL_WIDTH,
    panelWidth: viewport.wide ? PANEL_WIDTH_WIDE : PANEL_WIDTH_NARROW,
    paletteWidth: PALETTE_WIDTH,
    paletteBottom: PALETTE_BOTTOM,
  };
}
