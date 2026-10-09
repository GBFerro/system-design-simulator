"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Edge } from "@xyflow/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  Info,
  Trash2,
  Lightbulb,
  ChevronDown,
  ChevronRight,
  CheckSquare,
  BookOpen,
  Target,
  AlertTriangle,
  MessageCircle,
  Layers,
  Pencil,
  CopyPlus,
} from "lucide-react";
import { isReturnEdge, responseToOf } from "@/domain/graph/returns";
import {
  useCanvasStore,
  useHasResponse,
  useIsActiveTabReadOnly,
  type ComponentNodeData,
  type CustomEdgeData,
} from "@/store/canvasStore";
import {
  capacityPerInstanceOf,
  getSchema,
  instancesOf,
  resolvedParams,
} from "@/domain/components/registry";
import { ParamsForm } from "./ParamsForm";
import { EdgeCallsForm } from "./EdgeCallsForm";
import { CostPanel } from "./CostPanel";
import { formatMoney } from "@/cost/currency";
import { useAppStore } from "@/store/appStore";
import { getProblemById } from "@/data/problems";
import { getConceptByComponentId } from "@/data/conceptLibrary";
import { getComponentById } from "@/data/components";
import { OPEN_PROPERTIES_EVENT, consumePendingFocus } from "@/components/canvas/canvasEvents";
import { SimulationControls } from "./SimulationControls";
import { TrafficControls } from "@/components/traffic/TrafficControls";
import { MetricsDisplay } from "./MetricsDisplay";
import { ScoreReport } from "./ScoreReport";
import { CapacityCalculator } from "./CapacityCalculator";
import { TradeoffLog } from "./TradeoffLog";
import { TradeoffCards } from "./TradeoffCards";
import { ChaosPanel } from "./ChaosPanel";
import { AdvisorPanel } from "./AdvisorPanel";
import { SloPanel } from "./SloPanel";
import { useAdvisorStore } from "@/store/advisorStore";
import { useChaosStore } from "@/store/chaosStore";
import { useInterviewStore } from "@/store/interviewStore";
import { InterviewPhasePanel } from "@/components/interview/InterviewPhasePanel";
import dynamic from "next/dynamic";
import { TOOLS_BY_STEP, interviewTools, type RightTab } from "@/lib/steps";

// The Flow tab (request-flow): the panel, its diagram and the trace load on demand.
const FlowPanel = dynamic(() => import("./FlowPanel").then((m) => m.FlowPanel), {
  ssr: false,
  loading: () => <p className="text-[11px] text-zinc-400">Loading…</p>,
});

interface RightPanelProps {
  open?: boolean;
  onAnalyze: () => void;
  variant?: "desktop" | "mobile";
}

const TAB_TRIGGER =
  "h-7 px-2 text-[11px] data-[state=active]:bg-zinc-700 data-[state=active]:text-zinc-100";

/**
 * Body of every tab. The bottom padding lets the last controls scroll clear
 * of the fixed Support FAB (bottom-right), which would otherwise cover them.
 */
const TAB_BODY = "p-3 pb-16";

/** Small count on a tab trigger (active faults, advisor findings). */
function TabCount({ n, tone, label }: { n: number; tone: string; label: string }) {
  if (n === 0) return null;
  return (
    <span
      className={`ml-1 rounded-full px-1 font-mono text-[9px] leading-[14px] ${tone}`}
      aria-label={label}
    >
      {n}
    </span>
  );
}

