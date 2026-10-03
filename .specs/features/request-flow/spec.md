# Fluxo da requisição: chamadas, respostas e ordem — Specification

Oct 3, 2026 · Status: confirmada · Escopo: Complex (modelo do motor + canvas + painel + dados)

## Problem Statement

Uma aresta A → B hoje dá a entender que o fluxo começa em A e termina em B. Na vida real, uma requisição entra em A, A chama B, B consulta o cache C e, se C não tem o dado, B vai ao banco D. A resposta volta por todo o caminho até A, e ao mesmo tempo B registra um log em E e publica numa fila F sem esperar resposta. O motor já trata parte disso (o sampler em `engine/core/sampler.ts` soma ida e volta de cada chamada síncrona e deixa as arestas async fora da latência), mas o canvas não mostra: a bola anda só para a frente e some na folha. O modelo também desenha o cache look-aside como `cache → DB (on_miss)`, quando quem vai ao banco depois do miss é o serviço, e não tem como dizer que duas chamadas saem em paralelo. Quem estuda para entrevista aprende o caminho errado justamente no padrão mais cobrado (cache-aside).

## Goals

- [ ] No canvas, uma requisição síncrona mostra a ida e a volta, e uma chamada async mostra só a ida, nas 35 referências.
- [ ] O cache look-aside é modelado como "B chama C; se C não tem, B chama D": o banco recebe a carga das leituras que deram miss, como no modelo atual, mas pela aresta B → D.
- [ ] Cada chamada que um nó faz tem uma posição (passo): passos diferentes rodam em sequência e chamadas do mesmo passo rodam em paralelo, e a latência reflete isso (soma entre passos, máximo dentro de um passo).
- [ ] O painel de trace mostra uma requisição de leitura ou de escrita como diagrama de sequência, com os passos numerados, hit/miss e o tempo de cada passo.
- [ ] Um design sem chamadas condicionais nem passos paralelos produz snapshots bit-idênticos aos de hoje (mesmo grafo + seed).

## Out of Scope

| Feature                                                                                     | Reason                                                                                                                             |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Estratégias de escrita no cache (write-through, write-back, invalidação explícita)          | É outro padrão, com outra carga; vira spec própria depois deste modelo.                                                            |
| Métricas por chamada dentro de uma aresta (quebra de req/s por condição no NodeInsightCard) | A aresta continua com uma métrica agregada; a quebra por chamada aparece só no trace.                                              |
| Tamanho de payload, banda e custo de transferência da resposta                              | O motor não modela bytes; a resposta conta só como tempo (o RTT que já existe).                                                    |
| Conexões de longa duração (WebSocket, streaming) como fluxo contínuo                        | Seguem como chamadas comuns; um modelo de sessão é outro trabalho.                                                                 |
| Rever o SPOF de cache look-aside no scorer e no advisor (`scoring/paths.ts`)                | Com fallback para o banco, um cache único deixa de derrubar a requisição; a mudança de rubrica vai para `docs/backlog-produto.md`. |
| Editar a ordem das chamadas arrastando no diagrama de trace                                 | O trace é só leitura; a ordem se edita no painel Props da aresta.                                                                  |
| Exportar o diagrama de sequência (PNG/SVG/Mermaid)                                          | Desejável, mas fora do MVP.                                                                                                        |
| Mix de leitura/escrita do problema na simulação ao vivo                                     | Já é o item P1 de `docs/backlog-produto.md`; esta spec usa o read ratio que o motor já resolve.                                    |

---

## Assumptions & Open Questions

