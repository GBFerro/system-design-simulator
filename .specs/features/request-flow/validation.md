# Fluxo da requisição (request-flow) — Validation (iteração 3)

## Validation (iteração 3): request-flow - FAIL ❌

Os gates passam (930 unit, 57 e2e com `CI=1`, bundle +6,9%). Os cinco mutantes da iteração 2 morrem: o de FLW-05 (`linkP = 0`), N4, N9, N10 e N13. Das 12 mutações novas, 8 morrem e 4 sobrevivem à suíte inteira (930 unit + 57 e2e). As quatro estão em duas cláusulas que já tinham reprovado:

1. **FLW-36 (P2): "na carga do último snapshot" só está testado dentro do motor.** A T40 testa `traceGraph` (`tests/unit/engine-trace.test.ts:395-396`). Se a carga se perde no caminho até lá, nada falha:
   - X11: `FlowPanel` chama `traceCanvas` sem `rps`.
   - X12: `client.traceCanvas` descarta `options.rps`.

   Em ambos, a aba Flow volta a mostrar sempre os tempos de 1 req/s. É o defeito do N4, só que uma camada acima. O único teste da carga em `traceCanvas` (`tests/unit/sim-controller.test.ts:176-180`) compara a carga ausente com `rps: 1`, que dão o mesmo valor.

2. **FLW-05 (P1): o timeout de quem chamou depois do Analyze.** X9: `app-shell.tsx` monta o snapshot do Analyze sem o `linkFailure`. Com isso `edgeLinkFailure` some, e as bolinhas deixam de mostrar o timeout depois do Analyze. Nenhum teste pega. `tests/unit/runtime.test.ts:96-99` testa uma cópia dessa composição, não a do `AppShell`.
3. **FLW-36 (P2): o limite de 25% não é discriminado.** X10: com `RPS_STEP` 1,25 → 1,9, o e2e (`tests/e2e/flow.spec.ts:184,190`) continua passando, porque só usa ruído de ±3% e carga ×2.

Uma sonda que passa no código real e falha no mutante matou cada uma (ver o sensor). Os quatro gaps pedem só testes, sem código. Como esta é a iteração 3 de 3, o caso vai ao usuário.

- **Data**: 2026-10-05
- **Spec**: `.specs/features/request-flow/spec.md`
- **Faixa de commits**: `ae21176..HEAD` (50 commits, HEAD `48a697c`), branch `feat/request-flow`. A Fase 9 é `1746e79..48a697c`
- **Iteração**: 3 de 3 (a última antes de escalar ao usuário)
- **Verifier**: sub-agente novo e independente (author ≠ verifier), só leitura sobre `src/` e `tests/`

---

## Gates

| Gate      | Comando                                                                 | Saída                                                                                                       |
| --------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Typecheck | `npm run typecheck`                                                     | exit 0                                                                                                      |
| Unit      | `npm test`                                                              | **930 passando**, 40 arquivos, 0 skip (iteração 2: 922; +8 da Fase 9)                                       |
| Lint      | `npm run lint`                                                          | exit 0                                                                                                      |
| Format    | `npx oxfmt --check .specs src tests CLAUDE.md docs`                     | 318 arquivos, todos formatados                                                                              |
| Build     | `npm run build`                                                         | exit 0                                                                                                      |
| Bundle    | `npm run bundle:check`                                                  | 589,7 KB gzip contra o baseline de 551,5 KB: **+6,9%** (limite +15%). `bundle-baseline.json` não mudou      |
| E2E       | `CI=1 npx playwright test --reporter=list` (build de produção, 1 retry) | **57 passaram**, sem falha e sem instáveis (iteração 2: 56; +1 da T41). Depois nada escutava em :3000/:3100 |

O `format:check` global só falha nas pastas não rastreadas (`.agents/`, `.cursor/`, `.windsurf/`, `.claude/skills/`). Isso não conta.

**Integridade dos testes** (`ae21176..HEAD`):

- Nenhum `.skip`, `.only`, `.todo`, `.fixme`, `xit` ou `xdescribe` em `tests/`.
- O golden não muda depois de `2584a23`: `git log 2584a23..HEAD` sobre `tests/unit/engine-golden.test.ts` e `tests/unit/fixtures/engine-golden.json` sai vazio.
- A Fase 9 só acrescenta testes. As duas únicas linhas removidas são imports de `tests/unit/engine-trace.test.ts`, trocados por versões ampliadas (`traceGraph`, `compileGraph`).
- Os testes acrescentados:
  - +4 em `runtime.test.ts:83-158`
  - +1 em `metrics.test.ts:196`
  - +1 em `flow-balls.test.ts:514`
  - +2 em `engine-trace.test.ts:140,371`
  - +1 e2e em `editor.spec.ts:389`

---

## Task Completion

