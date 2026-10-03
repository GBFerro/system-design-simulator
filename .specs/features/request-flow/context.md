# Fluxo da requisição — Context

**Gathered:** 2026-10-03
**Spec:** `.specs/features/request-flow/spec.md`
**Status:** Ready for design

---

## Feature Boundary

Uma aresta A → B passa a ser lida como uma chamada que A faz a B, com ida e, se síncrona, volta. Quem chama decide o que chamar, em que condição (inclusive "depois de um miss no cache") e em que ordem. O canvas mostra a resposta voltando, e a aba Fluxo mostra uma requisição inteira como diagrama de sequência.

---

## Implementation Decisions

### Escopo

- Visual e modelo de chamadas na mesma spec: ida e volta no canvas, async distinto, ordem numerada e chamadas condicionais do lado de quem chama (look-aside), com passos em sequência ou em paralelo.
- Exige migrar as referências com `cache → banco`, o fix "add cache" do advisor e o padrão de conexão.

### Visualização

- Canvas: bola de requisição na ida, bola de resposta (outra forma e cor) na volta, chamadas async sem volta.
- Painel "Trace" (aba Fluxo): diagrama de sequência de uma requisição de leitura ou de escrita, com passos numerados, hit/miss e o tempo de cada passo.

---

### Cache look-aside

- App → Cache; se a chamada ao cache der miss ou falhar, App → Banco. Nada sai do cache para o banco.

### Limites

- 8 chamadas por aresta e passo de 1 a 20, como as constantes `MAX_EDGE_CALLS` e `MAX_CALL_STEP` em `domain/graph/edgeRules.ts`. Mudar o limite é trocar um número num lugar só (FLW-49).

## Agent's Discretion

Nenhuma: todas as premissas da spec foram confirmadas em 2026-10-03.

## Deferred Ideas

- Estratégias de escrita no cache (write-through, write-back, invalidação).
- Rever o SPOF de cache look-aside no scorer e no advisor.
- Exportar o diagrama de sequência.
