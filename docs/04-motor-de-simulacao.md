# Spec 04: Motor de simulação

Parte da [v2](00-visao-geral.md) · Fase 1 (`analyze()`, worker) e Fase 2 (loop de tick) · Tamanho G · Status: Fase 1 implementada, Fase 2 pendente

| Campo               | Valor                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Escopo              | Modelo de filas, roteamento, loop de tick, `analyze()`, contrato do motor, worker, determinismo                                          |
| Depende de          | [Spec 03](03-catalogo-de-componentes.md) (params e regras de aresta)                                                                     |
| Consumida por       | 06 (tráfego), 07 (métricas), 08 (chaos), 09 (scoring medido), 10 (custo), 11 (SLO), 12 (advisor)                                         |
| Arquivos principais | novo `engine/core/`, `engine/analyze.ts`, `engine/worker.ts`, `domain/graph/compile.ts`; `engine/simulator.ts` vai para `engine/legacy/` |
| Dependências novas  | `comlink`, `vitest` (dev)                                                                                                                |

## Objetivo

Substituir o snapshot único por um motor de fluxo discretizado no tempo, rodando num Web Worker, com um modo analítico instantâneo que mantém o botão "Simulate" atual e alimenta scoring, advisor e right-size.

## Limitações do motor atual

- **Sem tempo:** `runSimulation` devolve um snapshot, então não há rampa, spike, recuperação nem animação
- **Fan-out errado:** um nó que não é LB envia 100% para cada filho. `App → Cache` e `App → DB` recebem 100% cada, e o cache não tem hit rate
- **Latência simplista:** multiplicador linear acima de 70% de utilização, sem filas, sem p99 e sem timeouts
- **Sem falhas:** não há error rate, retries, circuit breaker efetivo nem disponibilidade composta
- **Sem parâmetros:** o nó só tem `maxQPS`, `latencyMs` e `replicas`

## Decisão

Motor de fluxo discretizado no tempo, num Web Worker. A cada tick de 50 ms de tempo simulado, cada nó vira uma fila M/M/c, e 1.000 requests sintéticos são amostrados para medir percentis end-to-end. O custo é o mesmo a 100 ou a 1M RPS, porque os requests não são simulados um a um. Mesmo assim, o motor reproduz filas enchendo, timeouts, retry storms e recuperação.

**Por que não um DES puro?** O SysSimulator faz discrete-event request a request em Rust/WASM. Em TypeScript isso fica caro acima de ~50k RPS. O modelo de fluxo com distribuições de fila chega aos mesmos fenômenos com custo constante. Um "modo precisão" em DES para até 10k RPS fica como P2.

## Invariantes mantidas do `CLAUDE.md`

- Ignorar arestas cuja origem ou destino não é um nó de componente (text nodes, etc.)
- Entry point = in-degree 0 **com** aresta de saída; nó totalmente desconectado não recebe tráfego (quando existir um nó `client`, ele é o entry point)
- Sanitizar params numéricos (finitos, positivos) antes de usar
- Throughput reportado ≤ carga oferecida
- Arestas async carregam RPS, mas ficam fora da latência do usuário
- Tratamento de ciclos que já existe no Kahn continua

## Compilação do grafo

`domain/graph/compile.ts` transforma nodes/edges do ReactFlow num `SimGraph` validado: descarta nós que não são componentes, sanitiza params pelo `ParamSpec`, resolve regras de aresta, calcula a ordem topológica e os entry points. Erros de validação voltam para a UI como warnings, nunca como exceção.

## Loop de um tick (Fase 2)

1. Gerar as chegadas das fontes: λ(t) segundo o padrão de carga ([Spec 06](06-controles-de-trafego.md)), vezes os multiplicadores de chaos ([Spec 08](08-chaos-engineering.md)), mais os retries do tick anterior.
2. Propagar o fluxo em ordem topológica. Cada nó aplica sua regra de roteamento (abaixo).
3. Em cada nó: atualizar o backlog, calcular utilização, espera na fila, drops, timeouts e erros.
4. Amostrar 1.000 requests que percorrem o grafo pelas probabilidades de roteamento, somando o service time e a espera de cada hop. Daqui saem os p50/p95/p99 end-to-end e os traces ([Spec 07](07-metricas-e-observabilidade.md), OBS-06).
5. Emitir um `TickSnapshot` para a UI (throttle de 10 fps) e guardar num ring buffer de 6.000 ticks (5 min simulados).

## Roteamento por tipo de nó

| Nó              | Como o fluxo de entrada λ sai                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Load Balancer   | Divide entre alvos saudáveis: round robin → igual; weighted → por peso; least connections → proporcional à capacidade livre |
| Service / App   | Cada aresta pela regra: `always` → λ × `callsPerRequest`; `reads`/`writes` → λ × mix; `fraction` p → λ × p                  |
| Cache / CDN     | Arestas `on_miss` recebem λ × (1 − h)                                                                                       |
| Queue / Stream  | Desacopla: a saída é min(backlog, consumers × taxa) e o backlog vira lag                                                    |
| Rate Limiter    | A saída é min(λ, limite); o excedente vira 429 (erro) ou fila                                                               |
| Circuit Breaker | Fechado repassa tudo; aberto devolve erro rápido com latência ≈ 0; half-open deixa passar os probes                         |

