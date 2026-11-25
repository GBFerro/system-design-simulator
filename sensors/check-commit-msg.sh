#!/usr/bin/env bash
# git commit-msg hook: Conventional Commits subject, at most 100 characters, and no AI attribution
# (AGENTS.md: commit messages carry no Claude/AI attribution or co-author trailers).
# Usage (from lefthook): bash sensors/check-commit-msg.sh <message-file>
set -u

file="${1:?usage: check-commit-msg.sh <message-file>}"
body="$(grep -v '^#' "$file" | tr -d '\r')"
subject="$(printf '%s\n' "$body" | sed -n '/[^[:space:]]/{p;q;}')"

# AI attribution, checked before any exemption: a merge or fixup message may not carry it either.
# Both patterns are anchored at the line start (after spaces or an emoji), so a human co-author
# and a subject that only talks about the rule both pass.
ai='(claude|anthropic|copilot|chatgpt|openai|gemini)'
if printf '%s\n' "$body" | grep -Eiq "^[^a-z0-9]*(co-authored-by:|generated (with|by) ).*$ai"; then
  {
    echo "commit-msg: remove the AI attribution line from the message."
    echo "  AGENTS.md: commit messages carry no Claude/AI attribution or co-author trailers."
  } >&2
  exit 1
fi

# Subjects git (or a forge) writes itself. Only those: "Merge whatever I want" is not exempt.
case "$subject" in
  "Revert \""* | "fixup! "* | "squash! "* | "amend! "*) exit 0 ;;
esac
if printf '%s' "$subject" | grep -Eq '^Merge (branch|branches|remote-tracking branch|tag|pull request|commit) '; then
  exit 0
fi

types='feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert'
if ! printf '%s' "$subject" | grep -Eq "^($types)(\([a-z0-9._/-]+\))?!?: [^[:space:]].*"; then
  {
    echo "commit-msg: the subject must follow Conventional Commits:"
    echo "  <type>(<optional scope>): <summary>    types: ${types//|/, }"
    echo "  got: $subject"
  } >&2
  exit 1
fi
if [ "${#subject}" -gt 100 ]; then
  echo "commit-msg: the subject has ${#subject} characters; keep it at 100 or fewer." >&2
  exit 1
fi
