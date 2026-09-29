"use client";

import { useEffect, useRef } from "react";
import { useStoreApi } from "@xyflow/react";
import { getLatestSnapshot, useRuntimeStore } from "@/store/runtimeStore";
import { useCanvasStore } from "@/store/canvasStore";
import { usePrefersReducedMotion } from "@/hooks/useBreakpoint";
import { EDGE_STATUS_COLOR, MAX_PARTICLES, particleBudget, particleSpeed } from "@/lib/particles";
import type { RuntimeEdgeStatus, TickSnapshot } from "@/engine/types";

/**
 * OBS-04: tokens moving along the edges, drawn on ONE <canvas> 2D layer over
 * the ReactFlow renderer (never a DOM element per token).
 *
 * - Geometry: each edge's rendered SVG path (`.react-flow__edge-path`, i.e. the
 *   exact path the edge component drew) is sampled with `getPointAtLength`
 *   into evenly spaced flow-coordinate points, cached by the path's `d`.
 *   Resampling happens only after the graph changes (nodes/edges/measured
 *   sizes); the viewport is applied as a canvas transform read from the
 *   ReactFlow store each frame, so pan/zoom never resamples.
 * - Density ∝ log10(1 + rps), global cap of 2,000 particles (`particleBudget`).
 * - Color by edge status (ok/slow/error); async edges draw dashes, not dots.
 * - One rAF loop reads `getLatestSnapshot()` — no React render per frame. It
 *   stops when there's no snapshot or the tab is hidden, and draws a single
 *   still frame while playback is paused.
 * - `prefers-reduced-motion`: nothing is drawn (edges still show load by
 *   thickness and status by color).
 *
 * `data-particle-count` reports the particles in the last frame and
 * `data-draw-ms` the mean cost of drawing one frame (tests, perf checks).
 */

/** Flow-px between sampled points on an edge path. */
const SAMPLE_STEP = 8;
const MAX_SAMPLES = 160;
const DOT_RADIUS = 2.2;
const DASH_LENGTH = 7;

interface EdgeGeometry {
  d: string;
  /** x0, y0, x1, y1, … evenly spaced by arc length. */
  pts: Float32Array;
  length: number;
  async: boolean;
}

interface Plan {
  snapshot: TickSnapshot;
  geometryVersion: number;
  items: { geo: EdgeGeometry; count: number; speed: number; status: RuntimeEdgeStatus }[];
  total: number;
}

function samplePath(path: SVGPathElement, d: string, async: boolean): EdgeGeometry | null {
  let length: number;
  try {
    length = path.getTotalLength();
  } catch {
    return null;
  }
  if (!(length > 0)) return null;
  const n = Math.min(MAX_SAMPLES, Math.max(8, Math.ceil(length / SAMPLE_STEP) + 1));
  const pts = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const p = path.getPointAtLength((i / (n - 1)) * length);
    pts[i * 2] = p.x;
    pts[i * 2 + 1] = p.y;
  }
  return { d, pts, length, async };
}

/** Point (and direction) at fraction `f` ∈ [0, 1) of the sampled path. */
function pointAt(geo: EdgeGeometry, f: number, out: Float32Array): void {
  const segs = geo.pts.length / 2 - 1;
  const x = f * segs;
  const i = Math.min(segs - 1, Math.floor(x));
  const t = x - i;
  const ax = geo.pts[i * 2];
  const ay = geo.pts[i * 2 + 1];
  const bx = geo.pts[i * 2 + 2];
  const by = geo.pts[i * 2 + 3];
  out[0] = ax + (bx - ax) * t;
  out[1] = ay + (by - ay) * t;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  out[2] = dx / len;
  out[3] = dy / len;
}

