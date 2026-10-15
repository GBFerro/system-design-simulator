# 0004. Route subagents by model and effort

**Status:** Accepted
**Date:** 2026-10-15
**Deciders:** GBFerro

## Context

Every subagent without a pinned model inherits the main session's, usually the most capable and
most expensive one, for work as plain as a file search. Most tokens go to reading code, which a
small model does well, while a few steps (design, specs, audits) are where a strong model earns
its cost. Anthropic's guidance at the time: Haiku for sub-agent and search work, Sonnet at
`medium` for well-specified coding and `high` for hard coding, Opus for complex systems
engineering and large refactors. Haiku cost about 1/20 of Sonnet per token, and Opus about 2x
Sonnet.

## Decision

- The main session orchestrates and runs the line's gates; subagents do the searching and writing.
- Each role is an agent in `.claude/agents/` with `model:` and `effort:` pinned in its frontmatter,
  routed by the table in [model-routing.md](../model-routing.md).
- `sensors/require-routed-subagent.sh` blocks subagents outside that roster and per-call model or
  effort overrides; `scripts/check-harness.sh` fails when the table and the frontmatter disagree.
- Escalation is one step at a time on evidence: `implementer` → `implementer-deep` → `architect`.

## Alternatives considered

| Option                                          | Why not                                                                                                  |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Guidance only, no sensor                        | The default subagent inherits the main model silently; nothing would show the routing was skipped        |
| One implementer with a per-call effort override | The override is invisible in review and lets any call pick its tier; a named agent per tier is auditable |
| `CLAUDE_CODE_SUBAGENT_MODEL` for every subagent | One model for every role: too weak for specs and audits, or too strong for searches                      |

## Consequences

- Searches and mechanical edits cost a fraction of what they did; specs and design keep Opus, and
  the cold audit runs on Sonnet at `high`, never the cheapest tier.
- A new kind of work needs a new agent or a new row in a harness PR before it can be dispatched.
- The tiers are a starting point: retros record routing misses, and a tier changes in a harness PR.
