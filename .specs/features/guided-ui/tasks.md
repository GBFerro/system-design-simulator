# Interface guiada e ida/volta Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/guided-ui/design.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `CLAUDE.md` (Commands, Conventions, "unit tests cover pure logic; editor behavior goes in Playwright"), `AGENTS.md`, `vitest.config.*`, `playwright.config.*`.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Domain puro (`domain/graph`, `domain/persistence`, `lib/steps`) | unit | Todos os ramos; 1:1 com os ACs; cada edge case da spec tem teste | `tests/unit/*.test.ts` | `npx vitest run <arquivo>` |
| Store (`canvasStore`, `appStore`, `interviewStore`) | unit | Cada ação nova: caminho feliz, no-op em aba somente leitura, uma entrada de undo | `tests/unit/editor.test.ts`, `persistence.*.test.ts`, `interview-store.test.ts` | `npx vitest run <arquivo>` |
| Advisor / scoring / engine (leitores de arestas) | unit | Resultado idêntico com e sem voltas; golden intocado | `tests/unit/advisor.test.ts`, `scoring.test.ts`, `engine-*.test.ts` | `npm test` |
| Componentes React de canvas e painel | e2e (Playwright), validado também no navegador | Fluxo do usuário: caminho feliz + cada edge case listado | `tests/e2e/*.spec.ts` | `npm run test:e2e` |
| Componentes React de apresentação sem lógica extraível (alças, estilo, textos, layout por passo) | none por task | Cobertos pelo spec e2e que fecha a fase (T30, T41, T46) e verificados no navegador antes do commit; confirmar na aprovação | - | build gate only |
| Docs / config | none | - (build gate only) | - | build gate only |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Após tarefas só com testes unitários | `npm run typecheck && npm test` |
| Full | Após tarefas com e2e | `npm run typecheck && npm test && npm run test:e2e` (com `npm run dev` aberto em :3000, use `E2E_PORT=3000`) |
| Build | Última tarefa de cada fase e tarefas sem teste | `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build && npm run bundle:check` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Modelo da volta e persistência v4

```
T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8
```

### Phase 2: Quem lê arestas passa a ver só idas

```
T9 → T10 → T11 → T12 → T13 → T14 → T15 → T16
```

### Phase 3: Edição da volta no store

```
T17 → T18 → T19 → T20
```

### Phase 4: Canvas, painel e bolinhas

```
T21 → T22 → T23 → T24 → T25 → T26 → T27 → T28 → T29 → T30 → T31
```

### Phase 5: Wizard no modo livre

```
T32 → T33 → T34 → T35 → T36 → T37 → T38 → T39 → T40 → T41
```

### Phase 6: Entrevista no wizard

```
T42 → T43 → T44 → T45 → T46 → T47
```

---

## Task Breakdown

### T1: Criar `returns.ts` (helpers puros da volta)

**What**: Criar `returns.ts` (helpers puros da volta).
**Where**: `src/domain/graph/returns.ts`
**Depends on**: None
**Reuses**: `domain/graph/edgeRules.ts` (`isAsyncEdge`, `newEdgeData`)
**Requirement**: RET-09, RET-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `isReturnEdge`, `returnIdOf`, `makeReturnEdge`, `requestEdges`, `responseOf`, `asyncRequestIds`, `withReturns` exportados
- [ ] Teste: `makeReturnEdge` inverte source/target, usa handles `ret-out`/`ret-in` e id `ret:<ida>`
- [ ] Teste: `asyncRequestIds` devolve só as idas sem volta; `requestEdges` não contém voltas
- [ ] Teste: `withReturns` é idempotente e não cria volta para ida em `async`
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(graph): helpers puros da volta de uma chamada`

---

### T2: `compileGraph` ignora voltas e deriva `async`

**What**: `compileGraph` ignora voltas e deriva `async`.
**Where**: `src/domain/graph/compile.ts`
**Depends on**: T1
**Reuses**: `returns.ts`
**Requirement**: RET-06, RET-07, RET-09, RET-31

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Voltas saem antes do Kahn: sem ciclo, sem aresta `back`, sem carga
- [ ] `SimEdge.async` = ida sem volta (ou `data.async === true` legado)
- [ ] Teste: ida com volta → `async: false`; sem volta → `async: true`; apagar a volta muda para async na próxima compilação
- [ ] Teste: A → B e B → A, cada uma com a sua volta, compilam sem ciclo extra
- [ ] Volta sem ida vira warning, nunca exceção
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(graph): compilador ignora voltas e deriva async da ausência delas`

---

