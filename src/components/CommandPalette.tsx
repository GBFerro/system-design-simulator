"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useReactFlow, type Node } from "@xyflow/react";
import {
  Search,
  Play,
  Trophy,
  Save,
  FolderOpen,
  GraduationCap,
  Download,
  Trash2,
  Undo2,
  Redo2,
  Coffee,
  Box,
  Puzzle,
  CornerDownLeft,
  HelpCircle,
} from "lucide-react";
import { SYSTEM_COMPONENTS } from "@/data/components";
import type { SystemComponent } from "@/types/component";
import { PROBLEMS } from "@/data/problems";
import { useCustomProblemsStore } from "@/store/customProblemsStore";
import { useCustomComponentsStore } from "@/store/customComponentsStore";
import { useCanvasStore, type ComponentNodeData } from "@/store/canvasStore";
import { useAppStore } from "@/store/appStore";
import { ICON_MAP } from "@/lib/icons";

interface CommandItem {
  id: string;
  group: "Actions" | "Problems" | "Components";
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  actions: {
    onSimulate: () => void;
    onScore: () => void;
    onSave: () => void;
    onLoad: () => void;
    onStartInterview: () => void;
    onLoadReference: () => void;
    onClear: () => void;
    onOpenSupport: () => void;
    onShowGuide: () => void;
  };
}

/** Subsequence fuzzy match — returns true if all chars of q appear in order in s. */
function fuzzy(q: string, s: string): boolean {
  let i = 0;
  for (const ch of q) {
    i = s.indexOf(ch, i);
    if (i === -1) return false;
    i++;
  }
  return true;
}

/**
 * Relevance score for a query against a label. Higher = better; -1 = no match.
 * Exact > prefix > word-prefix > substring > subsequence, so the best matches
 * (components included) always surface at the top regardless of group.
 */
function scoreMatch(query: string, label: string): number {
  const q = query.toLowerCase();
  const s = label.toLowerCase();
  if (s === q) return 1000;
  if (s.startsWith(q)) return 700 - s.length;
  if (s.split(/[\s/\-_]+/).some((w) => w.startsWith(q))) return 500 - s.length;
  const idx = s.indexOf(q);
  if (idx >= 0) return 300 - idx;
  if (fuzzy(q, s)) return 100 - s.length;
  return -1;
}

