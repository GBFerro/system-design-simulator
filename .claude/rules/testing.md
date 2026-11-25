---
paths:
  - "tests/**"
---

You are writing or changing tests. A test is not done when it passes: it is done when it fails on a
broken line. Cold audits on #37, #38, #43 and #45 each found mutations that left every test green,
one round at a time. This file is the only home of the rule; other files link here.

Before you call a slice done:

1. For each branch, constant and call site the slice adds or changes, apply one one-line mutation:
   delete the line, flip the condition, or swap the value or argument for another of the same type.
   Make and undo the mutation with Edit, never through the shell, and run the tests that cover it.
2. Red: go to the next mutation. Green: write the test that kills it, or, if the gap is accepted,
   declare it with its reason under "Mutations accepted on purpose" in the PR body.
3. In your report, list each mutation, where it was, and red or green with the test that caught it.

A value pinned in a helper is not pinned where it is used. When a helper feeds a call site (a color,
a token, a style, an argument), mutate the call site too: pass the wrong argument, put a literal in
place of the helper, or drop the call. What only shows on the canvas (SVG, canvas 2D, the minimap)
needs an e2e that reads the computed style or what is drawn; a unit test does not render it.
