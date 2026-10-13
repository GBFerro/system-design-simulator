# Tecnologias dos componentes — Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

Regras do repositório que valem em toda tarefa:

- Ler `CLAUDE.md` (invariantes) e o trecho de `design.md` da área antes de mexer nela.
- Commits em Conventional Commits, mensagem em português como o histórico, **sem** trailer de co-autoria ou atribuição a IA (`CLAUDE.md`, Conventions).
- Nada de arquivo temporário dentro do repo.
- `git push` e PR só com autorização explícita.
- `tests/unit/fixtures/engine-golden.json` nunca é regravado: se o golden quebrar, o código está errado.
- Números de tecnologia vêm da tabela de `design.md` (seção "Tabela de tecnologias"), com fonte, ano, premissas e evidência; nenhum número inventado.

---

**Spec**: `.specs/features/component-technologies/spec.md`
**Design**: `.specs/features/component-technologies/design.md`
**Status**: Approved (2026-10-13)

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `CLAUDE.md` (Commands; "Unit tests cover pure logic … editor behavior goes in Playwright"; regra do e2e inteiro para navegação/layout, L-014), `AGENTS.md`, `vitest.config.*`, `playwright.config.*`, `.github/workflows/ci.yml` (lint, format:check, typecheck, test, build, bundle:check, test:e2e).

| Code Layer                                                                                                             | Required Test Type | Coverage Expectation                                                                                                                                    | Location Pattern                                                        | Run Command        |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------ |
| Dados do catálogo de tecnologias (`domain/components/technologies/*`)                                                  | unit               | Toda tecnologia e classe: fonte `https`, ano, premissas, evidência, números finitos e positivos, preço; lookups e presets 1:1 com TEC-10/11/12          | `tests/unit/technologies.test.ts`, `tests/unit/catalog.test.ts`         | `npm test`         |
| Schema, registry, preço, traits (`domain/components/*`)                                                                | unit               | Todos os ramos de `normalizeTechParams`, `pricingOf`, `isManagedMultiZone`; `generic` idêntico a hoje; edge cases TEC-08/16/39/48/50                    | `tests/unit/technologies.test.ts`, `catalog.test.ts`, `scoring.test.ts` | `npm test`         |
| Motor (`domain/graph/compile.ts`, `engine/core/*`, `engine/analyze.ts`, `engine/snapshot.ts`)                          | unit               | 1:1 com TEC-25…TEC-41/45–48; golden intacto; contagem de sorteios igual para `generic`; invariantes da Spec 04 (finito, served ≤ offered, determinismo) | `tests/unit/engine-tech*.test.ts`, `tests/unit/tech-limits.test.ts`     | `npm test`         |
| Stores e ações (`store/canvasStore.ts`, `lib/nodeFactory.ts`)                                                          | unit               | Cada ação: efeito, uma entrada de undo, no-op igual/somente leitura; lista `MUTATING_ACTIONS`                                                           | `tests/unit/editor.test.ts`, `tests/unit/technologies.test.ts`          | `npm test`         |
| Custo e advisor (`cost/*`, `advisor/*`, `store/advisorStore.ts`)                                                       | unit               | Fórmulas TEC-17/18/51; utilização igual à do motor (TEC-42); sem fix de instâncias quando o limite não escala                                           | `tests/unit/cost.test.ts`, `tests/unit/advisor.test.ts`                 | `npm test`         |
| UI (`components/panel`, `components/sidebar`, `components/canvas`, `components/CommandPalette.tsx`, `components/cost`) | e2e                | Caminho feliz + edge cases da spec + somente leitura de cada tela tocada; snapshots sintéticos via `window.__runtimeStore`                              | `tests/e2e/technologies.spec.ts` (helpers de `helpers.ts`)              | `npm run test:e2e` |
| Documentação (`CLAUDE.md` architecture map, `docs/03-catalogo-de-componentes.md`)                                      | unit               | `claude-map.test.ts` passa                                                                                                                              | `tests/unit/claude-map.test.ts`                                         | `npm test`         |
| Tipos puros                                                                                                            | none               | - (build gate only)                                                                                                                                     | -                                                                       | build gate only    |

## Gate Check Commands

> Generated from codebase - confirm before Execute.

| Gate Level | When to Use                                                                            | Command                                                                                                                              |
| ---------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Quick      | Tarefas só com testes unitários (vitest não checa tipos, então o typecheck entra aqui) | `npm run typecheck && npm test`                                                                                                      |
| Full       | Tarefas com e2e                                                                        | `npm run typecheck && npm test && npm run test:e2e` (com `npm run dev` aberto: `E2E_PORT=3000 npm run test:e2e`)                     |
| Build      | Fim do trabalho / antes de PR                                                          | `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build && npm run bundle:check && npm run test:e2e` |

---

## Execution Plan

Phases are ordered and run sequentially - each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Catálogo de tecnologias (dados puros)

```
T1 → T2
T1 → T3
T1 → T4
T1 → T5
T1 → T6
T1 → T7
```

### Phase 2: Schema, edição, preço e gerenciado (domínio)

```
T2 → T8
T3 → T8
T4 → T8
T5 → T8
T6 → T8
T7 → T8
T8 → T9 → T10 → T13
T10 → T14
T7 → T11
T7 → T12
```

### Phase 3: UI de edição

```
T10 → T15 → T16
T14 → T16
T13 → T17
T13 → T18
T13 → T19
```

### Phase 4: Motor — perfil, limites e matemática

```
T9 → T20 → T21 → T23
T20 → T22
T20 → T23
T23 → T24
T23 → T25
```

### Phase 5: Motor — fluxo no analyze e no tick

```
T21 → T26 → T27 → T28 → T29 → T30
```

### Phase 6: Consumidores, documentação e fechamento

```
T28 → T31
T28 → T32
T11 → T33
T26 → T33
T33 → T34
T33 → T35
T31 → T36
T32 → T36
T34 → T36
T35 → T36
T36 → T37
```

---

## Task Breakdown

### T1: Tipos e consultas do catálogo de tecnologias

**What**: Criar `technologies/types.ts` (`Evidence`, `TechSource`, `TechClass`, `Technology`, `TechMechanics`, conforme `design.md` → Data Models) e `technologies/index.ts` com `technologiesOf`, `getTechnology`, `defaultTechnologyOf`, `classOf`, `techPreset`, `CENTRAL_TYPES`, construídos sobre uma lista `TECHNOLOGIES` que as tarefas T2–T7 preenchem (começa vazia, com `buildTechIndex(list)` puro para teste).
**Where**: `src/domain/components/technologies/index.ts`
**Depends on**: None
**Reuses**: formato de `PRICE_TABLE`/`PricingSpec` (`src/domain/components/pricing.ts`), `PARAM` (`params.ts`)
**Requirement**: TEC-10, TEC-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `tests/unit/technologies.test.ts` cobre, com uma lista de fixture: ordem de `technologiesOf`, `generic` ausente da lista, `classOf` sem id → classe padrão, `techPreset` = capacidade + tempo de serviço + params da tecnologia + params da classe, `defaultTechnologyOf` de tipo sem tecnologia → `undefined`
- [x] Gate check passes: `npm run typecheck && npm test`
- [x] Test count: contagem anterior + os novos (sem remoções)

