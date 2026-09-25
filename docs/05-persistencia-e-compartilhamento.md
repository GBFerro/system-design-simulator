# Spec 05: Persistência e compartilhamento

Parte da [v2](00-visao-geral.md) · Fase 1 (PER-01/02) e Fase 6 (PER-03) · Status: rascunho

| Campo               | Valor                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Requisitos          | PER-01 (P0), PER-02 (P0), PER-03 (P1), PER-04 (P2, fora de escopo)                                               |
| Depende de          | [Spec 03](03-catalogo-de-componentes.md) (formato de params e `EdgeRule`)                                        |
| Arquivos principais | `store/*` (persist), `store/safeStorage.ts`, `store/hydration.ts`, `lib/exportCanvas.ts`, `lib/loadReference.ts` |
| Dependências novas  | `idb-keyval` (Fase 1), `lz-string` (Fase 6)                                                                      |

## Objetivo

A v2 muda o formato dos nós e das arestas. Designs salvos, tabs e exports antigos precisam migrar sem perda, e o que cresce muito (histórico de execuções) sai do `localStorage`.

## Requisitos

1. **PER-01 (P0)** Schema versionado com `migrate` real (hoje é no-op). A v2 muda o formato dos nós, então designs antigos precisam migrar sem perda.
2. **PER-02 (P0)** Export/import JSON (envelope atual + `params`, `edge.rule`, `chaosScript`), PNG e SVG.
3. **PER-03 (P1)** Link compartilhável sem backend: design comprimido (lz-string) no hash da URL, com "fork" ao abrir.
4. **PER-04 (P2)** Galeria de designs da comunidade. Exige backend e fica fora da v2.

## Design

### Stores `version: 2`

As invariantes atuais continuam (`skipHydration: true`, `safeLocalStorage`, `rehydrateAllStores()` depois do mount). O que muda:

- `version: 2` em todos os stores persistidos
- `migrate(persisted, fromVersion)` real, com uma função pura por versão (`migrateV1toV2`) reaproveitada pelo import JSON e pelo link compartilhado
- `runtimeStore` e `chaosStore` ativo não são persistidos ([Spec 01](01-arquitetura-tecnica.md))

### Migração v1 → v2

| Item v1                                              | v2                                            |
| ---------------------------------------------------- | --------------------------------------------- |
| `node.data.maxQPS`                                   | `params.capacityPerInstance`                  |
| `node.data.latencyMs`                                | `params.serviceTimeMs`                        |
| `node.data.replicas`                                 | `params.instances`                            |
| Demais params                                        | Defaults do schema do tipo                    |
| Edge sem regra                                       | `rule.kind = "always"`, `callsPerRequest = 1` |
| Edge cache/CDN → qualquer                            | `rule.kind = "on_miss"`                       |
| `edge.data` (label/protocol/async)                   | Preservado                                    |
| `utilization`/`status`/`isBottleneck` em `node.data` | Removidos (vão para o `runtimeStore`)         |

A migração é idempotente e nunca lança exceção: um nó com tipo desconhecido é mantido como `custom` com um warning.

### Envelope de export/import

O envelope atual `{ schemaVersion, name, problemId, nodes, edges, strokes }` ganha:

```ts
{
  schemaVersion: 2,
  name, problemId, nodes, edges, strokes,
  chaosScript?: ChaosScript, // Spec 08
  slo?: SloOverrides,        // Spec 11
}
```

- `importDesign` aceita `schemaVersion` 1 e 2, roda `migrateV1toV2` quando preciso e continua devolvendo `{ ok, error? }`
- `nodes` carregam `params`; `edges` carregam `data` e `rule`
- Export SVG entra ao lado do PNG, pelo mesmo `html-to-image`

### IndexedDB

- `idb-keyval` guarda designs salvos e o histórico de execuções (séries temporais da [Spec 07](07-metricas-e-observabilidade.md), tentativas da [Spec 09](09-modo-entrevista-v2.md))
- Na primeira execução da v2, os designs salvos no `localStorage` são copiados para o IndexedDB e só removidos do `localStorage` depois da escrita confirmada
- Se o IndexedDB não estiver disponível (modo privado de alguns browsers), cai para o `localStorage` com toast de aviso, como o `safeLocalStorage` já faz

### Link compartilhável (PER-03)

- `#d=<lz-string.compressToEncodedURIComponent(JSON do envelope)>`
- Ao abrir, o design vai para uma tab nova (fork), sem sobrescrever nada; o hash é limpo depois do carregamento
- Validação idêntica à do import JSON; payload inválido mostra toast e não quebra o app
- Aviso quando a URL passar de ~8 KB (limite prático de alguns apps de chat)

## Critérios de aceite

- [ ] As 35 soluções de referência carregam migradas
- [ ] Um `localStorage` v1 real (fixture) abre na v2 sem perda de nós, edges, labels, protocolos, async e strokes
- [ ] Export JSON v2 → import devolve o mesmo grafo
- [ ] Import de um JSON v1 funciona
- [ ] Link compartilhado abre o mesmo design em outro browser (Fase 6)

## Testes

- Vitest: `migrateV1toV2` com fixtures (vazio, design pequeno, design com text nodes e strokes, edges para nós inexistentes)
- Vitest: idempotência (`migrate(migrate(x)) == migrate(x)`)
- Playwright: export → limpar storage → import
