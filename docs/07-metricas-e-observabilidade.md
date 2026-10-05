# Spec 07: Métricas e observabilidade

Parte da [v2](00-visao-geral.md) · Fase 2 (OBS-01 a 04) e Fase 5 (OBS-05 a 07) · Status: OBS-01 a 04 e OBS-06 implementados (o OBS-06 pela aba Flow)

| Campo               | Valor                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Requisitos          | OBS-01 a OBS-04 (P0), OBS-05 a OBS-07 (P1)                                                                             |
| Depende de          | [Spec 04](04-motor-de-simulacao.md) (`TickSnapshot`, ring buffer)                                                      |
| Consumida por       | 08 (blast radius), 09 (relatório), 11 (SLO), 12 (advisor)                                                              |
| Arquivos principais | novo `store/runtimeStore.ts`, `components/canvas/FlowParticles`, `components/panel/MetricsDashboard`, nó de componente |
| Dependências novas  | `uplot` (Fase 5)                                                                                                       |

## Objetivo

Mostrar o que o motor calcula: métricas por nó e globais no canvas e no painel, e tokens animados nas arestas, sem custo de re-render do grafo.

## Requisitos

1. **OBS-01 (P0)** Por nó: RPS de entrada e saída, utilização, profundidade de fila, p50/p95/p99, error rate, drops. Aparecem em badge no nó e em gráfico no painel.
2. **OBS-02 (P0)** Globais: throughput, goodput (sucesso dentro do SLO), error rate, p50/p95/p99 end-to-end e disponibilidade.
3. **OBS-03 (P0)** Específicas: hit ratio do cache, lag da fila, uso do pool de conexões, replication lag, estado do circuit breaker.
4. **OBS-04 (P0)** Animação: bolas que representam requests percorrendo o grafo, em número proporcional ao RPS, e cor por status (ok, lento, erro). As arestas engrossam conforme a carga.
5. **OBS-05 (P1)** Dashboard com séries temporais dos últimos 5 min simulados, com zoom e comparação entre duas execuções (antes/depois de uma mudança).
6. **OBS-06 (P1)** Request trace: amostrar um request e mostrar o caminho, com o tempo gasto em cada hop. ✅ Entregue pela aba Flow ([fluxo da requisição](../.specs/features/request-flow/spec.md)), como diagrama de sequência em vez de waterfall.
7. **OBS-07 (P1)** Alertas: utilização > 90%, início de drops, SLO queimando rápido.

## Design

### `TickSnapshot`

```ts
interface NodeMetrics {
  rpsIn: number;
  rpsOut: number;
  utilization: number; // ρ
  queueDepth: number;
  p50: number;
  p95: number;
  p99: number; // ms, só o hop
  errorRate: number;
  drops: number;
  status: "ok" | "warn" | "critical" | "down";
  extra?: {
    // OBS-03, por tipo
    hitRatio?: number;
    queueLagSec?: number;
    poolUsage?: number;
    replicationLagMs?: number;
    breakerState?: "closed" | "open" | "half-open";
  };
}

interface TickSnapshot {
  t: number; // segundos simulados
  nodes: Record<string, NodeMetrics>;
  edges: Record<string, { rps: number; status: "ok" | "slow" | "error" }>;
  global: {
    throughput: number;
    goodput: number;
    errorRate: number;
    p50: number;
    p95: number;
    p99: number;
    availability: number;
  };
  traces?: RequestTrace[]; // reservado: a aba Flow calcula o trace sob demanda (traceCanvas)
}
```

### `runtimeStore`

- Não persistido. Guarda o último `TickSnapshot` e o ring buffer de 6.000 ticks (5 min simulados a 50 ms)
- Cada nó assina só as suas métricas com um selector (`useRuntimeStore(s => s.latest?.nodes[id])`), então um tick não re-renderiza o grafo nem re-persiste o `canvasStore`
- Sai o `stripRuntimeFields` do `canvasStore`, e `utilization`/`status`/`isBottleneck` deixam de existir em `node.data`
- A UI recebe snapshots a 10 fps (throttle no worker)

### Badges no nó

- Badge compacto: RPS de entrada, utilização (barra) e p99
- Status indicado por cor **e** ícone (NFR de acessibilidade)
- Hover (ou tap no touch) mostra uma sparkline dos últimos 30 s

### Partículas (OBS-04)