### T3: `migrateGraphV3toV4` e cadeia até v4

**What**: `migrateGraphV3toV4` e cadeia até v4.
**Where**: `src/domain/persistence/migrate.ts`
**Depends on**: T2
**Reuses**: `migrateGraphV2toV3` (forma e testes)
**Requirement**: RET-20, RET-21, RET-22

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Cria `ret:<ida>` para cada aresta entre nós de componente sem `async: true`, nenhuma para as async, e remove o flag
- [ ] Nós de texto, strokes e arestas que tocam nós de texto ficam intactos
- [ ] Puro, idempotente, nunca lança (teste com entradas lixo)
- [ ] `migrateGraph` encadeia v1 → v2 → v3 → v4
- [ ] `engine-golden.test.ts` passa sem alterar o fixture
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(persistence): migração v3 para v4 cria a volta das chamadas síncronas`

---

### T4: `SCHEMA_VERSION` = 4

**What**: `SCHEMA_VERSION` = 4.
**Where**: `src/domain/persistence/version.ts`
**Depends on**: T3
**Reuses**: `store/persistVersion.ts`
**Requirement**: RET-29

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `SCHEMA_VERSION` = 4 e `STORE_VERSION` acompanha
- [ ] `persistence.versions.test.ts` e `persistence.stores.test.ts` passam: `canvasStore` e `savedDesignsStore` migram um estado v3 até v4
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(persistence): sobe o schema para a versão 4`

---

### T5: `serializeEdges`/`deserializeEdges` com `responseTo`

**What**: `serializeEdges`/`deserializeEdges` com `responseTo`.
**Where**: `src/domain/persistence/serialize.ts`
**Depends on**: T4
**Reuses**: `SerializedEdgeData`
**Requirement**: RET-23

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `SerializedEdgeData` ganha `responseTo` e perde `async`
- [ ] Round-trip preserva voltas e `rule` da ida
- [ ] Teste: aresta de volta serializa sem `rule`/`protocol` obrigatórios
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(persistence): serializa a volta como aresta`

---

### T6: Envelope v4: export e import

**What**: Envelope v4: export e import.
**Where**: `src/domain/persistence/envelope.ts`
**Depends on**: T5
**Reuses**: `importDesign` atual
**Requirement**: RET-23, RET-24, RET-32

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Export usa `schemaVersion: 4` com as voltas como arestas
- [ ] `importDesign` aceita 1, 2, 3 e 4 (ausente = 1) e migra até v4, devolvendo `{ ok: true }`
- [ ] Volta sem ida é descartada com aviso em `warnings`
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(persistence): envelope v4 com import de 1 a 4`

---

### T7: Helper de teste `compileV3`

**What**: Helper de teste `compileV3`.
**Where**: `tests/unit/engineFixtures.ts`
**Depends on**: T6
**Reuses**: `wire`/`comp` de `engineFixtures.ts`
**Requirement**: RET-22

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `compileV3(nodes, edges)` = `compileGraph(nodes, withReturns(edges, legacyAsync))` para fixtures que ainda escrevem o flag `async`
- [ ] `wire` continua escrevendo `data.async`; teste do helper cobre sync e async
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: unit
**Gate**: quick

**Commit**: `test(engine): helper compileV3 para fixtures com flag async`

---

### T8: Trocar as chamadas de `compileGraph` dos testes por `compileV3`