T1–T42 estão ✅ em `tasks.md`, e não há `- [ ]` aberto. Na Fase 9, T38 e T39 mudam código (FLW-05) e T40–T42 só acrescentam testes. Os Done-when de T38–T42 conferem. A ressalva é que a T40 cobre a carga só em `traceGraph`, não em `traceCanvas` nem no `FlowPanel` (gap 1).

---

## Spec-Anchored Acceptance Criteria

Legenda:

- ✅ coberto com o valor da spec, e o teste discrimina.
- ⚠️ cláusula visual ou proxy sem asserção direta. É cosmético e não bloqueia.
- ❌ cláusula com mutante vivo.

### P1: Resposta visível no canvas

| AC     | Outcome da spec                                                                  | `file:line` + asserção                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Status                                                                                                                                                                                     |
| ------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FLW-01 | Resposta na mesma aresta, de volta, só depois de o alvo concluir suas chamadas   | `tests/unit/flow-balls.test.ts:380-382` `res.edge === req.edge`, `res.drawn === req.drawn`, `error === false`; `:409` `back > t.last("b-c", key)`; `:412` `checked > 50`                                                                                                                                                                                                                                                                                                          | ✅                                                                                                                                                                                         |
| FLW-02 | Anel vazado contra círculo cheio, outra cor, diferença na legenda                | `tests/e2e/traffic.spec.ts:183-184` legenda `"request ●"`/`"response ○"`; `:174` `data-balls-res > 0`                                                                                                                                                                                                                                                                                                                                                                             | ⚠️ A forma e a cor do anel não têm asserção (cosmético)                                                                                                                                    |
| FLW-03 | Async sem resposta, e quem chama não espera                                      | `tests/unit/flow-balls.test.ts:424` nenhuma resposta em `a-b`; `:455` toda requisição recebe resposta; `:467` ida e volta igual à do design sem a async; `:468` `< FRAME_TTL_SEC`                                                                                                                                                                                                                                                                                                 | ✅                                                                                                                                                                                         |
| FLW-04 | Async tracejada e sync contínua, também com reduced-motion                       | `tests/e2e/traffic.spec.ts:217` `strokeDasharray` ≠ `"none"`; `:218` `=== "none"`, ambos com `reducedMotion: "reduce"`                                                                                                                                                                                                                                                                                                                                                            | ✅                                                                                                                                                                                         |
| FLW-05 | Falha no nó (erro, drop **ou timeout de quem chamou**): burst + resposta de erro | Erro do nó: `tests/unit/flow-balls.test.ts:508-511`. Link e timeout (T39): `:539-544` com `edgeLinkFailure` 1 → `bursts > 0`, `burstsOff 0`, nada chega a `c`, `back.every(r => r.error)`; `:547-551` com 0 → sem burst; `:553` sem o campo = 0. Motor (T38): `tests/unit/runtime.test.ts:103-104,106` (> 0,99 e 0, o banco com `errorRate` 0, no tick e no Analyze), `:112` perda 0,2, `:150` fault no alvo < 1e-6, `:157` fora de `edges`; `tests/unit/metrics.test.ts:207-209` | ❌ **X9 sobrevive**. O `AppShell` (`src/components/layout/app-shell.tsx:171`) pode descartar o `linkFailure` do Analyze sem que nenhum teste falhe. No caminho ao vivo (tick) está coberto |
| FLW-06 | A resposta na entrada encerra a requisição                                       | `tests/unit/flow-balls.test.ts:602-604` bolas, respostas e frames chegam a 0                                                                                                                                                                                                                                                                                                                                                                                                      | ✅                                                                                                                                                                                         |
| FLW-07 | Respostas entram no `MAX_BALLS` e no quantum                                     | `tests/unit/flow-balls.test.ts:653-655` `mostResponses > 0`, `most ≤ MAX_BALLS`, o quantum sobe                                                                                                                                                                                                                                                                                                                                                                                   | ✅                                                                                                                                                                                         |

### P1: Chamada condicional de quem chama (look-aside)

