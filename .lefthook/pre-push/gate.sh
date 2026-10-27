#!/usr/bin/env bash
# pre-push gate. stdin: "<local ref> <local sha> <remote ref> <remote sha>" per pushed ref.
#  1. No push to a protected branch, except creating it (the first push of a new repo), and no
#     deleting one.
#  2. No secrets in the pushed commits (gitleaks; skipped with a warning when not installed, CI runs it).
#  3. A passed receipt must certify the tree of the pushed tip (run scripts/verify.sh first).
#     Only the tip is checked: intermediate commits are not re-verified.
set -u
root="$(git rev-parse --show-toplevel)"
. "$root/scripts/lib.sh"
factory_load_config || exit 2

zero="0000000000000000000000000000000000000000"
status=0
while read -r local_ref local_sha remote_ref remote_sha; do
  [ -n "${local_sha:-}" ] || continue
  dest="${remote_ref#refs/heads/}"

  for b in $FACTORY_PROTECTED_BRANCHES; do
    [ "$dest" = "$b" ] || continue
    if [ "$local_sha" = "$zero" ]; then
      echo "pre-push: '$b' is protected; deleting it on the remote is not allowed." >&2
      status=1
    elif [ "$remote_sha" != "$zero" ]; then
      echo "pre-push: '$b' is protected; it changes only through a merged PR. Push a task branch." >&2
      status=1
    fi
  done
  [ "$local_sha" = "$zero" ] && continue # a deletion has nothing to scan or verify

  if command -v gitleaks >/dev/null 2>&1; then
    # Scan what the remote does not have yet. A remote sha missing locally (someone else pushed)
    # cannot bound a range, so fall back to everything not on any remote-tracking branch.
    if [ "$remote_sha" != "$zero" ] && git cat-file -e "$remote_sha^{commit}" 2>/dev/null; then
      range="$remote_sha..$local_sha"
    else
      range="$local_sha --not --remotes"
    fi
    # gitleaks >= 8.19 scans history with `git`; older versions with `detect`.
    if gitleaks git --help >/dev/null 2>&1; then
      scan=(gitleaks git --no-banner --redact --log-opts="$range" "$root")
    else
      scan=(gitleaks detect --no-banner --redact --log-opts="$range" --source "$root")
    fi
    if ! "${scan[@]}"; then
      echo "pre-push: gitleaks failed on $range (a secret, or the scan could not run: see its output)." >&2
      echo "A secret must be removed from history, not only from the tip, before pushing." >&2
      status=1
    fi
  else
    echo "pre-push: gitleaks not installed; secret scan skipped here (CI still runs it)." >&2
  fi

  bash "$root/scripts/receipt-check.sh" --commit "$local_sha" || {
    echo "pre-push: $local_ref is not verified. Run: bash scripts/verify.sh (on this exact tree), then push." >&2
    status=1
  }
done
exit $status