function RightTabs({
  onAnalyze,
  tools,
}: {
  onAnalyze: () => void;
  /** The tabs the current step (or interview phase) shows, first = the one that opens. */
  tools: readonly RightTab[];
}) {
  const stored = useAppStore((s) => s.activeRightTab);
  // A tab the step does not show falls back to the step's first one.
  const activeRightTab = tools.includes(stored) ? stored : tools[0];
  const show = (tab: RightTab) => tools.includes(tab);
  const setActiveRightTab = useAppStore((s) => s.setActiveRightTab);
  const activeFaults = useChaosStore((s) => s.faults.filter((f) => f.active).length);
  // Info findings (over-provisioning, the score's notes) don't count toward the badge.
  const findings = useAdvisorStore((s) => s.findings.filter((f) => f.severity !== "info").length);

  return (
    <Tabs
      value={activeRightTab}
      onValueChange={(v) => setActiveRightTab(v as RightTab)}
      className="flex flex-1 flex-col min-h-0"
    >
      <div className="mx-2 mt-2 shrink-0 overflow-x-auto">
        <TabsList className="h-8 w-max bg-zinc-800">
          {show("properties") && (
            <TabsTrigger
              value="properties"
              className="h-7 px-2 text-[11px] data-[state=active]:bg-zinc-700 data-[state=active]:text-zinc-100"
            >
              Props
            </TabsTrigger>
          )}
          {show("simulation") && (
            <TabsTrigger
              value="simulation"
              className="h-7 px-2 text-[11px] data-[state=active]:bg-zinc-700 data-[state=active]:text-zinc-100"
            >
              Simulate
            </TabsTrigger>
          )}
          {show("flow") && (
            <TabsTrigger value="flow" className={TAB_TRIGGER}>
              Flow
            </TabsTrigger>
          )}
          {show("chaos") && (
            <TabsTrigger value="chaos" className={TAB_TRIGGER}>
              Chaos
              <TabCount
                n={activeFaults}
                tone="bg-orange-500/20 text-orange-300"
                label={`${activeFaults} active faults`}
              />
            </TabsTrigger>
          )}
          {show("slo") && (
            <TabsTrigger value="slo" className={TAB_TRIGGER}>
              SLO
            </TabsTrigger>
          )}
          {show("score") && (
            <TabsTrigger
              value="score"
              className="h-7 px-2 text-[11px] data-[state=active]:bg-zinc-700 data-[state=active]:text-zinc-100"
            >
              Score
            </TabsTrigger>
          )}
          {show("advisor") && (
            <TabsTrigger value="advisor" className={TAB_TRIGGER}>
              Advisor
              <TabCount
                n={findings}
                tone="bg-amber-500/20 text-amber-300"
                label={`${findings} findings`}
              />
            </TabsTrigger>
          )}
          {show("cost") && (
            <TabsTrigger value="cost" className={TAB_TRIGGER}>
              Cost
            </TabsTrigger>
          )}
          {show("capacity") && (
            <TabsTrigger
              value="capacity"
              className="h-7 px-2 text-[11px] data-[state=active]:bg-zinc-700 data-[state=active]:text-zinc-100"
            >
              Capacity
            </TabsTrigger>
          )}
          {show("tradeoffs") && (
            <TabsTrigger
              value="tradeoffs"
              className="h-7 px-2 text-[11px] data-[state=active]:bg-zinc-700 data-[state=active]:text-zinc-100"
            >
              Trade-offs
            </TabsTrigger>
          )}
        </TabsList>
      </div>

      {show("properties") && (
        <TabsContent value="properties" className="mt-0 flex-1 overflow-hidden min-h-0">
          <ScrollArea className="h-full">
            <div className={TAB_BODY}>
              <PropertiesTab />
            </div>
          </ScrollArea>
        </TabsContent>
      )}

      {show("simulation") && (
        <TabsContent value="simulation" className="mt-0 flex-1 overflow-hidden min-h-0">
          <ScrollArea className="h-full">
            <div className={`${TAB_BODY} space-y-4`}>
              <TrafficControls />
              <Separator className="bg-zinc-800" />
              <SimulationControls onAnalyze={onAnalyze} />
              <Separator className="bg-zinc-800" />
              <MetricsDisplay />
            </div>
          </ScrollArea>
        </TabsContent>
      )}

      {show("flow") && (
        <TabsContent value="flow" className="mt-0 flex-1 overflow-hidden min-h-0">
          <ScrollArea className="h-full">
            <div className={TAB_BODY}>
              <FlowPanel />
            </div>
          </ScrollArea>
        </TabsContent>
      )}

      {show("chaos") && (
        <TabsContent value="chaos" className="mt-0 flex-1 overflow-hidden min-h-0">
          <ScrollArea className="h-full">
            <div className={TAB_BODY}>
              <ChaosPanel />
            </div>
          </ScrollArea>
        </TabsContent>
      )}

      {show("slo") && (
        <TabsContent value="slo" className="mt-0 flex-1 overflow-hidden min-h-0">
          <ScrollArea className="h-full">
            <div className={TAB_BODY}>
              <SloPanel />
            </div>
          </ScrollArea>
        </TabsContent>
      )}

      {show("advisor") && (
        <TabsContent value="advisor" className="mt-0 flex-1 overflow-hidden min-h-0">
          <ScrollArea className="h-full">
            <div className={TAB_BODY}>
              <AdvisorPanel />
            </div>
          </ScrollArea>
        </TabsContent>
      )}

      {show("score") && (
        <TabsContent value="score" className="mt-0 flex-1 overflow-hidden min-h-0">
          <div className={`h-full ${TAB_BODY}`}>
            <ScoreReport />
          </div>
        </TabsContent>
      )}

      {show("cost") && (
        <TabsContent value="cost" className="mt-0 flex-1 overflow-hidden min-h-0">
          <ScrollArea className="h-full">
            <div className={TAB_BODY}>
              <CostPanel />
            </div>
          </ScrollArea>
        </TabsContent>
      )}

      {show("capacity") && (
        <TabsContent value="capacity" className="mt-0 flex-1 overflow-hidden min-h-0">
          <ScrollArea className="h-full">
            <div className={TAB_BODY}>
              <CapacityCalculator />
            </div>
          </ScrollArea>
        </TabsContent>
      )}

      {show("tradeoffs") && (
        <TabsContent value="tradeoffs" className="mt-0 flex-1 overflow-hidden min-h-0">
          <ScrollArea className="h-full">
            <div className={`${TAB_BODY} space-y-4`}>
              <TradeoffLog />
              <Separator className="bg-zinc-800" />
              <TradeoffCards />
            </div>
          </ScrollArea>
        </TabsContent>
      )}
    </Tabs>
  );
}

