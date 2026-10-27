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
- evidence: N4 src/engine/core/trace.ts:127 (FLW-36) (engine) (+1 more)
- last seen: 2026-10-05T17:13:03Z

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

### L-007 - Test that a value reaches the screen through every layer that forwards it, not only the function that computes it.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `ui` · harmful: 0
- features: request-flow
- evidence: X9 src/components/layout/app-shell.tsx:171 (FLW-05, iteração 3) (ui) (+1 more)
- last seen: 2026-10-05T17:13:01Z

### L-008 - Assert both sides of a numeric threshold the spec names, just below and just above it.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `ui` · harmful: 0
- features: request-flow
- evidence: X10 src/components/panel/FlowPanel.tsx:20 (FLW-36, iteração 3) (ui)
- last seen: 2026-10-05T17:13:02Z

### L-009 - State the base and direction of a relative change threshold in the acceptance criterion.

- signal: `spec_precision_gap` · recurrence: 1 feature(s) · harmful: 0
- features: request-flow
- evidence: FLW-36 src/components/panel/FlowPanel.tsx:49 (iteração 3)
- last seen: 2026-10-05T17:13:03Z

### L-010 - Test a time-varying model read at a chosen moment with a case where an earlier moment gives a different result.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `engine` · harmful: 0
- features: request-flow
- evidence: Y13 src/engine/core/trace.ts:155 (FLW-36, rodada 4) (engine)
- last seen: 2026-10-05T22:49:19Z

### L-011 - State in the acceptance criterion which moment of a time-varying fault a derived view reflects.

- signal: `spec_precision_gap` · recurrence: 1 feature(s) · harmful: 0
- features: request-flow
- evidence: FLW-36 src/engine/core/trace.ts:151,155 (rodada 4)
- last seen: 2026-10-05T22:49:20Z

### L-012 - Freeze live inputs before asserting that an event triggers a recompute, so noise cannot trigger it instead.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `ui` · harmful: 0
- features: request-flow
- evidence: Y8 src/components/panel/FlowPanel.tsx:61; tests/e2e/flow.spec.ts:335 (FLW-36, rodada 4) (ui)
- last seen: 2026-10-05T22:49:20Z

### L-013 - When a criterion states a geometric or visual property (lines that do not overlap), assert it on the rendered geometry or say in the spec that it is checked by eye.

- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `canvas` · harmful: 0
- features: guided-ui
- evidence: RET-04 (canvas)
- last seen: 2026-10-09T20:50:26Z

### L-014 - After a change to navigation or layout, run the whole e2e suite before committing: a spec that reaches its screen by a removed control only fails far from the change.

- signal: `gate_fail` · recurrence: 1 feature(s) · scope: `e2e` · harmful: 0
- features: guided-ui
- evidence: tests/e2e/drill.spec.ts (e2e)
- last seen: 2026-10-09T20:50:26Z

### L-015 - Test a formula at parameter values where its plausible variants diverge (even and odd counts, the range bounds), not only at the default configuration.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `engine` · harmful: 0
- features: component-technologies
- evidence: validation.md M3b (profile.ts:174, TEC-29) (engine)
- last seen: 2026-10-14T16:15:41Z

### L-016 - Give every case an acceptance criterion enumerates its own test assertion.

- signal: `ac_gap` · recurrence: 1 feature(s) · harmful: 0
- features: component-technologies
- evidence: TEC-07 (TechnologyPicker.tsx:106, class select disabled untested)
- last seen: 2026-10-14T16:15:42Z

### L-017 - State in the acceptance criterion whether the neutral default option counts as a distinct value in a comparison rule.

- signal: `spec_precision_gap` · recurrence: 1 feature(s) · harmful: 0
- features: component-technologies
- evidence: TEC-45 (compile.ts:147 warns only when both technologies are non-generic)
- last seen: 2026-10-14T16:15:43Z

### L-018 - When an acceptance criterion names a rate limit with a burst, state the expected absorb time and its tolerance.

- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `engine` · harmful: 0
- features: component-technologies
- evidence: TEC-38 (tech.ts:127-130 burst absorbs 0.9 s, not 1.0 s) (engine)
- last seen: 2026-10-14T16:15:44Z

### L-019 - Amend design.md when the implementation records a SPEC_DEVIATION against it, so the design stays the source of truth.

- signal: `spec_deviation` · recurrence: 1 feature(s) · scope: `design` · harmful: 0
- features: component-technologies
- evidence: SPEC_DEVIATION profile.ts:68,135; analyze.ts:212; tick.ts:271,464 (design)
- last seen: 2026-10-14T16:15:44Z

### L-020 - When an acceptance criterion requires a condition on both sides of a relation, test the negative case for each side, not only one.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `engine` · harmful: 0
- features: component-technologies
- evidence: validation.md round 2 W2 (compile.ts:147, TEC-45) (engine)
- last seen: 2026-10-14T16:42:08Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
