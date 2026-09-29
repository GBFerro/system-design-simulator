# Backlog: guardrails e harness

Origem: `/harness-review` do PR #5 (Spec 01). Cada item ficou fora do PR por mexer em código de scoring ou dados, ou por precisar do seu próprio PR. Ordem sugerida: H1, H2, H3, H4.

Todos os quatro foram resolvidos no PR `chore/harness-scoring-data`.

## H1: Orçamento de pontos verificado no código, não no comentário

**Resolvido no PR `chore/harness-scoring-data`.** Cada regra de `src/scoring/rules/` exporta `BUDGET` (e `PARTIAL`, para o crédito parcial) e só pontua por ele; `CATEGORY_MAX_SCORE` (20) fica em `src/scoring/budget.ts`. O `scoring.test.ts` soma `Object.values(BUDGET)` em vez de ler o comentário, confere que cada parcial é menor que o seu orçamento e tem um design completo por regra que chega a exatamente 20, sem feedback. As notas das 35 referências e de 3.000 grafos aleatórios ficaram idênticas antes e depois. O `CLAUDE.md` (Scoring) aponta para o teste, a regra do `AGENTS.md` saiu (H4) e o item do PR template também.

**Problema.** `tests/unit/scoring.test.ts` valida "cada regra soma 20" com uma regex sobre o comentário `Point budget (max 20)` de cada arquivo em `src/scoring/rules/`. Se alguém trocar um `+3` por `+4` no código e não mexer no comentário, nenhum teste falha. Os demais testes só garantem `0 ≤ score ≤ 20` e `maxScore === 20`, então nada prova que o máximo alcançável seja 20.

**Proposta.**

- Cada regra exporta seu orçamento como `as const` (ex.: `export const BUDGET = { spof: 3, dbRedundancy: 3, … } as const`) e usa esses valores ao pontuar.
- O teste soma `Object.values(BUDGET)` e exige 20, sem ler o texto do arquivo.
- Um grafo "completo" por regra que atinja exatamente 20.

**Evidência.** Commits `d84b7d9` (correctness audit), `c2c511d` e `57d4563` (scoring refinements) mexeram nas regras. O checklist do PR e o `CLAUDE.md` ainda dependem de "verify the arithmetic".

**Custo.** 5 arquivos de regra, um fixture por regra e o ajuste do teste.

**Depois de feito.** Encurtar a regra de scoring do `AGENTS.md` ("Keep each scoring category capped at exactly 20 points") e a frase "verify the arithmetic" do `CLAUDE.md` para um ponteiro a `npm test`. O item do PR template ("Scoring rules still cap…") pode sair.

## H2: Teste de integridade dos dados

**Resolvido no PR `chore/harness-scoring-data`.** `tests/unit/data.test.ts` confere os pré-requisitos do learning path contra os conceitos ensinados por problemas estritamente anteriores, a entrada em `interviewData.ts` e o tier de cada problema, e o nó de entrada de cada referência (H3). Nenhum dado além do `web-crawler` estava quebrado. As contagens documentadas ficaram de fora: são cobertas pelo teste do mapa do `CLAUDE.md`, em outro PR.

**Problema.** As convenções de "Data conventions" do `CLAUDE.md` só existem como prosa. O teste de referências do PR #5 já achou um erro de dado que ninguém tinha visto (H3), o que indica que elas não estão sendo checadas.

**Proposta.** `tests/unit/data.test.ts` verificando:

- todo `componentId` de `problems.ts`, `conceptLibrary.ts` e `learningPath.ts` existe em `components.ts`;
- nenhuma solução de referência repete o mesmo `componentId` (o loader liga arestas por `componentId`);
- os pré-requisitos do `learningPath` vêm só de conceitos ensinados por problemas estritamente anteriores;
- todos os problemas têm entrada em `interviewData.ts` e um tier no learning path;
- contagens documentadas (componentes, problemas, trade-off cards) batem com os arrays. O `CLAUDE.md` dizia 30 componentes quando `components.ts` já tinha 36; o PR #6 corrigiu o número na mão.

**Já coberto pelo PR #8 (Spec 03).** `tests/unit/catalog.test.ts` cruza os ids de `problems.ts` e `conceptLibrary.ts` com o catálogo, exige que cada referência use um `componentId` uma vez só e que o learning path cubra todos os problemas. Ao entrar o #8, este item se reduz a: pré-requisitos do learning path vindos só de problemas anteriores, entrada em `interviewData.ts` por problema e as contagens documentadas.

**Custo.** Um arquivo de teste, sem dependência nova. Pode revelar dados quebrados que precisam de correção no mesmo PR, por isso ficou de fora do PR #5.

## H3: Corrigir a referência do `web-crawler`

**Resolvido no PR `chore/harness-scoring-data`.** Um Task Scheduler entra como nó de entrada e alimenta a URL frontier (`task-scheduler → message-queue`) com as URLs semente e os re-crawls que vencem, que é o papel dele num crawler (re-crawl adaptativo está nas restrições do problema). A dica "URL frontier design" menciona o scheduler. A referência passou de 14 para 70 pontos, o `KNOWN_UNREACHABLE_REFERENCES` saiu do teste e o `CLAUDE.md` (Data conventions) ganhou a regra do nó de entrada.

**Problema.** A referência é o ciclo puro `message-queue ↔ app-server`, sem nó de in-degree 0. Nada fica alcançável e ela tira 14/100 (0 em Scalability, Latency e Trade-offs). O teste a isola por nome em `KNOWN_UNREACHABLE_REFERENCES`.

**Proposta.**

- Adicionar o nó de entrada (client ou load balancer) à referência em `src/data/problems.ts`, respeitando a regra de não repetir `componentId`.
- Remover o `Set` do teste, para que todas as 35 referências passem sem exceção.
- Acrescentar ao `CLAUDE.md` (Data conventions): "toda solução de referência precisa de um nó de entrada, ou seja, in-degree 0 com aresta de saída". É a mesma regra do engine, hoje não escrita para dados.
- Incluir essa checagem no teste do H2.

**Custo.** Edição de dado mais a revisão do conteúdo, já que ele ensina candidatos a entrevista.

## H4: Regras de scoring duplicadas entre `CLAUDE.md` e `AGENTS.md`

**Resolvido no PR `chore/harness-scoring-data`.** As invariantes ficam só no `CLAUDE.md`. O `AGENTS.md` manteve o bloco do Next.js e virou uma lista curta de ponteiros: o `CLAUDE.md`, os testes que já cobrem invariantes (`scoring`, `catalog`, `data`, `persistence.versions`) e o PR template.

**Problema.** As mesmas invariantes aparecem nos dois arquivos, com redações diferentes, e tendem a divergir. O `AGENTS.md` já estava desatualizado no PR #5 (dizia "no unit tests").

**Proposta.** Manter as invariantes só no `CLAUDE.md` e deixar no `AGENTS.md` uma lista curta de ponteiros. Revisar depois do H1, quando parte das regras passar a ser coberta por teste.

**Custo.** Só documentação.
