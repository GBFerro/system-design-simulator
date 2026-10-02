# Spec 11: SLOs e error budget

Parte da [v2](00-visao-geral.md) · Fase 5 · Status: implementada (Fase 5, PR 2)

| Campo               | Valor                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Requisitos          | SLO-01 a SLO-03 (P1)                                                                                                                                                     |
| Depende de          | [Spec 07](07-metricas-e-observabilidade.md) (métricas globais), [Spec 08](08-chaos-engineering.md) (faults)                                                              |
| Consumida por       | 07 (alerta de burn rate), 09 (regras latency/availability e relatório)                                                                                                   |
| Arquivos principais | `slo/` (modelo puro), `store/sloStore.ts`, `components/panel/SloPanel`, `components/slo/`, `engine/core/slo.ts` (goodput), `scoring/rules/latency.ts`, `availability.ts` |

## Objetivo

Dar a cada problema metas mensuráveis (latência e disponibilidade), mostrar o consumo do error budget durante o chaos e usar os valores medidos no score.

## Requisitos

1. **SLO-01 (P1)** Cada problema declara SLOs (ex.: p99 < 100 ms, disponibilidade 99,9%), que o usuário pode editar.
2. **SLO-02 (P1)** Barra de error budget com burn rate durante o chaos e veredito final "SLO cumprido / violado".
3. **SLO-03 (P1)** A regra de scoring `latency`/`availability` passa a usar os valores medidos em vez de heurísticas.

## Design

### Declaração

```ts
interface Slo {
  latency: { percentile: 50 | 95 | 99; thresholdMs: number; scope?: string };
  availability: number; // ex.: 0.999
  windowSec: number; // janela do budget, default 300 (5 min simulados)
}
```

- O SLO sai de `requirements` do problema (`problemSlo`): `latencyMs` é o limite, a p99 a menos que `latencyPercentile` diga outro (video-streaming, airbnb e location-service declaram p95, como o enunciado), `slaScope` quando o alvo é o hop de um componente (rate limiter, cache distribuído, fila), e `availability`
- Disponibilidade: a do enunciado quando ele diz (url-shortener, netflix e digital-wallet 99,99%; payment-system 99,999%), 99,99% para infraestrutura compartilhada que fica no caminho de tudo (rate limiter, cache distribuído, message queue), 99% para o web crawler (batch, ninguém espera o request) e 99,9% no resto. Problemas customizados ficam com 99,9%
- `data.test.ts` exige que todo problema declare `availability` e que a referência cumpra o próprio SLO no pico (erros ≤ budget de disponibilidade, requests lentos ≤ budget de latência)
- O usuário sobrescreve percentil, limite, disponibilidade e janela na aba SLO. O override é por problema (`sloStore`, persistido), vai no design salvo e no envelope (`slo`, sanitizado na importação) e volta ao carregar o design. No modo entrevista vale sempre o SLO do problema, e o scoring também usa sempre o do problema

### Goodput no motor

O goodput da [Spec 07](07-metricas-e-observabilidade.md) passa a ser o que o nome diz: requests com sucesso dentro do limite de latência. O motor recebe o limite (`SimConfig.latencySlo`, ao vivo por `FlowEngine.setLatencySlo`, que o `SimController` acompanha a partir do SLO em vigor) e:

- ponta a ponta: o sampler conta, depois de amostrar, a fração dos sucessos acima do limite. Não consome número aleatório, então o resto do snapshot fica bit a bit igual
- com escopo: P(hop > limite) nos nós daquele tipo, ponderada pela carga (a mesma cauda de sojourn que os timeouts usam)

### Error budget e burn rate

Um SLO tem dois indicadores, cada um com o seu budget, em vez de um só:

- **Disponibilidade:** request que falhou é ruim; budget = 1 − availability
- **Latência:** sucesso mais lento que o limite é ruim; budget = 1 − percentil/100 (um alvo p99 permite 1% de requests mais lentos)

Contar os lentos contra o budget de disponibilidade, como a primeira versão desta spec dizia, faria um design com p99 exatamente no limite queimar 10× para sempre num SLO de 99,9%: 1% de requests lentos é o que o próprio alvo p99 permite.

- Burn rate = fração ruim nos últimos 30 s simulados ÷ fração do budget. Burn rate 1 gasta o budget exatamente no fim da janela; o exibido é o maior dos dois
- Budget consumido = ruins na janela móvel ÷ budget de uma janela inteira na taxa observada. Uma execução curta já conta contra os 5 minutos: 10 s a 10× gastam um terço do budget
- Violado no primeiro momento em que um dos budgets acaba; o veredito guarda esse momento e qual indicador quebrou. Depois que o trecho ruim sai da janela o budget volta, mas a execução continua "violada"
- Alerta de queima rápida a partir de 10× (ícone de chama no painel e no chip; os toasts e a dedup ficam para a OBS-07)

### UI

- Aba **SLO** no painel direito: metas (editáveis fora da entrevista, com "voltar ao SLO do problema"), budget restante da janela com a parcela de cada indicador, burn rate atual, gráfico de burn rate em escala log com as linhas de 1× e 10× e os faults como faixas, e o veredito ("SLO met so far" / "SLO violated at mm:ss")
- Chip compacto na TopBar enquanto há uma execução, que abre a aba SLO. Só a partir de 1920 px: junto com o chip de custo, a 1680 px ele deixava o seletor de problema com 68 px no runner Linux do CI
- Relatório da entrevista: bloco SLO com o veredito da execução ao vivo (drill incluído) contra o SLO do problema, o momento da quebra, o budget usado e o pior burn rate

### Scoring (SLO-03)

A rubrica medida da [Spec 09](09-modo-entrevista-v2.md) já usava valores medidos; esta spec liga as duas regras ao SLO do problema:

- Latency: o percentil do SLO medido no pico ≤ o limite (12), p50 ≤ metade do limite (4), caminho síncrono sem hops desnecessários (4)
- Availability: sem SPOF alcançável (6), cada fault do drill cabe no budget de disponibilidade de uma janela (10), degradação graciosa (4). Um fault com taxa de erro e e duração d cabe se e × d ≤ (1 − availability) × janela, a mesma conta do budget ao vivo; antes era um 1% fixo para todo problema
- O drill da entrevista usa o percentil e o limite do SLO (no nó do escopo, quando há) para dizer se o SLO está quebrado a cada momento; o limite de erro instantâneo continua 1%

## Critérios de aceite

- [x] Os 35 problemas têm SLO coerente com o enunciado
- [x] Budget e burn rate reagem a um fault e param de cair depois do heal
- [x] SLO violado aparece no relatório da entrevista
- [x] Regras `latency` e `availability` somam exatamente 20 e nunca ficam negativas

## Testes

- Vitest (`slo.test.ts`): burn rate com fração de erro conhecida (1% de erro com SLO 99,9% → burn rate 10), burn de latência, veredito para execuções sintéticas acima e abaixo do SLO (com o momento da quebra), budget parado depois do heal e recuperado quando o fault sai da janela, overrides sanitizados no envelope, goodput no `analyze()` e no tick sem mudar o resto do snapshot
- Vitest (`data.test.ts`): todo problema declara o SLO e a referência o cumpre no pico
- Vitest (`scoring.test.ts`): fault contra o budget da janela, latência no percentil do SLO
- Playwright (`slo.spec.ts`): editar o SLO, budget e burn rate reagindo a snapshots sintéticos, veredito
