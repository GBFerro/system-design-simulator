# Spec 02: Editor confiável

Parte da [v2](00-visao-geral.md) · Fase 0 · Tamanho P · Status: implementado

| Campo               | Valor                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Requisitos          | B1–B6, CAN-01 a CAN-06 (todos P0)                                                                                                          |
| Depende de          | Nada. É o primeiro PR da v2                                                                                                                |
| Arquivos principais | `components/canvas/DesignCanvas.tsx`, `components/sidebar/ComponentPalette.tsx`, `components/layout/app-shell.tsx`, `store/canvasStore.ts` |
| Dependências novas  | `@dnd-kit/core`, `@playwright/test` (dev)                                                                                                  |

## Objetivo

Deixar o editor confiável antes de qualquer mudança no motor: arrastar da paleta funciona em qualquer ponto e em qualquer dispositivo, a seleção tem uma fonte só, e apagar, copiar, colar e duplicar funcionam por teclado, toolbar, menu de contexto e painel.

## Diagnóstico

Os bugs foram reproduzidos no Chromium headless (Playwright) contra a `main` de 25/09/2026.

| Bug                                  | Sintoma reproduzido                                                                                          | Causa raiz                                                                                                                                                                              | Correção                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1 Drop falha no canvas vazio        | Soltar no centro: 0 nós. Soltar no canto: 1 nó                                                               | O empty state (`motion.div` com `pointer-events-auto`) fica sobre o pane e não tem `onDragOver`/`onDrop`, então o browser rejeita o drop                                                | Mover `onDragOver`/`onDrop` do `<ReactFlow>` para o `div` wrapper (`reactFlowWrapper`), que é pai do overlay                                               |
| B2 Delete não funciona após arrastar | Após arrastar, o nó aparece `.selected`, mas Delete/Backspace não faz nada                                   | Duas fontes de seleção: `node.selected` (ReactFlow) e `selectedNodeId` (store), que só é atualizado em `onNodeClick`. Com `snapToGrid` o clique vira drag e o `onNodeClick` não dispara | Usar `node.selected`/`edge.selected` como fonte única, derivar o painel via `onSelectionChange` e criar `deleteSelection()` com um único push no histórico |
| B3 Multi-seleção quebrada            | Shift+clique em 2 nós seleciona 1; Delete apaga 1                                                            | O `multiSelectionKeyCode` padrão do ReactFlow é Meta/Ctrl, e o store só guarda 1 id                                                                                                     | `multiSelectionKeyCode={["Shift","Meta","Control"]}` + `selectionOnDrag` + pan com o botão do meio                                                         |
| B4 Delete escondido                  | Só há botão de delete na aba Props do painel direito, que no tablet já abre fechado. Não há menu de contexto | Faltam affordances                                                                                                                                                                      | `NodeToolbar` ao selecionar + menu de clique direito em nó, edge e canvas                                                                                  |
| B5 Nós gigantes e sobrepostos        | O primeiro nó aparece em zoom 2×; o tap-add empilha nós no centro com ±30 px de jitter                       | O `fitView` roda ao inicializar o primeiro nó com `maxZoom` padrão 2; o posicionamento não detecta colisão                                                                              | `fitViewOptions={{ maxZoom: 1 }}` e posicionar em espiral até achar espaço livre                                                                           |
| B6 Drag não existe no touch          | No mobile só dá para tocar para adicionar                                                                    | O drag and drop HTML5 não funciona com touch                                                                                                                                            | Trocar por drag baseado em pointer events (`@dnd-kit/core`), com um único caminho para mouse e touch                                                       |

## Status atual

O commit `15ee9b7` aplicou o patch mínimo (B1, B2, B3 e o `maxZoom` do B5). O resto foi implementado na branch `feat/spec-02-editor`:

| Item                                         | Status | Onde                                                                                                  |
| -------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| B1: drop sobre o empty state                 | Feito  | `PaletteDnd.tsx`: o drop vale pelo retângulo do canvas, não pelo elemento sob o ponteiro              |
| B2: seleção com fonte única                  | Feito  | `selectedNodeId`/`selectedEdgeId` saíram do store; o painel deriva de `node.selected`/`edge.selected` |
| B3: multi-seleção (Shift/⌘/Ctrl, caixa)      | Feito  | `DesignCanvas.tsx`                                                                                    |
| B4: `NodeToolbar` e menu de contexto         | Feito  | `nodes/NodeActionsToolbar.tsx`, `CanvasContextMenu.tsx`                                               |
| B5: `maxZoom: 1` e posicionamento em espiral | Feito  | `lib/placement.ts`, action `placeNode`                                                                |
| B6: drag por touch                           | Feito  | `PaletteDnd.tsx` (`@dnd-kit/core`)                                                                    |
| CAN-05: atalhos                              | Feito  | `useCanvasShortcuts.ts` + `?` no AppShell (`ShortcutsDialog`)                                         |
| Painel "N items selected"                    | Feito  | `RightPanel.tsx` (`MultiSelectionPanel`)                                                              |
| Suíte Playwright B1–B6 + CAN-05              | Feito  | `tests/e2e/editor.spec.ts`                                                                            |
| Testes do store e da espiral                 | Feito  | `tests/unit/editor.test.ts`                                                                           |

