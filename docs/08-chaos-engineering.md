# Spec 08: Chaos engineering

Parte da [v2](00-visao-geral.md) · Fase 3 (CHS-01, 02, 04) e Fase 5 (CHS-03, 05, 06) · Tamanho M · Status: CHS-01 a 04 e 06 implementados; CHS-05 (game days) pendente

| Campo               | Valor                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Requisitos          | CHS-01, CHS-02, CHS-04 (P0), CHS-03, CHS-05, CHS-06 (P1)                                                              |
| Depende de          | [Spec 04](04-motor-de-simulacao.md) (`inject`/`heal`), [Spec 07](07-metricas-e-observabilidade.md) (timeline, badges) |
| Consumida por       | 09 (failure drill), 11 (burn rate), 12 (dica de mitigação)                                                            |
| Arquivos principais | novo `engine/faults/` (catalog, compile), `store/chaosStore.ts`, `components/panel/ChaosPanel`                        |

## Objetivo

Deixar o usuário quebrar o sistema ao vivo e ver o efeito: cada fault muda as métricas enquanto está ativo e tudo volta ao baseline depois do heal.

## Requisitos

1. **CHS-01 (P0)** Painel de chaos com triggers ao vivo durante o play. Cada fault tem alvo (nó, aresta, grupo ou global), intensidade, duração e auto-heal opcional.
2. **CHS-02 (P0)** Faults do MVP: kill de instância/nó, nó lento (grey failure), spike de tráfego, latência na aresta, perda de pacote, particionamento (corta a aresta), flush de cache (stampede), falha do primary do DB, consumer da fila parado.
3. **CHS-03 (P1)** Catálogo completo no estilo ArchSim: falha de AZ/região, disco cheio, IOPS throttle, memory leak, thread pool esgotado, deadlock, certificado TLS expirado, DNS, health check flapping, retry storm.
4. **CHS-04 (P0)** Blast radius destacado no canvas (nós afetados pulsam) e timeline com marcadores de início e fim de cada fault.
5. **CHS-05 (P1)** Game days: roteiros de chaos por problema ("mate o cache no pico e mantenha o p99 < 200 ms") com critério de passou/falhou.
6. **CHS-06 (P1)** Dica de mitigação por fault com quick fix (ex.: "adicionar circuit breaker entre App e Payment").

## Design

### Fault compilado em modificadores

Como no ArchSim, cada fault vira um conjunto de modificadores com início, fim e alvo, aplicados no passo 1 ou 3 do tick ([Spec 04](04-motor-de-simulacao.md)). Não há código especial por fault.

| Modificador                          | Exemplos de fault                                               |
| ------------------------------------ | --------------------------------------------------------------- |
| `capacityMultiplier`                 | Kill de instância (1 − 1/c), CPU saturada, thread pool esgotado |
| `latencyAddMs` / `latencyMultiplier` | Nó lento, latência na aresta, disco lento                       |
| `errorRate`                          | Deadlock, TLS expirado, packet loss                             |
| `severEdge`                          | Particionamento de rede, porta bloqueada                        |
| `trafficMultiplier`                  | Spike ×N, DDoS                                                  |
| `hitRateOverride`                    | Flush de cache / stampede                                       |
| `nodeDown`                           | Falha do primary, falha de AZ (todos os nós do grupo)           |
| `drainEdge`                          | Health check do LB tira um alvo morto de rotação                |

```ts
interface FaultSpec {
  type: FaultType; // id do catálogo
  target: { kind: "node" | "edge" | "group" | "global"; id?: string };
  intensity: number; // semântica por tipo (ex.: instâncias mortas, ms extra, multiplicador)
  durationSec?: number; // ausente = até heal manual
  autoHeal?: boolean;
}

interface CompiledModifier {
  kind:
    | "capacityMultiplier"
    | "latencyAddMs"
    | "latencyMultiplier"
    | "errorRate"
    | "severEdge"
    | "trafficMultiplier"
    | "hitRateOverride"
    | "nodeDown";
  targetIds: string[];
  value: number;
  startT: number;
  endT?: number;
}
```

`faults/catalog.ts` descreve cada tipo (label, alvos permitidos, faixa de intensidade, função `compile`). `faults/compile.ts` é puro e testável.

### Mapeamento dos faults do MVP