export function FlowParticles() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rfStore = useStoreApi();
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const overlay: HTMLCanvasElement = canvas; // stays narrowed inside hoisted functions

    let lastCount = -1;
    const setCount = (n: number) => {
      if (n === lastCount) return;
      lastCount = n;
      canvas.dataset.particleCount = String(n);
    };
    const clear = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };

    if (reduceMotion) {
      clear();
      setCount(0);
      return;
    }

    /* ----- canvas size (device pixels) ----- */
    let dpr = 1;
    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      requestFrame();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    /* ----- geometry cache ----- */
    const geometry = new Map<string, EdgeGeometry>();
    let geometryVersion = 0;
    // Frames left in which to re-read edge paths: a graph change renders on
    // the next commit and ReactFlow may re-measure nodes a frame later.
    let dirtyFrames = 3;
    const markDirty = () => {
      dirtyFrames = 3;
      requestFrame();
    };

    const resample = () => {
      const root = canvas.closest(".react-flow") ?? canvas.parentElement;
      if (!root) return;
      const asyncById = new Map(
        useCanvasStore.getState().edges.map((e) => [e.id, e.data?.async === true]),
      );
      const seen = new Set<string>();
      let changed = false;
      for (const g of root.querySelectorAll<SVGGElement>(".react-flow__edge[data-id]")) {
        const id = g.dataset.id;
        const path = g.querySelector<SVGPathElement>("path.react-flow__edge-path");
        const d = path?.getAttribute("d");
        if (!id || !path || !d) continue;
        seen.add(id);
        const async = asyncById.get(id) ?? false;
        const cached = geometry.get(id);
        if (cached && cached.d === d && cached.async === async) continue;
        const geo = samplePath(path, d, async);
        if (geo) geometry.set(id, geo);
        else geometry.delete(id);
        changed = true;
      }
      for (const id of geometry.keys()) {
        if (!seen.has(id)) {
          geometry.delete(id);
          changed = true;
        }
      }
      if (changed) geometryVersion++;
    };

    /* ----- per-snapshot plan (budget) ----- */
    let plan: Plan | null = null;
    const planFor = (snapshot: TickSnapshot): Plan => {
      if (plan && plan.snapshot === snapshot && plan.geometryVersion === geometryVersion) {
        return plan;
      }
      const entries: { geo: EdgeGeometry; rps: number; status: RuntimeEdgeStatus }[] = [];
      for (const [id, geo] of geometry) {
        const m = snapshot.edges[id];
        if (m && m.rps > 0) entries.push({ geo, rps: m.rps, status: m.status });
      }
      const counts = particleBudget(
        entries.map((e) => ({ rps: e.rps, length: e.geo.length })),
        MAX_PARTICLES,
      );
      const items = entries.map((e, i) => ({
        geo: e.geo,
        count: counts[i],
        speed: particleSpeed(e.rps),
        status: e.status,
      }));
      plan = {
        snapshot,
        geometryVersion,
        items,
        total: counts.reduce((s, n) => s + n, 0),
      };
      return plan;
    };

    /* ----- drawing ----- */
    const tmp = new Float32Array(4);
    const STATUSES: RuntimeEdgeStatus[] = ["ok", "slow", "error"];

    const draw = (nowMs: number, snapshot: TickSnapshot) => {
      const p = planFor(snapshot);
      const [tx, ty, zoom] = rfStore.getState().transform;
      clear();
      ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * tx, dpr * ty);
      const tSec = nowMs / 1000;

      // Batch by (status, sync/async): one fill or stroke call per group.
      for (const status of STATUSES) {
        const color = EDGE_STATUS_COLOR[status];

        ctx.beginPath();
        for (const it of p.items) {
          if (it.status !== status || it.geo.async || it.count === 0) continue;
          const phase = ((tSec * it.speed) / it.geo.length) % 1;
          for (let k = 0; k < it.count; k++) {
            pointAt(it.geo, (phase + k / it.count) % 1, tmp);
            ctx.moveTo(tmp[0] + DOT_RADIUS, tmp[1]);
            ctx.arc(tmp[0], tmp[1], DOT_RADIUS, 0, Math.PI * 2);
          }
        }
        ctx.fillStyle = color;
        ctx.fill();

        ctx.beginPath();
        for (const it of p.items) {
          if (it.status !== status || !it.geo.async || it.count === 0) continue;
          const phase = ((tSec * it.speed) / it.geo.length) % 1;
          for (let k = 0; k < it.count; k++) {
            pointAt(it.geo, (phase + k / it.count) % 1, tmp);
            const h = DASH_LENGTH / 2;
            ctx.moveTo(tmp[0] - tmp[2] * h, tmp[1] - tmp[3] * h);
            ctx.lineTo(tmp[0] + tmp[2] * h, tmp[1] + tmp[3] * h);
          }
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.stroke();
      }
      setCount(p.total);
    };

    /* ----- loop ----- */
    let raf = 0;
    // Mean main-thread cost of `draw` over the last 30 frames → data-draw-ms.
    let drawMsSum = 0;
    let drawFrames = 0;
    function requestFrame() {
      if (raf === 0) raf = requestAnimationFrame(frame);
    }
    function frame(now: number) {
      raf = 0;
      const snapshot = getLatestSnapshot();
      if (!snapshot || document.hidden) {
        clear();
        setCount(0);
        return; // stopped: a new snapshot / visibility change restarts it
      }
      if (dirtyFrames > 0) {
        dirtyFrames--;
        resample();
      }
      const t0 = performance.now();
      draw(now, snapshot);
      drawMsSum += performance.now() - t0;
      if (++drawFrames === 30) {
        overlay.dataset.drawMs = (drawMsSum / drawFrames).toFixed(2);
        drawMsSum = 0;
        drawFrames = 0;
      }
      // Paused: keep the still frame; only a change requests another one.
      if (useRuntimeStore.getState().playback !== "paused" || dirtyFrames > 0) requestFrame();
    }

    const unsubRuntime = useRuntimeStore.subscribe((s, prev) => {
      if (s.latest !== prev.latest || s.playback !== prev.playback) requestFrame();
    });
    const unsubCanvas = useCanvasStore.subscribe((s, prev) => {
      if (s.nodes !== prev.nodes || s.edges !== prev.edges) markDirty();
    });
    const unsubRf = rfStore.subscribe((s, prev) => {
      if (s.nodeLookup !== prev.nodeLookup || s.edges !== prev.edges) markDirty();
      else if (s.transform !== prev.transform) requestFrame();
    });
    const onVisibility = () => {
      if (!document.hidden) requestFrame();
    };
    document.addEventListener("visibilitychange", onVisibility);

    resize();

    return () => {
      cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      unsubRuntime();
      unsubCanvas();
      unsubRf();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reduceMotion, rfStore]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="flow-particles"
      data-particle-count={0}
      data-reduced-motion={reduceMotion ? "true" : "false"}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ zIndex: 4 }}
    />
  );
}
