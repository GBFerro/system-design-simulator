# Backlog: guardrails e harness (PR #8, Spec 03)

Origem: `/harness-review` do PR #8. As frases do `CLAUDE.md` sobre o engine (`maxQPS`/`replicas`) e sobre o `SerializedEdge` (sem `rule`) estão desatualizadas nesta branch, mas os PRs #9 e #10 já reescrevem esses parágrafos, então não foram tocadas aqui. Os itens abaixo tocam arquivos que os PRs #9 (motor) e #10 (persistência) reescrevem (`savedDesignsStore.ts`, `simulator.ts`, `CLAUDE.md`), então ficam para depois que a pilha entrar em `main`.

Já aplicado no PR:

- `engine/simulator.ts` lia `node.data.params` direto, enquanto o scoring e a latência usam os leitores do registry. Um nó pré-v2 (com `maxQPS`/`replicas` e sem `params`) saía do motor com `effectiveQPS: 0`, utilização 2 e "critical". Agora o motor usa `resolvedParams`. Teste em `tests/unit/legacyNodes.test.ts`.
- O teste `legacyNodes.test.ts` foi removido no PR #9, quando o motor v1 virou `engine/legacy/` (só comparação); o motor novo já testa os campos v1 em `engine-analyze.test.ts`.
- `docs/03-catalogo-de-componentes.md`: status e critérios de aceite entregues marcados.

## C1: `loadDesign` deixa dado no formato v1 entrar no canvas

**Problema.** `savedDesignsStore.ts` (`loadDesign`, ~linha 347) restaura os nós com `{ ...n.data } as unknown as ComponentNodeData`. O cast esconde que um design salvo antes da v2 chega ao canvas sem `params`, e só os leitores do registry (`resolvedParams`) mascaram isso. O `importDesign` já normaliza pelo `sanitizeParams`; o caminho de carregar design salvo, não.

**Proposta.** Passar os nós carregados pelo mesmo normalizador do import (`sanitizeParams` e `sanitizeEdgeRule`) e remover o `as unknown as`. A Spec 05 (PR #10) cobre a migração da persistência, então isso provavelmente cai lá. Confirmar depois do merge e, se sobrar, fazer aqui.

**Custo.** Pequeno; colide com a reescrita do `savedDesignsStore.ts` no PR #10.

**Resolvido no PR #10 (confirmado no PR #15).** O `loadDesign` não tem mais cast: restaura com `deserializeNodes`/`deserializeEdges` a partir de `SavedDesign.nodes` (`SerializedNode`, sempre com `params`), e todo design persistido passa por `migrateSavedDesignsState` (`migrateV1toV2`) no rehydrate, inclusive a cópia que sai do `localStorage` para o IndexedDB. O teste "loading a migrated saved design puts the same graph on the canvas" em `persistence.stores.test.ts` carrega um design v1 migrado e confere `params` no canvas e a ausência de `maxQPS`/`latencyMs`/`replicas`.

## C2: Remover o fallback de campos v1 quando a migração existir

**Problema.** `registry.ts` mantém `LEGACY_FIELD` e `resolvedParams` lê `maxQPS`/`latencyMs`/`replicas` como reserva. Isso é necessário enquanto houver dado v1 circulando, mas vira código morto e um segundo caminho para testar depois que a Spec 05 migrar tudo no rehydrate.

**Proposta.** Depois do merge do PR #10, confirmar que nenhum caminho (rehydrate do `canvasStore`, `loadDesign`, `importDesign`, `loadReferenceIntoTab`) entrega nó sem `params`. Aí remover `LEGACY_FIELD`, o teste `resolvedParams fills missing core keys from the v1 fields`, e o comentário no `legacy/simulator.ts`, e trocar `ParamsCarrier` por `ComponentNodeData`.

**Custo.** Pequeno, mas só é seguro depois da migração.

**Resolvido no PR #15.** Todos os caminhos de entrada entregam `params`: rehydrate do `canvasStore` (`migrateCanvasState`), `loadDesign` (ver C1), `importDesign` (`migrateGraphV1toV2`), `loadReferenceIntoTab` e a paleta (`defaultParams`; a paleta via `createComponentNode`), colar/duplicar (cópia profunda de nós do canvas) e componentes custom (`defaultParams` do schema genérico montado a partir do `customComponentsStore`). Saíram `LEGACY_FIELD`, a leitura de campos v1 em `numParam`/`resolvedParams` e em `compileGraph`, e o índice `[key: string]` do `ParamsCarrier`, que ficou só com `componentId` + `params` (o domínio não importa o tipo do store). O teste do `resolvedParams` e o de `engine-analyze.test.ts` agora conferem que os campos v1 são ignorados em runtime; a conversão continua em `domain/persistence/migrate.ts`.
