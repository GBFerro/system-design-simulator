# Spec 13: Editor avançado

Parte da [v2](00-visao-geral.md) · Fase 6 · Status: rascunho

| Campo | Valor |
| --- | --- |
| Requisitos | CAN-07 a CAN-10 (P1), CAN-11 (P2) |
| Depende de | [Spec 02](02-editor-confiavel.md) (seleção única, menu de contexto, espiral) |
| Relacionada | [Spec 08](08-chaos-engineering.md) (falha de AZ/região usa grupos) |
| Arquivos principais | `components/canvas/`, `store/canvasStore.ts`, novo `lib/autoLayout.ts` |
| Dependências novas | `elkjs` (sob demanda) |

## Objetivo

Recursos de edição que deixam o diagrama mais legível e rápido de montar: auto-layout, grupos, criar nó a partir de uma aresta, passos numerados e validação de conexão.

## Requisitos

1. **CAN-07 (P1)** Auto-layout em camadas (ELK ou dagre, esquerda → direita, minimizando cruzamentos) com animação e undo.
2. **CAN-08 (P1)** Grupos/zonas (VPC, região, AZ) como `parentId` do ReactFlow. Chaos de AZ/região afeta todos os filhos do grupo.
3. **CAN-09 (P1)** Arrastar uma aresta para o vazio abre a paleta filtrada e cria o nó já conectado.
4. **CAN-10 (P1)** Passos numerados ①②③ nas arestas para narrar o request path (do ArchSim).
5. **CAN-11 (P2)** Validação de conexão com aviso não bloqueante (ex.: Client → DB direto).

## Design

### Auto-layout (CAN-07)

- `elkjs` com algoritmo `layered`, direção `RIGHT`, carregado por `import()` na primeira vez
- Entradas: nós de componente e arestas (text nodes mantêm a posição relativa ao nó mais próximo)
- Respeita grupos (layout hierárquico dentro de cada grupo)
- Animação de ~300 ms das posições antigas para as novas; `prefers-reduced-motion` aplica direto
- Um único push no histórico
- Acessível pelo menu de contexto do canvas ([Spec 02](02-editor-confiavel.md), CAN-04) e pelo ⌘K

### Grupos e zonas (CAN-08)

- Novo tipo de nó `group` com `kind: "vpc" | "region" | "az"` e label, registrado no `nodeTypes` module-level
- Filhos via `parentId` + `extent: "parent"`; arrastar um nó para dentro/fora do grupo muda o `parentId`
- Grupos não entram no `SimGraph`; o `compile` só guarda o mapa grupo → nós para os faults de AZ/região
- Persistidos normalmente; a migração v1 → v2 não cria grupos

### Aresta para o vazio (CAN-09)

`onConnectEnd` sem alvo abre um popover na posição do ponteiro com a paleta filtrada pelos tipos que fazem sentido a partir da origem (ex.: de App → cache, DB, fila, serviço). Escolher cria o nó ali e a aresta com a regra default, num único passo de undo.

### Passos numerados (CAN-10)

- Campo opcional `step?: number` em `edge.data`, editável no painel da aresta
- "Numerar request path" no menu de contexto numera o caminho síncrono mais provável a partir do entry point
- O número aparece como badge ①②③ no meio da aresta e é exportado no PNG/SVG

### Validação de conexão (CAN-11)

Tabela de pares desaconselhados (ex.: Client → DB, CDN → DB) com mensagem curta. Mostra um toast não bloqueante e, se o advisor estiver aberto, um finding `info` ([Spec 12](12-advisor.md)).

## Critérios de aceite

- [ ] Auto-layout reorganiza as 35 soluções de referência sem sobreposição e é desfeito com um ⌘Z
- [ ] Mover um grupo move os filhos; falha de AZ derruba todos os filhos do grupo
- [ ] Soltar uma aresta no vazio cria o nó conectado
- [ ] Passos numerados aparecem no canvas e no export
- [ ] Nada disso funciona em tab read-only, exceto visualizar

## Testes (Playwright)

- Auto-layout numa referência carregada: nenhum bounding box se sobrepõe; ⌘Z restaura as posições
- Arrastar nó para dentro de um grupo e mover o grupo
- Aresta solta no vazio → escolher "Cache" → 1 nó e 1 aresta novos
