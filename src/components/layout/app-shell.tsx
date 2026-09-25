"use client";

import { useCallback, useEffect, useState } from "react";
import { ReactFlowProvider, type Node } from "@xyflow/react";
import { X } from "lucide-react";
import { TopBar } from "./top-bar";
import { SupportFAB } from "./SupportFAB";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { RightPanel } from "@/components/panel/RightPanel";
import { DesignCanvas } from "@/components/canvas/DesignCanvas";
import { useAppStore } from "@/store/appStore";
import { useCanvasStore, type ComponentNodeData } from "@/store/canvasStore";
import { useSimulationStore } from "@/store/simulationStore";
import { runSimulation } from "@/engine/simulator";
import { scoreDesign } from "@/scoring/scorer";
import { PROBLEMS } from "@/data/problems";
import { loadReferenceIntoTab } from "@/lib/loadReference";
import { Toast } from "@/components/ui/Toast";
import { SaveDialog } from "@/components/dialogs/SaveDialog";
import { LoadDialog } from "@/components/dialogs/LoadDialog";
import { InterviewBar } from "@/components/interview/InterviewBar";
import { InterviewStartDialog } from "@/components/interview/InterviewStartDialog";
import { CreateProblemDialog } from "@/components/dialogs/CreateProblemDialog";
import { CreateComponentDialog } from "@/components/dialogs/CreateComponentDialog";
import { SupportDialog } from "@/components/dialogs/SupportDialog";
import { useInterviewStore } from "@/store/interviewStore";
import { useIsMobile } from "@/hooks/useBreakpoint";
import { CommandPalette } from "@/components/CommandPalette";
import { HowItWorksDialog } from "@/components/dialogs/HowItWorksDialog";
import { Walkthrough } from "@/components/Walkthrough";
import { ShortcutsDialog } from "@/components/dialogs/ShortcutsDialog";
import { PaletteDndProvider } from "@/components/canvas/PaletteDnd";
import { OPEN_PROPERTIES_EVENT, isTypingTarget } from "@/components/canvas/canvasEvents";
import { rehydrateAllStores } from "@/store/hydration";

