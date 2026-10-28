# CAP e consistência sob falha

**Status:** In progress
**Owner:** usuário (decisão) · agente (rascunho)
**Date:** 2026-10-28

## Problem

Hoje a classificação CAP de uma tecnologia é só texto na tela. Um design com Cassandra (AP, `consistencyLevel = ONE`), DynamoDB com leitura eventual ou MongoDB com `secondaryPreferred` se comporta igual a um PostgreSQL sob a mesma falha: o `partition` atual corta uma aresta e **tudo falha**, sem noção de réplica sobrevivente, de leitura velha ou de recusa por falta de quórum. O candidato não consegue ver o trade-off que a entrevista cobra — "o que este banco faz quando perde réplicas?" — e o `staleReadRps` não existe em lugar nenhum: `replicationLagMs` é só um número exibido no card, sem efeito no motor.

Também não há como distinguir uma recusa deliberada de consistência (CP) de uma sobrecarga: `errorRate` e `drops` já misturam recusa, overflow e throttling.

## Outcome

Sob uma falha de perda de réplicas, cada store de dados se comporta como a tecnologia e os parâmetros dele mandam: um store forte (CP) **recusa** quando não alcança o quórum, e um store eventual (AP) **continua servindo**, contando as leituras potencialmente velhas. A leitura stale aparece por nó no Analyze e no tick ao vivo, no painel e no card do nó, com o mesmo número nos dois caminhos. É o trade-off de CAP visível e medido, sem inventar números: a métrica conta leituras, não envelhece dados.

## Acceptance criteria

1. O catálogo de chaos oferece **"Replica loss"** para um nó de store com tecnologia e com ≥ 2 réplicas, e não oferece para nó `generic`, LB, gateway, fila ou cliente. A intensidade é o número de réplicas perdidas: o seletor oferece 1–7 e o `build()` a limita a `replicas − 1`.
2. Cassandra/ScyllaDB com `replicationFactor = 3`, `consistencyLevel = ONE` e 1 réplica perdida: o nó reporta `staleReadRps > 0` no Analyze e no tick, e `errorRate` não sobe acima do baseline sem a falha.
3. Cassandra/ScyllaDB com `consistencyLevel = QUORUM` e 2 réplicas perdidas: o nó recusa as leituras (`errorRate > 0`, `drops > 0`) e `staleReadRps = 0`; o mesmo vale para `ALL` com 1 réplica perdida.
4. DynamoDB com `readConsistency = eventual` e 2 de 3 réplicas perdidas: as leituras não são recusadas e `staleReadRps > 0` (as escritas podem ser recusadas por falta de quórum); com `strong`: as leituras são recusadas (`errorRate > 0` no caminho de leitura) e `staleReadRps = 0`.
5. MongoDB com `readPreference = secondaryPreferred` e 1 secundário perdido: `staleReadRps > 0`; com `primary`: `staleReadRps = 0`. Com os 2 secundários perdidos, `writeConcern = majority` recusa escritas e `w: 1` não.
6. Read Replica de SQL com `replicationLagMs > 0` conta as leituras que chegam pelo nó de réplica como stale quando a réplica perde instâncias; o primário (`sql-db`) não muda de comportamento.
7. Para o mesmo grafo, a mesma falha e a mesma seed, `analyzeUnderFault()` e 50 ticks produzem o mesmo `staleReadRps` por nó (tolerância de float), e a falha curada zera o número.
8. Nó com `technology = generic` continua bit-idêntico ao motor de hoje: nenhum campo novo aparece nas métricas e a fixture `engine-golden` não muda.
9. O painel Simulate mostra uma célula **"Stale reads"** no `NodeMetricGrid` e no card do nó selecionado (`NodeInsightCard`), em req/s e % das leituras; o badge do canvas mantém o tamanho fixo e nenhuma métrica entra em `node.data` ou em store persistido.
10. O Advisor emite um finding de `source: "metrics"` com severidade `warning` quando a média recente de `staleReadRps` do nó é > 0 sob falha ativa, nomeando o nó e a falha.
11. A mesma falha não muda o comportamento de quem não é store de dados: um `kill-instances`/`zone-failure` existente continua com os números de hoje, e o golden dos 35 problemas passa sem regravar a fixture.

## Out of scope

- Rebalancear o score de Availability para punir leitura stale. Hoje `underFaults` só olha erro; mudar isso mexe no `BUDGET` de 20 e merece spec própria (fica registrado como dívida, não como esquecimento).
- Envelhecer o dado stale em ms ("lag"). Sem fonte pública por tecnologia, inventar um número violaria a regra de conteúdo do repo; a métrica conta leituras, não idade.
- Roteiros de drill (`INTERVIEW_DATA`) e a avaliação do drill; a métrica fica disponível para uma spec futura.
- Semântica de fila/pub-sub sob perda de réplica (Kafka/SQS): entrega é outro eixo, não CAP de leitura.
- Migrar as 35 referências para tecnologias reais.

