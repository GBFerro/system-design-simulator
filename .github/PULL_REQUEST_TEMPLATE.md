## Intent

<!-- What this PR does and why, in two or three sentences. Link the spec if there is one:
specs/YYYY-MM-DD-<slug>.md. CI fails while this section holds only this comment. -->

## Acceptance criteria

<!-- Each criterion and the test that proves it. Every line is a claim the cold audit will try to
refute. Example:
- [ ] 1. <criterion>: `<test file>` > `<test name>` -->

## Changes

<!-- - `path/to/file`: what changed -->

## Verification

<!-- Receipt status from .factory/receipt.json (anything but `passed` means not verified) and its
tree, which must equal `git rev-parse HEAD^{tree}` of the pushed head. Example:
- Receipt: `passed`, tree `<tree sha>`
- Not configured or skipped checks, and why:
- Mutations accepted on purpose (each with its reason), if any: -->

## Project checks

<!-- Tick what applies; delete what does not. The receipt already covers lint, format, typecheck,
unit tests, the build and the bundle budget; e2e runs in CI after it. -->

- [ ] If it closes a roadmap phase: `bundle-baseline.json` was updated (`node scripts/bundle-size.mjs --update`) and the growth is justified here
- [ ] If it touched navigation, layout or handles: ran the whole e2e suite (`bash scripts/verify.sh e2e`), not only the specs of the area
- [ ] Verified the affected flow in the browser (desktop and, if UI, 375px mobile)
- [ ] Any figures / real-world claims in content are accurate and sourced

## Risks and rollback

<!-- What could break, who would notice, and how to undo it (revert, flag, migration back). -->

## Harness change?

<!-- Harness files: sensors/, scripts/, .claude/, lefthook.yml, .lefthook/, factory.config.sh, .github/.
Keep one line:
- No: this PR touches no harness file.
- Yes: this PR changes only the harness, and its owner approved the change. -->