**Tests**: unit
**Gate**: quick
**Commit**: `feat(catalog): tipos e consultas do catálogo de tecnologias`
**Status**: ✅ Complete

---

### T2: Tecnologias SQL (PostgreSQL, MySQL, Aurora PostgreSQL)

**What**: Dados de PostgreSQL (RDS), MySQL (RDS) e Aurora PostgreSQL (I/O-Optimized) para `sql-db` e `read-replica`, classes db.r6g.large…4xlarge com leitura, escrita (`writeCapacityRps`, `writeServiceTimeMs`), `$/h`, `failoverSec` (90/90/30), `replicationLagMs` (100/100/20), mecânica `sql-primary`, fontes, premissas e evidência por classe, registrados em `TECHNOLOGIES`; padrão PostgreSQL db.r6g.xlarge.
**Where**: `src/domain/components/technologies/sql.ts`
**Depends on**: T1
**Reuses**: tabela SQL de `design.md`
**Requirement**: TEC-10, TEC-11

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `tests/unit/technologies.test.ts` ganha a checagem genérica de TEC-11 (toda tecnologia não-generic: URL `https://`, ano, premissas não vazias, evidência, números finitos e positivos, preço > 0), que roda sobre todas as tecnologias registradas
- [x] Teste confere valores-âncora da tabela (ex.: PostgreSQL db.r6g.xlarge = 40.000 / 0,10 ms leitura, 5.000 / 1,5 ms escrita, $0,45/h; Aurora `failoverSec` 30)
- [x] Gate check passes: `npm run typecheck && npm test`
- [x] Test count: contagem anterior + os novos

**Tests**: unit
**Gate**: quick
**Commit**: `feat(catalog): tecnologias SQL com números de benchmark`
**Status**: ✅ Complete

---

### T3: Tecnologias NoSQL (DynamoDB, Cassandra, ScyllaDB, MongoDB)

**What**: Dados de DynamoDB (gerenciado: cota 40.000 RRU/WRU, partição 3.000 RCU / 1.000 WCU, custo 0,5/1 RRU, $0,125/M RRU e $0,625/M WRU), Cassandra e ScyllaDB (i4i.large…4xlarge, ops de réplica, RF 3, QUORUM), MongoDB (r6g.large…4xlarge, 3 membros, 1 shard, `primary`, `majority`, `replicationRttMs` 2), com fontes, premissas e evidência; padrão DynamoDB.
**Where**: `src/domain/components/technologies/nosql.ts`
**Depends on**: T1
**Reuses**: tabela NoSQL de `design.md`
**Requirement**: TEC-10, TEC-11

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] A checagem de TEC-11 passa para as 4 tecnologias; valores-âncora conferidos (Cassandra i4i.xlarge 16.000 ops de réplica/s, $0,343/h; DynamoDB `perPartition` 3.000/1.000)
- [x] Gate check passes: `npm run typecheck && npm test`
- [x] Test count: contagem anterior + os novos

**Tests**: unit
**Gate**: quick
**Commit**: `feat(catalog): tecnologias NoSQL com consistência e limites por partição`
**Status**: ✅ Complete

---

### T4: Tecnologias de Load Balancer e API Gateway

**What**: Dados de AWS NLB (L4, gerenciado, `lbAlgorithm` só `hash`), AWS ALB (L7, gerenciado, round-robin/least-connections/weighted), HAProxy e Envoy (L7, c6g.large…4xlarge) para `load-balancer`; AWS API Gateway HTTP API (gerenciado, cota 10.000 req/s, burst 5.000, `timeoutMs` 30000, $1,00/M) e Kong (c6g.large…4xlarge) para `api-gateway`; com `layer`, `options`, fontes, premissas e evidência; padrões ALB e AWS API Gateway.
**Where**: `src/domain/components/technologies/edge.ts`
**Depends on**: T1
**Reuses**: tabela de Load Balancer e API Gateway de `design.md`
**Requirement**: TEC-10, TEC-11

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] A checagem de TEC-11 passa para as 6 tecnologias; `options.lbAlgorithm` do NLB = `["hash"]`; cota do API Gateway = 10.000 / 5.000
- [x] Gate check passes: `npm run typecheck && npm test`
- [x] Test count: contagem anterior + os novos

**Tests**: unit
**Gate**: quick
**Commit**: `feat(catalog): tecnologias de load balancer L4/L7 e API gateway`
**Status**: ✅ Complete

---

### T5: Tecnologias de cache (Redis, Memcached)

**What**: Dados de Redis e Memcached no ElastiCache, classes cache.r6g.large…4xlarge (85k/142k/284k/568k ops/s, 0,4 ms, $0,206…1,642/h, mín(CPU, rede a 1 KB)), com fontes, premissas e evidência; padrão Redis cache.r6g.xlarge.
**Where**: `src/domain/components/technologies/cache.ts`
**Depends on**: T1
**Reuses**: tabela de cache de `design.md`
**Requirement**: TEC-10, TEC-11

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] A checagem de TEC-11 passa para as 2 tecnologias; valores-âncora conferidos
- [x] Gate check passes: `npm run typecheck && npm test`
- [x] Test count: contagem anterior + os novos

**Tests**: unit
**Gate**: quick
**Commit**: `feat(catalog): tecnologias de cache com teto de rede`
**Status**: ✅ Complete

---

### T6: Tecnologias de mensageria (Kafka, RabbitMQ, SQS, SNS)

**What**: Dados para `message-queue` (Kafka MSK kafka.m7g._, RabbitMQ Amazon MQ mq.m7g._ com teto por fila, SQS Standard, SQS FIFO com cota 3.000 msgs/s) e `pub-sub` (SNS com cota 30.000 publishes/s, Kafka MSK), com mecânicas `kafka`/`quota`, preços (SQS $1,20/M mensagens, FIFO $1,50/M, SNS $0,50/M), fontes, premissas e evidência; padrões Kafka kafka.m7g.xlarge (6 partições) e SNS.
**Where**: `src/domain/components/technologies/messaging.ts`
**Depends on**: T1
**Reuses**: tabela de mensageria de `design.md`
**Requirement**: TEC-10, TEC-11

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] A checagem de TEC-11 passa para as 6 entradas; cotas de SQS FIFO e SNS conferidas
- [x] Gate check passes: `npm run typecheck && npm test`
- [x] Test count: contagem anterior + os novos

**Tests**: unit
**Gate**: quick
**Commit**: `feat(catalog): tecnologias de fila e pub/sub com cotas`
**Status**: ✅ Complete

---

### T7: Tecnologias de busca e object storage (OpenSearch, S3)

