---
name: verify-before-done
description: Prove a change works before calling it done, committing it, pushing it or claiming anything passes. Use before every "done", "fixed", "passes" or "ready" claim and before every push.
---

# Verify before done

"Done" is a claim. This skill turns it into evidence or into an honest "not verified".

## Steps

1. Run the full gate with no arguments: `bash scripts/verify.sh`. A run with arguments checks a
   subset and writes no receipt; it never certifies anything.
2. Confirm the receipt covers the tree you are claiming about: `bash scripts/receipt-check.sh`.
   Only `"status": "passed"` for the current tree counts. `failed`, `stale`, a missing receipt or
   another tree all mean **not verified**.
3. If anything failed, fix the cause and run the full gate again. If files changed while it ran
   (`stale`), run it again on a still tree.
4. Map each acceptance criterion to its evidence: the test that proves it (file and name) and the
   check that ran it. A criterion without evidence is reported as a gap, not glossed over.
5. Report:
   - what ran, with each check's status from the receipt;
   - what was **not configured** or skipped, and why;
   - the receipt's status and tree;
   - anything you could not verify, plainly.

## Never

- Edit a check command, `factory.config.sh`, a sensor, a test baseline or a snapshot to make the
  receipt pass. If a check is wrong, say so and propose a separate harness PR.
- Claim "passes" from a subset run, an old receipt, CI on another head, or from reading the code.
- Delete or skip a failing test to get green. A test that is wrong gets fixed, with the reason in
  the PR body.
