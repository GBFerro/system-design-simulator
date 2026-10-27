#!/usr/bin/env bash
# PreToolUse(Bash): no skipping or removing git hooks. The hooks run the same gates as CI; skipping
# them only moves the failure later, where it costs more.
# Caught: --no-verify (and git's unique abbreviations), commit -n, core.hooksPath (any case),
# LEFTHOOK=0/false, LEFTHOOK_EXCLUDE, HUSKY=0, `lefthook uninstall`, writes to .git/hooks.
set -uf # -f: command words must never glob-expand here
. "$(dirname "$0")/_lib.sh"

payload_require cmd tool_input.command
start="$(payload_get cwd 2>/dev/null)"
start="${start:-$PWD}"
found=""

judge() {
  local w
  for w in "${CMD_ASSIGNS[@]}"; do
    case "$w" in LEFTHOOK=0 | LEFTHOOK=false | LEFTHOOK_EXCLUDE=* | HUSKY=0) found="$w" ;; esac
  done
  [ ${#CMD_WORDS[@]} -gt 0 ] || return 0
  case "${CMD_WORDS[0]}" in
    export)
      for w in "${CMD_WORDS[@]:1}"; do
        case "$w" in LEFTHOOK=0 | LEFTHOOK=false | LEFTHOOK_EXCLUDE=* | HUSKY=0) found="export $w" ;; esac
      done ;;
    lefthook)
      [ "${CMD_WORDS[1]:-}" = uninstall ] && found="lefthook uninstall" ;;
    git)
      local sub="" k
      shopt -s nocasematch
      for w in "${CMD_WORDS[@]:1}"; do
        case "$w" in *core.hookspath*) found="core.hooksPath" ;; esac
      done
      shopt -u nocasematch
      for ((k = 1; k < ${#CMD_WORDS[@]}; k++)); do
        w="${CMD_WORDS[k]}"
        if [ -z "$sub" ]; then
          case "$w" in -C | -c) k=$((k + 1)) ;; -*) ;; *) sub="$w" ;; esac
          continue
        fi
        # git accepts any unique prefix of a long option: --no-v, --no-ver, --no-verify.
        case "$w" in --no-v | --no-v[a-z]*) found="$w" ;; esac
        if [ "$sub" = commit ] && [[ "$w" =~ ^-[a-zA-Z]*n[a-zA-Z]*$ ]]; then found="git commit $w"; fi
      done ;;
    rm | mv | cp | ln | chmod | truncate | tee | install)
      for w in "${CMD_WORDS[@]:1}"; do case "$w" in *.git/hooks*) found="${CMD_WORDS[0]} $w" ;; esac; done ;;
  esac
  local r
  for r in "${CMD_REDIRS[@]}"; do case "$r" in '>'*.git/hooks*) found="redirect into .git/hooks" ;; esac; done
}

for_each_command judge "$cmd" "$start"

[ -z "$found" ] && exit 0
block "Blocked: '$found' skips or removes the git hooks." \
  "" \
  "The hooks run the same gates as CI. When one fails, read its output and fix the cause." \
  "If a hook itself is wrong, fix it in a separate harness PR; never route around it."
