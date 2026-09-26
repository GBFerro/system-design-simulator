import { toPng, toSvg } from "html-to-image";
import {
  getNodesBounds,
  getViewportForBounds,
  type Node,
  type Edge,
  type Rect,
  type Viewport,
} from "@xyflow/react";
import { getStroke } from "perfect-freehand";
import { useCanvasStore } from "@/store/canvasStore";
import { useAppStore } from "@/store/appStore";
import { usePenStore, type Stroke } from "@/store/penStore";
import { serializeNodes, serializeEdges } from "@/store/savedDesignsStore";

function getTimestamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function triggerDownload(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function getViewportElement(): HTMLElement {
  const el = document.querySelector<HTMLElement>(".react-flow__viewport");
  if (!el) throw new Error("Could not find ReactFlow viewport element");
  return el;
}

/* ---------- stroke path generation (mirrors PenOverlay) ---------- */

function outlineToPath(outline: number[][]): string {
  if (outline.length === 0) return "";
  const d: (string | number)[] = ["M", outline[0][0], outline[0][1], "Q"];
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    d.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  d.push("Z");
  return d.join(" ");
}

function strokeToPath(points: [number, number][], size: number): string {
  const outline = getStroke(points, {
    size,
    thinning: 0.5,
    smoothing: 0.55,
    streamline: 0.55,
    simulatePressure: true,
    last: true,
  }) as number[][];
  return outlineToPath(outline);
}

/* ---------- export geometry ---------- */

const BG_COLOR = "#18181b"; // zinc-900 — the app is dark-only
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const PADDING = 0.1;
const PIXEL_RATIO = 2;

function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.width, b.x + b.width);
  const y2 = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: x2 - x, height: y2 - y };
}

/**
 * Bounds (in flow coordinates) of everything worth exporting: all nodes —
 * including off-screen ones — plus all pen strokes (stored in flow coords).
 */
function getContentBounds(nodes: Node[], strokes: Stroke[]): Rect {
  let rect: Rect | null = nodes.length > 0 ? getNodesBounds(nodes) : null;

  for (const stroke of strokes) {
    // The freehand outline can extend up to ~width around the point.
    const margin = stroke.width;
    for (const [x, y] of stroke.points) {
      const point: Rect = {
        x: x - margin,
        y: y - margin,
        width: margin * 2,
        height: margin * 2,
      };
      rect = rect ? unionRect(rect, point) : point;
    }
  }

  if (!rect || rect.width <= 0 || rect.height <= 0) {
    throw new Error("Nothing to export");
  }
  return rect;
}

interface ExportGeometry {
  bounds: Rect;
  imageWidth: number;
  imageHeight: number;
  viewport: Viewport;
  strokes: Stroke[];
}

function computeExportGeometry(): ExportGeometry {
  const nodes = useCanvasStore.getState().nodes;
  const strokes = usePenStore.getState().strokes;
  const bounds = getContentBounds(nodes, strokes);

  // Size the image to the content (clamped), then compute the viewport
  // transform that frames all of it — React Flow v12 documented pattern.
  const imageWidth = Math.min(4096, Math.max(320, Math.ceil(bounds.width * 1.2)));
  const imageHeight = Math.min(4096, Math.max(240, Math.ceil(bounds.height * 1.2)));
  const viewport = getViewportForBounds(
    bounds,
    imageWidth,
    imageHeight,
    MIN_ZOOM,
    MAX_ZOOM,
    PADDING,
  );

  return { bounds, imageWidth, imageHeight, viewport, strokes };
}

function captureStyle(geom: ExportGeometry): Partial<CSSStyleDeclaration> {
  return {
    width: `${geom.imageWidth}px`,
    height: `${geom.imageHeight}px`,
    transform: `translate(${geom.viewport.x}px, ${geom.viewport.y}px) scale(${geom.viewport.zoom})`,
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/* ---------- public API ---------- */

export async function exportAsPng(problemName: string): Promise<void> {
  const viewportEl = getViewportElement();
  const geom = computeExportGeometry();
  const filename = `${slugify(problemName)}-hld-${getTimestamp()}.png`;

  const options = {
    backgroundColor: BG_COLOR,
    pixelRatio: PIXEL_RATIO,
    width: geom.imageWidth,
    height: geom.imageHeight,
    style: captureStyle(geom),
  };

  // Safari workaround: html-to-image can render a blank/partial image on
  // the first call (fonts/images not ready in the cloned tree) — call
  // twice and keep the second result.
  await toPng(viewportEl, options);
  const flowDataUrl = await toPng(viewportEl, options);

  if (geom.strokes.length === 0) {
    triggerDownload(flowDataUrl, filename);
    return;
  }

  // Composite the pen strokes (PenOverlay renders them as a sibling of
  // .react-flow, so they are not part of the captured viewport). Strokes
  // are stored in flow coordinates — replay them through the exact same
  // viewport transform used for the flow capture.
  const img = await loadImage(flowDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = geom.imageWidth * PIXEL_RATIO;
  canvas.height = geom.imageHeight * PIXEL_RATIO;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2d canvas context");

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  ctx.setTransform(PIXEL_RATIO, 0, 0, PIXEL_RATIO, 0, 0);
  ctx.translate(geom.viewport.x, geom.viewport.y);
  ctx.scale(geom.viewport.zoom, geom.viewport.zoom);
  for (const stroke of geom.strokes) {
    const path = new Path2D(strokeToPath(stroke.points, stroke.width));
    ctx.fillStyle = stroke.color;
    ctx.fill(path);
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Failed to encode PNG");
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  URL.revokeObjectURL(url);
}

export async function exportAsSvg(problemName: string): Promise<void> {
  const viewportEl = getViewportElement();
  const geom = computeExportGeometry();
  const filename = `${slugify(problemName)}-hld-${getTimestamp()}.svg`;

  // NOTE: pen strokes are intentionally NOT included in the SVG export —
  // compositing the freehand overlay into html-to-image's serialized SVG
  // (a foreignObject wrapper) is not reliably correct. The PNG export
  // includes them.
  const dataUrl = await toSvg(viewportEl, {
    backgroundColor: BG_COLOR,
    width: geom.imageWidth,
    height: geom.imageHeight,
    style: captureStyle(geom),
  });

  triggerDownload(dataUrl, filename);
}

export function exportAsJSON(
  nodes: Node[],
  edges: Edge[],
  problemName: string,
  strokes: Stroke[] = [],
): void {
  const filename = `${slugify(problemName)}-hld-${getTimestamp()}.json`;
  // Same envelope as savedDesignsStore.exportDesign so both import paths
  // (LoadDialog import + saved-design export) accept both files.
  const payload = JSON.stringify(
    {
      schemaVersion: 1,
      name: problemName,
      problemId: useAppStore.getState().selectedProblemId ?? null,
      nodes: serializeNodes(nodes),
      edges: serializeEdges(edges),
      strokes,
    },
    null,
    2,
  );
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  URL.revokeObjectURL(url);
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "design"
  );
}
