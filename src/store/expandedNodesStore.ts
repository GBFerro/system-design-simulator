import { create } from "zustand";

/**
 * Nodes showing their instances (OBS-04). A view setting, NOT persisted and
 * never in `canvasStore`: expanding a node isn't an edit (no undo entry, works
 * on read-only tabs). The node resizes once when it toggles.
 */
interface ExpandedNodesState {
  expanded: Record<string, true>;
  toggle: (nodeId: string) => void;
}

export const useExpandedNodesStore = create<ExpandedNodesState>((set) => ({
  expanded: {},
  toggle: (nodeId) =>
    set((s) => {
      const next = { ...s.expanded };
      if (next[nodeId]) delete next[nodeId];
      else next[nodeId] = true;
      return { expanded: next };
    }),
}));