| AC     | Outcome da spec                                                     | `file:line` + asserção                                                                                                                                                                                  | Status |
| ------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| FLW-08 | "Leituras após miss" só com as chamadas síncronas da fonte a caches | `tests/unit/edge-calls-form.test.ts:25` async → `[]`; `:29` sem `hitRate` → `[]`; `:33` cache → `[{redis}]`; `:37-43` os três juntos; `tests/e2e/editor.spec.ts:263-266` o select "Cache" lista o cache | ✅     |
| FLW-09 | D recebe λ·r·(1 − h)·k                                              | `tests/unit/engine-analyze.test.ts:633-634` DB = 1.900 a 10k req/s; `:495-497` 0,09, 0,9, 0,9·(1 − 0,45); `:514-518` fator × k                                                                          | ✅     |
| FLW-10 | Chamada a D depois da volta de B → C, com o tempo somado            | `tests/unit/engine-sampler.test.ts:140-141` p50 = p99 = 30                                                                                                                                              | ✅     |
| FLW-11 | Hit ⇒ nenhuma chamada a D                                           | `tests/unit/engine-sampler.test.ts:134` p99 = 10; `tests/unit/engine-trace.test.ts:122-127`                                                                                                             | ✅     |
| FLW-12 | A falha em B → C vira miss, e a requisição não falha                | `tests/unit/engine-sampler.test.ts:158-159`; `tests/unit/engine-analyze.test.ts:661-662`; `tests/unit/flow-balls.test.ts:585,589-590` (as bolinhas)                                                     | ✅     |
| FLW-13 | C derrubado ⇒ D recebe λ·r·k                                        | `tests/unit/engine-analyze.test.ts:660` DB = RPS; `tests/unit/engine-tick.test.ts:357-359` participação 1 em ≤ 2 ticks                                                                                  | ✅     |
| FLW-14 | Read-through mantido com a carga do `on_miss`                       | `tests/unit/engine-analyze.test.ts:482,518`; `tests/unit/edgeRules.test.ts:434,458-471`                                                                                                                 | ✅     |
| FLW-15 | Rótulo de tamanho fixo "miss: Redis"                                | `tests/unit/edgeRules.test.ts:493`; `tests/e2e/editor.spec.ts:428` texto, `:439` largura ≤ 144, `:477` tamanho estável com métricas                                                                     | ✅     |
| FLW-16 | served ≤ offered, finito, determinístico                            | `tests/unit/engine-analyze.test.ts:679-691`; `tests/unit/engine-tick.test.ts:373,377`; `tests/unit/engine-chaos.test.ts:545-546`                                                                        | ✅     |

### P1: Referências, editor e dados

| AC     | Outcome da spec                                                                      | `file:line` + asserção                                                                                                                                   | Status |
| ------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| FLW-17 | 1–8 chamadas (condição, passo, k); latência e perda por link                         | `tests/unit/edgeRules.test.ts:417-421`, `:368`; `tests/e2e/editor.spec.ts:279-283` "Add call" desabilita em `MAX_EDGE_CALLS`                             | ✅     |
| FLW-18 | v1/v2 → uma chamada com a mesma condição, arestas intactas, `on_miss` = read-through | `tests/unit/persistence.migrate.test.ts:333-337`, `:419-425`; `tests/unit/persistence.envelope.test.ts:326-331`                                          | ✅     |
| FLW-19 | Pura, idempotente, nunca lança; importa 1, 2 e 3                                     | `tests/unit/persistence.migrate.test.ts:373-374,398-400`; `tests/unit/persistence.stores.test.ts:167`; `tests/unit/persistence.envelope.test.ts:315,326` | ✅     |
| FLW-20 | Export com `schemaVersion: 3` e ida e volta com as mesmas chamadas                   | `tests/unit/persistence.envelope.test.ts:311,316-317`                                                                                                    | ✅     |
| FLW-21 | Referências em look-aside, sem cache → banco                                         | `tests/unit/data.test.ts:113` nenhuma saída de nó com `hitRate` fora CDN/origin shield; `:123-124` `after_miss` depois da chamada ao cache               | ✅     |
| FLW-22 | Score ≥ 16, SLO mantido, custo em [b/1,5, b/1,3]                                     | `tests/unit/scoring.test.ts:358-359`; `tests/unit/data.test.ts:157-158`, `:182-184`                                                                      | ✅     |
| FLW-23 | O fix "add cache" faz o look-aside em um passo de undo                               | `tests/unit/advisor.test.ts:220-230`; `:421` `history` 1, `:429-430` undo; `tests/e2e/advisor.spec.ts:31-36`                                             | ✅     |
| FLW-24 | Serviço → banco com cache já chamado nasce `[writes, after_miss]`                    | `tests/unit/edgeRules.test.ts:163-166,190-193`; contracasos em `:202,215,222`                                                                            | ✅     |
| FLW-25 | Ação em `MUTATING_ACTIONS`, uma entrada de undo, no-op em somente leitura            | `tests/unit/editor.test.ts:187,288,297`; `tests/e2e/editor.spec.ts:270-275`                                                                              | ✅     |

### P2: Ordem e paralelismo

