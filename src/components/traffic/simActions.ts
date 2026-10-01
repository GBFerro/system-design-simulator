/**
 * UI entry points for the live simulation (Spec 06). The engine, its worker
 * and Comlink load on the first play (dynamic `import()`), never with the
 * page. Until then speed/pattern changes only update `runtimeStore`; the
 * controller reads them when it starts.
 */
import type { SimController } from "@/engine/client";
import type { FaultId, FaultRecord, FaultSpec } from "@/engine/faults/types";
import { sanitizePattern } from "@/engine/traffic/patterns";
import type { SimSpeed, TrafficPattern } from "@/engine/traffic/types";
import { useAppStore } from "@/store/appStore";
import { useCanvasStore } from "@/store/canvasStore";
import { useChaosStore } from "@/store/chaosStore";
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

/**
 * Start a fault in the live run (Spec 08). Only while a run exists (running
 * or paused); the error comes back as a toast. Returns the fault's id, or null.
 */
export async function injectFault(spec: FaultSpec): Promise<FaultId | null> {
  const toast = useAppStore.getState().showToast;
  if (!controller || useRuntimeStore.getState().playback === "idle") {
    toast("Play the simulation first: faults act on a live run", "info");
    return null;
  }
  try {
    const r = await controller.inject(spec);
    if (!r.ok) {
      toast(r.error, "error");
      return null;
    }
    return r.id;
  } catch (err) {
    console.error("Fault injection failed", err);
    toast("Fault injection failed — see console for details", "error");
    return null;
  }
}

export function healFault(id: FaultId): void {
  void controller?.heal(id);
}

/** Active kill faults (node or instances) on a node: what "Restore" heals. */
export function killFaultsOf(faults: readonly FaultRecord[], nodeId: string): FaultRecord[] {
  return faults.filter(
    (f) =>
      f.active &&
      f.spec.target.id === nodeId &&
      (f.spec.type === "kill-node" || f.spec.type === "kill-instances"),
  );
}

/**
 * Canvas Kill/Restore shortcut (node toolbar, context menu): kills the node
 * until restored, or heals the kills on it.
 */
export function toggleKillNode(nodeId: string): void {
  const kills = killFaultsOf(useChaosStore.getState().faults, nodeId);
  if (kills.length > 0) for (const f of kills) healFault(f.id);
  else void injectFault({ type: "kill-node", target: { kind: "node", id: nodeId } });
}

/** Kill one instance until restored (context menu). */
export function killOneInstance(nodeId: string): void {
  void injectFault({ type: "kill-instances", target: { kind: "node", id: nodeId }, intensity: 1 });
}
