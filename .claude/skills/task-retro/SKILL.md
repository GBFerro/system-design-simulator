---
name: task-retro
description: Run a short retrospective after a PR is ready, turning wasted work into a fix in the right owner. Use right after scripts/pr-ready.sh passes, or when the user asks for a retro.
---

# Task retro

The factory improves one edit at a time. A retro finds where this task wasted effort and names who
should change so it does not happen again.

## Steps

1. **Walk the session.** Go through the work in order (tool calls, sensor blocks, failed checks,
   audit findings, re-audits) and classify each stretch:
   - **Productive:** moved the change forward.
   - **Necessary caution:** checks and reads that were worth doing even though they found nothing.
   - **Avoidable rework:** work redone because of something that could have been known.
2. **Label each avoidable rework** with its cause:
   - **Recall miss:** the rule already existed and was not followed. Name the rule and where it
     lives.
   - **New gotcha:** nothing documented it.
   - **Environment or harness:** a tool, sensor or check misbehaved or was missing.
   - **Routing:** the work went to the wrong tier (`docs/model-routing.md`): too weak, so it
     escalated or came back wrong, or stronger than the work needed. Name the agent and the work.
3. **Name the owner of the fix** using the guidance ladder in `docs/harness.md`: the most enforced
   place that can hold it (sensor or check, then CI, then a path-scoped rule, then a doc, then
   AGENTS.md). For a recall miss, ask why the existing rule did not fire before adding another.
4. **Numbers come from the transcript or not at all.** Count cycles, retries, audit rounds and
   subagent dispatches you can see. If you did not count something, write "unknown", never an
   estimate.
5. **Ask the user for the session cost.** You cannot see it: ask them to run `/cost` and paste
   the output. Record the total and, when it shows them, the tokens per model. No answer means
   "unknown".
6. **Look for repeats.** The `## Retro` comments are the factory's only record of lessons and
   cost. Read the earlier ones and note, for each avoidable rework, the PRs where the same cause
   and owner already showed up:

   ```bash
   gh pr list --state all --limit 100 --json number,comments --jq '.[] | .number as $n
     | .comments[].body | select(startswith("## Retro")) | "#\($n)\n\(.)\n"'
   ```

7. **Post** a PR comment that starts with `## Retro`:

   ```text
   ## Retro
   Rounds: <verify runs>, <audit rounds>, <sensor blocks> (or unknown)
   Gate: on (off for a baseline run without the model routing)
   Routing: <dispatches per agent, e.g. explorer 4, implementer 2>; escalations <n>
   Cost: <total from /cost>, <tokens per model> (or unknown)

   | What happened | Class | Cause | Owner of the fix | Seen before |
   |---|---|---|---|---|

   Proposed harness changes:
   - <change>, owner <path>
   ```

   `Seen before` lists the earlier PRs (`#12, #19`) or says `no`. Nothing from the retro is written
   to the branch: the head the audit passed stays the head.

8. **Codify on repeat.** When the same correction shows up a second time, codify it in exactly one
   owner and remove any other copy. Two homes for one rule drift apart.
9. Each proposed harness change becomes **its own PR**, never part of the product PR. Ask the user
   before opening it.
