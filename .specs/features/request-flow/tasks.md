# Fluxo da requisição — Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

Regras do repositório que valem em toda tarefa: ler `CLAUDE.md` (invariantes) antes de mexer numa área; commits em Conventional Commits **sem** trailer de co-autoria ou atribuição a IA (`CLAUDE.md`, Conventions); nada de arquivo temporário dentro do repo; `git push` e PR só com autorização explícita.

---

**Spec**: `.specs/features/request-flow/spec.md`
**Design**: `.specs/features/request-flow/design.md`
**Status**: In Progress (Lote A, fases 1–2: T1–T6 ✅)

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `CLAUDE.md` (Commands; "Unit tests cover pure logic … editor behavior goes in Playwright"), `AGENTS.md`, `vitest.config.*`, `playwright.config.*`, `.github/workflows/ci.yml` (lint, format:check, typecheck, test, build, bundle:check, test:e2e).

| Code Layer                                                                                                | Required Test Type | Coverage Expectation                                                                                                                  | Location Pattern                                                | Run Command        |
| --------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------ |
| Domínio puro (`domain/graph`, `engine/core`, `engine/analyze`, `engine/faults`, `advisor/`, `lib/` puros) | unit               | Todos os ramos; 1:1 com os ACs FLW; todo edge case listado tem teste; invariantes da Spec 04 (finito, served ≤ offered, determinismo) | `tests/unit/*.test.ts`                                          | `npm test`         |
| Persistência, migrações e stores (`domain/persistence`, `store/`)                                         | unit               | Cada caminho de versão (v1, v2, v3 → v3), idempotência, round-trip export/import, ações em aba somente leitura e undo                 | `tests/unit/persistence.*.test.ts`, `tests/unit/editor.test.ts` | `npm test`         |
| Dados (`data/problems.ts`, referências)                                                                   | unit               | `data.test.ts`, `scoring.test.ts`, `advisor.test.ts`, `engine-references.test.ts` passam; regra nova "nenhuma aresta cache → banco"   | `tests/unit/data.test.ts`                                       | `npm test`         |
| UI (`components/panel`, `components/canvas`)                                                              | e2e                | Fluxo feliz + edge cases da spec + caminho de erro de cada tela tocada; snapshots sintéticos via `window.__runtimeStore`              | `tests/e2e/*.spec.ts` (helpers de `helpers.ts`)                 | `npm run test:e2e` |
| Documentação (`CLAUDE.md` architecture map)                                                               | unit               | `claude-map.test.ts` passa (todo arquivo de `lib/`, `hooks/`, `store/` no mapa)                                                       | `tests/unit/claude-map.test.ts`                                 | `npm test`         |
| Tipos puros                                                                                               | none               | - (build gate only)                                                                                                                   | -                                                               | build gate only    |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use                                                                            | Command                                                                                                                              |
| ---------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Quick      | Tarefas só com testes unitários (vitest não checa tipos, então o typecheck entra aqui) | `npm run typecheck && npm test`                                                                                                      |
| Full       | Tarefas com e2e                                                                        | `npm run typecheck && npm test && npm run test:e2e` (com `npm run dev` aberto: `E2E_PORT=3000 npm run test:e2e`)                     |
| Build      | Fim de fase / antes de PR                                                              | `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build && npm run bundle:check && npm run test:e2e` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order. As fases 1 a 4 formam o PR 1 do design, a fase 5 o PR 2, a fase 6 o PR 3 e a fase 7 o PR 4.

### Phase 1: Fundação (aditiva, nada muda de comportamento)

```
T1
T2 → T3
```

### Phase 2: Troca do formato da aresta

```
T4 → T5
T4 → T6
```

### Phase 3: Motor

```
T7 → T8 → T10 → T11
T7 → T9 → T10
T7 → T12
T7 → T13
```

### Phase 4: Editor

```
T14 → T15
T14 → T16
```

### Phase 5: Referências, advisor e docs

```
T17 → T18 → T21
T19 → T20 → T21
```

### Phase 6: Bolinhas e badges no canvas

```
T22 → T23 → T24
T25
```

### Phase 7: Trace (aba Fluxo)

```
T26 → T27 → T30 → T31
T26 → T29 → T30
T28 → T30
```

---

## Task Breakdown

#### Phase 1: Fundação

### T1: Golden do motor antes da mudança

**What**: Teste que grava (com `UPDATE_GOLDEN=1`) e depois compara deep-equal o `analyze()` e 50 ticks do `TickSimulator` das 35 referências atuais e de 4 designs sintéticos (retries + timeout, `fraction`, read replica, cache read-through), guardando também o grafo de entrada v2 no fixture.
**Where**: `tests/unit/engine-golden.test.ts` (o fixture gerado fica em `tests/unit/fixtures/`)
**Depends on**: None
**Reuses**: `buildReferenceGraph`, `compileGraph`, `analyze`, `TickSimulator`, padrão de `engine-references.test.ts`
**Requirement**: FLW-32

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] O fixture guarda grafos de entrada v2 congelados (as referências vão mudar na T20) e os resultados; o tamanho fica abaixo de 1 MB (um hash por design é aceito, com o resultado completo para os 4 sintéticos)
- [x] O teste passa na árvore atual e falha se um número do `analyze()` mudar
- [x] Gate check passes: `npm run typecheck && npm test`
- [x] Test count: contagem anterior + os novos (sem remoções)

**Tests**: unit
**Gate**: quick
**Commit**: `test(engine): golden de analyze e tick antes do modelo de chamadas`
**Status**: ✅ Complete

---

### T2: Tipos de chamada, limites e conversão v2 → v3

