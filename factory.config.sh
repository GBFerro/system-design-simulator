# Factory configuration: the only stack-specific file in the harness.
# Sourced by scripts/ and sensors/. Every command runs from the repo root through `bash -c`.
# A command set to "none" is intentionally absent (recorded as not-configured in the receipt).
# Values are single-quoted so `$(...)` inside a command runs at check time, not when sourced.
# A command still holding its template placeholder is a configuration error: verify.sh exits 2.

FACTORY_PROJECT='system-design-simulator'

# Branches the agent never commits to, pushes to or resets (space-separated).
FACTORY_PROTECTED_BRANCHES='main'

# Quality commands. Each must exit non-zero on any problem, warnings included.
FACTORY_LINT_CMD='npm run lint -- --deny-warnings'
FACTORY_FORMAT_CHECK_CMD='npm run format:check'
FACTORY_TYPECHECK_CMD='npm run typecheck'
FACTORY_TEST_CMD='npm test'

# Checks run by scripts/verify.sh, in order. "harness" = sensor tests + scripts/check-harness.sh.
# Any other name reads FACTORY_CHECK_<NAME> ("api-test" -> FACTORY_CHECK_API_TEST), e.g. in a monorepo:
#   FACTORY_CHECKS="harness api-format api-test ui-lint ui-test"
#   FACTORY_CHECK_API_TEST='dotnet test api/src --nologo'
#   build = production build (it type-checks too) + the initial-JS budget against bundle-baseline.json
FACTORY_CHECKS="harness lint format typecheck test build"
FACTORY_CHECK_BUILD='npm run build && npm run bundle:check'

# Playwright e2e is a named check on purpose NOT in FACTORY_CHECKS: it takes minutes and needs a
# browser, too slow for the receipt every push needs. CI runs it after verify (`bash scripts/verify.sh
# e2e`, which writes no receipt), on the production build that verify just made. Run it locally for a
# change to navigation, layout or handles.
FACTORY_CHECK_E2E='npx playwright install chromium >/dev/null && npm run test:e2e'

# Checks run at the end of every agent turn that changed files (sensors/verify-on-stop.sh).
# Keep these fast: seconds, not minutes.
FACTORY_STOP_CHECKS="lint format"

# Test-first sensor (sensors/require-test-first.sh). Empty FACTORY_SOURCE_GLOBS turns it off.
# Globs are bash `case` patterns (`*` also matches `/`), space-separated.
# Candidate tests use {dir} {name} {ext} of the source file and may contain globs; `**` spans
# directories (tests in a separate tree: 'tests/**/{name}Tests.cs').
# The unit tests live flat in tests/unit, named by feature or by file (engine-tick.test.ts,
# slo.test.ts, persistence.migrate.test.ts), so a source file pairs with a test whose name holds its
# own name, before or after a `-` or `.`. UI and data folders are exempt in sensors/test-first-exempt.txt.
FACTORY_SOURCE_GLOBS='src/*.ts src/*.tsx'
FACTORY_TEST_GLOBS='*.test.* *.spec.* tests/*'
FACTORY_TEST_CANDIDATES='tests/unit/**/{name}.test.ts tests/unit/**/{name}.*.test.ts tests/unit/**/*.{name}.test.ts tests/unit/**/*-{name}.test.ts tests/unit/**/{name}-*.test.ts'

# Line cap for AGENTS.md (it loads into every session; context is a cost).
FACTORY_AGENTS_MAX_LINES=120