**What**: Trocar as chamadas de `compileGraph` dos testes por `compileV3`.
**Where**: `tests/unit (renomeação mecânica; sem mudar nenhum assert)`
**Depends on**: T7
**Reuses**: `compileV3` (T7)
**Requirement**: RET-22

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Toda chamada de `compileGraph` em `tests/unit/*.test.ts` que monta arestas à mão usa `compileV3`
- [ ] Nenhum teste apagado, pulado ou com assert enfraquecido; contagem de testes igual à anterior
- [ ] `npm test` inteiro verde e `engine-golden.test.ts` sem mudança de fixture
- [ ] Gate check passes: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build && npm run bundle:check`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: unit
**Gate**: build

**Commit**: `test(engine): fixtures de teste compilam pelo caminho v4`

---

### T9: `scoring/paths.ts` só com idas

**What**: `scoring/paths.ts` só com idas.
**Where**: `src/scoring/paths.ts`
**Depends on**: None (fase anterior concluída; após T8)
**Reuses**: `asyncRequestIds`
**Requirement**: RET-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Caminho síncrono, profundidade e SPOFs ignoram voltas e usam `asyncRequestIds`
- [ ] Teste: adicionar voltas não muda caminho, profundidade nem SPOFs; ida sem volta fica fora do caminho do usuário
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: unit
**Gate**: quick

**Commit**: `refactor(scoring): caminho síncrono lê só as idas`

---

### T10: `advisor/load.ts` só com idas

**What**: `advisor/load.ts` só com idas.
**Where**: `src/advisor/load.ts`
**Depends on**: T9
**Reuses**: `asyncRequestIds`
**Requirement**: RET-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Troca `isAsyncEdge(e)` por conjunto derivado e ignora voltas
- [ ] Teste: findings de carga idênticos com e sem voltas
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: unit
**Gate**: quick

**Commit**: `refactor(advisor): regras de carga ignoram a volta`

---

### T11: `advisor/patterns.ts` só com idas

**What**: `advisor/patterns.ts` só com idas.
**Where**: `src/advisor/patterns.ts`
**Depends on**: T10
**Reuses**: `asyncRequestIds`
**Requirement**: RET-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Leituras sem cache e trabalho lento no caminho leem só idas
- [ ] Teste: nenhum finding novo por causa de voltas; `advisor.test.ts` continua sem finding acima de info nas referências
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: unit
**Gate**: quick

**Commit**: `refactor(advisor): padrões ignoram a volta`

---

### T12: `advisor/mitigation.ts` só com idas

**What**: `advisor/mitigation.ts` só com idas.
**Where**: `src/advisor/mitigation.ts`
**Depends on**: T11
**Reuses**: `requestEdges`
**Requirement**: RET-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Chamadores de um alvo são só idas síncronas
- [ ] Teste: `mitigation.test.ts` continua verde com voltas no grafo
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: unit
**Gate**: quick

**Commit**: `refactor(advisor): mitigações ignoram a volta`

---

### T13: `topologySignature` inclui as voltas

**What**: `topologySignature` inclui as voltas.
**Where**: `src/lib/topology.ts`
**Depends on**: T12
**Reuses**: `isReturnEdge`
**Requirement**: RET-07

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Assinatura inclui o id da volta: criar ou apagar a volta muda a assinatura
- [ ] Teste: mover nós não muda a assinatura; apagar uma volta muda
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(topology): assinatura reflete a volta`

---

### T14: Remover `isAsyncEdge` por aresta de `edgeRules.ts`

**What**: Remover `isAsyncEdge` por aresta de `edgeRules.ts`.
**Where**: `src/domain/graph/edgeRules.ts`
**Depends on**: T13
**Reuses**: `returns.ts`
**Requirement**: RET-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `isAsyncEdge` removido (ou delega a `returns.ts`) e o uso da linha 136 passa a ler só idas
- [ ] Nenhum chamador restante; `npm run typecheck` limpo
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: unit
**Gate**: quick

**Commit**: `refactor(graph): async deixa de ser um flag por aresta`

---

### T15: `advisor/graph.ts`: diffs com volta

**What**: `advisor/graph.ts`: diffs com volta.
**Where**: `src/advisor/graph.ts`
**Depends on**: T14
**Reuses**: `insertBetween`, `applyDiff`, `GraphDiff`
**Requirement**: RET-26, RET-27

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `GraphDiff` carrega a volta de cada aresta síncrona criada; `applyDiff` a aplica
- [ ] `insertBetween` A → B em A → X → B dá volta às duas metades se e só se o link original tinha
- [ ] Teste: link async continua async depois do fix; `keepLinkOnOut` preservado
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(advisor): quick fixes criam e preservam a volta`

---

### T16: `loadReference` cria a volta das referências

**What**: `loadReference` cria a volta das referências.
**Where**: `src/lib/loadReference.ts`
**Depends on**: T15
**Reuses**: `withReturns`, `newEdgeData`
**Requirement**: RET-25

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Cada aresta da referência sem `async` ganha `ret:<ida>`; `ref.async === true` não ganha
- [ ] Teste: as 35 referências abrem com voltas e seus scores (`scoring.test.ts`, `engine-references.test.ts`) não mudam
- [ ] `data.test.ts` verde
- [ ] Gate check passes: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build && npm run bundle:check`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: unit
**Gate**: build

**Commit**: `feat(reference): referências abrem com as voltas desenhadas`

---

### T17: `onConnect` pela alça de volta

