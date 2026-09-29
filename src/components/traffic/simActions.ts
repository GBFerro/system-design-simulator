/**
 * UI entry points for the live simulation (Spec 06). The engine, its worker
 * and Comlink load on the first play (dynamic `import()`), never with the
 * page. Until then speed/pattern changes only update `runtimeStore`; the
 * controller reads them when it starts.
 */
import type { SimController } from "@/engine/client";
import { sanitizePattern } from "@/engine/traffic/patterns";
import type { SimSpeed, TrafficPattern } from "@/engine/traffic/types";
import { useAppStore } from "@/store/appStore";
import { useCanvasStore } from "@/store/canvasStore";
import { useRuntimeStore } from "@/store/runtimeStore";

let loading: Promise<SimController> | null = null;
let controller: SimController | null = null;

function getController(): Promise<SimController> {
  loading ??= import("@/engine/client").then((m) => (controller = m.getSimController()));
  return loading;
}

export async function playSimulation(): Promise<void> {
  const { nodes, edges } = useCanvasStore.getState();
  if (!nodes.some((n) => n.type !== "text")) {
    useAppStore.getState().showToast("No components to simulate", "info");
    return;
  }
  try {
    const c = await getController();
    const started = await c.play(nodes, edges);
    if (!started) useAppStore.getState().showToast("No components to simulate", "info");
  } catch (err) {
    console.error("Live simulation failed", err);
    useRuntimeStore.getState().setPlayback("idle");
    useAppStore.getState().showToast("Simulation failed — see console for details", "error");
  }
}

export function pauseSimulation(): void {
  void controller?.pause();
}

export function togglePlayback(): void {
  if (useRuntimeStore.getState().playback === "running") pauseSimulation();
  else void playSimulation();
}

/** Back to 00:00 with empty metrics; keeps speed and pattern. */
export function resetSimulation(): void {
  if (controller) void controller.reset();
  else useRuntimeStore.getState().clear();
}

export function setSimulationSpeed(x: SimSpeed): void {
  if (controller) controller.setSpeed(x);
  else useRuntimeStore.getState().setSpeed(x);
}

/** Applied live, on the next tick. */
export function setTrafficPattern(p: TrafficPattern): void {
  const pattern = sanitizePattern(p);
  if (controller) controller.setTraffic(pattern);
  else useRuntimeStore.getState().setPattern(pattern);
}