| AC     | Outcome da spec                                                              | `file:line` + asserção                                                                                                                                                                          | Status |
| ------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| FLW-26 | Passo 1–20 editável no Props                                                 | `tests/unit/edgeRules.test.ts:426-429`; `tests/e2e/editor.spec.ts:286-308`                                                                                                                      | ✅     |
| FLW-27 | Própria + Σ por passo do máximo dentro dele                                  | `tests/unit/engine-sampler.test.ts:86-88` p50 = 50; `:97` sequencial = 60                                                                                                                       | ✅     |
| FLW-28 | A falha no passo k interrompe os passos seguintes, e o mesmo passo conta     | `tests/unit/engine-sampler.test.ts:108,110,112` (mata X7)                                                                                                                                       | ✅     |
| FLW-29 | Aviso na aresta e execução em dep + 1                                        | `tests/unit/call-plan.test.ts:124-125`; `tests/unit/engine-analyze.test.ts:433-436` (matam X6); `tests/e2e/editor.spec.ts:431-433`                                                              | ✅     |
| FLW-30 | Badge "2"/"2∥" só com ≥ 2 chamadas síncronas, fora de LB/fila                | Mostrado: `tests/e2e/editor.spec.ts:379-380,385-386,407-408`. Oculto (T41): `:403` uma só chamada síncrona → `toHaveCount(0)` (mata N9); `:414-415` arestas do LB → `toHaveCount(0)` (mata N10) | ✅     |
| FLW-31 | As bolas de um passo saem juntas, e o passo seguinte só depois das respostas | `tests/unit/flow-balls.test.ts:491-493`                                                                                                                                                         | ✅     |
| FLW-32 | Bit-identidade sem passos nem `after_miss`                                   | `tests/unit/engine-golden.test.ts:295-296` (35 + 4 congelados), `:303` resultados, `:310` hash; `tests/unit/engine-trace.test.ts:364-366` o recorder não muda os sorteios                       | ✅     |

### P2: Trace de uma requisição

| AC     | Outcome da spec                                                                                                      | `file:line` + asserção                                                                                                                                                                                                                                            | Status                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------ | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FLW-33 | Aba "Flow" lazy, dentro do `bundle:check`                                                                            | `src/components/panel/RightPanel.tsx:62` `dynamic(import("./FlowPanel"))`; `tests/e2e/flow.spec.ts:57`; bundle +6,9%                                                                                                                                              | ✅                                                                                                                                                                                                                                                                                                                                                                                                                      |
| FLW-34 | Linha de vida por nó, seta cheia, resposta tracejada, async aberta sem volta, numeradas                              | `tests/unit/sequence-layout.test.ts:51-57,66-69,86-94,105-112`; `tests/e2e/flow.spec.ts:96-100`                                                                                                                                                                   | ⚠️ Tipos e numeração cobertos. O estilo (tracejado, ponta aberta) não tem asserção (cosmético)                                                                                                                                                                                                                                                                                                                          |
| FLW-35 | Hit/miss onde decide o caminho (após miss e read-through); a condicional não feita some                              | Após miss: `tests/unit/engine-trace.test.ts:111-118,123-126,132-136`. Read-through (T42): `:153-156` hit sem chamada à origem, `:157-161` miss com a chamada (mata N13). Layout: `tests/unit/sequence-layout.test.ts:118-120`; e2e `tests/e2e/flow.spec.ts:88-95` | ✅                                                                                                                                                                                                                                                                                                                                                                                                                      |
| FLW-36 | Tempo de cada passo e total, como no sampler, **na carga do último snapshot**, sem faults, recalcula só acima de 25% | Modelo do sampler: `tests/unit/engine-trace.test.ts:221,225,260`. Carga no motor (T40): `:395-396` `meanTotal(95) > 2 × meanTotal(1)` (mata N4). Tempos na UI: `tests/e2e/flow.spec.ts:129,136`. Histerese: `:184` (±3% → nenhum trace novo), `:190` (×2 → um)    | ❌ **X11 e X12 sobrevivem**: a carga não chega ao `traceGraph` (`FlowPanel.tsx:91` sem `rps`, ou `client.ts:190` descartando `options.rps`), e o trace volta a 1 req/s sem que nenhum teste falhe. **X10 sobrevive**: `RPS_STEP` 1,25 → 1,9 passa no e2e. ⚠️ Spec-precision: o código usa \|ln(novo/antigo)\| > ln 1,25, então recalcula com +25% e também com −20%. A spec não diz qual é a base de "muda mais de 25%" |
| FLW-37 | Sem snapshot: estrutura e o texto exato                                                                              | `tests/e2e/flow.spec.ts:85-86`                                                                                                                                                                                                                                    | ✅                                                                                                                                                                                                                                                                                                                                                                                                                      |
| FLW-38 | "Another request" amostra a próxima; mesmo design + seed + índice → mesmo trace                                      | `tests/unit/engine-trace.test.ts:102,106`; `tests/unit/sim-controller.test.ts:139`; `tests/e2e/flow.spec.ts:183`                                                                                                                                                  | ✅                                                                                                                                                                                                                                                                                                                                                                                                                      |
| FLW-39 | Hover ou toque destaca a aresta e o sentido sem escrever no `canvasStore`                                            | `tests/unit/flow-highlight.test.ts:23-27,55-57`; `tests/e2e/flow.spec.ts:34,37,211`                                                                                                                                                                               | ✅                                                                                                                                                                                                                                                                                                                                                                                                                      |
| FLW-40 | Sem entrada: texto exato                                                                                             | `tests/unit/sim-controller.test.ts:191-193`; `tests/e2e/flow.spec.ts:198-199`                                                                                                                                                                                     | ✅                                                                                                                                                                                                                                                                                                                                                                                                                      |
| FLW-41 | Funciona em aba somente leitura e na bottom sheet                                                                    | `tests/e2e/flow.spec.ts:82,235,238`                                                                                                                                                                                                                               | ✅                                                                                                                                                                                                                                                                                                                                                                                                                      |

