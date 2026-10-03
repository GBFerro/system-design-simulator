"use client";

import { useEffect, useRef } from "react";
import { useStoreApi } from "@xyflow/react";
import { getLatestSnapshot, useRuntimeStore } from "@/store/runtimeStore";
import { useCanvasStore } from "@/store/canvasStore";
import { usePrefersReducedMotion } from "@/hooks/useBreakpoint";
import { BALL_COLOR, BALL_OUTLINE, EDGE_STATUS_COLOR } from "@/lib/particles";
import {
  BURST_SEC,
  FlowBalls,
  buildTopology,
  type FlowEnv,
  type FlowTopology,
  type InstanceLayout,
} from "@/lib/flowBalls";
import { downInstances } from "@/lib/instances";
import { useChaosStore } from "@/store/chaosStore";
import { useExpandedNodesStore } from "@/store/expandedNodesStore";
import type { ComponentNodeData } from "@/store/canvasStore";
import { PARAM, instancesOf, routingFor } from "@/domain/components/registry";
import { formatRps } from "@/components/traffic/format";
import { edgeRuleOf } from "@/domain/graph/edgeRules";
import type { RuntimeEdgeStatus, TickSnapshot } from "@/engine/types";

/**
 * OBS-04: request balls walking the graph, drawn on ONE <canvas> 2D layer over
 * the ReactFlow renderer (never a DOM element per ball).
 *
 * - Geometry: each edge's rendered SVG path (`.react-flow__edge-path`, i.e. the
 *   exact path the edge component drew) is sampled with `getPointAtLength`
 *   into evenly spaced flow-coordinate points, cached by the path's `d`.
 *   Resampling happens only after the graph changes (nodes/edges/measured
 *   sizes); the viewport is applied as a canvas transform read from the
 *   ReactFlow store each frame, so pan/zoom never resamples.
 * - Balls (`lib/flowBalls.ts`): one ball = `quantum` req/s, born at the entries
 *   and routed like a request (a load balancer picks one edge, other nodes
 *   follow their call plan step by step, waiting for each sync call's
 *   response); a failure at a node shows a burst. Global cap of 2,000 balls.
 *   The legend shows the quantum.
 * - Expanded nodes (one card per instance, `instanceGraph.ts`): their edges are
 *   drawn once per card, and a ball takes the copy to the instance it picked.
 * - Ball color by edge status (ok = white, so it stands out on the cyan edge;
 *   slow/error amber/rose) with a dark outline; on async edges the ball is a
 *   hollow ring.
 * - One rAF loop reads `getLatestSnapshot()` — no React render per frame. It
 *   stops when there's no snapshot or the tab is hidden, and draws a single
 *   still frame while playback is paused (the balls hold still).
 * - `prefers-reduced-motion`: nothing is drawn (edges still show load by
 *   thickness and status by color).
 *
 * `data-particle-count` reports the balls in the last frame, `data-ball-quantum`
 * the req/s per ball and `data-draw-ms` the mean cost of drawing one frame
 * (tests, perf checks).
 */

/** Flow-px between sampled points on an edge path. */
const SAMPLE_STEP = 8;
const MAX_SAMPLES = 160;
const BALL_RADIUS = 4.5;
/** Longest step of the ball simulation per frame (after a stall), seconds. */
const MAX_FRAME_DT = 0.1;

