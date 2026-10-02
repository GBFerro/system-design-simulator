# Spec 09: Modo entrevista v2

Parte da [v2](00-visao-geral.md) · Fase 4 · Tamanho M · Status: implementada (Fase 4; as regras de cost, latency e availability ganharam orçamento e SLO com as Specs 10 e 11 na Fase 5)

| Campo               | Valor                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Escopo              | Fases com resposta checável, failure drill, rubrica medida, score de processo, relatório final                          |
| Depende de          | [Spec 04](04-motor-de-simulacao.md) (`analyze()`, tick), [Spec 08](08-chaos-engineering.md) (faults e game days)        |
| Relacionada         | [Spec 10](10-custo.md) e [Spec 11](11-slo-e-error-budget.md) completam as regras de cost/latency/availability na Fase 5 |
| Arquivos principais | `components/interview/`, `store/interviewStore.ts`, `data/interviewData.ts`, `scoring/`                                 |

## Objetivo

Manter as 6 fases atuais (42 min), mas fazer cada fase capturar uma resposta que o sistema consegue checar. O Deep Dive vira um failure drill com chaos real, em que o "entrevistador" quebra o sistema e o candidato precisa mitigar sem perder o tempo. Os dados necessários já existem em `interviewData.ts`: requisitos, estimativas, APIs e data model de referência, e follow-ups com categoria `failure`.

O timer continua baseado em timestamp (`startedAt`/`accumulatedMs`), como exige o `CLAUDE.md`.

## Fluxo

| Fase                         | Tempo alvo | O que o candidato faz                                                 | O que o sistema checa                                                        |
| ---------------------------- | ---------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1. Requirements              | 5 min      | Marca e escreve os requisitos funcionais e não funcionais             | Cobertura dos requisitos `critical` e `important` de referência              |
| 2. Estimation                | 5 min      | Preenche DAU, RPS de read/write, pico, storage e banda na calculadora | Cada número contra a referência, com tolerância de ±2×                       |
| 3. API Design                | 5 min      | Lista endpoints (método, path, request, response)                     | Endpoints essenciais presentes e verbos corretos                             |
| 4. Data Model                | 2 min      | Define entidades, tipo de store e partition key                       | Store adequado por entidade e partition key definida onde a referência exige |
| 5. High-Level Design         | 15 min     | Monta o grafo e roda a simulação na carga estimada                    | Aguenta o pico da fase 2 com ρ < 0,8, p99 dentro do SLA, sem SPOF            |
| 6. Deep Dive / Failure drill | 10 min     | Responde a 2–3 faults injetados e mitiga editando o grafo ao vivo     | Tempo até recuperar o SLO, error budget consumido e se a mitigação resolveu  |

**Checagem de texto livre (fases 1, 3 e 4):** o candidato marca itens de uma lista derivada da referência ou escreve texto livre. Na v2 o score conta só os itens marcados/estruturados; texto livre é guardado para o relatório, sem correção automática.

**Fase 5:** a carga usada é o pico que o candidato estimou na fase 2, limitado à faixa ±2× da referência para evitar que uma estimativa baixa demais facilite a fase.

**Implementação (PR 3 da Spec 09):**

- As fases 1–4 ganharam formulários (`PhaseForms`, carregado sob demanda): requisitos como checklist + notas, estimativas com `k`/`M`/`B`, endpoints (método + path) e entidades (nome, store, partition key). As respostas e o tempo gasto em cada fase persistem no `interviewStore` e sobrevivem a refresh.
- A correção é pura (`interview/checks.ts`):
  - requisitos: cobertura dos `critical` + `important`;
  - estimativas: cada número dentro de 2× da referência (o DAU vem do texto de usuários do problema);
  - APIs: paths normalizados (sem `/api/vN`, parâmetros viram `*`, sem query string), e cada endpoint do candidato explica no máximo um endpoint de referência como verbo errado;
  - data model: entidade achada pelo nome (singular/plural, caixa e separadores ignorados), store igual ao da referência e partition key preenchida onde a referência tem uma.