| Fault                   | Modificadores                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Kill de instância       | `capacityMultiplier = 1 − k/c`; com LB na frente, o tráfego continua indo para a instância morta até o intervalo do health check passar |
| Kill de nó              | `nodeDown`; um LB com outros alvos aplica `drainEdge` na aresta depois do intervalo do health check                                     |
| Nó lento (grey failure) | `latencyMultiplier` (sem erro, o health check não pega)                                                                                 |
| Spike de tráfego        | `trafficMultiplier` global ou numa fonte                                                                                                |
| Latência na aresta      | `latencyAddMs` na aresta                                                                                                                |
| Perda de pacote         | `errorRate` na aresta (vira retry se o nó tiver retries)                                                                                |
| Particionamento         | `severEdge`                                                                                                                             |
| Flush de cache          | `hitRateOverride = 0` no início, depois recuperação h(t) da [Spec 04](04-motor-de-simulacao.md)                                         |
| Falha do primary do DB  | `nodeDown` no primary; writes falham até o failover (param do schema)                                                                   |
| Consumer parado         | `capacityMultiplier = 0` no worker/consumer; a fila acumula lag                                                                         |

### `chaosStore`

Faults ativos, histórico da execução (para a timeline) e o roteiro carregado. O roteiro é persistido no envelope como `chaosScript` ([Spec 05](05-persistencia-e-compartilhamento.md)); os faults ativos não.

### UI

- Painel Chaos: lista do catálogo agrupada por categoria (compute, rede, dados, tráfego), formulário de alvo/intensidade/duração e botão "Injetar". Faults ativos com contagem regressiva e botão "Curar"
- Atalho no canvas: "Kill/Restore" no menu de contexto e no `NodeToolbar` ([Spec 02](02-editor-confiavel.md))
- Blast radius: nós e arestas afetados direta ou indiretamente (downstream com erro ou latência acima do baseline) pulsam; o alvo tem contorno próprio
- Timeline abaixo do canvas com uma faixa por fault (início, fim, alvo), compartilhada com o dashboard da [Spec 07](07-metricas-e-observabilidade.md)

### Catálogo completo (CHS-03)

Os faults adicionais reusam os mesmos modificadores. Falha de AZ/região depende de grupos ([Spec 13](13-editor-avancado.md), CAN-08) e aplica `nodeDown` a todos os filhos do grupo. Retry storm é emergente: basta um fault com `errorRate` num nó com retries agressivos.

Implementação (`engine/faults/catalog.ts`, sem código novo no tick):

| Fault                            | Alvo                                    | Modificadores                                                                                                                                                                                      |
| -------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Queda de zona (AZ)               | global; intensidade = nº de zonas (2–6) | cada tier perde ⌈n/z⌉ instâncias (round-robin entre zonas), como o kill de instâncias (o LB contorna depois do health check); tier de 1 instância cai; DNS, CDN e object storage gerenciados ficam |
| Memory leak                      | nó; intensidade = tempo até o OOM       | `latencyMultiplier` ×1,25 → ×3 em quatro degraus até o OOM, depois `nodeDown` (com o dreno dos LBs) até o heal                                                                                     |
| Thread pool esgotado             | serviço; intensidade = threads presas   | `capacityMultiplier = 1 − presas`; o health check passa e o LB não contorna                                                                                                                        |
| Erros transitórios (retry storm) | nó; intensidade = taxa de erro          | `errorRate` no nó; chamadores com R retries amplificam a carga para λ(1 − f^(R+1))/(1 − f)                                                                                                         |
| Disco cheio                      | banco, busca, fila, file store          | `errorRate` nas arestas de entrada pela parcela de escrita (fila: toda publicação); leituras seguem                                                                                                |
| IOPS throttle                    | idem; intensidade = vazão restante      | `capacityMultiplier`                                                                                                                                                                               |
| Deadlock                         | SQL; intensidade = escritas abortadas   | `errorRate` nas escritas + `latencyMultiplier` 1,5 (espera por lock)                                                                                                                               |
| Certificado TLS expirado         | nó chamado                              | `errorRate = 1` em toda aresta de entrada; health check em porta sem TLS passa                                                                                                                     |
| DNS fora do ar                   | DNS                                     | `errorRate = 1` no nó, só nas consultas sem cache (`lookupShare`); respostas em cache passam                                                                                                       |
| Health check flapping            | aresta LB → alvo (LB com 2+ alvos)      | `drainEdge` na segunda metade de cada período (intensidade), até o fim do fault                                                                                                                    |

Desvios: a queda de **região** não entrou (o modelo não tem multi-região); a de **zona** não espera os grupos da Spec 13 e supõe as instâncias de cada tier distribuídas em round-robin entre as zonas. O erro de um fault num resolver (DNS) passou a atingir só a parcela de consultas sem cache, no tick e no `analyze()`.

