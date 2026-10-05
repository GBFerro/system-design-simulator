# LESSONS - auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Specify/Design)

Corroborated across multiple features. Safe to apply as guidance.

_none_

## Candidates (under observation - do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-001 - Test request/response flow through an intermediate node that makes its own calls, not only through leaf targets.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `canvas-flow` · harmful: 0
- features: request-flow
- evidence: M6b src/lib/flowBalls.ts:428 (iteração 1) (canvas-flow)
- last seen: 2026-10-05T16:00:58Z

### L-002 - Test a fire-and-forget call on a node that has its own caller and assert the caller's response timing is unchanged.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `canvas-flow` · harmful: 0
- features: request-flow
- evidence: M6a src/lib/flowBalls.ts:557 (iteração 1) (canvas-flow)
- last seen: 2026-10-05T16:00:58Z

### L-003 - Assert the negative case of a conditional display rule (when it must not show), not only when it shows.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `ui` · harmful: 0
- features: request-flow
- evidence: N9/N10 src/components/canvas/edges/AnimatedEdge.tsx:88,93 (FLW-30) (ui)
- last seen: 2026-10-05T16:00:58Z

### L-004 - Test that a passed option changes the result; comparing the default with its explicit value proves nothing.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `engine` · harmful: 0
- features: request-flow
- evidence: N4 src/engine/core/trace.ts:127 (FLW-36) (engine)
- last seen: 2026-10-05T16:00:59Z

### L-005 - Give every case an acceptance criterion enumerates its own test assertion.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · harmful: 0
- features: request-flow
- evidence: N13 src/engine/core/sampler.ts:206 (FLW-35)
- last seen: 2026-10-05T16:00:59Z

### L-006 - Record a SPEC_DEVIATION when the design narrows an acceptance criterion instead of narrowing it silently.

- signal: `ac_gap` · recurrence: 1 feature(s) · harmful: 0
- features: request-flow
- evidence: FLW-05 src/lib/flowBalls.ts:396; design.md:162
- last seen: 2026-10-05T16:00:59Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
