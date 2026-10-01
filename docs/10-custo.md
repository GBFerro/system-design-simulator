# Spec 10: Custo

Parte da [v2](00-visao-geral.md) · Fase 5 · Status: implementada (Fase 5, PR 1)

| Campo               | Valor                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Requisitos          | CST-01 a CST-03 (P1), CST-04 (P2), CST-05 (P0)                                                                                            |
| Depende de          | [Spec 03](03-catalogo-de-componentes.md) (`PricingSpec` no schema), [Spec 04](04-motor-de-simulacao.md) (`analyze()` para right-size)     |
| Consumida por       | 09 (regra `cost`), 12 (quick fix de right-size)                                                                                           |
| Arquivos principais | `domain/components/pricing.ts` (preços), `cost/` (modelo puro), `components/panel/CostPanel`, `components/cost/`, `scoring/rules/cost.ts` |

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
- Uma única tabela de preços versionada, revisada a cada release (o `asOf` e as fontes em `PRICE_TABLE.sources`, links para as páginas oficiais de preço, que a aba Cost mostra no rodapé); nada buscado ao vivo (sem backend)

Implementação: a tabela fica em `domain/components/pricing.ts` (`PRICE_TABLE`: versão, data dos preços e região, AWS us-east-1 on-demand, 2025-09) e entra em todo schema por `defineSchema`/`genericSchema`; componentes customizados usam o preço de uma m5.large. `cost/estimate.ts` aplica a fórmula com o λ de cada nó (no painel, o `rpsIn` do último snapshot; no score, o `offeredRps` do `analyze()` no pico). O DNS só paga as consultas sem cache (`lookupShare`), como no motor. `perGbMonth` fica no tipo, mas nenhum tipo tem parâmetro de tamanho ainda: storage e transferência de dados aparecem nas premissas como "não modelados".

### Painel de custo

- Total $/mês na TopBar ($/1M requests no tooltip), atualizado a cada `analyze()` ou a 1 Hz durante o play. O chip só aparece a partir de 1680 px: abaixo disso o seletor de problema fica com menos de 80 px (`smoke.spec.ts` mede a TopBar de 768 a 1920 px); a aba Cost tem os mesmos números
- Breakdown por componente e por área (compute, dados, rede, mensageria), com as premissas ao clicar

### Right-size (CST-03)

Para cada tier stateless: instâncias sugeridas = max(2, ⌈λ / (0,45 × capacidade por instância)⌉).

**Desvio:** o alvo era ~55%, mas a rubrica da [Spec 09](09-modo-entrevista-v2.md) exige que o design aguente 2× o pico abaixo da saturação; com 55% no pico, o surge 2× roda a 110% e o próprio right-size derrubaria o score de scalability. Com 45%, o surge fica em 90%. Tiers stateful (DB, cache) só recebem sugestão, não aplicação automática. O painel mostra antes/depois ($/mês e utilização) e aplica como um único passo de undo. O mesmo cálculo alimenta o quick fix da [Spec 12](12-advisor.md).

### Orçamento e scoring (CST-05)

- Cada problema ganha `budgetMonthlyUsd` em `problems.ts`, calibrado pelo custo da solução de referência no pico de referência × 1,3, arredondado para cima em dois algarismos significativos (`data.test.ts` exige a referência entre orçamento/1,5 e orçamento/1,3)
- Numa entrevista medida acima do pico de referência, o orçamento escala na mesma proporção; problema sem orçamento (customizado antigo) não ganha esses pontos e o feedback diz por quê
- Regra `cost` ([Spec 09](09-modo-entrevista-v2.md)): $/mês ≤ orçamento (12 pontos, com escala linear até 2× o orçamento, arredondada para baixo: qualquer estouro perde pelo menos 1 ponto) + nenhum nó alcançável com utilização < 15% (8 pontos, proporcional). Os checks estruturais antigos (contagem de componentes, CDN, fila etc.) saem: o preço já mede isso
- Máximo exatamente 20, mínimo 0

### Cloud e moeda (CST-04)

Fator multiplicativo por cloud e taxa de câmbio fixa na tabela de preços, com a data da taxa visível.

**Implementado só a moeda** (USD, BRL, EUR, em `cost/currency.ts`, com a taxa e a data visíveis no painel; a escolha persiste no `appStore`). O fator por cloud ficou de fora: o preço de lista de VMs de uso geral equivalentes é praticamente igual nas três (m5.large, n2-standard-2 e D2s v5 custam ≈ $0,096/h), e as diferenças reais estão nos serviços gerenciados, que um fator único distorceria.

## Critérios de aceite

- [x] Todo schema tem `PricingSpec` com `assumptions`
- [x] Total e breakdown atualizam ao mudar réplicas ou RPS
- [x] Right-size aplica, mostra a economia e é desfeito com um ⌘Z
- [x] A solução de referência de cada problema fica dentro do orçamento
- [x] Regra `cost` soma exatamente 20 e nunca fica negativa

## Testes

- Vitest: custo de um grafo fixo contra valor calculado à mão
- Vitest: right-size nunca sugere menos de 2 instâncias por tier e mira ~45%
- Vitest: faixa da regra `cost` (0 a 20) para grafos vazio, referência, super-provisionado
- Playwright (`cost.spec.ts`): custo acompanha réplicas e carga, breakdown com premissas, right-size com um ⌘Z, orçamento da referência e aba read-only
