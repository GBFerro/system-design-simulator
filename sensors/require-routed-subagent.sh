#!/usr/bin/env bash
# PreToolUse(Agent): every subagent runs on the model and effort its role is routed to
# (docs/model-routing.md). Allowed: the agents in .claude/agents/ (each pins model: and effort:)
# and the built-ins that pin their own model. Blocked: agents that inherit the main session's model
# (no type, general-purpose, Explore, Plan, a fork) and per-call model or effort overrides.
set -u
. "$(dirname "$0")/_lib.sh"

payload_require agent tool_input.subagent_type
payload_require model tool_input.model
payload_require effort tool_input.effort
top="$(sensor_git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "sensor $(basename "$0") is OFF for this call: not inside a git repository." >&2
  exit 1
}

roster=""
for f in "$top"/.claude/agents/*.md; do
  [ -f "$f" ] || continue
  name="$(factory_frontmatter_get "$f" name)"
  [ -n "$name" ] && roster="$roster $name"
done
allowed="$roster claude-code-guide statusline-setup"

if [ -z "$agent" ]; then
  unrouted="no subagent_type (the default general-purpose agent)"
else
  case " $allowed " in *" $agent "*) unrouted="" ;; *) unrouted="'$agent'" ;; esac
fi
if [ -n "$unrouted" ]; then
  block "Blocked: subagent $unrouted is not routed; it would run on the main session's model." \
    "" \
    "Dispatch the work to the agent docs/model-routing.md routes it to:${roster:- (none defined)}." \
    "If no agent fits the work, propose a new one with model: and effort: in a harness PR."
fi

[ -z "$model$effort" ] && exit 0
block "Blocked: a per-call override (model='$model' effort='$effort') bypasses the routing of '$agent'." \
  "" \
  "Dispatch '$agent' without model or effort. To give the work a stronger tier, escalate to the" \
  "next agent (implementer -> implementer-deep -> architect, docs/model-routing.md)."