interface EdgeGeometry {
  d: string;
  /** x0, y0, x1, y1, … evenly spaced by arc length. */
  pts: Float32Array;
  length: number;
  async: boolean;
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

/** Point (and direction) at fraction `f` ∈ [0, 1] of the sampled path. */
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
  const legendRef = useRef<HTMLSpanElement>(null);
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
    // The legend is updated in place (no React render per frame).
    let lastQuantum = -1;
    const setLegend = (quantum: number | null) => {
      const q = quantum ?? 0;
      if (q === lastQuantum) return;
      lastQuantum = q;
      const legend = legendRef.current;
      const box = legend?.parentElement;
      if (quantum === null) {
        delete canvas.dataset.ballQuantum;
        if (box) box.hidden = true;
        return;
      }
      canvas.dataset.ballQuantum = String(quantum);
      if (legend && box) {
        legend.textContent = `= ${formatRps(quantum)} req/s`;
        box.hidden = false;
      }
    };
    const clear = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };

    if (reduceMotion) {
      clear();
      setCount(0);
      setLegend(null);
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
      // The rendered edges: copies drawn to instance cards carry their edge's data.
      const asyncById = new Map(
        rfStore.getState().edges.map((e) => [e.id, e.data?.async === true]),
      );
      const seen = new Set<string>();
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
      }
      for (const id of geometry.keys()) {
        if (!seen.has(id)) geometry.delete(id);
      }
    };

    /* ----- topology (who calls whom, routing per node) ----- */
    let topology: FlowTopology | null = null;
    const topologyNow = (): FlowTopology => {
      if (topology) return topology;
      const { nodes, edges } = useCanvasStore.getState();
      const components = nodes.filter((n) => n.type !== "text");
      const componentOf = new Map(
        components.map((n) => [n.id, (n.data as { componentId?: string }).componentId ?? "custom"]),
      );
      const paramsOf = new Map(
        components.map((n) => [n.id, (n.data as { params?: Record<string, unknown> }).params]),
      );
      // Each edge's calls (normalized like the compiler reads them), so the
      // balls follow the same call plan as the engine (AD-002).
      topology = buildTopology(
        edges
          .filter((e) => componentOf.has(e.source) && componentOf.has(e.target))
          .map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            async: e.data?.async === true,
            calls: edgeRuleOf({ nodes, edges }, e).calls,
          })),
        (id) => routingFor(componentOf.get(id) ?? "custom"),
        (id) => {
          const algo = paramsOf.get(id)?.[PARAM.lbAlgorithm];
          return typeof algo === "string" ? algo : undefined;
        },
        (id) => typeof paramsOf.get(id)?.[PARAM.hitRate] === "number",
      );
      return topology;
    };

    /* ----- balls ----- */
    const balls = new FlowBalls();
    // Down instances, per frame (the faults change between frames at most).
    let downCache = new Map<string, readonly boolean[]>();
    const instanceLayout = (nodeId: string): InstanceLayout | undefined => {
      if (!useExpandedNodesStore.getState().expanded[nodeId]) return undefined;
      const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
      if (!node || node.type !== "component") return undefined;
      const data = node.data as ComponentNodeData;
      const count = instancesOf(data);
      if (count <= 1) return undefined;
      let down = downCache.get(nodeId);
      if (!down) {
        down = downInstances(useChaosStore.getState().faults, nodeId, data.componentId, count);
        downCache.set(nodeId, down);
      }
      return { count, down };
    };
    const env: FlowEnv = {
      lengthOf: (id) => geometry.get(id)?.length,
      instancesOf: instanceLayout,
    };
    let lastStepMs: number | null = null;

    /* ----- drawing ----- */
    const tmp = new Float32Array(4);
    const STATUSES: RuntimeEdgeStatus[] = ["ok", "slow", "error"];

    const draw = (snapshot: TickSnapshot) => {
      const [tx, ty, zoom] = rfStore.getState().transform;
      clear();
      ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * tx, dpr * ty);

      // Batch by (status, sync/async): one path per group.
      for (const status of STATUSES) {
        for (const async of [false, true]) {
          ctx.beginPath();
          let any = false;
          for (const b of balls.balls) {
            const geo = geometry.get(b.drawn);
            if (!geo || geo.async !== async) continue;
            if ((snapshot.edges[b.edge]?.status ?? "ok") !== status) continue;
            pointAt(geo, Math.min(1, b.pos / geo.length), tmp);
            ctx.moveTo(tmp[0] + BALL_RADIUS, tmp[1]);
            ctx.arc(tmp[0], tmp[1], BALL_RADIUS, 0, Math.PI * 2);
            any = true;
          }
          if (!any) continue;
          // Sync: a solid ball with a dark outline. Async: a hollow ring.
          ctx.fillStyle = async ? BALL_OUTLINE : BALL_COLOR[status];
          ctx.fill();
          ctx.strokeStyle = async ? BALL_COLOR[status] : BALL_OUTLINE;
          ctx.lineWidth = async ? 2 : 1.5;
          ctx.stroke();
        }
      }

      // Failed requests: a fading ring where they died (the end of the edge they came in on).
      ctx.strokeStyle = EDGE_STATUS_COLOR.error;
      ctx.lineWidth = 1.5;
      for (const burst of balls.bursts) {
        const geo = geometry.get(burst.edge);
        if (!geo) continue;
        pointAt(geo, 1, tmp);
        const k = burst.age / BURST_SEC;
        ctx.globalAlpha = 1 - k;
        ctx.beginPath();
        ctx.arc(tmp[0], tmp[1], BALL_RADIUS + 9 * k, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      setCount(balls.balls.length);
      setLegend(balls.balls.length > 0 ? balls.quantum : null);
    };

    /* ----- loop ----- */
    let raf = 0;
    // Mean main-thread cost of a frame over the last 30 frames → data-draw-ms.
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
        balls.clear();
        lastStepMs = null;
        setCount(0);
        setLegend(null);
        return; // stopped: a new snapshot / visibility change restarts it
      }
      if (dirtyFrames > 0) {
        dirtyFrames--;
        resample();
      }
      const t0 = performance.now();
      // Paused: the balls hold still (a still frame on pan/zoom).
      const paused = useRuntimeStore.getState().playback === "paused";
      const dt =
        paused || lastStepMs === null ? 0 : Math.min(MAX_FRAME_DT, (now - lastStepMs) / 1000);
      lastStepMs = paused ? null : now;
      downCache = new Map();
      if (dt > 0) balls.step(dt, snapshot, topologyNow(), env);
      draw(snapshot);
      drawMsSum += performance.now() - t0;
      if (++drawFrames === 30) {
        overlay.dataset.drawMs = (drawMsSum / drawFrames).toFixed(2);
        drawMsSum = 0;
        drawFrames = 0;
      }
      // Paused: keep the still frame; only a change requests another one.
      if (!paused || dirtyFrames > 0) requestFrame();
    }

    const unsubRuntime = useRuntimeStore.subscribe((s, prev) => {
      if (s.latest !== prev.latest || s.playback !== prev.playback) requestFrame();
    });
    // Expanding a node changes what is drawn (cards, edge copies).
    const unsubExpanded = useExpandedNodesStore.subscribe(markDirty);
    const unsubCanvas = useCanvasStore.subscribe((s, prev) => {
      if (s.nodes !== prev.nodes || s.edges !== prev.edges) {
        topology = null;
        markDirty();
      }
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
      unsubExpanded();
      unsubRf();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reduceMotion, rfStore]);

  return (
    <>
      <canvas
        ref={canvasRef}
        data-testid="flow-particles"
        data-particle-count={0}
        data-reduced-motion={reduceMotion ? "true" : "false"}
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ zIndex: 4 }}
      />
      <div
        hidden
        data-testid="ball-legend"
        title="Each ball stands for this much traffic and follows a request through the design"
        className="absolute left-3 top-3 z-[5] flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950/80 px-2 py-1 font-mono text-[11px] text-zinc-300"
      >
        <span
          className="inline-block h-2.5 w-2.5 rounded-full border border-zinc-950 bg-slate-50"
          aria-hidden
        />
        <span ref={legendRef} />
      </div>
    </>
  );
}