## Approach

**Modelo único, dirigido pelos params que já existem.** `techProfileOf()` passa a anexar ao `TechProfile` um bloco `replicaSet` só para stores de dados (nome distinto de `throttle.kind = "partition"`, que já existe):

```ts
interface TechReplicaSet {
  /** Cópias do conjunto (RF, instâncias, membros por shard). */
  replicas: number;
  /** Cópias que uma leitura consistente precisa alcançar. */
  readQuorum: number;
  /** Cópias que uma escrita precisa alcançar. */
  writeQuorum: number;
  /** Uma leitura pode voltar de uma cópia atrasada mesmo com o conjunto inteiro. */
  eventualReads: boolean;
}
```

Resolução por tecnologia, sem código específico de falha no tick:

| Store              | `replicas`           | `readQuorum`                     | `writeQuorum`            | `eventualReads`                |
| ------------------ | -------------------- | -------------------------------- | ------------------------ | ------------------------------ |
| Cassandra/Scylla   | `min(RF, instances)` | `quorumOf(consistencyLevel, RF)` | idem                     | `consistencyLevel === "one"`   |
| DynamoDB           | 3                    | `strong ? 2 : 1`                 | 2                        | `readConsistency !== "strong"` |
| MongoDB            | membros por shard    | 1 (primário)                     | `majority ? ⌈m/2⌉+1 : 1` | `secondaryPreferred`           |
| SQL `sql-db`       | `instances`          | 1 (primário)                     | 1 (primário)             | `false`                        |
| SQL `read-replica` | `instances`          | 1                                | 1                        | `true`                         |
| Redis              | `instances`          | 1                                | 1 (primário)             | `true`                         |
| OpenSearch         | `replicas` do schema | 1                                | 1                        | `true`                         |
| S3                 | —                    | 1                                | 1                        | `false`                        |

`lostReplicas` é um `ModifierKind` novo, com valor = réplicas perdidas. A falha **"Replica loss"** (categoria `data`, alvo `node`) o constrói; `effectsAt` dobra pelo máximo, e `faultView`/`analyze`/tick leem o valor. Nada no tick conhece o id da falha: ele só sabe quantas réplicas sobraram. O `sql-db` primário continua com `db-primary-failure` (que já modela failover) e não é alvo de `replica-loss`; o nó `read-replica` participa com `readQuorum = 1` e `eventualReads = true`.

**Regra de comportamento** (a mesma para tick e Analyze, em `core/tech.ts`). A perda é **ordenada e determinística**: as cópias primeiro, o primário por último — a queda do primário é assunto de `db-primary-failure`, que já modela o failover. `lost = min(intensidade, replicas − 1)`. Assim o mesmo grafo e a mesma falha dão sempre o mesmo resultado, e o MongoDB testa `secondaryPreferred`/`writeConcern` sem confundir com a morte do primário.

- `survivors = replicas − lost`.
- Escrita: se `survivors < writeQuorum`, a escrita falha para todo store (entra em `errorRate`/`drops`).
- Leitura: se `survivors < readQuorum`, **recusa** (erro), seja o store rotulado CP ou AP — o quórum pedido não é alcançável, e é isso que `consistencyLevel = QUORUM/ALL` e `readConsistency = strong` significam.
- Leitura com `survivors ≥ readQuorum` e `eventualReads`: serve e conta stale na fração `lost / replicas`, porque a resposta pode vir de uma cópia que não recebeu o último write. Nó com `replicationLagMs` só conta stale quando o lag é > 0 (lag 0 = réplica em dia).
- Leitura com `survivors ≥ readQuorum` e `!eventualReads`: fresca.
- `Technology.cap` é só rótulo (CP/AP/none para LB, fila e gateway); quem decide o comportamento são `readQuorum`/`writeQuorum`/`eventualReads`, que saem dos params.
- `staleReadRps` é um primitivo plano em `NodeRuntimeMetrics` e em `NodeSteadyState`, emitido **nos dois produtores** com a mesma presença de chave, e ausente em `generic`.
- `Technology.cap` (`"cp" | "ap" | "none"`) entra como dado estruturado só para rótulo/UI; o comportamento continua vindo dos params, que é o que o candidato ajusta.

**Determinismo e golden.** O caminho é gated por `node.tech.replicaSet` e pela falha `replica-loss`; a fixture não tem tecnologia nem efeitos, então os 35 casos e os 4 sintéticos seguem idênticos.

**Persistência.** Não há schema novo: a falha é runtime (`chaosStore` espelha o registro, nada persistido no canvas) e não entra em `params`; `STORE_VERSION` não muda.

## Files likely touched

