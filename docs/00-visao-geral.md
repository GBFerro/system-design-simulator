# Spec 00: Visão geral do System Design Simulator v2

Sep 25, 2026 · @Giovani · Status: rascunho

Este documento é o índice da v2. A spec original foi dividida em specs menores (01 a 14), cada uma com escopo, requisitos, design e critérios de aceite próprios. Os ids de requisito (CAN-01, TRF-02, etc.) são os mesmos da spec original e valem em todas as specs.

## Contexto e objetivo

O objetivo é transformar o SystemForge de um calculador de snapshot num simulador vivo. A base de entrevista que ele já tem fica, e por cima entram a simulação animada com chaos do Paperdraw, o motor discrete-event do SysSimulator e o advisor/custo/SLO do ArchSim.

**O que o repo já faz bem e deve ser preservado:**

- Modo entrevista cronometrado em 6 fases, 35 problemas com requisitos, restrições, hints e soluções de referência
- Scoring em 5 dimensões (scalability, availability, latency, cost, tradeoffs), 20 pontos cada
- Concept Library por componente, 21 trade-off cards, learning path com pré-requisitos
- Undo/redo, tabs de canvas, pen/eraser, export PNG/JSON, command palette (⌘K)
- 100% client-side, estado em `localStorage`

**O que falta para chegar no nível dos outros três:**

- A simulação é um cálculo único (sem eixo de tempo), sem animação de requests e sem chaos
- Cache não reduz a carga no banco: todo nó que não é LB repassa 100% do tráfego para cada filho
- Sem p50/p95/p99, error rate, queue depth, retries/timeouts, custo em $ ou SLO
- Bugs no editor: delete e drag and drop (ver [Spec 02](02-editor-confiavel.md))

**Fora de escopo da v2:** backend, contas de usuário, colaboração em tempo real e IA gerando diagramas.

## Prioridades

- **P0** entra no MVP da v2
- **P1** vem logo depois
- **P2** é desejável

## Índice das specs

| # | Spec | Requisitos | Fase |
| --- | --- | --- | --- |
| 00 | [Visão geral](00-visao-geral.md) | — | — |
| 01 | [Arquitetura técnica e requisitos não funcionais](01-arquitetura-tecnica.md) | NFRs, dependências, testes e CI | 0–6 |
| 02 | [Editor confiável](02-editor-confiavel.md) | B1–B6, CAN-01 a CAN-06 | 0 |
| 03 | [Catálogo de componentes e regras de aresta](03-catalogo-de-componentes.md) | CMP-01 a CMP-04 | 1 (CMP-03/04 na 6) |
| 04 | [Motor de simulação](04-motor-de-simulacao.md) | `analyze()`, loop de tick, worker | 1 e 2 |
| 05 | [Persistência e compartilhamento](05-persistencia-e-compartilhamento.md) | PER-01 a PER-04 | 1 (PER-03 na 6) |
| 06 | [Controles de tráfego](06-controles-de-trafego.md) | TRF-01 a TRF-06 | 2 (TRF-04 a 06 na 6) |
| 07 | [Métricas e observabilidade](07-metricas-e-observabilidade.md) | OBS-01 a OBS-07 | 2 (OBS-05 a 07 na 5) |
| 08 | [Chaos engineering](08-chaos-engineering.md) | CHS-01 a CHS-06 | 3 (CHS-03/05/06 na 5) |
| 09 | [Modo entrevista v2](09-modo-entrevista-v2.md) | Failure drill, rubrica medida, relatório | 4 |
| 10 | [Custo](10-custo.md) | CST-01 a CST-05 | 5 |
| 11 | [SLOs e error budget](11-slo-e-error-budget.md) | SLO-01 a SLO-03 | 5 |
| 12 | [Advisor](12-advisor.md) | ADV-01 a ADV-03 | 3 (ADV-03) e 5 |
| 13 | [Editor avançado](13-editor-avancado.md) | CAN-07 a CAN-11 | 6 |
| 14 | [Estudo](14-estudo.md) | LRN-01 a LRN-04 | 6 |

## Diagnóstico do estado atual