**What**: Adicionar `EdgeCallKind`, `EdgeCall`, `EdgeRuleV3` e as constantes `MAX_EDGE_CALLS = 8` / `MAX_CALL_STEP = 20`, mais `sanitizeEdgeCalls(raw, fallback, onWarning?)` e `migrateEdgeRuleV2toV3(raw)` puros, sem trocar ainda o `EdgeRule` em uso.
**Where**: `src/domain/graph/edgeRules.ts`
**Depends on**: None
**Reuses**: `clamp`, `RULE_KINDS`, `sanitizeEdgeRule`
**Requirement**: FLW-17, FLW-19, FLW-44, FLW-45, FLW-49

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tipos em `src/domain/components/types.ts`, constantes exportadas só de `edgeRules.ts`
- [x] `migrateEdgeRuleV2toV3` converte o formato achatado em `{ calls: [uma chamada], networkLatencyMs, packetLoss }`, mantém `on_miss`, é idempotente e nunca lança
- [x] Sanitização: mais de `MAX_EDGE_CALLS` → corta e avisa; passo fora de 1..`MAX_CALL_STEP` → limita e avisa; condição desconhecida → `always` e avisa; lista vazia → fallback
- [x] Testes em `edgeRules.test.ts` importam as constantes (nenhum 8 ou 20 literal)
- [x] Gate check passes: `npm run typecheck && npm test`

**Tests**: unit
**Gate**: quick
**Commit**: `feat(graph): tipos de chamada por aresta e conversão de regra v2 para v3`
**Status**: ✅ Complete

---

### T3: `callPlan`: ordem e dependências das chamadas

**What**: Módulo puro `planFor(sourceId, outEdges, targetHasHitRate)` que devolve `CallPlan` (passos, async, `absorbed`, avisos) com as regras 1 a 6 do design.
**Where**: `src/domain/graph/callPlan.ts`
**Depends on**: T2
**Reuses**: ordem de `forwardEdges` (`engine/core/routing.ts:171`)
**Requirement**: FLW-26, FLW-29, FLW-42, FLW-43

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Sem passo explícito, a chamada na posição i fica no passo i + 1 (sequencial, como hoje)
- [x] Com algum passo explícito, chamadas sem passo vão depois do maior passo, uma por passo
- [x] Dois passos iguais formam um grupo paralelo
- [x] `after_miss` com `missOf` inexistente, não chamado pela fonte, ou sem `hitRate` → tratado como `reads` + aviso
- [x] `after_miss` em passo ≤ ao da dependência → passo efetivo = dependência + 1 + aviso
- [x] `absorbed` contém a aresta da chamada ao cache referenciado
- [x] LB e fila: passos ignorados
- [x] `tests/unit/call-plan.test.ts` cobre cada regra; `CLAUDE.md` (Architecture map, `domain/graph`) cita `callPlan.ts`
- [x] Gate check passes: `npm run typecheck && npm test`

**Tests**: unit
**Gate**: quick
**Commit**: `feat(graph): plano de chamadas por nó com passos e dependência de miss`
**Status**: ✅ Complete

---

#### Phase 2: Troca do formato da aresta

### T4: Trocar `EdgeRule` para o formato com `calls`

**What**: `EdgeRule` passa a ser `{ calls, networkLatencyMs, packetLoss }`; `defaultEdgeRule`/`connectEdgeRule`/`sanitizeEdgeRule` (que aceita também o v2 achatado) devolvem o novo formato, e todo leitor de `rule.kind` é adaptado de forma mecânica, iterando chamadas com semântica idêntica à de hoje para uma chamada.
**Where**: `src/domain/components/types.ts` (tipo) e seus leitores apontados pelo `tsc`
**Depends on**: T1, T2
**Reuses**: `sanitizeEdgeCalls`, `migrateEdgeRuleV2toV3` (T2)
**Requirement**: FLW-17

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Leitores adaptados: `routing.ts` (`ruleFactor` = Σ das chamadas), `settle.ts`, `sampler`/`sampleNodesFor` (itera chamadas na ordem atual), `faultView.ts`, `faults/catalog.ts`, `advisor/graph.ts`, `advisor/patterns.ts`, `CanvasContextMenu.tsx`, `RightPanel.tsx`, `AnimatedEdge.tsx`/`GhostEdge.tsx`/`previewGraph.ts`, `loadReference.ts`, `canvasStore.ts`, `migrate.ts`, `serialize.ts`
- [x] Nenhum `as any` ou cast para burlar o tipo
- [x] O golden da T1 passa sem atualizar o fixture (bit-idêntico)
- [x] Todos os testes existentes passam sem mudança de asserção (só ajuste de formato em fixtures de regra)
- [x] Gate check passes: `npm run typecheck && npm test`

**Tests**: unit
**Gate**: quick
**Commit**: `refactor(graph): regra da aresta vira link com lista de chamadas`
**Status**: ✅ Complete

---

### T5: Persistência v3

**What**: `SCHEMA_VERSION` 3, cadeia de migração v1 → v2 → v3 (`migrateGraph`) em `canvasStore` e `savedDesignsStore`, envelope exportando 3 e importando 1, 2 e 3.
**Where**: `src/domain/persistence/migrate.ts`
**Depends on**: T4
**Reuses**: `migrateGraphV1toV2`, `migrateCanvasState`, `migrateSavedDesignsState`, `parseEnvelope`
**Requirement**: FLW-18, FLW-19, FLW-20

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Um design v2 com `cache → DB on_miss` migra sem criar, remover ou mover arestas, e a aresta fica com uma chamada `on_miss`
- [x] A carga por nó no `analyze()` antes e depois da migração é deep-equal
- [x] Migração idempotente (rodar duas vezes = uma); nunca lança com entrada inválida
- [x] Export grava `schemaVersion: 3`; export → import devolve as mesmas chamadas; import de 1, 2 e 3 funciona
- [x] `persistence.versions.test.ts` passa com `STORE_VERSION` 3
- [x] Gate check passes: `npm run typecheck && npm test`

**Tests**: unit
**Gate**: quick
**Commit**: `feat(persistence): schema v3 com chamadas por aresta`
**Status**: ✅ Complete

---

### T6: Store: editar chamadas e remapear `missOf`