### Edge cases

| AC     | Outcome da spec                                       | `file:line` + asserção                                                                                                                     | Status                                    |
| ------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| FLW-42 | Dependência removida: aviso, e vale como leituras     | `tests/unit/call-plan.test.ts:89-92` (dependência inexistente, ou sem chamada síncrona a ela); `tests/unit/engine-analyze.test.ts:420-423` | ✅                                        |
| FLW-43 | Alvo sem `hitRate`: aviso + leituras                  | `tests/unit/call-plan.test.ts:89-92`; `tests/unit/engine-analyze.test.ts:420-423`                                                          | ✅                                        |
| FLW-44 | 0 chamadas: edição recusada                           | `tests/unit/editor.test.ts:304-305`; `tests/e2e/editor.spec.ts:255`                                                                        | ✅                                        |
| FLW-45 | Import fora dos limites: normalizado, com avisos      | `tests/unit/edgeRules.test.ts:368,372,381-382,387-388`; `tests/unit/persistence.envelope.test.ts:344-347`                                  | ✅                                        |
| FLW-46 | `after_miss` numa aresta `back`: sem carga            | `tests/unit/engine-analyze.test.ts:407` `rps === 0`                                                                                        | ✅                                        |
| FLW-47 | Entrada expandida: a resposta volta ao card de origem | `tests/unit/flow-balls.test.ts:668-671`                                                                                                    | ✅                                        |
| FLW-48 | Pausado: bolas e respostas congeladas                 | `tests/e2e/traffic.spec.ts:193-194` contagens iguais em 1 s, respostas > 0                                                                 | ⚠️ Proxy: compara contagens, não posições |
| FLW-49 | Limites só como constantes exportadas e importadas    | `src/domain/graph/edgeRules.ts:334,337`; `tests/unit/edgeRules.test.ts:368,381,426`; `tests/e2e/editor.spec.ts:279`                        | ✅                                        |

### Success Criteria

| Critério                                                                                 | Evidência                                                                                                                                                                                                                                                                                | Status                                 |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Nas 35 referências a requisição volta à entrada, e nenhuma async volta                   | O mecanismo: `tests/unit/flow-balls.test.ts:409,424,455`. Refiz a sonda no scratch, agora com `edgeLinkFailure` (`analyzeWithModel` → `steadyStateToSnapshot` com `linkFailure` → `FlowBalls` por 600 quadros): as 35 referências têm respostas na entrada e 0 respostas em aresta async | ✅ Sem teste permanente por referência |
| Nenhuma referência com cache → banco; data, scoring e advisor passam                     | `tests/unit/data.test.ts:113,123-124`; suíte verde                                                                                                                                                                                                                                       | ✅                                     |
| Design salvo antes abre com a mesma carga (deep-equal) e sem aviso                       | `tests/unit/persistence.migrate.test.ts:356-358,374`; `tests/unit/engine-golden.test.ts:303,310`                                                                                                                                                                                         | ✅                                     |
| Redis derrubado no URL Shortener: o banco recebe todas as leituras, sem falha pelo cache | `tests/unit/engine-analyze.test.ts:649-673` (sintético). A referência real foi conferida na iteração 2                                                                                                                                                                                   | ✅ Sem teste na referência             |
| Trace de leitura no URL Shortener com passos, hit/miss e total = soma                    | `tests/e2e/flow.spec.ts:88-100,129,136`                                                                                                                                                                                                                                                  | ✅                                     |
| `bundle:check` sem re-baseline                                                           | +6,9%; `bundle-baseline.json` não mudou na faixa                                                                                                                                                                                                                                         | ✅                                     |

**Contagem**:

- 47 dos 49 ACs têm evidência que discrimina a cláusula central: 44 ✅ e 3 ⚠️ cosméticos ou proxy (FLW-02, FLW-34 e FLW-48).
- 2 ACs são ❌:
  - FLW-05: X9, o caminho do Analyze.
  - FLW-36: X10, X11 e X12.