- A carga das fases 5 e 6 é `effectivePeak`: reads + writes estimados, limitados a [½, 2×] do pico de referência (sem estimativa, o pico de referência). O Score dentro da entrevista usa a mesma carga.

## Failure drill

1. Ao entrar na fase 6, o sistema escolhe 2–3 faults do roteiro do problema, mapeados a partir dos follow-ups `failure` (ex.: URL Shortener: "cache cai no pico" → `hitRateOverride: 0` por 60 s).
2. A simulação roda no pico estimado, o fault é injetado sem aviso e o painel mostra a pergunta do follow-up.
3. O candidato pode editar o grafo com a simulação rodando (adicionar réplica, circuit breaker, fila) e escrever a resposta em texto.
4. Ao fim de cada fault, aparecem a resposta de referência (`answer`) e o gráfico do incidente: quando o SLO quebrou, quando o candidato agiu e quando recuperou.

**Roteiros:** cada um dos 35 problemas ganha em `interviewData.ts` um `drill: { followUpId?, fault, window }[]`. Problemas sem follow-up `failure` suficiente recebem faults genéricos pela arquitetura de referência (ex.: kill do tier com mais tráfego).

**Implementação (PR 1 da Spec 09):**

- O alvo do fault é um **tipo de componente**, não um `FaultSpec` com id de nó, porque os ids mudam a cada design (`DrillTarget`: tipos de nó, link entre tipos, tier mais ocupado ou global). `resolveDrillStep` escolhe o nó ou link mais carregado do tipo no design do candidato.
- Se o design não tem o alvo, o drill mata uma instância do tier mais ocupado e avisa.
- Passos sem `followUpId` usam a pergunta e a resposta genéricas do tipo de fault (`GENERIC_DRILL_QA`).
- A carga do drill é o pico estimado na fase 2 (`effectivePeak`, PR 3). O SLO quebrado a cada momento é a latência do SLO do problema ([Spec 11](11-slo-e-error-budget.md): seu percentil e limite, no nó do escopo quando há) acima do limite, ou erros acima de 1%.

**Edição ao vivo:** mudanças no grafo durante o play recompilam o `SimGraph` e recarregam o motor mantendo o tempo, as filas dos nós que continuam existindo e os faults ativos.

## Rubrica de score

O total continua 100 (5 × 20), para não quebrar o histórico nem a invariante "cada regra soma exatamente 20". A diferença é que as regras passam a usar métricas medidas em vez de presença de componentes.

| Dimensão     | Pontos | Como é medido na v2                                                                                                          |
| ------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Scalability  | 20     | Aguenta 1× e 2× o pico (8 + 8) e escala horizontalmente nos tiers stateless (4)                                              |
| Availability | 20     | Sem SPOF alcançável (6), disponibilidade medida no drill ≥ SLO (10), degradação graciosa com circuit breaker ou fallback (4) |
| Latency      | 20     | Percentil do SLO medido no pico ≤ limite (12), p50 (4), caminho síncrono sem hops desnecessários (4)                         |
| Cost         | 20     | $/mês ≤ orçamento do problema (12), sem over-provisioning com utilização < 15% (8)                                           |
| Trade-offs   | 20     | Decisões-chave do problema registradas no trade-off log com justificativa (mantido)                                          |

- As regras continuam recebendo o `ScoringGraph` compartilhado, agora junto com o `SteadyState` do `analyze()` e, quando houver, o resultado do drill
- Presença continua exigindo alcançabilidade a partir do entry point
- **Fora do modo entrevista** (sem drill), o item "disponibilidade medida no drill" usa `analyze()` com os faults do roteiro aplicados em steady state
- Cost usa o orçamento do problema ([Spec 10](10-custo.md)); latency e availability usam o SLO do problema ([Spec 11](11-slo-e-error-budget.md)): latência no percentil e limite do SLO, e cada fault do roteiro precisa caber no error budget de disponibilidade de uma janela

**Implementação (PR 2 da Spec 09):**

