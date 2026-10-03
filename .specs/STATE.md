# State

## Decisions

### AD-001
- **Decision**: Uma aresta é um link (latência, perda de pacote) com uma lista de chamadas de quem chama (condição, passo, chamadas por requisição) em `edge.data.rule.calls`; condições que dependem de outra chamada (ex.: "leituras após miss") moram na chamada de quem chama e apontam para o nó do cache por `missOf`.
- **Reason**: É o modelo real (cache-aside: o serviço decide ir ao banco) e mantém faults, métricas, blast radius e ids de aresta por link, sem duplicar linhas no canvas.
- **Trade-off**: Todo leitor de `rule.kind` passa a iterar chamadas; a carga de uma aresta é agregada e a quebra por chamada só aparece no trace.
- **Scope**: `domain/graph`, `engine/`, `advisor/`, `components/canvas`, `components/panel`, persistência (schema v3), referências em `data/problems.ts`.
- **Date**: 2026-10-03
- **Status**: active

### AD-002
- **Decision**: A ordem e as dependências das chamadas de um nó são resolvidas só em `domain/graph/callPlan.ts`; o motor (analyze, tick, sampler), as bolinhas, o trace e os badges leem esse plano e nunca reinterpretam passos.
- **Reason**: Se cada camada derivasse a ordem por conta própria, a animação, o trace e a latência medida divergiriam.
- **Trade-off**: Um módulo a mais no caminho do bundle inicial (pequeno, puro).
- **Scope**: Qualquer código que precise saber em que ordem um nó chama os outros.
- **Date**: 2026-10-03
- **Status**: active

## Handoff