**What**: `onConnect` pela alça de volta.
**Where**: `src/store/canvasStore.ts`
**Depends on**: None (fase anterior concluída; após T16)
**Reuses**: `newEdgeData`, `showToast`
**Requirement**: RET-01, RET-02, RET-03, RET-30, RET-31

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `ret-out` → `ret-in` cria a volta quando existe ida sem volta, numa entrada de undo
- [ ] Sem ida: nenhuma aresta e toast "A response needs a request: connect A → B first" (com rótulos)
- [ ] Volta duplicada, para o próprio nó ou para nó de texto: nada criado e sem entrada de undo
- [ ] Conexão pela alça de ida nasce sem volta e sem `async` no `data`
- [ ] Teste: A → B e B → A com voltas independentes
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(canvas): conectar pela alça de volta cria a resposta de uma chamada`

---

### T18: Apagar a ida apaga a volta

**What**: Apagar a ida apaga a volta.
**Where**: `src/store/canvasStore.ts`
**Depends on**: T17
**Reuses**: `deleteSelection`
**Requirement**: RET-08, RET-07

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Apagar uma ida com volta apaga as duas numa entrada de undo; desfazer traz as duas de volta
- [ ] Apagar só a volta torna a ida async
- [ ] Apagar um nó leva as voltas das suas idas
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(canvas): apagar a chamada apaga a resposta junto`

---

### T19: Ação `setEdgeSync` (Sync/Async)

**What**: Ação `setEdgeSync` (Sync/Async).
**Where**: `src/store/canvasStore.ts`
**Depends on**: T18
**Reuses**: `MUTATING_ACTIONS`
**Requirement**: RET-12, RET-13, RET-17

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `setEdgeSync(id, true)` cria a volta e `false` a apaga, uma entrada de undo cada
- [ ] No-op em aba somente leitura; ação listada em `MUTATING_ACTIONS` (`editor.test.ts` verde)
- [ ] `updateEdgeData(id, { async })` removido e sem chamadores de código
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(canvas): setEdgeSync cria ou apaga a volta`

---

### T20: Copiar, colar e duplicar com a volta

**What**: Copiar, colar e duplicar com a volta.
**Where**: `src/store/canvasStore.ts`
**Depends on**: T19
**Reuses**: `selectionSubgraph`, `cloneSubgraph`
**Requirement**: RET-28

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A volta vai junto quando os dois nós da ida foram copiados
- [ ] Uma volta selecionada sozinha não é colada
- [ ] `missOf` e ids de volta remapeados para a ida clonada
- [ ] Gate check passes: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build && npm run bundle:check`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: unit
**Gate**: build

**Commit**: `feat(canvas): copiar e colar levam a volta junto`

---

### T21: Alças de volta em `ComponentNode`

**What**: Alças de volta em `ComponentNode`.
**Where**: `src/components/canvas/nodes/ComponentNode.tsx`
**Depends on**: None (fase anterior concluída; após T20)
**Reuses**: `Handle` atual
**Requirement**: RET-14, RET-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Alças `ret-out` (source, esquerda) e `ret-in` (target, direita) abaixo das principais
- [ ] Escondidas em aba somente leitura (`useIsActiveTabReadOnly`); tamanho fixo (sem re-medir)
- [ ] Gate check passes: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build && npm run bundle:check`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: none
**Gate**: build

**Commit**: `feat(canvas): alças de volta no nó`

---

### T22: Alças de volta em `InstanceNode`

**What**: Alças de volta em `InstanceNode`.
**Where**: `src/components/canvas/nodes/InstanceNode.tsx`
**Depends on**: T21
**Reuses**: `ComponentNode` (T21)
**Requirement**: RET-15

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Mesmas alças nos cards de instância
- [ ] Tamanho fixo dos cards preservado
- [ ] Gate check passes: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build && npm run bundle:check`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: none
**Gate**: build

**Commit**: `feat(canvas): alças de volta nos cards de instância`

---

### T23: `AnimatedEdge`: volta tracejada com seta em quem chamou

**What**: `AnimatedEdge`: volta tracejada com seta em quem chamou.
**Where**: `src/components/canvas/edges/AnimatedEdge.tsx`
**Depends on**: T22
**Reuses**: `lib/particles.ts` (largura e cor)
**Requirement**: RET-04, RET-05

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Ida contínua com seta no alvo; volta tracejada com seta em quem chamou, sem sobreposição
- [ ] Ida sem volta desenha uma linha só
- [ ] Largura e cor da volta lidas da ida (`useEdgeRuntime`); volta sem rótulo editável
- [ ] Gate check passes: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build && npm run bundle:check`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: none
**Gate**: build

**Commit**: `feat(canvas): desenha a volta como linha tracejada paralela`

---

### T24: `instanceGraph`: voltas por card

**What**: `instanceGraph`: voltas por card.
**Where**: `src/components/canvas/instanceGraph.ts`
**Depends on**: T23
**Reuses**: `instanceEdgeId`
**Requirement**: RET-15

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Cada cópia de ida por card ganha a cópia da sua volta
- [ ] Teste: nó expandido com N cards gera N idas e N voltas, ids determinísticos
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(canvas): voltas por card de instância`

