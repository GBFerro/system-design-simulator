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
npm run test:e2e     # playwright (tests/e2e); starts `next dev` on :3100 unless one is running
npm run bundle:check # after build: initial JS of / vs bundle-baseline.json (max +15%); fails if the lazy engine client leaks in
```

CI (Node 22) runs lint, typecheck, unit tests, build, bundle check and E2E on every PR. Unit tests cover pure logic (scoring, engine, traffic patterns, persistence, store actions); editor behavior goes in Playwright. Still exercise UI changes in the browser. Only update `bundle-baseline.json` (`node scripts/bundle-size.mjs --update`) when the growth is intended and justified in the PR.

## Tech stack

Next.js 16 (App Router, single static `/` route) · React 19 · TypeScript · @xyflow/react v12 (ReactFlow) · Zustand v5 (persisted) · Tailwind v4 · base-ui dialogs/primitives · framer-motion · perfect-freehand (pen) · html-to-image (export) · @dnd-kit/core (palette drag) · comlink (engine Web Worker RPC). No new runtime deps without good reason.

## Architecture map

```
src/
  app/            App Router entry, layout, globals.css (dark-only theme)
  components/
    canvas/       DesignCanvas (ReactFlow host), nodes/ (Component, Text, NodeActionsToolbar), edges/, PenOverlay/PenToolbar, CanvasTabBar,
                  CanvasContextMenu, PaletteDnd (@dnd-kit), useCanvasShortcuts, canvasEvents
    panel/        RightPanel + Props/Sim/Score/Capacity/Tradeoffs tabs
    sidebar/      Sidebar: ComponentPalette, ProblemSelector, LearningPath
    layout/       AppShell (orchestrator + keyboard shortcuts), TopBar, SupportFAB
    interview/    InterviewBar, phase panel, start dialog
    dialogs/      ModalShell (shared modal: focus trap/Escape/scroll) + Save/Load/Confirm/Support/Create*
    traffic/      live traffic (Spec 06): TrafficControls (Sim panel: play/pause/reset, speed, clock,
                  log RPS slider, PatternEditor + PatternPreview), PlaybackMini (top bar),
                  simActions.ts (UI → controller via dynamic import; used by the `P` shortcut)
    ui/           shadcn-style primitives, Toast
  data/           components.ts (42 specs), problems.ts (35), conceptLibrary.ts,
                  interviewData.ts, tradeoffCards.ts (21), learningPath.ts
  domain/
    components/   types.ts (ParamSpec/ComponentSchema/EdgeRule), params.ts (PARAM keys + spec builders),
                  schemas/<type>.ts (per-type schemas), registry.ts (getSchema/defaultParams/sanitizeParams/readers)
    graph/        compile.ts (ReactFlow nodes/edges → validated SimGraph),
                  edgeRules.ts (connect defaults, sanitize, rule form specs)
  engine/         analyze.ts (steady state), core/ (queueing = Erlang C/M/M/c, routing, sampler,
                  rng (+ Poisson), settle = shared reverse pass/sampler model, tick = TickSimulator),
                  engine.ts (FlowEngine: analyze + tick loop scheduler), session.ts (throttled frame
                  stream), worker.ts + client.ts (Comlink worker, lazy; SimController),
                  traffic/ (types = TrafficPattern/SimSpeed/tick constants, patterns = rateAt/sanitize),
                  snapshot.ts (analyze → TickSnapshot), toSimulationResult.ts (→ v1 UI shape),
                  types.ts, constants.ts, legacy/simulator.ts (v1, kept only as a comparison in tests)
  scoring/        scorer.ts + rules/ (scalability, availability, latency, cost, tradeoffs — 20 pts each)
  store/          zustand stores (see below); runtimeStore.ts = unpersisted live metrics, fed by
                  SimController (tick frames) and the Simulate button (analyze snapshot)
  lib/            exportCanvas, loadReference, nodeFactory, placement, icons, utils
  types/          shared interfaces
tests/
  unit/           vitest (pure logic: scoring, engine, traffic patterns, persistence, store actions)
  e2e/            playwright specs (smoke today, editor B1–B6 in spec 02)