- FLW-30 e FLW-35 passaram a ✅ nesta iteração. FLW-05 e FLW-36 também melhoraram, mas ainda têm uma camada sem teste.

---

## Discrimination Sensor

Tier expandido.

- **Cópia**: `git archive HEAD` em `verifier3/` no scratchpad; o mutante entra numa cópia de trabalho e o arquivo original é restaurado depois de cada um.
- **Unit**: `node_modules` por junção, suíte inteira (930).
- **E2E**: `node_modules` copiado com `robocopy /XJ` (sem junção C: → Z:). Suíte inteira (57) contra `next dev` na :3200, 2 workers, 1 retry, mais as sondas.
- **Limpeza**: a junção saiu com `cmd //c rmdir`, o scratch foi apagado e `npm ls --depth=0` não acusa `missing`. O `git status --porcelain` real é idêntico ao do início.

### Mutantes da iteração 2, reaplicados

| #      | Arquivo                                           | Mutação                                      | Desfecho                                                                              |
| ------ | ------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------- |
| FLW-05 | `src/lib/flowBalls.ts:399`                        | `const linkP = 0` (ignora `edgeLinkFailure`) | ✅ Morto: `tests/unit/flow-balls.test.ts:540` "expected 0 to be greater than 0" (T39) |
| N4     | `src/engine/core/trace.ts:128`                    | `analyzeWithModel(graph, 1, …)`              | ✅ Morto: `tests/unit/engine-trace.test.ts:396` 43,5 não é > 87,1 (T40)               |
| N9     | `src/components/canvas/edges/AnimatedEdge.tsx:93` | Badge com ≥ 1 chamada síncrona               | ✅ Morto (e2e): `tests/e2e/editor.spec.ts:403` esperava 0 badge, recebeu 1 (T41)      |
| N10    | `src/components/canvas/edges/AnimatedEdge.tsx:87` | LB/fila também ganham badge                  | ✅ Morto (e2e): `tests/e2e/editor.spec.ts:414` esperava 0 badge, recebeu 1 (T41)      |
| N13    | `src/engine/core/sampler.ts:206`                  | Sem o `onCacheResult` do read-through        | ✅ Morto: `tests/unit/engine-trace.test.ts:153` (T42)                                 |

### Mutações novas (iteração 3)

| #   | Arquivo                                   | Mutação                                                                            | Desfecho                                                                                                                                                                           |
| --- | ----------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X1  | `src/engine/core/settle.ts:90`            | `linkFailure` inclui a falha da cadeia do alvo (`1 − ok`)                          | ✅ Morto: `tests/unit/runtime.test.ts:104` (1 ≠ 0), `:112`, `:150` (0,9 não é < 1e-6)                                                                                              |
| X2  | `src/engine/snapshot.ts:144`              | O snapshot do Analyze não publica `edgeLinkFailure`                                | ✅ Morto: `tests/unit/runtime.test.ts:103,112,150`                                                                                                                                 |
| X3  | `src/engine/core/tick.ts:592`             | O tick publica a falha total da chamada                                            | ✅ Morto: `tests/unit/runtime.test.ts:104,112,150`                                                                                                                                 |
| X4  | `src/lib/flowBalls.ts:400-403`            | A falha de link não interrompe a chamada (o alvo abre frame mesmo assim)           | ✅ Morto: `tests/unit/flow-balls.test.ts:542` (114 chegaram a `c`, esperado 0)                                                                                                     |
| X5  | `src/engine/core/routing.ts:105`          | `after_miss` ignora a falha da chamada ao cache (`f`)                              | ✅ Morto por 6 testes, entre eles `tests/unit/engine-analyze.test.ts:496,660` e `tests/unit/engine-tick.test.ts:358`                                                               |
| X6  | `src/domain/graph/callPlan.ts:133`        | `after_miss` sobe para o passo da dependência, não dep + 1                         | ✅ Morto: `tests/unit/call-plan.test.ts:124`; `tests/unit/engine-analyze.test.ts:433`                                                                                              |
| X7  | `src/engine/core/sampler.ts:209,253,256`  | Os passos seguintes rodam depois de uma falha (que continua falhando a requisição) | ✅ Morto: `tests/unit/engine-sampler.test.ts:110` (32.000 ≠ 24.000 sorteios) e o golden                                                                                            |
| X8  | `src/engine/client.ts:162`                | `simulateCanvas` devolve `linkFailure: {}`                                         | ✅ Morto: `tests/unit/runtime.test.ts:103,112`                                                                                                                                     |
| X9  | `src/components/layout/app-shell.tsx:171` | O Analyze monta o snapshot sem o `linkFailure`                                     | ❌ **SOBREVIVEU** a 930 unit + 57 e2e. Sonda e2e (referência → Analyze → `__runtimeStore.latest.edgeLinkFailure` definido e não vazio): passa no real, falha no mutante            |
| X10 | `src/components/panel/FlowPanel.tsx:20`   | `RPS_STEP` 1,25 → 1,9                                                              | ❌ **SOBREVIVEU** a 930 unit + 57 e2e. Sonda e2e (Analyze → aba Flow → 30 ticks em ×1,2 ±1% não retraçam, em ×1,32 retraçam uma vez): passa no real; o caso ×1,32 falha no mutante |
| X11 | `src/components/panel/FlowPanel.tsx:91`   | `traceCanvas(nodes, edges, { cls, index })` (sem `rps`)                            | ❌ **SOBREVIVEU** a 930 unit + 57 e2e. Sonda e2e (Analyze → aba Flow → snapshot com `offeredRps` 1 → `data-total-ms` muda): passa no real, falha no mutante                        |
| X12 | `src/engine/client.ts:190`                | `traceCanvas` passa `{ ...options, rps: undefined }`                               | ❌ **SOBREVIVEU** a 930 unit + 57 e2e (`tests/unit/sim-controller.test.ts:176-180` compara a carga ausente com `rps: 1`, que dão o mesmo valor). A sonda de X11 também falha nele  |

