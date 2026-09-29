# Backlog: guardrails e harness (PR #11, Spec 06)

Origem: `/harness-review` do PR #11.

Já aplicado no PR:

- Merge do `feat/spec-04-engine` e do `feat/spec-05-persistence` atualizados (com os ajustes dos PRs #9 e #10).
- `tests/unit/engine-parity.test.ts`: o `CLAUDE.md` diz que `core/settle.ts` é compartilhado entre `analyze()` e o `TickSimulator` ("don't fork it"), mas nenhum teste comparava os dois. Agora 9 soluções de referência sem sobrecarga, a 1 000 RPS, precisam mostrar a mesma carga por nó (tolerância de 5%) e o mesmo throughput no tick loop e no `analyze()`. Testado inflando a carga do tick em 20%: 9 dos 10 testes falham.
- `bundle:check` ganhou um segundo marcador de código lazy: `Engine.analyze() called before load()`, uma string que só existe em `engine/engine.ts`. Antes, só o cliente do worker (`client.ts`) era vigiado; um `import` estático do `FlowEngine` ou do `tick.ts` a partir de um componente passaria despercebido.
- `CLAUDE.md`: a frase "Unit tests cover pure logic (scoring, and later the engine)" estava velha. `docs/04` (Fase 2) e `docs/06` (TRF-01 a 03): status e critérios entregues marcados.

## T1: Orçamento de bundle quase esgotado antes das Specs 08 a 14

**Resolvido no PR #14:** o dono do projeto escolheu re-baselinar por fase. O PR que fecha uma fase do roadmap (Fase 0 a 6 de `docs/00-visao-geral.md`) roda `--update` e justifica o crescimento; entre fases vale o +15% sobre o baseline atual. A regra está no `CLAUDE.md` (Commands) e no cabeçalho de `scripts/bundle-size.mjs`. O baseline não foi atualizado nesse PR.

**Problema.** O baseline (`bundle-baseline.json`, 25/09/2026) é do v1 e o limite é +15%. Com as Specs 03 a 07 o bundle inicial está em +10,9% (números dos PRs #11 e #12), sobrando 4,1 pontos percentuais para as sete specs restantes. O `bundle:check` compara sempre com o baseline fixo, então também não acusa um PR isolado que consuma metade da folga.

**Proposta.** Decisão do dono do projeto, uma destas:

- re-baselinar ao fim de cada fase (a Spec 01 fala em "checado a cada fase"), com `--update` justificado no PR da fase;
- ou acrescentar um teto por PR (ex.: falhar se um PR crescer mais de 3 pp sobre o bundle da base).

**Custo.** Pequeno; a escolha é de política, por isso não foi aplicada.

## T2: Tabela de atalhos do README sem o `P`

**Resolvido no PR #14:** a tabela ganhou `P` (Play / pause live traffic) e também `Ctrl/⌘ + K` (Command palette) e `Tab` (Move focus between nodes), que estavam no `ShortcutsDialog.tsx` e faltavam no README.

**Problema.** O atalho `P` (play/pause) está no `?` (`ShortcutsDialog.tsx`), mas não na tabela do README. Esta branch ainda tem a tabela antiga; o PR #6 reescreve a tabela inteira, então mexer aqui geraria conflito.

**Proposta.** Depois que a pilha entrar em `main`, acrescentar uma linha `P` / "Play / pause the simulation" na tabela do README.

**Custo.** Uma linha.

## T3: Parágrafo do motor no `CLAUDE.md` (continuação do G2)

O item G2 de `docs/backlog-harness-pr9.md` esperava o PR #11, que é quem acrescenta a parte do tick loop. Com o #11 nesta branch, o parágrafo "Simulation engine" pode ser quebrado em lista curta (pipeline, worker, modelo de filas, roteamento, tick loop, invariantes), sem mudar o conteúdo. Fazer logo depois do merge do #11, e conferir antes se o #12 não mexeu nele.
