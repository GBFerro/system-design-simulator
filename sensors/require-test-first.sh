#!/usr/bin/env bash
# PreToolUse(Edit|Write|MultiEdit): a production source file may change only when its test exists.
# Write the failing test first, then the code. Exemptions live in sensors/test-first-exempt.txt,
# one glob per line with a reason after `#`; an entry without a reason does not count.
set -uf # -f: globs in the config are patterns to match, not paths to expand
. "$(dirname "$0")/_lib.sh"
factory_load_config >/dev/null 2>&1 || exit 0
[ -n "${FACTORY_SOURCE_GLOBS:-}" ] || exit 0
factory_is_placeholder "$FACTORY_SOURCE_GLOBS" && exit 0

payload_require path tool_input.file_path
[ -n "$path" ] || exit 0

# Both sides canonical (symlinks such as macOS /tmp -> /private/tmp resolved, Windows short names
# and drive forms unified), or a file inside the repo reads as outside and passes unchecked.
abs="$(canonical_path "$path")"
root="$(canonical_path "$FACTORY_ROOT")"
lower_abs="$(printf '%s' "$abs" | tr '[:upper:]' '[:lower:]')"
lower_root="$(printf '%s' "$root" | tr '[:upper:]' '[:lower:]')"
case "$lower_abs" in
  "$lower_root"/*) rel="${abs:$((${#root} + 1))}" ;;
  /* | [A-Za-z]:*) exit 0 ;; # outside the repo
  *) rel="$abs" ;;
esac

matches_any() {
  local p="$1" g
  shift
  for g in $1; do
    # shellcheck disable=SC2254
    case "$p" in $g) return 0 ;; esac
  done
  return 1
}

matches_any "$rel" "$FACTORY_SOURCE_GLOBS" || exit 0
matches_any "$rel" "${FACTORY_TEST_GLOBS:-}" && exit 0

exempt="$FACTORY_ROOT/sensors/test-first-exempt.txt"
if [ -f "$exempt" ]; then
  while IFS= read -r line; do
    case "$line" in '' | '#'*) continue ;; *'#'*) ;; *) continue ;; esac
    glob="${line%%#*}"
    glob="${glob%"${glob##*[![:space:]]}"}"
    reason="${line#*#}"
    [ -n "${reason//[[:space:]]/}" ] || continue
    # shellcheck disable=SC2254
    case "$rel" in $glob) exit 0 ;; esac
  done <"$exempt"
fi

dir="$(dirname "$rel")"
file="$(basename "$rel")"
name="${file%.*}"
ext="${file##*.}"
cd "$FACTORY_ROOT" || exit 0
tried=""
for pattern in $FACTORY_TEST_CANDIDATES; do
  candidate="${pattern//\{dir\}/$dir}"
  candidate="${candidate//\{name\}/$name}"
  candidate="${candidate//\{ext\}/$ext}"
  candidate="${candidate#./}"
  tried="$tried"$'\n'"  - $candidate"
  set +f # compgen -G expands the candidate glob on purpose; `**` spans directories (bash 4+)
  shopt -s globstar 2>/dev/null
  compgen -G "$candidate" >/dev/null && exit 0
  set -f
done

block "Blocked: $rel is production code and has no test yet." \
  "" \
  "Write the failing test first, at one of:$tried" \
  "" \
  "If this file genuinely cannot have a unit test (generated code, pure config, entry wiring)," \
  "add a line to sensors/test-first-exempt.txt: '<glob>  # <why no test applies>'. That edit is" \
  "a harness change: it needs the user's OK and shows up in the PR."