- **Medições:** `scoring/measure.ts` roda `analyze()` a 1× e 2× o pico, com o read ratio do problema, e sob cada fault do roteiro em regime (`faults/steady.ts`, lido no fim da janela do fault, depois dos transitórios). As regras recebem essas `Measurements`.
- **Rubrica:**
  - "Aguenta" o pico: erros ≤ 1% e todo tier com ρ < 0,8. No 2×: erros ≤ 1% e ρ < 1.
  - "Sem SPOF": a mesma checagem do Advisor (`scoring/paths.ts`).
  - Cost: as checagens estruturais atuais valem os 12 pontos de orçamento até a [Spec 10](10-custo.md). Over-provisioning (8) = um tier com ≥ 3 instâncias que, com uma a menos, ainda ficaria abaixo de 15% de utilização.
- **Latência viável:**
  - O DNS passou a pesar só na fração de requests sem cache (`lookupShare`, padrão 1%), porque a resolução fica em cache no cliente e no SO.
  - Problemas cujo SLA é de um componente (rate limiter, cache distribuído, fila) ganharam `slaScope`.
- **Referências dimensionadas:** as 35 ganharam `params` por nó e ajustes de aresta, e `MAX_INSTANCES` subiu para 1000.

### Score de processo

Separado, não entra nos 100: aderência ao tempo de cada fase, precisão da estimativa, cobertura de requisitos e tempo de reação no drill. É o que diferencia "chegou na resposta" de "conduziu bem a entrevista".

**Implementação (PR 3):** média, de 0 a 100, dos itens que se aplicam:

- **Tempo:** por fase, nota cheia até o tempo alvo, caindo linearmente até 0 no dobro.
- **Estimativas:** fração dentro de 2×.
- **Requisitos:** cobertura dos `critical` + `important`.
- **Reação no drill:** nota cheia agindo em até 30 s, zero a partir de 120 s ou sem agir.

Sem drill, o item de reação não conta.

## Relatório final

- Score por dimensão com cada ponto perdido explicado e com link para o nó ou métrica responsável
- Linha do tempo da sessão (fases, faults, ações do candidato) e comparação lado a lado com a solução de referência
- Histórico de tentativas por problema, em IndexedDB ([Spec 05](05-persistencia-e-compartilhamento.md)), para acompanhar a evolução
- **P2:** narração por voz (Web Speech API), transcrita e checada contra os pontos-chave do follow-up

**Implementação (PR 3):**

- **Finish** na barra da entrevista mede e pontua o design (rubrica medida, na carga estimada), corrige as respostas, junta o resultado do drill e abre o relatório (`ReportDialog`, carregado sob demanda).
- **O relatório mostra:**
  - o score de design por dimensão, com o motivo de cada ponto perdido (o feedback das regras);
  - o score de processo item a item;
  - o tempo por fase contra o alvo;
  - as respostas contra a referência;
  - cada fault do drill (SLO mantido ou não, tempo de reação, error budget);
  - as tentativas anteriores.
- **Histórico:** as últimas 20 tentativas por problema, em IndexedDB via `createDurableKV`. **Compare with the reference** abre a solução de referência numa aba só de leitura.
- **Fica para depois:**
  - o link de cada ponto perdido para o nó ou a métrica;
  - a linha do tempo completa da sessão (o relatório tem tempo por fase e o resultado de cada fault);
  - a comparação lado a lado no mesmo canvas;
  - a narração por voz (P2).

## Critérios de aceite

- [x] Os 35 problemas têm roteiro de drill
- [x] Cada regra soma exatamente 20 e nunca fica negativa
- [x] A solução de referência de cada problema, simulada no pico de referência, tira pelo menos 16/20 em scalability e latency (sanidade das regras medidas)
- [x] Um grafo vazio tira 0 em scalability, availability e latency
- [x] O timer sobrevive a refresh e a aba em background
- [x] O relatório mostra cada ponto perdido com o motivo

## Testes

- Vitest: soma máxima de cada regra = 20; mínimo = 0 (grafos vazio, desconectado, referência, referência sem cache)
- Vitest: cada problema em `interviewData.ts` tem `drill` com 2–3 faults válidos no catálogo
- Playwright: fluxo completo de entrevista num problema curto, com o tempo acelerado
