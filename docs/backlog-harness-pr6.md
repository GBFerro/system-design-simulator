# Backlog: guardrails e harness (PR #6, Spec 02)

Origem: `/harness-review` do PR #6. Estes itens mexem em arquivos que o PR #8 (Spec 03) também altera (`canvasStore.ts`, `CanvasContextMenu.tsx`, `NodeActionsToolbar.tsx`, `ComponentPalette.tsx`, `loadReference.ts`, `nodeFactory.ts`). Aplicar aqui geraria conflito em toda a pilha, então ficam para depois que a pilha entrar em `main`.

Já aplicado no PR: bug do undo depois de nudge (com teste), checagem de digitação unificada no `top-bar.tsx`, tabela de atalhos do README e mapa de arquitetura do `CLAUDE.md`.

## E1: Um único seletor de "aba somente leitura"

**Problema.** A mesma expressão `tabs.find((t) => t.id === activeTabId)?.readOnly` aparece em 8 lugares: `CanvasContextMenu.tsx:68`, `DesignCanvas.tsx:99`, `NodeActionsToolbar.tsx:16`, `PaletteDnd.tsx:98`, `app-shell.tsx` (2 vezes), `top-bar.tsx:80` e `ComponentPalette.tsx:64`. O `canvasStore.ts:109` já tem `isActiveTabReadOnly`, mas privada. A regra "reference tabs must gate…" do `CLAUDE.md` depende de cada componente lembrar de repetir a checagem.

**Proposta.** Exportar `isActiveTabReadOnly(state)` do store e criar `useIsActiveTabReadOnly()` (`useCanvasStore(isActiveTabReadOnly)`). Trocar os 8 pontos. Depois, encurtar a frase do `CLAUDE.md` para "use `isActiveTabReadOnly`".

**Custo.** Refactor mecânico de 8 arquivos; o typecheck e o E2E de editor cobrem.

**Status.** Resolvido no PR #N: `isActiveTabReadOnly(state)` exportado do `canvasStore` e novo `useIsActiveTabReadOnly()`; os 9 pontos (incluindo o hook local do `RightPanel.tsx`) usam um dos dois, e a frase do `CLAUDE.md` aponta para eles.

## E2: Gate de somente leitura em todas as actions de mutação

**Problema.** Só as actions novas do PR (`deleteSelection`, `placeNode`, `pasteClipboard`, `duplicateSelection`, `nudgeSelection`, `changeReplicas`) recusam edição em aba de referência dentro do store. `addNode`, `onConnect`, `updateNodeData`, `updateEdgeData`, `updateAllNodeData` e `clearCanvas` dependem de a UI ter checado antes. O teste "read-only tabs reject every edit" lista as actions à mão, então uma action nova escapa dele.

**Proposta.** Fazer as actions restantes verificarem `isActiveTabReadOnly` (ou ter uma exceção explícita e comentada) e o teste iterar sobre uma lista única de mutadoras, `MUTATING_ACTIONS`, exportada do store. Esquecer o gate numa action nova passa a quebrar o teste.

**Custo.** Médio: mexe em `canvasStore.ts` e pode expor telas que hoje mutam abas de referência de propósito (ex.: carregar referência via `loadReferenceIntoTab`, que precisa de exceção).

**Status.** Resolvido no PR #N: `MUTATING_ACTIONS` (15 actions, todas com gate no store; em aba de referência `onNodesChange`/`onEdgesChange` só aplicam `select`/`dimensions`) e `READ_ONLY_EXEMPT_ACTIONS` (abas, histórico, seleção e `copySelection`, cada grupo com o motivo). O teste chama cada mutadora numa aba somente leitura e falha se alguma action do store não estiver em exatamente uma das listas. O botão "Clear canvas" fica desabilitado em aba de referência, e criar um problema a partir dela não pede confirmação nem limpa a referência.

## E3: `loadReference.ts` deveria usar `createComponentNode`

**Problema.** `src/lib/loadReference.ts:38` monta o `ComponentNodeData` inline, campo a campo, o mesmo objeto que `lib/nodeFactory.ts` cria. O `CLAUDE.md` (Canvas/UI) diz "Create nodes with `lib/nodeFactory.ts`". O helper `node()` de `tests/unit/scoring.test.ts` repete o objeto uma terceira vez. Quando o `ComponentNodeData` ganha campo (a Spec 03 troca `maxQPS`/`latencyMs`/`replicas` por `params`), cada cópia precisa ser achada à mão.

**Proposta.** `refNodes.push({ ...createComponentNode(comp, { x: ref.x, y: ref.y }), id: nodeId })` em `loadReference.ts`, e o mesmo padrão no helper do teste de scoring.

**Custo.** Pequeno, mas colide com o PR #8, que já edita esses três arquivos.

**Status.** Resolvido no PR #N: `loadReference.ts` usa `{ ...createComponentNode(comp, { x, y }), id: nodeId }`. A metade do helper `node()` de `tests/unit/scoring.test.ts` foi feita no PR paralelo de harness de scoring/dados.