**What**: Dados de OpenSearch (r6g.large…4xlarge.search, 500…4.000 consultas de shard/s, 3 ms, shards 5, replicas 1, `indexCostPerDoc`, mecânica `search-fanout`) e S3 Standard (gerenciado, 5.500 GET e 3.500 PUT por prefixo, 30 ms, $0,40/M GET e $5,00/M PUT), com fontes, premissas e evidência; padrões OpenSearch r6g.xlarge.search e S3.
**Where**: `src/domain/components/technologies/storage.ts`
**Depends on**: T1
**Reuses**: tabela de Search e Object Storage de `design.md`
**Requirement**: TEC-10, TEC-11

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] A checagem de TEC-11 passa para as 2 tecnologias; teste: os 10 `CENTRAL_TYPES` têm tecnologia padrão e as 26 opções da spec existem (contando Read Replica à parte)
- [x] Gate check passes: `npm run typecheck && npm test`
- [x] Test count: contagem anterior + os novos

**Tests**: unit
**Gate**: quick
**Commit**: `feat(catalog): tecnologias de busca e object storage`
**Status**: ✅ Complete

---

### T8: Chaves PARAM e specs de tecnologia e classe

**What**: Adicionar as chaves `technology`, `instanceClass`, `prefixes`, `readPreference`, `writeConcern`, `readConsistency` a `PARAM`, `ParamSpec.optionsFor?: (p) => readonly string[]` em `domain/components/types.ts`, e os builders `technologySpec(componentId)` (enum `generic` + tecnologias, padrão `generic`) e `instanceClassSpec(componentId)` (união das classes do tipo, `optionsFor` = classes da tecnologia, `visibleIf` = cobrança por instância).
**Where**: `src/domain/components/params.ts`
**Depends on**: T2, T3, T4, T5, T6, T7
**Reuses**: builders existentes (`lbAlgorithmSpec`, `hitRateSpec`)
**Requirement**: TEC-01, TEC-14

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Teste: `technologySpec("nosql-db").options` = `generic` + as 4 tecnologias; padrão `generic`; `instanceClassSpec("sql-db").optionsFor({technology:"aurora-postgres"})` = só as classes do Aurora; invisível para tecnologia gerenciada e `generic`
- [x] Nenhuma chave `PARAM` existente renomeada
- [x] Gate check passes: `npm run typecheck && npm test`
- [x] Test count: contagem anterior + os novos

**Tests**: unit
**Gate**: quick
**Commit**: `feat(params): chaves e specs de tecnologia e classe de instância`
**Status**: ✅ Complete

---

### T9: Normalização de params por tecnologia

**What**: `normalizeTechParams(componentId, params)` chamado no fim de `sanitizeParams` só quando `technology ≠ generic`: classe fora da tecnologia → classe padrão; enum fora de `optionsFor` → padrão da tecnologia; params de mecânica fora da faixa → padrão da tecnologia; valor desconhecido de `technology` → `generic` pela validação por chave.
**Where**: `src/domain/components/registry.ts`
**Depends on**: T8
**Reuses**: `isValidParam`, `sanitizeParams`
**Requirement**: TEC-08, TEC-09, TEC-16, TEC-39, TEC-48

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Testes: `technology: "oracle"` → `generic` (TEC-08); Postgres com `instanceClass: "cache.r6g.large"` → `db.r6g.xlarge` (TEC-16); NLB com `lbAlgorithm: "round-robin"` → `hash` (TEC-39); `shards: 5000` num MongoDB → padrão da tecnologia (TEC-48); um nó `generic` sanitiza exatamente como antes (deep-equal com o resultado de hoje para cada schema)
- [x] Teste de round-trip do envelope v4 com `technology`/`instanceClass` em `persistence.envelope.test.ts` (TEC-09), sem mudar `SCHEMA_VERSION`
- [x] Gate check passes: `npm run typecheck && npm test`
- [x] Test count: contagem anterior + os novos

**Tests**: unit
**Gate**: quick
**Commit**: `feat(params): normaliza combinações inválidas por tecnologia`
**Status**: ✅ Complete

---

### T10: Tecnologia nos schemas dos 10 tipos centrais

**What**: Incluir `technologySpec`/`instanceClassSpec` e os params de mecânica nos schemas de `load-balancer`, `api-gateway`, `sql-db`, `read-replica`, `nosql-db` (+ `shards`, `readPreference`, `writeConcern`, `readConsistency`), `cache`, `message-queue`, `pub-sub`, `search`, `object-storage` (+ `prefixes`), com `visibleIf` por tecnologia (consistência só onde existe, TEC-33) e `instances`/`capacityPerInstance` escondidos em tecnologia gerenciada (TEC-51); em `generic` o form é o de hoje.
**Where**: `src/domain/components/schemas/`
**Depends on**: T9
**Reuses**: `defineSchema`, overrides de core params (como `client.ts`)
**Requirement**: TEC-01, TEC-33, TEC-51

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `catalog.test.ts`: cada tipo central tem `technology` com padrão `generic`; os padrões de capacidade/latência do schema seguem iguais a `maxQPS`/`latencyMs` (teste existente intacto)
- [x] Teste de visibilidade: `consistencyLevel` visível só em Cassandra/ScyllaDB, `readConsistency` só em DynamoDB, `prefixes` só em S3, `instances` invisível em DynamoDB/S3/SQS/SNS/API Gateway/NLB/ALB e visível em `generic`
- [x] `engine-golden.test.ts` passa sem mudar a fixture
- [x] Gate check passes: `npm run typecheck && npm test`
- [x] Test count: contagem anterior + os novos

**Tests**: unit
**Gate**: quick
**Commit**: `feat(schemas): tecnologia e classe nos tipos centrais`
**Status**: ✅ Complete

---

### T11: Preço por tecnologia e classe

**What**: `pricingOf(componentId, params): PricingSpec` (com `perMillionReads`/`perMillionWrites` opcionais em `PricingSpec` e `managed` = sem multiplicar por `instances`), devolvendo o preço do schema para `generic`; `PRICE_TABLE.version` 2 e `asOf: "2026-10"` com as fontes novas.
**Where**: `src/domain/components/pricing.ts`
**Depends on**: T7
**Reuses**: `PRICING`, `DEFAULT_PRICING`
**Requirement**: TEC-13, TEC-17

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Testes: `pricingOf("sql-db", {technology:"postgres", instanceClass:"db.r6g.2xlarge"}).perInstanceHour` = 0,899; DynamoDB devolve preços de leitura/escrita e `managed`; `generic` devolve exatamente `getSchema(id).pricing`
- [x] `data.test.ts` (orçamentos das referências) passa sem recalibrar
- [x] Gate check passes: `npm run typecheck && npm test`
- [x] Test count: contagem anterior + os novos

**Tests**: unit
**Gate**: quick
**Commit**: `feat(pricing): preço por tecnologia e classe de instância`
**Status**: ✅ Complete

---

### T12: Tecnologias gerenciadas contam como multi-AZ

