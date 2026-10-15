# Sensors

Small bash scripts that watch the agent (Claude Code hooks) and git (lefthook hooks), and stop
mistakes at the cheapest moment.

## Contract

Claude Code hooks (`.claude/settings.json`):

- The event payload arrives as **JSON on stdin** (`tool_input.command`, `tool_input.file_path`,
  `stop_hook_active`, `cwd`).
- **Exit 0** allows. **Exit 2** blocks, and stderr goes back to the agent as the reason. Any other
  exit is a non-blocking error.
- **Fail soft, but visibly, when it cannot decide.** No JSON parser or an unreadable payload: the
  sensor exits 1, a non-blocking error Claude Code shows, so the action goes ahead but nobody
  believes a guard is on while it is off (stderr on exit 0 is never shown). A broken sensor must
  never brick the session; `test.sh` is what proves a sensor still works, and `scripts/doctor.sh`
  catches a missing parser up front.

Git hooks (`lefthook.yml`) follow git's contract: non-zero exit refuses the commit or push.

Shared code lives in `_lib.sh` (payload parsing with jq, node or python, whichever runs) and
`../scripts/lib.sh` (config, tree hash).

## Sensors

| Sensor                            | Event                             | Why                                                                                                                                                                                                                                          |
| --------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `block-protected-branch.sh`       | PreToolUse Bash                   | The trunk changes only through a PR a human merges: no commit, merge, rebase, `reset --hard` or push there                                                                                                                                   |
| `block-hook-bypass.sh`            | PreToolUse Bash                   | Skipping hooks (`--no-verify`, `-n`, `LEFTHOOK=0`, `core.hooksPath`) only moves a failure to where it costs more                                                                                                                             |
| `block-shell-write-to-tracked.sh` | PreToolUse Bash                   | Shell writes to the repo's files (tracked, or new and not ignored) skip edit hooks and cannot be rewound; use Edit or Write. Ignored paths and paths outside the repo pass                                                                   |
| `require-test-first.sh`           | PreToolUse Edit, Write, MultiEdit | Production code changes only when its test exists; exemptions need a reason in `test-first-exempt.txt`                                                                                                                                       |
| `require-routed-subagent.sh`      | PreToolUse Agent                  | A subagent runs on the tier its role is routed to: only agents in `.claude/agents/` (and built-ins that pin their own model) pass, and per-call model or effort overrides are blocked. See [docs/model-routing.md](../docs/model-routing.md) |
| `verify-on-stop.sh`               | Stop                              | The fast checks (`FACTORY_STOP_CHECKS`) run whenever the working tree is dirty when a turn ends                                                                                                                                              |
| `check-commit-msg.sh`             | git commit-msg                    | Conventional Commits subject, at most 100 characters; only git's own `Merge branch/tag/pull request ...`, `Revert "`, `fixup!`, `squash!`, `amend!` subjects are exempt                                                                      |

## Adding a sensor

Add one **per incident**, not in anticipation: each sensor should point to a mistake that
happened. Then:

1. **Write the script** in `sensors/<name>.sh`, sourcing `_lib.sh`. Keep the decision simple and
   the message useful: say what was blocked, why, and **the legitimate way out** (what to do
   instead). A block without a way out teaches the agent to look for a workaround.
2. **Test both directions** in `sensors/test.sh`: inputs it must block and close cases it must
   allow. A sensor tested only for blocking will end up blocking legitimate work.
3. **Wire it** in `.claude/settings.json` (event and matcher) or `lefthook.yml`.
   `scripts/check-harness.sh` fails when a sensor in this folder is not wired anywhere.
4. Ship it in a **harness-only PR**.

Prefer blocking to warning for anything that fails silently; a warning the agent can scroll past
is a warning nobody reads.
