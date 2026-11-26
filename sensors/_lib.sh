# Shared code for Claude Code hook sensors. Source it; do not run it.
#
# Contract (Claude Code hooks): the event payload arrives as JSON on stdin.
#   exit 0 = allow, exit 2 = block and show stderr to the agent, any other = non-blocking error.
# A sensor that cannot decide (no JSON parser, not a git repo) allows with a warning: a broken
# sensor must never brick the session. sensors/test.sh proves each one in both directions.

. "$(dirname "${BASH_SOURCE[0]}")/../scripts/lib.sh"

FACTORY_PAYLOAD="$(cat)"

# Pick a JSON parser that actually runs (on Windows `python3` can be a Store stub that fails).
factory_json_parser() {
  if command -v jq >/dev/null 2>&1; then echo jq; return; fi
  if command -v node >/dev/null 2>&1 && node -e '' >/dev/null 2>&1; then echo node; return; fi
  local py
  for py in python3 python; do
    if command -v "$py" >/dev/null 2>&1 && "$py" -c '' >/dev/null 2>&1; then echo "$py"; return; fi
  done
  return 1
}

# Print a dotted field of the payload ("" when absent). Exit 3 when no parser is available.
payload_get() {
  local parser
  parser="$(factory_json_parser)" || return 3
  case "$parser" in
    jq) printf '%s' "$FACTORY_PAYLOAD" | jq -r ".$1 // empty | tostring" ;;
    node)
      printf '%s' "$FACTORY_PAYLOAD" | node -e '
        let d = JSON.parse(require("fs").readFileSync(0, "utf8"));
        for (const k of process.argv[1].split(".")) d = d && typeof d === "object" ? d[k] : undefined;
        process.stdout.write(d === undefined || d === null ? "" : typeof d === "object" ? JSON.stringify(d) : String(d));
      ' "$1" ;;
    *)
      printf '%s' "$FACTORY_PAYLOAD" | "$parser" -c '
import json, sys
d = json.load(sys.stdin)
for k in sys.argv[1].split("."):
    d = d.get(k) if isinstance(d, dict) else None
if d is None: out = ""
elif isinstance(d, bool): out = str(d).lower()
elif isinstance(d, (dict, list)): out = json.dumps(d)
else: out = str(d)
sys.stdout.write(out)' "$1" ;;
  esac
}

# Field or a visible fail-soft exit. Exit 1 is a non-blocking error that Claude Code shows the
# user (stderr on exit 0 is never shown): the action goes ahead, but nobody believes a sensor is
# guarding it while it is not.
# Usage: payload_require <var> <field>. Assigns in the calling shell: an `exit` inside `$(...)`
# would only leave the subshell and the failure would vanish.
payload_require() {
  local value status
  value="$(payload_get "$2" 2>/dev/null)"
  status=$?
  if [ $status -eq 3 ]; then
    echo "sensor $(basename "$0") is OFF: no JSON parser (jq, node or python). Run scripts/doctor.sh." >&2
    exit 1
  elif [ $status -ne 0 ]; then
    echo "sensor $(basename "$0") is OFF for this call: could not read the hook payload." >&2
    exit 1
  fi
  printf -v "$1" '%s' "$value"
}

# Canonical absolute path (symlinks resolved, Windows forms unified) of a path that may not
# exist yet: the deepest existing ancestor is resolved with `pwd -P` and the rest appended.
canonical_path() {
  local p="${1//\\//}" head tail=""
  if command -v cygpath >/dev/null 2>&1; then p="$(cygpath -u "$p" 2>/dev/null || printf '%s' "$p")"; fi
  case "$p" in /*) ;; *) p="${2:-$PWD}/$p" ;; esac
  head="$p"
  while [ -n "$head" ] && [ ! -d "$head" ]; do
    tail="/${head##*/}$tail"
    head="${head%/*}"
  done
  head="$(cd "${head:-/}" 2>/dev/null && pwd -P)" || head=""
  p="$head$tail"
  if command -v cygpath >/dev/null 2>&1; then p="$(cygpath -m -l "$p" 2>/dev/null || printf '%s' "$p")"; fi
  printf '%s' "$p"
}

