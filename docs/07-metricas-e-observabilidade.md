# Spec 07: Métricas e observabilidade

Parte da [v2](00-visao-geral.md) · Fase 2 (OBS-01 a 04) e Fase 5 (OBS-05 a 07) · Status: OBS-01 a 04 implementados

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
4. **OBS-04 (P0)** Animação: tokens nas arestas com densidade proporcional ao RPS e cor por status (ok, lento, erro). As arestas engrossam conforme a carga.
5. **OBS-05 (P1)** Dashboard com séries temporais dos últimos 5 min simulados, com zoom e comparação entre duas execuções (antes/depois de uma mudança).
6. **OBS-06 (P1)** Request trace: amostrar um request e mostrar o caminho, com o tempo gasto em cada hop (tipo Jaeger).
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
  traces?: Trace[]; // OBS-06, amostrados
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
- Densidade de partículas proporcional a log(RPS), com teto global de 2.000
- Cor por status da aresta; espessura da aresta proporcional à carga
- Arestas async com partículas tracejadas
- `prefers-reduced-motion`: sem partículas, só a espessura e a cor das arestas

### Dashboard (OBS-05)

- Carregado sob demanda (`uplot` em chunk separado)
- Séries: throughput, error rate, p50/p95/p99 global e por nó selecionado
- Marcadores de início e fim de faults ([Spec 08](08-chaos-engineering.md))
- "Fixar execução" guarda a série atual no IndexedDB ([Spec 05](05-persistencia-e-compartilhamento.md)) para comparar com a próxima

### Request trace (OBS-06)

Dos 1.000 requests sintéticos de cada tick, alguns ficam guardados com o caminho e o tempo por hop. O painel mostra um waterfall no estilo Jaeger, e clicar num hop seleciona o nó no canvas.

### Alertas (OBS-07)

Regras simples avaliadas no `runtimeStore`: utilização > 90% por mais de 5 s, início de drops, burn rate acima do limite ([Spec 11](11-slo-e-error-budget.md)). Viram toast e marcador na timeline, com deduplicação.

## Critérios de aceite

- [x] p99 visível ao vivo no nó e no painel
- [x] 60 fps com 100 arestas e 2.000 partículas
- [x] Um tick não re-renderiza nós cujas métricas não mudaram
- [x] O `canvasStore` não é persistido durante o play
- [x] Com `prefers-reduced-motion`, nenhuma partícula é desenhada
- [ ] (Fase 5) Comparação entre duas execuções no dashboard

## Testes

- Playwright: play por 5 s, badge do nó mostra RPS > 0
- Performance: trace do Chrome com 100 arestas em play, frame time ≤ 16,7 ms no p95