---

### T25: `DesignCanvas`: conexão válida e somente leitura

**What**: `DesignCanvas`: conexão válida e somente leitura.
**Where**: `src/components/canvas/DesignCanvas.tsx`
**Depends on**: T24
**Reuses**: `isValidConnection`
**Requirement**: RET-14, RET-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `ret-out` só liga a `ret-in` e as alças principais só entre si
- [ ] Em aba somente leitura nenhuma alça de volta é conectável
- [ ] Gate check passes: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build && npm run bundle:check`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: none
**Gate**: build

**Commit**: `feat(canvas): valida conexões de volta`

---

### T26: `flowBalls`: resposta anda na linha da volta

**What**: `flowBalls`: resposta anda na linha da volta.
**Where**: `src/lib/flowBalls.ts`
**Depends on**: T25
**Reuses**: `len − pos` de `respond`
**Requirement**: RET-10, RET-16

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Recebe o mapa ida → volta; bola `res` percorre o caminho da volta, `req` o da ida
- [ ] Teste: nenhuma bola `res` anda sobre a ida; ida sem volta não gera `res`; contadores `balls-req`/`balls-res` coerentes
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(flow): bolas de resposta andam na linha da volta`

---

### T27: `FlowParticles`: caminhos da volta

**What**: `FlowParticles`: caminhos da volta.
**Where**: `src/components/canvas/FlowParticles.tsx`
**Depends on**: T26
**Reuses**: `getPointAtLength` e cache por `d`
**Requirement**: RET-10, RET-16

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Amostra o path renderizado de `ret:<ida>` e o entrega ao `flowBalls`
- [ ] Sem snapshot ou com `prefers-reduced-motion`, nada novo é desenhado
- [ ] Gate check passes: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build && npm run bundle:check`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: none
**Gate**: build

**Commit**: `feat(flow): partículas usam o caminho da volta`

---

### T28: Aba Props: volta selecionada e Sync/Async

**What**: Aba Props: volta selecionada e Sync/Async.
**Where**: `src/components/panel/RightPanel.tsx`
**Depends on**: T27
**Reuses**: `updateEdgeData`, `ParamsForm`
**Requirement**: RET-11, RET-12, RET-13, RET-17

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Volta selecionada mostra "Response to A → B", nenhum campo editável e o botão que seleciona a ida
- [ ] Sync/Async chamam `setEdgeSync`; desabilitados em aba somente leitura
- [ ] Marca de async lida da ausência da volta
- [ ] Gate check passes: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build && npm run bundle:check`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: none
**Gate**: build

**Commit**: `feat(panel): Props mostra a resposta e o atalho Sync/Async`

---

### T29: Menu de contexto: Sync/Async pela volta

**What**: Menu de contexto: Sync/Async pela volta.
**Where**: `src/components/canvas/CanvasContextMenu.tsx`
**Depends on**: T28
**Reuses**: `setEdgeSync`
**Requirement**: RET-12, RET-13, RET-17

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Sync/Async do menu chamam `setEdgeSync`; desabilitados em aba somente leitura
- [ ] Menu de uma volta oferece selecionar a ida e apagar
- [ ] Gate check passes: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build && npm run bundle:check`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: none
**Gate**: build

**Commit**: `feat(canvas): menu de contexto Sync/Async desenha ou apaga a volta`

---

### T30: E2E da ida e volta

**What**: E2E da ida e volta.
**Where**: `tests/e2e/return-edge.spec.ts`
**Depends on**: T29
**Reuses**: `helpers.ts` (`open`, `quickAdd`, `connect`)
**Requirement**: RET-01, RET-02, RET-03, RET-08, RET-10, RET-13, RET-14, RET-16, RET-31

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Client → Service pela alça de ida: só bolas ●; desenhar a volta: bolas ○ voltam pela segunda linha
- [ ] Volta sem ida mostra o toast; volta duplicada não cria nada
- [ ] Apagar a ida leva a volta; Async no menu apaga a volta; aba de referência sem alça de volta
- [ ] `npm run test:e2e` verde
- [ ] Gate check passes: `npm run typecheck && npm test && npm run test:e2e`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: e2e
**Gate**: full

**Commit**: `test(e2e): ida e volta como duas linhas`

---

### T31: `CLAUDE.md`: invariante da ida e volta

**What**: `CLAUDE.md`: invariante da ida e volta.
**Where**: `CLAUDE.md`
**Depends on**: T30
**Reuses**: Seção "Canvas/UI" e "Persistence schema"
**Requirement**: RET-29

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Documenta a volta (`ret:<id>`, `responseTo`), `async` derivado, schema v4 e `returns.ts` no mapa
- [ ] `claude-map.test.ts` verde
- [ ] Gate check passes: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build && npm run bundle:check`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: unit
**Gate**: build

