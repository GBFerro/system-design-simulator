"use client";

import { ModalShell } from "./ModalShell";
import {
  X,
  BookOpen,
  Boxes,
  GraduationCap,
  Activity,
  Command,
  Sparkles,
  PlayCircle,
} from "lucide-react";

interface HowItWorksDialogProps {
  open: boolean;
  onClose: () => void;
  /** Jump the user into picking a problem (closes the dialog first). */
  onPickProblem?: () => void;
  /** Launch the animated walkthrough. */
  onPlayWalkthrough?: () => void;
}

const MODES = [
  {
    icon: BookOpen,
    title: "Learn",
    color: "text-blue-400 bg-blue-500/10 ring-blue-500/25",
    body: "Select any component to read when to use it, when not to, key trade-offs, and real-world examples. Follow the Learning Path from Foundations to Expert.",
  },
  {
    icon: Boxes,
    title: "Practice",
    color: "text-emerald-400 bg-emerald-500/10 ring-emerald-500/25",
    body: "Pick one of 35 problems, drop components on the canvas, wire them up, and iterate until your score climbs.",
  },
  {
    icon: GraduationCap,
    title: "Interview",
    color: "text-cyan-400 bg-cyan-500/10 ring-cyan-500/25",
    body: "Run a timed 6-phase mock — Requirements → Estimation → API → Data Model → High-Level Design → Deep Dive — with a wall-clock timer and per-phase guidance.",
  },
  {
    icon: Activity,
    title: "Analyze",
    color: "text-amber-400 bg-amber-500/10 ring-amber-500/25",
    body: "Simulate traffic to see per-node QPS, utilization and bottlenecks. Use the Capacity calculator for back-of-envelope math and Trade-off cards for the classic decisions.",
  },
];

const STEPS = [
  ["Pick a problem", "Choose from the top-bar dropdown (or start on a blank canvas)."],
  ["Build", "Drag components from the left sidebar — or press ⌘K and search for one."],
  [
    "Wire it up",
    "Drag between node handles to connect; click an edge to set its protocol & sync/async mode.",
  ],
  ["Simulate", "Press ⌘↵ to push 1K–500K req/s through your design and watch it behave."],
  [
    "Score",
    "Press ⌘⇧S to get rated across Scalability, Availability, Latency, Cost & Trade-offs — with concrete fixes.",
  ],
  [
    "Iterate & save",
    "Refine the design, then Save it or Export as PNG/SVG/JSON. Load Reference shows a model solution.",
  ],
];

export function HowItWorksDialog({
  open,
  onClose,
  onPickProblem,
  onPlayWalkthrough,
}: HowItWorksDialogProps) {
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      ariaLabel="How SystemForge works"
      panelClassName="max-w-2xl"
    >
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-zinc-800 bg-zinc-900/95 px-5 py-4 backdrop-blur">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.svg" alt="" width={26} height={26} className="h-[26px] w-[26px]" />
          <div>
            <h2 className="font-display text-base font-bold tracking-tight text-zinc-50">
              How SystemForge works
            </h2>
            <p className="text-xs text-zinc-400">
              Build architectures, simulate traffic, and get scored like a real interview.
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          data-autofocus
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-6 px-5 py-5">
        {/* Animated walkthrough launcher */}
        {onPlayWalkthrough && (
          <button
            onClick={onPlayWalkthrough}
            className="group flex w-full items-center gap-3 overflow-hidden rounded-xl border border-cyan-500/30 bg-gradient-to-r from-cyan-500/15 to-blue-500/10 px-4 py-3 text-left transition-colors hover:border-cyan-400/50"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-500 text-white shadow-md shadow-cyan-500/30 transition-transform group-hover:scale-105">
              <PlayCircle className="h-5 w-5" />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-semibold text-zinc-50">
                Watch the 60-second walkthrough
              </span>
              <span className="block text-xs text-zinc-400">
                An animated tour of the whole flow — build, simulate, score & interview.
              </span>
            </span>
            <Sparkles className="h-4 w-4 shrink-0 text-cyan-400" />
          </button>
        )}

        {/* Four modes */}
        <section>
          <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Four ways to use it
          </p>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {MODES.map((m) => {
              const Icon = m.icon;
              return (
                <div key={m.title} className="rounded-lg border border-zinc-800 bg-zinc-800/40 p-3">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-lg ring-1 ${m.color}`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="text-sm font-semibold text-zinc-100">{m.title}</span>
                  </div>
                  <p className="text-xs leading-relaxed text-zinc-400">{m.body}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Core loop */}
        <section>
          <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            The core loop
          </p>
          <ol className="space-y-2">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-500/15 font-mono text-[11px] font-bold text-cyan-400">
                  {i + 1}
                </span>
                <p className="text-xs leading-relaxed text-zinc-300">
                  <span className="font-semibold text-zinc-100">{title}.</span>{" "}
                  <span className="text-zinc-400">{body}</span>
                </p>
              </li>
            ))}
          </ol>
        </section>

        {/* Tips */}
        <section className="rounded-lg border border-zinc-800 bg-zinc-800/40 p-3.5">
          <div className="flex items-start gap-2.5">
            <Command className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
            <p className="text-xs leading-relaxed text-zinc-400">
              <span className="font-semibold text-zinc-200">Power tip:</span> press{" "}
              <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                ⌘K
              </kbd>{" "}
              anywhere to search problems, add components, and run actions. You can also create your
              own components & problems, and everything saves to your browser automatically.
            </p>
          </div>
        </section>
      </div>

      {/* Footer */}
      <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-zinc-800 bg-zinc-900/95 px-5 py-3 backdrop-blur">
        <button
          onClick={onClose}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200"
        >
          Maybe later
        </button>
        <button
          onClick={() => {
            onClose();
            onPickProblem?.();
          }}
          className="flex items-center gap-1.5 rounded-md bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-cyan-400"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Pick a problem
        </button>
      </div>
    </ModalShell>
  );
}