| Assumption / decision               | Chosen default                                                                                                                                                                                                                                                                 | Rationale                                                                                                                                                                                                  | Confirmed? |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Escopo                              | Visual e modelo de chamadas juntos, na mesma spec                                                                                                                                                                                                                              | Decisão do usuário (ver `context.md`).                                                                                                                                                                     | y          |
| Forma de visualizar                 | Bolas de ida e volta no canvas e painel de trace com diagrama de sequência                                                                                                                                                                                                     | Decisão do usuário (ver `context.md`).                                                                                                                                                                     | y          |
| Onde mora a condição "se C não tem" | Na chamada de quem chama: App → Cache e, se a chamada ao cache der miss ou falhar, App → Banco ("leituras após miss na chamada App → Cache"); nada sai do cache para o banco                                                                                                   | É o look-aside real: o cache não conhece o banco; o App decide.                                                                                                                                            | y          |
| Read-through continua existindo     | A condição "miss do próprio nó" (`on_miss` de hoje) continua válida para chamadas que saem de um cache ou CDN e passa a se chamar "read-through" no editor                                                                                                                     | CDN → origem e caches read-through (ex.: DAX) existem de verdade; apagar quebraria designs salvos.                                                                                                         | y          |
| Migração de designs do usuário      | v2 → v3 converte só o formato da regra; nenhuma aresta é criada, removida ou movida, e um `cache → DB on_miss` vira read-through                                                                                                                                               | Migrar a topologia de um design salvo surpreende o usuário; a semântica de hoje fica preservada.                                                                                                           | y          |
| Referências e quick fixes           | Os 30 pares `cache → DB` das referências viram look-aside (serviço → cache `reads`, serviço → DB "escritas + leituras após miss"); o fix "add cache" do advisor e o padrão de conexão constroem o mesmo formato                                                                | O material de estudo precisa ensinar o padrão certo.                                                                                                                                                       | y          |
| Várias chamadas na mesma linha      | Uma aresta A → B carrega uma lista de chamadas (ex.: "escritas" e "leituras após miss"), cada uma com condição, passo e chamadas por requisição                                                                                                                                | O compilador deduplica arestas paralelas; duas linhas A → B seriam ilegíveis.                                                                                                                              | y          |
| Falha do cache no look-aside        | Erro, timeout ou nó fora na chamada ao cache conta como miss: a chamada condicional ao banco acontece e a requisição não falha por causa do cache                                                                                                                              | É o comportamento real do cache-aside e ensina o efeito manada no banco quando o cache cai.                                                                                                                | y          |
| Ordem padrão                        | Sem passo definido, as chamadas síncronas de um nó rodam em sequência, na ordem atual das arestas (passos 1, 2, 3…), e a chamada condicional fica depois da chamada de que depende                                                                                             | Mantém a latência de hoje bit-idêntica para designs existentes.                                                                                                                                            | y          |
| Chamadas async e passos             | A chamada async sai no seu passo, nunca soma latência e nunca tem volta                                                                                                                                                                                                        | É fire-and-forget; o passo só posiciona o disparo no trace e no canvas.                                                                                                                                    | y          |
| Velocidade das bolas                | As bolas andam à velocidade constante de hoje (`BALL_SPEED`); o tempo real de cada passo aparece só no trace                                                                                                                                                                   | Bolas proporcionais à latência ficariam paradas em hops de 1 ms e lentas demais em hops de 500 ms.                                                                                                         | y          |
| Tempos do trace                     | Sem simulação ou Analyze, o trace mostra só a estrutura (passos, hit/miss); com um snapshot, cada passo mostra o tempo amostrado com o mesmo modelo do sampler                                                                                                                 | Sem métricas não há fila nem utilização para calcular o tempo.                                                                                                                                             | y          |
| Onde fica o trace                   | Uma aba nova "Flow" no RightPanel, carregada sob demanda (lazy)                                                                                                                                                                                                                | Segue o padrão das abas; não pesa no bundle inicial (`bundle:check`).                                                                                                                                      | y          |
| Limites de edição                   | Até 8 chamadas por aresta, passo de 1 a 20, definidos como duas constantes exportadas de um único módulo (`MAX_EDGE_CALLS = 8`, `MAX_CALL_STEP = 20`, em `domain/graph/edgeRules.ts`) e lidos dali pelo editor, pela sanitização, pelos badges e pelos testes                  | Cobrem qualquer design de entrevista; mudar o limite é trocar um número num lugar só. O nome evita conflito com `MAX_CALLS_PER_EDGE` de `lib/flowBalls.ts`, que é outra coisa (cópias de bola por aresta). | y          |
| Idioma dos textos da interface      | Todo texto que a interface mostra é em inglês, como no resto do app: aba "Flow", botões "Read"/"Write"/"Another request", mensagens "Run the simulation or Analyze to see the timings" e "No entry point: connect a Client or an entry node", legenda "request ● / response ○" | A UI inteira do app é em inglês e a prosa das specs é em português; o Lote C já adotou o inglês nos rótulos do editor (SPEC_DEVIATION em `edgeRules.ts`).                                                  | n          |
| Prefixo dos requisitos              | `FLW`                                                                                                                                                                                                                                                                          | Segue o padrão de três letras das specs (CAN, TRF, OBS, CHS).                                                                                                                                              | y          |

