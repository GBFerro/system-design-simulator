---
name: harness-review
description: Review a PR diff (or the current branch vs main) for continuous-improvement opportunities — code that could be better, guardrails that could be added, and harness pieces (CLAUDE.md/AGENTS.md rules, lint config, CI steps, PR template, hooks, skills) that should be added, updated or removed. Use when the user asks to review a PR "for improvements", "for guardrails", "for the harness", or runs /harness-review. Not a bug hunt — use /code-review for correctness.
argument-hint: "[PR number | branch | base..head] [--comment]"
allowed-tools: Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(git status:*), Bash(git rev-parse:*), Bash(git merge-base:*), Bash(gh pr view:*), Bash(gh pr diff:*), Read, Grep, Glob
---

# Harness review

Look at a diff and answer one question: **what should change so the next PR is easier to get right?** That covers the code itself, the mechanical guardrails around it, and the harness (the instructions and tooling agents and humans work within). If nothing relevant turns up, say it was checked and stop.

This skill only reports. It never edits files and never posts anywhere unless `--comment` was passed.

## 1. Resolve the target

Parse `$ARGUMENTS`:

| Argument                | Diff                                                      | Context                                                      |
| ----------------------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| PR number (`12`, `#12`) | `gh pr diff <n>`                                          | `gh pr view <n> --json title,body,files,commits,baseRefName` |
| branch name             | `git diff main...<branch>`                                | `git log --oneline main..<branch>`                           |
| `base..head`            | `git diff <base>...<head>`                                | `git log --oneline <base>..<head>`                           |
| nothing                 | `git diff main...HEAD` plus uncommitted (`git diff HEAD`) | `git log --oneline main..HEAD`, `git status --short`         |

