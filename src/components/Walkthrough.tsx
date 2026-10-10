"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Sparkles,
  Globe,
  Server,
  Database,
  Boxes,
  Network,
  Gauge,
  Command,
  Clock,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Small building blocks for the animated scenes                       */
/* ------------------------------------------------------------------ */

const EASE = [0.16, 1, 0.3, 1] as const;

function NodeBox({
  icon: Icon,
  label,
  color,
  delay = 0,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  color: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ delay, duration: 0.45, ease: EASE }}
      className="flex items-center gap-2 rounded-xl border border-zinc-700/80 bg-zinc-900 px-3 py-2 shadow-[var(--shadow-e2)]"
    >
      <span className={`flex h-7 w-7 items-center justify-center rounded-lg ring-1 ${color}`}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="whitespace-nowrap text-xs font-medium text-zinc-200">{label}</span>
    </motion.div>
  );
}

/** Animated count-up that replays whenever the scene remounts. */
function CountUp({ to, duration = 1400 }: { to: number; duration?: number }) {
  const [v, setV] = useState(0);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    let start: number | null = null;
    const tick = (t: number) => {
      if (start === null) start = t;
      const p = Math.min((t - start) / duration, 1);
      setV(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [to, duration]);
  return <>{v}</>;
}

/* ------------------------------------------------------------------ */
/* Scenes                                                              */
/* ------------------------------------------------------------------ */

function SceneWelcome() {
  return (
    <div className="flex flex-col items-center justify-center gap-5">
      <motion.div
        initial={{ scale: 0, rotate: -20 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 180, damping: 14 }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-mark.svg" alt="" width={72} height={72} className="h-[72px] w-[72px]" />
      </motion.div>
      <div className="flex items-center gap-2">
        {[Globe, Server, Database].map((Icon, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 + i * 0.15, duration: 0.4 }}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-800 text-cyan-400 ring-1 ring-cyan-500/20"
          >
            <Icon className="h-4 w-4" />
          </motion.span>
        ))}
      </div>
    </div>
  );
}

const STEP_LABELS_DEMO = ["Problem", "Design", "Simulate", "Failures", "Evaluate"];

/** The step bar the app opens with: one step lit at a time, in order. */
function SceneSteps() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5" data-tour-steps>
      {STEP_LABELS_DEMO.map((label, i) => (
        <motion.span
          key={label}
          initial={{ opacity: 0.35, scale: 0.95 }}
          animate={{ opacity: [0.35, 1, 0.55], scale: [0.95, 1.05, 1] }}
          transition={{ delay: i * 0.6, duration: 0.9, ease: EASE }}
          className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200"
        >
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-cyan-500 text-[10px] font-bold text-zinc-950">
            {i + 1}
          </span>
          {label}
        </motion.span>
      ))}
    </div>
  );
}

function SceneBuild() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <NodeBox
        icon={Globe}
        label="Load Balancer"
        color="bg-blue-500/10 text-blue-400 ring-blue-500/25"
        delay={0}
      />
      <NodeBox
        icon={Server}
        label="App Server"
        color="bg-violet-500/10 text-violet-400 ring-violet-500/25"
        delay={0.35}
      />
      <NodeBox
        icon={Database}
        label="Database"
        color="bg-amber-500/10 text-amber-400 ring-amber-500/25"
        delay={0.7}
      />
    </div>
  );
}

function SceneWire() {
  return (
    <div className="relative flex items-center justify-center gap-24">
      <NodeBox
        icon={Server}
        label="App"
        color="bg-violet-500/10 text-violet-400 ring-violet-500/25"
      />
      <NodeBox
        icon={Database}
        label="SQL DB"
        color="bg-amber-500/10 text-amber-400 ring-amber-500/25"
      />
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        preserveAspectRatio="none"
      >
        <motion.line
          x1="42%"
          y1="50%"
          x2="58%"
          y2="50%"
          stroke="#22d3ee"
          strokeWidth="2"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.8, ease: EASE }}
        />
      </svg>
      <motion.line
        x1="58%"
        y1="62%"
        x2="42%"
        y2="62%"
        stroke="#22d3ee"
        strokeWidth="2"
        strokeDasharray="6 4"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ delay: 1.6, duration: 0.8, ease: EASE }}
      />
      <motion.span
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.2, duration: 0.4 }}
        className="absolute left-1/2 top-[30%] -translate-x-1/2 rounded-full border border-cyan-500/30 bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-cyan-300"
      >
        request
      </motion.span>
      <motion.span
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 2.2, duration: 0.4 }}
        className="absolute left-1/2 top-[70%] -translate-x-1/2 rounded-full border border-cyan-500/30 bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-cyan-300"
      >
        response
      </motion.span>
    </div>
  );
}