scripts/          bundle-size.mjs (initial-JS budget vs bundle-baseline.json)
```

## Key invariants — don't break these

**Simulation engine (`engine/`, Spec 04).**

- Pipeline: `compileGraph(nodes, edges)` (`domain/graph/compile.ts`) → `SimGraph` → `analyze(graph, rps, config?)` → `SteadyState`. The UI calls `simulateCanvas` from `engine/client.ts` via dynamic `import()`; it runs in a Comlink Web Worker created lazily (in-thread fallback without `Worker`), so the engine is never in the initial bundle. `toSimulationResult` maps onto the v1 `SimulationResult` the panel renders.
- `compileGraph` takes ALL nodes/edges: non-component (text) nodes and edges touching them are dropped, self-loops dropped, parallel edges deduped, params sanitized via the registry (`sanitizeParams`; v1 `maxQPS`/`latencyMs`/`replicas` still read), edge rules resolved (`edge.data.rule` → `sanitizeEdgeRule`, missing → `defaultEdgeRule`). Problems become warnings, never exceptions.
- Entry nodes = the `client` node(s) if any, else in-degree 0 **with** outgoing edges (a fully disconnected node is NOT an entry and must not receive traffic).
- Order = Kahn, then cycle members (BFS from where traffic enters), then nodes downstream of cycles; edges closing a cycle are `back` and carry no load.
- Each node is `instances` × M/M/c with c = round(capacityPerInstance × serviceTimeMs / 1000) slots, so c·μ = capacityPerInstance (the capacity knob); Erlang C only via the Erlang B recursion (never aᶜ/c!); ρ ≥ 1 → backlog grows for the horizon up to `maxQueue`, excess dropped.
- Routing is by `routingFor(componentId)` + edge rules, NOT 100% fan-out: LB splits by algorithm (round-robin/hash equal, weighted ∝ capacity, least-connections ∝ free capacity); service/fixed/breaker edges carry served × P(rule) × `callsPerRequest` (reads/writes by read ratio, `fraction`, `on_miss` = 1 − hitRate); queues decouple (each consumer edge drains ≤ min(consumers, target instances) × target capacity, the rest is lag; edges out of a queue are off the user path); rate limiter admits min(λ, limitRps).
- Retries (`maxRetries` on the caller) amplify edge load by (1 − f^{R+1})/(1 − f), solved as a fixed point.
- Only read params through `PARAM` keys with fallbacks.
- Invariants: served ≤ offered at every node and throughput ≤ offered load; every reported number finite; async edges carry load but are excluded from user-facing latency; same graph + seed (mulberry32) → deep-equal result.
- **Tick loop (Phase 2, `core/tick.ts`):** each `step(λ)` advances Δt = `TICK_SEC` (50 ms): arrivals ~ Poisson(λΔt) from the seeded PRNG (`samplePoisson`: exact up to a mean of 30, normal approximation above), split over entries; propagation in compiled order with the SAME routing as `analyze()` (flow out of a node = what it completed this tick); per node a fluid backlog Q ← max(0, Q + (λ − cμ)Δt) capped at `maxQueue` (excess dropped); wait = Erlang C when ρ < 1 without real backlog, else Q/(cμ); queue nodes keep per-consumer-edge lag drained at ≤ consumer capacity; timeouts/success/availability via `core/settle.ts` (shared with `analyze()`, don't fork it); retries carry over one tick per generation (converges to the same (1 − f^{R+1})/(1 − f)); 1000 sampled requests per tick for end-to-end percentiles.
- `global.throughput` = this tick's arrivals that succeed (≤ `offeredRps`); per node `rpsOut` = completions and may exceed `rpsIn` while a backlog drains.
- `FlowEngine`: `play`/`pause`/`reset` (rewind to 0 keeping graph/speed/pattern)/`setSpeed`/`setTraffic` (next tick; the pattern clock restarts only when the KIND changes)/`onTick`/`step(n)`; 6000-tick ring buffer; the scheduler runs speed × wall time in slices, caps work per slice and re-anchors when behind (sim slows, never bursts). `load()` during a run hot-swaps the graph (clock and surviving backlogs kept).
- `session.ts` streams ≤ `UI_SNAPSHOT_HZ` frames (tagged with a reset generation) through a Comlink `proxy`; `SimController` (`getSimController()` in `client.ts`) mirrors playback/speed/pattern/clock into `runtimeStore`, recompiles the canvas on edits (250 ms debounce) and resets on tab switch or an external `runtimeStore.clear()`.
- Same graph + seed + pattern calls → bit-identical snapshots. `inject`/`heal` throw until Spec 08.
- Tests: `tests/unit/engine-*.test.ts`, `traffic-patterns`, `sim-controller`, e2e `traffic.spec.ts`.

**Scoring (`scoring/`).** `scorer.ts` builds a shared `ScoringGraph` (cleaned adjacency + reachable-from-entry set) once and passes it to every rule. Presence checks must require reachability — placing a component without wiring it earns no points (with feedback saying so). Each category rule must total **exactly 20** max and never go negative; verify the arithmetic if you touch a rule.

**Stores (`store/`).** Every persisted store uses `version: STORE_VERSION` (2, from `persistVersion.ts`; `persistence.versions.test.ts` fails if one does not), `skipHydration: true`, and a real `migrate(persisted, fromVersion)`: `canvasStore` (live nodes/edges + every tab) and `savedDesignsStore` (every design) run `migrateV1toV2` via `migrations.ts`; stores whose shape didn't change use `passThroughMigration`. A new persisted store must do the same. Storage is `safeLocalStorage` (from `safeStorage.ts`, swallows QuotaExceeded + toasts), except saved designs, which live in IndexedDB through `durableStorage.ts` (idb-keyval; a localStorage copy is moved to IndexedDB and removed only after the write is confirmed; falls back to `safeLocalStorage` with a toast when IndexedDB is unavailable). Reuse `createDurableKV()` for anything big (run history). Hydration is deferred: `hydration.ts` exports `rehydrateAllStores()` and `useHasHydrated()` — call after mount to avoid SSR mismatch; custom components rehydrate first (the migration needs them), and saved designs hydrate asynchronously (their `merge` keeps designs saved before it finished). `canvasStore` persists the active tab with empty nodes/edges (live copies live at the top level; reconstructed on rehydrate); it holds no runtime metrics (see below). It also has unpersisted undo/redo history (`undo`/`redo`/`canUndo`/`canRedo`, 50 entries, pushed before mutation; consecutive arrow-key nudges share one entry) and an unpersisted `clipboard`. **Selection has one source of truth: `node.selected` / `edge.selected`** — there is no `selectedNodeId`; use `selectOnly`/`selectAll`/`clearSelection`. Editing actions act on the selection, push exactly one history entry, and no-op on read-only tabs by themselves: `deleteSelection`, `copySelection`/`pasteClipboard`, `duplicateSelection`, `nudgeSelection`, `changeReplicas`, `placeNode` (spiral search via `lib/placement.ts` so new nodes never overlap). `interviewStore` timer is timestamp-based (`startedAt`/`accumulatedMs`) so it survives background-tab throttling and refresh — never reintroduce tick-counting.

**Runtime metrics (`store/runtimeStore.ts`, Spec 07).** Live metrics live ONLY in the unpersisted `runtimeStore` (`latest` `TickSnapshot` + `history` ring buffer, `historyVersion` bumps on push/clear), fed by the Simulate button (`steadyStateToSnapshot(steady, t, graph)`, which also derives the OBS-03 extras from params) and by the tick loop. Never write metrics into `node.data` (no `utilization`/`status`/`isBottleneck` there) and never touch `canvasStore` from a tick — that would re-render and re-persist the graph. `pushSnapshot` shares unchanged node/edge/global objects with the previous snapshot, so read per entity with the selector hooks (`useNodeRuntime(id)`, `useNodeStatus(id)`, `useEdgeRuntime(id)`, `useGlobalRuntime()`): a tick re-renders only what changed. Subscribe to history (`useRecentHistory`) only in components mounted on demand (open sparkline, Sim panel). Node badges must keep a fixed size (a resize makes ReactFlow re-measure → a `canvasStore` write). Metrics are cleared (`clear()`) with the simulation result on tab switch/close, load, reference and clear canvas (`resetSimulation` in `canvasStore`). Particles (`components/canvas/FlowParticles.tsx`) are ONE `<canvas>` over the renderer: edge paths sampled with `getPointAtLength` from the rendered `.react-flow__edge-path` and cached by `d` (resampled only after graph changes; the viewport is a canvas transform read from the ReactFlow store), budget from `lib/particles.ts` (density ∝ log10(1 + rps), 2,000 global cap), one rAF loop reading `getLatestSnapshot()` with no React render per frame, stopped without a snapshot or while the tab is hidden, a still frame while paused. Never add per-token DOM/SVG elements. Status is shown by color AND icon. `prefers-reduced-motion`: no particles at all; edges still show load (width) and status (color). Tests push synthetic snapshots through `window.__runtimeStore` (dev, or `?e2e` in any build).

**Persistence schema.** `domain/persistence/`: `migrate.ts` (`migrateV1toV2` — pure, idempotent, never throws: `maxQPS`/`latencyMs`/`replicas` → `params.capacityPerInstance`/`serviceTimeMs`/`instances`, other params from schema defaults, edges get a rule (`on_miss` out of cache/CDN, else `always`), runtime fields dropped, unknown component types kept as `custom` with a warning, dangling edges dropped; text nodes and strokes untouched), `serialize.ts` (canvas ⇄ `SerializedNode`/`SerializedEdge`) and `envelope.ts`. `SerializedEdge` must carry `data` (label/protocol/async **and `rule`**) or edge metadata is lost on save/load. Every JSON export (top bar and Load dialog) uses the v2 envelope `{ schemaVersion: 2, name, problemId, nodes, edges, strokes, chaosScript?, slo? }` (`chaosScript`/`slo` are opaque placeholders for Specs 08/11, preserved on round-trip); `importDesign` accepts schemaVersion 1 and 2 (missing = 1), validates structurally, migrates, and returns `{ ok, error? }` (plus `warnings`). Image export is PNG or SVG (`lib/exportCanvas.ts`, html-to-image; both include pen strokes).

**Canvas/UI.** `nodeTypes`/`edgeTypes` are module-level (never inline — causes remounts). Reference tabs (`tab.readOnly`) must gate dragging/connecting/dropping/delete. Keyboard shortcuts must no-op while typing in inputs; there is one delete path (`deleteKeyCode={null}` on ReactFlow + `components/canvas/useCanvasShortcuts.ts` → `deleteSelection()`; the node toolbar, context menu and panel call the same action). Selection-editing shortcuts live in that hook (inside the ReactFlow provider); app-level ones stay in AppShell. Palette → canvas drag goes through `PaletteDndProvider` (@dnd-kit, one path for mouse and touch); a drop is accepted by the canvas rect under the real pointer position, never by DOM hit-testing (the empty-state overlay covers the canvas). Create nodes with `lib/nodeFactory.ts`. Dialogs go through `ModalShell`. Touch: hover-only affordances are invisible on coarse pointers (Tailwind v4 gates `hover:` behind `@media(hover:hover)`) — gate visibility on `useIsCoarsePointer()` instead.

## Data conventions

- **Params & edge rules (Spec 03).** Every component type has a `ComponentSchema` (`getSchema(id)`; ids without a hand-written schema in `domain/components/schemas/` get the generic fixed-capacity one). Node values live in `data.params`, always validated by the schema (`sanitizeParams`/`resolvedParams`: unknown keys dropped, invalid → default). Every schema keeps the core keys `instances`/`capacityPerInstance`/`serviceTimeMs` (defaults = the catalog's `maxQPS`/`latencyMs`) and the engine-facing `PARAM` keys; never rename a `PARAM` key. The Props form is generated from the schema by `components/panel/ParamsForm.tsx` — no per-type forms. Param and rule edits go through `updateNodeParams`/`updateEdgeRule` (one undo step, no-op on read-only tabs). Every edge carries `data.rule` (`EdgeRule`); new edges get `connectEdgeRule` (Cache/CDN → `on_miss`, Service → Read Replica `reads` and → its SQL DB `writes`, Queue → DLQ `fraction`, Autoscaler → control link with `callsPerRequest: 0`).
- A new catalog component needs: an entry in `components.ts`, its icon in `lib/icons.ts`, a Concept Library entry (except `custom`), a schema (or the generic one) and, if it routes traffic specially, an entry in the registry's `ROUTING` map. `tests/unit/catalog.test.ts` checks all of this.
- Component `id`s referenced in `problems.ts` reference solutions, `conceptLibrary.ts`, and `learningPath.ts` must exist in `components.ts`. A single reference solution must NOT reuse the same `componentId` twice (the loader wires edges by componentId).
- `learningPath.ts` prerequisites must be concepts taught by a strictly **earlier** problem in path order.
- All 35 problems must have entries in `interviewData.ts` and a learning-path tier.
- Content teaches interview candidates — every formula, figure, API shape, and real-world attribution must be correct.

## Conventions

- Dark theme only (`<html class="dark">`); there is no theme toggle. Use zinc-* palette; sub-11px labels use `text-zinc-400`+ for contrast.
- Temp/scratch files: keep them out of the repo.
- Commit messages: do NOT add Claude/AI attribution or co-author trailers.
