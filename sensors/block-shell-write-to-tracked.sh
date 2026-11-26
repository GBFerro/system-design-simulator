#!/usr/bin/env bash
# PreToolUse(Bash): no writing the repo's files through the shell. That covers tracked files and
# new files git would pick up (anything inside the repo that is not ignored): > >> >| tee,
# sed/perl in-place edits, cp/mv/install onto a file. Edit/Write keep a change visible: the edit
# hooks (require-test-first) fire, the session can rewind it, the diff is reviewable.
# Writes to ignored paths (.factory/, build output) and outside the repo (a temp worktree) pass.
# Not caught: interpreter one-liners (python -c, node -e); the rule in AGENTS.md covers them.
set -uf # -f: command words must never glob-expand here
. "$(dirname "$0")/_lib.sh"

payload_require cmd tool_input.command
start="$(payload_get cwd 2>/dev/null)"
start="${start:-$PWD}"
hits=()

# When the parser lost track of the directory (CMD_UNSURE), a relative path is judged from every
# directory the command has been in: the real one is among them.
note() {
  local t="$1" from="$2" d
  case "$t" in '' | /dev/* | -) return ;; esac
  if [ "$CMD_UNSURE" = 1 ]; then
    for d in "${CMD_CWDS[@]}"; do repo_owned_path "$t" "$d" && { hits+=("$t"); return; }; done
  else
    repo_owned_path "$t" "$from" && hits+=("$t")
  fi
}

# In-place edits only touch files that exist; their script argument is not a path.
note_existing() {
  local t="$1" from="$2" d
  if [ "$CMD_UNSURE" = 1 ]; then
    for d in "${CMD_CWDS[@]}"; do [ -e "$(canonical_path "$t" "$d")" ] && { note "$t" "$from"; return; }; done
    return 0
  fi
  [ -e "$(canonical_path "$t" "$from")" ] || return 0
  note "$t" "$from"
}

judge() {
  local r op target k w
  for r in "${CMD_REDIRS[@]}"; do
    op="${r%% *}"
    target="${r#* }"
    case "$op" in
      '>' | '>>') note "$target" "$CMD_CWD" ;;
      '>&') [[ "$target" =~ ^[0-9-]+$ ]] || note "$target" "$CMD_CWD" ;;
    esac
  done
  [ ${#CMD_WORDS[@]} -gt 0 ] || return 0
  case "${CMD_WORDS[0]##*/}" in
    tee)
      for w in "${CMD_WORDS[@]:1}"; do case "$w" in -*) ;; *) note "$w" "$CMD_CWD" ;; esac; done ;;
    sed | gsed | perl)
      local in_place=false
      for w in "${CMD_WORDS[@]:1}"; do
        case "$w" in --in-place*) in_place=true ;; --*) ;; -*i*) in_place=true ;; esac
      done
      if [ "$in_place" = true ]; then
        for w in "${CMD_WORDS[@]:1}"; do case "$w" in -*) ;; *) note_existing "$w" "$CMD_CWD" ;; esac; done
      fi ;;
    cp | mv | install | rsync)
      local -a args=()
      for w in "${CMD_WORDS[@]:1}"; do case "$w" in -*) ;; *) args+=("$w") ;; esac; done
      [ ${#args[@]} -ge 2 ] || return 0
      local dest="${args[-1]}"
      if [ -d "$(canonical_path "$dest" "$CMD_CWD")" ]; then
        for ((k = 0; k < ${#args[@]} - 1; k++)); do note "$dest/${args[k]##*/}" "$CMD_CWD"; done
      else
        note "$dest" "$CMD_CWD"
      fi ;;
  esac
}

for_each_command judge "$cmd" "$start"

[ ${#hits[@]} -eq 0 ] && exit 0
block "Blocked: this shell command writes the repo's file(s): ${hits[*]}" \
  "" \
  "Create or change files in the repo with the Edit or Write tool, so the edit hooks run and the" \
  "change stays reviewable. Shell output is fine outside the repo or in an ignored path (.factory/)."
