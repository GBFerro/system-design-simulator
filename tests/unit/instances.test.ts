import { describe, expect, it } from "vitest";
import type { FaultRecord, FaultSpec } from "@/engine/faults/types";
import {
  MAX_INSTANCE_CARDS,
  downInstances,
  instanceEdgeId,
  instanceLanes,
  laneOf,
} from "@/lib/instances";

const fault = (spec: FaultSpec, active = true): FaultRecord => ({
  id: "f",
  spec,
  label: "",
  startT: 0,
  active,
  notes: [],
});

describe("instances of an expanded node (OBS-04)", () => {
  it("opens into one card per instance, or MAX cards plus a stacked one", () => {
    expect(instanceLanes(2)).toEqual({ lanes: 2, stacked: 0 });
    expect(instanceLanes(MAX_INSTANCE_CARDS + 1)).toEqual({
      lanes: MAX_INSTANCE_CARDS + 1,
      stacked: 0,
    });
    expect(instanceLanes(45)).toEqual({
      lanes: MAX_INSTANCE_CARDS + 1,
      stacked: 45 - MAX_INSTANCE_CARDS,
    });
    expect(laneOf(2, 45)).toBe(2);
    expect(laneOf(30, 45)).toBe(MAX_INSTANCE_CARDS);
    expect(laneOf(4, 5)).toBe(4);
  });

  it("names the edge copies by edge and lanes; unexpanded ends keep the edge id", () => {
    expect(instanceEdgeId("e1", -1, -1)).toBe("e1");
    expect(instanceEdgeId("e1", -1, 2)).toBe("inst:e1:-1:2");
    expect(instanceEdgeId("e1", 0, 3)).toBe("inst:e1:0:3");
  });

  it("marks the instances the active faults took down, as the catalog does", () => {
    const none = downInstances([], "app", "app-server", 4);
    expect(none).toEqual([false, false, false, false]);
    expect(
      downInstances(
        [fault({ type: "kill-instances", target: { kind: "node", id: "app" }, intensity: 2 })],
        "app",
        "app-server",
        4,
      ),
    ).toEqual([false, false, true, true]);
    expect(
      downInstances(
        [fault({ type: "kill-node", target: { kind: "node", id: "app" } })],
        "app",
        "app-server",
        3,
      ),
    ).toEqual([true, true, true]);
    // A zone holds instances 0, z, 2z…: ⌈n/z⌉ of them.
    const zone = fault({ type: "zone-failure", target: { kind: "global" }, intensity: 3 });
    expect(downInstances([zone], "app", "app-server", 7)).toEqual([
      true,
      false,
      false,
      true,
      false,
      false,
      true,
    ]);
    // Managed multi-zone services ride it out; healed faults and other nodes don't count.
    expect(downInstances([zone], "cdn", "cdn", 3)).toEqual([false, false, false]);
    expect(
      downInstances(
        [fault({ type: "kill-node", target: { kind: "node", id: "app" } }, false)],
        "app",
        "app-server",
        2,
      ),
    ).toEqual([false, false]);
    expect(
      downInstances(
        [fault({ type: "kill-node", target: { kind: "node", id: "db" } })],
        "app",
        "app-server",
        2,
      ),
    ).toEqual([false, false]);
  });
});