# Exit 0 when the path is inside the guarded checkout ($FACTORY_ROOT) and not ignored there (a
# file the repo owns or would pick up). Another work tree is not this checkout: a linked worktree
# (an audit's throwaway copy) or another repository passes. Prints nothing.
# $2 = directory relative paths are resolved from.
repo_owned_path() {
  local abs dir top rel
  abs="$(canonical_path "$1" "${2:-$PWD}")"
  dir="${abs%/*}"
  while [ -n "$dir" ] && [ ! -d "$dir" ]; do dir="${dir%/*}"; done
  top="$(git -C "${dir:-/}" rev-parse --show-toplevel 2>/dev/null)" || return 1
  top="$(canonical_path "$top")"
  [ "$top" = "$(canonical_path "$FACTORY_ROOT")" ] || return 1
  case "$abs" in "$top"/*) rel="${abs#"$top"/}" ;; *) return 1 ;; esac
  case "$rel" in .git | .git/*) return 0 ;; esac
  git -C "$top" check-ignore -q --no-index -- "$rel" 2>/dev/null && return 1
  return 0
}

block() {
  printf '%s\n' "$@" >&2
  exit 2
}

# --- Shell command parsing -------------------------------------------------------------------
# Not a full shell parser: enough to judge what a command would really do, so quoted text,
# commit messages and heredoc bodies never look like commands, and `cd`, wrappers (env, sudo,
# bash -c, eval) and separators (; && || | & newlines, parentheses) are followed.

SEP=$'\x1e'   # separator token
OP=$'\x1f'    # prefix of an operator token (a quoted ">" stays a word)
SUB_IN=$'\x1c'  # "(": a subshell starts; a `cd` inside it does not outlive it
SUB_OUT=$'\x1d' # ")"

# Tokenizes one line into TOKENS: words (quotes removed), "${OP}>" / "${OP}>>" / "${OP}<<" ...
tokenize_line() {
  local s="$1" i=0 n=${#1} c next tok="" intok=0 q=""
  TOKENS=()
  while [ "$i" -lt "$n" ]; do
    c="${s:i:1}"
    if [ -n "$q" ]; then
      if [ "$c" = "$q" ]; then
        q=""
      elif [ "$q" = '"' ] && [ "$c" = '\' ] && [ $((i + 1)) -lt "$n" ]; then
        i=$((i + 1))
        tok+="${s:i:1}"
      else
        tok+="$c"
      fi
      i=$((i + 1))
      continue
    fi
    next="${s:i+1:1}"
    case "$c" in
      "'" | '"') q="$c"; intok=1 ;;
      '\') i=$((i + 1)); tok+="${s:i:1}"; intok=1 ;;
      ' ' | $'\t' | $'\r')
        [ "$intok" = 1 ] && TOKENS+=("$tok")
        tok="" intok=0 ;;
      ';' | '(' | ')' | '|' | '&' | '>' | '<')
        # A word made only of digits right before > or < is a file descriptor, not a word.
        if [ "$intok" = 1 ]; then
          case "$c$tok" in '>'*[!0-9]* | '<'*[!0-9]* | [!\<\>]*) TOKENS+=("$tok") ;; esac
        fi
        tok="" intok=0
        case "$c$next" in
          '&&' | '||') TOKENS+=("$SEP"); i=$((i + 1)) ;;
          '&>') TOKENS+=("${OP}>"); i=$((i + 1)); [ "${s:i+1:1}" = '>' ] && i=$((i + 1)) ;;
          '>>') TOKENS+=("${OP}>>"); i=$((i + 1)) ;;
          '>|') TOKENS+=("${OP}>"); i=$((i + 1)) ;;
          '>&') TOKENS+=("${OP}>&"); i=$((i + 1)) ;;
          '<<')
            i=$((i + 1))
            if [ "${s:i+1:1}" = '-' ]; then TOKENS+=("${OP}<<-"); i=$((i + 1)); else TOKENS+=("${OP}<<"); fi ;;
          '>'*) TOKENS+=("${OP}>") ;;
          '<'*) TOKENS+=("${OP}<") ;;
          '('*) TOKENS+=("$SUB_IN") ;;
          ')'*) TOKENS+=("$SUB_OUT") ;;
          *) TOKENS+=("$SEP") ;;
        esac ;;
      *) tok+="$c"; intok=1 ;;
    esac
    i=$((i + 1))
  done
  [ "$intok" = 1 ] && TOKENS+=("$tok")
  return 0
}

# Calls function $1 once per simple command in the command text $2 (run from directory $3) with:
#   CMD_WORDS   the words, without leading VAR=value and wrappers (env, sudo, command, time, nohup)
#   CMD_ASSIGNS the VAR=value words that preceded it
#   CMD_REDIRS  "op target" pairs, op one of > >> >& <
#   CMD_CWD     the directory it runs in (after any earlier `cd` in the text)
#   CMD_CWDS    every directory the text has been in so far, the start included
#   CMD_UNSURE  1 once the text did something this parser does not follow exactly (any `(` or `)`,
#               which also covers `case` patterns; `cd -`; `pushd`): CMD_CWD is then a guess, and
#               the real directory is one of CMD_CWDS. A sensor judging by directory checks them all.
CMD_UNSURE=0
CMD_CWDS=()
for_each_command() {
  local cb="$1" text="$2" cwd="${3:-$PWD}" line heredoc="" strip_tabs=false
  local -a words assigns redirs toks
  local tok pending="" j
  _seen_cwd "$cwd"
  while IFS= read -r line || [ -n "$line" ]; do
    if [ -n "$heredoc" ]; then
      local cmp="${line%$'\r'}"
      [ "$strip_tabs" = true ] && cmp="${cmp#"${cmp%%[!$'\t']*}"}"
      [ "$cmp" = "$heredoc" ] && heredoc=""
      continue
    fi
    tokenize_line "$line"
    toks=("${TOKENS[@]}" "$SEP") # own copy: a nested `bash -c` re-tokenizes into TOKENS
    words=() assigns=() redirs=()
    for ((j = 0; j < ${#toks[@]}; j++)); do
      tok="${toks[j]}"
      case "$tok" in
        "$SUB_IN" | "$SUB_OUT")
          if [ ${#words[@]} -gt 0 ] || [ ${#redirs[@]} -gt 0 ]; then
            _dispatch_command "$cb"
            cwd="$_NEXT_CWD"
            _seen_cwd "$cwd"
          fi
          words=() assigns=() redirs=() pending=""
          CMD_UNSURE=1 # a `)` may close a subshell, a `case` pattern or nothing
          continue ;;
      esac
      if [ -n "$pending" ]; then
        case "$tok" in "$SEP" | "$OP"*) pending="" ;; *)
          if [ "$pending" = "<<" ] || [ "$pending" = "<<-" ]; then
            heredoc="$tok"
            [ "$pending" = "<<-" ] && strip_tabs=true || strip_tabs=false
          else
            redirs+=("$pending $tok")
          fi
          pending=""
          continue ;;
        esac
      fi
      case "$tok" in
        "$SEP")
          if [ ${#words[@]} -gt 0 ] || [ ${#redirs[@]} -gt 0 ]; then
            _dispatch_command "$cb"
            cwd="$_NEXT_CWD"
            _seen_cwd "$cwd"
          fi
          words=() assigns=() redirs=() ;;
        "$OP"*) pending="${tok#"$OP"}" ;;
        *)
          if [ ${#words[@]} -eq 0 ] && [[ "$tok" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
            assigns+=("$tok")
          else
            words+=("$tok")
          fi ;;
      esac
    done
  done <<<"$text"
}

_seen_cwd() {
  local d
  for d in "${CMD_CWDS[@]}"; do [ "$d" = "$1" ] && return 0; done
  CMD_CWDS+=("$1")
}

_dispatch_command() {
  local cb="$1" k
  _NEXT_CWD="$cwd"
  # Strip wrappers that run the rest as the command.
  while [ ${#words[@]} -gt 0 ]; do
    case "${words[0]}" in
      env)
        words=("${words[@]:1}")
        while [ ${#words[@]} -gt 0 ]; do
          case "${words[0]}" in
            -u | -C) words=("${words[@]:2}") ;;
            -*) words=("${words[@]:1}") ;;
            *=*) assigns+=("${words[0]}"); words=("${words[@]:1}") ;;
            *) break ;;
          esac
        done ;;
      sudo | command | time | nohup | exec | builtin) words=("${words[@]:1}") ;;
      *) break ;;
    esac
  done
  [ ${#words[@]} -gt 0 ] || [ ${#redirs[@]} -gt 0 ] || return 0
  case "${words[0]:-}" in
    cd | pushd)
      local dest="${words[1]:-$HOME}"
      [ "${words[0]}" = pushd ] && CMD_UNSURE=1
      if [ "$dest" = "-" ]; then CMD_UNSURE=1; else _NEXT_CWD="$(canonical_path "$dest" "$cwd")"; fi
      return 0 ;;
    popd) return 0 ;; # only after a `pushd`, which already made the directory unsure
    bash | sh | zsh | dash)
      for ((k = 1; k < ${#words[@]}; k++)); do
        if [ "${words[k]}" = "-c" ] && [ -n "${words[k + 1]:-}" ]; then
          for_each_command "$cb" "${words[k + 1]}" "$cwd"
          _NEXT_CWD="$cwd" # a `cd` inside the child shell does not move this one
          return 0
        fi
      done ;;
    eval)
      for_each_command "$cb" "${words[*]:1}" "$cwd"
      _NEXT_CWD="$cwd"
      return 0 ;;
  esac
  CMD_WORDS=("${words[@]}")
  CMD_ASSIGNS=("${assigns[@]}")
  CMD_REDIRS=("${redirs[@]}")
  CMD_CWD="$cwd"
  "$cb"
}

# Run git in the directory the agent is working in (the payload's cwd when given).
sensor_git() {
  local cwd
  cwd="$(payload_get cwd 2>/dev/null)"
  git -C "${cwd:-$PWD}" "$@"
}