**Commit**: `docs(claude): ida e volta e schema v4`

---

### T32: Definição pura dos passos

**What**: Definição pura dos passos.
**Where**: `src/lib/steps.ts`
**Depends on**: None (fase anterior concluída; após T31)
**Reuses**: `RightTab` de `appStore.ts`
**Requirement**: WIZ-01, WIZ-08, WIZ-09, WIZ-10

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `STEPS`, `TOOLS_BY_STEP`, `canvasVisible`, `paletteVisible`, `sanitizeStep` exportados
- [ ] Teste: tabela da spec (Design: Props, Flow; Simulate: Sim, Flow, Props; Failures: Chaos, SLO, Props; Evaluate: Score, Advisor, Cost, Tradeoffs, Props)
- [ ] Teste: toda aba existente aparece em ao menos um passo e Capacity/Learning Path/seletor ficam no passo Problem
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(wizard): definição pura dos passos e das ferramentas de cada um`

---

### T33: `appStore`: passo persistido

**What**: `appStore`: passo persistido.
**Where**: `src/store/appStore.ts`
**Depends on**: T32
**Reuses**: `persist` + `STORE_VERSION`
**Requirement**: WIZ-02, WIZ-03, WIZ-04, WIZ-15, WIZ-05, WIZ-06, WIZ-11, WIZ-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `step`, `nextStep`, `backStep`, `goToStep(i)` (só atual ou anterior), persistido e sanitizado
- [ ] Back no primeiro e Next no último não mudam o passo
- [ ] Teste: trocar de passo não toca `canvasStore`, `runtimeStore` nem cria entrada de undo
- [ ] Teste: reidratar reabre no passo salvo; valor inválido volta a `problem`
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(wizard): passo do modo livre persistido no appStore`

---

### T34: `StepBar`

**What**: `StepBar`.
**Where**: `src/components/layout/StepBar.tsx`
**Depends on**: T33
**Reuses**: `useIsMobile`, `components/ui`
**Requirement**: WIZ-01, WIZ-02, WIZ-03, WIZ-04, WIZ-15, WIZ-05, WIZ-06, WIZ-13

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Mostra os 5 passos, destaca o atual, Back/Next com disable nos extremos
- [ ] Passo anterior clicável, posterior não
- [ ] Abaixo de 768 px: nome do passo, "n / 5", Back e Next
- [ ] Gate check passes: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build && npm run bundle:check`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: none
**Gate**: build

**Commit**: `feat(layout): barra de passos`

---

### T35: `RightPanel` mostra só as abas do passo

**What**: `RightPanel` mostra só as abas do passo.
**Where**: `src/components/panel/RightPanel.tsx`
**Depends on**: T34
**Reuses**: `TOOLS_BY_STEP`
**Requirement**: WIZ-08, WIZ-10

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Só os `TabsTrigger` do passo; aba ativa fora da lista cai na primeira do passo
- [ ] Trocar de passo não desmonta painéis ao vivo nem para a execução
- [ ] Gate check passes: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build && npm run bundle:check`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: none
**Gate**: build

**Commit**: `feat(panel): painel direito filtra as abas pelo passo`

---

### T36: `ProblemStep` em tela cheia

**What**: `ProblemStep` em tela cheia.
**Where**: `src/components/layout/ProblemStep.tsx`
**Depends on**: T35
**Reuses**: `ProblemSelector`, `LearningPath`, `CapacityCalculator`
**Requirement**: WIZ-07, WIZ-31

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Seletor de problema, enunciado com requisitos, Capacity e Learning Path em tela cheia, rolável no celular
- [ ] Canvas escondido sem desmontar a execução ao vivo
- [ ] Gate check passes: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build && npm run bundle:check`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: none
**Gate**: build

**Commit**: `feat(layout): passo Problem em tela cheia`

---

### T37: `Sidebar` só mostra a paleta no passo Design

**What**: `Sidebar` só mostra a paleta no passo Design.
**Where**: `src/components/sidebar/Sidebar.tsx`
**Depends on**: T36
**Reuses**: `paletteVisible`
**Requirement**: WIZ-09, WIZ-30

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Paleta só no passo Design (e na fase 5 da entrevista); nos outros passos o canvas segue editável
- [ ] Trocar o problema fora do passo Problem mantém o passo atual
- [ ] Gate check passes: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build && npm run bundle:check`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: none
**Gate**: build

