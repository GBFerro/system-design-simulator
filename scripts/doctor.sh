#!/usr/bin/env bash
# Checks the tools the factory needs. Exit 1 when a required one is missing.
set -u
. "$(dirname "$0")/lib.sh"

missing=0
have() { command -v "$1" >/dev/null 2>&1; }
runs() { have "$1" && "$1" "${@:2}" >/dev/null 2>&1; }
line() { printf '  %-9s %-8s %s\n' "$1" "$2" "$3"; }

echo "required:"
if have git; then line git ok "$(git --version)"; else line git MISSING "install git"; missing=1; fi
line bash ok "$BASH_VERSION (>= 4.4 required; lib.sh refuses older)"
if runs jq --version; then line json ok "jq"
elif runs node -e ''; then line json ok "node"
elif runs python3 -c '' || runs python -c ''; then line json ok "python"
else line json MISSING "sensors read hook payloads with jq, node or python: install one"; missing=1; fi
if have lefthook; then line lefthook ok "$(lefthook version 2>/dev/null)"
else line lefthook MISSING "git hooks: https://lefthook.dev (npm, brew, scoop, go install)"; missing=1; fi

echo "optional:"
if have gh; then line gh ok "pr-ready.sh"; else line gh missing "needed by scripts/pr-ready.sh"; fi
if have gitleaks; then line gitleaks ok "pre-push secret scan"; else line gitleaks missing "pre-push skips the secret scan; CI still runs it"; fi

hooks="$(git -C "$FACTORY_ROOT" rev-parse --git-path hooks 2>/dev/null)"
case "$hooks" in /* | [A-Za-z]:*) ;; *) hooks="$FACTORY_ROOT/$hooks" ;; esac
if grep -qs lefthook "$hooks/pre-push"; then echo "git hooks: installed"
else echo "git hooks: not installed (run: lefthook install)"; fi
exit $missing
