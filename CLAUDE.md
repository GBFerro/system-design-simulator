# CLAUDE.md

Guidance for AI agents (and humans) working in this repo.

> **Read `AGENTS.md` first.** This is Next.js 16 — APIs and conventions differ from older versions. Check `node_modules/next/dist/docs/` before writing framework code.

## What this is

SystemForge — an open-source system-design interview simulator. Drag infrastructure components onto a React Flow canvas, wire them, simulate production-scale traffic (Kahn's topological sort), and get scored across 5 interview dimensions. 100% client-side; state persists in the browser (`localStorage`; saved designs in IndexedDB). No backend.

## Commands

```bash
npm run dev      # dev server (http://localhost:3000)
npm run build    # production build — also runs tsc; must pass before pushing
npm run lint         # oxlint (config: .oxlintrc.json)
npm run format       # oxfmt (config: .oxfmtrc.json); CI runs format:check
npm run typecheck    # tsc --noEmit
npm test             # vitest (tests/unit)
npm run test:e2e     # playwright (tests/e2e); starts `next dev` on :3100 unless one runs there. Next 16 allows ONE
                     # dev server per directory: with `npm run dev` open on :3000, use `E2E_PORT=3000 npm run test:e2e`
npm run bundle:check # after build: initial JS of / vs bundle-baseline.json (max +15%); fails if the lazy engine client leaks in
```

CI (Node 22) runs lint, typecheck, unit tests, build, bundle check and E2E on every PR. Unit tests cover pure logic (scoring, engine, traffic patterns, persistence, store actions); editor behavior goes in Playwright. Still exercise UI changes in the browser. Bundle budget: the PR that closes a roadmap phase (Fase 0–6 in `docs/00-visao-geral.md`) re-baselines `bundle-baseline.json` (`node scripts/bundle-size.mjs --update`) and justifies the growth in its description; between phase ends the +15% limit applies against the current baseline, and the baseline is not updated.

## Tech stack

Next.js 16 (App Router, single static `/` route) · React 19 · TypeScript · @xyflow/react v12 (ReactFlow) · Zustand v5 (persisted) · Tailwind v4 · base-ui dialogs/primitives · framer-motion · perfect-freehand (pen) · html-to-image (export) · @dnd-kit/core (palette drag) · comlink (engine Web Worker RPC). No new runtime deps without good reason.

## Architecture map

```
src/
  app/            App Router entry, layout, globals.css (dark-only theme)
  cost/           Spec 10, pure: estimate.ts ($/month per node and area, $/1M requests), rightSize.ts
                  (CST-03 suggestions), currency.ts (USD/BRL/EUR display, fixed rates)
  advisor/        Spec 12, pure: types.ts (Finding/QuickFix/GraphDiff/AdvisorContext), view.ts (DesignView:
                  ScoringGraph + sync path, built once per analysis), structure.ts (ADV-03: no entry point,
                  disconnected node, SPOF), load.ts (hot/saturated/over-provisioned tiers, no rate limiter),
                  patterns.ts (reads without a cache, slow work on the request path), score.ts (the last
                  score's lost points), graph.ts (diff builders: insertBetween, applyDiff), advisor.ts
                  (computeFindings, applyFix, applyAllFixes, readRatioFor), mitigation.ts (Spec 08 CHS-06:
                  tips per fault type with quick fixes for this design)
  slo/            Spec 11, pure: types.ts (Slo, overrides, ranges, burn constants), slo.ts (problemSlo,
                  sanitize/resolve overrides, budget fractions, fault allowance, formatters),
                  budget.ts (evaluateSlo: error budget per SLI over the window, burn rate, verdict)
  components/
    canvas/       DesignCanvas (ReactFlow host), nodes/ (Component, Text, Ghost, NodeActionsToolbar), edges/ (Animated, Ghost),
                  previewGraph (advisor fix preview as ghost elements), PenOverlay/PenToolbar, CanvasTabBar,
                  CanvasContextMenu, PaletteDnd (@dnd-kit), useCanvasShortcuts, canvasEvents,
                  ChaosTimeline (fault lanes at the bottom of the canvas, Spec 08)
    panel/        RightPanel + Props/Sim/Chaos/SLO/Score/Advisor/Cost/Capacity/Tradeoffs tabs (ChaosPanel
                  (+ Mitigations per fault), AdvisorPanel (findings, preview/apply, apply all), FixPreview
                  (shared quick-fix preview banner, Preview/Apply buttons, framing),
                  CostPanel: totals, breakdown with assumptions, budget, right-size; SloPanel: targets,
                  error budget, burn-rate chart with fault bands, verdict); styles.ts = shared section title
                  and input classes (reuse them in a new tab)
    cost/         useCostEstimate (canvas × latest snapshot, 1 Hz while playing), CostMini (top bar $/month)
    slo/          useSloEvaluation (one evaluation per snapshot push, shared), SloMini (top bar budget while a run exists)
    sidebar/      Sidebar: ComponentPalette, ProblemSelector, LearningPath
    layout/       AppShell (orchestrator + keyboard shortcuts), TopBar, SupportFAB
    interview/    InterviewBar, phase panel, start dialog, PhaseForms (phase 1–4 answers, lazy),
                  DrillPanel + drillDriver (phase 6 failure drill, Spec 09), scoreNow (measure + score),
                  finishInterview + ReportDialog (final report and attempt history, lazy)
    dialogs/      ModalShell (shared modal: focus trap/Escape/scroll) + Save/Load/Confirm/Support/Create*
    traffic/      live traffic (Spec 06): TrafficControls (Sim panel: play/pause/reset, speed, clock,
                  log RPS slider, PatternEditor + PatternPreview), PlaybackMini (top bar),
                  simActions.ts (UI → controller via dynamic import; used by the `P` shortcut)
    ui/           shadcn-style primitives, Toast
  data/           components.ts (42 specs), problems.ts (35), conceptLibrary.ts,
                  interviewData.ts, tradeoffCards.ts (21), learningPath.ts
  domain/
    components/   types.ts (ParamSpec/ComponentSchema/EdgeRule), params.ts (PARAM keys + spec builders),
                  schemas/<type>.ts (per-type schemas), registry.ts (getSchema/defaultParams/sanitizeParams/readers),
                  pricing.ts (Spec 10: versioned price table → every schema's `pricing`)
    graph/        compile.ts (ReactFlow nodes/edges → validated SimGraph),
                  edgeRules.ts (connect defaults, sanitize, rule form specs; edge helpers: edgeRuleOf,
                  newEdgeData, isAsyncEdge)
    persistence/  migrate.ts (v1 → v2), serialize.ts (canvas ⇄ Serialized*), envelope.ts (JSON export/import), version.ts (SCHEMA_VERSION)
  engine/         analyze.ts (steady state), core/ (queueing = Erlang C/M/M/c, routing, sampler,
                  rng (+ Poisson), settle = shared reverse pass/sampler model, tick = TickSimulator,
                  faultView = fault effects on a topology, shared by tick and analyze,
                  slo = slow share for goodput, shared by tick and analyze),
                  engine.ts (FlowEngine: analyze + tick loop scheduler), session.ts (throttled frame
                  stream), worker.ts + client.ts (Comlink worker, lazy; SimController),
                  traffic/ (types = TrafficPattern/SimSpeed/tick constants, patterns = rateAt/sanitize),
                  snapshot.ts (analyze → TickSnapshot), toSimulationResult.ts (→ v1 UI shape),
                  faults/ (Spec 08: types, catalog = fault types (CHS-02 MVP + CHS-03), compile = FaultSpec → modifiers,
                  effects = active modifiers folded per tick, runner = FaultRunner: active faults,
                  timeline, blast radius, steady = analyze() under one fault for scoring),
                  core/breaker.ts (circuit breaker state machine, tick only),
                  types.ts, constants.ts, legacy/simulator.ts (v1, kept only as a comparison in tests)
  scoring/        scorer.ts + rules/ (scalability, availability, latency, cost, tradeoffs — 20 pts each),
                  paths.ts (sync request path, depth, SPOFs; shared with the advisor), steady.ts (readers
                  over measurements), measure.ts (Spec 09: analyze() at peak/2×/under drill faults; lazy)
  store/          zustand stores (see below): canvasStore, appStore (UI, toast, persisted display currency), interviewStore, penStore,
                  savedDesignsStore, customComponentsStore, customProblemsStore, tradeoffStore,
                  simulationStore (v1 result + score); runtimeStore.ts = unpersisted live metrics, fed by
                  SimController (tick frames) and the Simulate button (analyze snapshot);
                  chaosStore (unpersisted faults of the live run), advisorStore (unpersisted findings and
                  fix preview, recomputed when the design, the run's load, the problem or the score change), drillStore (unpersisted failure drill of phase 6),
                  reportStore (open interview report; attempt history in IndexedDB via createDurableKV),
                  sloStore (persisted SLO overrides per problem + the SLO in force: useEffectiveSlo/getEffectiveSlo);
                  persistVersion, migrations, hydration, safeStorage, durableStorage (IndexedDB)
  interview/      drill.ts (Spec 09: resolve a scripted fault against the candidate's design, evaluate the SLO per step),
                  checks.ts (grade the phase 1–4 answers against interviewData, process score),
                  report.ts (buildReport: the final report, also what the attempt history stores)
  hooks/          useBreakpoint (useIsMobile/useIsCoarsePointer/usePrefersReducedMotion/useMinWidth)
  lib/            exportCanvas, loadReference, nodeFactory, placement, icons, utils, ringBuffer,
                  topology (topologySignature: what structure-dependent views recompute on),
                  particles (particle budget/edge width), runtimeMetrics (snapshot sharing, sparklines, formatters)
  types/          shared interfaces
tests/
  unit/           vitest (pure logic: scoring, engine, traffic patterns, persistence, store actions;
                  claude-map checks this map against src/)
  e2e/            playwright specs, one per feature area (see tests/e2e/); shared helpers (open, quickAdd,
                  connect, center, MOD) in helpers.ts — import them, don't redefine
scripts/          bundle-size.mjs (initial-JS budget vs bundle-baseline.json)
```

## Key invariants — don't break these

**Simulation engine (`engine/`, Spec 04).**

- Pipeline: `compileGraph(nodes, edges)` (`domain/graph/compile.ts`) → `SimGraph` → `analyze(graph, rps, config?)` → `SteadyState`. The UI calls `simulateCanvas` from `engine/client.ts` via dynamic `import()`; it runs in a Comlink Web Worker created lazily (in-thread fallback without `Worker`), so the engine is never in the initial bundle. `toSimulationResult` maps onto the v1 `SimulationResult` the panel renders.
- `compileGraph` takes ALL nodes/edges: non-component (text) nodes and edges touching them are dropped, self-loops dropped, parallel edges deduped, params sanitized via the registry (`sanitizeParams`; v1 top-level `maxQPS`/`latencyMs`/`replicas` are never read: the persistence migration converts them, and every entry path delivers `data.params`), edge rules resolved (`edge.data.rule` → `sanitizeEdgeRule`, missing → `defaultEdgeRule`). Problems become warnings, never exceptions.
- Entry nodes = the `client` node(s) if any, else in-degree 0 **with** outgoing edges (a fully disconnected node is NOT an entry and must not receive traffic).
- Order = Kahn, then cycle members (BFS from where traffic enters), then nodes downstream of cycles; edges closing a cycle are `back` and carry no load.
- Each node is `instances` × M/M/c with c = round(capacityPerInstance × serviceTimeMs / 1000) slots, so c·μ = capacityPerInstance (the capacity knob); Erlang C only via the Erlang B recursion (never aᶜ/c!); ρ ≥ 1 → backlog grows for the horizon up to `maxQueue`, excess dropped.
- Routing is by `routingFor(componentId)` + edge rules, NOT 100% fan-out: LB splits by algorithm (round-robin/hash equal, weighted ∝ capacity, least-connections ∝ free capacity); service/fixed/breaker edges carry served × P(rule) × `callsPerRequest` (reads/writes by read ratio, `fraction`, `on_miss` = 1 − hitRate); queues decouple (each consumer edge drains ≤ min(consumers, target instances) × target capacity, the rest is lag; edges out of a queue are off the user path); rate limiter admits min(λ, limitRps).
- **Circuit breaker (`core/breaker.ts`, tick only):** closed → open when the failure rate of the calls it forwards (downstream errors and timeouts, its own `timeoutMs` included) over about the last 100 calls reaches `errorThreshold` with `minimumCalls` in the window; open fails every call fast (nothing reaches the dependency) for `openDurationSec`; half-open lets `halfOpenProbes` through and closes or reopens on their failure rate. No random numbers, so determinism holds; `analyze()` treats it as closed (a transient reaction). A graph without breakers is unaffected.
- Retries (`maxRetries` on the caller) amplify edge load by (1 − f^{R+1})/(1 − f), solved as a fixed point.
- Only read params through `PARAM` keys with fallbacks.
- Invariants: served ≤ offered at every node and throughput ≤ offered load; every reported number finite; async edges carry load but are excluded from user-facing latency; same graph + seed (mulberry32) → deep-equal result.
- **Tick loop (Phase 2, `core/tick.ts`):** each `step(λ)` advances Δt = `TICK_SEC` (50 ms): arrivals ~ Poisson(λΔt) from the seeded PRNG (`samplePoisson`: exact up to a mean of 30, normal approximation above), split over entries; propagation in compiled order with the SAME routing as `analyze()` (flow out of a node = what it completed this tick); per node a fluid backlog Q ← max(0, Q + (λ − cμ)Δt) capped at `maxQueue` (excess dropped); wait = Erlang C when ρ < 1 without real backlog, else Q/(cμ); queue nodes keep per-consumer-edge lag drained at ≤ consumer capacity; timeouts/success/availability via `core/settle.ts` (shared with `analyze()`, don't fork it); retries carry over one tick per generation (converges to the same (1 − f^{R+1})/(1 − f)); 1000 sampled requests per tick for end-to-end percentiles.
- `global.throughput` = this tick's arrivals that succeed (≤ `offeredRps`); per node `rpsOut` = completions and may exceed `rpsIn` while a backlog drains.
- **Goodput (Spec 11):** `goodput` = throughput × (1 − slow share), slow = successful requests over the latency SLO (`SimConfig.latencySlo`; live via `FlowEngine.setLatencySlo`, which `SimController` follows from the SLO in force). End to end the sampler counts it AFTER sampling (no random numbers: everything else stays bit-identical); scoped (`scope` = a component type) it's P(hop > threshold) at those nodes weighted by load (`core/slo.ts`, shared by `analyze()` and the tick). No SLO → goodput = throughput.
- `FlowEngine`: `play`/`pause`/`reset` (rewind to 0 keeping graph/speed/pattern)/`setSpeed`/`setTraffic` (next tick; the pattern clock restarts only when the KIND changes)/`onTick`/`step(n)`; 6000-tick ring buffer; the scheduler runs speed × wall time in slices, caps work per slice and re-anchors when behind (sim slows, never bursts). `load()` during a run hot-swaps the graph (clock and surviving backlogs kept).
- `session.ts` streams ≤ `UI_SNAPSHOT_HZ` frames (tagged with a reset generation) through a Comlink `proxy`; `SimController` (`getSimController()` in `client.ts`) mirrors playback/speed/pattern/clock into `runtimeStore`, recompiles the canvas on edits (250 ms debounce) and resets on tab switch or an external `runtimeStore.clear()`.
- Same graph + seed + pattern/fault calls → bit-identical snapshots.
- **Faults (Spec 08, `engine/faults/`):** a `FaultSpec` compiles (pure, `compileFault`) into `CompiledModifier`s with start/end and targets; the tick loop only sees `effectsAt(mods, t)` (null when nothing is active → exactly the fault-free tick) and applies it by rewriting the tick's view of the graph (`withEffects` in `core/faultView.ts`: capacity/service time/hit rate/availability of nodes, latency/loss of edges) plus down nodes, severed edges and drained LB edges. Never add fault-specific code to the tick: add a catalog entry built from modifiers. `inject` applies from the next tick and never edits the graph; auto-heal runs after each tick; `load()` recompiles active faults (a missing target heals); `reset()` clears them. The blast radius (`blast` on node/edge metrics) compares with the snapshot before the first fault and marks callers of degraded edges. `analyze(graph, rps, config, effects?)` applies faults only when given effects (`faults/steady.ts`, read at the end of the fault's window, for Spec 09 scoring); the topology rewrite lives in `core/faultView.ts`, shared with the tick — don't fork it.
- **Resolvers (DNS, `PARAM.lookupShare`):** only the uncached share of requests loads the node's station and pays its latency (browser/OS/resolver caches answer the rest); the other requests pass straight through. Same in `analyze()`, the tick and the sampler (which draws the hop only with that probability). A fault's node error rate hits only that share too (a DNS outage fails the fresh lookups; cached answers go through). Every other node has share 1, so nothing else changes.
- Tests: `tests/unit/engine-*.test.ts` (chaos: `engine-chaos`), `traffic-patterns`, `sim-controller`, e2e `traffic.spec.ts`, `chaos.spec.ts`.

**Scoring (`scoring/`, measured rubric Spec 09).** `scorer.ts` builds a shared `ScoringGraph` (cleaned adjacency + reachable-from-entry set) once and passes it, with the optional `Measurements`, to every rule. Scalability, availability, latency and cost are **measured**: `measure.ts` (lazy-loaded by the Score button) runs `analyze()` in the engine worker at the problem's peak and 2× it with the problem's read mix, and under each of its drill faults (deduplicated); a finished interview drill replaces the fault check. Without measurements, or when no request reaches the design, measured checks score 0 and say why — never award them for an empty or entry-less design. Latency and availability judge against the problem's SLO (`Measurements.slo` = `problemSlo(requirements)`, never the user's override): latency at the SLO's percentile and threshold, end to end unless the problem sets `requirements.slaScope` (then that component's hop); a drill fault "holds" when its error rate × its duration fits one window of the availability budget (`faultErrorAllowance`). Cost (Spec 10) prices every node at the peak's `offeredRps` (`cost/estimate.ts`) against `Measurements.budgetMonthlyUsd` (the problem's `requirements.budgetMonthlyUsd`, scaled up when an interview measures above the reference peak); a problem without a budget doesn't award those points and says so. Presence checks must require reachability. Each rule scores only through its exported `BUDGET` (plus `PARTIAL`), which must sum to exactly 20 (`CATEGORY_MAX_SCORE`), and never goes negative. `tests/unit/scoring.test.ts` checks the sums, that a complete design reaches 20, and that every reference solution, measured at its own peak, scores ≥ 16 in scalability and latency — so a data or engine change that breaks a reference fails CI.