Always start with the `--stat` form (or the PR's `files`) to size the change. For large diffs (> ~1500 changed lines), read the full diff for `src/engine`, `src/scoring`, `src/store`, `src/data`, and harness files, and skim the rest by file.

If the diff is empty, report that there is nothing to review and stop.

## 2. Load the current harness

Read these before judging anything — a suggestion to "add a rule" is wrong if the rule already exists:

- `CLAUDE.md`, `AGENTS.md`
- `.oxlintrc.json`, `.oxfmtrc.json`, `package.json` (scripts, deps), `tsconfig.json`
- `.github/workflows/*.yml`, `.github/PULL_REQUEST_TEMPLATE.md`
- `.claude/` (skills, `settings.json` hooks/permissions, if present), `.gitignore`

Then map each touched path to the `CLAUDE.md` section that governs it (e.g. `src/engine/**` → "Simulation engine", `src/scoring/**` → "Scoring", `src/store/**` → "Stores" + "Persistence schema", `src/data/**` → "Data conventions", `src/components/canvas/**` and `dialogs/**` → "Canvas/UI"). Read the current text of those sections; do not rely on memory of them.

## 3. Recurrence signal

For the main touched areas, run `git log --oneline -30 -- <paths>`. Fix commits that repeatedly hit the same invariant or file are the strongest evidence that prose isn't enough and a mechanical guardrail is due. Note them; cite them as evidence in findings.

## 4. Analyze through four lenses

Only raise a finding that is **tied to this diff**, **concrete** (names the file, the mechanism, and the change), and **worth its cost**. Generic advice ("add tests", "improve docs", "consider error handling") is not a finding.

### A. Code — what could be done better

Not bugs (that's `/code-review`). Look for:

- Logic duplicated from an existing helper in `src/lib`, `src/store`, or `src/engine` that should be reused.
- A pattern the diff introduces that contradicts how the surrounding code does the same thing.
- Shapes that make the next change harder: magic numbers that belong in `engine/constants.ts`, data inlined in components that belongs in `src/data`, a store action that bypasses the undo-history push, types widened to `unknown`/loose unions where a precise type would catch misuse.

### B. Guardrails — turn prose into enforcement

For each `CLAUDE.md` invariant the diff touched (or nearly broke), ask: is it enforced by anything other than someone reading `CLAUDE.md`? If not, and the diff shows it's at risk, propose the cheapest mechanism that would catch a violation:

1. **Type** — a stricter TS type, `satisfies`, a branded/literal union, `as const` tuple (zero runtime cost, caught by `npm run build`).
2. **Lint** — enabling an oxlint rule or category already available in `.oxlintrc.json`'s plugins; re-enabling a disabled rule if the diff shows it would have helped.
3. **Validation script in CI** — a small `node`/`tsx` script run in `ci.yml` (e.g. every scoring rule sums to exactly 20; every `componentId` in `problems.ts`/`conceptLibrary.ts`/`learningPath.ts` exists in `components.ts`; no reference solution reuses a `componentId`; learning-path prerequisites come from strictly earlier problems; all problems have `interviewData` entries).
4. **Runtime assertion / dev-only check** — only when the invariant depends on runtime state.
5. **Claude Code hook** (`.claude/settings.json`) — e.g. a PostToolUse hook running `oxfmt`/`oxlint` on edited files — only if the diff shows agents repeatedly shipping what a hook would have caught.

Prefer the lowest number that works. State what the mechanism would have caught in _this_ diff.

### C. Harness — what to add or update

- **Drift:** facts in `CLAUDE.md`/`AGENTS.md`/`README.md` the diff made false — counts (component specs, problems, tradeoff cards), file/module names in the architecture map, commands, stack versions, store names/fields. Verify by grepping/counting the real code before claiming drift.
- **Missing invariant:** the diff introduces a new non-obvious rule (a new store, a new persisted field, a new edge/node type, a new cross-file data reference) that future changes must respect and that is not written down anywhere.
- **PR template / CI:** a checklist item or CI step that would have prompted the author to verify what this diff needed verified.
- **Skill/command:** a workflow the diff shows being done by hand that a skill would standardize (only if it's clearly recurring).

### D. Harness — what to remove or simplify

- Rules in `CLAUDE.md`/`AGENTS.md` that reference code, files, or behavior this diff deleted.
- Prose rules now enforced mechanically (by this diff or already) — shorten to a pointer so instructions don't grow unbounded.
- Duplication between `CLAUDE.md` and `AGENTS.md` (or the PR template) that the diff shows drifting apart — keep one source, point to it from the other.
- Disabled lint rules, CI steps, or checklist items that no longer earn their keep.

## 5. Verify before reporting

For every candidate finding:

- Re-read the exact diff hunk and the harness text it concerns. Drop it if the harness already covers it.
- For drift claims, show the real value (e.g. `grep -c` / count) next to the documented one.
- For guardrail proposals, confirm the mechanism is available in this stack (oxlint rule exists in an enabled plugin, script can run under Node 20 with no new runtime deps).
- Drop anything you would rate "nice to have" with no evidence from the diff or from git history.

Keep at most ~7 findings, highest leverage first.

## 6. Report

Reply in the user's language.

**If nothing survived verification**, reply with just the confirmation, e.g.:

> ✅ Harness review: `<PR #n / branch / range>` — <N> files, <+a/−b> lines checked across code, guardrails, harness (add) and harness (remove). Nothing relevant to change.

**Otherwise**, one block per finding:

```
### <n>. <short title>   [code | guardrail | harness+ | harness−]  · priority: high|med|low
Evidence: <file:line in the diff, and/or commits from the recurrence check, and/or documented vs real value>
Proposal: <the concrete change — file to edit, rule to enable, script to add, text to delete>
Why: <what it would have caught or prevented in this diff; cost to adopt>
```

End with a one-line summary (`N findings: x guardrail, y harness+, …`) and offer to apply any of them. Do not apply without a yes.

### `--comment`

Only when `--comment` was passed and the target is a PR: after showing the report, post it as a single PR comment with `gh pr comment <n> --body-file <file>` (write the body to the session scratchpad, not the repo). If there are no findings, post the one-line confirmation instead. Never post without the flag.
