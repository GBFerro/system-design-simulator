<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Before you start

- **Read `CLAUDE.md`.** It is the single place for the architecture map and the invariants you must not break (engine, scoring, stores, runtime metrics, persistence, canvas) plus the data conventions. Most subtle bugs here come from violating one of them.
- Verify with the commands in its Commands section (lint, format, typecheck, unit tests, build; CI also runs the bundle check and Playwright E2E), and exercise UI changes in the browser.

## Quick rules of thumb

- Invariants live only in `CLAUDE.md`; don't restate them here. When a rule can be a test, prefer the test (`tests/unit/`) and point to it.
- Many invariants are already enforced: scoring budgets (`scoring.test.ts`), catalog and data conventions (`catalog.test.ts`, `data.test.ts`), persisted store versions (`persistence.versions.test.ts`). Run `npm test` instead of checking by hand.
- Stack, dependencies, theme and commit-message rules: `CLAUDE.md` (Tech stack, Conventions).
- PR checklist: `.github/PULL_REQUEST_TEMPLATE.md`.

## Factory

This repo runs under a software factory harness at level 2. [FACTORY.md](FACTORY.md) says what you may and may never do; the `deliver` skill is the procedure for a change (branch, spec when needed, test first, `bash scripts/verify.sh`, draft PR, cold audit). Specs go to `specs/` through the `spec-first` skill; `.specs/` is history ([ADR 0002](docs/decisions/0002-retire-tlc-spec-driven.md)). Where new rules go: [docs/harness.md](docs/harness.md). Keep this file under 120 lines (`bash scripts/check-harness.sh` enforces it).

- Gate: `bash scripts/verify.sh` writes the receipt, `bash scripts/receipt-check.sh` checks it. `bash scripts/verify.sh e2e` runs Playwright (outside the receipt; CI runs it).
- Harness files (`sensors/`, `scripts/`, `.claude/`, `lefthook.yml`, `.lefthook/`, `factory.config.sh`, `.github/`) change only in a PR of their own, never mixed with product code. That PR may carry the docs the harness owns (`FACTORY.md`, `docs/harness.md`, `docs/model-routing.md`, the ADRs in `docs/decisions/`, the `specs/` template).