export function RightPanel({ open = true, onAnalyze, variant = "desktop" }: RightPanelProps) {
  const interviewMode = useInterviewStore((s) => s.mode);
  const currentPhase = useInterviewStore((s) => s.currentPhase);
  const step = useAppStore((s) => s.step);
  const tools = interviewMode === "interview" ? interviewTools(currentPhase) : TOOLS_BY_STEP[step];

  // During interview mode, show phase panel for all phases except phase 4 (HLD)
  const showInterviewPhasePanel = interviewMode === "interview" && currentPhase !== 4;

  if (variant === "mobile") {
    return (
      <div className="flex h-full w-full flex-col bg-zinc-900">
        {showInterviewPhasePanel ? (
          <InterviewPhasePanel />
        ) : (
          <RightTabs onAnalyze={onAnalyze} tools={tools} />
        )}
      </div>
    );
  }

  return (
    <aside
      className={`hidden shrink-0 flex-col border-l border-zinc-800 bg-zinc-900 overflow-hidden transition-all duration-200 md:flex ${
        open ? "w-[300px] opacity-100" : "w-0 opacity-0 border-l-0"
      }`}
      aria-hidden={!open || undefined}
      inert={!open || undefined}
    >
      {showInterviewPhasePanel ? (
        <InterviewPhasePanel />
      ) : (
        <div className="flex w-[300px] flex-1 flex-col min-h-0">
          <RightTabs onAnalyze={onAnalyze} tools={tools} />
        </div>
      )}
    </aside>
  );
}

/**
 * A selected response (RET-11): no field to edit (the link and the calls live on
 * the request, AD-001), just what it answers and a way to the request.
 */
function ResponsePanel({ edge }: { edge: Edge }) {
  const nodes = useCanvasStore((s) => s.nodes);
  const selectOnly = useCanvasStore((s) => s.selectOnly);
  const deleteSelection = useCanvasStore((s) => s.deleteSelection);
  const readOnly = useIsActiveTabReadOnly();
  const requestId = responseToOf(edge) ?? "";
  const labelOf = (id: string) =>
    (nodes.find((n) => n.id === id)?.data as { label?: string } | undefined)?.label ?? id;
  // The response runs callee → caller: the request it answers is caller → callee.
  return (
    <div className="space-y-3" data-response-panel>
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Response</p>
      <p className="text-sm text-zinc-200">
        Response to {labelOf(edge.target)} → {labelOf(edge.source)}
      </p>
      <p className="text-[11px] text-zinc-500">
        The link and the calls are set on the request. Without this response the call is async.
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => selectOnly([], [requestId])}
        className="w-full gap-1.5 border-zinc-700 text-zinc-200 hover:bg-zinc-800"
      >
        Select the request
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={readOnly}
        onClick={deleteSelection}
        className="w-full gap-1.5 border-zinc-700 text-rose-400 hover:bg-zinc-800 hover:text-rose-300"
      >
        <Trash2 className="h-3 w-3" />
        Remove the response
      </Button>
    </div>
  );
}

