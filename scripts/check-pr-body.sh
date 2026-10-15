#!/usr/bin/env bash
# PR policy (CI): the body states intent, acceptance criteria and verification, each with content.
# Template guidance inside <!-- --> does not count as content.
# Usage: PR_BODY="..." bash scripts/check-pr-body.sh
set -u

body="$(printf '%s' "${PR_BODY:-}" | tr -d '\r')"

# Non-blank lines of one "## <heading>" section, HTML comments removed.
section() {
  printf '%s\n' "$body" | awk -v h="## $1" '
    /^## / { inside = (substr($0, 1, length(h)) == h && substr($0, length(h) + 1) ~ /^[[:space:]]*$/); next }
    !inside { next }
    {
      line = $0
      while (1) {
        if (incomment) { e = index(line, "-->"); if (!e) { line = ""; break } line = substr(line, e + 3); incomment = 0 }
        s = index(line, "<!--"); if (!s) break
        pre = substr(line, 1, s - 1); rest = substr(line, s + 4); e = index(rest, "-->")
        if (e) line = pre substr(rest, e + 3); else { line = pre; incomment = 1; break }
      }
      if (line ~ /[^[:space:]]/) print line
    }'
}

missing=()
for heading in "Intent" "Acceptance criteria" "Verification"; do
  if ! printf '%s\n' "$body" | grep -qE "^## $heading[[:space:]]*$"; then
    missing+=("'## $heading' heading is missing")
  elif [ -z "$(section "$heading")" ]; then
    missing+=("'## $heading' is empty")
  fi
done

if [ ${#missing[@]} -gt 0 ]; then
  echo "PR body policy failed (use .github/PULL_REQUEST_TEMPLATE.md):" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  exit 1
fi
echo "PR body policy: ok"