**Commit**: `feat(sidebar): paleta só no passo Design`

---

### T38: `AppShell` monta o layout do passo

**What**: `AppShell` monta o layout do passo.
**Where**: `src/components/layout/app-shell.tsx`
**Depends on**: T37
**Reuses**: `StepBar`, `ProblemStep`
**Requirement**: WIZ-01, WIZ-07, WIZ-09, WIZ-10, WIZ-11, WIZ-30, WIZ-31

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `StepBar` no topo, canvas/painel/paleta conforme o passo, `ProblemStep` no passo Problem
- [ ] Controles da top bar (seletor, Simulate, custo, SLO) continuam acessíveis e `smoke.spec.ts` (largura) passa
- [ ] Execução ao vivo continua no passo Problem com o canvas escondido
- [ ] Gate check passes: `npm run typecheck && npm test && npm run test:e2e`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: none
**Gate**: full

**Commit**: `feat(layout): app organizado em passos`

---

### T39: `Walkthrough` apresenta a barra de passos

**What**: `Walkthrough` apresenta a barra de passos.
**Where**: `src/components/Walkthrough.tsx`
**Depends on**: T38
**Reuses**: passos atuais do tour
**Requirement**: WIZ-14

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Um passo do tour aponta para a `StepBar`; nenhum passo aponta para elemento que não existe mais
- [ ] Teste: cada alvo do tour existe no passo em que o tour roda
- [ ] Gate check passes: `npm run typecheck && npm test && npm run test:e2e`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: e2e
**Gate**: full

**Commit**: `feat(tour): tour apresenta a barra de passos`

---

### T40: `HowItWorksDialog` descreve os passos

**What**: `HowItWorksDialog` descreve os passos.
**Where**: `src/components/dialogs/HowItWorksDialog.tsx`
**Depends on**: T39
**Reuses**: texto atual
**Requirement**: WIZ-14

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] O texto descreve os 5 passos e a regra ida/volta/async
- [ ] Nenhuma menção à aba escondida que não existe
- [ ] Gate check passes: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build && npm run bundle:check`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: none
**Gate**: build

**Commit**: `docs(dialogs): como funciona descreve os passos`

---

### T41: E2E do wizard

**What**: E2E do wizard.
**Where**: `tests/e2e/wizard.spec.ts`
**Depends on**: T40
**Reuses**: `helpers.ts`
**Requirement**: WIZ-01, WIZ-02, WIZ-03, WIZ-04, WIZ-15, WIZ-05, WIZ-06, WIZ-07, WIZ-08, WIZ-09, WIZ-11, WIZ-12, WIZ-13, WIZ-30, WIZ-31

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] App limpo abre em Problem em tela cheia e avança até Evaluate só com Next; cada passo mostra só as abas da tabela
- [ ] Passo posterior não é clicável; reload reabre no passo; viewport 390 px mostra "n / 5"
- [ ] Simulação ao vivo continua ao trocar de passo; trocar o problema pela top bar mantém o passo
- [ ] Gate check passes: `npm run typecheck && npm test && npm run test:e2e`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: e2e
**Gate**: full

**Commit**: `test(e2e): wizard de passos do modo livre`

---

### T42: `interviewStore`: navegação só para trás e passo de volta

**What**: `interviewStore`: navegação só para trás e passo de volta.
**Where**: `src/store/interviewStore.ts`
**Depends on**: None (fase anterior concluída; após T41)
**Reuses**: `setPhase`, `leavePhase`
**Requirement**: WIZ-24, WIZ-25, WIZ-27, WIZ-28

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Ir a uma fase posterior pela barra não muda de fase; a fase que se deixa acumula em `phaseSeconds`
- [ ] `startInterview` guarda o passo do modo livre e `endInterview` (abandono) o restaura
- [ ] Teste: reidratar durante a entrevista reabre na mesma fase com o cronômetro correto
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(interview): navegação de fases só para trás e passo restaurado ao abandonar`

---

### T43: `InterviewBar` com as 6 fases na `StepBar`