function EdgePanel({ edge }: { edge: Edge }) {
  return isReturnEdge(edge) ? <ResponsePanel edge={edge} /> : <EdgePropertiesPanel edge={edge} />;
}

function EdgePropertiesPanel({ edge: selectedEdge }: { edge: Edge }) {
  const updateEdgeData = useCanvasStore((s) => s.updateEdgeData);
  const setEdgeSync = useCanvasStore((s) => s.setEdgeSync);
  const isAsync = !useHasResponse(selectedEdge.id);
  const deleteSelection = useCanvasStore((s) => s.deleteSelection);
  const readOnly = useIsActiveTabReadOnly();

  const data = (selectedEdge.data ?? {}) as CustomEdgeData;
  const protocols: CustomEdgeData["protocol"][] = [
    "http",
    "grpc",
    "websocket",
    "pubsub",
    "tcp",
    "custom",
  ];

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Edge Properties
      </p>

      <div className="space-y-2">
        {/* Label */}
        <div>
          <label className="mb-1 block text-xs text-zinc-400">Label</label>
          <input
            type="text"
            value={data.label ?? ""}
            disabled={readOnly}
            onChange={(e) => updateEdgeData(selectedEdge.id, { label: e.target.value })}
            placeholder="e.g. /api/users"
            className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-cyan-600 focus:ring-1 focus:ring-cyan-600/50"
          />
        </div>

        {/* Protocol */}
        <div>
          <label className="mb-1 block text-xs text-zinc-400">Protocol</label>
          <select
            value={data.protocol ?? "http"}
            disabled={readOnly}
            onChange={(e) =>
              updateEdgeData(selectedEdge.id, {
                protocol: e.target.value as CustomEdgeData["protocol"],
              })
            }
            className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-cyan-600 focus:ring-1 focus:ring-cyan-600/50"
          >
            {protocols.map((p) => (
              <option key={p} value={p}>
                {p === "http"
                  ? "HTTP"
                  : p === "grpc"
                    ? "gRPC"
                    : p === "websocket"
                      ? "WebSocket"
                      : p === "pubsub"
                        ? "pub/sub"
                        : p === "tcp"
                          ? "TCP"
                          : "Custom"}
              </option>
            ))}
          </select>
        </div>

        {/* Sync / Async toggle */}
        <div>
          <label className="mb-1 block text-xs text-zinc-400">Communication</label>
          <div className="flex gap-1">
            <button
              disabled={readOnly}
              onClick={() => setEdgeSync(selectedEdge.id, true)}
              className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                !isAsync
                  ? "bg-cyan-600/20 text-cyan-400 border border-cyan-500/30"
                  : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
              }`}
            >
              Sync
            </button>
            <button
              disabled={readOnly}
              onClick={() => setEdgeSync(selectedEdge.id, false)}
              className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                isAsync
                  ? "bg-cyan-600/20 text-cyan-400 border border-cyan-500/30"
                  : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
              }`}
            >
              Async
            </button>
          </div>
          <p className="mt-1 text-[11px] text-zinc-500">
            {isAsync
              ? "Dashed line — asynchronous (e.g. message queue)"
              : "Solid line — synchronous (e.g. HTTP call)"}
          </p>
        </div>

        {/* Calls (request-flow): which requests make each call over this edge, and in what order */}
        <EdgeCallsForm edge={selectedEdge} />

        {/* Remove connection — clears selection via the store */}
        <Button
          variant="outline"
          size="sm"
          disabled={readOnly}
          onClick={deleteSelection}
          className="w-full gap-1.5 border-zinc-700 text-rose-400 hover:bg-zinc-800 hover:text-rose-300"
        >
          <Trash2 className="h-3 w-3" />
          Remove Connection
        </Button>
      </div>
    </div>
  );
}

function MultiSelectionPanel({ nodeCount, edgeCount }: { nodeCount: number; edgeCount: number }) {
  const duplicateSelection = useCanvasStore((s) => s.duplicateSelection);
  const deleteSelection = useCanvasStore((s) => s.deleteSelection);
  const parts = [
    nodeCount && `${nodeCount} node${nodeCount > 1 ? "s" : ""}`,
    edgeCount && `${edgeCount} connection${edgeCount > 1 ? "s" : ""}`,
  ].filter(Boolean);

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {nodeCount + edgeCount} items selected
      </p>
      <p className="text-xs text-zinc-400">{parts.join(" · ")}</p>
      <div className="space-y-2">
        {nodeCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={duplicateSelection}
            className="w-full gap-1.5 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <CopyPlus className="h-3 w-3" />
            Duplicate
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={deleteSelection}
          className="w-full gap-1.5 border-zinc-700 text-rose-400 hover:bg-zinc-800 hover:text-rose-300"
        >
          <Trash2 className="h-3 w-3" />
          Delete selection
        </Button>
      </div>
    </div>
  );
}

