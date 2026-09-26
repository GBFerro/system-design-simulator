# CLAUDE.md

Guidance for AI agents (and humans) working in this repo.

> **Read `AGENTS.md` first.** This is Next.js 16 — APIs and conventions differ from older versions. Check `node_modules/next/dist/docs/` before writing framework code.

## What this is

SystemForge — an open-source system-design interview simulator. Drag infrastructure components onto a React Flow canvas, wire them, simulate production-scale traffic (Kahn's topological sort), and get scored across 5 interview dimensions. 100% client-side; state persists to `localStorage`. No backend.

## Commands

```bash
npm run dev      # dev server (http://localhost:3000)
npm run build    # production build — also runs tsc; must pass before pushing
npm run lint         # oxlint (config: .oxlintrc.json)
npm run format       # oxfmt (config: .oxfmtrc.json); CI runs format:check
npm run typecheck    # tsc --noEmit
npm test             # vitest (tests/unit)
npm run test:e2e     # playwright (tests/e2e); starts `next dev` on :3100 unless one is running
npm run bundle:check # after build: initial JS of / vs bundle-baseline.json (max +15%)
```

CI (Node 22) runs lint, typecheck, unit tests, build, bundle check and E2E on every PR. Unit tests cover pure logic (scoring, and later the engine); editor behavior goes in Playwright. Still exercise UI changes in the browser. Only update `bundle-baseline.json` (`node scripts/bundle-size.mjs --update`) when the growth is intended and justified in the PR.

## Tech stack

Next.js 16 (App Router, single static `/` route) · React 19 · TypeScript · @xyflow/react v12 (ReactFlow) · Zustand v5 (persisted) · Tailwind v4 · base-ui dialogs/primitives · framer-motion · perfect-freehand (pen) · html-to-image (export) · @dnd-kit/core (palette drag). No new runtime deps without good reason.

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
    ui/           shadcn-style primitives, Toast
  data/           components.ts (42 specs), problems.ts (35), conceptLibrary.ts,
                  interviewData.ts, tradeoffCards.ts (21), learningPath.ts
  domain/
    components/   types.ts (ParamSpec/ComponentSchema/EdgeRule), params.ts (PARAM keys + spec builders),
                  schemas/<type>.ts (per-type schemas), registry.ts (getSchema/defaultParams/sanitizeParams/readers)
    graph/        compile.ts (ReactFlow nodes/edges → validated SimGraph),
                  edgeRules.ts (connect defaults, sanitize, rule form specs)
  engine/         analyze.ts (steady state), core/ (queueing = Erlang C/M/M/c, routing, sampler, rng),
                  engine.ts (Engine contract), worker.ts + client.ts (Comlink worker, lazy),
                  toSimulationResult.ts (→ v1 UI shape), types.ts, constants.ts,
                  legacy/simulator.ts (v1, kept only as a comparison in tests)
  scoring/        scorer.ts + rules/ (scalability, availability, latency, cost, tradeoffs — 20 pts each)
  store/          zustand stores (see below)
  lib/            exportCanvas, loadReference, nodeFactory, placement, icons, utils
  types/          shared interfaces
tests/
  unit/           vitest (pure logic: scoring today, engine later)
  e2e/            playwright specs (smoke today, editor B1–B6 in spec 02)
scripts/          bundle-size.mjs (initial-JS budget vs bundle-baseline.json)
```

## Key invariants — don't break these

**Simulation engine (`engine/`, Spec 04).** Pipeline: `compileGraph(nodes, edges)` (`domain/graph/compile.ts`) → `SimGraph` → `analyze(graph, rps, config?)` → `SteadyState`. The UI calls `simulateCanvas` from `engine/client.ts` via dynamic `import()`; it runs in a Comlink Web Worker created lazily (in-thread fallback without `Worker`), so the engine is never in the initial bundle. `toSimulationResult` maps onto the v1 `SimulationResult` the panel renders. `compileGraph` takes ALL nodes/edges: non-component (text) nodes and edges touching them are dropped, self-loops dropped, parallel edges deduped, params sanitized via the registry (`sanitizeParams`; v1 `maxQPS`/`latencyMs`/`replicas` still read), edge rules resolved (`edge.data.rule` → `sanitizeEdgeRule`, missing → `defaultEdgeRule`). Problems become warnings, never exceptions. Entry nodes = the `client` node(s) if any, else in-degree 0 **with** outgoing edges (a fully disconnected node is NOT an entry and must not receive traffic). Order = Kahn, then cycle members (BFS from where traffic enters), then nodes downstream of cycles; edges closing a cycle are `back` and carry no load. Each node is `instances` × M/M/c with c = round(capacityPerInstance × serviceTimeMs / 1000) slots, so c·μ = capacityPerInstance (the capacity knob); Erlang C only via the Erlang B recursion (never aᶜ/c!); ρ ≥ 1 → backlog grows for the horizon up to `maxQueue`, excess dropped. Routing is by `routingFor(componentId)` + edge rules, NOT 100% fan-out: LB splits by algorithm (round-robin/hash equal, weighted ∝ capacity, least-connections ∝ free capacity); service/fixed/breaker edges carry served × P(rule) × `callsPerRequest` (reads/writes by read ratio, `fraction`, `on_miss` = 1 − hitRate); queues decouple (each consumer edge drains ≤ min(consumers, target instances) × target capacity, the rest is lag; edges out of a queue are off the user path); rate limiter admits min(λ, limitRps). Retries (`maxRetries` on the caller) amplify edge load by (1 − f^{R+1})/(1 − f), solved as a fixed point. Only read params through `PARAM` keys with fallbacks. Invariants: served ≤ offered at every node and throughput ≤ offered load; every reported number finite; async edges carry load but are excluded from user-facing latency; same graph + seed (mulberry32) → deep-equal result. `play`/`pause`/`onTick` (Phase 2) and `inject`/`heal` (Spec 08) are in the `Engine` contract but throw. Tests: `tests/unit/engine-*.test.ts`.

**Scoring (`scoring/`).** `scorer.ts` builds a shared `ScoringGraph` (cleaned adjacency + reachable-from-entry set) once and passes it to every rule. Presence checks must require reachability — placing a component without wiring it earns no points (with feedback saying so). Each category rule must total **exactly 20** max and never go negative; verify the arithmetic if you touch a rule.

**Stores (`store/`).** Every persisted store uses `version: 1`, `skipHydration: true`, a no-op `migrate`, and `safeLocalStorage` (from `safeStorage.ts`, swallows QuotaExceeded + toasts). Hydration is deferred: `hydration.ts` exports `rehydrateAllStores()` and `useHasHydrated()` — call after mount to avoid SSR mismatch. `canvasStore` persists the active tab with empty nodes/edges (live copies live at the top level; reconstructed on rehydrate) and strips runtime fields (`utilization`/`status`/`isBottleneck`). It also has unpersisted undo/redo history (`undo`/`redo`/`canUndo`/`canRedo`, 50 entries, pushed before mutation; consecutive arrow-key nudges share one entry) and an unpersisted `clipboard`. **Selection has one source of truth: `node.selected` / `edge.selected`** — there is no `selectedNodeId`; use `selectOnly`/`selectAll`/`clearSelection`. Editing actions act on the selection, push exactly one history entry, and no-op on read-only tabs by themselves: `deleteSelection`, `copySelection`/`pasteClipboard`, `duplicateSelection`, `nudgeSelection`, `changeReplicas`, `placeNode` (spiral search via `lib/placement.ts` so new nodes never overlap). `interviewStore` timer is timestamp-based (`startedAt`/`accumulatedMs`) so it survives background-tab throttling and refresh — never reintroduce tick-counting.

**Persistence schema.** `SerializedEdge` must carry `data` (label/protocol/async) or edge metadata is lost on save/load. Export/import use a unified envelope `{ schemaVersion, name, problemId, nodes, edges, strokes }`; `importDesign` validates structurally and returns `{ ok, error? }`.

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