### Decisões de implementação

- **Sensores do dnd-kit:** `MouseSensor` (ativa após 6 px, para cliques continuarem funcionando) + `TouchSensor` (segurar 180 ms, para a lista da paleta continuar rolando com o dedo). Os dois alimentam o mesmo `onDragEnd`, então o caminho do drop é único. O `PointerSensor` puro exigiria `touch-action: none` nas linhas da paleta e mataria a rolagem no touch.
- **Ponto do drop:** o `delta` do dnd-kit é ajustado pela rolagem da lista da paleta e desviou o drop em ~200 px num teste de touch. O provider rastreia a posição real do ponteiro/dedo durante o drag e usa essa posição.
- **Mobile:** ao começar um drag no drawer da biblioteca, o drawer fecha para o canvas aparecer. Tocar rápido na linha continua adicionando no centro (tap-to-add).
- **Atalhos:** os que editam a seleção ficam em `useCanvasShortcuts` (dentro do `ReactFlowProvider`, porque colar precisa de `screenToFlowPosition`); Delete é o único caminho e chama `deleteSelection()`. As setas movem 16 px (Shift = 64 px), e setas seguidas dentro de 600 ms viram um único passo de undo. Quando o foco está num nó, o próprio ReactFlow move o nó e o store registra o histórico do mesmo jeito.
- **Colar** usa a última posição do mouse sobre o canvas (ou o centro visível) e busca espaço livre em espiral para o grupo inteiro.
- **Read-only:** as actions do store recusam edição em tabs read-only por conta própria; o menu nessas tabs só oferece abrir no painel, copiar e selecionar tudo.
- **Renomear:** o painel Props ganhou um campo Label; "Rename" no menu abre o painel e foca esse campo.
- **Itens de specs futuras:** "Kill instance" ([Spec 08](08-chaos-engineering.md)) e "Auto-layout" ([Spec 13](13-editor-avancado.md)) aparecem desabilitados no menu com a tag "soon". A `NodeToolbar` não tem kill.
- **Long-press:** 500 ms parado (tolerância de 10 px) abre o menu no touch; um segundo dedo (pinça) cancela.

**Pan:** o diagnóstico original sugeria `panOnDrag={[1, 2]}` (meio e direito), mas o botão direito fica reservado para o menu de contexto (CAN-04). O patch usa `[1]` (meio), e o pan também funciona com Espaço+arrastar (`panActivationKeyCode` padrão do ReactFlow) e com scroll.

## Requisitos

1. **CAN-01 (P0)** Arrastar da paleta para qualquer ponto do canvas, inclusive sobre o empty state e sobre outros nós, com mouse e touch pelo mesmo caminho (pointer events).
2. **CAN-02 (P0)** Uma única fonte de seleção (`node.selected`/`edge.selected`) com seleção múltipla por Shift/⌘/Ctrl+clique e por caixa (arrastar no vazio).
3. **CAN-03 (P0)** Deletar a seleção por Delete/Backspace, pelo `NodeToolbar`, pelo menu de contexto e pelo painel. Tudo num único passo de undo e bloqueado em tabs read-only.
4. **CAN-04 (P0)** Menu de contexto. No nó: renomear, duplicar, réplicas ±, copiar/colar, kill/restore, abrir no painel e deletar. Na edge: sync/async, protocolo e deletar. No canvas: colar, adicionar nota e auto-layout.
5. **CAN-05 (P0)** Atalhos: ⌘C/⌘V/⌘D (copiar, colar, duplicar), ⌘A (selecionar tudo), setas para mover 16 px (Shift = 64 px), Espaço+arrastar para pan, `?` para abrir a lista de atalhos.
6. **CAN-06 (P0)** Posicionamento sem sobreposição no tap-add e no colar (busca em espiral) e `fitView` com `maxZoom: 1`.

Itens do menu de contexto que dependem de specs posteriores ficam desabilitados até lá: kill/restore ([Spec 08](08-chaos-engineering.md)) e auto-layout ([Spec 13](13-editor-avancado.md)).

