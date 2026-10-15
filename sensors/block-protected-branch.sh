#!/usr/bin/env bash
# PreToolUse(Bash): no commit, merge, rebase, cherry-pick, revert, am or reset --hard on a
# protected branch, no push to one, no moving one by hand (branch -f, update-ref).
# Work happens on a task branch; the trunk changes only through a PR that a human merges.
# The branch is followed through the command itself: `git switch main && git commit` is judged
# on main, `git switch -c feat/x && git commit` on feat/x.
set -uf # -f: command words must never glob-expand here
. "$(dirname "$0")/_lib.sh"
factory_load_config >/dev/null 2>&1 || exit 0

payload_require cmd tool_input.command
case "$cmd" in *git*) ;; *) exit 0 ;; esac
start="$(payload_get cwd 2>/dev/null)"
start="${start:-$PWD}"
branch="$(git -C "$start" rev-parse --abbrev-ref HEAD 2>/dev/null)" || exit 0

is_protected() {
  local b
  for b in $FACTORY_PROTECTED_BRANCHES; do [ "$1" = "$b" ] && return 0; done
  return 1
}

explain() {
  block "Blocked: $1" \
    "" \
    "Protected branches ($FACTORY_PROTECTED_BRANCHES) change only through a PR that a human merges." \
    "Do this instead: git switch -c <type>/<short-slug>, commit there, push that branch, open a draft PR." \
    "Local commits on a protected branch move with: git switch -c <branch> (the commits come along)."
}

judge() {
  [ "${CMD_WORDS[0]:-}" = git ] || return 0
  local -a a=("${CMD_WORDS[@]:1}")
  # Global options come before the subcommand: -C <dir> -c <k=v> take a value, the rest do not.
  while [ ${#a[@]} -gt 0 ]; do
    case "${a[0]}" in
      -C | -c | --git-dir | --work-tree | --namespace) a=("${a[@]:2}") ;;
      -*) a=("${a[@]:1}") ;;
      *) break ;;
    esac
  done
  [ ${#a[@]} -gt 0 ] || return 0
  local sub="${a[0]}" w
  local -a args=("${a[@]:1}") pos=()
  local after_dashdash=false
  for w in "${args[@]}"; do
    if [ "$after_dashdash" = true ]; then continue; fi
    case "$w" in --) after_dashdash=true ;; -*) ;; *) pos+=("$w") ;; esac
  done

  case "$sub" in
    switch | checkout)
      local k
      for ((k = 0; k < ${#args[@]}; k++)); do
        case "${args[k]}" in
          -c | -C | -b | -B | --create | --force-create | --orphan) branch="${args[k + 1]:-$branch}"; return 0 ;;
          --detach | -d) branch="(detached)"; return 0 ;;
        esac
      done
      # `checkout <tree-ish> -- <paths>` restores files and leaves the branch alone.
      [ "$after_dashdash" = true ] && return 0
      if [ ${#pos[@]} -gt 0 ]; then
        if [ "$sub" = switch ] || git -C "$CMD_CWD" rev-parse --verify -q "refs/heads/${pos[0]}" >/dev/null 2>&1 ||
          is_protected "${pos[0]}"; then
          branch="${pos[0]}"
        fi
      fi ;;
    commit | merge | rebase | cherry-pick | revert | am)
      is_protected "$branch" && explain "git $sub on protected branch '$branch'." ;;
    reset)
      case " ${args[*]} " in *" --hard "*) is_protected "$branch" && explain "git reset --hard on protected branch '$branch'." ;; esac ;;
    branch)
      local force=false
      for w in "${args[@]}"; do case "$w" in -f | --force | -D | -d | --delete | -m | -M | --move | -c | -C) force=true ;; esac; done
      if [ "$force" = true ]; then
        for w in "${pos[@]}"; do is_protected "$w" && explain "git branch ${args[*]} rewrites protected branch '$w'."; done
      fi ;;
    update-ref)
      for w in "${pos[@]}"; do is_protected "${w#refs/heads/}" && explain "git update-ref on protected branch '${w#refs/heads/}'."; done ;;
    push)
      local tags_only=false
      for w in "${args[@]}"; do
        case "$w" in
          --all | --mirror) explain "git push $w would push protected branches." ;;
          --tags) tags_only=true ;;
        esac
      done
      # Refspecs after the remote: [+]<src>:<dst>, a bare name, or a glob.
      for w in "${pos[@]:1}"; do
        local dest="${w##*:}"
        dest="${dest#+}"
        dest="${dest#refs/heads/}"
        [ "$dest" = HEAD ] && dest="$branch"
        case "$dest" in *'*'*) explain "git push with a glob refspec ($w) can reach protected branches." ;; esac
        is_protected "$dest" && explain "git push to protected branch '$dest'."
      done
      if [ ${#pos[@]} -le 1 ] && [ "$tags_only" = false ] && is_protected "$branch"; then
        explain "git push from protected branch '$branch'."
      fi ;;
  esac
  return 0
}

for_each_command judge "$cmd" "$start"
exit 0
