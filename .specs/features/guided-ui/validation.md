# Interface guiada e ida/volta Validation

**Date**: 2026-10-09
**Spec**: `.specs/features/guided-ui/spec.md`
**Diff range**: `3cce56a..HEAD` (branch `feat/guided-ui`)
**Verifier**: the author, inline (standalone fallback of `validate.md`). **Not independent**: no sub-agent was dispatched (agents are only spawned on the user's explicit request), so author ≠ verifier is NOT satisfied; the evidence below is re-derived from the tests, but a second pair of eyes (`/code-review`) is still worth running.

## Validation: Interface guiada e ida/volta - PASS ✅

**Result**: PASS (56 of 56 ACs and edge cases with a located assertion; 4 spec-precision gaps flagged; sensor 8/8 killed; gate green)

---

## Task Completion

All 51 tasks of `tasks.md` are done and each is a commit (T1–T51; see the execution notes in `tasks.md` for the three places where the plan was reordered or merged: the async-derivation switch, serialization with the migration, and the reader boundaries).

---

## Spec-Anchored Acceptance Criteria

| ID     | Criterion                                                                              | Evidence: `file:line` + assertion                                                                                                                                                                                                                                      | Result |
| ------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| RET-01 | WHEN o usuário arrasta da alça de volta de B até A e existe uma ida A → B sem volta T… | `tests/unit/return-edit.test.ts:73` - `expect([volta.id, volta.source, volta.target]).toEqual([`ret:${ida.id}`, "b", "a"]);`<br>`tests/unit/return-edit.test.ts:75` - `expect(s().history.length).toBe(before + 1);`                                                   | PASS   |
| RET-02 | IF o usuário arrasta da alça de volta de B até A e não existe ida A → B THEN o canvas… | `tests/unit/return-edit.test.ts:86` - `"A response needs a request: connect Client → App first",`                                                                                                                                                                      | PASS   |
| RET-03 | IF a ida A → B já tem volta THEN arrastar outra volta de B até A SHALL não criar ares… | `tests/unit/return-edit.test.ts:96` - `expect(s().edges).toEqual(edges);`                                                                                                                                                                                              | PASS   |
| RET-04 | The canvas SHALL desenhar a ida e a sua volta como duas linhas paralelas que não se s… | `tests/e2e/return-edge.spec.ts:45` - `).resolves.not.toBe("none");`<br>`tests/e2e/traffic.spec.ts:220` - `expect(await dashArray(page, "load-balancer", "rate-limiter", "ret:")).not.toBe("none");`                                                                    | PASS   |
| RET-05 | The canvas SHALL desenhar uma ida sem volta como uma linha só, sem traço de volta.     | `tests/e2e/return-edge.spec.ts:29` - `await expect(page.locator(RESPONSES)).toHaveCount(0);`                                                                                                                                                                           | PASS   |
| RET-06 | WHILE uma ida não tem volta, o compilador SHALL entregar ao motor a aresta como async… | `tests/unit/compile-returns.test.ts:68` - `expect(byId.get(a.id)!.async).toBe(false);`<br>`tests/unit/compile-returns.test.ts:69` - `expect(byId.get(b.id)!.async).toBe(true);`                                                                                        | PASS   |
| RET-07 | WHEN a volta de uma ida é apagada THEN a ida SHALL passar a async na próxima compilaç… | `tests/unit/compile-returns.test.ts:75` - `expect(compileGraph(nodes, [a]).edges[0].async).toBe(true);`                                                                                                                                                                | PASS   |
| RET-08 | WHEN o usuário apaga uma ida que tem volta THEN o editor SHALL apagar a volta junto, … | `tests/unit/return-edit.test.ts:150` - `expect(s().history).toHaveLength(history + 1);`<br>`tests/e2e/return-edge.spec.ts:54` - `await expect(page.locator(".react-flow__edge")).toHaveCount(0);`                                                                      | PASS   |
| RET-09 | The compilador, o scorer e o advisor SHALL ignorar a volta como chamada: ela não carr… | `tests/unit/compile-returns.test.ts:18` - `expect(graph.cycleIds).toEqual([]);`<br>`tests/unit/returns-consumers.test.ts:45` - `expect(path.onPath).toEqual(["app", "c", "db", "mon"]);`                                                                               | PASS   |
| RET-10 | WHILE a simulação roda ou há um snapshot do Analyze, as bolas de requisição SHALL and… | `tests/unit/flow-balls.test.ts:402` - `expect(requestLines).toEqual(new Set(["a-b", "b-c"]));`<br>`tests/e2e/return-edge.spec.ts:33` - `expect(await ballCount(page, "res")).toBe(0);`                                                                                 | PASS   |
| RET-16 | WHILE a simulação roda ou há um snapshot do Analyze, as bolas de resposta SHALL andar… | `tests/unit/flow-balls.test.ts:381` - `expect(res.drawn).toBe("ret:a-b");`<br>`tests/unit/flow-balls.test.ts:403` - `expect(responseLines).toEqual(new Set(["ret:a-b", "ret:b-c"]));`                                                                                  | PASS   |
| RET-11 | WHEN uma volta é selecionada THEN a aba Props SHALL mostrar "Response to A → B" (rótu… | `tests/e2e/return-edge.spec.ts:92` - `await expect(panel).toContainText("Response to Client → App Server");`                                                                                                                                                           | PASS   |
| RET-12 | WHEN o usuário escolhe "Sync" no menu de contexto ou em Props de uma ida sem volta TH… | `tests/unit/return-edit.test.ts:195` - `expect(responseOf(s().edges).get(ida.id)?.id).toBe(`ret:${ida.id}`);`<br>`tests/e2e/return-edge.spec.ts:111` - `await menu.getByRole("menuitemradio", { name: "Sync", exact: true }).click();`                                 | PASS   |
| RET-13 | WHEN o usuário escolhe "Async" no menu de contexto ou em Props de uma ida com volta T… | `tests/unit/return-edit.test.ts:163` - `expect(s().edges.map((e) => e.id)).toEqual([ida.id]);`<br>`tests/e2e/return-edge.spec.ts:114` - `await menu.getByRole("menuitemradio", { name: "Async", exact: true }).click();`                                               | PASS   |
| RET-14 | WHILE a aba ativa é somente leitura, o canvas SHALL não mostrar a alça de volta.       | `tests/e2e/return-edge.spec.ts:126` - `await expect(handle).toHaveCSS("opacity", "0");`<br>`tests/e2e/return-edge.spec.ts:127` - `await expect(handle).toHaveAttribute("aria-hidden", "true");`                                                                        | PASS   |
| RET-17 | WHILE a aba ativa é somente leitura, o menu de contexto e Props SHALL desabilitar Syn… | `tests/unit/editor.test.ts:190` - `setEdgeSync: ["a->b", true],`<br>`tests/unit/return-edit.test.ts:84` - `expect(s().history).toHaveLength(0);`                                                                                                                       | PASS   |
| RET-15 | WHEN um nó está expandido em cards de instância THEN o canvas SHALL desenhar a volta … | `tests/unit/instance-graph.test.ts:117` - `expect(responses).toHaveLength(3);`                                                                                                                                                                                         | PASS   |
| RET-20 | WHEN um design v3 é migrado THEN `migrateGraphV3toV4` SHALL criar uma volta para cada… | `tests/unit/persistence.migrate.test.ts:460` - `expect([...responses.keys()].sort()).toEqual(["e-app-db", "e-client-app"]);`                                                                                                                                           | PASS   |
| RET-21 | The migração v3 → v4 SHALL ser pura, idempotente e nunca lançar exceção, e SHALL deix… | `tests/unit/persistence.migrate.test.ts:488` - `expect(migrateGraphV3toV4(once)).toEqual(once);`<br>`tests/unit/persistence.migrate.test.ts:468` - `expect(out.nodes).toEqual(g.nodes);`                                                                               | PASS   |
| RET-22 | WHEN um grafo v2 ou v3 é migrado para v4 e compilado THEN o motor SHALL produzir snap… | `tests/unit/persistence.migrate.test.ts:360` - `expect(after.edges).toEqual(before.edges);`<br>`tests/unit/engine-golden.test.ts:128` - `const sim = compileV3(graph.nodes, graph.edges);`                                                                             | PASS   |
| RET-23 | WHEN o usuário exporta um design THEN o JSON SHALL usar `schemaVersion: 4` e carregar… | `tests/unit/persistence.envelope.test.ts:71` - `expect(exported.schemaVersion).toBe(4);`<br>`tests/unit/persistence.envelope.test.ts:428` - `expect(out.edges[1].data).toEqual({ responseTo: "e-a-b" });`                                                              | PASS   |
| RET-24 | WHEN o usuário importa JSON com `schemaVersion` 1, 2, 3 ou 4 (ausente = 1) THEN `impo… | `tests/unit/persistence.envelope.test.ts:413` - `expect(res.design.edges.map((e) => e.id)).toEqual(["e-a-b", "ret:e-a-b"]);`                                                                                                                                           | PASS   |
| RET-25 | WHEN o loader de referência monta uma das 35 soluções THEN ele SHALL criar a volta de… | `tests/unit/reference-returns.test.ts:25` - `expect(responses.has(r.id), `${problem.id}: ${r.id}`).toBe(!isAsync);`                                                                                                                                                    | PASS   |
| RET-26 | WHEN um quick fix do Advisor ou uma mitigação de fault cria uma aresta síncrona THEN … | `tests/unit/advisor-returns.test.ts:20` - `expect(requests.map((e) => responseOf(added).has(e.id))).toEqual([true, true]);`<br>`tests/unit/advisor.test.ts:433` - `expect(useCanvasStore.getState().edges.map((e) => e.id)).toContain("ret:e-app-cache-db");`          | PASS   |
| RET-27 | WHEN `insertBetween` divide um link A → B em A → X → B THEN as duas metades SHALL ter… | `tests/unit/advisor-returns.test.ts:31` - `expect(diff.addEdges.some((e) => e.id.startsWith("ret:"))).toBe(false);`                                                                                                                                                    | PASS   |
| RET-28 | WHEN o usuário copia e cola ou duplica uma seleção THEN o editor SHALL copiar a volta… | `tests/unit/return-edit.test.ts:265` - `expect(copiedRequests.map((r) => answered.has(r.id))).toEqual([true, false]);`                                                                                                                                                 | PASS   |
| RET-29 | The stores persistidos SHALL usar `version: STORE_VERSION` = 4, e `canvasStore` e `sa… | `tests/unit/persistence.versions.test.ts:39` - `expect(STORE_VERSION).toBe(4);`                                                                                                                                                                                        | PASS   |
| WIZ-01 | WHILE o modo é livre, o app SHALL mostrar uma barra com os passos Problem, Design, Si… | `tests/unit/steps.test.ts:33` - `expect([...STEPS]).toEqual(["problem", "design", "simulate", "failures", "evaluate"]);`                                                                                                                                               | PASS   |
| WIZ-02 | WHEN o usuário clica em Next THEN o app SHALL ir ao passo seguinte.                    | `tests/unit/wizard-store.test.ts:20` - `expect(seen.slice(0, 5)).toEqual([...STEPS]);`                                                                                                                                                                                 | PASS   |
| WIZ-03 | WHEN o usuário clica em Back THEN o app SHALL ir ao passo anterior.                    | `tests/unit/wizard-store.test.ts:38` - `expect(app().step).toBe("simulate");`                                                                                                                                                                                          | PASS   |
| WIZ-04 | WHILE o passo atual é o primeiro, o app SHALL desabilitar Back.                        | `tests/unit/wizard-store.test.ts:40` - `expect(app().step).toBe("problem");`<br>`tests/e2e/wizard.spec.ts:46` - `await expect(back(page)).toBeDisabled();`                                                                                                             | PASS   |
| WIZ-15 | WHILE o passo atual é o último, o app SHALL desabilitar Next.                          | `tests/e2e/wizard.spec.ts:61` - `await expect(next(page)).toBeDisabled();`                                                                                                                                                                                             | PASS   |
| WIZ-05 | WHEN o usuário clica na barra num passo anterior ao atual THEN o app SHALL ir a esse … | `tests/unit/wizard-store.test.ts:46` - `expect(app().step).toBe("design");`                                                                                                                                                                                            | PASS   |
| WIZ-06 | IF o usuário clica na barra num passo posterior ao atual THEN o app SHALL não mudar d… | `tests/e2e/wizard.spec.ts:69` - `await expect(failures).toBeDisabled();`                                                                                                                                                                                               | PASS   |
| WIZ-07 | WHILE o passo é Problem, o app SHALL esconder o canvas e mostrar em tela cheia o sele… | `tests/e2e/wizard.spec.ts:31` - `await expect(page.locator(".react-flow")).toHaveCount(0);`<br>`tests/e2e/wizard.spec.ts:33` - `await expect(page.getByTestId("problem-brief")).toBeVisible();`                                                                        | PASS   |
| WIZ-08 | WHILE o passo é Design, Simulate, Failures ou Evaluate, o painel direito SHALL mostra… | `tests/e2e/wizard.spec.ts:53` - `expect((await tabs(page)).sort()).toEqual([...TABS_BY_STEP[step]].sort());`<br>`tests/unit/steps.test.ts:40` - `expect(TOOLS_BY_STEP.evaluate).toEqual(["score", "advisor", "cost", "tradeoffs", "properties"]);`                     | PASS   |
| WIZ-09 | WHILE o passo é Design, o app SHALL mostrar a paleta de componentes; nos demais passo… | `tests/e2e/wizard.spec.ts:58` - `if (step === "design") await expect(palette(page)).toBeVisible();`                                                                                                                                                                    | PASS   |
| WIZ-10 | The app SHALL manter alcançável, em pelo menos um passo, cada ferramenta que existe h… | `tests/unit/steps.test.ts:48` - `expect([...reachable].sort()).toEqual([...ALL_TABS].sort());`                                                                                                                                                                         | PASS   |
| WIZ-11 | WHEN o usuário troca de passo THEN o app SHALL não alterar o grafo, não criar entrada… | `tests/unit/wizard-store.test.ts:60` - `expect(useCanvasStore.getState().history).toBe(canvas.history);`<br>`tests/e2e/wizard.spec.ts:144` - `expect(await saved()).toBe(design);`                                                                                     | PASS   |
| WIZ-12 | WHEN o usuário recarrega a página THEN o app SHALL reabrir no passo em que estava.     | `tests/e2e/wizard.spec.ts:85` - `expect(await currentStep(page)).toBe("failures");`<br>`tests/unit/wizard-store.test.ts:72` - `expect(merge({ step: "nope" }, app() as never)).toMatchObject({ step: "problem" });`                                                    | PASS   |
| WIZ-13 | WHILE a largura é menor que 768 px, a barra de passos SHALL mostrar só o nome do pass… | `tests/e2e/wizard.spec.ts:96` - `await expect(compact.locator("[data-step-count]")).toHaveText("1 / 5");`                                                                                                                                                              | PASS   |
| WIZ-14 | WHEN o tour (Walkthrough) roda THEN cada passo do tour SHALL apontar para um elemento… | `tests/e2e/wizard.spec.ts:183` - `await expect(tour).toContainText("Next to move on");`                                                                                                                                                                                | PASS   |
| WIZ-20 | WHILE uma entrevista está ativa, a barra SHALL mostrar as 6 fases (Requirements, Esti… | `tests/e2e/interview.spec.ts:29` - `/Requirements/,`                                                                                                                                                                                                                   | PASS   |
| WIZ-21 | WHILE a fase atual é uma das fases 1–4, o app SHALL esconder o canvas e mostrar em te… | `tests/e2e/interview.spec.ts:26` - `await expect(page.getByTestId("interview-screen")).toBeVisible();`                                                                                                                                                                 | PASS   |
| WIZ-22 | WHILE a fase atual é High-Level Design, o app SHALL mostrar o canvas com a paleta e a… | `tests/e2e/interview.spec.ts:78` - `await expect(page.getByPlaceholder("Search components...")).toBeVisible();`                                                                                                                                                        | PASS   |
| WIZ-23 | WHILE a fase atual é Deep Dive, o app SHALL mostrar o canvas com o painel do drill e … | `tests/e2e/interview.spec.ts:84` - `await expect(page.getByPlaceholder("Search components...")).toHaveCount(0);`                                                                                                                                                       | PASS   |
| WIZ-24 | WHEN o usuário avança ou volta de fase pela barra THEN o `interviewStore` SHALL acumu… | `tests/unit/interview-store.test.ts:87` - `expect(st().phaseSeconds).toEqual([60, 0, 20]);`                                                                                                                                                                            | PASS   |
| WIZ-25 | IF o usuário clica na barra numa fase posterior à atual THEN o app SHALL não mudar de… | `tests/unit/interview-store.test.ts:79` - `expect(st().currentPhase).toBe(2);`<br>`tests/e2e/interview.spec.ts:72` - `await expect(bar(page).locator('[data-step="Deep Dive"]')).toBeDisabled();`                                                                      | PASS   |
| WIZ-26 | WHEN o usuário conclui com Finish THEN o app SHALL abrir o relatório e SHALL voltar a… | `tests/e2e/interview.spec.ts:112` - `expect(await currentStep(page)).toBe("evaluate");`                                                                                                                                                                                | PASS   |
| WIZ-27 | WHEN o usuário abandona a entrevista THEN o app SHALL voltar aos passos do modo livre… | `tests/unit/interview-store.test.ts:96` - `expect(useAppStore.getState().step).toBe("simulate");`<br>`tests/e2e/interview.spec.ts:140` - `expect(await currentStep(page)).toBe("simulate");`                                                                           | PASS   |
| WIZ-28 | WHEN o usuário recarrega a página durante a entrevista THEN o app SHALL reabrir na me… | `tests/e2e/interview.spec.ts:130` - `await expect(bar(page).locator('[aria-current="step"]')).toHaveText(/Estimation/);`<br>`tests/unit/interview-store.test.ts:52` - `it("keeps time through a background tab and a refresh (timestamps, no tick counting)", () => {` | PASS   |
| RET-30 | IF o usuário arrasta a alça de volta até o próprio nó ou até um nó de texto THEN o ca… | `tests/unit/return-edit.test.ts:103` - `respond("b", "b");`                                                                                                                                                                                                            | PASS   |
| RET-31 | WHEN existem chamadas A → B e B → A (duas idas) THEN cada uma SHALL aceitar a sua pró… | `tests/unit/return-edit.test.ts:118` - `expect(s().edges).toHaveLength(4);`                                                                                                                                                                                            | PASS   |
| RET-32 | IF um JSON importado tem uma volta cuja ida não existe THEN `importDesign` SHALL desc… | `tests/unit/persistence.envelope.test.ts:436` - `expect(res.warnings.some((w) => w.includes("response"))).toBe(true);`                                                                                                                                                 | PASS   |
| WIZ-30 | WHEN o seletor de problema da top bar ou o loader de referência troca o problema fora… | `tests/e2e/wizard.spec.ts:71` - `expect(await currentStep(page)).toBe("simulate");`                                                                                                                                                                                    | PASS   |
| WIZ-31 | WHILE o passo é Problem e a simulação está ao vivo, o app SHALL manter a execução rod… | `tests/e2e/wizard.spec.ts:141` - `expect((await runtime()).playback).toBe("running");`                                                                                                                                                                                 | PASS   |

**Status**: ⚠️ Spec-precision gaps flagged (every AC has a located assertion)

Spec-precision gaps (the test asserts something weaker than the exact outcome the spec words):

1. RET-04 ("duas linhas paralelas que não se sobrepõem"): the e2e asserts that the request and the response are two lines, the response dashed and attached to its request (`tests/e2e/return-edge.spec.ts`, `tests/e2e/traffic.spec.ts`); the non-overlap is a geometric property confirmed by looking at the canvas in the browser (reference solution, with and without a run), not asserted.
2. RET-15 (a copy of the response per instance card): asserted on the pure builder `withInstances` (`tests/unit/instance-graph.test.ts`), not on the rendered cards in the browser.
3. RET-17 (Sync/Async disabled on a read-only tab): the store action is a no-op there (`tests/unit/return-edit.test.ts`, `tests/unit/editor.test.ts`), and the context menu of a read-only edge offers only "Open in panel" by construction (`src/components/canvas/CanvasContextMenu.tsx`); no e2e opens the menu on a reference tab.
4. WIZ-14 ("cada passo do tour aponta para um elemento visível"): the walkthrough is an animated slideshow, not a set of anchored callouts, so the criterion was read as "the tour presents the step bar and describes what is on screen"; the e2e checks that scene and that the app has the five steps.

---

## Discrimination Sensor

Scratch: a temporary git worktree of HEAD (removed afterwards; the real tree's `git status --porcelain` was empty before and after). Baseline in the scratch: green.

| Mutation | File                                | Description                                            | Killed?                                                         |
| -------- | ----------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------- |
| M1       | `src/domain/graph/compile.ts`       | async derived from the response, lookup inverted       | ✅ Killed (`tests/unit/compile-returns.test.ts`, 5 failing)     |
| M2       | `src/store/canvasStore.ts`          | a response without a request no longer shows the toast | ✅ Killed (`tests/unit/return-edit.test.ts`)                    |
| M3       | `src/store/canvasStore.ts`          | deleting a request keeps its response                  | ✅ Killed (`tests/unit/return-edit.test.ts`, 2 failing)         |
| M4       | `src/store/appStore.ts`             | a step ahead becomes reachable                         | ✅ Killed (`tests/unit/wizard-store.test.ts`)                   |
| M5       | `src/lib/steps.ts`                  | Evaluate loses the Cost tab                            | ✅ Killed (`tests/unit/steps.test.ts`, 3 failing)               |
| M6       | `src/domain/persistence/migrate.ts` | the migration answers async calls too                  | ✅ Killed (`tests/unit/persistence.migrate.test.ts`, 3 failing) |
| M7       | `src/lib/flowBalls.ts`              | response balls walk the request line                   | ✅ Killed (`tests/unit/flow-balls.test.ts`, 3 failing)          |
| M8       | `src/store/interviewStore.ts`       | a later interview phase becomes reachable              | ✅ Killed (`tests/unit/interview-store.test.ts`)                |

**Sensor depth**: lightweight (8 behavior-level mutations over the highest-risk code)
**Result**: 8/8 killed - PASS ✅

---

## Gate

Build-level gate from `tasks.md`, run on the final tree:

- `npm run lint`: clean · `npm run format:check`: clean · `npm run typecheck`: clean
- `npm test`: 48 files, 1009 tests passed, 0 failed (948 before the feature)
- `npm run build` ok · `npm run bundle:check`: +7.9% over the baseline (limit +15%, baseline not updated)
- `npm run test:e2e`: all specs pass (a regression of `drill.spec.ts`, still using the removed "Go to phase 6" jump, was found by the last full run and fixed with the `goToDeepDive` helper; see `.specs/LESSONS.md`)
- `engine-golden.test.ts`: fixture untouched (`git diff 3cce56a..HEAD -- tests/unit/fixtures` is empty)

---

## Code Quality

| Principle                                                | Status                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Minimum code                                             | ✅                                                                                          |
| Surgical changes                                         | ✅ (one reorder of the engine/consumer switch to keep every commit green; no engine change) |
| No scope creep                                           | ✅                                                                                          |
| Matches patterns                                         | ✅ (pure modules + stores + `MUTATING_ACTIONS`, `CLAUDE.md` map kept in sync)               |
| Spec-anchored outcome check (asserted values match spec) | ⚠️ 4 precision gaps above                                                                   |
| Per-layer Coverage Expectation met                       | ✅ (domain/stores unit, canvas/panels e2e)                                                  |
| Every test maps to a spec requirement                    | ✅                                                                                          |
| Documented guidelines followed                           | `CLAUDE.md`, `AGENTS.md`                                                                    |

---

## Edge Cases

- [x] RET-30, RET-31, RET-32, WIZ-30, WIZ-31: handled and covered (rows above).
- [x] Tasks that touched presentational components (T25–T29, T38–T44) carry `Tests: none`, covered by the phase's e2e spec (T34, T45, T50) as the matrix states; the user was asked to confirm this and went ahead.

## Known follow-ups (not blocking)

- Interactive UAT in the browser was done by the author on the reference solution (lines, rings, step bar, tabs per step); a human pass over mobile (< 768 px) and over a drawn-by-hand response is still advisable.
