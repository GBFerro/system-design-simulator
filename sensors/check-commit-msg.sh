#!/usr/bin/env bash
# git commit-msg hook: Conventional Commits subject, at most 100 characters.
# Usage (from lefthook): bash sensors/check-commit-msg.sh <message-file>
set -u

file="${1:?usage: check-commit-msg.sh <message-file>}"
subject="$(grep -v '^#' "$file" | sed -n '/[^[:space:]]/{p;q;}' | tr -d '\r')"

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
