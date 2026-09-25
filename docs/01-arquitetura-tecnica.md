# Spec 01: Arquitetura técnica e requisitos não funcionais

Parte da [v2](00-visao-geral.md) · Transversal (Fases 0 a 6) · Status: infra de testes e CI implementada

| Campo         | Valor                                                                             |
| ------------- | --------------------------------------------------------------------------------- |
| Escopo        | Dependências novas, estrutura de pastas, decisões transversais, NFRs, testes e CI |
| Consumida por | Todas as outras specs                                                             |

## Objetivo

Definir as decisões técnicas que valem para todas as specs da v2. A stack atual fica, sem reescrita de framework. Entram sete dependências com função clara, e o motor vai para um Web Worker isolado da UI. A mudança estrutural mais importante é tirar as métricas de runtime de dentro de `node.data`.

## Dependências novas

Cada dependência entra na fase da spec que precisa dela, não antes (o `CLAUDE.md` pede "no new runtime deps without good reason").

| Pacote                   | Para quê                                                           | Spec | Fase |
| ------------------------ | ------------------------------------------------------------------ | ---- | ---- |
| `@dnd-kit/core`          | Drag da paleta com pointer events (mouse + touch), resolve B1 e B6 | 02   | 0    |
| `@playwright/test` (dev) | Smoke test (01) e E2E do editor (02)                               | 01   | 0    |
| `vitest` (dev)           | Testes do scoring (01) e do motor (04)                             | 01   | 0    |
| `comlink`                | API tipada entre a UI e o worker do motor                          | 04   | 1    |
| `idb-keyval`             | Designs salvos e histórico de execuções em IndexedDB               | 05   | 1    |
| `uplot`                  | Séries temporais leves (~45 KB) para o dashboard                   | 07   | 5    |
| `elkjs`                  | Auto-layout em camadas (CAN-07), carregado sob demanda             | 13   | 6    |
| `lz-string`              | Design comprimido no hash da URL (PER-03)                          | 05   | 6    |

## Estrutura de pastas

```
src/
  engine/
    core/        tick.ts, queueing.ts (Erlang C), routing.ts, sampler.ts, rng.ts
    faults/      catalog.ts, compile.ts  (fault -> modificadores)
    traffic/     patterns.ts            (constante, rampa, spike, onda)
    analyze.ts   steady state instantâneo (scoring, advisor, right-size)
    worker.ts    Comlink.expose(engine)
    legacy/      simulator.ts atual, até a migração terminar
  domain/
    components/  registry.ts + schemas/<tipo>.ts (ParamSpec[], defaults, preço)
    graph/       compile.ts: nodes/edges do ReactFlow -> SimGraph validado
  store/
    canvasStore.ts     (seleção via node.selected, deleteSelection)
    runtimeStore.ts    (novo, não persistido: ring buffer de TickSnapshot)
    chaosStore.ts      (novo: faults ativos e roteiro)
  components/
    canvas/      NodeToolbar, ContextMenu, FlowParticles (canvas 2D overlay)
    panel/       ChaosPanel, MetricsDashboard, CostPanel, SloPanel, AdvisorPanel
```

## Decisões transversais

- **Métricas fora de `node.data`.** Hoje `utilization`/`status` ficam dentro do nó, e cada simulação re-renderiza e re-persiste o grafo inteiro. Na v2, `runtimeStore` guarda as métricas por `nodeId` e cada nó assina só as suas com um selector. Some também o `stripRuntimeFields`. Detalhe na [Spec 07](07-metricas-e-observabilidade.md).
- **Seleção com uma fonte só.** `selectedNodeId` vira derivado (`nodes.filter(n => n.selected)`), e o painel mostra "N itens selecionados" quando houver mais de um. Detalhe na [Spec 02](02-editor-confiavel.md).
- **Params por schema.** `ComponentNodeData` ganha `params: Record<string, number | string | boolean>`, validado pelo `ParamSpec` do tipo. `maxQPS`/`latencyMs`/`replicas` viram params, com migração. Detalhe na [Spec 03](03-catalogo-de-componentes.md).
- **Persistência v2.** Stores em `version: 2` com `migrate` real; designs salvos e histórico de execuções em IndexedDB. Detalhe na [Spec 05](05-persistencia-e-compartilhamento.md).
- **Motor em worker.** Toda simulação roda fora da main thread via Comlink. Detalhe na [Spec 04](04-motor-de-simulacao.md).