- Uma única camada `<canvas>` 2D sobre o ReactFlow, sincronizada com o viewport, no mesmo padrão do `PenOverlay`. Nada de um elemento DOM por token
- Pontos de cada path de aresta amostrados com `getPointAtLength` e guardados em cache; recalculados só quando a aresta ou o viewport muda
- Cada bola vale `quantum` req/s (um número redondo 1-2-5 escolhido para ~6 bolas/s nas entradas, refeito só quando a carga se afasta 2,5× dele; a legenda no canto do canvas mostra o valor), então uma aresta com r req/s recebe r/quantum bolas por segundo
- A bola é um request que vai e volta: nasce nos nós de entrada, leitura com a probabilidade `global.readRatio` do snapshot, e em cada nó falha com a fração de erro/drop dele (um anel vermelho marca onde, e uma resposta de erro volta a quem chamou) ou abre um **frame**. Um load balancer a manda por uma única aresta, sorteada pela carga; uma fila responde na hora; os outros nós seguem o plano de chamadas passo a passo (as chamadas de um passo saem juntas), e cada chamada é feita ou não para ESTE request: leituras/escritas pela classe dele, `fraction` por sorteio, read-through e "após miss" pelo `hitRatio` do cache (a falha de um cache absorvido conta como miss). As síncronas são esperadas; as async saem no seu passo e nunca respondem. Depois do último passo, uma bola de resposta volta pela mesma aresta até o frame de quem chamou; na entrada o request termina (`lib/flowBalls.ts`, puro e testado)
- Requisição e chamada async são bolas cheias; resposta é um anel vazado (na cor de erro quando falhou). A legenda mostra "request ● / response ○" e o quantum; requisições e respostas dividem o teto de bolas
- Teto global de 2.000 bolas; com a tela cheia (fan-outs multiplicam bolas) o quantum sobe um degrau
- O badge ×N de um nó com mais de uma instância o abre em um card por instância (até 4, mais um card empilhado "+N instances" com o resto), uma configuração de visualização que não vai para o undo nem para o design salvo: os cards e as cópias das arestas existem só no que o ReactFlow desenha, e cada aresta do nó vira uma por card, então a divisão do load balancer aparece como linhas separadas. Cada card mostra a sua parte das métricas do nó (o motor divide a carga por igual entre as instâncias vivas); arrastar um card move o grupo. A bola que vai para um nó aberto segue pela aresta de uma única instância, escolhida como o load balancer da frente escolheria (round robin em ciclo, least connections na menos ocupada, hash fixo por request; weighted reparte pela capacidade, igual dentro de um nó), pulando as instâncias que os faults derrubaram (kill node, kill instances, queda de AZ), e as chamadas seguintes saem desse card
- Cor por status da aresta; espessura da aresta proporcional à carga
- Arestas async tracejadas, sem bola de volta
- `prefers-reduced-motion`: sem partículas, só a espessura e a cor das arestas

### Cartão do recurso selecionado

Com uma execução ou análise disponível, selecionar um único recurso abre ao lado dele, no canvas, um cartão com os números do nó: vazão (servido de recebido), latência p50 com p95/p99, taxa de erro, disponibilidade (1 − erro), drops, utilização, fila e os extras do tipo (hit ratio, lag, pool, breaker), além dos gráficos de RPS in e p99 do hop. Ele acompanha pan, zoom e arrasto (num nó aberto em instâncias, ancora no primeiro card), fica acima da camada de bolas e fecha no ×, com Esc ou clicando no canvas. No celular não aparece: a bottom sheet mostra o mesmo.

### Dashboard (OBS-05)

- Carregado sob demanda (`uplot` em chunk separado)
- Séries: throughput, error rate, p50/p95/p99 global e por nó selecionado
- Marcadores de início e fim de faults ([Spec 08](08-chaos-engineering.md))
- "Fixar execução" guarda a série atual no IndexedDB ([Spec 05](05-persistencia-e-compartilhamento.md)) para comparar com a próxima

### Request trace (OBS-06): aba Flow

Entregue pela aba **Flow** do painel ([fluxo da requisição](../.specs/features/request-flow/spec.md), FLW-33 a 41), carregada sob demanda. Em vez de guardar requests de cada tick, a aba amostra um request quando pedido: `traceCanvas` roda no worker o `analyze()` na carga do último snapshot (1 req/s sem snapshot) e passa um request pelo mesmo sampler da latência com um `Recorder` (`engine/core/trace.ts`), então o caminho, o hit/miss e os tempos são os do modelo, sem um segundo modelo de request.

- Leitura ou escrita, e "Another request" para o próximo da sequência (mesmo design + seed + índice → mesmo trace)
- Diagrama de sequência: uma linha de vida por nó tocado, seta cheia por chamada, tracejada por resposta, aberta e sem volta por chamada async, numeradas na ordem em que começam; "hit"/"miss" na chamada ao cache; a chamada condicional que não aconteceu não aparece
- Com snapshot (ao vivo ou Analyze): ms de cada chamada e o total ponta a ponta. Sem snapshot: só a estrutura e "Run the simulation or Analyze to see the timings". Sem entrada: "No entry point: connect a Client or an entry node"
- Passar o mouse, focar ou tocar num passo destaca a aresta e o sentido no canvas (`flowHighlightStore`, sem escrever no `canvasStore`); funciona em aba somente leitura e na bottom sheet do celular
- Não recalcula a cada tick: só quando o design, a classe, o índice ou a carga (mais de 25%) mudam

### Alertas (OBS-07)

Regras simples avaliadas no `runtimeStore`: utilização > 90% por mais de 5 s, início de drops, burn rate acima do limite ([Spec 11](11-slo-e-error-budget.md)). Viram toast e marcador na timeline, com deduplicação.

## Critérios de aceite

- [x] p99 visível ao vivo no nó e no painel
- [x] 60 fps com 100 arestas e 2.000 partículas
- [x] Um tick não re-renderiza nós cujas métricas não mudaram
- [x] O `canvasStore` não é persistido durante o play
- [x] Com `prefers-reduced-motion`, nenhuma partícula é desenhada
- [ ] (Fase 5) Comparação entre duas execuções no dashboard
- [x] (OBS-06) A aba Flow mostra uma leitura do URL Shortener com cache, banco no miss, monitoramento async sem volta e, com Analyze, o tempo de cada passo e o total

## Testes

- Playwright: play por 5 s, badge do nó mostra RPS > 0
- Playwright (`flow.spec.ts`): aba Flow na referência, com e sem snapshot, sem entrada, destaque da aresta, somente leitura e celular; unit: `engine-trace.test.ts`, `sequence-layout.test.ts`, `flow-highlight.test.ts`
- Performance: trace do Chrome com 100 arestas em play, frame time ≤ 16,7 ms no p95
