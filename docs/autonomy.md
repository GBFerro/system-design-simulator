# A narrow autonomous lane

The last step of the roadmap, and the only one that removes the human from the start of a task.
Do it late, for one lane at a time, and give the lane the same gates a person's work gets.

## Pick the lane

A good lane is:

- **repetitive:** the same kind of change every time (dependency and security updates, lockfile
  refreshes, generated-code regeneration);
- **verifiable:** the existing checks decide whether the result is right, with no judgment call;
- **small:** a bad result is cheap to revert.

Feature work is not a lane.

## Shape of the pipeline

Split it into jobs so the model never holds a credential that can write to the remote:

1. **Detect** (no model): a scheduled job checks whether there is work (for example, an audit
   command reports vulnerable packages). No work, no run.
2. **Fix** (the model):
   - a **read-only** token and a checkout that does not persist credentials;
   - a bounded run: max turns, a job timeout and an explicit list of allowed tools;
   - the prompt tells it to leave its changes in the working tree and write a PR body, and
     forbids commit, push and PR creation;
   - output: a patch file and the PR body as job artifacts;
   - log turns, duration, tokens and cost to the job summary.
3. **Publish** (no model): a later job gets the **write** token, applies the patch, commits on a
   lane branch and runs **the same gates** as a person's push (verify, secrets, commit message)
   before opening the PR.
4. **Merge** (no model): automatic only when a team member has approved and every required check
   is green. The merge script is read from the **default branch**, never from the branch under
   review, so a PR cannot rewrite the rules that merge it.

## Limits to set

- Max turns and a timeout per run.
- A **dollar cap** per run and per month, enforced, not just reported.
- One PR per run, and no new run while a lane PR is open.
- An owner who reads the job summaries and the lane's retro.

## When to stop the lane

Turn it off and go back to supervised work when a lane PR merges with a defect the gates should
have caught, or when the cost per merged PR keeps rising. Fix the gate first, then turn it back on.