**What**: `isManagedMultiZone(componentId, params)` em `domain/components/traits.ts` e troca dos três usos de `MANAGED_MULTI_ZONE.has(...)` (`scoring/paths.ts:17`, `engine/faults/catalog.ts:341`, `lib/instances.ts:78`) pela função.
**Where**: `src/domain/components/traits.ts`
**Depends on**: T7
**Reuses**: `MANAGED_MULTI_ZONE`
**Requirement**: TEC-50

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Testes: um `api-gateway` com AWS API Gateway e 1 instância não é SPOF (`findSpofs`); `zone-failure` não derruba instâncias de um `nosql-db` DynamoDB; um `api-gateway` `generic` com 1 instância continua SPOF
- [x] `scoring.test.ts`, `engine-chaos.test.ts`, `instances.test.ts` e `engine-golden.test.ts` passam sem mudar fixtures
- [x] Gate check passes: `npm run typecheck && npm test`
- [x] Test count: contagem anterior + os novos

> Nota de execução: `findSpofs` ignora tipos `scalable` (o `api-gateway` é), então "generic com 1 instância continua SPOF" é checado pela regra de escalabilidade (tier sem estado com uma instância), onde o gateway de 1 instância perde pontos; `isInherentlyRedundant(data)` substitui o conjunto `INHERENTLY_REDUNDANT` também no advisor (`mitigation.ts`) e em `rules/scalability.ts`.

**Tests**: unit
**Gate**: quick
**Commit**: `feat(traits): tecnologias gerenciadas contam como multi-AZ`
**Status**: ✅ Complete

---

### T13: Criar nó com tecnologia

**What**: `createComponentNode(component, position, technology?)` aplica `techPreset` (e a classe padrão) nos params; sem `technology` o nó fica `generic` como hoje (referências e `componentNodeWithId` inalterados).
**Where**: `src/lib/nodeFactory.ts`
**Depends on**: T10
**Reuses**: `defaultParams`, `techPreset`
**Requirement**: TEC-21, TEC-22

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Testes: criar `nosql-db` com `cassandra` → params com `technology`, `instanceClass` padrão, capacidade e tempo de serviço da classe; sem `technology` → `defaultParams` exatos; `buildReferenceGraph` segue sem `technology` não-generic
- [x] Gate check passes: `npm run typecheck && npm test`
- [x] Test count: contagem anterior + os novos

**Tests**: unit
**Gate**: quick
**Commit**: `feat(editor): cria nós já com a tecnologia escolhida`
**Status**: ✅ Complete

---

### T14: Ações de tecnologia, classe e reset na store

**What**: `setNodeTechnology`, `setNodeInstanceClass` e `resetNodeToBenchmark` no `canvasStore` (uma entrada de undo, no-op se igual ou em aba somente leitura, `generic` mantém os números, preserva `instances` e o que a tecnologia não define), listadas em `MUTATING_ACTIONS`.
**Where**: `src/store/canvasStore.ts`
**Depends on**: T10
**Reuses**: padrão de `updateNodeParams`
**Requirement**: TEC-02, TEC-03, TEC-04, TEC-07, TEC-15, TEC-44

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `editor.test.ts`: troca grava preset e preserva `instances`/`timeoutMs` (TEC-02); mesma tecnologia não cria entrada de undo (TEC-03); → `generic` mantém valores (TEC-04); aba somente leitura = no-op (TEC-07); troca de classe (TEC-15); reset (TEC-44); um undo desfaz cada ação; a checagem de `MUTATING_ACTIONS`/`READ_ONLY_EXEMPT_ACTIONS` passa
- [x] Gate check passes: `npm run typecheck && npm test`
- [x] Test count: contagem anterior + os novos

**Tests**: unit
**Gate**: quick
**Commit**: `feat(store): trocar tecnologia e classe num passo de undo`
**Status**: ✅ Complete

---

### T15: Opções dependentes e chaves omitidas no ParamsForm

**What**: `ParamsForm` filtra opções de enum por `optionsFor(values)` e aceita `omitKeys` (o picker renderiza `technology`/`instanceClass`).
**Where**: `src/components/panel/ParamsForm.tsx`
**Depends on**: T10
**Reuses**: `ParamField`, `visibleIf`
**Requirement**: TEC-39, TEC-33

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `tests/e2e/technologies.spec.ts`: num Load Balancer NLB o select de algoritmo só oferece `hash`; num ALB oferece os 3 suportados; num Cassandra aparece `consistencyLevel` e num DynamoDB não
- [x] Gate check passes: `npm run typecheck && npm test && npm run test:e2e`
- [x] Test count: contagem anterior + os novos

**Tests**: e2e
**Gate**: full
**Commit**: `feat(props): opções de parâmetro dependentes da tecnologia`
**Status**: ✅ Complete

---

### T16: TechnologyPicker no Props

**What**: Componente `TechnologyPicker` (select de tecnologia com camada/modo, select de classe, descrição, consistência/CAP, "Based on: fonte, ano (measured|derived|estimate)" com link, aviso de réplica com tecnologia diferente do primário, "Modified from … / Reset to benchmark", desabilitado em somente leitura), montado em `RightPanel.tsx` acima do `ParamsForm` dos 10 tipos.
**Where**: `src/components/panel/TechnologyPicker.tsx`
**Depends on**: T14, T15
**Reuses**: `styles.ts`, `useIsActiveTabReadOnly`, ações de T14
**Requirement**: TEC-05, TEC-06, TEC-07, TEC-14, TEC-43, TEC-45

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] E2E: escolher Cassandra muda capacidade e mostra "Based on:" com link e evidência; Ctrl+Z volta num passo; o select mostra "AWS NLB (L4)"; classe some em DynamoDB; editar capacidade mostra "Modified from" e "Reset to benchmark" volta; réplica MySQL ligada a Postgres mostra o aviso; numa referência (somente leitura) os selects ficam desabilitados
- [x] Gate check passes: `npm run typecheck && npm test && npm run test:e2e`
- [x] Test count: contagem anterior + os novos

**Tests**: e2e
**Gate**: full
**Commit**: `feat(props): seletor de tecnologia com fonte dos números`
**Status**: ✅ Complete

---

### T17: Tecnologias na paleta

**What**: Em `ComponentPalette.tsx`, cada tipo central ganha um botão de expandir (`aria-expanded`, fechado por padrão) com as tecnologias arrastáveis/tocáveis (`data-palette-item="<type>:<tech>"`); a busca casa nomes de tecnologia; a entrada do tipo cria com a tecnologia padrão; `PaletteDragData` em `PaletteDnd.tsx` ganha `technology`. Ajustar os e2e existentes que dependem dos números genéricos (escolhendo `generic` explicitamente no teste).
**Where**: `src/components/sidebar/ComponentPalette.tsx`
**Depends on**: T13
**Reuses**: `PaletteDraggable`, `PaletteDndProvider`, `createComponentNode`
**Requirement**: TEC-20, TEC-21, TEC-22, TEC-23

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] E2E: expandir NoSQL, arrastar Cassandra (mouse) e tocar ScyllaDB (toque) criam nós com a tecnologia; adicionar "NoSQL Database" cria DynamoDB; buscar "kafka" na paleta mostra Kafka sob Message Queue e Pub/Sub
- [ ] A suíte e2e **inteira** passa (regra L-014)
- [ ] Gate check passes: `npm run typecheck && npm test && npm run test:e2e`
- [ ] Test count: contagem anterior + os novos

