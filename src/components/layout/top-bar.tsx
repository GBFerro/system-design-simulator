"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Play,
  Trophy,
  ChevronDown,
  PanelLeft,
  PanelRight,
  Trash2,
  Download,
  ImageIcon,
  FileCode2,
  FileJson,
  Save,
  FolderOpen,
  StickyNote,
  GraduationCap,
  Plus,
  MoreHorizontal,
  Heart,
  Coffee,
  Undo2,
  Redo2,
  Loader2,
  Sun,
  Moon,
} from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { useCanvasStore, useIsActiveTabReadOnly } from "@/store/canvasStore";
import { useSimulationStore } from "@/store/simulationStore";
import { usePenStore } from "@/store/penStore";
import { PROBLEMS } from "@/data/problems";
import { useCustomProblemsStore } from "@/store/customProblemsStore";
import { useReactFlow } from "@xyflow/react";
import { createTextNode } from "@/lib/nodeFactory";
import { isTypingTarget } from "@/components/canvas/canvasEvents";
import { visibleCanvasCenter } from "@/lib/placement";
import { loadReferenceIntoTab } from "@/lib/loadReference";
import { exportAsPng, exportAsSvg, exportAsJSON } from "@/lib/exportCanvas";
import { ConfirmDialog } from "@/components/dialogs/ConfirmDialog";
import { PlaybackMini } from "@/components/traffic/PlaybackMini";

interface TopBarProps {
  onSimulate: () => void;
  onScore: () => void;
  onClearCanvas: () => void;
  onSave: () => void;
  onLoad: () => void;
  onStartInterview: () => void;
  onCreateProblem: () => void;
  onOpenSupport: () => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
}