**Stack atual:** Next.js 16 (App Router, rota única `/`) · React 19 · TypeScript · `@xyflow/react` v12 · Zustand v5 com persist · Tailwind v4 · base-ui · framer-motion. São cerca de 20 mil linhas, das quais ~7,7 mil são dados (`problems.ts`, `interviewData.ts`, `conceptLibrary.ts`). Não há testes automatizados.

**Mapa do código que importa para a v2:**

- `components/canvas/DesignCanvas.tsx`: host do ReactFlow, `onDrop`, empty state
- `components/sidebar/ComponentPalette.tsx`: drag HTML5 com `application/systemsim-component` + tap-to-add
- `components/layout/app-shell.tsx`: atalhos de teclado, incluindo o único caminho de delete
- `store/canvasStore.ts`: nodes/edges, tabs, undo/redo, `selectedNodeId`/`selectedEdgeId`
- `engine/simulator.ts`: `runSimulation(nodes, edges, rps)`, snapshot único via topological sort (Kahn)
- `scoring/`: 5 regras de 20 pontos sobre um `ScoringGraph`

Os bugs do editor estão detalhados na [Spec 02](02-editor-confiavel.md) e as limitações do motor na [Spec 04](04-motor-de-simulacao.md).

## Benchmark: o que pegar de cada um

Cada ferramenta é melhor em uma coisa. Do Paperdraw vem a experiência de simulação viva com chaos. Do SysSimulator vêm a fidelidade do motor e os blueprints ligados a guias de estudo. Do ArchSim vêm o advisor com quick fix, custo, SLO e catálogo de faults. O SystemForge já é o mais forte em modo entrevista e scoring.

| Capacidade | Paperdraw | SysSimulator | ArchSim | SystemForge hoje | Levar para a v2 | Spec |
| --- | --- | --- | --- | --- | --- | --- |
| Motor | Engine matemático: filas enchem, timeouts cascateiam | Discrete-event em Rust/WASM, até 100k RPS | Analítico M/M/1 com tail spread | Snapshot com topological sort | DES em Web Worker (SysSimulator) com modo analítico rápido (ArchSim) | 04 |
| Visual da simulação | Tokens fluindo nas arestas, stats flutuantes por nó | Métricas p50/p95/p99 no canvas | Barras de utilização por nó | Só cor por status | Tokens nas arestas + badges + sparkline no hover (Paperdraw) | 07 |
| Latência | P50/P90/P99 | p50/p95/p99 | p50/p95/p99 com spread dependente de carga | Média com multiplicador | p50/p95/p99 medidos na simulação | 04, 07 |
| Parâmetros por nó | CPU/threads, TTL e write strategy do cache, réplicas e pool do DB, consumers | Throughput, distribuição de latência, réplicas | Capacidade + 3 alavancas de custo | `maxQPS`, `latencyMs`, `replicas` | Schema de parâmetros por tipo | 03 |
| Chaos | Kill de réplica, spike, latência/perda de pacote, expiração de cache | 28 cenários | 28 faults em 4 categorias, auto-heal, blast radius | Nenhum | Catálogo do ArchSim + triggers ao vivo do Paperdraw | 08 |
| Custo | Não documentado | AWS ao vivo | Multi-cloud, moedas, right-size | Só pontos de score | $/mês ao vivo + right-size (ArchSim) | 10 |
| SLO / error budget | Não | Não | Sim | Não | SLO por problema + burn rate | 11 |
| Advisor | Hints de entry point/storage faltando | Não | Findings por severidade + quick fix que edita o grafo | Feedback do score | Quick fix sobre as regras de scoring existentes | 12 |
| Templates | Community designs com fork | 56–57 blueprints | 49 templates | 35 soluções de referência | Manter 35 + blueprints de padrões (CQRS, saga, outbox) | 14 |
| Entrevista | Aba de interviews | 29 guias com framework, estimativa e narração | 13 passos que se autoverificam + timer de 35 min | 6 fases cronometradas + score em 5 dimensões | Manter SystemForge + fase "failure drill" com chaos + narração | 09 |
| Estudo | — | Guias de conceitos por blueprint | Compare, Quiz, Numbers | Concept library, trade-off cards, learning path | Adicionar Quiz e Numbers (ArchSim) | 14 |
| Editor | Drag, conectar, short link | Multi-select, undo/redo, auto layout com zonas | Auto-layout, passos numerados ①②③ | Undo/redo, tabs, pen | Auto-layout + passos numerados + grupos/zonas | 02, 13 |
| Compartilhar | Short link + fork | Share link de 7 dias, JSON/PNG | JSON/PNG | JSON/PNG | Link via hash da URL (sem backend) | 05 |

