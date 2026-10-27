---
name: cold-audit
description: Adversarially audit a pull request from a fresh context, treating its body as claims to refute and mutating the code to test the tests. Use through the auditor subagent on a draft PR and after every push that changes its head. Never run it in the context that wrote the change.
---

# Cold audit

You are not here to agree. The PR body is a set of claims; your job is to find the ones that are
false and the code the tests do not protect.

## 0. Setup

- Inputs: PR number, base branch, head SHA (full 40 characters), spec path if any.
- `gh pr view <n> --json body,headRefOid,baseRefName` and confirm the head SHA matches what you
  were given. If it does not, audit the current head and say so.
- Record `git status --short` of the main checkout. It must be identical at the end.

## 1. Light path: rebase without patch change

If an earlier verdict exists for a previous head and the branch was only rebased:
`git range-diff <base>...<old-head> <base>...<new-head>`. If every commit pair is marked `=`,
reconfirm: same verdict, new `Head:` line, a note naming the old head. Any `!`, `<` or `>` means a
full audit.

## 2. Ground truth

- Read the diff yourself: `git diff <base>...<head>`. Do not trust the body's summary of it.
- Read the spec, if any, and list its acceptance criteria.
- List every claim in the PR body: behaviors, criteria met, tests added, things "unchanged",
  verification results.

## 3. Trace each claim

For each claim, find the code that makes it true and the test that would fail if it were false.
Cite `file:line`. A claim with no code is a **false claim**; a claim with code but no test is a
**coverage gap**.

## 4. Mutate

- Create a detached worktree outside the repo:
  `git worktree add --detach <temp-dir-outside-the-repo> <head-sha>`.
- For each changed behavior, make one small mutation that should break it (flip a condition,
  drop a branch, change a constant, return early), run the relevant tests there, then revert it.
- **A mutation that leaves every test green is a finding**, unless the PR body already declares
  it as accepted, with the reason.
- Record each mutation: where, what, which tests ran, red or green.
- At the end: `git worktree remove --force <dir>`, then check `git worktree list` and the main
  checkout's `git status --short`.

## 5. Classify

| Class         | Meaning                                                                        |
| ------------- | ------------------------------------------------------------------------------ |
| Verified      | Claim holds; code and a test that fails without it                             |
| False claim   | The body says something the code does not do                                   |
| Coverage gap  | Behavior with no test, or a surviving mutation                                 |
| Inconsistency | Body, spec, code or docs disagree with each other                              |
| Process note  | The line was not followed (no receipt for the head, harness and product mixed) |
| Pre-existing  | A problem not introduced by this PR; reported, not blocking                    |

`FAIL` when there is any false claim, any undeclared surviving mutation, an unmet acceptance
criterion, or harness and product changes mixed in one PR. Otherwise `PASS`.

## 6. Verdict

Your output is the comment body, in exactly this form. `scripts/pr-ready.sh` reads only the first
three lines, compared exactly after stripping CR: line 1 `## Cold audit`, line 2 `Verdict: PASS` or
`Verdict: FAIL`, line 3 `Head: <sha>`. Of the comments whose line 3 names the PR head, the latest
one decides. Nothing below line 3 counts, so a quoted `Verdict: PASS` in the findings never passes.

```text
## Cold audit
Verdict: PASS
Head: <full 40-character head sha>

### Findings
- <class>: <finding> (<file:line>, <evidence>)

### Mutations
| Where | Mutation | Tests run | Result |
|---|---|---|---|

### Claims verified
- <claim>: <file:line>, <test>
```

Write numbers you counted, never estimates.
