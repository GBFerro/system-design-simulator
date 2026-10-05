# Fluxo da requisição — Context

**Gathered:** 2026-10-03
**Spec:** `.specs/features/request-flow/spec.md`
**Status:** Ready for design

---

## Feature Boundary

Uma aresta A → B passa a ser lida como uma chamada que A faz a B, com ida e, se síncrona, volta. Quem chama decide o que chamar, em que condição (inclusive "depois de um miss no cache") e em que ordem. O canvas mostra a resposta voltando, e a aba Flow mostra uma requisição inteira como diagrama de sequência.

---

## Implementation Decisions

### Escopo

- Visual e modelo de chamadas na mesma spec: ida e volta no canvas, async distinto, ordem numerada e chamadas condicionais do lado de quem chama (look-aside), com passos em sequência ou em paralelo.
- Exige migrar as referências com `cache → banco`, o fix "add cache" do advisor e o padrão de conexão.

### Visualização

- Canvas: bola de requisição na ida, bola de resposta (outra forma e cor) na volta, chamadas async sem volta.
- Painel "Trace" (aba Flow): diagrama de sequência de uma requisição de leitura ou de escrita, com passos numerados, hit/miss e o tempo de cada passo.

---

### Cache look-aside

- App → Cache; se a chamada ao cache der miss ou falhar, App → Banco. Nada sai do cache para o banco.

### Limites

- 8 chamadas por aresta e passo de 1 a 20, como as constantes `MAX_EDGE_CALLS` e `MAX_CALL_STEP` em `domain/graph/edgeRules.ts`. Mudar o limite é trocar um número num lugar só (FLW-49).

## Agent's Discretion

Nenhuma: todas as premissas da spec foram confirmadas (2026-10-03; idioma da interface, estado do trace e limite de 25% em 2026-10-05).

## Deferred Ideas

- Estratégias de escrita no cache (write-through, write-back, invalidação).
- Rever o SPOF de cache look-aside no scorer e no advisor.
- Exportar o diagrama de sequência.
- (Lote A) `CLAUDE.md` ainda descreve a persistência em v2: `STORE_VERSION` (2), envelope `{ schemaVersion: 2 }`, "`importDesign` accepts schemaVersion 1 and 2" e a cadeia só `migrateV1toV2`. Desde a T5 são 3, 1–3 e `migrateGraph` (v1 → v2 → v3). Atualizar junto com a T21.
- (Lote A) `.specs/STATE.md` e `design.md` (já no commit de planejamento) não passam no `npm run format:check`, que o CI roda; basta um `npx oxfmt` neles.
- (Lote A) `sanitizeEdgeRule` com uma regra v2 achatada de condição inválida ou ausente usa só a 1ª chamada do fallback. Quando a T17 der ao padrão de conexão duas chamadas (`[writes, after_miss]`), decidir se esse caso deve herdar a lista inteira.
- (Lote A) Regra 5 do `callPlan` em modo implícito: se a aresta do banco vem antes da aresta do cache na ordem do grafo, a `after_miss` sobe para depois do cache com aviso e pode cair no mesmo passo da chamada implícita seguinte (paralelo não pedido). O fix "add cache" (T18) e o padrão de conexão (T17) devem criar a aresta do cache antes da do banco.
- (Lote D) `src/engine/config.ts` (novo: `resolveConfig` saiu de `analyze.ts` para o `snapshot.ts` não carregar o motor no Analyze) ainda não está no mapa do `CLAUDE.md`; entrar junto com a T31. O `scoring/measure.ts` chama `steadyStateToSnapshot(atPeak, 0, graph)` sem o `config` com o read mix do problema, então o `global.readRatio` desse snapshot (usado só para resolver o drill) é o da entrada, não o do problema; passar o `config` se algum leitor precisar.
- (Lote E) Na bottom sheet do celular, tocar num passo da aba Flow destaca a aresta, mas a sheet cobre ~70% do canvas e a aresta pode ficar escondida. Enquadrar a aresta acima da sheet (`paddingAboveSheet`) ao tocar num passo.
- (Lote E) O e2e `traffic.spec.ts` "responses come back as rings… pausing holds them still" (T24) falhou uma vez na suíte completa local contra `next dev` (0 respostas no quadro pausado) e passou isolado: sensível à carga. Tornar a pausa determinística no teste (esperar `data-balls-res` > 0 antes de pausar).
- ~~(Verifier, iteração 1) Passar os efeitos das faults ativas ao `traceCanvas`.~~ Decidido pelo usuário em 2026-10-05: o trace reflete as faults ativas (FLW-36, FLW-50; tarefas T47–T48).
- (Verifier, iteração 1) Asserir o estilo visual das setas da aba Flow (tracejado das respostas, ponta aberta das async) e do anel das bolinhas de resposta; exige um atributo de teste no `FlowParticles`/`SequenceDiagram`.
- (Verifier, rodada 4, não bloqueante) Decidir em que instante o trace lê uma fault que varia no tempo: hoje lê em regime, logo antes do fim da janela mais curta (`trace.ts`), então um Kill node atrás de um LB com health check padrão (60 s) mostra falha no trace durante toda a fault, enquanto o canvas mostra o tráfego desviado depois de 60 s. Opções: regime (atual), o instante atual da execução, ou o regime depois de todo transiente; depois, um teste que distinga a escolha de t = 0 (mutante Y13 sobrevive hoje).
- (Verifier, rodada 4, não bloqueante) O e2e de cura da fault na aba Flow (`flow.spec.ts`, mutante Y8) pega a regressão 5 em 6 vezes: o ruído de carga ao vivo às vezes cruza 1,25× na janela. Pausar a execução antes do Restore e asserir `data-traces` = antes + 1.
