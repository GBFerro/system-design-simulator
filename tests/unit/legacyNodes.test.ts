import type { Edge, Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { runSimulation } from "@/engine/simulator";
import type { ComponentNodeData } from "@/store/canvasStore";

const base = { componentId: "app-server", label: "App", icon: "Server", category: "compute" };

function node(id: string, data: Record<string, unknown>): Node<ComponentNodeData> {
  return {
    id,
    type: "component",
    position: { x: 0, y: 0 },
    data: { ...base, scalable: true, ...data } as unknown as ComponentNodeData,
  };
}

const edges: Edge[] = [{ id: "e", source: "old", target: "new" }];

describe("engine with pre-v2 nodes", () => {
  it("reads capacity from the v1 fields (maxQPS x replicas) when there are no params", () => {
    const { nodeMetrics } = runSimulation(
      [
        node("old", { maxQPS: 5000, replicas: 2, latencyMs: 10 }),
        node("new", { params: { instances: 2, capacityPerInstance: 5000, serviceTimeMs: 10 } }),
      ],
      edges,
      1000,
    );
    // Same capacity either way: 10 000 QPS, so 1 000 offered is 10% utilization
    expect(nodeMetrics.get("old")?.effectiveQPS).toBe(10_000);
    expect(nodeMetrics.get("old")?.utilization).toBeCloseTo(0.1);
    expect(nodeMetrics.get("old")?.status).toBe("healthy");
  });
});
