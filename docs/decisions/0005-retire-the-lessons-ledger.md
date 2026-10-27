# 0005. Retire the lessons ledger

**Status:** Accepted
**Date:** 2026-10-15
**Deciders:** GBFerro

## Context

`docs/lessons.md` was the history of retro lessons; the rule itself always moved to its owner (a
sensor, a check, a rule or a doc). The retro runs after `scripts/pr-ready.sh`, so writing the
ledger changed the PR head after the cold audit had passed it: either the entry went in unaudited,
or the line paid for another verify and audit to record history. The retro already posts every
lesson, with its cause and owner, in a `## Retro` PR comment, and that comment now carries the
routing and cost numbers too ([0004](0004-model-routing.md)).

## Decision

- `docs/lessons.md` is removed. The `## Retro` comment on each PR is the only record of lessons and
  cost.
- The `task-retro` skill reads the earlier `## Retro` comments (`gh pr list ... --json comments`)
  to find repeats, and marks each lesson's `Seen before` with the PRs where it showed up.
- Nothing from the retro is committed to the branch; the head the audit passed stays the head.

## Alternatives considered

| Option                                                                  | Why not                                                                                     |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Keep the ledger, written after `pr-ready.sh`                            | Changes the audited head, or records history nobody audited                                 |
| Keep the ledger, with `pr-ready.sh` accepting a later retro-only commit | A gate exception to store history the PR comment already holds                              |
| The PR description                                                      | The auditor treats the body as claims; data added after the audit mixes with checked claims |

## Consequences

- The retro needs the GitHub remote to read and post comments; a repository without one has no
  lessons record until it gets one.
- Finding repeats is a search over PR comments instead of one file.
- Lessons that should outlive a PR still go to their owner, as before; this only moves the history.