**What**: `updateEdgeRule` aceita patch com `calls` (uma entrada de undo, no-op em aba somente leitura), e `pasteClipboard`/`duplicateSelection` remapeiam `missOf` pelo mapa de ids dos nós colados ou o removem.
**Where**: `src/store/canvasStore.ts`
**Depends on**: T4
**Reuses**: `applyEdgeRulePatch`, mapa de ids do paste
**Requirement**: FLW-25, FLW-44

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Editar chamadas empurra exatamente uma entrada de undo; numa aba somente leitura não muda nada
- [x] Patch com `calls: []` é recusado e mantém a última chamada
- [x] Colar fonte + cache juntos remapeia `missOf` para o cache colado; colar sem o cache remove `missOf`
- [x] `editor.test.ts` cobre os quatro casos; `MUTATING_ACTIONS` continua completo
- [x] Gate check passes: `npm run typecheck && npm test`

**Tests**: unit
**Gate**: quick
**Commit**: `feat(editor): editar chamadas da aresta e remapear miss ao colar`
**Status**: ✅ Complete

---

#### Phase 3: Motor

### T7: Compilador gera o plano de chamadas

**What**: `compileGraph` anexa `plan: CallPlan` a cada `SimNode` com saídas e soma os avisos do plano aos `warnings` do grafo.
**Where**: `src/domain/graph/compile.ts`
**Depends on**: T3, T4
**Reuses**: `planFor` (T3), `hitRateOf`
**Requirement**: FLW-42, FLW-43, FLW-46

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Plano presente em todo nó com aresta de saída não-`back`; aresta `back` fica fora do plano (sem carga)
- [x] Avisos de `missOf` inválido e de passo corrigido aparecem em `graph.warnings`
- [x] Resultado continua structured-clone safe (sem `Map`/`Set` no `SimGraph`: `absorbed` como array)
- [x] Testes no `engine-analyze.test.ts` (seção compile); golden da T1 inalterado
- [x] Gate check passes: `npm run typecheck && npm test`

**Tests**: unit
**Gate**: quick
**Commit**: `feat(engine): compilador anexa o plano de chamadas aos nós`
**Status**: ✅ Complete

---

### T8: Roteamento: probabilidade de cada chamada

**What**: `callProbability(call, source, ctx)` e `edgeFactor(edge, source, ctx)` com `after_miss` = r × (1 − h_C × (1 − f_{B→C})).
**Where**: `src/engine/core/routing.ts`
**Depends on**: T7
**Reuses**: `ruleProbability`, `callsOf`, `hitRateOf`
**Requirement**: FLW-09, FLW-13, FLW-14

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `reads`, `writes`, `fraction`, `always` e `on_miss` dão o mesmo valor de hoje
- [x] `after_miss` com h = 0,9, r = 0,9, f = 0 → 0,09; com f = 1 → 0,9
- [x] Com uma chamada só, `edgeFactor` é bit-idêntico ao `ruleFactor` antigo
- [x] Gate check passes: `npm run typecheck && npm test`

**Tests**: unit
**Gate**: quick
**Commit**: `feat(engine): probabilidade por chamada com leituras após miss`
**Status**: ✅ Complete

---

### T9: Settle: falha do cache vira miss

**What**: `settle()` itera as chamadas síncronas; a chamada a um cache em `plan.absorbed` não reduz sucesso nem disponibilidade, e a `after_miss` entra com a probabilidade da T8.
**Where**: `src/engine/core/settle.ts`
**Depends on**: T7
**Reuses**: `callOk`, `probSojournExceeds`
**Requirement**: FLW-12, FLW-16

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Com o cache com availability 0, o sucesso do serviço não cai por causa do cache
- [x] Sem `after_miss`, `success`/`failure`/`avail` iguais aos de hoje (golden)
- [x] Todo número finito e em [0, 1]
- [x] Gate check passes: `npm run typecheck && npm test`

**Tests**: unit
**Gate**: quick
**Commit**: `feat(engine): falha do cache look-aside não derruba a requisição`
**Status**: ✅ Complete

---

### T10: `analyze()`: ponto fixo com chamadas após miss

**What**: O ponto fixo roda também quando o grafo tem `after_miss`, passando a `failure` do `settle` ao `edgeFactor`.
**Where**: `src/engine/analyze.ts`
**Depends on**: T8, T9
**Reuses**: laço de retries (`analyze.ts:296-311`)
**Requirement**: FLW-09, FLW-12, FLW-13, FLW-16

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Client → Service → Redis (`reads`, h 0,9) e Service → DB (`writes` + `after_miss: Redis`) a 10.000 req/s, r 0,9: DB recebe 1.900 req/s (tolerância 1e-6 relativa)
- [x] Com `effects` derrubando o Redis: DB recebe 10.000 req/s e o availability não cai por causa do Redis
- [x] Mesmo grafo + seed → deep-equal; served ≤ offered em todo nó; tudo finito
- [x] Golden da T1 inalterado
- [x] Gate check passes: `npm run typecheck && npm test`

**Tests**: unit
**Gate**: quick
**Commit**: `feat(engine): analyze resolve leituras após miss no ponto fixo`
**Status**: ✅ Complete

---

### T11: Tick: falha do tick anterior nas chamadas após miss

**What**: `TickSimulator` guarda a `failure` do tick anterior e a passa ao `edgeFactor`; `reset()` a limpa.
**Where**: `src/engine/core/tick.ts`
**Depends on**: T10
**Reuses**: padrão de `this.pending`
**Requirement**: FLW-13, FLW-16

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Fault `kill-node` no Redis no meio de uma execução: em ≤ 2 ticks a carga do DB sobe para todas as leituras
- [x] `engine-parity.test.ts` passa também para o design look-aside da T10 (analyze ≈ média do tick)
- [x] Mesmo grafo + seed + faults → snapshots bit-idênticos; golden da T1 inalterado
- [x] Gate check passes: `npm run typecheck && npm test`

