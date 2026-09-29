# Backlog: guardrails e harness (PR #9, Spec 04)

Origem: `/harness-review` do PR #9.

Já aplicado no PR:

- `bundle:check` passou a falhar se o cliente do worker do motor (`engine/client.ts`) aparecer no JS inicial. A regra "o motor nunca fica no bundle inicial" só estava no `CLAUDE.md` e, na prática, só seria pega pelo limite de +15%, que é folgado (hoje o bundle está em +7,7%). O marcador é a string `systemforge-engine`, que só existe em `client.ts`. Testado nos dois sentidos: passa hoje e falha quando o marcador é uma string que está no bundle inicial.
- Merge do `feat/spec-03-catalog` atualizado e remoção de `tests/unit/legacyNodes.test.ts`. O teste importava `@/engine/simulator`, que este PR move para `engine/legacy/`, então o typecheck quebrava depois do merge. O motor novo já cobre os campos v1 em `engine-analyze.test.ts`.
- `CLAUDE.md`: `comlink` na stack. `docs/04`: status e critérios da Fase 1 entregues.

## G1: CI não roda em PR empilhado

**Problema.** `.github/workflows/ci.yml` usa `pull_request: branches: [main]`. Os PRs empilhados (#6 a #12) têm outra base e ficam sem nenhum check ("no checks reported"). Foi assim que a quebra entre o #8 e o #9 (um import de módulo movido) só apareceu ao juntar as branches à mão.

**Proposta.** Tirar o filtro de branch do gatilho `pull_request` (mantendo `push: branches: [main]`), para o CI rodar em qualquer PR. Se o custo de minutos importar, limitar a `branches: [main, "feat/**"]`.

**Custo.** Uma linha; mais execuções de CI enquanto houver pilha.

## G2: Parágrafo do motor no `CLAUDE.md` é uma linha de ~2 000 caracteres

**Problema.** O bloco "Simulation engine" mistura pipeline, worker, ordem topológica, modelo M/M/c, roteamento e limites numa linha só. Fica difícil de achar uma regra e de ver o que mudou em um diff. Os PRs de tick loop (#11) e métricas (#12) vão mexer nele de novo.

**Proposta.** Depois que o #11 entrar, quebrar em lista curta (pipeline, worker, modelo de filas, roteamento, invariantes numéricas), sem alterar o conteúdo.

**Custo.** Só documentação; colidiria com o #11 se feito antes.