**Tests**: e2e
**Gate**: full
**Commit**: `feat(palette): tecnologias como atalhos na paleta`
**Status**: Pending

---

### T18: Tecnologias na Command Palette

**What**: Itens "Cassandra — NoSQL Database" etc. na Command Palette (Ctrl/Cmd+K) que criam o nó com a tecnologia; o item do tipo cria com a padrão.
**Where**: `src/components/CommandPalette.tsx`
**Depends on**: T13
**Reuses**: `componentItems`, `createComponentNode`
**Requirement**: TEC-22, TEC-23

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] E2E: Ctrl+K "scylla" → Enter cria um NoSQL com ScyllaDB
- [ ] Gate check passes: `npm run typecheck && npm test && npm run test:e2e`
- [ ] Test count: contagem anterior + os novos

**Tests**: e2e
**Gate**: full
**Commit**: `feat(command-palette): criar nó por tecnologia`
**Status**: Pending

---

### T19: Tag da tecnologia no nó

**What**: `ComponentNode` mostra o nome curto da tecnologia ("Cassandra", "ALB · L7") numa tag posicionada fora da caixa (absoluta, abaixo), com `data-technology`, sem mudar as dimensões do nó; nós `generic` não mostram tag.
**Where**: `src/components/canvas/nodes/ComponentNode.tsx`
**Depends on**: T13
**Reuses**: padrão do blast radius (desenho fora da caixa)
**Requirement**: TEC-24

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] E2E: a tag aparece com o nome curto; o `boundingBox` do nó é o mesmo antes e depois de trocar a tecnologia
- [ ] Gate check passes: `npm run typecheck && npm test && npm run test:e2e`
- [ ] Test count: contagem anterior + os novos

**Tests**: e2e
**Gate**: full
**Commit**: `feat(canvas): tag da tecnologia no nó`
**Status**: Pending

---

### T20: Perfil de tecnologia por nó

**What**: `techProfileOf(componentId, params): TechProfile | undefined` (tipos `TechProfile`, `ClassRoute`, `LatencyShape`, `TechLimitKind` do design), `undefined` para `generic`, com clamps (RF 1–7, k ≤ RF, shards 1–1024, prefixes 1–1000, custos ≥ 1e-6, capacidades finitas positivas) e as rotas por classe de cada mecânica (SQL primário, quorum, DynamoDB, MongoDB, fan-out, cotas, Kafka).
**Where**: `src/domain/components/technologies/profile.ts`
**Depends on**: T9
**Reuses**: catálogo (T1–T7), `numParam`
**Requirement**: TEC-25, TEC-28, TEC-29, TEC-31, TEC-32, TEC-34, TEC-35, TEC-36, TEC-37, TEC-38, TEC-48

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `tests/unit/tech-profile.test.ts`: `generic` → `undefined`; Cassandra RF 3 QUORUM → leitura `kth(2,3)` custo 2, escrita `kth(2,3)` custo 3; DynamoDB forte → custo de leitura 1 (eventual 0,5); MongoDB `secondaryPreferred` roteia leituras para a estação de secundários; params fora da faixa ficam presos
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Test count: contagem anterior + os novos

**Tests**: unit
**Gate**: quick
**Commit**: `feat(engine): perfil de tecnologia resolvido por nó`
**Status**: Pending

---

### T21: Recurso limitante e utilização

**What**: `techLimitOf(profile, core, {read, write}): TechLimit` (`kind`, `utilization`, `capacityRps`, `scalesWithInstances`) sobre a demanda oferecida, com desempate em ordem fixa, e `LIMIT_LABELS`.
**Where**: `src/domain/components/technologies/limits.ts`
**Depends on**: T20
**Reuses**: perfil de T20
**Requirement**: TEC-40, TEC-41, TEC-42

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `tests/unit/tech-limits.test.ts`: Postgres com escritas acima do primário → `write-primary`, `scalesWithInstances: false`; S3 com 10.000 GET/s e 1 prefixo → `prefix-limit` 10.000/5.500; API Gateway a 15.000 → `account-throttle` 1,5; DynamoDB com hot share alto → `hot-partition`; demanda 0 → utilização 0 e `capacityRps` nominal finito
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Test count: contagem anterior + os novos

**Tests**: unit
**Gate**: quick
**Commit**: `feat(engine): recurso limitante por tecnologia`
**Status**: Pending

---

### T22: Perfil no compilador e warnings de tecnologia

**What**: `compileGraph` grava `SimNode.tech` só quando `techProfileOf` existe (sem chave `undefined`) e emite, só para nós com tecnologia, os warnings "RF > instances" e "Replica technology differs from its primary".
**Where**: `src/domain/graph/compile.ts`
**Depends on**: T20
**Reuses**: `sanitizeParams`, coleta de warnings existente
**Requirement**: TEC-45, TEC-46

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Testes: nó `generic` compila sem a chave `tech` (deep-equal ao SimNode de hoje); Cassandra RF 5 com 3 instâncias gera o warning; réplica MySQL alimentada por Postgres gera o warning; grafo só `generic` sem warnings novos
- [ ] `engine-golden.test.ts` passa sem mudar a fixture
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Test count: contagem anterior + os novos

**Tests**: unit
**Gate**: quick
**Commit**: `feat(engine): compilador resolve a tecnologia de cada nó`
**Status**: Pending

---

### T23: Matemática das mecânicas

**What**: `engine/core/tech.ts` puro: `edgeWriteShare`, `admit` (cota, partição quente só na partição quente, token bucket), estações por classe (`techSteadyFlow`), caudas (`one`, `kth` binomial, `max`), `techExceeds`, `techPercentileMs` (bissecção 64 iterações), `sampleClassMs` (Rényi para `kth`, CDF inversa para `max`).
**Where**: `src/engine/core/tech.ts`
**Depends on**: T20, T21
**Reuses**: `station`, `probWaitExceeds`, `sampleExponential`, `sampleWaitMs` (`core/queueing.ts`, `core/rng.ts`)
**Requirement**: TEC-26, TEC-28, TEC-29, TEC-30, TEC-31, TEC-36, TEC-37, TEC-38

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `tests/unit/engine-tech-math.test.ts`: `kth(1,n)` = cauda de Exp(S/n); `kth(n,n)` = cauda do máximo; média amostrada de `kth` ≈ S·Σ1/(n−j+1) e de `max` ≈ S·H_n (tolerância estatística); `u = 0` finito; percentis monótonos em p; partição quente: throttled = h·λ·(1 − 1/U); token bucket absorve o burst e depois limita a L
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Test count: contagem anterior + os novos

**Tests**: unit
**Gate**: quick
**Commit**: `feat(engine): matemática de quorum, fan-out, cotas e partição quente`
**Status**: Pending

