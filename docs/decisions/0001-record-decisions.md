# 0001. Record architecture decisions

**Status:** Accepted
**Date:** 2026-10-15
**Deciders:** GBFerro

## Context

Agents and new people both ask "why is it like this?". Without a record, the answer lives in
someone's memory or in an old chat, and the agent will guess, often by undoing the decision.

## Decision

We record decisions that are expensive to reverse, or that someone would plausibly undo by mistake,
as numbered files in `docs/decisions/`, copied from [_TEMPLATE.md](_TEMPLATE.md). Records are
append-only: a changed decision gets a new record that supersedes the old one, and the old one's
status says so.

Moving the factory to a different maturity level is always recorded here.

## Alternatives considered

| Option                       | Why not                                           |
| ---------------------------- | ------------------------------------------------- |
| Decisions in PR descriptions | Hard to find later; not loaded by anyone          |
| A single decisions document  | Grows without bound and invites rewriting history |

## Consequences

- Reviewers and the cold audit can check a change against the decisions it touches.
- Someone has to write the record when the decision is made, not after.
