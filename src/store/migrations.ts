import { migrateGraph, type MigrateOptions } from "@/domain/persistence/migrate";

/**
 * `migrate(persisted, fromVersion)` for every persisted store (Spec 05).
 * zustand calls these only when the stored version differs from
 * `STORE_VERSION` (./persistVersion). The graph migration (v1 → v2 → v3) is idempotent, so
 * running it on any mismatch (including a future version) is safe. Never throws.
 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function warnOnConsole(store: string): MigrateOptions["onWarning"] {
  return (message) => console.warn(`[${store} migration] ${message}`);
}

/**
 * canvasStore: `{ nodes, edges, tabs: [{ id, label, nodes, edges, readOnly? }], activeTabId }`.
 * Migrates the live (active tab) nodes/edges and every tab's snapshot.
 */
export function migrateCanvasState<T>(persisted: unknown, fromVersion: number): T {
  void fromVersion;
  if (!isRecord(persisted)) return persisted as T;
  const onWarning = warnOnConsole("canvas");
  const live = migrateGraph(persisted.nodes ?? [], persisted.edges ?? [], { onWarning });
  const tabs = Array.isArray(persisted.tabs)
    ? persisted.tabs.filter(isRecord).map((tab) => ({
        ...tab,
        ...migrateGraph(tab.nodes ?? [], tab.edges ?? [], { onWarning }),
      }))
    : persisted.tabs;
  return { ...persisted, ...live, tabs } as T;
}

/** savedDesignsStore: `{ designs: SavedDesign[] }`. */
export function migrateSavedDesignsState<T>(persisted: unknown, fromVersion: number): T {
  void fromVersion;
  if (!isRecord(persisted)) return persisted as T;
  const onWarning = warnOnConsole("saved designs");
  const designs = Array.isArray(persisted.designs)
    ? persisted.designs.filter(isRecord).map((design) => ({
        ...design,
        ...migrateGraph(design.nodes ?? [], design.edges ?? [], { onWarning }),
        strokes: Array.isArray(design.strokes) ? design.strokes : [],
      }))
    : [];
  return { ...persisted, designs } as T;
}
