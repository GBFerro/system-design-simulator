"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { instancesOf, MAX_INSTANCES } from "@/domain/components/registry";
import type { EdgeCall, EdgeCallKind, ParamSpec, ParamValue } from "@/domain/components/types";
import {
  DEFAULT_RULE_FRACTION,
  EDGE_LINK_SPECS,
  edgeCallSpecsFor,
  type EdgeRulePatch,
} from "@/domain/graph/edgeRules";
import { isReturnEdge, responseToOf } from "@/domain/graph/returns";
import { useReactFlow } from "@xyflow/react";
import {
  ClipboardPaste,
  Copy,
  CopyPlus,
  LayoutGrid,
  Minus,
  PanelRight,
  HeartPulse,
  Pencil,
  Plus,
  Skull,
  SquareDashedMousePointer,
  StickyNote,
  Trash2,
} from "lucide-react";
import {
  edgeRuleOf,
  useCanvasStore,
  useIsActiveTabReadOnly,
  type ComponentNodeData,
  type CustomEdgeData,
} from "@/store/canvasStore";
import { ParamField } from "@/components/panel/ParamsForm";
import { callFormContext } from "@/components/panel/EdgeCallsForm";
import { useAppStore } from "@/store/appStore";
import { createTextNode } from "@/lib/nodeFactory";
import { useRuntimeStore } from "@/store/runtimeStore";
import { useChaosStore } from "@/store/chaosStore";
import { killFaultsOf, killOneInstance, toggleKillNode } from "@/components/traffic/simActions";
import { MOD_KEY, openPropertiesPanel } from "./canvasEvents";

export type ContextTarget =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string }
  | { kind: "pane" };

export interface ContextMenuState {
  target: ContextTarget;
  /** Client (screen) coordinates where the menu opens. */
  x: number;
  y: number;
}

type MenuEntry =
  | {
      label: string;
      icon?: ReactNode;
      shortcut?: string;
      disabled?: boolean;
      /** Shown as a small tag, e.g. for items that arrive with a later spec. */
      tag?: string;
      danger?: boolean;
      checked?: boolean;
      onSelect: () => void;
    }
  | { heading: string }
  /** An inline input (edge rule numbers); commits on blur/Enter, doesn't close the menu. */
  | { field: ParamSpec; value: ParamValue; onCommit: (value: ParamValue) => void }
  | "separator";

const PROTOCOLS: { value: NonNullable<CustomEdgeData["protocol"]>; label: string }[] = [
  { value: "http", label: "HTTP" },
  { value: "grpc", label: "gRPC" },
  { value: "websocket", label: "WebSocket" },
  { value: "pubsub", label: "pub/sub" },
  { value: "tcp", label: "TCP" },
  { value: "custom", label: "Custom" },
];

const ICON = "h-3.5 w-3.5";

/** Arrow-key targets: menu items plus the inline fields' controls. */
const FOCUSABLE = [
  "[role^=menuitem]:not([disabled])",
  "[data-menu-field] input:not([disabled])",
  "[data-menu-field] select:not([disabled])",
  "[data-menu-field] button:not([disabled])",
].join(", ");