**Stores (`store/`).** Every persisted store uses `version: STORE_VERSION` (2, from `persistVersion.ts`; `persistence.versions.test.ts` fails if one does not), `skipHydration: true`, and a real `migrate(persisted, fromVersion)`: `canvasStore` (live nodes/edges + every tab) and `savedDesignsStore` (every design) run `migrateV1toV2` via `migrations.ts`; stores whose shape didn't change use `passThroughMigration`. A new persisted store must do the same. Storage is `safeLocalStorage` (from `safeStorage.ts`, swallows QuotaExceeded + toasts), except saved designs, which live in IndexedDB through `durableStorage.ts` (idb-keyval; a localStorage copy is moved to IndexedDB and removed only after the write is confirmed; falls back to `safeLocalStorage` with a toast when IndexedDB is unavailable). Reuse `createDurableKV()` for anything big (run history). Hydration is deferred: `hydration.ts` exports `rehydrateAllStores()` and `useHasHydrated()` — call after mount to avoid SSR mismatch; custom components rehydrate first (the migration needs them), and saved designs hydrate asynchronously (their `merge` keeps designs saved before it finished). `canvasStore` persists the active tab with empty nodes/edges (live copies live at the top level; reconstructed on rehydrate); it holds no runtime metrics (see below). It also has unpersisted undo/redo history (`undo`/`redo`/`canUndo`/`canRedo`, 50 entries, pushed before mutation; consecutive arrow-key nudges share one entry) and an unpersisted `clipboard`. **Selection has one source of truth: `node.selected` / `edge.selected`** — there is no `selectedNodeId`; use `selectOnly`/`selectAll`/`clearSelection`. Editing actions act on the selection and push exactly one history entry: `deleteSelection`, `copySelection`/`pasteClipboard`, `duplicateSelection`, `nudgeSelection`, `changeReplicas`, `setInstanceCounts` (right-size, Spec 10), `applyGraphEdit` (advisor quick fixes, Spec 12: the whole edit computed inside `set` from the current graph), `placeNode` (spiral search via `lib/placement.ts` so new nodes never overlap). Every action that edits the graph is listed in `MUTATING_ACTIONS` and no-ops on a read-only tab by itself (there `onNodesChange`/`onEdgesChange` apply only select/dimension changes); every other action is in `READ_ONLY_EXEMPT_ACTIONS` with its reason, and `editor.test.ts` fails on an action in neither list. `interviewStore` timer is timestamp-based (`startedAt`/`accumulatedMs`) so it survives background-tab throttling and refresh — never reintroduce tick-counting.

