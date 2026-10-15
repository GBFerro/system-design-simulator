# system-design-simulator factory manifesto

The contract the team agrees to before giving the agent autonomy. Change it by PR, never in
passing.

## Target level

**Level 2** on this teaching scale (it is a way to talk about autonomy, not an
industry standard):

| Level | Name                    | What it means                                                                              |
| ----- | ----------------------- | ------------------------------------------------------------------------------------------ |
| 0     | Manual                  | Humans write all the code                                                                  |
| 1     | Assisted                | The agent suggests; humans write and decide                                                |
| 2     | Agent with human review | The agent opens PRs; humans review every line                                              |
| 3     | Agent with gates        | Automatic gates and a cold audit judge the work; humans sample it and authorize each merge |
| 4     | Lights-out              | Humans write specs and acceptance scenarios; everything else is automatic                  |

## What the agent may do without asking

- Create a task branch, commit to it and push it.
- Open a draft PR from the template.
- Run the cold audit in a fresh subagent and post the verdict on the PR.
- Mark the PR ready, only after `bash scripts/pr-ready.sh` passes.
- Run the retro and propose harness changes, each as its own PR.

## What the agent never does

- Commit, push, merge or `reset --hard` on a protected branch (main).
- Skip git hooks (`--no-verify`, `LEFTHOOK=0`, `core.hooksPath` and the like).
- Write tracked files through the shell instead of Edit or Write.
- Merge a PR. **The merge is the human's, authorized per PR.**
- Change harness files (`sensors/`, `scripts/`, `.claude/`, `lefthook.yml`, `.lefthook/`,
  `factory.config.sh`, `.github/`) in the same PR as a product change.
- Edit the check list, a sensor, a test baseline or the config to make a receipt pass.

## Who decides what

| Decision                                  | Who                                              |
| ----------------------------------------- | ------------------------------------------------ |
| Intent and acceptance criteria (`specs/`) | Human                                            |
| Code, tests and the PR body               | Agent                                            |
| PR audit                                  | A fresh subagent that did not write the change   |
| Merge                                     | Human, per PR                                    |
| Harness changes                           | A harness-only PR, approved by GBFerro           |
| Moving up a level                         | GBFerro, recorded as an ADR in `docs/decisions/` |

## Criteria to move up a level

Fill in numbers that fit your project. The ones below are suggestions, not measured facts:

- **A check from advice to block:** it ran as advice for 4 weeks with false positives under 5%.
- **From human line review to cold audit:** 10 PRs in a row where the audit found everything the
  human review found.
- **From assisted to delegated tasks:** 3 PRs in a row without avoidable rework that an existing
  rule already covered.
- **To level 4 for a lane:** the lane is deterministic, its checks are complete, and it has run
  supervised for a month without a bad merge (see `docs/autonomy.md`).

## Accepted gaps

List the gaps this factory accepts and when to look at them again. The template ships without:

| Gap                           | Why accepted                                     | Review by  |
| ----------------------------- | ------------------------------------------------ | ---------- |
| Holdout acceptance scenarios  |                                                  | YYYY-MM-DD |
| Sandboxed execution           |                                                  | YYYY-MM-DD |
| Dollar cost cap               |                                                  | YYYY-MM-DD |
| Server-side branch protection | Enable it on the host; delete this row once done | YYYY-MM-DD |
