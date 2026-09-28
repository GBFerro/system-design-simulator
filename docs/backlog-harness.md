# Backlog: guardrails e harness

Origem: `/harness-review` do PR #5 (Spec 01). Cada item ficou fora do PR por mexer em código de scoring ou dados, ou por precisar do seu próprio PR. Ordem sugerida: H1, H2, H3, H4.

## H1: Orçamento de pontos verificado no código, não no comentário

**Problema.** `tests/unit/scoring.test.ts` valida "cada regra soma 20" com uma regex sobre o comentário `Point budget (max 20)` de cada arquivo em `src/scoring/rules/`. Se alguém trocar um `+3` por `+4` no código e não mexer no comentário, nenhum teste falha. Os demais testes só garantem `0 ≤ score ≤ 20` e `maxScore === 20`, então nada prova que o máximo alcançável seja 20.

**Proposta.**

- Cada regra exporta seu orçamento como `as const` (ex.: `export const BUDGET = { spof: 3, dbRedundancy: 3, … } as const`) e usa esses valores ao pontuar.
- O teste soma `Object.values(BUDGET)` e exige 20, sem ler o texto do arquivo.
- Um grafo "completo" por regra que atinja exatamente 20.

**Evidência.** Commits `d84b7d9` (correctness audit), `c2c511d` e `57d4563` (scoring refinements) mexeram nas regras. O checklist do PR e o `CLAUDE.md` ainda dependem de "verify the arithmetic".

**Custo.** 5 arquivos de regra, um fixture por regra e o ajuste do teste.

**Depois de feito.** Encurtar a regra de scoring do `AGENTS.md` ("Keep each scoring category capped at exactly 20 points") e a frase "verify the arithmetic" do `CLAUDE.md` para um ponteiro a `npm test`. O item do PR template ("Scoring rules still cap…") pode sair.

## H2: Teste de integridade dos dados

**Problema.** As convenções de "Data conventions" do `CLAUDE.md` só existem como prosa. O teste de referências do PR #5 já achou um erro de dado que ninguém tinha visto (H3), o que indica que elas não estão sendo checadas.

**Proposta.** `tests/unit/data.test.ts` verificando:

- todo `componentId` de `problems.ts`, `conceptLibrary.ts` e `learningPath.ts` existe em `components.ts`;
- nenhuma solução de referência repete o mesmo `componentId` (o loader liga arestas por `componentId`);
- os pré-requisitos do `learningPath` vêm só de conceitos ensinados por problemas estritamente anteriores;
- todos os problemas têm entrada em `interviewData.ts` e um tier no learning path;
- contagens documentadas (30 componentes, 35 problemas, 21 trade-off cards) batem com os arrays.

**Custo.** Um arquivo de teste, sem dependência nova. Pode revelar dados quebrados que precisam de correção no mesmo PR, por isso ficou de fora do PR #5.

## H3: Corrigir a referência do `web-crawler`

**Problema.** A referência é o ciclo puro `message-queue ↔ app-server`, sem nó de in-degree 0. Nada fica alcançável e ela tira 14/100 (0 em Scalability, Latency e Trade-offs). O teste a isola por nome em `KNOWN_UNREACHABLE_REFERENCES`.

**Proposta.**

- Adicionar o nó de entrada (client ou load balancer) à referência em `src/data/problems.ts`, respeitando a regra de não repetir `componentId`.
- Remover o `Set` do teste, para que todas as 35 referências passem sem exceção.
- Acrescentar ao `CLAUDE.md` (Data conventions): "toda solução de referência precisa de um nó de entrada, ou seja, in-degree 0 com aresta de saída". É a mesma regra do engine, hoje não escrita para dados.
- Incluir essa checagem no teste do H2.

**Custo.** Edição de dado mais a revisão do conteúdo, já que ele ensina candidatos a entrevista.

## H4: Regras de scoring duplicadas entre `CLAUDE.md` e `AGENTS.md`

**Problema.** As mesmas invariantes aparecem nos dois arquivos, com redações diferentes, e tendem a divergir. O `AGENTS.md` já estava desatualizado no PR #5 (dizia "no unit tests").

**Proposta.** Manter as invariantes só no `CLAUDE.md` e deixar no `AGENTS.md` uma lista curta de ponteiros. Revisar depois do H1, quando parte das regras passar a ser coberta por teste.

**Custo.** Só documentação.