**Open questions:** none - all resolved or logged above (required before the spec is confirmed).

---

## User Stories

### P1: Resposta visível no canvas ⭐ MVP

**User Story**: Como candidato, quero ver a resposta voltando pelo caminho até quem chamou, e ver que as chamadas async não voltam, para entender que uma linha A → B é uma chamada com ida e volta, e não um fluxo que termina em B.

**Why P1**: É a queixa central: hoje a bola some na folha e o canvas sugere um fluxo de mão única.

**Acceptance Criteria**:

1. WHEN uma bola de requisição chega ao alvo de uma chamada síncrona e o alvo concluiu todas as próprias chamadas síncronas daquela requisição THEN o canvas SHALL desenhar uma bola de resposta percorrendo a mesma aresta de volta, do alvo até quem chamou. <!-- FLW-01 -->
2. The canvas SHALL desenhar a bola de resposta com forma e cor diferentes da bola de requisição (anel vazado contra círculo cheio) e SHALL mostrar a diferença na legenda do canvas. <!-- FLW-02 -->
3. WHEN uma bola percorre uma chamada async THEN o canvas SHALL não desenhar bola de resposta para essa chamada, e quem chamou SHALL seguir sem esperar por ela. <!-- FLW-03 -->
4. The canvas SHALL desenhar a linha de uma aresta async tracejada e a de uma aresta síncrona contínua, também com `prefers-reduced-motion`. <!-- FLW-04 -->
5. WHEN a requisição falha num nó (erro, drop ou timeout de quem chamou) THEN o canvas SHALL marcar a falha com o burst atual e SHALL desenhar a bola de resposta de erro (cor de erro) voltando até quem chamou. <!-- FLW-05 -->
6. WHEN a bola de resposta chega ao nó de entrada THEN o canvas SHALL removê-la, encerrando a requisição. <!-- FLW-06 -->
7. The canvas SHALL contar bolas de resposta no limite global de `MAX_BALLS` (2.000) e no ajuste adaptativo do quantum. <!-- FLW-07 -->

**Independent Test**: Carregar a referência do URL Shortener, iniciar a simulação e seguir uma bola: ela vai do Client ao serviço, ao cache, e volta como anel até o Client; a aresta de monitoramento async aparece tracejada e sem volta. Teste unitário de `lib/flowBalls.ts` com snapshot sintético: uma chamada síncrona gera uma resposta na mesma aresta em sentido inverso; uma async não gera.

---

### P1: Chamada condicional de quem chama (cache look-aside) ⭐ MVP

**User Story**: Como candidato, quero dizer que o serviço B chama o banco D só quando a chamada dele ao cache C deu miss, para modelar o cache-aside como ele funciona.

**Why P1**: Sem isso o canvas continua ensinando que o cache chama o banco.

**Acceptance Criteria**:

1. The editor SHALL oferecer, numa chamada de B → D, a condição "leituras após miss em <chamada de B a um cache>", listando só as chamadas síncronas de B cujo alvo tem `hitRate`. <!-- FLW-08 -->
2. WHEN o motor (`analyze()` e o tick) roteia a carga de uma chamada "leituras após miss em B → C" THEN ele SHALL enviar a D λ_B × readRatio × (1 − hitRate_C) × callsPerRequest req/s. <!-- FLW-09 -->
3. WHEN o sampler amostra uma requisição de leitura que dá miss em C THEN ele SHALL fazer a chamada B → D depois da volta de B → C e SHALL somar à latência de B o RTT e o tempo de D. <!-- FLW-10 -->
4. WHEN o sampler amostra uma requisição de leitura que dá hit em C THEN ele SHALL não fazer a chamada B → D. <!-- FLW-11 -->
5. IF a chamada B → C falha (erro, drop, timeout ou C fora por fault) THEN o motor SHALL tratá-la como miss, fazer a chamada B → D e SHALL não falhar a requisição por causa de C. <!-- FLW-12 -->
6. WHILE uma fault derruba C, o motor SHALL enviar a D todas as leituras de B, λ_B × readRatio × callsPerRequest req/s. <!-- FLW-13 -->
7. The editor SHALL manter a condição "read-through" (miss do próprio nó) para chamadas que saem de um nó com `hitRate`, com o mesmo cálculo de carga do `on_miss` de hoje. <!-- FLW-14 -->
8. The canvas SHALL mostrar na aresta de uma chamada condicional um rótulo de tamanho fixo com o nome do nó de que ela depende (ex.: "miss: Redis"). <!-- FLW-15 -->
9. The motor SHALL manter as invariantes da Spec 04 com chamadas condicionais: served ≤ offered em todo nó, todo número finito, e mesmo grafo + seed → resultado deep-equal. <!-- FLW-16 -->

