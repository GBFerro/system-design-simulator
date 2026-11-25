---
paths:
  - "src/components/**"
  - "src/lib/**"
  - "src/app/**"
  - "tests/e2e/**"
---

You are in the UI. Before changing it, read the invariants "Canvas/UI", "Guided layout", "Flow tab",
"Calls and responses" and "Runtime metrics" (the particles) in
[docs/architecture.md](../../docs/architecture.md#key-invariants--dont-break-these). They live there
and only there; this file only makes sure they are in front of you.

A color or style you change on the canvas is pinned at its call site, not only in the helper that
computes it: see [testing.md](testing.md).