**Tests**: unit
**Gate**: quick
**Commit**: `feat(engine): tick aplica leituras após miss com a falha do tick anterior`
**Status**: ✅ Complete

---

### T12: Sampler: passos, paralelo e após miss

**What**: `SampleNode.steps` substitui `edges` para nós de regras; o tempo de um passo é o máximo das chamadas, a falha interrompe os passos seguintes, e `after_miss` sorteia o miss só onde existe.
**Where**: `src/engine/core/sampler.ts`
**Depends on**: T7, T1
**Reuses**: `call()` com retries/timeout, `sampleNodesFor`
**Requirement**: FLW-10, FLW-11, FLW-12, FLW-27, FLW-28, FLW-32

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Novo `tests/unit/engine-sampler.test.ts`: B → C (passo 1, 10 ms), B → E (passo 1, 30 ms), B → D (passo 2, 20 ms), tempos fixos → latência de B = próprio + 50 ms
- [x] Falha no passo 1 → passo 2 não é chamado; a outra chamada do passo 1 conta
- [x] Leitura com hit não chama D; com miss chama D depois de C; C falhando chama D e a requisição não falha
- [x] Golden da T1 inalterado (mesma sequência de sorteios)
- [x] Gate check passes: `npm run typecheck && npm test`

**Tests**: unit
**Gate**: quick
**Commit**: `feat(engine): sampler com passos paralelos e leituras após miss`
**Status**: ✅ Complete

---

### T13: Faults: parcela de escrita por chamada

**What**: `writeShareOf` pondera as chamadas da aresta pela probabilidade de cada uma.
**Where**: `src/engine/faults/catalog.ts`
**Depends on**: T7
**Reuses**: `callProbability` (T8 chega antes na ordem da fase)
**Requirement**: FLW-16

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Aresta `[writes, after_miss]` → parcela de escrita = (1 − r) / ((1 − r) + P(after_miss))
- [x] Aresta de uma chamada → valor de hoje; `engine-chaos.test.ts` passa
- [x] Gate check passes: `npm run typecheck && npm test`

**Tests**: unit
**Gate**: quick
**Commit**: `fix(chaos): parcela de escrita das faults considera cada chamada`
**Status**: ✅ Complete

---

#### Phase 4: Editor

### T14: Specs do formulário e badge das chamadas

**What**: `EDGE_CALL_SPECS` (condição, fração, passo, chamadas por requisição), `EDGE_LINK_SPECS` (latência, perda), rótulos ("Read-through (miss do próprio cache)", "Leituras após miss em…") e `edgeCallsBadge(rule, labelOf)`.
**Where**: `src/domain/graph/edgeRules.ts`
**Depends on**: T4
**Reuses**: `EDGE_RULE_SPECS`, `edgeRuleBadge`
**Requirement**: FLW-08, FLW-14, FLW-15, FLW-26

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Passo limitado por `MAX_CALL_STEP` importado
- [x] Badge: `"writes · miss: Redis"`, `"reads"`, `"×3"`; `null` para `always` × 1
- [x] Testes em `edgeRules.test.ts`
- [x] Gate check passes: `npm run typecheck && npm test`

**Tests**: unit
**Gate**: quick
**Commit**: `feat(graph): formulário e badge das chamadas da aresta`
**Status**: ✅ Complete

---

### T15: `EdgeCallsForm` no painel Props

**What**: Componente que lista as chamadas da aresta selecionada com add/remove, condição "Leituras após miss em…" (só nós com `hitRate` chamados pela fonte) e passo; materializa os passos do nó via `applyGraphEdit` no primeiro passo explícito.
**Where**: `src/components/panel/EdgeCallsForm.tsx`
**Depends on**: T14
**Reuses**: `ParamsForm`, `styles.ts`, `updateEdgeRule`, `applyGraphEdit`, `useIsActiveTabReadOnly`
**Requirement**: FLW-08, FLW-17, FLW-25, FLW-26, FLW-44

**Tools**:

- MCP: `chrome-devtools` (verificar no browser)
- Skill: NONE

**Done when**:

- [x] Plugado no bloco "Call rule" de `RightPanel.tsx`, substituindo o `ParamsForm` da regra
- [x] "Adicionar" desabilitado em `MAX_EDGE_CALLS`; "Remover" desabilitado na última chamada
- [x] Opção "após miss" ausente quando a fonte não chama nenhum cache
- [x] Em aba somente leitura os campos ficam desabilitados
- [x] e2e em `tests/e2e/editor.spec.ts`: adicionar "escritas" + "após miss" numa aresta, desfazer com um undo, aba de referência sem edição
- [x] Gate check passes: `npm run typecheck && npm test && npm run test:e2e`

**Tests**: e2e
**Gate**: full
**Commit**: `feat(panel): editor de chamadas da aresta`
**Status**: ✅ Complete

---

### T16: Menu de contexto com várias chamadas

**What**: Com uma chamada, o menu de contexto edita como hoje; com mais de uma, mostra "Editar chamadas no painel", que seleciona a aresta e abre a aba Props.
**Where**: `src/components/canvas/CanvasContextMenu.tsx`
**Depends on**: T14
**Reuses**: `EDGE_CALL_SPECS`, `selectOnly`
**Requirement**: FLW-17, FLW-25

**Tools**:

- MCP: `chrome-devtools`
- Skill: NONE

**Done when**:

- [x] e2e: aresta com uma chamada troca a condição pelo menu; aresta com duas mostra o atalho para o painel
- [x] Gate check passes: `npm run typecheck && npm test && npm run test:e2e`

**Tests**: e2e
**Gate**: full
**Commit**: `feat(canvas): menu de contexto remete arestas com várias chamadas ao painel`
**Status**: ✅ Complete

---

#### Phase 5: Referências, advisor e docs

### T17: Padrão de conexão look-aside