export function CommandPalette({ open, onClose, actions }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { screenToFlowPosition } = useReactFlow();
  const addNode = useCanvasStore((s) => s.addNode);
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);
  const setSelectedProblem = useAppStore((s) => s.setSelectedProblem);
  const setActiveLeftTab = useAppStore((s) => s.setActiveLeftTab);
  const showToast = useAppStore((s) => s.showToast);
  const customProblems = useCustomProblemsStore((s) => s.problems);
  const customComponents = useCustomComponentsStore((s) => s.components);

  const addComponent = useCallback(
    (component: SystemComponent) => {
      const wrapper = document.querySelector(".react-flow");
      const rect = wrapper?.getBoundingClientRect();
      const center = screenToFlowPosition({
        x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
        y: rect ? rect.top + rect.height / 2 : window.innerHeight / 2,
      });
      const jitter = () => (Math.random() - 0.5) * 60;
      const node: Node<ComponentNodeData> = {
        id: `${component.id}-${crypto.randomUUID?.() ?? Date.now().toString(36)}`,
        type: "component",
        position: { x: center.x + jitter(), y: center.y + jitter() },
        data: {
          componentId: component.id,
          label: component.label,
          icon: component.icon,
          category: component.category,
          replicas: 1,
          maxQPS: component.maxQPS,
          latencyMs: component.latencyMs,
          scalable: component.scalable,
        },
      };
      addNode(node);
      showToast(`Added ${component.label}`, "success");
    },
    [screenToFlowPosition, addNode, showToast],
  );

  const allComponents = useMemo<SystemComponent[]>(
    () => [...SYSTEM_COMPONENTS, ...customComponents],
    [customComponents],
  );

  const items = useMemo<CommandItem[]>(() => {
    const a = actions;
    const actionItems: CommandItem[] = [
      {
        id: "act-guide",
        group: "Actions",
        label: "How SystemForge works",
        icon: HelpCircle,
        run: a.onShowGuide,
      },
      {
        id: "act-sim",
        group: "Actions",
        label: "Run simulation",
        hint: "⌘↵",
        icon: Play,
        run: a.onSimulate,
      },
      {
        id: "act-score",
        group: "Actions",
        label: "Score design",
        hint: "⌘⇧S",
        icon: Trophy,
        run: a.onScore,
      },
      {
        id: "act-ref",
        group: "Actions",
        label: "Load reference solution",
        icon: Download,
        run: a.onLoadReference,
      },
      {
        id: "act-interview",
        group: "Actions",
        label: "Start practice interview",
        icon: GraduationCap,
        run: a.onStartInterview,
      },
      {
        id: "act-save",
        group: "Actions",
        label: "Save design",
        hint: "⌘S",
        icon: Save,
        run: a.onSave,
      },
      {
        id: "act-load",
        group: "Actions",
        label: "Load design",
        hint: "⌘O",
        icon: FolderOpen,
        run: a.onLoad,
      },
      { id: "act-undo", group: "Actions", label: "Undo", hint: "⌘Z", icon: Undo2, run: undo },
      { id: "act-redo", group: "Actions", label: "Redo", hint: "⌘⇧Z", icon: Redo2, run: redo },
      { id: "act-clear", group: "Actions", label: "Clear canvas", icon: Trash2, run: a.onClear },
      {
        id: "act-support",
        group: "Actions",
        label: "Support the project",
        icon: Coffee,
        run: a.onOpenSupport,
      },
    ];
    const problemItems: CommandItem[] = [...PROBLEMS, ...customProblems].map((p) => ({
      id: `prob-${p.id}`,
      group: "Problems",
      label: p.title,
      hint: "difficulty" in p ? (p.difficulty as string) : undefined,
      icon: Box,
      run: () => {
        setSelectedProblem(p.id);
        setActiveLeftTab("problems");
        showToast(`Selected: ${p.title}`, "info");
      },
    }));
    const componentItems: CommandItem[] = allComponents.map((c) => ({
      id: `comp-${c.id}`,
      group: "Components",
      label: c.label,
      hint: "Add to canvas",
      icon: ICON_MAP[c.icon] ?? Puzzle,
      run: () => addComponent(c),
    }));
    return [...actionItems, ...problemItems, ...componentItems];
  }, [
    actions,
    customProblems,
    allComponents,
    undo,
    redo,
    setSelectedProblem,
    setActiveLeftTab,
    showToast,
    addComponent,
  ]);

  const q = query.trim();
  const grouped = q === "";
  const filtered = useMemo(() => {
    if (q === "") {
      // No query: show everything in group order (Actions → Problems → Components).
      const order = { Actions: 0, Problems: 1, Components: 2 };
      return items.slice().sort((x, y) => order[x.group] - order[y.group]);
    }
    // With a query: rank purely by relevance so the best match leads, whatever its group.
    return items
      .map((it) => ({ it, sc: scoreMatch(q, it.label) }))
      .filter((x) => x.sc >= 0)
      .sort((a, b) => b.sc - a.sc || a.it.label.length - b.it.label.length)
      .map((x) => x.it);
  }, [items, q]);

  // Focus the input on mount. The parent remounts this component on open
  // (via `key`), so mount === freshly opened and state starts clean.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  const choose = useCallback(
    (item: CommandItem | undefined) => {
      if (!item) return;
      onClose();
      // defer so the palette closes before any dialog opens
      setTimeout(() => item.run(), 0);
    },
    [onClose],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        choose(filtered[active]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [filtered, active, choose, onClose],
  );

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  let lastGroup = "";

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[10vh]">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.12 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        initial={{ opacity: 0, scale: 0.97, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
        className="relative flex max-h-[72vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-700/80 bg-zinc-900/95 shadow-[var(--shadow-e4)]"
        onKeyDown={onKeyDown}
      >
        <div className="flex shrink-0 items-center gap-2.5 border-b border-zinc-800/80 px-4">
          <Search className="h-[18px] w-[18px] shrink-0 text-zinc-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="Search problems, components, actions…"
            // Inline outline:none beats the global *:focus-visible ring — the modal
            // context already makes focus obvious, so the boxed ring looks wrong here.
            style={{ outline: "none", boxShadow: "none" }}
            className="h-12 w-full bg-transparent text-[15px] text-zinc-100 placeholder:text-zinc-500"
            aria-label="Search commands"
          />
          <kbd className="hidden shrink-0 rounded border border-zinc-700/70 bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 sm:block">
            esc
          </kbd>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-zinc-500">
              No matches for “{query}”
            </div>
          ) : (
            filtered.map((item, idx) => {
              const Icon = item.icon;
              // Group headers only when browsing (no query); when ranking by
              // relevance, show each row's group as a small inline tag instead.
              const showHeader = grouped && item.group !== lastGroup;
              lastGroup = item.group;
              return (
                <div key={item.id}>
                  {showHeader && (
                    <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      {item.group}
                    </div>
                  )}
                  <button
                    data-idx={idx}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => choose(item)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left ${
                      idx === active
                        ? "bg-cyan-500/15 text-zinc-50"
                        : "text-zinc-300 hover:bg-zinc-800"
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 shrink-0 ${idx === active ? "text-cyan-400" : "text-zinc-500"}`}
                    />
                    <span className="flex-1 truncate text-sm">{item.label}</span>
                    {!grouped && (
                      <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-zinc-500">
                        {item.group}
                      </span>
                    )}
                    {item.hint && (
                      <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                        {item.hint}
                      </span>
                    )}
                    {idx === active && (
                      <CornerDownLeft className="h-3 w-3 shrink-0 text-zinc-500" />
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </motion.div>
    </div>
  );
}