function useMenuEntries(
  target: ContextTarget,
  flowPoint: () => { x: number; y: number },
): MenuEntry[] {
  const store = useCanvasStore();
  const readOnly = useIsActiveTabReadOnly();
  const hasClipboard = (store.clipboard?.nodes.length ?? 0) > 0;
  const toast = useAppStore.getState().showToast;

  const copy = () => {
    const n = store.copySelection();
    if (n) toast(`Copied ${n} item${n > 1 ? "s" : ""}`, "info");
  };
  const paste: MenuEntry = {
    label: "Paste",
    icon: <ClipboardPaste className={ICON} />,
    shortcut: `${MOD_KEY}V`,
    disabled: !hasClipboard,
    onSelect: () => store.pasteClipboard(flowPoint()),
  };

  if (target.kind === "pane") {
    if (readOnly) {
      return [
        {
          label: "Select all",
          icon: <SquareDashedMousePointer className={ICON} />,
          shortcut: `${MOD_KEY}A`,
          onSelect: store.selectAll,
        },
      ];
    }
    return [
      paste,
      {
        label: "Add note",
        icon: <StickyNote className={ICON} />,
        onSelect: () => store.placeNode(createTextNode({ x: 0, y: 0 }), flowPoint()),
      },
      {
        label: "Select all",
        icon: <SquareDashedMousePointer className={ICON} />,
        shortcut: `${MOD_KEY}A`,
        onSelect: store.selectAll,
      },
      "separator",
      {
        label: "Auto-layout",
        icon: <LayoutGrid className={ICON} />,
        disabled: true,
        tag: "soon",
        onSelect: () => {},
      },
    ];
  }

  if (target.kind === "edge") {
    const edge = store.edges.find((e) => e.id === target.id);
    if (!edge) return [];
    // A response has no parameters: select the call it answers, or remove it (the call becomes async).
    if (isReturnEdge(edge)) {
      return [
        {
          label: "Select the request",
          icon: <PanelRight className={ICON} />,
          onSelect: () => {
            store.selectOnly([], [responseToOf(edge) ?? ""]);
            openPropertiesPanel();
          },
        },
        ...(readOnly
          ? []
          : [
              "separator" as const,
              {
                label: "Remove the response",
                icon: <Trash2 className={ICON} />,
                shortcut: "⌫",
                danger: true,
                onSelect: store.deleteSelection,
              },
            ]),
      ];
    }
    const data = (edge.data ?? {}) as CustomEdgeData;
    const isAsync = !store.edges.some((e) => responseToOf(e) === edge.id);
    const rule = edgeRuleOf(store, edge);
    if (readOnly) {
      return [
        {
          label: "Open in panel",
          icon: <PanelRight className={ICON} />,
          onSelect: () => openPropertiesPanel(),
        },
      ];
    }
    const linkEntries = EDGE_LINK_SPECS.map<MenuEntry>((spec) => ({
      field: spec,
      value: rule[spec.key as "networkLatencyMs" | "packetLoss"],
      onCommit: (value) => store.updateEdgeRule(edge.id, { [spec.key]: value } as EdgeRulePatch),
    }));
    let callEntries: MenuEntry[];
    if (rule.calls.length > 1) {
      // Several calls don't fit a menu: the Props panel edits them (FLW-17)
      callEntries = [
        {
          label: "Edit calls in the panel",
          icon: <PanelRight className={ICON} />,
          tag: `${rule.calls.length} calls`,
          onSelect: () => {
            store.selectOnly([], [edge.id]);
            openPropertiesPanel();
          },
        },
      ];
    } else {
      const call = rule.calls[0];
      const ctx = callFormContext(store, edge);
      const specs = edgeCallSpecsFor(ctx, call);
      const setCall = (patch: Partial<EdgeCall>) =>
        store.updateEdgeRule(edge.id, { calls: [{ ...call, ...patch }] });
      const kinds = specs.find((s) => s.key === "kind")?.options ?? [];
      const values: Record<string, ParamValue> = {
        kind: call.kind,
        fraction: call.fraction ?? DEFAULT_RULE_FRACTION,
        callsPerRequest: call.callsPerRequest,
      };
      callEntries = [
        ...kinds.flatMap<MenuEntry>((o) =>
          o.value === "after_miss"
            ? // one choice per cache the source calls (look-aside, FLW-08)
              ctx.caches.map<MenuEntry>((c) => ({
                label: `Reads after a miss in ${c.label}`,
                checked: call.kind === "after_miss" && call.missOf === c.id,
                onSelect: () => setCall({ kind: "after_miss", missOf: c.id }),
              }))
            : [
                {
                  label: o.label,
                  checked: call.kind === o.value,
                  onSelect: () => setCall({ kind: o.value as EdgeCallKind }),
                },
              ],
        ),
        ...specs
          .filter(
            (spec) =>
              (spec.key === "fraction" || spec.key === "callsPerRequest") &&
              (!spec.visibleIf || spec.visibleIf(values)),
          )
          .map<MenuEntry>((spec) => ({
            field: spec,
            value: values[spec.key],
            onCommit: (value) => setCall({ [spec.key]: value }),
          })),
      ];
    }
    return [
      { heading: "Communication" },
      {
        label: "Sync",
        checked: !isAsync,
        onSelect: () => store.setEdgeSync(edge.id, true),
      },
      {
        label: "Async",
        checked: isAsync,
        onSelect: () => store.setEdgeSync(edge.id, false),
      },
      { heading: "Protocol" },
      ...PROTOCOLS.map<MenuEntry>((p) => ({
        label: p.label,
        checked: (data.protocol ?? "http") === p.value,
        onSelect: () => store.updateEdgeData(edge.id, { protocol: p.value }),
      })),
      { heading: "Call rule" },
      ...callEntries,
      ...linkEntries,
      "separator",
      {
        label: "Open in panel",
        icon: <PanelRight className={ICON} />,
        onSelect: () => openPropertiesPanel(),
      },
      {
        label: "Delete connection",
        icon: <Trash2 className={ICON} />,
        shortcut: "⌫",
        danger: true,
        onSelect: store.deleteSelection,
      },
    ];
  }

  const node = store.nodes.find((n) => n.id === target.id);
  if (!node) return [];
  const selectedCount = store.nodes.filter((n) => n.selected).length;
  const many = selectedCount > 1;
  const suffix = many ? ` ${selectedCount} items` : "";
  const isComponent = node.type === "component";
  const replicas = isComponent ? instancesOf(node.data as ComponentNodeData) : 0;

  // Chaos (Spec 08): acts on the live run, never on the graph, so it's
  // offered on read-only reference tabs too.
  const live = useRuntimeStore.getState().playback !== "idle";
  const killed = killFaultsOf(useChaosStore.getState().faults, node.id).length > 0;
  const chaosEntries: MenuEntry[] =
    isComponent && !many
      ? [
          killed
            ? {
                label: "Restore node",
                icon: <HeartPulse className={ICON} />,
                onSelect: () => toggleKillNode(node.id),
              }
            : {
                label: "Kill node",
                icon: <Skull className={ICON} />,
                disabled: !live,
                tag: live ? undefined : "play first",
                danger: live,
                onSelect: () => toggleKillNode(node.id),
              },
          ...(live && !killed && replicas > 1
            ? [
                {
                  label: "Kill 1 instance",
                  icon: <Skull className={ICON} />,
                  danger: true,
                  onSelect: () => killOneInstance(node.id),
                },
              ]
            : []),
          "separator",
        ]
      : [];

  if (readOnly) {
    return [
      ...chaosEntries,
      ...(!many
        ? [
            {
              label: "Open in panel",
              icon: <PanelRight className={ICON} />,
              onSelect: () => openPropertiesPanel(),
            },
          ]
        : []),
      {
        label: `Copy${suffix}`,
        icon: <Copy className={ICON} />,
        shortcut: `${MOD_KEY}C`,
        onSelect: copy,
      },
    ];
  }

  const single: MenuEntry[] = many
    ? []
    : [
        isComponent
          ? {
              label: "Rename",
              icon: <Pencil className={ICON} />,
              onSelect: () => openPropertiesPanel("label"),
            }
          : {
              label: "Edit text",
              icon: <Pencil className={ICON} />,
              onSelect: () =>
                window.dispatchEvent(new CustomEvent("textnode:edit", { detail: { id: node.id } })),
            },
        {
          label: "Open in panel",
          icon: <PanelRight className={ICON} />,
          onSelect: () => openPropertiesPanel(),
        },
        "separator",
      ];

  const replicaEntries: MenuEntry[] =
    isComponent && !many
      ? [
          {
            label: `Add replica (${replicas})`,
            icon: <Plus className={ICON} />,
            disabled: replicas >= MAX_INSTANCES,
            onSelect: () => store.changeReplicas(node.id, 1),
          },
          {
            label: "Remove replica",
            icon: <Minus className={ICON} />,
            disabled: replicas <= 1,
            onSelect: () => store.changeReplicas(node.id, -1),
          },
          "separator",
          ...chaosEntries,
        ]
      : [];

  return [
    ...single,
    {
      label: `Duplicate${suffix}`,
      icon: <CopyPlus className={ICON} />,
      shortcut: `${MOD_KEY}D`,
      onSelect: store.duplicateSelection,
    },
    {
      label: `Copy${suffix}`,
      icon: <Copy className={ICON} />,
      shortcut: `${MOD_KEY}C`,
      onSelect: copy,
    },
    paste,
    "separator",
    ...replicaEntries,
    {
      label: `Delete${suffix}`,
      icon: <Trash2 className={ICON} />,
      shortcut: "⌫",
      danger: true,
      onSelect: store.deleteSelection,
    },
  ];
}