**Runtime metrics (`store/runtimeStore.ts`, Spec 07).** Live metrics live ONLY in the unpersisted `runtimeStore` (`latest` `TickSnapshot` + `history` ring buffer, `historyVersion` bumps on push/clear), fed by the Simulate button (`steadyStateToSnapshot(steady, t, graph)`, which also derives the OBS-03 extras from params) and by the tick loop. Never write metrics into `node.data` (no `utilization`/`status`/`isBottleneck` there) and never touch `canvasStore` from a tick — that would re-render and re-persist the graph. `pushSnapshot` shares unchanged node/edge/global objects with the previous snapshot, so read per entity with the selector hooks (`useNodeRuntime(id)`, `useNodeStatus(id)`, `useEdgeRuntime(id)`, `useGlobalRuntime()`): a tick re-renders only what changed. Subscribe to history (`useRecentHistory`) only in components mounted on demand (open sparkline, Sim panel). Node badges must keep a fixed size (a resize makes ReactFlow re-measure → a `canvasStore` write). Metrics are cleared (`clear()`) with the simulation result on tab switch/close, load, reference and clear canvas (`resetSimulation` in `canvasStore`). Particles (`components/canvas/FlowParticles.tsx`) are ONE `<canvas>` over the renderer: edge paths sampled with `getPointAtLength` from the rendered `.react-flow__edge-path` and cached by `d` (resampled only after graph changes; the viewport is a canvas transform read from the ReactFlow store), budget from `lib/particles.ts` (density ∝ log10(1 + rps), 2,000 global cap), one rAF loop reading `getLatestSnapshot()` with no React render per frame, stopped without a snapshot or while the tab is hidden, a still frame while paused. Never add per-token DOM/SVG elements. Status is shown by color AND icon. `prefers-reduced-motion`: no particles at all; edges still show load (width) and status (color). Tests push synthetic snapshots through `window.__runtimeStore` (dev, or `?e2e` in any build).

