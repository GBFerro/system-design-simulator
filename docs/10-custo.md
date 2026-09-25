# Spec 10: Custo

Parte da [v2](00-visao-geral.md) · Fase 5 · Status: rascunho

| Campo               | Valor                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Requisitos          | CST-01 a CST-03 (P1), CST-04 (P2), CST-05 (P0)                                                                                        |
| Depende de          | [Spec 03](03-catalogo-de-componentes.md) (`PricingSpec` no schema), [Spec 04](04-motor-de-simulacao.md) (`analyze()` para right-size) |
| Consumida por       | 09 (regra `cost`), 12 (quick fix de right-size)                                                                                       |
| Arquivos principais | `domain/components/schemas/*` (preços), `components/panel/CostPanel`, `scoring/rules/cost.ts`                                         |

## Objetivo

Mostrar quanto a arquitetura custa por mês e por milhão de requests, ao vivo, e usar esse valor no score contra o orçamento de cada problema.

**Nota de prioridade:** CST-05 é P0, mas depende de CST-01 (P1) para existir. Os dois entram juntos na Fase 5.

## Requisitos

1. **CST-01 (P1)** Cada tipo tem preço por instância/hora, base mensal e custo por milhão de requests. O total em $/mês e $/1M requests atualiza ao vivo.
2. **CST-02 (P1)** Breakdown por componente e por área, clicável para ver as premissas.
3. **CST-03 (P1)** Right-size: sugere réplicas para utilização de ~55% (mínimo de 2 por tier) e mostra a economia antes de aplicar.
4. **CST-04 (P2)** Fator por cloud (AWS, GCP, Azure) e moeda (USD, BRL, EUR).
5. **CST-05 (P0)** A regra de scoring `cost` passa a usar o $/mês contra o orçamento do problema.

## Design

### Modelo de preço

```ts
interface PricingSpec {
  perInstanceHour: number; // USD
  baseMonthly: number; // USD, custo fixo (ex.: LB, NAT)
  perMillionRequests: number; // USD
  perGbMonth?: number; // storage, quando houver param de tamanho
  assumptions: string; // texto curto mostrado no breakdown
}
```

```latex
\text{custo}_{mes} = \sum_{nós} \Big( \text{instâncias} \times \text{perInstanceHour} \times 730 + \text{baseMonthly} + \lambda \times 2{,}592 \times \text{perMillionRequests} \Big)
```

(730 h/mês; λ em req/s × 2.592.000 s/mês = requests/mês, que dividido por 10⁶ dá o fator 2,592.) O λ usado é o do `analyze()` na carga atual do slider.

- Os preços são aproximações de lista on-demand de uma região de referência, documentadas por tipo em `assumptions`. A UI deixa claro que são estimativas educativas, não cotação
- Uma única tabela de preços versionada, revisada a cada release; nada buscado ao vivo (sem backend)

### Painel de custo

- Total $/mês e $/1M requests na TopBar, atualizados a cada `analyze()` ou a 1 Hz durante o play
- Breakdown por componente e por área (compute, dados, rede, mensageria), com as premissas ao clicar

### Right-size (CST-03)

Para cada tier stateless: instâncias sugeridas = max(2, ⌈λ / (0,55 × capacidade por instância)⌉). Tiers stateful (DB, cache) só recebem sugestão, não aplicação automática. O painel mostra antes/depois ($/mês e utilização) e aplica como um único passo de undo. O mesmo cálculo alimenta o quick fix da [Spec 12](12-advisor.md).

### Orçamento e scoring (CST-05)

- Cada problema ganha `budgetMonthlyUsd` em `problems.ts`, calibrado pelo custo da solução de referência no pico de referência (ex.: referência × 1,3)
- Regra `cost` ([Spec 09](09-modo-entrevista-v2.md)): $/mês ≤ orçamento (12 pontos, com escala linear até 2× o orçamento) + nenhum nó alcançável com utilização < 15% (8 pontos, proporcional)
- Máximo exatamente 20, mínimo 0

### Cloud e moeda (CST-04)

Fator multiplicativo por cloud e taxa de câmbio fixa na tabela de preços, com a data da taxa visível.

## Critérios de aceite

- [ ] Todo schema tem `PricingSpec` com `assumptions`
- [ ] Total e breakdown atualizam ao mudar réplicas ou RPS
- [ ] Right-size aplica, mostra a economia e é desfeito com um ⌘Z
- [ ] A solução de referência de cada problema fica dentro do orçamento
- [ ] Regra `cost` soma exatamente 20 e nunca fica negativa

## Testes

- Vitest: custo de um grafo fixo contra valor calculado à mão
- Vitest: right-size nunca sugere menos de 2 instâncias por tier e mira ~55%
- Vitest: faixa da regra `cost` (0 a 20) para grafos vazio, referência, super-provisionado