**What**: `connectEdgeRule` devolve `[writes, after_miss(missOf: cache)]` quando a fonte é um serviço, o alvo é um banco e a fonte já chama um nó com `hitRate`; o padrão de saída de cache/CDN continua `on_miss` (read-through).
**Where**: `src/domain/graph/edgeRules.ts`
**Depends on**: T4
**Reuses**: `isCaller`, `hasReadReplica`
**Requirement**: FLW-24

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Conectar Service → SQL DB com Service → Redis existente gera as duas chamadas
- [x] Sem cache, o padrão é o de hoje (`always`, ou `writes` com read replica)
- [x] Testes em `edgeRules.test.ts`
- [x] Gate check passes: `npm run typecheck && npm test`

**Tests**: unit
**Gate**: quick
**Commit**: `feat(graph): conectar serviço a banco com cache já usa look-aside`
**Status**: ✅ Complete

---

### T18: Fix "add cache" do advisor em look-aside

**What**: `readCacheDiff` cria a chamada `reads` ao cache e troca a aresta do leitor ao banco por `[writes, after_miss]` (ou só `after_miss` se ela era só `reads`), sem aresta cache → banco.
**Where**: `src/advisor/patterns.ts`
**Depends on**: T17
**Reuses**: `newEdge`, `GraphDiff`, `applyGraphEdit`
**Requirement**: FLW-23

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `advisor.test.ts`: aplicar o fix gera o formato look-aside num único passo de undo e ids derivados (sem aleatório)
- [x] O preview (ghosts) mostra a mesma forma
- [x] Gate check passes: `npm run typecheck && npm test`

**Tests**: unit
**Gate**: quick
**Commit**: `feat(advisor): fix de cache constrói o look-aside`
**Status**: ✅ Complete

---

### T19: Loader de referências resolve `missOf`

**What**: `ReferenceSolution.edges[].rule` aceita `calls`, e `buildReferenceGraph` traduz `missOf` (componentId) para o id do nó.
**Where**: `src/lib/loadReference.ts`
**Depends on**: T4
**Reuses**: `nextInstance`, `newEdgeData`
**Requirement**: FLW-21

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Tipo em `src/types/problem.ts` atualizado
- [ ] Referência sintética com `missOf: "cache"` resolve para o nó do cache; componentId inexistente → `missOf` removido + aviso do compilador
- [ ] Teste em `data.test.ts` ou `persistence.migrate.test.ts`
- [ ] Gate check passes: `npm run typecheck && npm test`

**Tests**: unit
**Gate**: quick
**Commit**: `feat(data): referências declaram chamadas com miss por componente`

---

### T20: Referências em look-aside

**What**: Os 30 pares cache → banco de `problems.ts` viram serviço → cache `reads` + serviço → banco `[writes, after_miss: cache]`, com right-size e `budgetMonthlyUsd` recalibrados onde saírem da faixa.
**Where**: `src/data/problems.ts`
**Depends on**: T19, T10, T12
**Reuses**: convenções de "Data conventions" do `CLAUDE.md`
**Requirement**: FLW-21, FLW-22

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Novo teste em `data.test.ts`: nenhuma referência tem aresta de nó com `hitRate` para banco, exceto CDN → origem (read-through legítimo)
- [ ] `data.test.ts` (SLO, orçamento em [b/1,5, b/1,3]), `scoring.test.ts` (≥ 16), `advisor.test.ts` e `engine-references.test.ts` passam
- [ ] Golden da T1 inalterado (lê grafos congelados)
- [ ] Gate check passes: `npm run typecheck && npm test`

**Tests**: unit
**Gate**: quick
**Commit**: `fix(data): referências usam cache look-aside`

---

### T21: `CLAUDE.md` e specs com o modelo de chamadas