## Fórmulas

Utilização de um nó com c instâncias × concorrência e service rate μ por slot:

```latex
\rho = \frac{\lambda}{c\,\mu}, \qquad a = \frac{\lambda}{\mu}
```

Probabilidade de esperar na fila (Erlang C), para ρ < 1:

```latex
C(c,a) = \frac{\frac{a^c}{c!}\,\frac{1}{1-\rho}}{\sum_{k=0}^{c-1}\frac{a^k}{k!} + \frac{a^c}{c!}\,\frac{1}{1-\rho}}
```

Percentil p da espera na fila, somado ao percentil do service time para dar a latência do hop:

```latex
W_q(p) = \max\!\left(0,\; \frac{\ln\!\big(C/(1-p)\big)}{c\mu - \lambda}\right), \qquad L_p \approx S_p + W_q(p)
```

Com ρ ≥ 1, o backlog cresce, a espera passa a ser backlog ÷ capacidade, e tudo acima de `maxQueue` vira drop:

```latex
Q_{t+\Delta t} = \max\!\big(0,\; Q_t + (\lambda - c\mu)\,\Delta t\big), \qquad W \approx \frac{Q}{c\mu}
```

Retries: se uma fração f falha ou dá timeout e o cliente tenta até R vezes, a carga efetiva é amplificada. É isso que cria o retry storm:

```latex
\lambda_{ef} = \lambda \,\frac{1 - f^{R+1}}{1 - f}
```

Cache após um flush (stampede): o hit rate volta ao steady state hₛₛ com constante τ, derivada de TTL e keyspace:

```latex
h(t) = h_{ss}\left(1 - e^{-t/\tau}\right)
```

Disponibilidade composta: tiers em série multiplicam; réplicas em paralelo usam o complemento:

```latex
A_{serie} = \prod_i A_i, \qquad A_{paralelo} = 1 - \prod_j (1 - A_j)
```

**Nota de implementação:** calcular Erlang C pela recursão de Erlang B (`B(0)=1`, `B(k) = a·B(k−1) / (k + a·B(k−1))`, `C = B / (1 − ρ(1 − B))`) para não estourar `a^c / c!` com c grande.

## Contrato do motor

```ts
interface Engine {
  load(graph: SimGraph, config: SimConfig): void; // valida e compila params + regras
  play(): void;
  pause(): void;
  reset(): void;
  setSpeed(x: 1 | 5 | 20): void;
  setTraffic(p: TrafficPattern): void; // muda ao vivo
  inject(fault: FaultSpec): FaultId;
  heal(id: FaultId): void;
  analyze(rps: number): SteadyState; // modo analítico instantâneo
  onTick(cb: (s: TickSnapshot) => void): Unsubscribe;
}
```

- `analyze()` resolve o steady state sem tempo e alimenta scoring, advisor, right-size e o botão "Simulate" atual (compatibilidade). É a entrega da Fase 1; `play`/`pause`/`onTick` entram na Fase 2.
- PRNG com seed (`mulberry32`): a mesma seed dá o mesmo resultado, o que é necessário para testes e para o score ser justo.
- O worker é exposto via Comlink. A UI nunca bloqueia.
- `inject`/`heal` fazem parte do contrato desde já, mas só são implementados na [Spec 08](08-chaos-engineering.md).

## Migração do motor atual

1. `engine/simulator.ts` vai para `engine/legacy/` sem mudanças.
2. `analyze()` passa a responder o botão "Simulate" e o scoring; o legacy fica só como comparação nos testes.
3. Quando os testes do motor novo passarem e as 35 soluções de referência simularem sem regressão grosseira, o legacy sai.

## Critérios de aceite

**Fase 1**

- [x] As 35 soluções de referência simulam pelo `analyze()` sem erro
- [x] Cache com hit 90% reduz a carga do DB para 10% da carga do cache
- [x] Throughput ≤ carga oferecida em todos os nós, para qualquer grafo
- [x] Nó desconectado não recebe tráfego
- [x] Testes do motor passam

**Fase 2**

- [ ] Um spike ×5 enche a fila e se recupera quando termina
- [ ] Tick ≤ 5 ms com 50 nós e 80 arestas, a 20×
- [ ] A mesma seed e o mesmo grafo dão o mesmo `TickSnapshot`, bit a bit

## Testes (Vitest)

- M/M/1: ρ = 0,5 → espera média = S (ρ/(1−ρ) × S); comparar com valores conhecidos
- M/M/c: Erlang C com c = 2, 5, 10 contra tabela de referência
- Throughput ≤ carga oferecida (property test com grafos aleatórios)
- Cache com hit h reduz o banco para (1 − h)
- Amplificação de retry igual à fórmula
- Mesma seed → mesmo snapshot
- Arestas para text nodes são ignoradas; nó sem arestas não é entry point
