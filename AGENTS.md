<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Before you start

- **Read `CLAUDE.md`** — it has the architecture map, the engine/scoring/store invariants you must not break, and data conventions. Most subtle bugs here come from violating one of those invariants.
- This app is 100% client-side (no backend). State persists to `localStorage` via Zustand; hydration is deferred to avoid SSR mismatch.
- Verify with `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`, and by exercising flows in the browser. The Commands section of `CLAUDE.md` has the full list (CI also runs the bundle check and Playwright E2E).

## Quick rules of thumb

- Don't add runtime dependencies without a strong reason.
- Don't reintroduce: tick-counting timers, inline `nodeTypes`/`edgeTypes`, presence-only scoring, hover-only touch affordances, or dropping `edge.data` on save.
- Keep each scoring category capped at exactly 20 points.
- Dark theme only. No Claude/AI attribution in commit messages.