**Independent Test**: Teste de motor com Client → Service → Redis (`reads`, hitRate 0,9) e Service → DB ("escritas + leituras após miss em Service → Redis"): a 10.000 req/s e readRatio 0,9, o DB recebe 900 (leituras com miss) + 1.000 (escritas) = 1.900 req/s, igual ao modelo antigo `cache → DB on_miss` + `service → DB writes`; com uma fault que derruba o Redis, o DB recebe 10.000 req/s e o availability da requisição não cai por causa do Redis.

---

### P1: Referências, editor e dados no novo modelo ⭐ MVP

**User Story**: Como candidato, quero que as soluções de referência, o fix do advisor e o padrão de conexão usem o look-aside, e que meus designs salvos continuem abrindo, para estudar o padrão certo sem perder trabalho.

**Why P1**: Sem migrar os dados, o material continua ensinando o formato antigo.

**Acceptance Criteria**:

1. The modelo de aresta SHALL guardar uma lista de 1 a 8 chamadas, cada uma com condição (sempre, leituras, escritas, fração, leituras após miss em uma chamada, read-through), passo e chamadas por requisição; latência de rede e perda de pacote continuam por aresta. <!-- FLW-17 -->
2. WHEN um design v1 ou v2 é carregado (store persistido, design salvo ou JSON importado) THEN a migração para v3 SHALL converter cada `edge.data.rule` numa lista de uma chamada com a mesma condição, sem criar, remover ou mover arestas, e um `on_miss` vira read-through. <!-- FLW-18 -->
3. The migração v2 → v3 SHALL ser pura, idempotente e nunca lançar exceção, e `importDesign` SHALL aceitar `schemaVersion` 1, 2 e 3. <!-- FLW-19 -->
4. The export JSON SHALL gravar o envelope com `schemaVersion: 3` e a lista de chamadas de cada aresta, e um ciclo export → import SHALL devolver as mesmas chamadas. <!-- FLW-20 -->
5. The referências com par `cache → banco` SHALL usar look-aside: serviço → cache `reads`, serviço → banco com as chamadas "escritas" e "leituras após miss na chamada ao cache", sem a aresta cache → banco. <!-- FLW-21 -->
6. WHEN as referências migradas são medidas no próprio pico THEN cada uma SHALL manter score ≥ 16 em scalability e latency, manter o SLO e ficar dentro de [budget/1,5, budget/1,3] (recalibrar `budgetMonthlyUsd` onde sair). <!-- FLW-22 -->
7. WHEN o usuário aplica o fix "add cache" do advisor THEN o fix SHALL construir o formato look-aside de FLW-21 num único passo de undo. <!-- FLW-23 -->
8. WHEN o usuário conecta um serviço a um banco e o serviço já tem uma chamada síncrona a um cache THEN a nova aresta SHALL nascer com as chamadas "escritas" e "leituras após miss" nessa chamada ao cache. <!-- FLW-24 -->
9. WHEN o usuário edita as chamadas de uma aresta no painel Props THEN a edição SHALL passar por uma ação do `canvasStore` listada em `MUTATING_ACTIONS`, empurrar exatamente uma entrada de undo e não fazer nada numa aba somente leitura. <!-- FLW-25 -->

**Independent Test**: `persistence` com um design v2 salvo contendo `cache → DB on_miss`: depois da migração, a aresta existe, tem uma chamada read-through e a carga do DB no `analyze()` é idêntica à de antes. `data.test.ts` e `scoring.test.ts` passam com as referências migradas; `advisor.test.ts` aplica o fix "add cache" e encontra o formato look-aside.

---

### P2: Ordem e paralelismo das chamadas

**User Story**: Como candidato, quero dizer que B chama C e E em paralelo e só depois chama D, para que a latência e o trace reflitam a ordem real.

**Why P2**: Melhora a fidelidade da latência, mas o fluxo de ida e volta e o look-aside já resolvem a queixa principal.