---

### T24: Sampler por classe

**What**: `SampleNode.tech = {read, write}` e o desvio em `visit` que usa a classe do `isRead` já sorteado; nós sem `tech` mantêm a mesma ordem e o mesmo número de sorteios.
**Where**: `src/engine/core/sampler.ts`
**Depends on**: T23
**Reuses**: `sampleClassMs` (T23), contagem de sorteios de `engine-trace.test.ts`
**Requirement**: TEC-29, TEC-30, TEC-36, TEC-46

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Testes: um `countingRng` vê o mesmo número de sorteios num grafo `generic` antes/depois; Cassandra ONE → QUORUM → ALL tem p99 amostrado não decrescente; OpenSearch 1 → 8 shards tem p99 amostrado não decrescente
- [ ] `engine-golden.test.ts` e `engine-trace.test.ts` passam sem mudança
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Test count: contagem anterior + os novos

**Tests**: unit
**Gate**: quick
**Commit**: `feat(engine): sampler amostra latência por classe de requisição`
**Status**: Pending

---

### T25: Settle e SLO cientes da tecnologia

**What**: `settle(topo, flows, shares, writeShare?)` usa `techExceeds` e o sucesso por classe para alvos com `tech` (produto `downstream` separado, o `s` genérico na mesma ordem); `FlowView.tech`; `sampleNodesFor` monta `SampleNode.tech`; `core/slo.ts` passa a chamar `hopExceeds(flow, t)` (idêntico para nós sem `tech`).
**Where**: `src/engine/core/settle.ts`
**Depends on**: T23
**Reuses**: `probSojournExceeds`, `settle` atual
**Requirement**: TEC-28, TEC-35, TEC-37, TEC-38, TEC-46

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Testes: chamada a um alvo com cota estourada falha na proporção `throttled/λ`; timeout de um alvo `kth` usa a cauda mista pela fração de escrita da aresta; nós `generic` dão o mesmo `success`/`availability` bit a bit
- [ ] `engine-golden.test.ts` passa sem mudança
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Test count: contagem anterior + os novos

**Tests**: unit
**Gate**: quick
**Commit**: `feat(engine): settle e SLO por classe em nós com tecnologia`
**Status**: Pending

---

### T26: Campos de limite no estado e no snapshot

**What**: `NodeSteadyState` e `NodeRuntimeMetrics` (`engine/types.ts`) ganham `limitKind?`, `limitUtilization?`, `writeRps?` (primitivos, só por spread condicional); `steadyStateToSnapshot` (`engine/snapshot.ts`) os copia.
**Where**: `src/engine/types.ts`
**Depends on**: T21
**Reuses**: `nodeMetricsEqual`
**Requirement**: TEC-41

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Teste: um `NodeSteadyState` com os campos chega ao snapshot com os mesmos valores; sem eles, o snapshot não ganha chaves (deep-equal ao de hoje); `nodeMetricsEqual` compartilha o objeto quando os três não mudam
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Test count: contagem anterior + os novos

**Tests**: unit
**Gate**: quick
**Commit**: `feat(engine): recurso limitante no estado e no snapshot`
**Status**: Pending

---

### T27: Mecânicas no analyze()

**What**: Em `analyze.ts`: `needsSplit`, `inflowWrite`/`edgeWs` na propagação, ramo `techSteadyFlow` (estações por classe, cotas, partição quente) com `throttled` em `NodeFlow`, `settle(…, edgeWs)`, saída com `limitKind`/`limitUtilization`/`writeRps` e `utilization` = `limitUtilization`, status `critical` com `throttled > 0`.
**Where**: `src/engine/analyze.ts`
**Depends on**: T26
**Reuses**: `core/tech.ts`, `settle`, propagação atual
**Requirement**: TEC-25, TEC-26, TEC-28, TEC-29, TEC-30, TEC-31, TEC-32, TEC-35, TEC-36, TEC-37, TEC-38, TEC-41, TEC-46

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `tests/unit/engine-tech.test.ts` (analyze): PostgreSQL só escritas → vazão = mín(λ, shards·writeCap), 8 → 16 instâncias não muda, 1 → 2 shards dobra (TEC-25/26); leituras escalam com instâncias; DynamoDB hot partition: erros = h·λ·(1 − 1/U) (TEC-28); Cassandra RF 3: capacidade de leitura C, C/2, C/3 de ONE a ALL e p99 não decrescente (TEC-29/30); DynamoDB forte dobra U (TEC-31); MongoDB `primary` vs `secondaryPreferred` e `majority` (TEC-32); SQS FIFO e SNS acima da cota → erro = λ − L (TEC-35); OpenSearch capacidade = min(n, shards·(replicas+1))·k₀ ÷ shards (TEC-36); S3 1 prefixo 10.000 GET → 4.500 erros, 4.000 PUT → 500, 2 prefixos → 0 (TEC-37); API Gateway 15.000 → 5.000 erros (TEC-38)
- [ ] `engine-golden.test.ts`, `engine-analyze.test.ts`, `engine-references.test.ts`, `scoring.test.ts` passam sem mudança
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Test count: contagem anterior + os novos

**Tests**: unit
**Gate**: quick
**Commit**: `feat(engine): mecânicas de tecnologia no analyze`
**Status**: Pending

---

### T28: Mecânicas no tick

**What**: Em `core/tick.ts`: `NodeState.tech` (`primaryBacklog`, `tokens`, zerado na troca de tecnologia), `inflowWrite`, desvio `techTickFlow` só no trecho de capacidade/fila, `throttled` em `TickFlow`, status `critical`, campos de limite no snapshot do tick pela mesma `techLimitOf`; exportar `BACKLOG_NOISE_SEC` e mover os construtores de estação para funções livres sem mudar o caminho genérico.
**Where**: `src/engine/core/tick.ts`
**Depends on**: T27
**Reuses**: `core/tech.ts`, fluxo de fila atual
**Requirement**: TEC-26, TEC-38, TEC-41, TEC-46

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Testes (tick): backlog de escrita do Postgres cresce enquanto o de leitura fica 0, `maxQueue` causa overflow; API Gateway: o burst absorve ~1 s e depois 5.000 req/s de erro; `limitUtilization` do tick = do analyze para a mesma carga constante (TEC-41)
- [ ] `engine-golden.test.ts`, `engine-tick.test.ts`, `engine-parity.test.ts` passam sem mudança
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Test count: contagem anterior + os novos

**Tests**: unit
**Gate**: quick
**Commit**: `feat(engine): mecânicas de tecnologia no tick`
**Status**: Pending

---

### T29: Consumidores do Kafka limitados por partições

**What**: `consumerCapacity` usa `pullers = max(1, min(consumers, target.instances, queue.tech?.consumerCap ?? ∞))`; o limite do nó Kafka é o máximo por aresta de consumo, com `consumers-partitions` quando a partição é o termo que limita.
**Where**: `src/engine/core/routing.ts`
**Depends on**: T28
**Reuses**: `consumerCapacity`
**Requirement**: TEC-34

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Testes: Kafka com 12 consumidores, 6 partições e worker de 12 instâncias drena como 6 no analyze e no tick; os mesmos params numa fila `generic` drenam como 12; `limitKind` = `consumers-partitions`
- [ ] `engine-golden.test.ts` passa sem mudança
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Test count: contagem anterior + os novos