No Paperdraw, o conteúdo exato da aba de interviews e os planos pagos não puderam ser verificados porque o site bloqueia acesso automatizado. Os itens da coluna Paperdraw vêm do post do autor e de reviews.

## Roadmap

São sete fases (0 a 6) em ordem de dependência, e cada uma termina com algo usável. O tamanho das fases está em escala relativa (P, M, G), sem prazo.

| Fase | Escopo (requisitos) | Specs | Tamanho | Critério de aceite |
| --- | --- | --- | --- | --- |
| 0. Editor confiável | B1–B6, CAN-01 a CAN-06, suíte Playwright | 02 | P | Os 6 testes E2E passam; apagar uma multi-seleção é desfeito com um único ⌘Z; drop no centro do canvas vazio funciona |
| 1. Fundação do motor | CMP-01/02, regras de aresta, `analyze()`, worker, PER-01/02, Vitest | 03, 04, 05 | G | As 35 soluções de referência carregam migradas; cache com hit 90% reduz a carga do DB para 10%; testes do motor passam |
| 2. Simulação viva | Loop de tick, TRF-01 a 03, OBS-01 a 04, partículas | 04, 06, 07 | G | Um spike ×5 enche a fila e se recupera quando termina; p99 visível ao vivo; 60 fps com 100 arestas |
| 3. Chaos | CHS-01, 02, 04, ADV-03 | 08, 12 | M | Cada fault do MVP muda as métricas e volta ao baseline depois do heal; blast radius aparece no canvas |
| 4. Entrevista v2 | Failure drill, rubrica medida, score de processo, relatório | 09 | M | Os 35 problemas têm roteiro de drill; cada regra soma exatamente 20 |
| 5. Custo, SLO e advisor | CST-01 a 05, SLO-01 a 03, ADV-01/02, CHS-03, 05, 06, OBS-05 a 07 | 07, 08, 10, 11, 12 | G | Right-size aplica e mostra a economia; SLO violado aparece no relatório; quick fix tem undo |
| 6. Polimento | CAN-07 a 11, LRN-02 a 04, PER-03, TRF-04 a 06, CMP-03/04 | 03, 05, 06, 13, 14 | M | Link compartilhado abre o mesmo design em outro browser |

Depois da Fase 6, e fora desta spec: backend para a galeria da comunidade (PER-04), contas e colaboração em tempo real.

### Grafo de dependências entre specs

```
02 Editor ──────────────────────────────────────────────► 13 Editor avançado
03 Catálogo ──► 04 Motor ──► 06 Tráfego ──► 07 Métricas ──► 08 Chaos ──► 09 Entrevista v2
      │            │                                          │
      └──► 05 Persistência                                    ├──► 11 SLO
                   │                                          └──► 12 Advisor
                   └──► 10 Custo (usa analyze() da 04 e preços da 03)
```

## Fontes

- [vijaygupta18/system-design-simulator](https://github.com/vijaygupta18/system-design-simulator): código analisado (`main` em 25/09/2026), incluindo `CLAUDE.md`, `DesignCanvas.tsx`, `canvasStore.ts`, `app-shell.tsx`, `simulator.ts` e `interviewStore.ts`
- [Paperdraw](https://paperdraw.dev/), [post do autor no DEV](https://dev.to/pratapvhatkar/i-built-a-system-design-simulator-drag-simulate-and-break-your-own-architectures-in-minutes-1jl0), [Show HN](https://news.ycombinator.com/item?id=47218878) e [review da VitableTech](https://vitabletech.in/blog/paperdraw-system-design-simulator.html)
- [SysSimulator](https://syssimulator.com/), [docs](https://syssimulator.com/docs), [about](https://syssimulator.com/about) e [Learning Hub](https://syssimulator.com/learn)
- [ArchSim System Design Studio](https://github.com/abhaybhuvagithub/ArchSim-System-Design-Studio): README com catálogo de faults, modelo de custo, advisor e templates
- [Loadrift](https://github.com/omwankar/loadrift): referência para o cenário de retry storm