**What**: `InterviewBar` com as 6 fases na `StepBar`.
**Where**: `src/components/interview/InterviewBar.tsx`
**Depends on**: T42
**Reuses**: `StepBar`
**Requirement**: WIZ-20, WIZ-25

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A barra mostra as 6 fases no lugar dos 5 passos, clicáveis só para as anteriores, com Back/Next
- [ ] Cronômetro e metas por fase continuam
- [ ] Gate check passes: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build && npm run bundle:check`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: none
**Gate**: build

**Commit**: `feat(interview): fases da entrevista na barra de passos`

---

### T44: `AppShell` na entrevista: fases 1–4 em tela cheia

**What**: `AppShell` na entrevista: fases 1–4 em tela cheia.
**Where**: `src/components/layout/app-shell.tsx`
**Depends on**: T43
**Reuses**: `interviewStepOf`, `PhaseForms`
**Requirement**: WIZ-21, WIZ-22, WIZ-23

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Fases 1–4: sem canvas, formulário da fase e guia em tela cheia
- [ ] Fase 5: canvas com paleta e ferramentas de Design+Simulate; fase 6: canvas com `DrillPanel` e Finish
- [ ] Gate check passes: `npm run typecheck && npm test && npm run test:e2e`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: none
**Gate**: full

**Commit**: `feat(layout): fases 1 a 4 da entrevista em tela cheia`

---

### T45: `finishInterview` leva a Evaluate

**What**: `finishInterview` leva a Evaluate.
**Where**: `src/components/interview/finishInterview.ts`
**Depends on**: T44
**Reuses**: `reportStore`, `appStore.setStep`
**Requirement**: WIZ-26

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Finish abre o relatório como hoje e deixa o modo livre no passo Evaluate
- [ ] Teste: `interview-report.test.ts` e `interview-store.test.ts` verdes
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(interview): finalizar volta ao passo Evaluate`

---

### T46: E2E da entrevista no wizard

**What**: E2E da entrevista no wizard.
**Where**: `tests/e2e/interview.spec.ts`
**Depends on**: T45
**Reuses**: `wizard.spec.ts`
**Requirement**: WIZ-20, WIZ-21, WIZ-22, WIZ-23, WIZ-24, WIZ-25, WIZ-26, WIZ-27, WIZ-28

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Requirements em tela cheia sem canvas; o canvas aparece em High-Level Design
- [ ] Fase posterior não é clicável; reload na fase 2 reabre na fase 2; abandonar volta ao passo de antes; Finish abre o relatório e deixa em Evaluate
- [ ] Gate check passes: `npm run typecheck && npm test && npm run test:e2e`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: e2e
**Gate**: full

**Commit**: `test(e2e): entrevista no wizard`

---

### T47: `CLAUDE.md`: invariantes do wizard, mapa e orçamento

**What**: `CLAUDE.md`: invariantes do wizard, mapa e orçamento.
**Where**: `CLAUDE.md`
**Depends on**: T46
**Reuses**: seção "Architecture map" e "Canvas/UI"
**Requirement**: WIZ-10

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Documenta `lib/steps.ts`, `StepBar`, `ProblemStep`, `appStore.step` e a regra "trocar de passo nunca edita o grafo nem a execução"
- [ ] Roda `node scripts/bundle-size.mjs` e registra o crescimento; re-baseline só se o PR fechar uma fase do roadmap
- [ ] `claude-map.test.ts` e `npm run bundle:check` verdes
- [ ] Gate check passes: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build && npm run bundle:check`
- [ ] Contagem de testes igual ou maior que a anterior (nada apagado nem pulado)

**Tests**: unit
**Gate**: build

**Commit**: `docs(claude): wizard de passos e orçamento do bundle`

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6

Phase 1: T1 ------→ T2 ------→ T3 ------→ T4 ------→ T5 ------→ T6 ------→ T7 ------→ T8
Phase 2: T9 ------→ T10 ------→ T11 ------→ T12 ------→ T13 ------→ T14 ------→ T15 ------→ T16
Phase 3: T17 ------→ T18 ------→ T19 ------→ T20
Phase 4: T21 ------→ T22 ------→ T23 ------→ T24 ------→ T25 ------→ T26 ------→ T27 ------→ T28 ------→ T29 ------→ T30 ------→ T31
Phase 5: T32 ------→ T33 ------→ T34 ------→ T35 ------→ T36 ------→ T37 ------→ T38 ------→ T39 ------→ T40 ------→ T41
Phase 6: T42 ------→ T43 ------→ T44 ------→ T45 ------→ T46 ------→ T47
```

Execução estritamente sequencial: um agente (ou worker) faz uma task por vez, em ordem. Cada task termina com gate verde e um commit atômico (Conventional Commits, sem atribuição de IA, conforme `CLAUDE.md`).