**What**: Atualizar no `CLAUDE.md` as invariantes do motor (chamadas, passos, após miss, ponto fixo), as convenções de arestas de referência (look-aside novo), o padrão de conexão e o mapa; atualizar `docs/03` (regras de aresta) e `docs/04` (roteamento e sampler).
**Where**: `CLAUDE.md`
**Depends on**: T18, T20
**Reuses**: texto atual das seções
**Requirement**: FLW-21, FLW-24

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Nenhuma menção restante a "cache → its database (default `on_miss`)" como padrão das referências
- [ ] `claude-map.test.ts` passa
- [ ] Gate de build da fase passa antes de abrir o PR 2
- [ ] Gate check passes: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build && npm run bundle:check && npm run test:e2e`

**Tests**: unit
**Gate**: build
**Commit**: `docs: modelo de chamadas e cache look-aside no CLAUDE.md e nas specs`

---

#### Phase 6: Bolinhas e badges no canvas

### T22: `readRatio` no snapshot

**What**: `TickSnapshot.global.readRatio` com o read ratio resolvido, no tick e no `steadyStateToSnapshot`.
**Where**: `src/engine/snapshot.ts`
**Depends on**: T11
**Reuses**: `resolveConfig`
**Requirement**: FLW-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Analyze e tick expõem o mesmo valor para o mesmo grafo
- [ ] `pushSnapshot` continua compartilhando `global` quando nada muda
- [ ] Testes em `runtime.test.ts` / `metrics.test.ts`
- [ ] Gate check passes: `npm run typecheck && npm test`

**Tests**: unit
**Gate**: quick
**Commit**: `feat(engine): snapshot expõe o read ratio resolvido`

---

### T23: Bolinhas com frames: ida, espera e volta

**What**: `FlowBalls` com frames por requisição: lança as chamadas passo a passo pelo `callPlan`, espera as respostas, devolve resposta (ok ou erro) pela mesma aresta, async sem volta, ramificação por requisição (classe, regra, `hitRatio`), TTL de frames.
**Where**: `src/lib/flowBalls.ts`
**Depends on**: T22
**Reuses**: `pick`, `dispatch`, quantum adaptativo, `planFor` (T3)
**Requirement**: FLW-01, FLW-03, FLW-05, FLW-06, FLW-07, FLW-31, FLW-47, FLW-48

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `flow-balls.test.ts`: chamada síncrona gera resposta na mesma aresta em sentido inverso; async não gera
- [ ] O passo 2 só sai depois de todas as respostas do passo 1; a resposta à entrada fecha o frame
- [ ] Falha no nó gera burst + resposta de erro; falha de cache referenciado segue para o banco
- [ ] Respostas contam no `MAX_BALLS`; frames voltam a 0 após `FRAME_TTL_SEC` sem spawn; a resposta volta ao card de origem com instâncias expandidas
- [ ] O teste antigo "cache first" é substituído pelo equivalente com passos (nenhum outro removido)
- [ ] Gate check passes: `npm run typecheck && npm test`

**Tests**: unit
**Gate**: quick
**Commit**: `feat(canvas): bolinhas fazem ida e volta em cada chamada`

---

### T24: Desenho das respostas e legenda

**What**: `FlowParticles` desenha `dir: "res"` como anel vazado andando de volta (`len − pos`), erro na cor de erro, e a legenda mostra "requisição ● / resposta ○"; o canvas expõe contagens por direção em `data-balls-req`/`data-balls-res` para o e2e.
**Where**: `src/components/canvas/FlowParticles.tsx`
**Depends on**: T23
**Reuses**: cache de paths, transform do viewport, legenda atual
**Requirement**: FLW-02, FLW-04, FLW-07

**Tools**:

- MCP: `chrome-devtools`
- Skill: `run`

**Done when**:

- [ ] e2e em `traffic.spec.ts`: com a referência do URL Shortener rodando, `data-balls-res` > 0 e a legenda mostra os dois símbolos
- [ ] Com `prefers-reduced-motion`, nenhuma bolinha; arestas async seguem tracejadas
- [ ] Verificado no browser a 60 fps com 100 arestas (critério da Spec 07)
- [ ] Gate check passes: `npm run typecheck && npm test && npm run test:e2e`

**Tests**: e2e
**Gate**: full
**Commit**: `feat(canvas): desenho das respostas e legenda de requisição e resposta`

---

### T25: Badges de passo e de condição nas arestas

**What**: `AnimatedEdge` mostra o passo (`"2"` ou `"2∥"`) e o rótulo de condição (`edgeCallsBadge`, ex. "miss: Redis"), com largura máxima fixa e aviso quando o plano corrigiu algo.
**Where**: `src/components/canvas/edges/AnimatedEdge.tsx`
**Depends on**: None
**Reuses**: `edgeCallsBadge` (T14), `planFor` (T3), badge de protocolo
**Requirement**: FLW-15, FLW-29, FLW-30

**Tools**:

- MCP: `chrome-devtools`
- Skill: NONE

**Done when**:

- [ ] e2e em `editor.spec.ts`: duas chamadas no mesmo passo mostram "1∥"; aresta após miss mostra "miss: <cache>"
- [ ] O badge não muda de tamanho entre ticks (sem re-medição do ReactFlow)
- [ ] Gate check passes: `npm run typecheck && npm test && npm run test:e2e`

**Tests**: e2e
**Gate**: full
**Commit**: `feat(canvas): badges de passo e de condição nas arestas`

---

#### Phase 7: Trace (aba Fluxo)

### T26: Recorder no sampler e `traceRequest`

**What**: `sampleLatency` aceita um `Recorder` opcional; `traceRequest(model, seed, index, cls)` grava eventos de chamada, async e hit/miss com `t0`/`t1`, e o tipo `Trace` vira `RequestTrace`.
**Where**: `src/engine/core/trace.ts`
**Depends on**: None
**Reuses**: `sampleLatency` (T12), `mulberry32`
**Requirement**: FLW-34, FLW-35, FLW-36, FLW-38

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Mesmo modelo + seed + índice → mesmo trace; índices diferentes podem divergir
- [ ] Leitura com miss registra cache `miss`, depois a chamada ao banco; com hit, sem chamada ao banco
- [ ] Async aparece como evento sem `t1`; o total é igual ao fim da última chamada síncrona da entrada
- [ ] Sem recorder, o golden da T1 continua inalterado
- [ ] Gate check passes: `npm run typecheck && npm test`

**Tests**: unit
**Gate**: quick
**Commit**: `feat(engine): trace de uma requisição a partir do sampler`

---

### T27: `traceCanvas` no worker

**What**: `traceCanvas(nodes, edges, { rps, config, cls, index })` em `client.ts`/`worker.ts`, lazy, com fallback em thread.
**Where**: `src/engine/client.ts`
**Depends on**: T26
**Reuses**: `simulateCanvas`, Comlink worker, `analyze`
**Requirement**: FLW-36, FLW-37, FLW-40

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Sem entrada → `events: []` + aviso
- [ ] Teste no `sim-controller.test.ts` (fallback sem `Worker`)
- [ ] `bundle:check` não acusa o motor no chunk inicial
- [ ] Gate check passes: `npm run typecheck && npm test`

**Tests**: unit
**Gate**: quick
**Commit**: `feat(engine): traceCanvas no worker`

---

### T28: Destaque de aresta vindo do trace

**What**: `flowHighlightStore` (não persistido, `useFlowHighlight(edgeId)`, `setFlowHighlight`) e o destaque de traço + sentido no `AnimatedEdge`, exposto como `window.__flowHighlightStore` em dev ou `?e2e`.
**Where**: `src/store/flowHighlightStore.ts`
**Depends on**: None
**Reuses**: padrão de seletor por entidade do `runtimeStore`, exposição de `window.__runtimeStore`
**Requirement**: FLW-39

**Tools**:

- MCP: `chrome-devtools`
- Skill: NONE

**Done when**:

- [ ] Teste unitário do store; mudar o destaque re-renderiza só a aresta afetada
- [ ] e2e: setar o destaque pelo `window` marca `data-edge-highlight="req"`/`"res"` e não cria entrada de undo nem escreve no `canvasStore`
- [ ] `CLAUDE.md` (mapa de `store/`) lista o arquivo; `claude-map.test.ts` passa
- [ ] Gate check passes: `npm run typecheck && npm test && npm run test:e2e`

**Tests**: unit, e2e
**Gate**: full
**Commit**: `feat(canvas): destaque de aresta comandado pelo trace`

---

### T29: Layout do diagrama de sequência

**What**: Função pura `sequenceLayout(trace, labels)` que devolve linhas de vida, setas (chamada, resposta, async), números de passo e marcas de hit/miss com coordenadas.
**Where**: `src/lib/sequenceLayout.ts`
**Depends on**: T26
**Reuses**: `RequestTrace`
**Requirement**: FLW-34, FLW-35

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Uma linha de vida por nó tocado, na ordem do primeiro contato
- [ ] Cada chamada síncrona gera uma seta de ida e uma de volta; async só a de ida; chamada não feita não aparece
- [ ] Numeração na ordem de início
- [ ] `tests/unit/sequence-layout.test.ts`; `CLAUDE.md` (mapa de `lib/`) lista o arquivo
- [ ] Gate check passes: `npm run typecheck && npm test`

**Tests**: unit
**Gate**: quick
**Commit**: `feat(trace): layout puro do diagrama de sequência`

---

### T30: Aba "Fluxo"

**What**: `FlowPanel` (lazy) com Leitura/Escrita, "Outra requisição", o `SequenceDiagram` em SVG, tempos por passo e total quando há snapshot, mensagens de sem-snapshot e sem-entrada, hover/toque que destaca a aresta; registrado no `RightPanel`.
**Where**: `src/components/panel/FlowPanel.tsx`
**Depends on**: T27, T28, T29
**Reuses**: `styles.ts`, `traceCanvas`, `sequenceLayout`, `setFlowHighlight`, `topologySignature`
**Requirement**: FLW-33, FLW-34, FLW-35, FLW-36, FLW-37, FLW-38, FLW-39, FLW-40, FLW-41

**Tools**:

- MCP: `chrome-devtools`
- Skill: `run`

**Done when**:

- [ ] Novo `tests/e2e/flow.spec.ts`: referência do URL Shortener, leitura → passos com cache e banco, monitoramento async sem volta; com Analyze, ms por passo e total; sem snapshot, a mensagem da FLW-37; canvas sem entrada, a mensagem da FLW-40; hover destaca a aresta; funciona em aba somente leitura e no viewport de celular (bottom sheet)
- [ ] Não recalcula a cada tick (só com mudança de topologia ou de snapshot existente/rps)
- [ ] `bundle:check` passa sem re-baseline
- [ ] Gate check passes: `npm run typecheck && npm test && npm run test:e2e`

**Tests**: e2e
**Gate**: full
**Commit**: `feat(panel): aba Fluxo com o diagrama de sequência de uma requisição`

---

### T31: Docs da Spec 07 e do `CLAUDE.md` para bolinhas e trace

**What**: Atualizar no `CLAUDE.md` a seção de runtime (bolinhas com frames, resposta, ramificação por requisição) e o painel (aba Fluxo), e na `docs/07` marcar o OBS-06 como entregue pela aba Fluxo; atualizar o índice em `docs/00`.
**Where**: `CLAUDE.md`
**Depends on**: T30
**Reuses**: texto atual das seções
**Requirement**: FLW-33

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `claude-map.test.ts` passa
- [ ] Gate de build passa antes de abrir o PR 4
- [ ] Gate check passes: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build && npm run bundle:check && npm run test:e2e`

