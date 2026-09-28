# Backlog: guardrails e harness (PR #8, Spec 03)

Origem: `/harness-review` do PR #8. Os itens abaixo tocam arquivos que os PRs #9 (motor) e #10 (persistência) reescrevem (`savedDesignsStore.ts`, `simulator.ts`, `CLAUDE.md`), então ficam para depois que a pilha entrar em `main`.

Já aplicado no PR:

- `engine/simulator.ts` lia `node.data.params` direto, enquanto o scoring e a latência usam os leitores do registry. Um nó pré-v2 (com `maxQPS`/`replicas` e sem `params`) saía do motor com `effectiveQPS: 0`, utilização 2 e "critical". Agora o motor usa `resolvedParams`. Teste em `tests/unit/legacyNodes.test.ts`.
- `CLAUDE.md`: a invariante do engine e a do `SerializedEdge` (agora com `rule`) refletem o código.
- `docs/03-catalogo-de-componentes.md`: status e critérios de aceite entregues marcados.

## C1: `loadDesign` deixa dado no formato v1 entrar no canvas

**Problema.** `savedDesignsStore.ts` (`loadDesign`, ~linha 347) restaura os nós com `{ ...n.data } as unknown as ComponentNodeData`. O cast esconde que um design salvo antes da v2 chega ao canvas sem `params`, e só os leitores do registry (`resolvedParams`) mascaram isso. O `importDesign` já normaliza pelo `sanitizeParams`; o caminho de carregar design salvo, não.

**Proposta.** Passar os nós carregados pelo mesmo normalizador do import (`sanitizeParams` e `sanitizeEdgeRule`) e remover o `as unknown as`. A Spec 05 (PR #10) cobre a migração da persistência, então isso provavelmente cai lá. Confirmar depois do merge e, se sobrar, fazer aqui.

**Custo.** Pequeno; colide com a reescrita do `savedDesignsStore.ts` no PR #10.

## C2: Remover o fallback de campos v1 quando a migração existir

**Problema.** `registry.ts` mantém `LEGACY_FIELD` e `resolvedParams` lê `maxQPS`/`latencyMs`/`replicas` como reserva. Isso é necessário enquanto houver dado v1 circulando, mas vira código morto e um segundo caminho para testar depois que a Spec 05 migrar tudo no rehydrate.

**Proposta.** Depois do merge do PR #10, confirmar que nenhum caminho (rehydrate do `canvasStore`, `loadDesign`, `importDesign`, `loadReferenceIntoTab`) entrega nó sem `params`. Aí remover `LEGACY_FIELD`, o teste `resolvedParams fills missing core keys from the v1 fields`, o comentário no `simulator.ts` e o teste `legacyNodes.test.ts`, e trocar `ParamsCarrier` por `ComponentNodeData`.

**Custo.** Pequeno, mas só é seguro depois da migração.
