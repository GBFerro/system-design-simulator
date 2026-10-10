## Summary

<!-- What does this change and why? Link the issue if there is one. -->

## Checklist

- [ ] `npm run lint` and `npm run format:check` pass
- [ ] `npm run build` passes (this also runs the type-check)
- [ ] `npm test` passes; pure-logic changes (scoring, engine) come with a unit test
- [ ] `npm run bundle:check` passes; if this PR closes a roadmap phase, the baseline was updated and the growth is justified here
- [ ] If it touched navigation, layout or handles: ran the whole e2e suite (`npm run test:e2e`), not only the specs of the area
- [ ] Verified the affected flow in the browser (desktop and, if UI, 375px mobile)
- [ ] Any figures / real-world claims in content are accurate and sourced