export function AppShell() {
  const isMobile = useIsMobile();
  const leftSidebarOpen = useAppStore((s) => s.leftSidebarOpen);
  const rightPanelOpen = useAppStore((s) => s.rightPanelOpen);
  const toggleLeftSidebar = useAppStore((s) => s.toggleLeftSidebar);
  const toggleRightPanel = useAppStore((s) => s.toggleRightPanel);

  // Mobile drawer state — local, does not persist
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileRightOpen, setMobileRightOpen] = useState(false);

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [interviewDialogOpen, setInterviewDialogOpen] = useState(false);
  const [createProblemDialogOpen, setCreateProblemDialogOpen] = useState(false);
  const [createComponentDialogOpen, setCreateComponentDialogOpen] = useState(false);
  const [supportDialogOpen, setSupportDialogOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Load persisted state from localStorage once, after mount. All stores use
  // `skipHydration: true` (so SSR and first client render agree), so without
  // this call nothing would ever be restored — the canvas, saved designs,
  // custom components, etc. would reset on every refresh / new tab.
  useEffect(() => {
    rehydrateAllStores();
  }, []);

  // Auto-open support dialog when URL has ?support=1 (used by the README link)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("support") === "1") {
      // Reading the URL (external system) once on mount — a lazy initializer
      // would cause an SSR hydration mismatch, so the effect is intentional.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSupportDialogOpen(true);
      params.delete("support");
      const q = params.toString();
      const next = window.location.pathname + (q ? `?${q}` : "") + window.location.hash;
      window.history.replaceState({}, "", next);
    }
  }, []);
  const interviewMode = useInterviewStore((s) => s.mode);
  const timerRunning = useInterviewStore((s) => s.timerRunning);
  const tickTimer = useInterviewStore((s) => s.tickTimer);

  const handleToggleLeft = useCallback(() => {
    if (isMobile) setMobileSidebarOpen((v) => !v);
    else toggleLeftSidebar();
  }, [isMobile, toggleLeftSidebar]);

  const handleToggleRight = useCallback(() => {
    if (isMobile) setMobileRightOpen((v) => !v);
    else toggleRightPanel();
  }, [isMobile, toggleRightPanel]);

  // Close any open mobile drawers when we transition to desktop
  // (render-time adjustment — https://react.dev/learn/you-might-not-need-an-effect)
  if (!isMobile && (mobileSidebarOpen || mobileRightOpen)) {
    setMobileSidebarOpen(false);
    setMobileRightOpen(false);
  }

  // On tablets (768–1023px) default the right panel to closed on first load
  // so the canvas gets the space. Runs once; the user can still toggle it.
  useEffect(() => {
    if (
      window.matchMedia("(min-width: 768px) and (max-width: 1023px)").matches &&
      useAppStore.getState().rightPanelOpen
    ) {
      useAppStore.getState().toggleRightPanel();
    }
  }, []);

  // "Open in panel" / "Rename" from the canvas context menu
  useEffect(() => {
    function onOpenProperties() {
      useAppStore.getState().setActiveRightTab("properties");
      if (isMobile) setMobileRightOpen(true);
      else if (!useAppStore.getState().rightPanelOpen) toggleRightPanel();
    }
    window.addEventListener(OPEN_PROPERTIES_EVENT, onOpenProperties);
    return () => window.removeEventListener(OPEN_PROPERTIES_EVENT, onOpenProperties);
  }, [isMobile, toggleRightPanel]);

  const handleSave = useCallback(() => setSaveDialogOpen(true), []);
  const handleLoad = useCallback(() => setLoadDialogOpen(true), []);
  const handleSimulate = useCallback(() => {
    const { nodes, edges } = useCanvasStore.getState();
    const { config } = useSimulationStore.getState();

    const componentNodes = nodes.filter((n) => n.type !== "text") as Node<ComponentNodeData>[];

    if (componentNodes.length === 0) {
      useAppStore.getState().showToast("No components to simulate", "info");
      return;
    }

    useSimulationStore.getState().setRunning(true);

    setTimeout(() => {
      const result = runSimulation(componentNodes, edges, config.requestsPerSec);

      const updates = new Map<string, Record<string, unknown>>();
      for (const [nodeId, metrics] of result.nodeMetrics) {
        updates.set(nodeId, {
          utilization: metrics.utilization,
          status: metrics.status,
          isBottleneck: metrics.isBottleneck,
        });
      }
      useCanvasStore.getState().updateAllNodeData(updates);

      useSimulationStore.getState().setResult(result);
      useSimulationStore.getState().setRunning(false);
      useAppStore.getState().showToast("Simulation complete!", "success");
    }, 100);
  }, []);

  const handleScore = useCallback(() => {
    const { nodes, edges } = useCanvasStore.getState();
    const componentNodes = nodes.filter((n) => n.type !== "text") as Node<ComponentNodeData>[];

    if (componentNodes.length === 0) {
      useAppStore.getState().showToast("No components to score", "info");
      return;
    }

    const result = scoreDesign(componentNodes, edges);
    useSimulationStore.getState().setScoreResult(result);
    useSimulationStore.getState().setShowScore(true);
    useAppStore.getState().setActiveRightTab("score");

    // On mobile, auto-open the right sheet so the score is visible
    if (isMobile) setMobileRightOpen(true);

    useAppStore.getState().showToast("Design scored!", "success");
  }, [isMobile]);

  const handleClearCanvas = useCallback(() => {
    useCanvasStore.getState().clearCanvas();
    useAppStore.getState().showToast("Canvas cleared", "info");
  }, []);

  const handlePickProblem = useCallback(() => {
    useAppStore.getState().setActiveLeftTab("problems");
    if (isMobile) setMobileSidebarOpen(true);
    else useAppStore.getState().setLeftSidebarOpen(true);
  }, [isMobile]);

  const handleLoadReference = useCallback(() => {
    const problemId = useAppStore.getState().selectedProblemId;
    const problem = PROBLEMS.find((p) => p.id === problemId);
    if (!problem) {
      useAppStore.getState().showToast("Pick a problem first", "info");
      handlePickProblem();
      return;
    }
    loadReferenceIntoTab(problem);
  }, [handlePickProblem]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;

      // e.key is "S" (uppercase) when Shift is held — normalize for shortcuts
      const key = e.key.toLowerCase();

      // Selection editing (delete, copy/paste, arrows…) lives in the canvas:
      // see components/canvas/useCanvasShortcuts.ts

      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }

      // Command palette — Cmd/Ctrl+K (toggle)
      if (key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCommandOpen((v) => !v);
        return;
      }

      // Undo / Redo — Cmd/Ctrl+Z, redo via Shift+Z or Ctrl+Y. Disabled on read-only tabs.
      if (key === "z" && (e.metaKey || e.ctrlKey)) {
        const { tabs, activeTabId, undo, redo } = useCanvasStore.getState();
        const isReadOnlyTab = tabs.find((t) => t.id === activeTabId)?.readOnly === true;
        if (!isReadOnlyTab) {
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
        }
      }
      if (key === "y" && (e.metaKey || e.ctrlKey)) {
        const { tabs, activeTabId, redo } = useCanvasStore.getState();
        const isReadOnlyTab = tabs.find((t) => t.id === activeTabId)?.readOnly === true;
        if (!isReadOnlyTab) {
          e.preventDefault();
          redo();
        }
      }

      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSimulate();
      }

      if (key === "s" && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault();
        handleScore();
      }

      if (key === "s" && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault();
        setSaveDialogOpen(true);
      }

      if (key === "o" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setLoadDialogOpen(true);
      }

      if (e.key === "Escape") {
        if (mobileSidebarOpen) setMobileSidebarOpen(false);
        else if (mobileRightOpen) setMobileRightOpen(false);
        else useCanvasStore.getState().clearSelection();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSimulate, handleScore, mobileSidebarOpen, mobileRightOpen]);

  useEffect(() => {
    if (!timerRunning) return;
    const id = setInterval(() => {
      tickTimer();
    }, 1000);
    return () => clearInterval(id);
  }, [timerRunning, tickTimer]);

  return (
    <ReactFlowProvider>
      <PaletteDndProvider onPaletteDragStart={() => setMobileSidebarOpen(false)}>
        <div className="flex h-full flex-col">
          {interviewMode === "interview" && <InterviewBar />}
          <TopBar
            onSimulate={handleSimulate}
            onScore={handleScore}
            onClearCanvas={handleClearCanvas}
            onSave={handleSave}
            onLoad={handleLoad}
            onStartInterview={() => setInterviewDialogOpen(true)}
            onCreateProblem={() => setCreateProblemDialogOpen(true)}
            onOpenSupport={() => setSupportDialogOpen(true)}
            onToggleLeft={handleToggleLeft}
            onToggleRight={handleToggleRight}
          />

          <div className="relative flex flex-1 overflow-hidden">
            {/* Desktop inline sidebar (hidden on mobile) */}
            <Sidebar
              open={leftSidebarOpen}
              onCreateProblem={() => setCreateProblemDialogOpen(true)}
              onCreateCustomComponent={() => setCreateComponentDialogOpen(true)}
              variant="desktop"
            />

            <DesignCanvas
              onPickProblem={handlePickProblem}
              onLoadReference={handleLoadReference}
              onStartInterview={() => setInterviewDialogOpen(true)}
              onShowGuide={() => setHowItWorksOpen(true)}
            />

            {/* Desktop inline right panel (hidden on mobile) */}
            <RightPanel open={rightPanelOpen} onSimulate={handleSimulate} variant="desktop" />

            {/* Mobile: sidebar drawer from left */}
            {isMobile && (
              <>
                {/* Backdrop */}
                <div
                  className={`absolute inset-0 z-30 bg-black/60 transition-opacity md:hidden ${
                    mobileSidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"
                  }`}
                  onClick={() => setMobileSidebarOpen(false)}
                />
                {/* Drawer */}
                <div
                  className={`absolute inset-y-0 left-0 z-40 flex w-[85%] max-w-[320px] flex-col border-r border-zinc-800 bg-zinc-900 shadow-xl transition-transform md:hidden ${
                    mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
                  }`}
                  aria-hidden={!mobileSidebarOpen}
                  inert={!mobileSidebarOpen || undefined}
                >
                  <div className="flex h-10 shrink-0 items-center justify-between border-b border-zinc-800 px-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      Library
                    </span>
                    <button
                      onClick={() => setMobileSidebarOpen(false)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                      aria-label="Close sidebar"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="min-h-0 flex-1">
                    <Sidebar
                      onCreateProblem={() => {
                        setCreateProblemDialogOpen(true);
                        setMobileSidebarOpen(false);
                      }}
                      onCreateCustomComponent={() => {
                        setCreateComponentDialogOpen(true);
                        setMobileSidebarOpen(false);
                      }}
                      onComponentAdded={() => setMobileSidebarOpen(false)}
                      variant="mobile"
                    />
                  </div>
                </div>

                {/* Mobile: right panel as bottom sheet */}
                <div
                  className={`absolute inset-0 z-30 bg-black/60 transition-opacity md:hidden ${
                    mobileRightOpen ? "opacity-100" : "pointer-events-none opacity-0"
                  }`}
                  onClick={() => setMobileRightOpen(false)}
                />
                <div
                  className={`absolute inset-x-0 bottom-0 z-40 flex h-[70dvh] max-h-[85dvh] flex-col rounded-t-2xl border-t border-zinc-800 bg-zinc-900 shadow-2xl transition-transform md:hidden ${
                    mobileRightOpen ? "translate-y-0" : "translate-y-full"
                  }`}
                  aria-hidden={!mobileRightOpen}
                  inert={!mobileRightOpen || undefined}
                >
                  <div className="flex shrink-0 items-center justify-between pt-2">
                    <div className="flex-1" />
                    <div className="sheet-handle" />
                    <div className="flex flex-1 justify-end pr-3">
                      <button
                        onClick={() => setMobileRightOpen(false)}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                        aria-label="Close panel"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 pb-[env(safe-area-inset-bottom)]">
                    <RightPanel onSimulate={handleSimulate} variant="mobile" />
                  </div>
                </div>
              </>
            )}
          </div>

          <SupportFAB
            onClick={() => setSupportDialogOpen(true)}
            hidden={mobileSidebarOpen || mobileRightOpen}
          />

          <Toast />

          <SaveDialog open={saveDialogOpen} onClose={() => setSaveDialogOpen(false)} />
          <LoadDialog open={loadDialogOpen} onClose={() => setLoadDialogOpen(false)} />
          <InterviewStartDialog
            open={interviewDialogOpen}
            onClose={() => setInterviewDialogOpen(false)}
          />
          <CreateProblemDialog
            open={createProblemDialogOpen}
            onClose={() => setCreateProblemDialogOpen(false)}
          />
          <CreateComponentDialog
            open={createComponentDialogOpen}
            onClose={() => setCreateComponentDialogOpen(false)}
          />
          <SupportDialog open={supportDialogOpen} onClose={() => setSupportDialogOpen(false)} />
          <CommandPalette
            key={commandOpen ? "cmd-open" : "cmd-closed"}
            open={commandOpen}
            onClose={() => setCommandOpen(false)}
            actions={{
              onSimulate: handleSimulate,
              onScore: handleScore,
              onSave: handleSave,
              onLoad: handleLoad,
              onStartInterview: () => setInterviewDialogOpen(true),
              onLoadReference: handleLoadReference,
              onClear: handleClearCanvas,
              onOpenSupport: () => setSupportDialogOpen(true),
              onShowGuide: () => setHowItWorksOpen(true),
            }}
          />
          <HowItWorksDialog
            open={howItWorksOpen}
            onClose={() => setHowItWorksOpen(false)}
            onPickProblem={handlePickProblem}
            onPlayWalkthrough={() => {
              setHowItWorksOpen(false);
              setWalkthroughOpen(true);
            }}
          />
          <Walkthrough
            open={walkthroughOpen}
            onClose={() => setWalkthroughOpen(false)}
            onPickProblem={handlePickProblem}
          />
          <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        </div>
      </PaletteDndProvider>
    </ReactFlowProvider>
  );
}
