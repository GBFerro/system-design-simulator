import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { useCanvasStore } from "./canvasStore";
import { useAppStore } from "./appStore";
import { usePenStore, type Stroke } from "./penStore";
import { useSimulationStore } from "./simulationStore";
import { useCustomProblemsStore } from "./customProblemsStore";
import { useSloStore } from "./sloStore";
import { durableStorage } from "./durableStorage";
import { migrateSavedDesignsState } from "./migrations";
import { STORE_VERSION } from "./persistVersion";
import { PROBLEMS } from "@/data/problems";
import {
  deserializeEdges,
  deserializeNodes,
  serializeEdges,
  serializeNodes,
  type SerializedEdge,
  type SerializedNode,
} from "@/domain/persistence/serialize";
import {
  parseEnvelopeJson,
  stringifyEnvelope,
  type ChaosScript,
  type SloOverrides,
} from "@/domain/persistence/envelope";

export type {
  SerializedComponentData,
  SerializedEdge,
  SerializedNode,
  SerializedTextData,
} from "@/domain/persistence/serialize";
export { serializeEdges, serializeNodes } from "@/domain/persistence/serialize";

export interface SavedDesign {
  id: string;
  name: string;
  problemId: string | null;
  nodes: SerializedNode[];
  edges: SerializedEdge[];
  annotations: string[];
  strokes: Stroke[];
  /** Spec 08 placeholder, kept from imported files. */
  chaosScript?: ChaosScript;
  /** The design's SLO override for its problem (Spec 11). */
  slo?: SloOverrides;
  createdAt: string;
  updatedAt: string;
}

export type ImportResult = { ok: true; warnings?: string[] } | { ok: false; error: string };

interface SavedDesignsState {
  designs: SavedDesign[];
  saveDesign: (name: string) => void;
  loadDesign: (id: string) => void;
  deleteDesign: (id: string) => void;
  renameDesign: (id: string, name: string) => void;
  exportDesign: (id: string) => string;
  importDesign: (json: string) => ImportResult;
}

export const useSavedDesignsStore = create<SavedDesignsState>()(
  persist(
    (set, get) => ({
      designs: [],

      saveDesign: (name: string) => {
        const { nodes, edges } = useCanvasStore.getState();
        const { strokes } = usePenStore.getState();
        const problemId = useAppStore.getState().selectedProblemId;
        const now = new Date().toISOString();
        const id = `design-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const slo = useSloStore.getState().overrides[problemId];
        const design: SavedDesign = {
          id,
          name,
          problemId,
          nodes: serializeNodes(nodes),
          edges: serializeEdges(edges),
          annotations: [],
          strokes,
          ...(slo ? { slo } : {}),
          createdAt: now,
          updatedAt: now,
        };

        set((s) => ({ designs: [design, ...s.designs] }));
        useAppStore.getState().showToast(`Design "${name}" saved`, "success");
      },

      loadDesign: (id: string) => {
        const design = get().designs.find((d) => d.id === id);
        if (!design) return;

        const restoredNodes = deserializeNodes(design.nodes);
        const restoredEdges = deserializeEdges(design.edges);

        // Route through the tab system so a read-only reference tab is never
        // clobbered: loading always (re)targets the "My Design" tab. addTab
        // also clears node/edge selection and the undo history.
        useCanvasStore.getState().addTab({
          id: "my-design",
          label: "My Design",
          nodes: restoredNodes,
          edges: restoredEdges,
        });

        // Stale simulation metrics/score refer to the previous canvas.
        useSimulationStore.getState().reset();

        usePenStore.getState().setStrokes(design.strokes ?? []);

        // Restore problem selection if it exists, and the design's SLO for it
        // (a design saved without an override uses the problem's SLO).
        if (design.problemId) {
          useAppStore.getState().setSelectedProblem(design.problemId);
          useSloStore.getState().setOverrides(design.problemId, design.slo);
        }

        useAppStore.getState().showToast(`Loaded "${design.name}"`, "success");
      },

      deleteDesign: (id: string) => {
        set((s) => ({ designs: s.designs.filter((d) => d.id !== id) }));
      },

      renameDesign: (id: string, name: string) => {
        set((s) => ({
          designs: s.designs.map((d) =>
            d.id === id ? { ...d, name, updatedAt: new Date().toISOString() } : d,
          ),
        }));
      },

      exportDesign: (id: string) => {
        const design = get().designs.find((d) => d.id === id);
        if (!design) return "{}";
        return stringifyEnvelope({
          name: design.name,
          problemId: design.problemId,
          nodes: design.nodes,
          edges: design.edges,
          strokes: design.strokes ?? [],
          chaosScript: design.chaosScript,
          slo: design.slo,
        });
      },

      importDesign: (json: string): ImportResult => {
        const result = parseEnvelopeJson(json);
        if (!result.ok) {
          useAppStore.getState().showToast(`Invalid design file: ${result.error}`, "error");
          return result;
        }

        const { design: imported, warnings } = result;
        const now = new Date().toISOString();
        const design: SavedDesign = {
          id: `design-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: `${imported.name} (imported)`,
          problemId: imported.problemId,
          nodes: imported.nodes,
          edges: imported.edges,
          annotations: [],
          strokes: imported.strokes,
          ...(imported.chaosScript !== undefined ? { chaosScript: imported.chaosScript } : {}),
          ...(imported.slo !== undefined ? { slo: imported.slo } : {}),
          createdAt: now,
          updatedAt: now,
        };

        set((s) => ({ designs: [design, ...s.designs] }));
        if (warnings.length > 0) {
          for (const w of warnings) console.warn(`[import] ${w}`);
          useAppStore
            .getState()
            .showToast(
              `Design imported with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}: ${warnings[0]}`,
              "info",
            );
        } else {
          useAppStore.getState().showToast("Design imported", "success");
        }
        return { ok: true, warnings };
      },
    }),
    {
      name: "systemsim-saved-designs",
      version: STORE_VERSION,
      skipHydration: true,
      // IndexedDB (moved over from localStorage on first v2 run), falling
      // back to safeLocalStorage when IndexedDB is unavailable.
      storage: createJSONStorage(() => durableStorage),
      migrate: migrateSavedDesignsState,
      partialize: (state) => ({ designs: state.designs }),
      // Hydration is async now: keep anything saved/imported before it
      // finished instead of letting the stored list overwrite it.
      merge: (persisted, current) => {
        const stored = (persisted as { designs?: SavedDesign[] } | undefined)?.designs ?? [];
        const storedIds = new Set(stored.map((d) => d.id));
        return {
          ...current,
          designs: [...current.designs.filter((d) => !storedIds.has(d.id)), ...stored],
        };
      },
    },
  ),
);

/** Helper: get problem title by id (built-in or custom problems). */
export function getProblemTitle(problemId: string | null): string {
  if (!problemId) return "No problem";
  const builtin = PROBLEMS.find((p) => p.id === problemId)?.title;
  if (builtin) return builtin;
  const custom = useCustomProblemsStore.getState().problems.find((p) => p.id === problemId)?.title;
  return custom ?? problemId;
}