### Game days (CHS-05)

Roteiro = trilha de eventos da [Spec 06](06-controles-de-trafego.md) + critério (`p99 < X`, `availability ≥ Y`, `errorRate < Z` durante a janela). No fim, veredito passou/falhou com o gráfico do incidente. Os roteiros por problema são a base do failure drill da [Spec 09](09-modo-entrevista-v2.md).

### Mitigação (CHS-06)

Cada tipo de fault declara dicas de mitigação ligadas a quick fixes do advisor ([Spec 12](12-advisor.md)): cache flush → proteção contra stampede; primary down → réplica com failover; latência em dependência → circuit breaker + timeout.

Implementação: `advisor/mitigation.ts` (`mitigationsFor(fault, grafo, contexto)`, puro) dá as dicas de cada tipo e, quando cabem no design, quick fixes com o mesmo preview (fantasmas) e o mesmo apply (um passo de undo) do advisor. Aparecem na aba Chaos no formulário (para o fault e o alvo escolhidos) e em cada fault ativo; aplicar durante a execução troca o grafo a quente e o fault continua no alvo.

| Fault                                     | Quick fix                                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| Kill de nó/instâncias, memory leak        | N+1 instâncias (2 para uma única)                                                         |
| Queda de zona                             | 2 instâncias em todo tier de instância única (exceto os gerenciados multi-zona)           |
| Nó lento, thread pool, erros transitórios | circuit breaker entre o chamador mais carregado e o nó; nos erros, limitar retries a 1    |
| Latência na aresta, particionamento       | circuit breaker na aresta; a ligação para o destino mantém o id, então o fault segue nela |
| Perda de pacote, deadlock                 | 2 retries com backoff nos chamadores que não tentam de novo                               |
| Falha do primary                          | standby (2 instâncias) e retries nos escritores                                           |
| Consumer parado                           | dead-letter queue na fila                                                                 |
| Spike de tráfego                          | o rate limit do advisor, com o limite a 2× a carga anterior ao spike                      |
| DNS fora do ar                            | TTL maior (metade das consultas sem cache)                                                |
| Health check flapping                     | histerese no LB (3 falhas seguidas para tirar o alvo)                                     |
| Cache flush, disco cheio, IOPS, TLS       | só dicas (coalescing, alertas, IOPS provisionado, renovação automática)                   |

Para o circuit breaker ter efeito, o tick ganhou a máquina de estados (`engine/core/breaker.ts`, como o CircuitBreaker do Resilience4j): fechado, abre quando a taxa de falha das chamadas que ele repassa (erros e timeouts, inclusive o `timeoutMs` dele, novo no schema) nas ~100 últimas chamadas chega ao `errorThreshold` com `minimumCalls`; aberto, falha rápido e nada chega à dependência por `openDurationSec`; meio-aberto, deixa passar `halfOpenProbes` e fecha ou reabre. Sem aleatórios (o determinismo fica); o `analyze()` o trata como fechado.

## Critérios de aceite

- [x] Cada fault do MVP muda as métricas esperadas enquanto está ativo
- [x] Cada fault volta ao baseline depois do heal (dentro de uma tolerância, depois de drenar a fila)
- [x] Blast radius aparece no canvas
- [x] Timeline mostra início e fim de cada fault
- [x] Faults só podem ser injetados com a simulação carregada e não editam o grafo

### Critérios de aceite (Fase 5)

- [x] Cada fault do CHS-03 muda as métricas esperadas e volta ao baseline depois do heal
- [x] Todo tipo de fault tem dicas de mitigação; os quick fixes são puros e o grafo resultante compila
- [x] Um circuit breaker inserido pela mitigação abre quando a ligação protegida cai e fecha depois do heal
- [ ] Game days (CHS-05)

## Testes (Vitest)

- Para cada fault do MVP: baseline → inject → métrica alvo muda na direção esperada → heal → volta ao baseline
- `compile` é puro: mesmo `FaultSpec` + mesmo grafo → mesmos modificadores
- Kill de instância atrás de LB: erros durante o intervalo do health check e zero erros depois
- CHS-03: cada fault novo no tick (baseline → fault → heal → baseline); circuit breaker fechado/aberto/meio-aberto e determinístico (`engine-chaos.test.ts`)
- CHS-06: `mitigation.test.ts` (dicas para todo tipo, fixes puros que compilam, o breaker inserido abre sob particionamento)
