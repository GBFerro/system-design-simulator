---
name: deliver
description: Deliver a change end to end on the factory line, from task branch to a ready PR and a retro. Use whenever the user asks to implement, fix or ship something in this repo. Stops before the merge, which is the human's.
---

# Deliver a change

The line, in order. Each step names the skill or command that owns it; read that skill from disk
when you reach it.

You are the orchestrator: you decide, dispatch and integrate, and you run the steps that carry a
gate (verify, commit, push, PR, audit verdict, ready, retro). Searches, specs, code and tests go to
the subagent `docs/model-routing.md` routes them to; read it from disk before the first dispatch.

## 1. Branch

- `git switch <trunk> && git pull --ff-only`, then `git switch -c <type>/<short-slug>`
  (`feat/`, `fix/`, `docs/`, `refactor/`, `chore/`, `test/`).
- Never work on a protected branch; the `block-protected-branch` sensor stops you if you try.

## 2. Intent

- Learn what the change touches through `explorer` (parallel questions when they are independent).
- If the change meets the `spec-first` trigger, the `spec-writer` agent drafts the spec; show it to
  the user and wait for their OK before any code.
- Otherwise restate the acceptance criteria in one short list and confirm them if anything is
  ambiguous.
- If the design is open (several modules, a large refactor), ask `architect` for the design and
  the slices before implementing.

## 3. Slice and dispatch

- Cut the work into slices, each with its acceptance criteria and the files it touches.
- Route each slice (`docs/model-routing.md`): `mechanic` for a change you can state exactly,
  `implementer` for a well-specified slice, `implementer-deep` for a hard one. Slices on different
  files go out in parallel; slices on the same files go one after another.
- Workers write the failing test first; the `require-test-first` sensor blocks production edits
  that have no test. If a file truly cannot have one, ask the user before adding an exemption (it
  is a harness change).

## 4. Integrate

- Read each worker's report. A "blocked" report or checks that still fail escalate the slice one
  step (`implementer` → `implementer-deep` → `architect` → the user), with what was tried.
- Keep the end-of-turn checks green (`verify-on-stop`); route the fix to a worker before handing
  back a turn.
- Edit tracked files with Edit or Write only.

## 5. Verify

Run the `verify-before-done` skill. Do not continue without a passed receipt for the current tree.

## 6. Commit and push

- Conventional Commits (`type(scope): summary`, at most 100 characters); one logical change per
  commit.
- `git push -u origin <branch>`. The pre-push gate refuses a commit tree without a passed receipt:
  if it does, run `bash scripts/verify.sh` again, do not look for a way around it.

## 7. Draft PR

- `gh pr create --draft`, body from `.github/PULL_REQUEST_TEMPLATE.md`. Every claim in the body
  must be one you can point to in the diff or the receipt.
- Fill `## Verification` with the receipt's status and tree.

## 8. Cold audit

- Launch the `auditor` subagent in a fresh context with: the PR number, the base branch, the head
  SHA, and the spec path if any. Never audit in your own context: you wrote the change.
- Post the verdict it returns as a PR comment (`gh pr comment <n> --body-file <file>`).

## 9. Fix and re-audit

- For each finding: fix the code, the test or the PR body (a false claim is fixed by correcting
  the claim or the code, never by deleting the evidence). Code and test fixes go to a worker; a
  finding on logic a worker wrote escalates it one step.
- Verify again, push, and audit the **new head**. A verdict covers only the head it names.
- A rebase with no patch change can use the light path in `cold-audit` (`git range-diff`).

## 10. Ready

- `bash scripts/pr-ready.sh`. It refuses unless the PR is a draft, a passed receipt certifies the
  head's tree, checks are green on the head, and the latest cold audit comment for that head reads
  `## Cold audit` / `Verdict: PASS` / `Head: <head sha>` on its first three lines. Fix what it
  reports and run it again.

## 11. Retro and stop

- Run the `task-retro` skill and post it on the PR.
- Tell the user the PR is ready, with its link. **Stop. The human merges.**