function SceneSimulate() {
  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-6">
      <div className="relative flex w-full items-center justify-between">
        <NodeBox icon={Globe} label="LB" color="bg-blue-500/10 text-blue-400 ring-blue-500/25" />
        <div className="relative mx-2 h-0.5 flex-1 bg-zinc-700">
          {[0, 0.5, 1].map((d) => (
            <motion.span
              key={d}
              className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-cyan-400"
              initial={{ left: "0%" }}
              animate={{ left: "100%" }}
              transition={{ duration: 1.1, ease: "linear", repeat: Infinity, delay: d }}
            />
          ))}
        </div>
        <NodeBox
          icon={Server}
          label="App"
          color="bg-violet-500/10 text-violet-400 ring-violet-500/25"
        />
      </div>
      <div className="w-full space-y-1.5">
        <div className="flex items-center justify-between text-[11px] text-zinc-400">
          <span>App Server utilization</span>
          <span className="font-mono text-amber-400">
            <CountUp to={72} duration={1500} />%
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-amber-500 to-amber-400"
            initial={{ width: "0%" }}
            animate={{ width: "72%" }}
            transition={{ duration: 1.5, ease: EASE }}
          />
        </div>
      </div>
    </div>
  );
}

function SceneScore() {
  const radius = 40;
  const circ = 2 * Math.PI * radius;
  const pct = 0.88;
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative flex items-center justify-center">
        <svg width="104" height="104" className="-rotate-90">
          <defs>
            <linearGradient id="wt-ring" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#059669" />
              <stop offset="100%" stopColor="#34d399" />
            </linearGradient>
          </defs>
          <circle cx="52" cy="52" r={radius} fill="none" stroke="rgb(39,39,42)" strokeWidth="7" />
          <motion.circle
            cx="52"
            cy="52"
            r={radius}
            fill="none"
            stroke="url(#wt-ring)"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={circ}
            initial={{ strokeDashoffset: circ }}
            animate={{ strokeDashoffset: circ - pct * circ }}
            transition={{ duration: 1.3, ease: EASE }}
            style={{ filter: "drop-shadow(0 0 6px #34d39966)" }}
          />
        </svg>
        <div className="absolute flex flex-col items-center">
          <span className="font-mono text-3xl font-bold text-zinc-50">
            <CountUp to={88} />
          </span>
          <span className="text-[10px] text-zinc-400">/ 100</span>
        </div>
      </div>
      <div className="w-52 space-y-1.5">
        {["Scalability", "Availability", "Latency"].map((c, i) => (
          <div key={c} className="flex items-center gap-2">
            <span className="w-20 text-[10px] text-zinc-400">{c}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
              <motion.div
                className="h-full rounded-full bg-emerald-500"
                initial={{ width: 0 }}
                animate={{ width: `${85 - i * 8}%` }}
                transition={{ delay: 0.4 + i * 0.15, duration: 0.6, ease: EASE }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SceneInterview() {
  return (
    <div className="flex flex-col items-center gap-5">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-cyan-400" />
        <span className="font-mono text-2xl font-bold text-zinc-50">04:32</span>
      </div>
      <div className="flex items-center gap-1.5">
        {["Reqs", "Estimate", "API", "Data", "HLD", "Deep Dive"].map((s, i) => (
          <motion.div
            key={s}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.12, duration: 0.35 }}
            className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-medium ${
              i === 0
                ? "bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-500/30"
                : "bg-zinc-800 text-zinc-500"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${i === 0 ? "bg-cyan-400" : "bg-zinc-600"}`}
            />
            {s}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function SceneCommand() {
  const rows = [
    { icon: Boxes, label: "Add Cache / Redis", tag: "COMPONENT" },
    { icon: Network, label: "Twitter / News Feed", tag: "PROBLEM" },
    { icon: Gauge, label: "Run simulation", tag: "ACTION" },
  ];
  return (
    <motion.div
      initial={{ opacity: 0, y: -10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: EASE }}
      className="w-72 overflow-hidden rounded-xl border border-zinc-700/80 bg-zinc-900 shadow-[var(--shadow-e3)]"
    >
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2.5">
        <Command className="h-3.5 w-3.5 text-cyan-400" />
        <span className="text-xs text-zinc-300">cache</span>
        <span className="ml-auto h-3 w-px animate-pulse bg-cyan-400" />
      </div>
      <div className="p-1.5">
        {rows.map((r, i) => {
          const Icon = r.icon;
          return (
            <motion.div
              key={r.label}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + i * 0.12, duration: 0.3 }}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 ${i === 0 ? "bg-cyan-500/15" : ""}`}
            >
              <Icon className={`h-4 w-4 ${i === 0 ? "text-cyan-400" : "text-zinc-500"}`} />
              <span className="flex-1 text-xs text-zinc-200">{r.label}</span>
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-medium text-zinc-500">
                {r.tag}
              </span>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

function SceneOutro() {
  return (
    <div className="flex flex-col items-center gap-3">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 13 }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-mark.svg" alt="" width={64} height={64} className="h-16 w-16" />
      </motion.div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="flex items-center gap-1.5 text-cyan-400"
      >
        <Sparkles className="h-4 w-4" />
        <span className="text-sm font-semibold">You&apos;re ready to build.</span>
      </motion.div>
    </div>
  );
}

interface Scene {
  id: string;
  title: string;
  text: string;
  Illo: React.ComponentType;
  cta?: boolean;
}

const SCENES: Scene[] = [
  {
    id: "welcome",
    title: "Welcome to SystemForge",
    text: "A hands-on simulator for system design interviews. Here's the entire flow in under a minute.",
    Illo: SceneWelcome,
  },
  {
    id: "steps",
    title: "Follow the steps",
    text: "The bar under the top menu walks you through Problem, Design, Simulate, Failures and Evaluate. Use Next to move on and Back (or a step you already did) to return; each step shows only its own tools.",
    Illo: SceneSteps,
  },
  {
    id: "build",
    title: "1 · Build the architecture",
    text: "Problem: pick from 35 problems and read the requirements. Design: drag infrastructure components onto the canvas — load balancers, app servers, caches, databases, queues and more.",
    Illo: SceneBuild,
  },
  {
    id: "wire",
    title: "2 · Wire it together",
    text: "Connect components to model the request path. A call is a line out and, if the caller waits for the answer, a dashed line back: draw the response from the callee's return handle. No response means async.",
    Illo: SceneWire,
  },
  {
    id: "simulate",
    title: "3 · Simulate and break it",
    text: "Simulate: push up to 500K requests/sec through your design and watch QPS, utilization and bottlenecks light up. Failures: kill a node or cut a link and see what the error budget says.",
    Illo: SceneSimulate,
  },
  {
    id: "score",
    title: "4 · Evaluate like an interview",
    text: "Evaluate: get rated across Scalability, Availability, Latency, Cost and Trade-offs — each with concrete, actionable feedback.",
    Illo: SceneScore,
  },
  {
    id: "interview",
    title: "5 · Practice the real thing",
    text: "Run a timed 6-phase mock interview — Requirements through Deep Dive — with a wall-clock timer and live, phase-by-phase guidance.",
    Illo: SceneInterview,
  },
  {
    id: "command",
    title: "Move at the speed of thought",
    text: "Press ⌘K anywhere to search problems, add components, and run any action instantly — no hunting through menus.",
    Illo: SceneCommand,
  },
  {
    id: "outro",
    title: "That's the whole loop",
    text: "Pick a problem and design your first architecture. Build, simulate, score, repeat.",
    Illo: SceneOutro,
    cta: true,
  },
];

const SCENE_MS = 5200;
const TICK = 50;

interface WalkthroughProps {
  open: boolean;
  onClose: () => void;
  onPickProblem?: () => void;
}

export function Walkthrough({ open, onClose, onPickProblem }: WalkthroughProps) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [progress, setProgress] = useState(0);

  // Reset when (re)opened
  useEffect(() => {
    if (open) {
      setStep(0);
      setPlaying(true);
      setProgress(0);
    }
  }, [open]);

  // Auto-advance ticker
  useEffect(() => {
    if (!open || !playing) return;
    const id = setInterval(() => {
      setProgress((p) => {
        const next = p + TICK / SCENE_MS;
        if (next >= 1) {
          setStep((s) => {
            if (s >= SCENES.length - 1) {
              setPlaying(false);
              return s;
            }
            return s + 1;
          });
          return 0;
        }
        return next;
      });
    }, TICK);
    return () => clearInterval(id);
  }, [open, playing, step]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowRight") goTo(step + 1);
      else if (e.key === "ArrowLeft") goTo(step - 1);
      else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  if (!open) return null;

  const goTo = (s: number) => {
    if (s < 0 || s > SCENES.length - 1) return;
    setStep(s);
    setProgress(0);
  };

  const scene = SCENES[step];
  const atEnd = step === SCENES.length - 1 && !playing;
  const Illo = scene.Illo;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-zinc-950/90 backdrop-blur-md"
        onClick={onClose}
        aria-hidden="true"
      />

      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="SystemForge walkthrough"
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2, ease: EASE }}
        className="relative flex max-h-[94dvh] w-full max-w-xl flex-col overflow-y-auto rounded-2xl border border-zinc-700/70 bg-zinc-900 shadow-[var(--shadow-e4)]"
      >
        {/* Progress segments */}
        <div className="flex gap-1 px-4 pt-4">
          {SCENES.map((_, i) => (
            <div key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-cyan-400 transition-[width] duration-100 ease-linear"
                style={{ width: i < step ? "100%" : i === step ? `${progress * 100}%` : "0%" }}
              />
            </div>
          ))}
        </div>

        {/* Close */}
        <button
          onClick={onClose}
          className="absolute right-3 top-6 z-10 flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="Close walkthrough"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Stage */}
        <div className="flex min-h-[180px] items-center justify-center px-6 py-6 sm:min-h-[220px] sm:px-8 sm:py-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={scene.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="w-full"
            >
              <Illo />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Caption */}
        <div className="px-8 pb-2 text-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={scene.id + "-cap"}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
            >
              <h3 className="font-display text-lg font-bold tracking-tight text-zinc-50">
                {scene.title}
              </h3>
              <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-zinc-400">
                {scene.text}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-3">
          <span className="font-mono text-[11px] text-zinc-500">
            {step + 1} / {SCENES.length}
          </span>

          <div className="flex items-center gap-1">
            <button
              onClick={() => goTo(step - 1)}
              disabled={step === 0}
              className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-30"
              aria-label="Previous"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {atEnd ? (
              <button
                onClick={() => {
                  setStep(0);
                  setProgress(0);
                  setPlaying(true);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-300 hover:bg-zinc-800"
                aria-label="Replay"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={() => setPlaying((p) => !p)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-300 hover:bg-zinc-800"
                aria-label={playing ? "Pause" : "Play"}
              >
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
            )}
            <button
              onClick={() => goTo(step + 1)}
              disabled={step === SCENES.length - 1}
              className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-30"
              aria-label="Next"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {scene.cta && onPickProblem ? (
            <button
              onClick={() => {
                onClose();
                onPickProblem();
              }}
              className="flex items-center gap-1.5 rounded-md bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-cyan-400"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Start building
            </button>
          ) : (
            <button
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-300"
            >
              Skip
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