- `src/domain/components/technologies/types.ts`: `cap` e o bloco `replicaSet` no perfil.
- `src/domain/components/technologies/profile.ts`: resolver `replicaSet` por tecnologia a partir dos params.
- `src/domain/components/technologies/{sql,nosql,cache,storage}.ts`: rótulo `cap` e constantes de réplica.
- `src/engine/faults/types.ts`: `ModifierKind: "lostReplicas"` e `FaultType: "replica-loss"`.
- `src/engine/faults/catalog.ts`: entrada nova, filtro de alvo e `build()`.
- `src/engine/faults/effects.ts`: dobrar o modificador (sem quebrar o guard `never`).
- `src/engine/core/{tech,faultView,tick}.ts`: aplicar `replicaSet` + réplicas perdidas; emitir `staleReadRps`.
- `src/engine/analyze.ts` e `src/engine/snapshot.ts`: o mesmo número no caminho do Analyze.
- `src/engine/types.ts`: `staleReadRps` em `NodeRuntimeMetrics` e `NodeSteadyState`.
- `src/components/panel/MetricsDisplay.tsx`: célula "Stale reads".
- `src/components/canvas/NodeInsightCard.tsx`: reusa a célula.
- `src/advisor/{types,load}.ts`: finding medido com a média do novo campo.
- `src/store/advisorStore.ts`: média do campo novo no `recentLoad`.
- `docs/03-catalogo-de-componentes.md` e `docs/04-motor-de-simulacao.md`: regra e tabela.
- Testes: `tests/unit/engine-chaos.test.ts`, `tests/unit/technologies.test.ts`, `tests/unit/metrics.test.ts`, `tests/unit/advisor.test.ts`, `tests/e2e/metrics.spec.ts`.

## Test plan

| Criterion | Test that proves it                                                                                               | Kind       |
| --------- | ----------------------------------------------------------------------------------------------------------------- | ---------- |
| 1         | `engine-chaos.test.ts`: catálogo oferece/recusa "Replica loss" por tipo e presença de tecnologia                  | unit       |
| 2         | `engine-chaos.test.ts`: Cassandra ONE, RF 3, 1 perdida → `staleReadRps > 0`, `errorRate` no baseline              | unit       |
| 3         | `engine-chaos.test.ts`: Cassandra QUORUM, 2 perdidas → erro > 0, stale = 0; ALL, 1 perdida idem                   | unit       |
| 4         | `engine-chaos.test.ts`: DynamoDB eventual vs strong                                                               | unit       |
| 5         | `engine-chaos.test.ts`: MongoDB secondaryPreferred vs primary; majority vs w:1                                    | unit       |
| 6         | `engine-chaos.test.ts`: read-replica com lag perde instância → stale; `sql-db` primário inalterado                | unit       |
| 7         | `engine-chaos.test.ts`: `analyzeUnderFault` vs 50 ticks, mesmo grafo/seed; heal zera                              | unit       |
| 8         | `engine-golden.test.ts` passa sem diff na fixture; `metrics.test.ts` confirma ausência do campo em generic        | unit       |
| 9         | `metrics.test.ts` (igualdade/estrutura) + `tests/e2e/metrics.spec.ts` (célula visível, nada no canvas persistido) | unit + e2e |
| 10        | `advisor.test.ts`: finding `metrics`/`warning` com stale > 0 e nenhum com 0                                       | unit       |
| 11        | `engine-chaos.test.ts` + `engine-golden.test.ts`: falhas antigas inalteradas e golden verde                       | unit       |

## Slices

1. **Tracer (um PR):** contrato `TechReplicaSet` + `lostReplicas`/`replica-loss` + Cassandra/Scylla + `staleReadRps` no Analyze, no tick e no painel, com os testes 1–3, 7–9. É o caminho mais fino que prova o desenho ponta a ponta.
2. **Os demais stores (um PR):** DynamoDB, MongoDB, SQL/read-replica, Redis, OpenSearch, S3; testes 4–6; `cap` no picker.
3. **Advisor e docs (um PR):** finding medido, média no `advisorStore`, docs 03/04 e teste 10.

## Decisions (approved 2026-10-28)

- **Falha dedicada:** `replica-loss`, com intensidade em réplicas ("perdi 1 de 3"), em vez de derivar de `kill-instances`/`zone-failure`.
- **Idade do stale:** só taxa (req/s e % das leituras); sem ms, para não inventar lag sem fonte.
- **Score:** o rebalanceamento de Availability fica para spec própria; esta entrega mede e expõe a leitura stale.
- **Cache:** Redis com réplica atrasada conta stale; Memcached sem replicação conta **miss**, não stale.
- **Serviços gerenciados multi-AZ:** a perda explícita de réplicas vale mesmo para DynamoDB/S3; a falha é explícita, não uma AZ.
- **Aberto para o slice 2:** confirmar a mesma regra de ordenação (cópias antes do primário) para o MongoDB e os demais stores.
