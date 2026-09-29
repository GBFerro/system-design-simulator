# Backlog: guardrails e harness (PR #10, Spec 05)

Origem: `/harness-review` do PR #10.

Já aplicado no PR:

- `tests/unit/persistence.versions.test.ts`: o `CLAUDE.md` exige que todo store persistido use `STORE_VERSION`, `skipHydration: true` e um `migrate` real ("a new persisted store must do the same"), mas só a leitura do texto garantia isso. O teste confere os 8 stores atuais e falha se um arquivo novo de `src/store/` chamar `persist()` sem entrar na lista. Testado ao voltar o `penStore` para `version: 1`.
- Merge do `feat/spec-03-catalog` atualizado.
- `CLAUDE.md` (parágrafo Stores) e README: dizem que os designs salvos ficam em IndexedDB (antes só `localStorage`). `docs/05`: status e critérios entregues marcados.

## P1: Remover o fallback de campos v1 (destravado por este PR)

O item C2 de `docs/backlog-harness-pr8.md` estava esperando a migração. Depois do merge deste PR, os quatro caminhos de entrada (rehydrate do `canvasStore`, `loadDesign`, `importDesign` e `loadReferenceIntoTab`) entregam nós já com `params`. Falta só confirmar `loadReferenceIntoTab`, que usa `defaultParams` desde a Spec 03, e então remover `LEGACY_FIELD`, o teste `resolvedParams fills missing core keys from the v1 fields` e o campo `maxQPS`/`latencyMs`/`replicas` do `ParamsCarrier`. O `compileGraph` (PR #9) também lê esses campos e precisa do mesmo ajuste.

## P2: A ordem de hidratação só existe como comentário

**Problema.** `hydration.ts` precisa hidratar `customComponentsStore` antes do `canvasStore` e do `savedDesignsStore`, porque a migração usa os componentes custom para distinguir tipo custom de tipo desconhecido. Isso está num comentário. Trocar a ordem das linhas em `rehydrateAllStores()` não quebra nenhum teste, e a migração passaria a marcar componentes custom como desconhecidos.

**Proposta.** Um teste em `persistence.stores.test.ts` com um localStorage v1 que contenha um componente custom (no `customComponentsStore` e usado no canvas) e confira que ele continua `custom` depois de `rehydrateAllStores()`, sem warning de tipo desconhecido.

**Custo.** Um fixture e um teste; não muda código de produção.

## P3 e P4: resolvidos no PR #12

O #10 não podia tocar a frase de abertura do `CLAUDE.md` nem o parágrafo Stores sem conflitar com o #12, que reescreve o Stores. O #12 foi o lugar para fazer as duas coisas: a abertura agora diz que os designs salvos ficam em IndexedDB, e o parágrafo Stores aponta `persistence.versions.test.ts` como o teste que confere a regra da versão.
