# 0002. Retire the tlc-spec-driven skill

**Status:** Accepted
**Date:** 2026-10-15
**Deciders:** GBFerro

## Context

Until now features were planned and checked with the `tlc-spec-driven` skill
(`.claude/skills/tlc-spec-driven/`, v3.3.0): four phases (Specify, Design, Tasks, Execute) that write
`spec.md`, `context.md`, `design.md`, `tasks.md` and `validation.md` under
`.specs/features/<feature>/`, with Python gates (`validate_spec.py`, `validate_tasks.py`,
`validate_state.py`) and a lessons ledger kept by `lessons.py` (`.specs/LESSONS.md`,
`.specs/lessons.json`). Decisions went to `.specs/STATE.md`.

The software factory is now installed (this PR). It covers the same ground with enforced gates
instead of a skill the agent may follow or not: `specs/` and the `spec-first` skill, workers that
write the test first, `scripts/verify.sh` with its receipt, a cold audit by a fresh subagent, and a
retro. Running both would give every change two homes for its intent (`.specs/` and `specs/`), two
ledgers of lessons, two sets of gates and two instructions for the agent about how to start.

## Decision

The factory is the only workflow.

- `.claude/skills/tlc-spec-driven/` is deleted, with its Python gates. It stays in git history
  (added in `de9de58`).
- New specs go to `specs/` through the `spec-first` skill and the `spec-writer` agent. The phases map
  as follows:

  | tlc                          | Factory                                                                                           |
  | ---------------------------- | ------------------------------------------------------------------------------------------------- |
  | Specify                      | `spec-first` skill, `spec-writer` agent, `specs/YYYY-MM-DD-<slug>.md`                             |
  | Design                       | the spec's design section; `architect` for hard decisions; an ADR when it is expensive to reverse |
  | Tasks                        | the `deliver` skill's slices, one worker each                                                     |
  | Execute                      | `implementer`, `implementer-deep`, `mechanic`; test first, enforced by a sensor                   |
  | `validation.md`              | `scripts/verify.sh` receipt, then the cold audit (`cold-audit` skill)                             |
  | `LESSONS.md`, `lessons.json` | the `## Retro` comment on each PR ([0005](0005-retire-the-lessons-ledger.md))                     |
  | `STATE.md` decisions         | ADRs in `docs/decisions/`                                                                         |

- `.specs/` is kept untouched as history: the three features specified so far
  (`request-flow`, `guided-ui` and, on its own branch, `component-technologies`), their
  validations, `LESSONS.md` and `lessons.json`, and the `AD-001` to `AD-004` decisions in `STATE.md`
  (`AD-005` arrives with `component-technologies`). Nobody edits them. The scripts that maintained
  `LESSONS.md` and `lessons.json` are gone, so the ledger is frozen at this commit.
- The decisions of `STATE.md` that are still active are already stated as invariants in
  `CLAUDE.md`: `AD-001` and `AD-002` (edge calls, `callPlan.ts`), `AD-003` (calls and responses),
  `AD-004` (changing step only changes what is visible). The one lesson that was written down as a
  rule, `L-014` (run the whole e2e suite for a change to navigation, layout or handles), is in
  `CLAUDE.md` too.
- `CLAUDE.md` itself is not touched by this record. The follow-up docs PR (`docs/fold-claude-md`)
  turns it into a one-line pointer to `AGENTS.md` and moves its content to `AGENTS.md`,
  `docs/architecture.md` (the invariants above) and `docs/testing.md` (`L-014`).

## Alternatives considered

| Option                                       | Why not                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Keep both workflows                          | Two homes for intent, two lessons ledgers, two instructions on how to start; the agent would pick whichever it read last                               |
| Keep tlc for specs, the factory for delivery | The factory's `spec-first` skill is the gate the sensors and the PR template expect (`specs/` in the PR body); tlc's specs would sit outside the audit |
| Migrate `.specs/` into `specs/`              | Rewrites history for no gain; the finished features are shipped and their specs are only read for background                                           |

## Consequences

- One way to start a change, and every gate (receipt, pre-push, CI, cold audit) applies to it.
- The old specs stay readable and are cited by the invariants ("Detail: `.specs/features/...`").
  Nothing checks them any more; if one drifts from the code, the code and the invariants win.
- Branches opened before this PR (for example `feat/component-technologies`) still edit `CLAUDE.md`
  and add files under `.specs/`. Merging them after the follow-up docs PR conflicts on
  `CLAUDE.md`: port their changes to `docs/architecture.md` (or to `AGENTS.md`) and keep their
  `.specs/` files as they are.
- The lessons recorded so far (`L-001` onward) are not loaded as guidance. Anything that still
  matters has to move to its owner (a test, a check, a rule) in a PR of its own.
