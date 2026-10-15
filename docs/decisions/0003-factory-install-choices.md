# 0003. How the software factory is installed here

**Status:** Accepted
**Date:** 2026-10-15
**Deciders:** GBFerro

## Context

The factory came from the software-factory template (`scripts/bootstrap.sh`, stack `node`) and was
fitted to this repository: Next.js 16, React 19, npm, oxlint and oxfmt, vitest unit tests in
`tests/unit`, Playwright in `tests/e2e`, a GitHub remote. The sibling repository
`wallet-organization` runs the same harness at the same level. Some template defaults did not fit
and are changed here; this record says which, so the next change does not undo them by mistake.

## Decision

**Level 2** (agent with human review), owner GBFerro, protected branch `main`. Moving up a level is
recorded here as a new ADR.

**Checks** (`factory.config.sh`): `FACTORY_CHECKS="harness lint format typecheck test build"`.

- `lint` is `npm run lint -- --deny-warnings`. It passes on `main` today, so no warning is accepted
  as debt.
- `build` is `npm run build && npm run bundle:check`: the production build (it type-checks too) and
  the initial-JS budget against `bundle-baseline.json`.
- Playwright is the named check `e2e` and is **not** in `FACTORY_CHECKS`: it takes minutes and needs
  a browser, too slow for the receipt every push needs. CI runs it after `verify.sh`, on the build
  that run made (`bash scripts/verify.sh e2e`, no receipt). The rule that a change to navigation,
  layout or handles runs the whole suite locally stays in the project docs (`CLAUDE.md` today,
  `docs/testing.md` after the docs fold).
- `FACTORY_STOP_CHECKS="lint format"`: the fast ones only.

**One workflow.** `.github/workflows/ci.yml` is gone; `factory-gate.yml` holds its steps: Node 22 with
the npm cache, `npm ci`, `verify.sh`, the e2e run and the Playwright report upload on failure, next to
the harness check, gitleaks and the PR body policy. The old PR checklist items that still apply
(bundle baseline, whole e2e suite, browser check, sourced content) moved into the factory's PR
template as "Project checks".

**Test-first.** The sensor pairs a source file with a unit test whose name holds the file's name,
before or after a `-` or `.` (`tick.ts` with `engine-tick.test.ts`), because the suites here are
named by feature. Exempt, each with its reason in `sensors/test-first-exempt.txt`: the Next.js app
router files, React components and hooks (covered by Playwright), type files, static data and schema
tables, constants, and the frozen v1 simulator. 77 of the 232 files in `src/` are not exempt and have
no paired test yet (the stores, most of `lib/`, `scoring/`, `advisor/`, `cost/`, parts of `engine/`
and `domain/`): the first change to one of them starts with a test at the name the sensor prints.
That is the sensor working as designed, and the cost of the feature-named layout.

**Formatter.** `oxfmt` checks Markdown and JSON too, so the template's docs are formatted with it,
except `docs/model-routing.md`, listed in `.oxfmtrc.json` `ignorePatterns`: `check-harness.sh`
matches its routing table rows byte for byte (`| \`explorer\` | haiku | medium |`) and the formatter
pads them.

**Numbering.** The template's own records moved to 0004 (model routing) and 0005 (lessons ledger),
so this repository's decisions come first. [0002](0002-retire-tlc-spec-driven.md) retires the
previous workflow.

## Alternatives considered

| Option                                       | Why not                                                                                                                     |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Put e2e in `FACTORY_CHECKS`                  | Every verify, and so every push, would wait for a browser run; the receipt would also depend on the machine having Chromium |
| Keep `ci.yml` beside `factory-gate.yml`      | Two workflows install and build twice, and one of them could be required while the other is not                             |
| Turn the test-first sensor off               | The suites are not paired by file today, but new logic should still arrive with its test                                    |
| Exempt the 77 files one by one               | A list that long hides the files nobody tests; the sensor asks for a test when one of them changes                          |
| Ignore every template doc in `.oxfmtrc.json` | Only one file breaks a harness check when formatted; the rest are formatted                                                 |

## Consequences

- Known debt at installation: none from lint, format, typecheck, unit tests or the build, which
  passed on the installed tree. The 77 unpaired files above are the only gap this install makes
  visible.
- `FACTORY.md` still lists the template's accepted gaps with `YYYY-MM-DD` review dates. Fill them in,
  and delete the server-side branch protection row once it is on.
- Branch protection on GitHub must require the factory's jobs (`harness`, `verify`, `secrets`,
  `pr-policy`) instead of the old `Lint, format, test & build` job, which no longer exists.
- Git hooks are off until the owner runs `lefthook install` in the main checkout.