**Acceptance Criteria**:

1. The editor SHALL deixar definir o passo (1 a 20) de cada chamada no painel Props da aresta. <!-- FLW-26 -->
2. WHEN o sampler amostra um nó com chamadas síncronas em passos diferentes THEN a latência do nó SHALL ser o próprio tempo mais a soma, passo a passo, da maior duração entre as chamadas daquele passo. <!-- FLW-27 -->
3. WHEN uma chamada síncrona do passo k falha THEN o sampler SHALL falhar a requisição sem fazer as chamadas dos passos seguintes, e chamadas do mesmo passo SHALL ser contadas mesmo assim (já saíram em paralelo). <!-- FLW-28 -->
4. IF uma chamada condicional está num passo ≤ o da chamada de que depende THEN o editor SHALL mostrar um aviso na aresta e o motor SHALL executá-la no passo seguinte ao da chamada de que depende. <!-- FLW-29 -->
5. The canvas SHALL mostrar na aresta um badge de tamanho fixo com o passo da chamada (ex.: "2"), e "2∥" quando outra chamada síncrona do mesmo nó estiver no mesmo passo. <!-- FLW-30 -->
6. WHEN uma bola chega a um nó com chamadas em passos THEN o canvas SHALL enviar juntas as bolas de um passo e SHALL só enviar o passo seguinte depois que todas as respostas do passo anterior voltaram. <!-- FLW-31 -->
7. WHERE nenhuma chamada do design tem passo definido pelo usuário nem condição "após miss", the motor SHALL produzir snapshots bit-idênticos aos da versão anterior (mesmo grafo + seed + padrão de tráfego). <!-- FLW-32 -->

**Independent Test**: Teste do sampler com B → C (passo 1, 10 ms fixos) e B → E (passo 1, 30 ms fixos) e B → D (passo 2, 20 ms fixos): a latência de B é próprio + 30 + 20 ms, e não 10 + 30 + 20. Teste de regressão: as 35 referências antes da mudança e o mesmo design sem passos dão snapshots deep-equal.

---

### P2: Trace de uma requisição

**User Story**: Como candidato, quero abrir uma requisição de leitura ou de escrita e ver o diagrama de sequência com cada chamada, resposta, hit/miss e tempo, para explicar o caminho completo numa entrevista.

**Why P2**: É a visão que responde "o que acontece quando o usuário clica", mas depende do modelo de P1.

**Acceptance Criteria**:

1. The RightPanel SHALL ter uma aba "Flow", carregada sob demanda, sem aumentar o JS inicial de `/` além do limite do `bundle:check`. <!-- FLW-33 -->
2. WHEN o usuário escolhe "Read" ou "Write" na aba Flow THEN ela SHALL mostrar um diagrama de sequência com uma linha de vida por nó tocado, uma seta cheia por chamada, uma seta tracejada por resposta síncrona e uma seta aberta sem volta por chamada async, numerados na ordem em que acontecem. <!-- FLW-34 -->
3. The diagrama SHALL marcar o resultado de cada chamada a um nó com `hitRate` como "hit" ou "miss", e a chamada condicional que não aconteceu SHALL não aparecer. <!-- FLW-35 -->
4. WHILE existe um snapshot (simulação ao vivo ou Analyze), a aba Flow SHALL mostrar o tempo de cada passo e o total ponta a ponta, amostrados com o mesmo modelo do sampler. <!-- FLW-36 -->
5. WHILE não existe snapshot, a aba Flow SHALL mostrar a estrutura sem tempos e o texto "Run the simulation or Analyze to see the timings". <!-- FLW-37 -->
6. WHEN o usuário clica em "Another request" THEN a aba Flow SHALL amostrar a próxima requisição da sequência, e o mesmo design + seed + índice SHALL dar o mesmo trace. <!-- FLW-38 -->
7. WHEN o usuário passa o mouse ou toca num passo do diagrama THEN o canvas SHALL destacar a aresta daquela chamada e o sentido (ida ou volta) sem escrever no `canvasStore`. <!-- FLW-39 -->
8. IF o design não tem nó de entrada (cliente, ou nó sem entrada com aresta de saída) THEN a aba Flow SHALL mostrar "No entry point: connect a Client or an entry node" em vez do diagrama. <!-- FLW-40 -->
9. The aba Flow SHALL funcionar em aba somente leitura (referências) e na bottom sheet do mobile. <!-- FLW-41 -->

