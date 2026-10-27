#!/usr/bin/env bash
# Runs every check in FACTORY_CHECKS and writes a receipt to .factory/receipt.json.
# "Verified" means: a receipt with status "passed" whose tree equals the tree you are about to
# commit, push or call ready. Anything else (missing, failed, stale, other tree) is unverified.
#
# Exit codes: 0 passed, 1 a check failed or the tree changed during the run (stale),
#             2 configuration error (unknown check, unfilled placeholder).
# Usage: bash scripts/verify.sh            all of FACTORY_CHECKS, writes the receipt
#        bash scripts/verify.sh lint test  only those checks, NO receipt (a subset certifies nothing)
set -u

. "$(dirname "$0")/lib.sh"
factory_load_config || exit 2
cd "$FACTORY_ROOT" || exit 2

checks="${*:-$FACTORY_CHECKS}"
partial=false
[ $# -gt 0 ] && partial=true

for name in $checks; do
  cmd="$(factory_check_command "$name")" || { echo "verify: unknown check '$name'" >&2; exit 2; }
  # The template itself ships placeholders; there they read as not configured.
  if factory_is_placeholder "$cmd" && ! factory_is_template; then
    echo "verify: check '$name' is still a placeholder in factory.config.sh: $cmd" >&2
    exit 2
  fi
done

mkdir -p .factory
started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
tree_before="$(factory_tree_hash)"
entries=()
overall=passed

for name in $checks; do
  cmd="$(factory_check_command "$name")"
  if [ "$cmd" = "none" ] || [ -z "$cmd" ] || factory_is_placeholder "$cmd"; then
    echo "== $name: not configured"
    entries+=("{\"name\": \"$name\", \"status\": \"not-configured\"}")
    continue
  fi
  echo "== $name: $cmd"
  t0=$SECONDS
  if bash -c "$cmd"; then
    status=passed
  else
    status=failed
    overall=failed
  fi
  dt=$((SECONDS - t0))
  echo "== $name: $status (${dt}s)"
  entries+=("{\"name\": \"$name\", \"command\": \"$(factory_json_escape "$cmd")\", \"status\": \"$status\", \"seconds\": $dt}")
done

if [ "$partial" = true ]; then
  echo "verify: subset $overall (no receipt written; run with no arguments to certify the tree)"
  [ "$overall" = passed ]
  exit $?
fi

tree_after="$(factory_tree_hash)"
if [ "$overall" = passed ] && [ "$tree_before" != "$tree_after" ]; then
  overall=stale
  echo "verify: the working tree changed while checks ran; re-run verify on a still tree." >&2
fi

{
  printf '{\n'
  printf '  "status": "%s",\n' "$overall"
  printf '  "tree": "%s",\n' "$tree_before"
  printf '  "started": "%s",\n' "$started"
  printf '  "finished": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "checks": [\n'
  for i in "${!entries[@]}"; do
    sep=","
    [ "$i" -eq $((${#entries[@]} - 1)) ] && sep=""
    printf '    %s%s\n' "${entries[$i]}" "$sep"
  done
  printf '  ]\n}\n'
} >"$FACTORY_RECEIPT"

echo "verify: $overall (tree $tree_before) -> .factory/receipt.json"
[ "$overall" = passed ]
