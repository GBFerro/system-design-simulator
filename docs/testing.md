# Testing, CI and the bundle budget

How the project is checked. The gate that certifies a change is `bash scripts/verify.sh` (see
[harness.md](harness.md)); this page explains the project commands it runs and the two checks that
do not run in it.

## Commands

```bash
npm run dev          # dev server (http://localhost:3000)
npm run build        # production build; it also runs tsc, and must pass before pushing
npm run lint         # oxlint (config: .oxlintrc.json); the gate runs it with --deny-warnings
npm run format       # oxfmt (config: .oxfmtrc.json); the gate runs format:check
npm run typecheck    # tsc --noEmit
npm test             # vitest (tests/unit)
npm run test:e2e     # playwright (tests/e2e); starts `next dev` on :3100 unless one runs there. Next 16 allows ONE
                     # dev server per directory: with `npm run dev` open on :3000, use `E2E_PORT=3000 npm run test:e2e`
npm run bundle:check # after build: initial JS of / vs bundle-baseline.json (max +15%); fails if the lazy engine client leaks in
```

`factory.config.sh` maps them to checks: `lint`, `format`, `typecheck`, `test` and `build` (which is
`npm run build && npm run bundle:check`). Playwright is the named check `e2e`, outside the receipt
(see below).

## Which test for what

Unit tests (`tests/unit/**/*.test.ts`, vitest) cover pure logic: scoring, engine, traffic patterns,
persistence, store actions, data. Editor behavior goes in Playwright (`tests/e2e`, one spec per
feature area; shared helpers in `helpers.ts`: import them, do not redefine). Still exercise UI changes
in the browser.

The `require-test-first` sensor pairs a source file with a unit test whose name holds the file's
name (`tick.ts` pairs with `engine-tick.test.ts` or `tick.test.ts`). UI and data folders are exempt,
each with its reason, in `sensors/test-first-exempt.txt`.

## E2E

A change to navigation, layout or handles must run the whole e2e suite locally
(`npm run test:e2e`), not only the specs of its area: specs that reach their screen through a removed
control only fail far from the change (lesson L-014 in `.specs/LESSONS.md`).

The e2e suite takes minutes and needs a browser, so it is not in `FACTORY_CHECKS` and no receipt
covers it. `bash scripts/verify.sh e2e` runs it (it installs Chromium first and writes no receipt).
CI runs it after the verify job's checks, on the production build they just made, and uploads
`playwright-report/` when it fails.

## CI

One workflow, `.github/workflows/factory-gate.yml`, on every PR and on pushes to `main` (Node 22):

- `harness`: the sensors' tests and `scripts/check-harness.sh`.
- `verify`: `bash scripts/verify.sh` (harness, lint, format, typecheck, unit tests, build and bundle
  check), then the e2e suite and the Playwright report upload on failure.
- `secrets`: gitleaks.
- `pr-policy`: the PR body must follow `.github/PULL_REQUEST_TEMPLATE.md`.

## Bundle budget

The initial JS of `/` may not grow more than 15% over `bundle-baseline.json`, and the lazy engine
client may never land in it (`scripts/bundle-size.mjs`). The PR that closes a roadmap phase (Fase 0–6
in [00-visao-geral.md](00-visao-geral.md)) re-baselines it (`node scripts/bundle-size.mjs --update`) and
justifies the growth in its description; between phase ends the +15% limit applies against the
current baseline, and the baseline is not updated.