**Independent Test**: Na referência do URL Shortener, aba Flow, leitura: Client → LB → Service → Redis (miss) → Service → NoSQL → … → Client, com a chamada async ao monitoramento sem volta; com o Analyze rodado, cada passo mostra ms e o total bate com a soma dos passos. E2E em `tests/e2e/` com snapshot sintético via `window.__runtimeStore`.

---

## Edge Cases

- IF a chamada de que uma condição "após miss" depende for removida (aresta apagada ou chamada excluída da lista) THEN o compilador SHALL emitir um aviso e a condição SHALL valer como "leituras" (sem cache, toda leitura dá miss). <!-- FLW-42 -->
- IF a chamada referenciada aponta para um nó sem `hitRate` THEN o compilador SHALL emitir um aviso e tratar a condição como "leituras". <!-- FLW-43 -->
- IF uma aresta tiver 0 chamadas depois de uma edição THEN o editor SHALL recusar a edição e manter a última chamada (uma aresta sempre tem ao menos uma). <!-- FLW-44 -->
- IF um JSON importado trouxer passo fora de 1–`MAX_CALL_STEP`, mais de `MAX_EDGE_CALLS` chamadas ou condição desconhecida THEN a sanitização SHALL levar o passo ao intervalo, manter as `MAX_EDGE_CALLS` primeiras chamadas, trocar a condição desconhecida por "sempre" e devolver um aviso em `warnings`. <!-- FLW-45 -->
- The limites de chamadas por aresta e de passo SHALL existir só como as constantes exportadas `MAX_EDGE_CALLS` e `MAX_CALL_STEP` em `domain/graph/edgeRules.ts`, e editor, sanitização, badges e testes SHALL importá-las em vez de repetir os números. <!-- FLW-49 -->
- WHEN uma chamada condicional entra num ciclo (aresta `back`) THEN o motor SHALL tratá-la como as arestas de ciclo de hoje: sem carga. <!-- FLW-46 -->
- WHEN o nó de entrada é expandido em cards de instância THEN a bola de resposta SHALL voltar ao mesmo card de onde a requisição saiu. <!-- FLW-47 -->
- WHILE a simulação está pausada, o canvas SHALL congelar bolas de requisição e de resposta no lugar (quadro parado), como hoje. <!-- FLW-48 -->

### Implicit-requirement dimensions

| Dimension                                | Coverage                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| Input validation & bounds                | FLW-17, FLW-26, FLW-44, FLW-45, FLW-49                                              |
| Failure / partial-failure states         | FLW-05, FLW-12, FLW-13, FLW-28, FLW-42, FLW-43                                      |
| Idempotency / retry / duplicate handling | FLW-19 (migração idempotente); retries por chamada seguem a Spec 04 sem mudança     |
| Auth boundaries & rate limits            | N/A because o app é 100% client-side, sem contas nem backend                        |
| Concurrency / ordering                   | FLW-10, FLW-27, FLW-28, FLW-29, FLW-31                                              |
| Data lifecycle / expiry                  | FLW-18, FLW-19, FLW-20 (versão do schema, migração, export/import)                  |
| Observability                            | FLW-34 a FLW-38 (trace); métricas por chamada ficam fora (Out of Scope)             |
| External-dependency failure              | N/A because não há serviço externo; a falha de dependência simulada é FLW-12/FLW-13 |
| State-transition integrity               | FLW-25 (somente leitura, undo), FLW-36/FLW-37 (com e sem snapshot), FLW-48 (pausa)  |

---

## Requirement Traceability