## Requisitos não funcionais

| Área           | Meta                                                                                                                                                                                    | Spec que valida |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Motor          | Tick ≤ 5 ms com 50 nós e 80 arestas, a 20×, num laptop médio                                                                                                                            | 04              |
| Animação       | 60 fps com 100 arestas e 2.000 partículas; métricas na UI a 10 fps                                                                                                                      | 07              |
| Bundle         | Worker, ELK e dashboard carregados sob demanda; JS inicial não cresce mais de 15%                                                                                                       | Todas           |
| Determinismo   | A mesma seed e o mesmo grafo dão o mesmo resultado, bit a bit                                                                                                                           | 04              |
| Acessibilidade | Canvas operável por teclado (Tab entre nós, Shift+F10 para o menu); `prefers-reduced-motion` troca partículas por espessura de aresta; status também indicado por ícone, não só por cor | 02, 07          |
| Privacidade    | Sem backend e sem telemetria; tudo roda no browser                                                                                                                                      | Todas           |

Para medir a meta de bundle, `scripts/bundle-size.mjs` (`npm run bundle:check`) soma em gzip os scripts referenciados pelo `index.html` pré-renderizado de `/`, ou seja, tudo que carrega antes de qualquer `import()` dinâmico, e compara com `bundle-baseline.json`. Baseline de 25/09/2026: 10 arquivos, 479,7 KB gzip. O CI falha acima de +15%.

## Testes e CI

1. **Motor (Vitest):** valores conhecidos de M/M/1 e M/M/c; throughput ≤ carga oferecida; cache com hit h reduz o banco para (1 − h); amplificação de retry igual à fórmula; mesma seed → mesmo snapshot; cada fault muda a métrica e volta ao baseline depois do heal (a garantia que o ArchSim declara). Ver [Spec 04](04-motor-de-simulacao.md) e [Spec 08](08-chaos-engineering.md).
2. **Scoring (Vitest):** cada regra soma exatamente 20 e nunca fica negativa, como a invariante atual. Ver [Spec 09](09-modo-entrevista-v2.md).
3. **Editor (Playwright):** um teste por bug B1–B6, usando os mesmos cenários do diagnóstico: drop no centro vazio, drag e depois Delete, Shift+clique em 2 nós, menu de contexto e touch. Ver [Spec 02](02-editor-confiavel.md).
4. **CI (GitHub Actions, Node 22):** `lint`, `typecheck`, `vitest`, `build`, `bundle:check` e `playwright` em todo PR. O Node sobe de 20 para 22 porque o vitest 5 exige `^22.12` e o Node 20 saiu de suporte em abril de 2026.

**Estado atual:** `tests/unit/scoring.test.ts` cobre a invariante das regras: o orçamento declarado em cada regra soma 20, e o score bruto fica em [0, 20] para as 35 referências, grafos-limite e 200 grafos aleatórios com seed. `tests/e2e/smoke.spec.ts` abre o app e checa o canvas vazio sem erros no console. Os testes de editor B1–B6 ficam com a [Spec 02](02-editor-confiavel.md).

**Problema conhecido encontrado pelos testes:** a solução de referência do `web-crawler` é um ciclo puro (`message-queue ↔ app-server`) sem nó de in-degree 0. Nada fica alcançável, e ela tira 0 em Scalability, Latency e Trade-offs. Está isolada em `KNOWN_UNREACHABLE_REFERENCES` no teste até o dado ser corrigido.

## Critérios de aceite

- [ ] Cada dependência nova entra junto com a primeira spec que a usa, com a justificativa no PR
- [x] Baseline de bundle registrado antes da Fase 1 e checado a cada fase
- [x] CI roda lint, tsc, build, vitest e playwright em todo PR
