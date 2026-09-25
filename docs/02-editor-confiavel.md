# Spec 02: Editor confiável

Parte da [v2](00-visao-geral.md) · Fase 0 · Tamanho P · Status: parcialmente implementado (commit `15ee9b7`)

| Campo | Valor |
| --- | --- |
| Requisitos | B1–B6, CAN-01 a CAN-06 (todos P0) |
| Depende de | Nada. É o primeiro PR da v2 |
| Arquivos principais | `components/canvas/DesignCanvas.tsx`, `components/sidebar/ComponentPalette.tsx`, `components/layout/app-shell.tsx`, `store/canvasStore.ts` |
| Dependências novas | `@dnd-kit/core`, `@playwright/test` (dev) |

## Objetivo

Deixar o editor confiável antes de qualquer mudança no motor: arrastar da paleta funciona em qualquer ponto e em qualquer dispositivo, a seleção tem uma fonte só, e apagar, copiar, colar e duplicar funcionam por teclado, toolbar, menu de contexto e painel.

## Diagnóstico

Os bugs foram reproduzidos no Chromium headless (Playwright) contra a `main` de 25/09/2026.

| Bug | Sintoma reproduzido | Causa raiz | Correção |
| --- | --- | --- | --- |
| B1 Drop falha no canvas vazio | Soltar no centro: 0 nós. Soltar no canto: 1 nó | O empty state (`motion.div` com `pointer-events-auto`) fica sobre o pane e não tem `onDragOver`/`onDrop`, então o browser rejeita o drop | Mover `onDragOver`/`onDrop` do `<ReactFlow>` para o `div` wrapper (`reactFlowWrapper`), que é pai do overlay |
| B2 Delete não funciona após arrastar | Após arrastar, o nó aparece `.selected`, mas Delete/Backspace não faz nada | Duas fontes de seleção: `node.selected` (ReactFlow) e `selectedNodeId` (store), que só é atualizado em `onNodeClick`. Com `snapToGrid` o clique vira drag e o `onNodeClick` não dispara | Usar `node.selected`/`edge.selected` como fonte única, derivar o painel via `onSelectionChange` e criar `deleteSelection()` com um único push no histórico |
| B3 Multi-seleção quebrada | Shift+clique em 2 nós seleciona 1; Delete apaga 1 | O `multiSelectionKeyCode` padrão do ReactFlow é Meta/Ctrl, e o store só guarda 1 id | `multiSelectionKeyCode={["Shift","Meta","Control"]}` + `selectionOnDrag` + pan com o botão do meio |
| B4 Delete escondido | Só há botão de delete na aba Props do painel direito, que no tablet já abre fechado. Não há menu de contexto | Faltam affordances | `NodeToolbar` ao selecionar + menu de clique direito em nó, edge e canvas |
| B5 Nós gigantes e sobrepostos | O primeiro nó aparece em zoom 2×; o tap-add empilha nós no centro com ±30 px de jitter | O `fitView` roda ao inicializar o primeiro nó com `maxZoom` padrão 2; o posicionamento não detecta colisão | `fitViewOptions={{ maxZoom: 1 }}` e posicionar em espiral até achar espaço livre |
| B6 Drag não existe no touch | No mobile só dá para tocar para adicionar | O drag and drop HTML5 não funciona com touch | Trocar por drag baseado em pointer events (`@dnd-kit/core`), com um único caminho para mouse e touch |

## Status atual

O commit `15ee9b7` (branch `fix/editor-drop-and-delete`) aplicou o patch mínimo:

| Item | Status |
| --- | --- |
| B1: `onDragOver`/`onDrop` no wrapper | Feito |
| B2: `deleteSelection()` no store + AppShell chamando a action | Feito |
| B2: `onSelectionChange` sincronizando o painel | Feito |
| B3: `multiSelectionKeyCode`, `selectionOnDrag`, `panOnDrag={[1]}`, `panOnScroll` | Feito |
| B5: `fitViewOptions={{ maxZoom: 1, padding: 0.2 }}` | Feito |
| B5: posicionamento em espiral | Pendente |
| B4: `NodeToolbar` e menu de contexto | Pendente |
| B6: drag por pointer events (`@dnd-kit/core`) | Pendente |
| CAN-05: atalhos de copiar/colar/duplicar/mover | Pendente |
| `selectedNodeId` derivado + painel "N itens selecionados" | Pendente |
| Suíte Playwright | Pendente |

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

- [ ] Os 6 testes E2E (B1–B6) passam
- [ ] Apagar uma multi-seleção é desfeito com um único ⌘Z
- [ ] Drop no centro do canvas vazio cria 1 nó
- [ ] Delete funciona depois de arrastar um nó
- [ ] Shift+clique em 2 nós + Delete apaga os 2
- [ ] Nenhuma ação de edição funciona em tab read-only
- [ ] Tap-add 10 vezes seguidas não gera nenhum nó sobreposto
- [ ] Drag da paleta funciona com touch emulado
- [ ] `npm run build` e `npm run lint` passam

## Testes (Playwright)

| Teste | Cenário |
| --- | --- |
| B1 | Arrastar da paleta e soltar no centro do canvas vazio → 1 nó |
| B2 | Adicionar nó, arrastar, pressionar Delete → 0 nós; ⌘Z → 1 nó |
| B3 | 2 nós, Shift+clique nos dois, Delete → 0 nós; ⌘Z → 2 nós; seleção por caixa idem |
| B4 | Clique direito no nó → "Deletar" apaga; `NodeToolbar` → deletar apaga |
| B5 | Primeiro nó com zoom ≤ 1; 10 tap-adds sem sobreposição de bounding box |
| B6 | Contexto com `hasTouch`, drag por touch da paleta para o canvas → 1 nó |
