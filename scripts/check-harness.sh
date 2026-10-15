#!/usr/bin/env bash
# Drift check: the things that can disagree without any build failing.
#  - every sensor is wired (settings.json or lefthook.yml), every wired script exists
#  - AGENTS.md stays under its line cap
#  - every skill and agent has name + description frontmatter
#  - every agent pins model + effort, matching its row in docs/model-routing.md
#  - test-first exemptions carry a reason
#  - the lines pinned in scripts/check-harness.pins are still there (repo-specific config values)
#  - relative markdown links resolve
#  - no template placeholder is left (outside the template itself)
# It does not read prose for meaning: that stays the reviewer's job.
set -u
. "$(dirname "$0")/lib.sh"
factory_load_config || exit 2
cd "$FACTORY_ROOT" || exit 2

problems=()
problem() { problems+=("$1"); }
files="$(git ls-files -co --exclude-standard)"
wiring="$(cat .claude/settings.json lefthook.yml 2>/dev/null)"

# Sensors wired.
for f in sensors/*.sh; do
  base="$(basename "$f")"
  case "$base" in _lib.sh | test.sh) continue ;; esac
  case "$wiring" in *"sensors/$base"*) ;; *) problem "$f is not wired in .claude/settings.json or lefthook.yml" ;; esac
done
# Wired scripts exist.
for ref in $(printf '%s\n' "$wiring" | grep -oE '(sensors|scripts)/[A-Za-z0-9._/-]+\.sh' | sort -u); do
  [ -f "$ref" ] || problem "$ref is wired but does not exist"
done
for f in .lefthook/*/*; do
  [ -f "$f" ] || continue
  case "$wiring" in *"$(basename "$f")"*) ;; *) problem "$f is not named in lefthook.yml" ;; esac
done

# Every check name resolves (a typo in FACTORY_STOP_CHECKS would otherwise be skipped silently).
for name in $FACTORY_CHECKS ${FACTORY_STOP_CHECKS:-}; do
  factory_check_command "$name" >/dev/null || problem "check '$name' (FACTORY_CHECKS or FACTORY_STOP_CHECKS) has no command in factory.config.sh"
done

# AGENTS.md line cap.
if [ -f AGENTS.md ]; then
  lines="$(wc -l <AGENTS.md | tr -d ' ')"
  [ "$lines" -le "${FACTORY_AGENTS_MAX_LINES:-120}" ] ||
    problem "AGENTS.md has $lines lines; the cap is $FACTORY_AGENTS_MAX_LINES (move detail to its owner, see docs/harness.md)"
fi

# Skills and agents frontmatter.
frontmatter_has() { [ -n "$(factory_frontmatter_get "$1" "$2")" ]; }
for f in .claude/skills/*/; do
  [ -d "$f" ] || continue
  skill="${f}SKILL.md"
  if [ ! -f "$skill" ]; then problem "$f has no SKILL.md"; continue; fi
  for key in name description; do frontmatter_has "$skill" "$key" || problem "$skill lacks '$key:' frontmatter"; done
done
for f in .claude/agents/*.md; do
  [ -f "$f" ] || continue
  for key in name description; do frontmatter_has "$f" "$key" || problem "$f lacks '$key:' frontmatter"; done
  # Model routing: each agent pins its tier, and docs/model-routing.md routes it with the same one.
  name="$(factory_frontmatter_get "$f" name)"
  model="$(factory_frontmatter_get "$f" model)"
  effort="$(factory_frontmatter_get "$f" effort)"
  case "$model" in haiku | sonnet | opus | fable) ;; *)
    problem "$f: 'model:' must be haiku, sonnet, opus or fable, not '$model' (an inherited model escapes the routing)" ;;
  esac
  case "$effort" in low | medium | high | xhigh | max) ;; *)
    problem "$f: 'effort:' must be low, medium, high, xhigh or max, not '$effort'" ;;
  esac
  grep -qF "| \`$name\` | $model | $effort |" docs/model-routing.md 2>/dev/null ||
    problem "docs/model-routing.md has no row '| \`$name\` | $model | $effort |' matching $f"
done

# Exemptions need reasons.
if [ -f sensors/test-first-exempt.txt ]; then
  n=0
  while IFS= read -r line; do
    n=$((n + 1))
    case "$line" in '' | '#'*) continue ;; esac
    reason="${line#*#}"
    case "$line" in *'#'*) [ -n "${reason//[[:space:]]/}" ] && continue ;; esac
    problem "sensors/test-first-exempt.txt:$n has no reason ('<glob>  # <why>')"
  done <sensors/test-first-exempt.txt
fi

# Relative markdown links (fenced code and inline code are skipped).
while IFS= read -r md; do
  case "$md" in *.md) ;; *) continue ;; esac
  dir="$(dirname "$md")"
  links="$(awk '/^[[:space:]]*```/{f=!f; next} !f' "$md" | sed 's/`[^`]*`//g' | grep -oE '\]\([^)[:space:]]+' | sed 's/^](//')"
  for link in $links; do
    case "$link" in http:* | https:* | mailto:* | '#'*) continue ;; esac
    path="${link%%#*}"
    [ -n "$path" ] || continue
    [ -e "$dir/$path" ] || problem "$md links to missing $link"
  done
done <<EOF
$files
EOF

# Pinned lines: scripts/check-harness.pins lists, per file, whole lines that must stay as they are
# (the repo-specific values a drifted config or workflow would silently lose). Format, one per line:
#   <file> | <line, compared without leading or trailing spaces>        # lines starting with # skip
# A repo without the file pins nothing. Changing a pin is a harness change, like the value it guards.
if [ -f scripts/check-harness.pins ]; then
  while IFS= read -r pin || [ -n "$pin" ]; do
    pin="${pin%$'\r'}"
    case "$pin" in '' | '#'*) continue ;; esac
    pin_file="${pin%% | *}"
    pin_line="${pin#* | }"
    pin_file="${pin_file%"${pin_file##*[![:space:]]}"}"
    pin_line="${pin_line#"${pin_line%%[![:space:]]*}"}"
    pin_line="${pin_line%"${pin_line##*[![:space:]]}"}"
    if [ "$pin_file" = "$pin" ] || [ -z "$pin_line" ]; then
      problem "scripts/check-harness.pins: malformed line '$pin' (want '<file> | <line>')"
    elif [ ! -f "$pin_file" ]; then
      problem "$pin_file is pinned in scripts/check-harness.pins but does not exist"
    elif ! tr -d '\r' <"$pin_file" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -qxF -- "$pin_line"; then
      problem "$pin_file lost the pinned line: $pin_line"
    fi
  done <scripts/check-harness.pins
fi

# Placeholders left behind (the template keeps them on purpose).
if ! factory_is_template; then
  while IFS= read -r f; do
    [ -f "$f" ] || continue
    grep -qE '(^|[^$])\{\{[A-Z_]+\}\}' "$f" 2>/dev/null && problem "$f still has a template placeholder"
  done <<EOF
$files
EOF
fi

if [ ${#problems[@]} -gt 0 ]; then
  echo "check-harness: ${#problems[@]} problem(s):" >&2
  printf '  - %s\n' "${problems[@]}" >&2
  exit 1
fi
echo "check-harness: ok"