/**
 * Right-click / long-press / Shift+F10 menu for nodes, edges and the canvas.
 * Keyboard: arrows move, Enter/Space activate, Escape or Tab close.
 */
export function CanvasContextMenu({
  menu,
  onClose,
}: {
  menu: ContextMenuState;
  onClose: () => void;
}) {
  const { screenToFlowPosition } = useReactFlow();
  const entries = useMenuEntries(menu.target, () => screenToFlowPosition({ x: menu.x, y: menu.y }));
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });

  // Keep the menu inside the viewport
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(menu.x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(menu.y, window.innerHeight - height - 8)),
    });
  }, [menu.x, menu.y]);

  // Blur a focused inline field first so its pending value commits before unmount
  const closeMenu = useCallback(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && ref.current?.contains(active)) active.blur();
    onClose();
  }, [onClose]);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("[role^=menuitem]:not([disabled])")?.focus();
    const close = (e: Event) => {
      if (e.target instanceof Node && ref.current?.contains(e.target)) return;
      closeMenu();
    };
    const closeNow = () => closeMenu();
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("wheel", closeNow, { passive: true });
    window.addEventListener("resize", closeNow);
    window.addEventListener("blur", closeNow);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("wheel", closeNow);
      window.removeEventListener("resize", closeNow);
      window.removeEventListener("blur", closeNow);
    };
  }, [closeMenu]);

  if (entries.length === 0) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Keep canvas shortcuts (Delete, arrows, Escape) from also firing
    e.stopPropagation();
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      closeMenu();
    }
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="Canvas actions"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-[60] max-h-[calc(100vh-16px)] min-w-[200px] overflow-y-auto rounded-lg border border-zinc-700/80 bg-zinc-900/95 p-1 text-xs text-zinc-200 shadow-xl backdrop-blur"
    >
      {entries.map((entry, i) => {
        if (entry === "separator") return <hr key={i} className="my-1 h-px border-0 bg-zinc-800" />;
        if ("field" in entry) {
          return (
            <div key={i} role="none" data-menu-field className="w-64 px-2 py-1">
              <ParamField
                spec={entry.field}
                value={entry.value}
                onCommit={(_, value) => entry.onCommit(value)}
              />
            </div>
          );
        }
        if ("heading" in entry) {
          return (
            <div
              key={i}
              className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400"
            >
              {entry.heading}
            </div>
          );
        }
        const isRadio = entry.checked !== undefined;
        return (
          <button
            key={i}
            type="button"
            role={isRadio ? "menuitemradio" : "menuitem"}
            aria-checked={isRadio ? entry.checked : undefined}
            disabled={entry.disabled}
            onClick={() => {
              entry.onSelect();
              onClose();
            }}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors focus-visible:bg-zinc-800 enabled:hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 ${
              entry.danger ? "text-rose-400" : ""
            }`}
          >
            <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-zinc-400">
              {isRadio ? (
                entry.checked ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
                ) : null
              ) : (
                entry.icon
              )}
            </span>
            <span className="flex-1">{entry.label}</span>
            {entry.tag && (
              <span className="rounded bg-zinc-800 px-1 text-[10px] uppercase tracking-wider text-zinc-400">
                {entry.tag}
              </span>
            )}
            {entry.shortcut && (
              <kbd className="font-mono text-[10px] text-zinc-400">{entry.shortcut}</kbd>
            )}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
