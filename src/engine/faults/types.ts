/**
 * Chaos engineering types (Spec 08). A fault is compiled into modifiers with
 * a start, an optional end and targets; the tick loop applies whatever is
 * active at each tick. There is no fault-specific code in the loop.
 */

/** Catalog id (Spec 08, CHS-02 MVP). */
export type FaultType =
  | "kill-instances"
  | "kill-node"
  | "slow-node"
  | "traffic-spike"
  | "edge-latency"
  | "packet-loss"
  | "partition"
  | "cache-flush"
  | "db-primary-failure"
  | "consumer-stopped";

export type FaultCategory = "compute" | "network" | "data" | "traffic";

/** `group` targets arrive with groups (Spec 13, CAN-08); no MVP fault accepts them yet. */
export type FaultTargetKind = "node" | "edge" | "group" | "global";

export interface FaultTarget {
  kind: FaultTargetKind;
  /** Node or edge id (ReactFlow id); absent for `global`. */
  id?: string;
}

export interface FaultSpec {
  type: FaultType;
  target: FaultTarget;
  /** Meaning depends on the type (instances killed, extra ms, multiplier, …); see the catalog. */
  intensity?: number;
  /** Simulated seconds until it heals by itself (with `autoHeal`, the default when set). */
  durationSec?: number;
  /** false = stays until healed by hand, even with a duration. */
  autoHeal?: boolean;
}

export type FaultId = string;

export type ModifierKind =
  | "capacityMultiplier"
  | "latencyAddMs"
  | "latencyMultiplier"
  | "errorRate"
  | "severEdge"
  /** The source LB's health check took the target out of rotation: no share on this edge. */
  | "drainEdge"
  | "trafficMultiplier"
  | "hitRateOverride"
  | "nodeDown";

export interface CompiledModifier {
  kind: ModifierKind;
  /**
   * Node ids, or edge ids for edge modifiers (`latencyAddMs`, `errorRate` on
   * an edge, `severEdge`, `drainEdge`). `trafficMultiplier` with no targets is global;
   * with targets it scales those entry nodes.
   */
  targetIds: string[];
  /** Whether `targetIds` are edges (`errorRate`/`latencyAddMs` exist for both). */
  onEdges?: boolean;
  value: number;
  /** Simulated seconds. Active while startT ≤ t < endT. */
  startT: number;
  endT?: number;
  /**
   * `hitRateOverride` only: the value recovers towards `to` as
   * h(t) = to + (value − to)·e^{−(t − startT)/tauSec} (Spec 04, cache warm-up).
   */
  recover?: { to: number; tauSec: number };
}

/** One fault of the current run, as the UI shows it (panel list and timeline). */
export interface FaultRecord {
  id: FaultId;
  spec: FaultSpec;
  /** "Kill node · App Server". */
  label: string;
  startT: number;
  /** Planned end while active (auto-heal), actual end once healed. */
  endT?: number;
  active: boolean;
  /** How the model applies it (detection window, failover, …). */
  notes: string[];
}
