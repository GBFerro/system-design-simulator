#!/usr/bin/env bash
# Exits 0 only when .factory/receipt.json has status "passed" for the given tree.
# Usage: bash scripts/receipt-check.sh [tree-sha]   (default: the current working tree)
#        bash scripts/receipt-check.sh --commit <sha>   (the tree of that commit)
set -u

. "$(dirname "$0")/lib.sh"

if [ "${1:-}" = "--commit" ]; then
  want="$(git -C "$FACTORY_ROOT" rev-parse "${2:?commit sha}^{tree}")" || exit 2
else
  want="${1:-$(factory_tree_hash)}"
fi

if [ ! -f "$FACTORY_RECEIPT" ]; then
  echo "unverified: no receipt. Run: bash scripts/verify.sh" >&2
  exit 1
fi

status="$(factory_receipt_field status)"
tree="$(factory_receipt_field tree)"

if [ "$status" != passed ]; then
  echo "unverified: the last receipt says '$status'. Fix it and run: bash scripts/verify.sh" >&2
  exit 1
fi
if [ "$tree" != "$want" ]; then
  echo "unverified: the receipt certifies tree $tree, not $want (files changed since verify)." >&2
  echo "Run: bash scripts/verify.sh" >&2
  exit 1
fi
echo "verified: tree $want"