**Tests**: unit
**Gate**: build
**Commit**: `docs: bolinhas de ida e volta e aba Fluxo no CLAUDE.md e na Spec 07`

---

## Phase Execution Map

Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7. As dependências dentro de cada fase estão nos diagramas do Execution Plan; as dependências entre fases apontam sempre para trás.

Execução estritamente sequencial dentro de cada fase, na ordem numérica. Gate de build no fim de cada fase (e antes de cada PR: fim das fases 4, 5, 6 e 7).

**Lotes para sub-agentes (~7 tarefas, fases inteiras):** Lote A = fases 1 e 2 (6 tarefas) · Lote B = fase 3 (7) · Lote C = fases 4 e 5 (8) · Lote D = fase 6 (4) · Lote E = fase 7 (6).

---

## Task Granularity Check

| Task | Scope                                | Status                                                                                                   |
| ---- | ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| T1   | 1 teste + fixture gerado             | ✅ Granular                                                                                              |
| T2   | tipos + 2 funções no mesmo módulo    | ⚠️ OK (coeso: o formato v3)                                                                              |
| T3   | 1 módulo puro                        | ✅ Granular                                                                                              |
| T4   | troca de 1 tipo + leitores mecânicos | ⚠️ Grande de propósito: a troca de tipo precisa ser atômica para o `tsc` ficar verde; sem semântica nova |
| T5   | 1 cadeia de migração                 | ✅ Granular                                                                                              |
| T6   | 2 ações do mesmo store               | ⚠️ OK (coeso: edição de chamadas)                                                                        |
| T7   | 1 função (compile)                   | ✅ Granular                                                                                              |
| T8   | 2 funções irmãs                      | ✅ Granular                                                                                              |
| T9   | 1 função (settle)                    | ✅ Granular                                                                                              |
| T10  | 1 laço (ponto fixo)                  | ✅ Granular                                                                                              |
| T11  | 1 classe, 1 campo                    | ✅ Granular                                                                                              |
| T12  | 1 função (sampler)                   | ✅ Granular                                                                                              |
| T13  | 1 função                             | ✅ Granular                                                                                              |
| T14  | specs + 1 função de badge            | ⚠️ OK (coeso: apresentação das chamadas)                                                                 |
| T15  | 1 componente                         | ✅ Granular                                                                                              |
| T16  | 1 componente                         | ✅ Granular                                                                                              |
| T17  | 1 função                             | ✅ Granular                                                                                              |
| T18  | 1 função                             | ✅ Granular                                                                                              |
| T19  | 1 função + 1 tipo                    | ✅ Granular                                                                                              |
| T20  | 1 arquivo de dados                   | ✅ Granular                                                                                              |
| T21  | docs                                 | ✅ Granular                                                                                              |
| T22  | 1 campo do snapshot                  | ✅ Granular                                                                                              |
| T23  | 1 classe                             | ✅ Granular                                                                                              |
| T24  | 1 componente                         | ✅ Granular                                                                                              |
| T25  | 1 componente                         | ✅ Granular                                                                                              |
| T26  | 1 módulo                             | ✅ Granular                                                                                              |
| T27  | 1 função de cliente                  | ✅ Granular                                                                                              |
| T28  | 1 store + seu leitor                 | ⚠️ OK (o store sem leitor não é testável no e2e)                                                         |
| T29  | 1 função pura                        | ✅ Granular                                                                                              |
| T30  | 1 painel (+ seu SVG)                 | ✅ Granular                                                                                              |
| T31  | docs                                 | ✅ Granular                                                                                              |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body)                         | Diagram Shows                   | Status   |
| ---- | ---------------------------------------------- | ------------------------------- | -------- |
| T1   | None                                           | —                               | ✅ Match |
| T2   | None                                           | —                               | ✅ Match |
| T3   | T2                                             | T2 → T3                         | ✅ Match |
| T4   | T1, T2 (fase 1)                                | início da fase 2                | ✅ Match |
| T5   | T4                                             | T4 → T5                         | ✅ Match |
| T6   | T4                                             | T4 → T6                         | ✅ Match |
| T7   | T3, T4 (fases anteriores)                      | início da fase 3                | ✅ Match |
| T8   | T7                                             | T7 → T8                         | ✅ Match |
| T9   | T7                                             | T7 → T9                         | ✅ Match |
| T10  | T8, T9                                         | T8 → T10, T9 → T10              | ✅ Match |
| T11  | T10                                            | T10 → T11                       | ✅ Match |
| T12  | T7, T1 (fase 1)                                | T7 → T12                        | ✅ Match |
| T13  | T7                                             | T7 → T13                        | ✅ Match |
| T14  | T4 (fase 2)                                    | início da fase 4                | ✅ Match |
| T15  | T14                                            | T14 → T15                       | ✅ Match |
| T16  | T14                                            | T14 → T16                       | ✅ Match |
| T17  | T4 (fase 2)                                    | início da fase 5                | ✅ Match |
| T18  | T17                                            | T17 → T18                       | ✅ Match |
| T19  | T4 (fase 2)                                    | início da fase 5                | ✅ Match |
| T20  | T19, T10, T12 (fase 3)                         | T19 → T20                       | ✅ Match |
| T21  | T18, T20                                       | T18 → T21, T20 → T21            | ✅ Match |
| T22  | T11 (fase 3)                                   | início da fase 6                | ✅ Match |
| T23  | T22                                            | T22 → T23                       | ✅ Match |
| T24  | T23                                            | T23 → T24                       | ✅ Match |
| T25  | None na fase (usa T3, T14 de fases anteriores) | —                               | ✅ Match |
| T26  | None na fase (usa T12)                         | —                               | ✅ Match |
| T27  | T26                                            | T26 → T27                       | ✅ Match |
| T28  | None na fase (usa T25)                         | —                               | ✅ Match |
| T29  | T26                                            | T26 → T29                       | ✅ Match |
| T30  | T27, T28, T29                                  | T27 → T30, T28 → T30, T29 → T30 | ✅ Match |
| T31  | T30                                            | T30 → T31                       | ✅ Match |