**Tests**: unit
**Gate**: quick
**Commit**: `feat(engine): partições limitam os consumidores do Kafka`
**Status**: Pending

---

### T30: Propriedades do motor com tecnologias

**What**: Testes transversais: gerador `randomTechCanvas` (stream próprio) com tecnologias e params fora da faixa; determinismo com tecnologias + fault; `failoverSec` da tecnologia no `db-primary-failure`; `iops-throttle` escala o primário pelo `capScale`.
**Where**: `tests/unit/engine-tech-properties.test.ts`
**Depends on**: T29
**Reuses**: `engine-property.test.ts`, `engineFixtures.ts`
**Requirement**: TEC-27, TEC-47, TEC-48

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Para grafos aleatórios com tecnologias: served ≤ offered, todo número finito, p50 ≤ p95 ≤ p99, throughput ≤ offered (TEC-48); mesmo grafo + seed + faults → analyze e ticks deep-equal (TEC-47); Aurora falha escritas por 30 s e PostgreSQL por 90 s (TEC-27)
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Test count: contagem anterior + os novos

**Tests**: unit
**Gate**: quick
**Commit**: `test(engine): propriedades e determinismo com tecnologias`
**Status**: Pending

---

### T31: Recurso limitante no NodeInsightCard

**What**: `NodeInsightCard` mostra "<label>: <n>%" com cor e ícone de status quando o snapshot traz `limitKind` e `limitUtilization ≥ 1`, e o recurso sem destaque abaixo de 1.
**Where**: `src/components/canvas/NodeInsightCard.tsx`
**Depends on**: T28
**Reuses**: `LIMIT_LABELS`, `useNodeRuntime`
**Requirement**: TEC-40

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] E2E com snapshot sintético (`window.__runtimeStore`): Postgres com `limitKind: "write-primary"`, `limitUtilization: 1.3` mostra "Write primary: 130%"; um nó sem os campos não mostra a linha
- [ ] Gate check passes: `npm run typecheck && npm test && npm run test:e2e`
- [ ] Test count: contagem anterior + os novos

**Tests**: e2e
**Gate**: full
**Commit**: `feat(metrics): card do nó nomeia o limite da tecnologia`
**Status**: Pending

---

### T32: Advisor lê o limite da tecnologia

**What**: `AdvisorContext` ganha `writeLoad?`/`limits?`; `advisorStore.recentLoad` faz a média de `writeRps` e `limitUtilization`; `utilizationOf` em `advisor/load.ts` usa `techLimitOf` (Kafka: o número do motor); sem fix de instâncias quando `!scalesWithInstances`; título e texto nomeiam o recurso.
**Where**: `src/advisor/load.ts`
**Depends on**: T28
**Reuses**: `techLimitOf`, `LIMIT_LABELS`
**Requirement**: TEC-42

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `advisor.test.ts`: a utilização do advisor para Postgres com escritas saturadas = `limitUtilization` do snapshot do analyze; AWS API Gateway na cota e Postgres no primário não recebem fix de instâncias; nenhuma referência ganha finding acima de info (teste existente)
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Test count: contagem anterior + os novos

**Tests**: unit
**Gate**: quick
**Commit**: `feat(advisor): findings de carga pelo recurso limitante da tecnologia`
**Status**: Pending

---

### T33: Custo por tecnologia, classe e classe de requisição

**What**: `costLine(node, rps, writeRps?)` usa `pricingOf`: provisionada = `instances × perInstanceHour × 730`; gerenciada = fixo sem `instances` + leituras × `perMillionReads` + escritas × `perMillionWrites` (sem `writeRps`, pelo read ratio resolvido); `CostLine` carrega tecnologia e classe.
**Where**: `src/cost/estimate.ts`
**Depends on**: T11, T26
**Reuses**: `costLine`, `MILLION_REQUESTS_PER_RPS_MONTH`
**Requirement**: TEC-17, TEC-18, TEC-51

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `cost.test.ts`: Postgres db.r6g.large → 2xlarge com 2 instâncias = 2 × 0,899 × 730; DynamoDB com 1.000 req/s e 200 de escrita = 800·RRU·0,5·$0,125 + 200·$0,625 por milhão-mês, independente de `instances`; `generic` igual a hoje
- [ ] `data.test.ts` passa sem recalibrar
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Test count: contagem anterior + os novos

**Tests**: unit
**Gate**: quick
**Commit**: `feat(cost): custo por tecnologia, classe e leitura/escrita`
**Status**: Pending

---

### T34: Right-size lê o preço da tecnologia

**What**: `rightSize.ts` usa `pricingOf` (pula tecnologia gerenciada e tipos com preço por instância 0, como hoje para os genéricos).
**Where**: `src/cost/rightSize.ts`
**Depends on**: T33
**Reuses**: `suggestedInstances`
**Requirement**: TEC-17, TEC-51

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Testes: right-size não sugere instâncias para AWS API Gateway; HAProxy usa o preço da classe na economia estimada; os testes de right-size das referências passam sem mudança
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Test count: contagem anterior + os novos

**Tests**: unit
**Gate**: quick
**Commit**: `feat(cost): right-size com preço por tecnologia`
**Status**: Pending

---

### T35: Custo na UI com tecnologia e escritas

**What**: `useCostEstimate` passa `writeRps` do snapshot ao `costLine`; o `CostPanel` mostra nas premissas do nó a tecnologia, a classe e a origem do preço.
**Where**: `src/components/panel/CostPanel.tsx`
**Depends on**: T33
**Reuses**: `useCostEstimate`, breakdown de premissas existente
**Requirement**: TEC-18, TEC-19

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] E2E: um Postgres db.r6g.xlarge no canvas aparece no Cost com "PostgreSQL (RDS) · db.r6g.xlarge" e o texto de premissas; trocar a classe muda o $/mês
- [ ] Gate check passes: `npm run typecheck && npm test && npm run test:e2e`
- [ ] Test count: contagem anterior + os novos

**Tests**: e2e
**Gate**: full
**Commit**: `feat(cost): painel mostra tecnologia, classe e origem do preço`
**Status**: Pending

---

### T36: Documentação do catálogo e do mapa

**What**: Atualizar o mapa de arquitetura de `CLAUDE.md` (`domain/components/technologies/`, `engine/core/tech.ts`, `TechnologyPicker`, invariantes: tecnologia como param, mecânicas só fora de `generic`, `pricingOf`/`isManagedMultiZone`) e `docs/03-catalogo-de-componentes.md` (CMP-03 substituído por tecnologias, status).
**Where**: `CLAUDE.md`
**Depends on**: T31, T32, T34, T35
**Reuses**: estilo atual do mapa
**Requirement**: TEC-10

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `claude-map.test.ts` passa
- [ ] Gate check passes: `npm run typecheck && npm test`
- [ ] Test count: contagem anterior (sem remoções)

