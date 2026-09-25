# Spec 14: Estudo

Parte da [v2](00-visao-geral.md) · LRN-01 contínuo, LRN-02 a 04 na Fase 6 · Status: rascunho

| Campo               | Valor                                                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requisitos          | LRN-01 (P0), LRN-02 e LRN-03 (P1), LRN-04 (P2)                                                                                                                        |
| Depende de          | [Spec 03](03-catalogo-de-componentes.md) (componentes novos precisam de conceito), [Spec 05](05-persistencia-e-compartilhamento.md) (blueprints carregam como design) |
| Arquivos principais | `data/conceptLibrary.ts`, `data/tradeoffCards.ts`, `data/learningPath.ts`, `data/problems.ts`, `components/sidebar/`                                                  |

## Objetivo

Manter o que o SystemForge já tem de estudo e completar com quiz, números de referência, guias por problema e blueprints de padrões.

## Requisitos

1. **LRN-01 (P0)** Manter a concept library, os trade-off cards e o learning path.
2. **LRN-02 (P1)** Quiz por conceito (múltipla escolha, correção instantânea) e aba Numbers (latências de referência, capacidade por instância, 1M/dia ≈ 12 rps).
3. **LRN-03 (P1)** Cada problema linka um guia curto (framework, estimativa, deep dive, falhas) e seu blueprint, no estilo SysSimulator.
4. **LRN-04 (P2)** Blueprints de padrões: CQRS, saga (orquestração vs coreografia), outbox, strangler fig, BFF.

## Regras de conteúdo (do `CLAUDE.md`)

- Todo id de componente citado em conteúdo existe em `components.ts`
- Pré-requisitos do learning path são conceitos ensinados por um problema estritamente anterior
- O conteúdo ensina candidatos: toda fórmula, número, formato de API e atribuição tem que estar correta

## Design

### Manutenção (LRN-01)

A cada spec que muda o catálogo ou o motor, a concept library é atualizada no mesmo PR: componentes novos da [Spec 03](03-catalogo-de-componentes.md) ganham conceito; conceitos que citam o comportamento antigo do simulador (ex.: fan-out 100%) são corrigidos.

### Quiz (LRN-02)

```ts
interface QuizQuestion {
  id: string;
  conceptId: string; // chave da conceptLibrary
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string; // mostrada depois da resposta
}
```

- Novo arquivo `data/quiz.ts`, com 3 a 5 perguntas por conceito
- Correção instantânea com a explicação; acertos por conceito guardados localmente
- Entrada pela concept library ("Testar este conceito") e por uma aba Quiz no sidebar

### Numbers (LRN-02)

Aba de referência rápida com:

- Latências de referência (L1, RAM, SSD, rede na mesma AZ, entre regiões) com a fonte citada
- Capacidade típica por instância que o simulador usa como default (vinda dos schemas da [Spec 03](03-catalogo-de-componentes.md), para ficar consistente)
- Conversões de estimativa: 1M/dia ≈ 11,6 rps (≈ 12), 1 dia ≈ 86.400 s ≈ 10⁵ s, fator de pico típico
- Mini calculadora reaproveitada da fase de estimativa ([Spec 09](09-modo-entrevista-v2.md))

### Guias por problema (LRN-03)

- `problems.ts` ganha `guide: { framework, estimation, deepDive, failures }` em texto curto, derivado do que já existe em `interviewData.ts` (estimativas, follow-ups) para não duplicar
- O blueprint de cada problema é a solução de referência, aberta em tab read-only (como hoje)

### Blueprints de padrões (LRN-04)

Cinco designs de referência independentes de problema (CQRS, saga orquestrada e coreografada, outbox, strangler fig, BFF), cada um com um texto curto de quando usar e o trade-off principal. Respeitam a regra de não repetir `componentId` numa mesma solução de referência, ou ganham um loader que não dependa disso.

## Critérios de aceite

- [ ] Todos os componentes da paleta têm entrada na concept library
- [ ] Cada conceito do learning path tem pelo menos 3 perguntas de quiz
- [ ] Os números da aba Numbers batem com os defaults dos schemas
- [ ] Os 35 problemas linkam guia e blueprint
- [ ] Script de validação cruzada de ids passa (conceitos, quiz, learning path, problemas)

## Testes

- Vitest: todo `conceptId` do quiz existe; `correctIndex` dentro de `options`
- Vitest: pré-requisitos do learning path respeitam a ordem
