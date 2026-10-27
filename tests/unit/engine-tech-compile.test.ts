import { describe, expect, it } from "vitest";
import { sanitizeParams } from "@/domain/components/registry";
import { techProfileOf } from "@/domain/components/technologies/profile";
import { compileGraph } from "@/domain/graph/compile";
import { comp, compileV3, wire } from "./engineFixtures";

describe("compileGraph resolves each node's technology (T22)", () => {
  it("a generic node compiles without a `tech` key, exactly the SimNode it always was", () => {
    const sim = compileGraph([comp("db", "nosql-db", { replicationFactor: 5, instances: 3 })], []);
    const node = sim.nodes[0];
    expect("tech" in node).toBe(false);
    expect(node).toEqual({
      id: "db",
      componentId: "nosql-db",
      label: "db",
      routing: "fixed",
      params: node.params,
      instances: 3,
      capacityPerInstance: node.params.capacityPerInstance,
      serviceTimeMs: node.params.serviceTimeMs,
    });
    expect(Object.keys(node).sort()).toEqual(
      [
        "capacityPerInstance",
        "componentId",
        "id",
        "instances",
        "label",
        "params",
        "routing",
        "serviceTimeMs",
      ].sort(),
    );
  });

  it("a node with a technology carries the profile of its validated params", () => {
    const sim = compileGraph(
      [comp("db", "nosql-db", { technology: "cassandra", instances: 6 })],
      [],
    );
    const node = sim.nodes[0];
    expect(node.tech).toBeDefined();
    expect(node.tech).toEqual(techProfileOf("nosql-db", node.params));
    expect(node.tech?.technology).toBe("cassandra");
    expect(node.tech?.base.capacityPerInstance).toBe(node.capacityPerInstance);
  });

  it("Cassandra with RF 5 on 3 instances warns, without blocking", () => {
    const sim = compileGraph(
      [comp("db", "nosql-db", { technology: "cassandra", replicationFactor: 5, instances: 3 })],
      [],
    );
    expect(sim.nodes[0].tech).toBeDefined();
    expect(sim.warnings).toContain(
      "db: replication factor 5 is above its 3 instance(s), so each partition has only 3 replica(s).",
    );
    const enough = compileGraph(
      [comp("db", "nosql-db", { technology: "scylladb", replicationFactor: 3, instances: 3 })],
      [],
    );
    expect(enough.warnings.some((w) => w.includes("replication factor"))).toBe(false);
  });

  it("a MySQL replica fed by a PostgreSQL primary warns (TEC-45); the same technology doesn't", () => {
    const nodes = [
      comp("app", "app-server"),
      comp("primary", "sql-db", { technology: "postgres" }),
      comp("replica", "read-replica", { technology: "mysql" }),
    ];
    const edges = [wire("app", "primary"), wire("primary", "replica")];
    const sim = compileV3(nodes, edges);
    expect(sim.warnings).toContain(
      "replica: Replica technology differs from its primary (PostgreSQL (RDS)).",
    );
    // Still simulated: both nodes and the edge are there.
    expect(sim.nodes.map((n) => n.id)).toEqual(["app", "primary", "replica"]);
    expect(sim.edges.some((e) => e.source === "primary" && e.target === "replica")).toBe(true);

    const same = compileV3(
      [
        comp("app", "app-server"),
        comp("primary", "sql-db", { technology: "postgres" }),
        comp("replica", "read-replica", { technology: "postgres" }),
      ],
      edges,
    );
    expect(same.warnings.some((w) => w.includes("Replica technology"))).toBe(false);
  });

  it("a MySQL replica fed by a Generic primary doesn't warn: custom numbers aren't a product (TEC-45)", () => {
    const sim = compileV3(
      [
        comp("app", "app-server"),
        comp("primary", "sql-db", { technology: "generic" }),
        comp("replica", "read-replica", { technology: "mysql" }),
      ],
      [wire("app", "primary"), wire("primary", "replica")],
    );
    expect(sim.nodes.find((n) => n.id === "replica")?.tech?.technology).toBe("mysql");
    expect(sim.warnings.some((w) => w.includes("Replica technology"))).toBe(false);
  });

  it("a Generic replica fed by a PostgreSQL primary doesn't warn either (TEC-45)", () => {
    const sim = compileV3(
      [
        comp("app", "app-server"),
        comp("primary", "sql-db", { technology: "postgres" }),
        comp("replica", "read-replica", { technology: "generic" }),
      ],
      [wire("app", "primary"), wire("primary", "replica")],
    );
    expect(sim.nodes.find((n) => n.id === "primary")?.tech?.technology).toBe("postgres");
    expect(sim.warnings.some((w) => w.includes("Replica technology"))).toBe(false);
  });

  it("a design of generic nodes gets no new warnings", () => {
    const nodes = [
      comp("client", "client"),
      comp("app", "app-server"),
      comp("nosql", "nosql-db", { replicationFactor: 7, instances: 1 }),
      comp("primary", "sql-db"),
      comp("replica", "read-replica"),
    ];
    const edges = [
      wire("client", "app"),
      wire("app", "nosql"),
      wire("app", "primary"),
      wire("primary", "replica"),
    ];
    const sim = compileV3(nodes, edges);
    expect(sim.warnings).toEqual([]);
    expect(sim.nodes.every((n) => !("tech" in n))).toBe(true);
    // Their params resolve to generic.
    expect(sanitizeParams("read-replica", {}).technology).toBe("generic");
  });
});