**Tests**: unit
**Gate**: quick
**Commit**: `docs(claude): mapa e invariantes das tecnologias dos componentes`
**Status**: Pending

---

### T37: Gate de build completo

**What**: Rodar o gate de build inteiro (lint, format, typecheck, testes, build, bundle check, e2e inteiro) e corrigir o que quebrar; atualizar a rastreabilidade da spec.
**Where**: `.specs/features/component-technologies/spec.md`
**Depends on**: T36
**Reuses**: scripts do `package.json`
**Requirement**: TEC-49

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build && npm run bundle:check && npm run test:e2e` passa; o JS inicial fica dentro de +15% da baseline (sem atualizar a baseline)
- [ ] Tabela de rastreabilidade com cada TEC mapeado para a tarefa que o cobre
- [ ] Test count: contagem anterior (sem remoções)

**Tests**: e2e
**Gate**: build
**Commit**: `chore(release): gate de build das tecnologias dos componentes`
**Status**: Pending

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6
```

As setas de cada tarefa estão nos diagramas das fases acima (incluindo as que vêm de fases anteriores).

Execution is strictly sequential - there is no intra-phase parallelism. A single agent (or batch worker) works one task at a time, in the numeric order within each phase.

---

## Task Granularity Check

| Task                    | Scope                                                       | Status                                                       |
| ----------------------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| T1                      | tipos + consultas de um módulo novo                         | ⚠️ OK (2 arquivos coesos: `types.ts` + `index.ts`)           |
| T2–T7                   | um arquivo de dados por família                             | ✅ Granular                                                  |
| T8                      | chaves + 2 builders em `params.ts` (+ `optionsFor` no tipo) | ✅ Granular                                                  |
| T9                      | 1 função em `registry.ts`                                   | ✅ Granular                                                  |
| T10                     | specs nos schemas dos 10 tipos                              | ⚠️ OK (uma mudança repetida, coesa, no diretório `schemas/`) |
| T11                     | 1 função + versão da tabela                                 | ✅ Granular                                                  |
| T12                     | 1 função + troca em 3 chamadas                              | ⚠️ OK (troca mecânica)                                       |
| T13                     | 1 função                                                    | ✅ Granular                                                  |
| T14                     | 3 ações da mesma store                                      | ✅ Granular                                                  |
| T15                     | 1 componente                                                | ✅ Granular                                                  |
| T16                     | 1 componente + montagem                                     | ✅ Granular                                                  |
| T17                     | 1 componente + payload do DnD                               | ⚠️ OK (o payload só existe para a paleta)                    |
| T18, T19                | 1 componente                                                | ✅ Granular                                                  |
| T20, T21, T23           | 1 módulo puro                                               | ✅ Granular                                                  |
| T22, T24, T27, T28, T29 | 1 arquivo do motor                                          | ✅ Granular                                                  |
| T25                     | `settle.ts` + troca de 1 linha em `slo.ts`                  | ⚠️ OK (mesma função de cauda)                                |
| T26                     | tipos + cópia no snapshot                                   | ⚠️ OK (campos e cópia andam juntos)                          |
| T30                     | 1 arquivo de teste                                          | ✅ Granular                                                  |
| T31–T35                 | 1 componente / função                                       | ✅ Granular                                                  |
| T36                     | documentação                                                | ✅ Granular                                                  |
| T37                     | gate                                                        | ✅ Granular                                                  |

## Diagram-Definition Cross-Check

| Task          | Depends On (task body)      | Diagram Shows        | Status   |
| ------------- | --------------------------- | -------------------- | -------- |
| T1            | None                        | início da fase 1     | ✅ Match |
| T2–T7         | T1                          | T1 → T2…T7           | ✅ Match |
| T8            | T2–T7 (fase anterior)       | início da fase 2     | ✅ Match |
| T9            | T8                          | T8 → T9              | ✅ Match |
| T10           | T9                          | T9 → T10             | ✅ Match |
| T11           | T7 (fase anterior)          | T11 isolado          | ✅ Match |
| T12           | T7 (fase anterior)          | T12 isolado          | ✅ Match |
| T13           | T10                         | T10 → T13            | ✅ Match |
| T14           | T10                         | T10 → T14            | ✅ Match |
| T15           | T10 (fase anterior)         | início da fase 3     | ✅ Match |
| T16           | T14 (fase anterior), T15    | T15 → T16            | ✅ Match |
| T17, T18, T19 | T13 (fase anterior)         | isolados             | ✅ Match |
| T20           | T9 (fase anterior)          | início da fase 4     | ✅ Match |
| T21           | T20                         | T20 → T21            | ✅ Match |
| T22           | T20                         | T20 → T22            | ✅ Match |
| T23           | T20, T21                    | T20 → T23, T21 → T23 | ✅ Match |
| T24           | T23                         | T23 → T24            | ✅ Match |
| T25           | T23                         | T23 → T25            | ✅ Match |
| T26           | T21 (fase anterior)         | início da fase 5     | ✅ Match |
| T27           | T26                         | T26 → T27            | ✅ Match |
| T28           | T27                         | T27 → T28            | ✅ Match |
| T29           | T28                         | T28 → T29            | ✅ Match |
| T30           | T29                         | T29 → T30            | ✅ Match |
| T31           | T28 (fase anterior)         | T31 → T36            | ✅ Match |
| T32           | T28 (fase anterior)         | T32 → T36            | ✅ Match |
| T33           | T11, T26 (fases anteriores) | T33 → T34, T33 → T35 | ✅ Match |
| T34           | T33                         | T33 → T34            | ✅ Match |
| T35           | T33                         | T33 → T35            | ✅ Match |
| T36           | T31, T32, T34, T35          | quatro setas → T36   | ✅ Match |
| T37           | T36                         | T36 → T37            | ✅ Match |

## Test Co-location Validation

| Task     | Code Layer Created/Modified     | Matrix Requires     | Task Says | Status |
| -------- | ------------------------------- | ------------------- | --------- | ------ |
| T1–T7    | Dados do catálogo               | unit                | unit      | ✅ OK  |
| T8–T12   | Schema, registry, preço, traits | unit                | unit      | ✅ OK  |
| T13, T14 | Stores e ações                  | unit                | unit      | ✅ OK  |
| T15–T19  | UI                              | e2e                 | e2e       | ✅ OK  |
| T20–T30  | Motor                           | unit                | unit      | ✅ OK  |
| T31      | UI                              | e2e                 | e2e       | ✅ OK  |
| T32      | Advisor                         | unit                | unit      | ✅ OK  |
| T33, T34 | Custo                           | unit                | unit      | ✅ OK  |
| T35      | UI                              | e2e                 | e2e       | ✅ OK  |
| T36      | Documentação                    | unit                | unit      | ✅ OK  |
| T37      | Todas (gate)                    | e2e (maior exigido) | e2e       | ✅ OK  |
