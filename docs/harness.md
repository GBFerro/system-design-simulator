# How the harness works

The harness is everything around the agent that decides whether its work is good enough: hooks,
scripts, gates, skills and docs. This page maps it and says where new guidance goes.

## Layers

| Layer             | Question it answers                            | Files in this repo                                                                        |
| ----------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Intent            | What should be true when we are done?          | `specs/`, `.github/PULL_REQUEST_TEMPLATE.md`                                              |
| Orchestration     | Who does which step, on which model?           | `.claude/skills/deliver/`, `.claude/agents/`, [model-routing.md](model-routing.md)        |
| Execution harness | What does the agent know while it works?       | `AGENTS.md`, `CLAUDE.md`, `.claude/skills/`, `.claude/rules/` (when you add one)          |
| Guardrails        | What can never happen?                         | `.claude/settings.json` (deny rules), `sensors/block-*.sh`                                |
| Sensors           | What does the agent learn right after it acts? | `sensors/`, `scripts/verify.sh`                                                           |
| Gates             | What must pass before work moves on?           | `lefthook.yml`, `.lefthook/pre-push/gate.sh`, `.github/workflows/`, `scripts/pr-ready.sh` |
| Validation        | Does someone other than the author agree?      | `.claude/skills/cold-audit/`, `.claude/agents/auditor.md`                                 |
| Knowledge         | Where do rules and decisions live?             | `docs/`, `AGENTS.md`, `FACTORY.md`                                                        |
| Learning          | How does the factory get better?               | `.claude/skills/task-retro/`, the `## Retro` comment on each PR                           |

## The feedback loop

The same signal arrives at several moments, from the fastest and narrowest to the slowest and
widest. The later a problem is caught, the more it costs.

| Moment                          | Signal                                                                                                                                  | Time to signal     |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Before a tool call (PreToolUse) | `block-*`, `require-test-first`, `require-routed-subagent`                                                                              | milliseconds       |
| End of a turn (Stop)            | `verify-on-stop`: the fast checks in `FACTORY_STOP_CHECKS`, whenever the working tree is dirty (uncommitted changes, whoever made them) | seconds            |
| Commit                          | pre-commit: `verify.sh lint format` (no receipt); commit-msg: `check-commit-msg`                                                        | seconds            |
| Push                            | pre-push gate: protected branch (push or deletion), secrets, receipt for the pushed tip's tree                                          | seconds            |
| PR                              | CI: harness, full verify, secrets, PR body policy                                                                                       | minutes            |
| Draft to ready                  | cold audit by a fresh subagent, then `pr-ready.sh`                                                                                      | minutes            |
| Merge                           | the human                                                                                                                               | whenever they look |

Gates repeat earlier checks on purpose: a turn can be interrupted, a human can commit by hand, and
a hook can be uninstalled. Only the last two depend on judgment; everything before them is code.

## Verify receipts

`bash scripts/verify.sh` (no arguments) runs every check in `FACTORY_CHECKS` and writes
`.factory/receipt.json`. Besides the built-in `harness`, `lint`, `format`, `typecheck` and `test`,
a check name reads its command from `FACTORY_CHECK_<NAME>` in `factory.config.sh` (`api-test` →
`FACTORY_CHECK_API_TEST`), so a monorepo can have one check per part.

- `tree` is the hash of the working state as it would be committed: tracked and untracked files,
  minus ignored ones and minus `.factory/` itself, computed with a throwaway index. A commit made from exactly that state has
  the same tree (`git rev-parse <commit>^{tree}`).
- `status` is `passed` (every configured check passed and nothing changed during the run),
  `failed` (a check failed) or `stale` (the tree changed while checks ran).
- Checks set to `none` are recorded as `not-configured`, so a receipt never hides what did not run.
- A run with arguments (`verify.sh lint test`) checks a subset and writes **no** receipt.

`scripts/receipt-check.sh` and the pre-push gate compare the receipt's tree to the tree being
claimed (the working tree, or the pushed tip's tree; intermediate commits are not re-verified).
Any edit after verify means verify again.

## Stack kits

The commands in `factory.config.sh` need tool configuration to mean something (a linter's rules, a
pinned formatter). The template's `stacks/` folder holds that per stack (see its `stacks/README.md`);
the bootstrap copies the chosen stack's kit to the project root, so a generated project has the kit
files but not the folder.

## Permissions and where to open a session

The `ask` rules in `.claude/settings.json` (`Edit(/sensors/**)` and the like) resolve `/` against
the session's primary working directory, not the settings file. Open Claude Code sessions at the
repo root, or those rules guard the wrong paths. The deny rules and sensors use
`$CLAUDE_PROJECT_DIR` and do not depend on it.

## Where new guidance goes

When a retro or a review produces a rule, put it in the **most enforced** place that can hold it:

1. **A sensor or a script check** (`sensors/`, `scripts/check-harness.sh`, a test). It cannot be
   forgotten.
2. **A CI check** in `.github/workflows/`, when it needs the whole diff or the remote.
3. **A path-scoped rule** in `.claude/rules/<topic>.md` with `paths:` frontmatter, so it loads
   only when matching files are touched.
4. **A doc in `docs/`**, linked from AGENTS.md, for procedures and background.
5. **AGENTS.md itself**, only for what every session needs. It has a line cap; context is a cost.

Two more rules decide the edge cases:

- **One owner per rule.** When you move a rule up the ladder, delete the old copy. Two homes drift.
- **Rule and code never contradict.** If they do, that is a finding to raise, not something to
  resolve silently by picking one.

`scripts/check-harness.sh` checks what a machine can (sensor wiring, links, placeholders, line
caps). It does not read prose; keeping prose true is the retro's job.
