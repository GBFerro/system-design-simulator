## Summary

<!-- What does this change and why? Link the issue if there is one. -->

## Checklist

- [ ] `npm run lint` and `npm run format:check` pass
- [ ] `npm run build` passes (this also runs the type-check)
- [ ] `npm test` passes; pure-logic changes (scoring, engine) come with a unit test
- [ ] `npm run bundle:check` passes, or the `bundle-baseline.json` growth is justified in this PR
- [ ] Verified the affected flow in the browser (desktop and, if UI, 375px mobile)
- [ ] Scoring rules still cap each category at exactly 20 points (if touched)
- [ ] Any figures / real-world claims in content are accurate and sourced