export function TopBar({
  onSimulate,
  onScore,
  onClearCanvas,
  onSave,
  onLoad,
  onStartInterview,
  onCreateProblem,
  onOpenSupport,
  onToggleLeft,
  onToggleRight,
}: TopBarProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const { screenToFlowPosition } = useReactFlow();
  const placeNode = useCanvasStore((s) => s.placeNode);
  const isSimulating = useSimulationStore((s) => s.isRunning);

  // Undo/redo — subscribe to stack lengths so the buttons enable/disable reactively
  const canUndo = useCanvasStore((s) => s.history.length > 0);
  const canRedo = useCanvasStore((s) => s.future.length > 0);
  const activeTabReadOnly = useIsActiveTabReadOnly();
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);

  const selectedProblemId = useAppStore((s) => s.selectedProblemId);
  const setSelectedProblem = useAppStore((s) => s.setSelectedProblem);
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);

  const customProblems = useCustomProblemsStore((s) => s.problems);
  const currentProblem =
    PROBLEMS.find((p) => p.id === selectedProblemId) ??
    customProblems.find((p) => p.id === selectedProblemId);

  const addTextNote = useCallback(() => {
    placeNode(createTextNode({ x: 0, y: 0 }), visibleCanvasCenter(screenToFlowPosition));
  }, [screenToFlowPosition, placeNode]);

  const handleExportPng = useCallback(async () => {
    setExportOpen(false);
    const name = currentProblem?.title ?? "design";
    try {
      await exportAsPng(name);
      useAppStore.getState().showToast("Exported as PNG", "success");
    } catch {
      useAppStore.getState().showToast("Export failed", "error");
    }
  }, [currentProblem]);

  const handleExportSvg = useCallback(async () => {
    setExportOpen(false);
    const name = currentProblem?.title ?? "design";
    try {
      await exportAsSvg(name);
      useAppStore.getState().showToast("Exported as SVG", "success");
    } catch {
      useAppStore.getState().showToast("Export failed", "error");
    }
  }, [currentProblem]);

  const handleExportJson = useCallback(() => {
    setExportOpen(false);
    const name = currentProblem?.title ?? "design";
    const { nodes, edges } = useCanvasStore.getState();
    const { strokes } = usePenStore.getState();
    if (nodes.length === 0 && strokes.length === 0) {
      useAppStore.getState().showToast("Nothing to export", "info");
      return;
    }
    exportAsJSON(nodes, edges, name, strokes);
    useAppStore.getState().showToast("Exported as JSON", "success");
  }, [currentProblem]);

  // Keyboard shortcut: Ctrl/Cmd+E → Export as PNG
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (e.key === "e" && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault();
        handleExportPng();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleExportPng]);

  const loadReference = useCallback(() => {
    const problem = PROBLEMS.find((p) => p.id === selectedProblemId);
    if (!problem) return;
    // Opens the reference in a NEW read-only tab — user's design stays safe
    loadReferenceIntoTab(problem);
  }, [selectedProblemId]);

  return (
    <>
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900 px-2 md:gap-3 md:px-3">
        {/* Left section */}
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <button
            onClick={onToggleLeft}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            title="Toggle sidebar"
            aria-label="Toggle sidebar"
          >
            <PanelLeft className="h-4 w-4" />
          </button>

          <div className="flex shrink-0 items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-mark.svg"
              alt="SystemForge"
              width={20}
              height={20}
              className="h-5 w-5"
            />
            <span className="hidden font-display text-[15px] font-bold tracking-[-0.02em] text-zinc-50 sm:inline">
              SystemForge
            </span>
          </div>

          <div className="mx-1 hidden h-4 w-px bg-zinc-800 md:block" />

          {/* Problem selector */}
          <div className="relative min-w-0 flex-shrink">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex min-w-0 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-zinc-100"
            >
              <span className="max-w-[120px] truncate md:max-w-none">
                {currentProblem?.title ?? "Select Problem"}
              </span>
              <ChevronDown className="h-3 w-3 shrink-0 text-zinc-500" />
            </button>

            {dropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)} />
                <div className="absolute left-0 top-full z-50 mt-1 max-h-80 w-56 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-800 py-1 shadow-lg">
                  {/* Create custom problem */}
                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      onCreateProblem();
                    }}
                    className="flex w-full items-center gap-1.5 border-b border-zinc-700 px-3 py-1.5 text-left text-xs font-medium text-violet-400 transition-colors hover:bg-zinc-700"
                  >
                    <Plus className="h-3 w-3" />
                    Create Custom Problem
                  </button>

                  {/* Custom problems */}
                  {customProblems.map((problem) => (
                    <button
                      key={problem.id}
                      onClick={() => {
                        setSelectedProblem(problem.id);
                        setDropdownOpen(false);
                      }}
                      className={`flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs transition-colors hover:bg-zinc-700 ${
                        problem.id === selectedProblemId
                          ? "text-cyan-500"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      <span className="flex-1 truncate">{problem.title}</span>
                      <span className="shrink-0 rounded bg-violet-500/10 px-1 py-0.5 text-[9px] font-medium text-violet-400">
                        Custom
                      </span>
                    </button>
                  ))}

                  {customProblems.length > 0 && <div className="my-0.5 h-px bg-zinc-700" />}

                  {/* Predefined problems */}
                  {PROBLEMS.map((problem) => (
                    <button
                      key={problem.id}
                      onClick={() => {
                        setSelectedProblem(problem.id);
                        setDropdownOpen(false);
                      }}
                      className={`flex w-full items-center px-3 py-1.5 text-left text-xs transition-colors hover:bg-zinc-700 ${
                        problem.id === selectedProblemId
                          ? "text-cyan-500"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {problem.title}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {!selectedProblemId.startsWith("custom-") && (
            <button
              onClick={loadReference}
              className="hidden shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-300 md:flex"
              title="Load reference solution"
            >
              <Download className="h-3 w-3" />
              Reference
            </button>
          )}

          <div className="mx-1 hidden h-4 w-px bg-zinc-800 md:block" />

          <button
            onClick={addTextNote}
            className="hidden shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 md:flex"
            title="Add text note to canvas"
          >
            <StickyNote className="h-3 w-3" />
            Add Note
          </button>

          <div className="mx-1 hidden h-4 w-px bg-zinc-800 md:block" />

          <button
            onClick={undo}
            disabled={!canUndo || activeTabReadOnly}
            className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-40 md:flex"
            title="Undo (⌘Z)"
            aria-label="Undo"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo || activeTabReadOnly}
            className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-40 md:flex"
            title="Redo (⌘⇧Z)"
            aria-label="Redo"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>

          <div className="mx-1 hidden h-4 w-px bg-zinc-800 md:block" />

          <button
            onClick={onStartInterview}
            className="hidden shrink-0 items-center gap-1 rounded-md bg-zinc-800 px-2 py-1 text-[10px] font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-zinc-100 md:flex"
            title="Start a guided interview practice"
          >
            <GraduationCap className="h-3.5 w-3.5" />
            Practice Interview
          </button>

          {/* Mobile-only overflow menu */}
          <div className="relative md:hidden">
            <button
              onClick={() => setMobileMoreOpen((v) => !v)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              title="More actions"
              aria-label="More actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {mobileMoreOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMobileMoreOpen(false)} />
                <div className="absolute left-0 top-full z-50 mt-1 w-60 rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg">
                  {/* Design actions */}
                  {!selectedProblemId.startsWith("custom-") && (
                    <button
                      onClick={() => {
                        setMobileMoreOpen(false);
                        loadReference();
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
                    >
                      <Download className="h-3.5 w-3.5 text-zinc-500" />
                      Load reference solution
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setMobileMoreOpen(false);
                      addTextNote();
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
                  >
                    <StickyNote className="h-3.5 w-3.5 text-zinc-500" />
                    Add text note
                  </button>
                  <button
                    onClick={() => {
                      setMobileMoreOpen(false);
                      onStartInterview();
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
                  >
                    <GraduationCap className="h-3.5 w-3.5 text-zinc-500" />
                    Practice interview
                  </button>

                  <div className="my-1 h-px bg-zinc-800" />

                  {/* File */}
                  <button
                    onClick={() => {
                      setMobileMoreOpen(false);
                      onSave();
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
                  >
                    <Save className="h-3.5 w-3.5 text-zinc-500" />
                    Save design
                  </button>
                  <button
                    onClick={() => {
                      setMobileMoreOpen(false);
                      onLoad();
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-zinc-500" />
                    Load design
                  </button>

                  <div className="my-1 h-px bg-zinc-800" />

                  {/* Export */}
                  <button
                    onClick={() => {
                      setMobileMoreOpen(false);
                      handleExportPng();
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
                  >
                    <ImageIcon className="h-3.5 w-3.5 text-zinc-500" />
                    Export as PNG
                  </button>
                  <button
                    onClick={() => {
                      setMobileMoreOpen(false);
                      handleExportSvg();
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
                  >
                    <FileCode2 className="h-3.5 w-3.5 text-zinc-500" />
                    Export as SVG
                  </button>
                  <button
                    onClick={() => {
                      setMobileMoreOpen(false);
                      handleExportJson();
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
                  >
                    <FileJson className="h-3.5 w-3.5 text-zinc-500" />
                    Export as JSON
                  </button>

                  <div className="my-1 h-px bg-zinc-800" />

                  {/* Support */}
                  <button
                    onClick={() => {
                      setMobileMoreOpen(false);
                      onOpenSupport();
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
                  >
                    <Heart className="h-3.5 w-3.5 fill-rose-400/40 text-rose-400" />
                    Support this project
                  </button>

                  <div className="my-1 h-px bg-zinc-800" />

                  {/* Danger */}
                  <button
                    onClick={() => {
                      setMobileMoreOpen(false);
                      setClearConfirmOpen(true);
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs text-rose-400 transition-colors hover:bg-zinc-800"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Clear canvas
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right section */}
        <div className="flex items-center gap-1 md:gap-2">
          <button
            onClick={onSave}
            className="hidden h-7 items-center gap-1 rounded-md px-2 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 md:flex"
            title="Save design (Ctrl+S)"
          >
            <Save className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Save</span>
          </button>
          <button
            onClick={onLoad}
            className="hidden h-7 items-center gap-1 rounded-md px-2 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 md:flex"
            title="Load design (Ctrl+O)"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Load</span>
          </button>

          <div className="hidden h-4 w-px bg-zinc-800 md:block" />

          {/* Export dropdown — desktop only; mobile goes through overflow menu */}
          <div className="relative hidden md:block">
            <button
              onClick={() => setExportOpen(!exportOpen)}
              className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              title="Export design (Ctrl+E)"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Export</span>
              <ChevronDown className="h-2.5 w-2.5 text-zinc-500" />
            </button>

            {exportOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setExportOpen(false)} />
                <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg">
                  <button
                    onClick={handleExportPng}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                  >
                    <ImageIcon className="h-3.5 w-3.5" />
                    Export as PNG
                    <kbd className="ml-auto rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 font-mono text-[9px] text-zinc-500">
                      {"\u2318"}E
                    </kbd>
                  </button>
                  <button
                    onClick={handleExportSvg}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                  >
                    <FileCode2 className="h-3.5 w-3.5" />
                    Export as SVG
                  </button>
                  <button
                    onClick={handleExportJson}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                  >
                    <FileJson className="h-3.5 w-3.5" />
                    Export as JSON
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="hidden h-4 w-px bg-zinc-800 md:block" />

          <button
            onClick={() => setClearConfirmOpen(true)}
            className="hidden h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-rose-400 md:flex"
            title="Clear canvas"
            aria-label="Clear canvas"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>

          <PlaybackMini />

          <Button
            size="sm"
            onClick={onSimulate}
            disabled={isSimulating}
            className="h-7 gap-1.5 bg-cyan-500 px-3 text-xs font-medium text-white transition-colors hover:bg-cyan-400 disabled:opacity-80"
          >
            {isSimulating ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="hidden sm:inline">Simulating…</span>
              </>
            ) : (
              <>
                <Play className="h-3 w-3" />
                <span className="hidden sm:inline">Simulate</span>
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onScore}
            className="h-7 gap-1.5 border border-zinc-700 bg-transparent px-2.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 sm:px-3"
          >
            <Trophy className="h-3 w-3" />
            <span className="hidden sm:inline">Score</span>
          </Button>

          {/* Buy me a coffee — desktop only (mobile has FAB + overflow menu) */}
          <button
            onClick={onOpenSupport}
            className="hidden h-7 items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2.5 text-xs font-medium text-cyan-400 transition-colors hover:border-cyan-400/50 hover:bg-cyan-500/15 hover:text-cyan-300 md:flex"
            title="Buy me a coffee — support the project"
          >
            <Coffee className="h-3.5 w-3.5" />
            <span>Buy me a coffee</span>
          </button>

          <button
            onClick={toggleTheme}
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            aria-label="Toggle color theme"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <button
            onClick={onToggleRight}
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            title="Toggle panel"
            aria-label="Toggle properties panel"
          >
            <PanelRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      <ConfirmDialog
        open={clearConfirmOpen}
        title="Clear canvas?"
        message="All components and connections on the current tab will be removed. This can't be undone."
        confirmText="Clear canvas"
        danger
        onConfirm={onClearCanvas}
        onClose={() => setClearConfirmOpen(false)}
      />
    </>
  );
}
