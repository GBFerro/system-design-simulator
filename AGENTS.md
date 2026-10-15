<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# system-design-simulator

Guidance for agents (and humans) working in this repo. [FACTORY.md](FACTORY.md) says what you may
and may never do; this file is the map. Keep it under 120 lines: it loads into every session.

## The project

SystemForge: an open-source system-design interview simulator. Drag components onto a React Flow
canvas, wire them, simulate production-scale traffic and get scored on 5 dimensions. 100%
client-side (`localStorage`; saved designs in IndexedDB), no backend.

Stack: Next.js 16 (App Router, single static `/` route) · React 19 · TypeScript · @xyflow/react v12
(ReactFlow) · Zustand v5 (persisted) · Tailwind v4 · base-ui dialogs/primitives · framer-motion ·
perfect-freehand (pen) · html-to-image (export) · @dnd-kit/core (palette drag) · comlink (engine Web
Worker RPC). No new runtime deps without good reason.

- Temp/scratch files: keep them out of the repo.
- Commit messages: do NOT add Claude/AI attribution or co-author trailers.

## Commands

```bash
bash scripts/verify.sh            # full gate: every check in factory.config.sh, writes .factory/receipt.json
bash scripts/receipt-check.sh     # exit 0 only if the receipt passed for the current working tree
bash scripts/pr-ready.sh          # draft PR -> ready, only when checks and the cold audit cover its head
bash sensors/test.sh              # the sensors' own tests, both directions
bash scripts/check-harness.sh     # drift: sensor wiring, links, placeholders, line caps
```

Project commands live in `factory.config.sh`: run them through `verify.sh`. `bash scripts/verify.sh
lint test` runs just those checks and writes no receipt: a subset certifies nothing. `npm run dev`
starts the app on :3000. `bash scripts/verify.sh e2e` runs Playwright (minutes, outside the receipt,
CI runs it): run the whole suite for a change to navigation, layout or handles. Details in
[docs/testing.md](docs/testing.md). `bash scripts/doctor.sh` checks the tools (bash >= 4.4 among them).

## Architecture and invariants

The full map, the invariants and the data conventions are in
[docs/architecture.md](docs/architecture.md). Read the section for the area before you change it.
The ones that matter most:

- Engine: same graph + seed gives bit-identical results; never fork `core/settle.ts` or
  `core/faultView.ts` (shared by `analyze()` and the tick); never add fault-specific code to the
  tick (add a catalog entry built from modifiers); never update the `engine-golden` fixture to make
  a change pass.
- Live metrics live only in the unpersisted `runtimeStore`: never in `node.data`, never a
  `canvasStore` write from a tick.
- Persisted stores use `STORE_VERSION`, `skipHydration` and a real `migrate`; selection is
  `node.selected`; graph-editing actions are in `MUTATING_ACTIONS`.
- Only `domain/graph/returns.ts` knows what a response is; only `callPlan.ts` resolves call order.
- Scoring rules score through `BUDGET` summing to 20; measured checks never reward an empty design.
- Changing step only changes what is visible: no graph edit, undo entry or run reset.
- Canvas: module-level `nodeTypes`/`edgeTypes`; read-only tabs hide edit affordances; one delete
  path; dialogs through `ModalShell`; nodes from `lib/nodeFactory.ts`.
- Data: references are sized, have an entry node, and hold their SLO and budget; the content
  teaches interview candidates, so every figure must be correct.

## Orchestration

The main session orchestrates: it decides, dispatches subagents, integrates their results and runs
the gates (verify, commit, push, PR, audit verdict, `pr-ready.sh`). Searches go to `explorer`, and
specs, code and tests to the agent [docs/model-routing.md](docs/model-routing.md) routes them to;
each agent pins its model and effort. Independent work runs in parallel. The
`require-routed-subagent` sensor blocks unrouted subagents and per-call model or effort overrides.

## Delivering a change

Follow the `deliver` skill. In short:

1. Start from an up-to-date trunk and create a task branch: `<type>/<short-slug>`.
2. If the change needs a spec (`spec-first` skill), `spec-writer` drafts it into `specs/`; get the
   user's OK before code. The old `.specs/` is history, see [docs/decisions/](docs/decisions/0002-retire-tlc-spec-driven.md).
3. Workers write the failing test first; the `require-test-first` sensor blocks production edits without one.
4. Implement in small slices, one worker each; keep the end-of-turn checks green.
5. Verify (`verify-before-done` skill): `bash scripts/verify.sh`, then map each acceptance
   criterion to its evidence.
6. Commit with Conventional Commits, push the task branch, open a **draft** PR from the template.
7. Run the cold audit with the `auditor` subagent (never in your own context) and post its verdict.
8. Fix what it finds, push, and audit the new head. Repeat until `Verdict: PASS` on the head.
9. `bash scripts/pr-ready.sh`, then the `task-retro` skill. Stop there: the human merges.

## Verified means

A receipt in `.factory/receipt.json` with `"status": "passed"` whose tree is the tree you are
claiming about. Anything else (no receipt, failed, stale, another tree) is unverified, and
you say so. Never edit a check, the config, a sensor or a baseline to make a receipt pass.
The pre-push hook refuses a push whose commit tree has no passed receipt.

## Editing files

Create or change files inside the repo with Edit or Write, never through the shell (`>`, `tee`,
`sed -i`, `cp`/`mv` onto a file, `python -c`/`node -e` writes). Edit hooks only see the Edit and
Write tools, and shell writes cannot be rewound. Shell output is fine in ignored paths (`.factory/`)
and outside the repo (a temporary worktree).

## Harness changes

The harness is `sensors/`, `scripts/`, `.claude/`, `lefthook.yml`, `.lefthook/`,
`factory.config.sh` and `.github/`. Change it only in a PR of its own, with the user's OK, never mixed with product code. That PR may carry the docs the harness owns (`FACTORY.md`, `docs/harness.md`, `docs/model-routing.md`, the ADRs in `docs/decisions/`, the `specs/` template).
If a sensor blocks you wrongly, report it and propose the fix; do not route around it.

## Working habits

- **Read the file instead of recalling it.** Commands, paths and rules change; your memory of
  them does not.
- When a rule here and the code disagree, that is a finding: raise it, do not pick one silently.
- Report what you ran and what you skipped, with the exit status. "Should pass" is not a result.

## Where guidance goes

New rules go to the most enforced owner that can hold them: a sensor or check first, a doc last.
The ladder and the reasons are in [docs/harness.md](docs/harness.md). Lessons from retros are in
each PR's `## Retro` comment (`task-retro` skill); decisions in `docs/decisions/`.
