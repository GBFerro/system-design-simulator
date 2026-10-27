---
name: spec-first
description: Write a spec with acceptance criteria before any code, when a change is large or touches a contract. Use when a change would touch more than 2 production files, change a public contract, schema or API, add a new module, or when the user asks for a spec.
---

# Spec first

The acceptance criteria must exist before the solution, so the proof is not written from what the
code happens to do.

## When it applies

Any one of these:

- more than 2 production files will change;
- a public contract changes: an API, a schema, a message format, a CLI, a file format;
- a new module or service appears;
- the user asks for a spec.

Below the trigger, restate the criteria in the PR body instead.

## Steps

The `spec-writer` subagent drafts steps 1 to 6; the orchestrator reviews the draft and runs step 7.

1. Copy `specs/_TEMPLATE.md` to `specs/YYYY-MM-DD-<slug>.md` (today's date, kebab-case slug).
2. Fill every section, or write `N/A` with the reason. An empty section is a question you skipped.
3. **Acceptance criteria are observable from outside:** a response, an exit code, a file, a log
   line, a database row, something on screen. "The function handles X" is not a criterion; "a
   request with X returns 422 with error `x_invalid`" is.
4. Each criterion gets a test in the test plan. A criterion with no test is either not a criterion
   or a gap you name.
5. Slice the work: a **tracer slice** first (the thinnest end-to-end path that proves the design),
   then the rest. One slice, one PR.
6. List open questions. Do not answer the user's questions for them.
7. Show the spec to the user and wait for their OK before writing code. Commit it in the first PR
   of the change.

## After delivery

The spec becomes history. Rules that should outlive it move to their owner (a sensor, a check, a
doc; see `docs/harness.md`), and the spec's status becomes `Delivered`.
