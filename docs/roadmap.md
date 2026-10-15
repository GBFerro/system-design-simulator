# Adoption roadmap

The order to adopt the factory in, whether you start from this template or build it piece by piece.
Each step leans on the ones before it. Steps 1 to 6 build the floor (nothing passes unmeasured),
7 to 9 fix intent and the remote gate, 10 to 13 close the quality and learning loop, and 14 is
optional.

Levels refer to the scale in [FACTORY.md](../FACTORY.md).

## 1. Green baseline (level 1)

- **Goal:** lint, format check, typecheck and tests run with one command each and pass.
- **Do:** pick the tools, make lint fail on warnings, pin tool versions, fix until green. Fill the
  commands in `factory.config.sh` (the bootstrap does this from a preset).
- **Check:** `bash scripts/verify.sh` exits 0 on a clean clone.

## 2. AGENTS.md (level 1)

- **Goal:** the agent has a short map: commands, conventions that differ from the norm, where
  things live.
- **Do:** start near 40 lines; grow only with what a retro proves necessary. Keep the cap in
  `FACTORY_AGENTS_MAX_LINES`.
- **Check:** `bash scripts/check-harness.sh` passes the line cap.

## 3. Git guardrails (level 2)

- **Goal:** the agent cannot touch the trunk or skip hooks.
- **Do:** keep the deny rules in `.claude/settings.json` and the `block-protected-branch` and
  `block-hook-bypass` sensors. Deny rules match text; sensors cover the variations.
- **Check:** in a session on the trunk, ask for `git commit -m x` and `git commit --no-verify -m x`.
  Both must be blocked with the sensor's message.

## 4. Sensors (level 2)

- **Goal:** every control is a tested script with a clear message.
- **Do:** follow [sensors/README.md](../sensors/README.md). Start with the shipped ones; add one per
  incident.
- **Check:** `bash sensors/test.sh` passes; break a sensor on purpose and watch its test go red.

## 5. Verify receipt (level 2)

- **Goal:** "it passes" is a receipt for a tree, not a sentence.
- **Do:** run `bash scripts/verify.sh`; claim results only from `.factory/receipt.json`.
- **Check:** after verify passes, edit a tracked file: `bash scripts/receipt-check.sh` must now
  fail.

## 6. Git hooks (level 2)

- **Goal:** the same gates catch humans and interrupted sessions.
- **Do:** `lefthook install` in the main checkout. pre-commit runs the quick subset
  (`verify.sh lint format`, no receipt); commit-msg checks the subject; the pre-push gate checks
  protected branches (push or deletion), secrets and the receipt for the pushed tip.
- **Check:** a commit with subject `stuff` is refused; a push without a passed receipt for its
  commit's tree is refused.

## 7. Spec first (level 2)

- **Goal:** acceptance criteria exist before the solution.
- **Do:** use [specs/README.md](../specs/README.md) and the `spec-first` skill for changes over the
  trigger.
- **Check:** the next large change starts with a spec whose criteria are observable from outside.

## 8. Test first (level 2)

- **Goal:** no production code without a test.
- **Do:** set `FACTORY_SOURCE_GLOBS`, `FACTORY_TEST_GLOBS` and `FACTORY_TEST_CANDIDATES`; keep
  exemptions few, each with a reason.
- **Check:** ask the agent to edit a production file that has no test: it is blocked.

## 9. CI (level 2)

- **Goal:** the gates run where nobody can skip them.
- **Do:** add the toolchain setup to the workflow in `.github/workflows/`; enable branch
  protection with the CI jobs as required checks on your git host.
- **Check:** a PR without `## Verification` in its body fails the policy job; a red test fails the
  verify job.

## 10. Cold audit (level 3)

- **Goal:** someone other than the author checks every claim.
- **Do:** run the `auditor` subagent on each draft PR head; post the verdict; use
  `scripts/pr-ready.sh` to go ready.
- **Check:** after a new push, `pr-ready.sh` refuses until a verdict names the new head.

## 11. Skills (level 3)

- **Goal:** the procedures (deliver, verify, audit, retro) are repeatable.
- **Do:** keep one `SKILL.md` per procedure; change them by harness PR.
- **Check:** `bash scripts/check-harness.sh` passes (every skill has `name` and `description`).

## 12. Drift check (level 3)

- **Goal:** what a machine can check cannot drift.
- **Do:** run `check-harness.sh` in verify and CI; add a section when two things can disagree
  without anything failing.
- **Check:** unwire a sensor from `.claude/settings.json`: `check-harness.sh` fails.

## 13. Retro (level 3)

- **Goal:** every mistake becomes an edit in the right owner.
- **Do:** the `task-retro` skill after each ready PR; lessons in its `## Retro` comment; harness
  fixes as their own PRs.
- **Check:** each retro names a cause and an owner, and repeated lessons end up in one place.

## 14. A narrow autonomous lane (level 4 for that lane)

- **Goal:** one deterministic, verifiable kind of work runs without a human starting it.
- **Do:** follow [autonomy.md](autonomy.md). Only after steps 3, 5, 6, 9 and 10 are solid.
- **Check:** the agent job has no write credentials; the PR is opened by a later job and passes the
  same gates as a person's.
