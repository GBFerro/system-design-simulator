#!/usr/bin/env bash
# Stop: when the turn changed files, run the fast checks (FACTORY_STOP_CHECKS) before the agent
# hands the turn back. The full gate is scripts/verify.sh; this is the earliest cheap signal.
set -u
. "$(dirname "$0")/_lib.sh"
factory_load_config >/dev/null 2>&1 || exit 0

# Claude Code sets stop_hook_active when it is already continuing because of this hook.
payload_require active stop_hook_active
[ "$active" = true ] && exit 0
cd "$FACTORY_ROOT" || exit 0
[ -n "$(git status --porcelain 2>/dev/null)" ] || exit 0

failed=""
report=""
for name in $FACTORY_STOP_CHECKS; do
  cmd="$(factory_check_command "$name")" || {
    failed="$failed $name"
    report="$report"$'\n'"== $name: no such check in factory.config.sh"
    continue
  }
  if [ -z "$cmd" ] || [ "$cmd" = none ] || factory_is_placeholder "$cmd"; then continue; fi
  out="$(bash -c "$cmd" 2>&1)" && continue
  failed="$failed $name"
  report="$report"$'\n'"== $name: $cmd"$'\n'"$(printf '%s\n' "$out" | tail -n 30)"
done

[ -z "$failed" ] && exit 0
block "End-of-turn checks failed:$failed" "$report" "" \
  "Fix these before finishing the turn. The full gate is: bash scripts/verify.sh"
