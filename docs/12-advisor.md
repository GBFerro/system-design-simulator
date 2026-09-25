# Spec 12: Advisor

Parte da [v2](00-visao-geral.md) · Fase 3 (ADV-03) e Fase 5 (ADV-01/02) · Status: rascunho

| Campo | Valor |
| --- | --- |
| Requisitos | ADV-03 (P0), ADV-01 e ADV-02 (P1) |
| Depende de | `scoring/` (`ScoringGraph`), [Spec 04](04-motor-de-simulacao.md) (`analyze()`), [Spec 10](10-custo.md) (right-size) |
| Relacionada | [Spec 08](08-chaos-engineering.md) (CHS-06 usa os mesmos quick fixes) |
| Arquivos principais | novo `advisor/` (rules, fixes), `components/panel/AdvisorPanel`, `store/canvasStore.ts` |

## Objetivo

Transformar o feedback do score em findings acionáveis: cada problema encontrado tem severidade, explicação e, quando possível, um quick fix que edita o grafo com preview e undo.

## Requisitos

1. **ADV-01 (P1)** Findings por severidade (crítico, aviso, info) gerados a partir das regras de scoring e das métricas da última execução.
2. **ADV-02 (P1)** Cada finding tem um quick fix que edita o grafo (inserir LB, cache, fila, réplica, rate limiter) com preview e undo, além de "aplicar todos".
3. **ADV-03 (P0)** Hints de estrutura: sem entry point, nó desconectado, SPOF (tier com 1 instância e sem réplica).

## Design

### Finding

```ts
interface Finding {
  id: string;                  // estável por regra + alvo, para deduplicar
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;              // por que importa, com números da última execução quando houver
  targetIds: string[];         // nós/arestas para destacar e focar
  source: "structure" | "scoring" | "metrics" | "chaos";
  fix?: QuickFix;
}

interface QuickFix {
  label: string;               // "Adicionar LB na frente de App (3 instâncias)"
  preview(graph: CanvasGraph): GraphDiff;  // puro
}
```

### Hints de estrutura (ADV-03, Fase 3)

Calculados sobre o `ScoringGraph` que o `scorer.ts` já monta, sem depender do motor:

| Hint | Severidade | Regra |
| --- | --- | --- |
| Sem entry point | Crítico | Nenhum nó com in-degree 0 e saída (ou nenhum `client`) |
| Nó desconectado | Aviso | Nó de componente fora do conjunto alcançável a partir dos entry points |
| SPOF | Aviso | Nó alcançável no caminho síncrono com `instances = 1` e sem réplica/LB em paralelo |

Aparecem como lista no painel e como marcador discreto no nó afetado. Clicar foca o nó.

### Findings por métricas e scoring (ADV-01)

Exemplos:

- Utilização > 80% no pico → aviso, fix "aumentar instâncias" ou "right-size"
- Leitura pesada no DB sem cache → aviso, fix "inserir cache entre App e DB"
- Chamada síncrona a serviço lento → aviso, fix "tornar async com fila"
- Sem rate limiter na borda com tráfego público → info, fix "inserir rate limiter"
- Utilização < 15% → info, fix "right-size" ([Spec 10](10-custo.md))
- Cada ponto perdido no score vira um finding com a mesma explicação do relatório ([Spec 09](09-modo-entrevista-v2.md))

### Quick fix (ADV-02)

- `preview` devolve um `GraphDiff` (nós/arestas a adicionar, remover e alterar) que a UI desenha em modo fantasma sobre o canvas
- Aplicar = uma action do `canvasStore` que aplica o diff com **um** push no histórico
- "Aplicar todos" aplica os fixes em sequência, sem conflito (fixes que tocam os mesmos nós são aplicados em ordem de severidade e recalculados), também como um único passo de undo
- Inserir entre A e B: remove a aresta A → B, cria o nó novo posicionado entre os dois (busca em espiral da [Spec 02](02-editor-confiavel.md)) e cria A → novo → B com as regras default da [Spec 03](03-catalogo-de-componentes.md)
- Bloqueado em tabs read-only

## Critérios de aceite

- [ ] (Fase 3) Os três hints de estrutura aparecem e somem quando corrigidos
- [ ] Quick fix mostra preview antes de aplicar
- [ ] Quick fix e "aplicar todos" são desfeitos com um único ⌘Z
- [ ] Aplicar o fix de um finding faz o finding sumir na próxima análise
- [ ] Nenhum finding aparece para a solução de referência que não seja `info`

## Testes

- Vitest: hints de estrutura para grafos vazio, desconectado, com SPOF e referência
- Vitest: `preview` é puro e o grafo resultante passa na validação do `compile`