**SLOs and error budget (Spec 11, `slo/`).** An SLO has two SLIs with separate budgets: availability (failed requests, budget 1 − availability) and latency (successes slower than the threshold, budget 1 − percentile/100) — never charge slow requests to the availability budget. `evaluateSlo` (pure, over `runtimeStore` history) gives per SLI the budget consumed over the trailing window (a short run is charged against the whole window at its observed rate), the burn rate over `BURN_WINDOW_SEC`, and the verdict (violated from the first moment a budget runs out). The SLO in force is the problem's with the user's override from the persisted `sloStore` (per problem; sanitized, edited in the SLO tab), except in an interview (always the problem's); read it with `useEffectiveSlo()`/`getEffectiveSlo()`. Components read the evaluation through `useSloEvaluation` (one evaluation per pushed snapshot, shared) and mount it only where shown (SLO tab, `SloMini` while a run exists). The interview report carries `sloSummary` of the live run against the problem's SLO. Tests: `slo.test.ts`; `data.test.ts` checks every problem declares `availability` and its reference holds its SLO at the peak.

**Chaos UI and advisor (Specs 08/12).** Faults exist only in a live run (playback running or paused): inject/heal go through `simActions` (`injectFault`, `healFault`, `toggleKillNode`) → `SimController` → worker, and the run's faults are mirrored into the unpersisted `chaosStore` (reset clears it). They never edit the graph, so the Kill/Restore shortcuts (node toolbar, context menu) are allowed on read-only tabs too. Blast radius is drawn from `blast` in runtime metrics (`useNodeBlast`), outside the node box so it never resizes. Each fault shows its mitigations (`advisor/mitigation.ts`, CHS-06): tips per fault type, with quick fixes that reuse the advisor's preview/apply path (`setFixPreview`/`applyQuickFix`, one undo step); a fix that wraps a faulted link keeps that link's edge id (`insertBetween(..., { keepLinkOnOut })`), so the fault stays on it. A new fault type needs a catalog entry, a `GENERIC_DRILL_QA` entry and a `mitigationsFor` case (the `never` check fails the build otherwise). Advisor findings live in the unpersisted `advisorStore`, recomputed when the design (topology + params + edge rules), the run's load, the problem or the score changes — never on a drag; nodes read their worst severity with `useNodeFindingSeverity(id)`. Every rule reads one `DesignView` (`advisor/view.ts`: the scorer's `ScoringGraph`, sync path and notion of redundancy) and reuses the scorer's thresholds and right-size's sizing, so the Advisor, Score and Cost tabs never disagree. Quick fixes (ADV-02): `QuickFix.preview(graph)` is pure (ids derived from the finding and the graph, never random) and returns a `GraphDiff`; fixes apply only through `applyGraphEdit` (one undo step, no-op on read-only tabs); stateful tiers never get an instance-count fix (the right-size rule). The preview's ghosts (`components/canvas/previewGraph.ts`, `ghost:` ids) exist only in what ReactFlow renders — never in `canvasStore`. Rules, thresholds and fixes: [Spec 12](docs/12-advisor.md); `advisor.test.ts` checks no reference solution gets a finding above info at its peak.

**Failure drill (Spec 09, phase 6).** Each problem's `interviewData.drill` (2–3 steps) targets **component types**, never node ids (`DrillTarget`: node types, a link between types, the busiest tier or global); `resolveDrillStep` picks the busiest matching node in the candidate's design and falls back to killing an instance of the busiest tier (with a note). Steps without a `followUpId` use `GENERIC_DRILL_QA` by fault type. `drillDriver.ts` schedules faults from the simulated clock (warm-up, fault window, `DRILL_RECOVERY_SEC` of recovery) through `injectFault`, so faults go through the same chaos path; any new undo entry during a fault is the candidate's first action. The drill's moment-to-moment "SLO broken" is the problem SLO's latency (its percentile and threshold, on the scope component's nodes when set — `DrillSlo.scopeNodeIds`) or more than `DRILL_ERROR_SLO` errors. `data.test.ts` checks every script is valid and applies to its reference solution without falling back.

**Interview answers and report (Spec 09).** Phases 1–4 are checkable: the candidate's answers (requirements, estimates, APIs, entities) and the seconds spent per phase persist in `interviewStore` (`answers`, `phaseSeconds`, accumulated when leaving a phase — read the live value with `phaseSecondsNow()`). The drill and the interview's Score run at `effectivePeak` (the candidate's reads + writes, clamped to [½, 2×] the problem's peak), so a bad estimate changes the test without making it trivial or impossible. Grading is pure (`interview/checks.ts`, estimates within 2×), and `buildReport` produces a JSON-safe report; **Finish** (`finishInterview`, lazy) measures and scores, saves the attempt (last 20 per problem, IndexedDB through `createDurableKV`) and opens `ReportDialog`. Every lost point in the report comes with its reason (the rules' feedback).

**Persistence schema.** `domain/persistence/`: `migrate.ts` (`migrateV1toV2` — pure, idempotent, never throws: `maxQPS`/`latencyMs`/`replicas` → `params.capacityPerInstance`/`serviceTimeMs`/`instances`, other params from schema defaults, edges get a rule (`on_miss` out of cache/CDN, else `always`), runtime fields dropped, unknown component types kept as `custom` with a warning, dangling edges dropped; text nodes and strokes untouched), `serialize.ts` (canvas ⇄ `SerializedNode`/`SerializedEdge`) and `envelope.ts`. `SerializedEdge` must carry `data` (label/protocol/async **and `rule`**) or edge metadata is lost on save/load. Every JSON export (top bar and Load dialog) uses the v2 envelope `{ schemaVersion: 2, name, problemId, nodes, edges, strokes, chaosScript?, slo? }` (`chaosScript` is an opaque placeholder preserved on round-trip; `slo` is the design's SLO override, sanitized on import with `sanitizeSloOverrides`; saving a design stores its problem's override, loading one restores it); `importDesign` accepts schemaVersion 1 and 2 (missing = 1), validates structurally, migrates, and returns `{ ok, error? }` (plus `warnings`). Image export is PNG or SVG (`lib/exportCanvas.ts`, html-to-image; both include pen strokes).

**Canvas/UI.** `nodeTypes`/`edgeTypes` are module-level (never inline — causes remounts). Reference tabs (`tab.readOnly`) must hide or disable dragging/connecting/dropping/delete and other edit affordances; check with `useIsActiveTabReadOnly()` in render and `isActiveTabReadOnly(useCanvasStore.getState())` in handlers (never re-derive it from `tabs`). Keyboard shortcuts must no-op while typing in inputs; there is one delete path (`deleteKeyCode={null}` on ReactFlow + `components/canvas/useCanvasShortcuts.ts` → `deleteSelection()`; the node toolbar, context menu and panel call the same action). Selection-editing shortcuts live in that hook (inside the ReactFlow provider); app-level ones stay in AppShell. Palette → canvas drag goes through `PaletteDndProvider` (@dnd-kit, one path for mouse and touch); a drop is accepted by the canvas rect under the real pointer position, never by DOM hit-testing (the empty-state overlay covers the canvas). Create nodes with `lib/nodeFactory.ts`. Dialogs go through `ModalShell`. On mobile the right panel is a bottom sheet (`[data-bottom-sheet]`) over the canvas: a panel that frames nodes passes `paddingAboveSheet` (`lib/placement.ts`) to `fitView`, or on a phone they land under the sheet. Touch: hover-only affordances are invisible on coarse pointers (Tailwind v4 gates `hover:` behind `@media(hover:hover)`) — gate visibility on `useIsCoarsePointer()` instead. The top bar is full from 768 to 1920 px: a new item must keep its groups apart and the problem selector ≥ 80 px wide (`smoke.spec.ts` measures it, with a live run so every chip shows), so gate it behind a breakpoint or put it in the overflow menu. Text renders ~20 px wider off Linux, so the smoke test demands 25 px more on Windows/macOS than in CI: a local pass at the bare minimum fails in CI.

## Data conventions

- **Params & edge rules (Spec 03).** Every component type has a `ComponentSchema` (`getSchema(id)`; ids without a hand-written schema in `domain/components/schemas/` get the generic fixed-capacity one). Node values live in `data.params`, always validated by the schema (`sanitizeParams`/`resolvedParams`: unknown keys dropped, invalid → default). Every schema keeps the core keys `instances`/`capacityPerInstance`/`serviceTimeMs` (defaults = the catalog's `maxQPS`/`latencyMs`) and the engine-facing `PARAM` keys; never rename a `PARAM` key. The Props form is generated from the schema by `components/panel/ParamsForm.tsx` — no per-type forms. Param and rule edits go through `updateNodeParams`/`updateEdgeRule` (one undo step, no-op on read-only tabs). Every edge carries `data.rule` (`EdgeRule`); new edges get their data from `newEdgeData` (editor, quick fixes, reference loader) with the `connectEdgeRule` default (Cache/CDN → `on_miss`, Service → Read Replica `reads` and → its SQL DB `writes`, Queue → DLQ `fraction`, Autoscaler → control link with `callsPerRequest: 0`).
- A new catalog component needs: an entry in `components.ts`, its icon in `lib/icons.ts`, a Concept Library entry (except `custom`), a schema (or the generic one), a price in `domain/components/pricing.ts` (with `assumptions` naming the instance class or service and what's left out) and, if it routes traffic specially, an entry in the registry's `ROUTING` map. `tests/unit/catalog.test.ts` checks all of this.
- Component `id`s referenced in `problems.ts` reference solutions, `conceptLibrary.ts`, and `learningPath.ts` must exist in `components.ts`. A single reference solution must NOT reuse the same `componentId` twice (the loader wires edges by componentId).
- Every reference solution needs an entry node: in-degree 0 with an outgoing edge (how the scorer, and the engine when there is no `client`, find entries), or nothing in it is reachable.
- Reference solutions are **sized** (Spec 09): nodes carry `params` (instances, capacity/service time where the problem needs it) and edges may carry `async`/`rule` (monitoring and asset traffic off the request path, reads/writes classes, control links with `callsPerRequest: 0`), so each holds its own peak and 2× surge within the SLA. `instances` go up to `MAX_INSTANCES` (1000); beyond that use a bigger `capacityPerInstance` with a reason in a comment.
- Every built-in problem declares its SLO (Spec 11): `requirements.latencyMs` (a p99 target unless `latencyPercentile` says the statement uses another), `slaScope` when it's about one component, and `availability` — taken from the statement when it states one, else 99.9% (99.99% for shared infrastructure, 99% for batch). Its reference must hold it at the peak (`data.test.ts`).
- Every built-in problem has `requirements.budgetMonthlyUsd` = its reference's cost at the peak × 1.3, rounded up to two significant figures; after a pricing, engine or reference change, recalibrate it (`data.test.ts` fails when the reference leaves [budget/1.5, budget/1.3]).
- `learningPath.ts` prerequisites must be concepts taught by a strictly **earlier** problem in path order.
- All 35 problems must have entries in `interviewData.ts` and a learning-path tier.
- `tests/unit/catalog.test.ts` and `tests/unit/data.test.ts` check these rules.
- Content teaches interview candidates — every formula, figure, API shape, and real-world attribution must be correct.

## Conventions

- Dark theme only (`<html class="dark">`); there is no theme toggle. Use zinc-* palette; sub-11px labels use `text-zinc-400`+ for contrast.
- Temp/scratch files: keep them out of the repo.
- Commit messages: do NOT add Claude/AI attribution or co-author trailers.