| Requirement ID | Story                           | Phase   | Status      |
| -------------- | ------------------------------- | ------- | ----------- |
| FLW-01         | P1: Resposta visível no canvas  | Tasks   | In Tasks    |
| FLW-02         | P1: Resposta visível no canvas  | Tasks   | In Tasks    |
| FLW-03         | P1: Resposta visível no canvas  | Tasks   | In Tasks    |
| FLW-04         | P1: Resposta visível no canvas  | Tasks   | In Tasks    |
| FLW-05         | P1: Resposta visível no canvas  | Tasks   | In Tasks    |
| FLW-06         | P1: Resposta visível no canvas  | Tasks   | In Tasks    |
| FLW-07         | P1: Resposta visível no canvas  | Tasks   | In Tasks    |
| FLW-08         | P1: Chamada condicional         | Execute | Implemented |
| FLW-09         | P1: Chamada condicional         | Execute | Implemented |
| FLW-10         | P1: Chamada condicional         | Execute | Implemented |
| FLW-11         | P1: Chamada condicional         | Execute | Implemented |
| FLW-12         | P1: Chamada condicional         | Execute | Implemented |
| FLW-13         | P1: Chamada condicional         | Execute | Implemented |
| FLW-14         | P1: Chamada condicional         | Execute | Implemented |
| FLW-15         | P1: Chamada condicional         | Tasks   | In Tasks    |
| FLW-16         | P1: Chamada condicional         | Execute | Implemented |
| FLW-17         | P1: Referências, editor e dados | Execute | Implemented |
| FLW-18         | P1: Referências, editor e dados | Execute | Implemented |
| FLW-19         | P1: Referências, editor e dados | Execute | Implemented |
| FLW-20         | P1: Referências, editor e dados | Execute | Implemented |
| FLW-21         | P1: Referências, editor e dados | Execute | Implemented |
| FLW-22         | P1: Referências, editor e dados | Execute | Implemented |
| FLW-23         | P1: Referências, editor e dados | Execute | Implemented |
| FLW-24         | P1: Referências, editor e dados | Execute | Implemented |
| FLW-25         | P1: Referências, editor e dados | Execute | Implemented |
| FLW-26         | P2: Ordem e paralelismo         | Execute | Implemented |
| FLW-27         | P2: Ordem e paralelismo         | Execute | Implemented |
| FLW-28         | P2: Ordem e paralelismo         | Execute | Implemented |
| FLW-29         | P2: Ordem e paralelismo         | Tasks   | In Tasks    |
| FLW-30         | P2: Ordem e paralelismo         | Tasks   | In Tasks    |
| FLW-31         | P2: Ordem e paralelismo         | Tasks   | In Tasks    |
| FLW-32         | P2: Ordem e paralelismo         | Execute | Implemented |
| FLW-33         | P2: Trace de uma requisição     | Tasks   | In Tasks    |
| FLW-34         | P2: Trace de uma requisição     | Tasks   | In Tasks    |
| FLW-35         | P2: Trace de uma requisição     | Tasks   | In Tasks    |
| FLW-36         | P2: Trace de uma requisição     | Tasks   | In Tasks    |
| FLW-37         | P2: Trace de uma requisição     | Tasks   | In Tasks    |
| FLW-38         | P2: Trace de uma requisição     | Tasks   | In Tasks    |
| FLW-39         | P2: Trace de uma requisição     | Tasks   | In Tasks    |
| FLW-40         | P2: Trace de uma requisição     | Tasks   | In Tasks    |
| FLW-41         | P2: Trace de uma requisição     | Tasks   | In Tasks    |
| FLW-42         | Edge cases                      | Execute | Implemented |
| FLW-43         | Edge cases                      | Execute | Implemented |
| FLW-44         | Edge cases                      | Execute | Implemented |
| FLW-45         | Edge cases                      | Tasks   | In Tasks    |
| FLW-46         | Edge cases                      | Execute | Implemented |
| FLW-47         | Edge cases                      | Tasks   | In Tasks    |
| FLW-48         | Edge cases                      | Tasks   | In Tasks    |
| FLW-49         | Edge cases                      | Tasks   | In Tasks    |

**Coverage:** 49 total, 49 mapped to tasks (ver `tasks.md`), 0 unmapped

---

## Success Criteria

- [ ] Nas 35 referências, seguir uma bola mostra a requisição voltando até a entrada, e nenhuma aresta async tem volta.
- [ ] Nenhuma referência tem aresta `cache → banco`; todas usam look-aside e continuam passando `data.test.ts`, `scoring.test.ts` e `advisor.test.ts`.
- [ ] Um design salvo antes da mudança abre com a mesma carga por nó no `analyze()` (deep-equal) e sem aviso.
- [ ] Com o Redis derrubado por fault na referência do URL Shortener, a carga do banco sobe para todas as leituras e a requisição não falha por causa do cache.
- [ ] O trace de uma leitura na referência do URL Shortener mostra todos os passos, o hit/miss do cache e um total que bate com a soma dos passos.
- [ ] `npm run bundle:check` passa sem re-baseline.
