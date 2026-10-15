#!/usr/bin/env bash
# The only way a draft PR becomes ready for the human merge. Refuses unless, for the CURRENT head:
#  1. the PR is an open draft and the local checkout is that head with a clean tree,
#  2. a passed receipt certifies the head's tree (scripts/verify.sh),
#  3. every CI check reported on the head passed,
#  4. the latest cold audit comment for this head passed. The contract (CR stripped):
#       line 1  ## Cold audit
#       line 2  Verdict: PASS        (or Verdict: FAIL)
#       line 3  Head: <full head sha>
#     Lines elsewhere in a comment never count, so quoting a PASS inside a FAIL does not pass.
# Then it runs `gh pr ready`. It never merges: the merge is the human's.
# Exit codes: 0 marked ready (or already ready), 1 a gate failed, 2 missing tool or no PR.
set -u
. "$(dirname "$0")/lib.sh"
cd "$FACTORY_ROOT" || exit 2
command -v gh >/dev/null 2>&1 || { echo "pr-ready: needs the GitHub CLI (gh)." >&2; exit 2; }

info="$(gh pr view --json number,isDraft,headRefOid,state --jq '[.number, .isDraft, .headRefOid, .state] | @tsv' 2>/dev/null)" ||
  { echo "pr-ready: no PR for this branch. Open a draft PR first." >&2; exit 2; }
IFS=$'\t' read -r number draft head state <<<"$info"

[ "$state" = OPEN ] || { echo "pr-ready: PR #$number is $state." >&2; exit 1; }
if [ "$draft" != true ]; then
  echo "pr-ready: PR #$number is already ready for review."
  exit 0
fi

fail() { echo "pr-ready: PR #$number not ready: $1" >&2; exit 1; }

[ "$(git rev-parse HEAD)" = "$head" ] || fail "local HEAD differs from the PR head $head (push or pull first)."
[ -z "$(git status --porcelain)" ] || fail "the working tree has uncommitted changes."
bash scripts/receipt-check.sh --commit "$head" >/dev/null || fail "no passed receipt for the head's tree; run bash scripts/verify.sh."

gh pr checks "$number" >/dev/null 2>&1
case $? in
  0) ;;
  8) fail "CI checks are still pending on $head; wait and re-run." ;;
  *) fail "CI checks failed or none were reported on $head (gh pr checks $number)." ;;
esac

# Line 2 of every comment whose line 1 and line 3 match the contract for this head, oldest first.
verdict="$(gh pr view "$number" --json comments --jq \
  ".comments[] | .body | gsub(\"\\r\"; \"\") | split(\"\\n\")
   | select(length >= 3 and .[0] == \"## Cold audit\" and .[2] == \"Head: $head\") | .[1]" | tail -n 1)"
[ -n "$verdict" ] || fail "no cold audit comment names head $head on its third line; run the cold-audit skill in a fresh subagent."
[ "$verdict" = "Verdict: PASS" ] || fail "the latest cold audit for $head says '$verdict'."

gh pr ready "$number" && echo "pr-ready: PR #$number is ready. The merge is the human's call."