---

## Test Co-location Validation

| Task   | Code Layer Created/Modified              | Matrix Requires                                        | Task Says | Status |
| ------ | ---------------------------------------- | ------------------------------------------------------ | --------- | ------ |
| T1     | teste do motor                           | unit                                                   | unit      | ✅ OK  |
| T2     | domínio puro                             | unit                                                   | unit      | ✅ OK  |
| T3     | domínio puro                             | unit                                                   | unit      | ✅ OK  |
| T4     | domínio puro + leitores (UI só mecânico) | unit (UI coberta pelos e2e existentes no gate de fase) | unit      | ✅ OK  |
| T5     | persistência                             | unit                                                   | unit      | ✅ OK  |
| T6     | store                                    | unit                                                   | unit      | ✅ OK  |
| T7–T13 | motor (domínio puro)                     | unit                                                   | unit      | ✅ OK  |
| T14    | domínio puro                             | unit                                                   | unit      | ✅ OK  |
| T15    | UI                                       | e2e                                                    | e2e       | ✅ OK  |
| T16    | UI                                       | e2e                                                    | e2e       | ✅ OK  |
| T17    | domínio puro                             | unit                                                   | unit      | ✅ OK  |
| T18    | advisor (domínio puro)                   | unit                                                   | unit      | ✅ OK  |
| T19    | lib + tipo                               | unit                                                   | unit      | ✅ OK  |
| T20    | dados                                    | unit                                                   | unit      | ✅ OK  |
| T21    | docs                                     | unit (claude-map)                                      | unit      | ✅ OK  |
| T22    | motor                                    | unit                                                   | unit      | ✅ OK  |
| T23    | lib pura                                 | unit                                                   | unit      | ✅ OK  |
| T24    | UI                                       | e2e                                                    | e2e       | ✅ OK  |
| T25    | UI                                       | e2e                                                    | e2e       | ✅ OK  |
| T26    | motor                                    | unit                                                   | unit      | ✅ OK  |
| T27    | motor (cliente)                          | unit                                                   | unit      | ✅ OK  |
| T28    | store + UI                               | unit + e2e                                             | unit, e2e | ✅ OK  |
| T29    | lib pura                                 | unit                                                   | unit      | ✅ OK  |
| T30    | UI                                       | e2e                                                    | e2e       | ✅ OK  |
| T31    | docs                                     | unit (claude-map)                                      | unit      | ✅ OK  |