**Placar**: os 5 mutantes da iteração 2 morreram. Das 12 mutações novas, 8 morreram e 4 sobreviveram (X9–X12). Todo o código novo do motor na Fase 9 (`settle`, tick, snapshot, `simulateCanvas`, bolinhas) está discriminado. Os sobreviventes são a cola de UI e de cliente que leva os valores até a tela: o `AppShell` no Analyze, o `FlowPanel` e o `traceCanvas`.

---

## Desvios avaliados

| Ponto                                                         | Avaliação                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T38 tocou mais arquivos que o previsto**                    | **Aceitável.** O `Where` previa só o `settle`. O valor também precisava chegar ao snapshot do Analyze, e o desvio respeita os invariantes do `CLAUDE.md`. (1) O motor continua fora do bundle inicial: `app-shell.tsx:158` importa `@/engine/client` com `import()`; o fallback de `client.ts:120` usa `import("./analyze")`; o bundle segue em +6,9% e o `bundle:check` passa. (2) `analyze()` e `SteadyState` não mudam de forma: `analyze()` devolve `analyzeWithModel(...).steady` (`analyze.ts:111`), e o novo tipo `AnalyzedGraph` (`types.ts:127`) fica à parte. (3) O `analyzeGraph` de `client.ts:86-101`, usado pelo scoring, não mudou. (4) O `settle` não tem fork: `linkFailure` sai do mesmo laço (`settle.ts:87-90`), e `ok = linkOk × success` mantém a associação ((a·b)·c) de antes, por isso o golden passa sem tocar no fixture. (5) O campo fica no topo do snapshot, fora de `edges` (`runtime.test.ts:157`), e não re-renderiza arestas (`metrics.test.ts:207-209`). A API do worker ganhou `analyzeGraphWithLinks` (`worker.ts:34`). O custo do desvio é a cola nova sem teste (X9) |
| FLW-05, falha de link nas bolinhas e retries                  | Observação, não bloqueia. A bolinha falha a chamada com a probabilidade de uma tentativa (`edgeLinkFailure`). O motor conta a chamada com retries (1 − f^{R+1}). Com `maxRetries` > 0, o canvas mostra mais respostas de erro do que o motor mede. A spec não pede que as bolinhas modelem retries, e a falha do nó já funcionava assim antes. Arestas async de um chamador com `timeoutMs` também podem mostrar burst por timeout, o que bate com o status `error` da aresta no tick                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| FLW-36, base do "25%"                                         | Spec-precision (ver a tabela): a histerese é simétrica em log (+25% / −20%). É defensável, mas a spec não diz qual é a base                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| T13 `writeShareOf` com k (SPEC_DEVIATION em `catalog.ts:180`) | Testado (`engine-chaos.test.ts:545`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

---

## Premissas pendentes do usuário (aceitas, não causam FAIL)

| Premissa                             | Situação                                                                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Textos da interface em inglês        | `Confirmed? n`. Os testes verificam os textos exatos em inglês (`tests/e2e/flow.spec.ts:85,198`; `tests/e2e/traffic.spec.ts:183-184`)                                    |
| O trace amostra sem as faults ativas | `Confirmed? n`. O código segue a premissa por construção: `traceCanvas` não recebe efeitos (`FlowPanel.tsx:91`). Passar as faults está em `context.md` como ideia adiada |

---

## Fix Plans (rankeados; todos só testes)

### F1: A carga do trace até a tela (FLW-36) — Major, P2

- **Causa**: a T40 testou a carga só em `traceGraph`. `client.traceCanvas` e o `FlowPanel` repassam `rps` sem teste.
- **Tarefa (unit)**: em `tests/unit/sim-controller.test.ts`, ao lado de `:176`, usar o design de `engine-trace.test.ts:371` (app de 100 req/s): a média de `traceCanvas(..., { rps: 95 })` é maior que 2× a de `{ rps: 1 }`. Mata X12.
- **Tarefa (e2e)**: em `tests/e2e/flow.spec.ts`, depois do Analyze, empurrar um snapshot com `offeredRps` 1 e esperar `data-total-ms` mudar. Mata X11 e X12.
- **Feito quando**: os dois testes falham nos mutantes X11 e X12 em scratch.

### F2: O snapshot do Analyze leva `edgeLinkFailure` (FLW-05) — Major, P1

- **Tarefa**: e2e em `tests/e2e/flow.spec.ts` ou `traffic.spec.ts`, num design em que o chamador estoura o timeout (por exemplo, App `timeoutMs` 5 → SQL de 200 ms, como em `runtime.test.ts:87`). Depois do Analyze, `__runtimeStore.getState().latest.edgeLinkFailure[<app→db>]` > 0,99. Se houver um contador de bursts ou de respostas de erro em `data-*`, asserir também por ele.
- **Feito quando**: falha com X9 (`app-shell.tsx:171` sem `linkFailure`).

### F3: O limite de 25% do trace (FLW-36) — Minor, P2

- **Tarefa**: no teste de `tests/e2e/flow.spec.ts:164`, empurrar ×1,2 (nenhum trace novo) e ×1,32 (um trace novo), com ruído menor que o espaço até o limite. Alternativa: extrair a decisão de `useTraceRps` para uma função pura e testar 1,24 e 1,26.
- **Decisão do usuário**: "muda mais de 25%" vale em log (+25% / −20%, como hoje) ou em relação à carga anterior nos dois sentidos (±25%)? Registrar a escolha na spec.
- **Feito quando**: falha com X10 (`RPS_STEP` 1,9).

### F4: Asserções visuais (FLW-02, FLW-34, FLW-48) — Cosmetic

Já está em `context.md` como ideia adiada e não bloqueia.

F1–F3 bastam para virar o veredito, e nenhum muda `src/`. Esta é a iteração 3 de 3: o orquestrador escala ao usuário, que decide entre aplicar F1–F3 (e a escolha da base do F3) ou aceitar as lacunas.

---

## Code Quality

| Item                          | Status                                                                                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fase 9 mapeada a ACs          | ✅ T38/T39 → FLW-05, T40 → FLW-36, T41 → FLW-30, T42 → FLW-35                                                                                                  |
| Testes novos discriminam      | ✅ Cada um mata o mutante que mira (FLW-05, N4, N9, N10, N13); X1–X4 e X8 morrem nos testes da T38/T39                                                         |
| Invariantes do `CLAUDE.md`    | ✅ Golden intocado; `settle`/`faultView` sem fork; métricas fora do `canvasStore`; motor fora do bundle inicial; `edgeLinkFailure` fora dos objetos por aresta |
| Asserções nos valores da spec | ❌ FLW-36: a carga entre o painel e o motor, e o limite de 25%. FLW-05: o snapshot do Analyze                                                                  |
| Diretrizes seguidas           | `CLAUDE.md`, `AGENTS.md`                                                                                                                                       |

---

## Requirement Traceability Update

| Requisito              | Status no `spec.md` | Status verificado                                  |
| ---------------------- | ------------------- | -------------------------------------------------- |
| FLW-05                 | Implemented         | ❌ Needs Fix (F2: e2e do Analyze)                  |
| FLW-36                 | Implemented         | ❌ Needs Fix (F1, F3: testes; F3 pede uma decisão) |
| FLW-02, FLW-34, FLW-48 | Implemented         | ⚠️ Implemented, sem asserção visual                |
| FLW-30, FLW-35         | Implemented         | ✅ Verified (resolvidos na Fase 9)                 |
| Os demais 42           | Implemented         | ✅ Verified                                        |

---

## Summary

**Overall**: ❌ Not Ready. Iteração 3 de 3: escalar ao usuário.

- **Spec-anchored**: 47/49 ACs com evidência que discrimina (3 deles ⚠️ cosméticos ou proxy) e 2 ❌ (FLW-05 no Analyze; FLW-36 entre o painel e o motor e no limite de 25%).
- **Sensor**: os 5 mutantes da iteração 2 morreram. Das 12 mutações novas, 8 morreram e 4 sobreviveram (X9–X12, todas na cola de UI e de cliente).
- **Gates**: 930 unit, 57 e2e (`CI=1`, 0 instáveis), typecheck/lint/format/build ok, bundle +6,9%.
- **Próximo passo**: decisão do usuário. F1–F3 são só testes (F3 pede também a escolha da base do "25%").
