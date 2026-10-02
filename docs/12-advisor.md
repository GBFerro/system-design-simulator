# Spec 12: Advisor

Parte da [v2](00-visao-geral.md) · Fase 3 (ADV-03) e Fase 5 (ADV-01/02) · Status: implementada (ADV-03 na Fase 3; ADV-01/02 na Fase 5, PR 3)

| Campo               | Valor                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Requisitos          | ADV-03 (P0), ADV-01 e ADV-02 (P1)                                                                                   |
| Depende de          | `scoring/` (`ScoringGraph`), [Spec 04](04-motor-de-simulacao.md) (`analyze()`), [Spec 10](10-custo.md) (right-size) |
| Relacionada         | [Spec 08](08-chaos-engineering.md) (CHS-06 usa os mesmos quick fixes)                                               |
| Arquivos principais | novo `advisor/` (rules, fixes), `components/panel/AdvisorPanel`, `store/canvasStore.ts`                             |

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
  id: string; // estável por regra + alvo, para deduplicar
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string; // por que importa, com números da última execução quando houver
  targetIds: string[]; // nós/arestas para destacar e focar
  source: "structure" | "scoring" | "metrics" | "chaos";
  fix?: QuickFix;
}

interface QuickFix {
  label: string; // "Adicionar LB na frente de App (3 instâncias)"
  preview(graph: CanvasGraph): GraphDiff; // puro
}
```

### Hints de estrutura (ADV-03, Fase 3)

Calculados sobre o `ScoringGraph` que o `scorer.ts` já monta, sem depender do motor:

| Hint            | Severidade | Regra                                                                              |
| --------------- | ---------- | ---------------------------------------------------------------------------------- |
| Sem entry point | Crítico    | Nenhum nó com in-degree 0 e saída (ou nenhum `client`)                             |
| Nó desconectado | Aviso      | Nó de componente fora do conjunto alcançável a partir dos entry points             |
| SPOF            | Aviso      | Nó alcançável no caminho síncrono com `instances = 1` e sem réplica/LB em paralelo |

Na implementação, "SPOF" usa a mesma noção de redundância do scorer (regra de disponibilidade): tiers que escalam horizontalmente (`scalable` no catálogo) não são marcados, só tiers stateful de escritor único (SQL, lock distribuído) com uma instância, sem cópia em paralelo sob o mesmo chamador nem read replica ligada. Client, DNS, CDN e object storage são redundantes por construção. Assim o Advisor e a aba Score nunca se contradizem.

Aparecem como lista no painel e como marcador discreto no nó afetado. Clicar foca o nó.

### Findings por métricas e scoring (ADV-01)

Exemplos:

- Utilização > 80% no pico → aviso, fix "aumentar instâncias" ou "right-size"
- Leitura pesada no DB sem cache → aviso, fix "inserir cache entre App e DB"
- Chamada síncrona a serviço lento → aviso, fix "tornar async com fila"
- Sem rate limiter na borda com tráfego público → info, fix "inserir rate limiter"
- Utilização < 15% → info, fix "right-size" ([Spec 10](10-custo.md))
- Cada ponto perdido no score vira um finding com a mesma explicação do relatório ([Spec 09](09-modo-entrevista-v2.md))

Implementação (`advisor/`, tudo puro; `store/advisorStore.ts` junta as entradas):

| Finding (id)            | Fonte     | Severidade                  | Regra                                                                                                                                             | Quick fix                                                                                                       |
| ----------------------- | --------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `hot:<nó>`              | metrics   | aviso ≥ 80%, crítico ≥ 100% | carga da execução ÷ capacidade ATUAL (instâncias × capacidade por instância; DNS só as consultas sem cache), o `PEAK_UTILIZATION` do scorer       | stateless: escalar para o right-size (~45% nessa carga); stateful: sem fix (move dados), o texto explica        |
| `idle:<nó>`             | metrics   | info                        | a checagem de over-provisioning do scorer (≥ 3 instâncias e ociosa abaixo de 15% mesmo com uma a menos)                                           | stateless: reduzir para o right-size                                                                            |
| `rate-limit`            | metrics   | info                        | há tráfego e nada o limita (sem rate limiter, sem gateway com throttling)                                                                         | ligar o throttling do API gateway, ou inserir um rate limiter onde o tráfego sai da borda (limite = 2× a carga) |
| `read-cache:<db>`       | structure | aviso                       | leitura ≥ 70% (mix do problema, senão o `readRatio` do Client), SQL/NoSQL no caminho síncrono, nenhum cache em linha nem look-aside               | cache look-aside: chamador → cache (`reads`), cache → DB (`on_miss`), chamador → DB vira `writes`               |
| `async:<aresta>`        | structure | aviso                       | aresta síncrona no caminho para trabalho adiável (worker pool, notificação, scheduler, stream processor, data warehouse) com service time ≥ 50 ms | inserir uma fila entre os dois                                                                                  |
| `score:<categoria>:<i>` | scoring   | info                        | cada feedback do último score, enquanto o design for o mesmo que foi pontuado                                                                     | —                                                                                                               |

A carga é a média do `rpsIn` por nó nos últimos 5 s simulados da execução (lida no máximo 1×/s), ou o snapshot do Simulate sozinho. Como a utilização usa a capacidade atual, aplicar um fix de instâncias some com o finding na hora; os que mudam o roteamento (cache, fila) somem pela estrutura. Os limiares são os do scorer e o dimensionamento é o do right-size ([Spec 10](10-custo.md)), então Advisor, Score e Cost concordam. O badge da aba conta só avisos e críticos.

### Quick fix (ADV-02)

- `preview` devolve um `GraphDiff` (nós/arestas a adicionar, remover e alterar) que a UI desenha em modo fantasma sobre o canvas. Na implementação os ids vêm do finding e do grafo (nunca aleatórios), então o preview é exatamente o que será aplicado; os fantasmas (`components/canvas/previewGraph.ts`) só existem no que o ReactFlow desenha, nunca no `canvasStore`: nós e arestas novos tracejados em violeta, arestas removidas tracejadas em rosa, nós alterados com um chip ("×1 → ×2") fora da caixa. Esc ou sair da aba encerram o preview
- Aplicar = uma action do `canvasStore` que aplica o diff com **um** push no histórico (`applyGraphEdit`: a edição é calculada dentro do `set`, a partir do grafo atual)
- "Aplicar todos" aplica os fixes em sequência, sem conflito (fixes que tocam os mesmos nós são aplicados em ordem de severidade e recalculados), também como um único passo de undo
- Inserir entre A e B: remove a aresta A → B, cria o nó novo posicionado entre os dois (busca em espiral da [Spec 02](02-editor-confiavel.md)) e cria A → novo → B com as regras default da [Spec 03](03-catalogo-de-componentes.md)
- Bloqueado em tabs read-only

## Critérios de aceite

- [x] (Fase 3) Os três hints de estrutura aparecem e somem quando corrigidos
- [x] Quick fix mostra preview antes de aplicar
- [x] Quick fix e "aplicar todos" são desfeitos com um único ⌘Z
- [x] Aplicar o fix de um finding faz o finding sumir na próxima análise
- [x] Nenhum finding aparece para a solução de referência que não seja `info`

## Testes

- Vitest: hints de estrutura para grafos vazio, desconectado, com SPOF e referência
- Vitest: `preview` é puro e o grafo resultante passa na validação do `compile`
- Vitest: cada finding com fix some depois de aplicado (o cache reduz a carga do DB, a fila tira o worker do p99); "aplicar todos" não deixa fix pendente; as 35 referências só têm findings `info` no pico e seus fixes compilam
- Playwright (`advisor.spec.ts`): preview com fantasmas, aplicar e desfazer em um passo, "aplicar todos" e desfazer