function PropertiesTab() {
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const updateNodeParams = useCanvasStore((s) => s.updateNodeParams);
  const deleteSelection = useCanvasStore((s) => s.deleteSelection);
  const readOnly = useIsActiveTabReadOnly();
  const selectedProblemId = useAppStore((s) => s.selectedProblemId);
  const currency = useAppStore((s) => s.currency);

  // Selection has one source of truth: node.selected / edge.selected
  const selectedNodes = nodes.filter((n) => n.selected);
  const selectedEdges = edges.filter((e) => e.selected);
  const selectionCount = selectedNodes.length + selectedEdges.length;
  const selectedNode = (selectionCount === 1 ? selectedNodes[0] : undefined) as
    | ((typeof nodes)[number] & { data: ComponentNodeData })
    | undefined;
  const selectedEdge = selectionCount === 1 ? selectedEdges[0] : undefined;
  const problem = getProblemById(selectedProblemId);

  // "Rename" from the canvas context menu focuses the label field
  const labelRef = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const selectedNodeId = selectedNode?.id;
  useEffect(() => {
    const tryFocus = () =>
      requestAnimationFrame(() => {
        const input = labelRef.current;
        // Both the desktop panel and the mobile sheet can be mounted — only the visible one takes focus
        if (!input || input.offsetParent === null) return;
        if (consumePendingFocus() === "label") {
          input.focus();
          input.select();
        }
      });
    tryFocus();
    window.addEventListener(OPEN_PROPERTIES_EVENT, tryFocus);
    return () => window.removeEventListener(OPEN_PROPERTIES_EVENT, tryFocus);
  }, [selectedNodeId]);

  return (
    <div className="space-y-4">
      {/* Problem requirements */}
      {problem && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Requirements — {problem.title}
          </p>
          <div className="space-y-1.5">
            {[
              {
                label: "Reads/sec",
                value: new Intl.NumberFormat("en-US").format(problem.requirements.readsPerSec),
              },
              {
                label: "Writes/sec",
                value: new Intl.NumberFormat("en-US").format(problem.requirements.writesPerSec),
              },
              {
                label: "Storage",
                value: `${new Intl.NumberFormat("en-US").format(problem.requirements.storageGB)} GB`,
              },
              { label: "Latency SLA", value: `< ${problem.requirements.latencyMs}ms` },
              { label: "Users", value: problem.requirements.users },
              ...(problem.requirements.budgetMonthlyUsd
                ? [
                    {
                      label: "Budget",
                      value: `${formatMoney(problem.requirements.budgetMonthlyUsd, currency)}/mo`,
                    },
                  ]
                : []),
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between rounded-md bg-zinc-800 px-2.5 py-1.5"
              >
                <span className="text-xs text-zinc-400">{item.label}</span>
                <span className="font-mono text-xs text-zinc-300">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Constraints */}
      {problem && problem.constraints.length > 0 && (
        <>
          <Separator className="bg-zinc-800" />
          <ConstraintsSection constraints={problem.constraints} />
        </>
      )}

      {/* Hints */}
      {problem && problem.hints.length > 0 && (
        <>
          <Separator className="bg-zinc-800" />
          <HintsSection hints={problem.hints} />
        </>
      )}

      <Separator className="bg-zinc-800" />

      {/* Selected node properties */}
      {selectionCount > 1 ? (
        <MultiSelectionPanel nodeCount={selectedNodes.length} edgeCount={selectedEdges.length} />
      ) : selectedNode && selectedNode.type === "text" ? (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Text Annotation
          </p>
          <div className="space-y-2">
            <div className="rounded-md bg-zinc-800 px-3 py-2">
              <p className="text-xs font-medium text-zinc-200">Text Note</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                Double-click (or tap) on canvas to edit
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("textnode:edit", { detail: { id: selectedNode.id } }),
                )
              }
              className="w-full gap-1.5 border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <Pencil className="h-3 w-3" />
              Edit text
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={deleteSelection}
              className="w-full gap-1.5 border-zinc-700 text-rose-400 hover:bg-zinc-800 hover:text-rose-300"
            >
              <Trash2 className="h-3 w-3" />
              Remove Note
            </Button>
          </div>
        </div>
      ) : selectedNode ? (
        (() => {
          const data = selectedNode.data as ComponentNodeData;
          const instances = instancesOf(data);
          const capacity = capacityPerInstanceOf(data);
          return (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Component Properties
              </p>

              <div className="space-y-2">
                <div>
                  <label htmlFor={labelId} className="mb-1 block text-xs text-zinc-400">
                    Label
                  </label>
                  <input
                    id={labelId}
                    ref={labelRef}
                    type="text"
                    value={data.label as string}
                    disabled={readOnly}
                    onChange={(e) => updateNodeData(selectedNode.id, { label: e.target.value })}
                    onBlur={(e) => {
                      if (!e.target.value.trim()) {
                        updateNodeData(selectedNode.id, {
                          label: getComponentById(data.componentId as string)?.label ?? "Component",
                        });
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
                    }}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-cyan-600 focus:ring-1 focus:ring-cyan-600/50"
                  />
                </div>
                <div className="rounded-md bg-zinc-800 px-3 py-2">
                  <p className="text-xs text-zinc-400">
                    <span className="capitalize">{data.category as string}</span> · {instances} ×{" "}
                    {new Intl.NumberFormat("en-US").format(capacity)} ={" "}
                    <span className="font-mono text-cyan-500">
                      {new Intl.NumberFormat("en-US").format(capacity * instances)}
                    </span>{" "}
                    rps
                  </p>
                </div>

                {/* Generated from the component's schema (Spec 03, CMP-01) */}
                <ParamsForm
                  key={selectedNode.id}
                  specs={getSchema(data.componentId).params}
                  values={resolvedParams(data)}
                  disabled={readOnly}
                  onCommit={(key, value) => updateNodeParams(selectedNode.id, { [key]: value })}
                />

                <Button
                  variant="outline"
                  size="sm"
                  disabled={readOnly}
                  onClick={deleteSelection}
                  className="w-full gap-1.5 border-zinc-700 text-rose-400 hover:bg-zinc-800 hover:text-rose-300"
                >
                  <Trash2 className="h-3 w-3" />
                  Remove Component
                </Button>
              </div>

              <Separator className="bg-zinc-800" />
              <LearnSection componentId={data.componentId as string} label={data.label as string} />
            </div>
          );
        })()
      ) : selectedEdge ? (
        <EdgePanel edge={selectedEdge} />
      ) : (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800">
            <Info className="h-4 w-4 text-zinc-500" />
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-400">No component selected</p>
            <p className="mt-1 text-xs text-zinc-500">
              Click a component or edge on the canvas to edit its properties.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function ConstraintsSection({ constraints }: { constraints: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? constraints : constraints.slice(0, 3);

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Constraints</p>
      <div className="space-y-1.5">
        {shown.map((c, i) => (
          <div key={i} className="flex items-start gap-2">
            <CheckSquare className="mt-0.5 h-3 w-3 shrink-0 text-zinc-400" />
            <span className="text-xs leading-relaxed text-zinc-400">{c}</span>
          </div>
        ))}
      </div>
      {constraints.length > 3 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-cyan-500 transition-colors hover:text-cyan-400"
        >
          {expanded ? (
            <>
              <ChevronDown className="h-3 w-3" />
              Show less
            </>
          ) : (
            <>
              <ChevronRight className="h-3 w-3" />
              Show {constraints.length - 3} more
            </>
          )}
        </button>
      )}
    </div>
  );
}

function HintsSection({ hints }: { hints: { title: string; content: string }[] }) {
  const [expandedHints, setExpandedHints] = useState<Set<number>>(new Set());

  const toggleHint = (index: number) => {
    setExpandedHints((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Hints</p>
      <div className="space-y-1.5">
        {hints.map((hint, i) => (
          <div key={i} className="rounded-md border border-zinc-700 bg-zinc-800 overflow-hidden">
            <button
              onClick={() => toggleHint(i)}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
            >
              <Lightbulb className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
              <span className="flex-1 text-xs font-medium text-zinc-300">{hint.title}</span>
              {expandedHints.has(i) ? (
                <ChevronDown className="h-3 w-3 shrink-0 text-zinc-500" />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0 text-zinc-500" />
              )}
            </button>
            {expandedHints.has(i) && (
              <div className="border-t border-zinc-700 px-2.5 py-2">
                <p className="text-xs leading-relaxed text-zinc-400">{hint.content}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function LearnSection({ componentId, label }: { componentId: string; label: string }) {
  const [expanded, setExpanded] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const concept = getConceptByComponentId(componentId);

  if (!concept) return null;

  const toggleSection = (section: string) => {
    setActiveSection((prev) => (prev === section ? null : section));
  };

  const sections = [
    {
      key: "whenToUse",
      label: "When to use",
      icon: Target,
      items: concept.whenToUse,
      accent: "text-emerald-400",
      bgAccent: "bg-emerald-400/10",
      borderAccent: "border-emerald-500/30",
    },
    {
      key: "tradeoffs",
      label: "Trade-offs",
      icon: AlertTriangle,
      items: concept.keyTradeoffs,
      accent: "text-amber-400",
      bgAccent: "bg-amber-400/10",
      borderAccent: "border-amber-500/30",
    },
    {
      key: "interviewTips",
      label: "Interview tips",
      icon: MessageCircle,
      items: concept.interviewTips,
      accent: "text-cyan-400",
      bgAccent: "bg-cyan-400/10",
      borderAccent: "border-cyan-500/30",
    },
    {
      key: "patterns",
      label: "Common patterns",
      icon: Layers,
      items: concept.commonPatterns.map((p) => p.name),
      accent: "text-violet-400",
      bgAccent: "bg-violet-400/10",
      borderAccent: "border-violet-500/30",
    },
  ];

  return (
    <div className="space-y-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 rounded-md border border-zinc-700 bg-zinc-800/50 px-2.5 py-2 text-left transition-colors hover:bg-zinc-800"
      >
        <BookOpen className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
        <span className="flex-1 text-xs font-medium text-zinc-300">Learn about {label}</span>
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-zinc-500" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-zinc-500" />
        )}
      </button>

      {expanded && (
        <div className="space-y-1.5">
          {sections.map((section) => {
            const Icon = section.icon;
            const isOpen = activeSection === section.key;
            return (
              <div
                key={section.key}
                className={`rounded-md border overflow-hidden transition-colors ${
                  isOpen
                    ? `${section.borderAccent} bg-zinc-800/80`
                    : "border-zinc-700/50 bg-zinc-800/30"
                }`}
              >
                <button
                  onClick={() => toggleSection(section.key)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
                >
                  <Icon className={`h-3 w-3 shrink-0 ${section.accent}`} />
                  <span className="flex-1 text-xs font-medium text-zinc-300">{section.label}</span>
                  {isOpen ? (
                    <ChevronDown className="h-3 w-3 shrink-0 text-zinc-500" />
                  ) : (
                    <ChevronRight className="h-3 w-3 shrink-0 text-zinc-500" />
                  )}
                </button>
                {isOpen && (
                  <div className="border-t border-zinc-700/50 px-2.5 py-2 space-y-1.5">
                    {section.key === "patterns"
                      ? concept.commonPatterns.map((pattern, i) => (
                          <div key={i} className="space-y-0.5">
                            <p className={`text-xs font-medium ${section.accent}`}>
                              {pattern.name}
                            </p>
                            <p className="text-[11px] leading-relaxed text-zinc-400">
                              {pattern.description}
                            </p>
                          </div>
                        ))
                      : section.key === "interviewTips"
                        ? section.items.map((item, i) => (
                            <div
                              key={i}
                              className={`flex items-start gap-2 rounded-md ${section.bgAccent} px-2 py-1.5`}
                            >
                              <span className={`mt-0.5 text-[10px] font-bold ${section.accent}`}>
                                TIP
                              </span>
                              <span className="text-[11px] leading-relaxed text-zinc-300">
                                {item}
                              </span>
                            </div>
                          ))
                        : section.items.map((item, i) => (
                            <div key={i} className="flex items-start gap-1.5">
                              <span
                                className={`mt-1 h-1 w-1 shrink-0 rounded-full ${section.accent.replace("text-", "bg-")}`}
                              />
                              <span className="text-[11px] leading-relaxed text-zinc-400">
                                {item}
                              </span>
                            </div>
                          ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
