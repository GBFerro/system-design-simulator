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

### AD-003

- **Decision**: A volta de uma chamada é uma aresta própria (`id: ret:<ida>`, `data.responseTo`, alças `ret-out`/`ret-in`); uma ida é síncrona se e só se tem volta, e o flag `edge.data.async` não existe no formato salvo (schema v4). Só `compileGraph` e `domain/graph/returns.ts` leem a volta; motor, scoring e advisor veem só idas.
- **Reason**: Uma fonte de verdade para sync/async e duas linhas legíveis no canvas, sem mexer no motor.
- **Trade-off**: Todo leitor de arestas filtra voltas; fixtures de teste precisam de `compileV3`.
- **Scope**: `domain/graph`, `domain/persistence`, `store/canvasStore`, `components/canvas`, `advisor/`, `scoring/`, `lib/loadReference.ts`, `lib/flowBalls.ts`.
- **Date**: 2026-10-09
- **Status**: active

### AD-004

- **Decision**: O passo do modo livre (`appStore.step`) ou a fase da entrevista decide que ferramentas aparecem (`lib/steps.ts`); trocar de passo nunca edita o grafo, não cria entrada de undo e não para, pausa nem zera a execução ao vivo.
- **Reason**: Faults e Failures dependem da execução iniciada em Simulate; a UI por passo é só visibilidade.
- **Trade-off**: Ações fora do passo (Props, atalhos, quick fixes) continuam disponíveis; não há pré-requisitos por passo.
- **Scope**: `components/layout`, `components/panel`, `components/sidebar`, `components/interview`, `store/appStore.ts`, `store/interviewStore.ts`.
- **Date**: 2026-10-09
- **Status**: active

## Handoff

