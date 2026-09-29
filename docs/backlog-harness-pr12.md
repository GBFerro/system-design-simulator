# Backlog: guardrails e harness (PR #12, Spec 07)

Origem: `/harness-review` do PR #12.

Já aplicado no PR:

- Merge do `feat/spec-06-traffic` atualizado (com os ajustes dos PRs #9, #10 e #11).
- `docs/07`: status e critérios entregues (OBS-01 a 04) marcados.
- `CLAUDE.md`: a frase de abertura diz que os designs salvos ficam em IndexedDB, e o parágrafo Stores aponta `persistence.versions.test.ts` (itens P3 e P4 de `docs/backlog-harness-pr10.md`, que só podiam ser feitos aqui).
- `CLAUDE.md`: o parágrafo "Simulation engine", que era uma linha de ~4 000 caracteres, foi quebrado em lista (pipeline, compilação, entradas, ordem, modelo de filas, roteamento, retries, invariantes, tick loop, `FlowEngine`, sessão, testes). O texto é o mesmo; o script de divisão confere isso antes de gravar. Fechou o item G2 de `docs/backlog-harness-pr9.md` e o T3 de `docs/backlog-harness-pr11.md`. O #12 só mexe nos parágrafos Stores e Runtime metrics, então não há conflito.

## M1: O mapa de arquitetura do `CLAUDE.md` envelhece a cada PR

**Resolvido no PR #14:** `tests/unit/claude-map.test.ts` confere as pastas de primeiro e segundo nível de `src/` (cada uma na entrada da pasta-mãe), os arquivos de `src/lib`, `src/hooks` e `src/store` e as contagens de componentes, problemas e trade-off cards. O mapa foi atualizado de uma vez (`domain/persistence/`, `hooks/`, `ringBuffer`/`particles`/`runtimeMetrics` e os stores). Mutação testada: tirar um arquivo, mudar uma contagem ou renomear uma pasta no mapa faz o teste falhar.

**Problema.** Nesta pilha o mapa ficou desatualizado em quase todo PR: `tests/` e `scripts/` (#5), os arquivos novos do editor em `components/canvas/` e `lib/` (#6), `domain/` e `data/` (#8, o número de componentes estava em 30 quando eram 36), `lib/ringBuffer.ts`, `lib/particles.ts`, `lib/runtimeMetrics.ts` (#11 e #12), `components/canvas/FlowParticles.tsx`, `nodes/NodeMetricsBadge.tsx` e a pasta `hooks/`, que nunca esteve no mapa. Cada revisão achou e corrigiu na mão, e os PRs empilhados editam as mesmas linhas, o que gera conflito.

**Proposta.** Um teste `tests/unit/claude-map.test.ts` que lê o bloco "Architecture map" do `CLAUDE.md` e exige que:

- toda pasta de primeiro e segundo nível de `src/` apareça ali;
- todo arquivo de `src/lib`, `src/hooks` e `src/store` apareça pelo nome (sem extensão);
- as contagens do mapa (componentes, problemas, trade-off cards) batam com os arrays.

**Custo.** Um teste pequeno. Só pode ser ligado depois que a pilha entrar em `main` e o mapa for atualizado de uma vez, senão ele falha por conta dos arquivos dos outros PRs.

## M2: Gancho de teste `window.__runtimeStore` existe em qualquer build com `?e2e`

**Ainda pendente (condição não atendida), conferido no PR #14:** `window.__runtimeStore` continua sendo o único gancho `window.__*` em `src/`.

**Problema.** `store/runtimeStore.ts` expõe o store em `window.__runtimeStore` em dev ou com `?e2e` na URL de qualquer build, para os testes injetarem snapshots. O CI roda os E2E contra `next start`, então o gancho precisa existir em produção. Está no `CLAUDE.md`, mas nada impede que um segundo gancho do mesmo tipo apareça em outro store sem ser listado.

**Proposta.** Se aparecer um segundo gancho, mover todos para um módulo único (`lib/e2eHooks.ts`) que registre o objeto uma vez, com o mesmo critério (`?e2e` ou dev), e listar nesse módulo o que expõe. Enquanto houver um só, não vale o custo.

**Custo.** Só se houver um segundo gancho.
