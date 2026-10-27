# Shared helpers for scripts/ and sensors/. Source it; do not run it.
# Bash only (Git Bash on Windows works): no jq, node or python needed here.

# bash >= 4.4: globstar, and `${var//pat/rep}` treating quotes and backslashes the same everywhere.
# macOS ships 3.2 as /bin/bash: `brew install bash` and put it first on PATH.
if [ "${BASH_VERSINFO[0]:-0}" -lt 4 ] || { [ "${BASH_VERSINFO[0]}" -eq 4 ] && [ "${BASH_VERSINFO[1]}" -lt 4 ]; }; then
  echo "factory: bash >= 4.4 required, this is ${BASH_VERSION:-unknown} ($(command -v bash))." >&2
  exit 1
fi

FACTORY_ROOT="${FACTORY_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
FACTORY_RECEIPT="$FACTORY_ROOT/.factory/receipt.json"

factory_load_config() {
  local config="$FACTORY_ROOT/factory.config.sh"
  if [ ! -f "$config" ]; then
    echo "factory: missing $config" >&2
    return 2
  fi
  # A check must come from the config, never from whatever the environment happens to hold.
  local inherited
  for inherited in $(compgen -v FACTORY_CHECK_); do unset "$inherited"; done
  # shellcheck source=/dev/null
  . "$config"
}

# True when the template marker is present (placeholders are expected there).
factory_is_template() {
  [ -f "$FACTORY_ROOT/.factory-template" ]
}

# The command for a named check, or "none". Exit 2 when the check is unknown.
# Beyond the built-in names, a check "api-test" reads FACTORY_CHECK_API_TEST from the config
# (one check per part of a monorepo, for example).
factory_check_command() {
  case "$1" in
    harness) echo "bash sensors/test.sh && bash scripts/check-harness.sh" ;;
    lint) echo "$FACTORY_LINT_CMD" ;;
    format) echo "$FACTORY_FORMAT_CHECK_CMD" ;;
    typecheck) echo "$FACTORY_TYPECHECK_CMD" ;;
    test) echo "$FACTORY_TEST_CMD" ;;
    *)
      local var
      var="FACTORY_CHECK_$(printf '%s' "$1" | tr 'a-z-' 'A-Z_')"
      case "$var" in *[!A-Z0-9_]*) return 2 ;; esac
      declare -p "$var" >/dev/null 2>&1 || return 2
      printf '%s\n' "${!var}" ;;
  esac
}

# Value of a key in a markdown file's leading `---` frontmatter ("" when the key or the
# frontmatter is absent). Carriage returns are dropped, so CRLF files read the same.
factory_frontmatter_get() {
  tr -d '\r' <"$1" | sed -n '1{/^---$/!q;};2,/^---$/p' | sed -n "s/^$2:[[:space:]]*//p" | head -n 1
}

factory_is_placeholder() {
  case "$1" in *'{{'*'}}'*) return 0 ;; *) return 1 ;; esac
}

# Hash of the working tree as it would be committed: tracked + untracked, minus ignored.
# Uses a throwaway index, so the real index and the working tree are untouched.
# Equal to `git rev-parse <commit>^{tree}` for a commit made from this exact state.
factory_tree_hash() {
  local tmp real
  tmp="$(mktemp)"
  rm -f "$tmp"
  real="$(git -C "$FACTORY_ROOT" rev-parse --git-path index)"
  case "$real" in /* | [A-Za-z]:*) ;; *) real="$FACTORY_ROOT/$real" ;; esac
  [ -f "$real" ] && cp "$real" "$tmp"
  # .factory/ holds the receipt itself: never part of what it certifies, ignored or not.
  GIT_INDEX_FILE="$tmp" git -C "$FACTORY_ROOT" add -A -- . ':(exclude).factory' >/dev/null 2>&1
  GIT_INDEX_FILE="$tmp" git -C "$FACTORY_ROOT" rm -r -q --cached --ignore-unmatch -- .factory >/dev/null 2>&1
  GIT_INDEX_FILE="$tmp" git -C "$FACTORY_ROOT" write-tree
  local status=$?
  rm -f "$tmp"
  return $status
}

# Escape a string for a JSON string literal.
factory_json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\t'/\\t}"
  s="${s//$'\r'/}"
  s="${s//$'\n'/\\n}"
  printf '%s' "$s"
}

# Read a top-level string field from the receipt (we write it, so its format is fixed).
factory_receipt_field() {
  [ -f "$FACTORY_RECEIPT" ] || return 1
  sed -n "s/^  \"$1\": \"\\([^\"]*\\)\",\\{0,1\\}\$/\\1/p" "$FACTORY_RECEIPT" | head -n 1
}
