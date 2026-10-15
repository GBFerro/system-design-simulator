# Specs

A spec holds the intent of a change: the problem, the outcome and acceptance criteria that can be
checked from outside the code. Humans own the intent; the agent drafts, the human approves.

## When a spec is required

Any one of these (the `spec-first` skill applies the same trigger):

- more than 2 production files change;
- a public contract changes: API, schema, message or file format, CLI;
- a new module or service appears;
- someone asks for one.

Smaller changes state their criteria in the PR body instead.

## Naming

`specs/YYYY-MM-DD-<slug>.md`, copied from [_TEMPLATE.md](_TEMPLATE.md). The date is the day the
spec was started; the slug is short kebab-case.

## Lifecycle

1. **Draft:** written before code, every section filled or `N/A` with a reason.
2. **Approved:** the human agreed to the criteria. Code starts here.
3. **In progress:** slices ship as separate PRs, the tracer slice first.
4. **Delivered:** the spec becomes history and is not updated again. Guidance that must outlive
   it moves to its owner (a sensor, a check, a doc; see [docs/harness.md](../docs/harness.md)), so
   nobody has to read old specs to know the current rules.
