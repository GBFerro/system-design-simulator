# Model routing

Every piece of work runs on the cheapest model and effort that still hold its quality. The main
session orchestrates; subagents do the work, each pinned to the tier its role needs. The decision
and its reasons are in [0004-model-routing.md](decisions/0004-model-routing.md).

## Roles

**The main session is the orchestrator.** It decides, slices the work, dispatches subagents,
integrates what they return and owns the line's gates: `verify.sh`, commits, pushes, the PR, posting
the audit verdict, `pr-ready.sh`, the retro. It does not search the codebase, sweep files or write
production code and tests itself; it reads a file only when it needs that file to decide, usually
one a worker cited.

**Subagents do the work**, one role each. Independent work runs in parallel (several `explorer`
questions, slices that touch different files); work on the same files never does.

## Routing table

Each agent pins `model:` and `effort:` in its frontmatter (`.claude/agents/<name>.md`).
`scripts/check-harness.sh` fails when a row here and the frontmatter disagree, and the
`require-routed-subagent` sensor blocks any subagent outside this table and any per-call model or
effort override.

| Agent | Model | Effort | Use for |
|---|---|---|---|
| `explorer` | haiku | medium | Every search: where is X, how does Y flow, which files touch Z, what a test covers. Read-only |
| `mechanic` | haiku | high | Changes the caller can state exactly: renames, moves, boilerplate from an existing example, applying a decided pattern across files, updating references |
| `spec-writer` | opus | medium | Drafting a spec under the `spec-first` skill |
| `implementer` | sonnet | medium | A well-specified slice: acceptance criteria known, design settled |
| `implementer-deep` | sonnet | high | A hard slice (core domain logic, several modules), non-trivial debugging, or a slice `implementer` could not finish |
| `architect` | opus | high | Design decisions, large refactors, root causes `implementer-deep` could not find |
| `auditor` | sonnet | high | The cold audit of a PR head (`cold-audit` skill) |

Built-in agents that pin their own model (`claude-code-guide`, `statusline-setup`) are allowed.
Agents that inherit the main session's model (`general-purpose`, `Explore`, `Plan`, a fork) are not.

## Escalation

Start at the cheapest tier that fits and move up only on evidence: the worker reports it is blocked,
the checks still fail after its fix, or the audit fails on logic it wrote.

`implementer` → `implementer-deep` → `architect` → the user.

Each step is taken once per slice. Hand the next worker what the last one tried and what failed, not
just the task again.

## Worker contract

`mechanic`, `implementer`, `implementer-deep` and `architect` (when it edits) follow this:

1. Work only on what the caller handed you: the slice, its acceptance criteria, the files named.
   Anything outside it, or a decision the caller did not make, goes back as a question.
2. Test first: write the test for the criterion, watch it fail for the right reason, then make it
   pass. The `require-test-first` sensor blocks production edits without a test.
3. Edit files with Edit or Write only, never through the shell.
4. Run the fast checks on your change (`bash scripts/verify.sh lint format test`, or the subset the
   caller named) and fix what they report.
5. Never commit, push, open or change a PR, or edit the harness. Those belong to the orchestrator.
6. Report, in this order: files changed; tests added (file and name) and which criterion each
   proves; the checks you ran, with exit status; what you could not do and why. Write "blocked" on
   the first line when you could not finish.

## Calibrating

The `task-retro` skill records routing misses (a tier too weak that needed escalation, or one
stronger than the work needed) and, in each PR's `## Retro` comment, its `Gate:`, `Routing:` and
`Cost:` lines. To compare PRs of similar size, list them:

```bash
gh pr list --state all --limit 50 --json number,comments --jq '.[] | .number as $n
  | .comments[].body | select(startswith("## Retro")) | gsub("\r"; "")
  | "#\($n) " + ([split("\n")[] | select(test("^(Gate|Routing|Cost):"))] | join(" | "))'
```

Change a tier in a harness PR, on those numbers: the agent's frontmatter and its row here, together.