## Design

### Seleção

- `node.selected`/`edge.selected` são a fonte de verdade. `selectedNodeId`/`selectedEdgeId` no store passam a ser derivados e, no fim da fase, podem sair do estado.
- `onSelectionChange` atualiza o painel: 1 nó → Props do nó; 1 edge → Props da edge; vários itens → "N itens selecionados" com ações em lote (deletar, duplicar); nada → painel vazio.

### Delete

Um único caminho, como pede o `CLAUDE.md`: `deleteKeyCode={null}` no ReactFlow e o handler do AppShell chamando `deleteSelection()`. `NodeToolbar`, menu de contexto e painel chamam a mesma action. A checagem de tab read-only vem antes, e a action faz um único push no histórico.

```ts
deleteSelection: () =>
  set((state) => {
    const nodeIds = new Set(state.nodes.filter((n) => n.selected).map((n) => n.id));
    const edgeIds = new Set(state.edges.filter((e) => e.selected).map((e) => e.id));
    if (nodeIds.size === 0 && edgeIds.size === 0) return state;
    return {
      history: pushedHistory(state),
      future: [],
      nodes: state.nodes.filter((n) => !nodeIds.has(n.id)),
      edges: state.edges.filter(
        (e) => !edgeIds.has(e.id) && !nodeIds.has(e.source) && !nodeIds.has(e.target)
      ),
      selectedNodeId: null,
      selectedEdgeId: null,
    };
  }),
```

### Copiar, colar e duplicar

- Clipboard interno no store (não persistido), com os nós selecionados e as edges entre eles.
- Colar gera ids novos, remapeia as edges e posiciona o grupo pela busca em espiral a partir do ponto do cursor (ou do centro do viewport).
- Duplicar = copiar + colar com deslocamento, num único passo de undo.
- Todos os atalhos no-op enquanto o foco está em input, como já acontece hoje.

### Posicionamento em espiral

A partir do ponto alvo, testa posições numa espiral quadrada com passo igual ao tamanho do nó mais margem, até achar um retângulo que não colide com nenhum nó existente. Com limite de tentativas; se estourar, usa o ponto alvo.

### Drag por pointer events

`@dnd-kit/core` substitui o drag HTML5 da paleta. O `DragOverlay` mostra o preview, e o drop converte a posição do ponteiro com `screenToFlowPosition`. O tap-to-add continua para quem prefere tocar. O `onDragOver`/`onDrop` HTML5 do wrapper sai quando o novo caminho estiver pronto.

### `NodeToolbar` e menu de contexto

- `NodeToolbar` do ReactFlow aparece sobre o nó selecionado (só com um nó): deletar, duplicar, réplicas ±, kill.
- Menu de contexto em `onNodeContextMenu`, `onEdgeContextMenu` e `onPaneContextMenu`, com os itens do CAN-04. Abre também por Shift+F10 no item focado (NFR de acessibilidade).
- No touch, long-press abre o mesmo menu. Visibilidade gated por `useIsCoarsePointer()`, não por `hover:`.
- Em tabs read-only, só aparecem ações que não editam (abrir no painel, copiar).

## Critérios de aceite

- [x] Os 6 testes E2E (B1–B6) passam
- [x] Apagar uma multi-seleção é desfeito com um único ⌘Z
- [x] Drop no centro do canvas vazio cria 1 nó
- [x] Delete funciona depois de arrastar um nó
- [x] Shift+clique em 2 nós + Delete apaga os 2
- [x] Nenhuma ação de edição funciona em tab read-only
- [x] Tap-add 10 vezes seguidas não gera nenhum nó sobreposto
- [x] Drag da paleta funciona com touch emulado
- [x] `npm run build` e `npm run lint` passam

## Testes (Playwright)

| Teste | Cenário                                                                          |
| ----- | -------------------------------------------------------------------------------- |
| B1    | Arrastar da paleta e soltar no centro do canvas vazio → 1 nó                     |
| B2    | Adicionar nó, arrastar, pressionar Delete → 0 nós; ⌘Z → 1 nó                     |
| B3    | 2 nós, Shift+clique nos dois, Delete → 0 nós; ⌘Z → 2 nós; seleção por caixa idem |
| B4    | Clique direito no nó → "Deletar" apaga; `NodeToolbar` → deletar apaga            |
| B5    | Primeiro nó com zoom ≤ 1; 10 tap-adds sem sobreposição de bounding box           |
| B6    | Contexto com `hasTouch`, drag por touch da paleta para o canvas → 1 nó           |
