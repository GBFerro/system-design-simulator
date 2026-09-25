# Spec 11: SLOs e error budget

Parte da [v2](00-visao-geral.md) · Fase 5 · Status: rascunho

| Campo | Valor |
| --- | --- |
| Requisitos | SLO-01 a SLO-03 (P1) |
| Depende de | [Spec 07](07-metricas-e-observabilidade.md) (métricas globais), [Spec 08](08-chaos-engineering.md) (faults) |
| Consumida por | 07 (alerta de burn rate), 09 (regras latency/availability e relatório) |
| Arquivos principais | `data/problems.ts` (SLOs), `components/panel/SloPanel`, `scoring/rules/latency.ts`, `scoring/rules/availability.ts` |

## Objetivo

Dar a cada problema metas mensuráveis (latência e disponibilidade), mostrar o consumo do error budget durante o chaos e usar os valores medidos no score.

## Requisitos

1. **SLO-01 (P1)** Cada problema declara SLOs (ex.: p99 < 100 ms, disponibilidade 99,9%), que o usuário pode editar.
2. **SLO-02 (P1)** Barra de error budget com burn rate durante o chaos e veredito final "SLO cumprido / violado".
3. **SLO-03 (P1)** A regra de scoring `latency`/`availability` passa a usar os valores medidos em vez de heurísticas.

## Design

### Declaração

```ts
interface Slo {
  latency: { percentile: 50 | 95 | 99; thresholdMs: number };
  availability: number;       // ex.: 0.999
  windowSec: number;          // janela da execução, default 300 (5 min simulados)
}
```

- `problems.ts` ganha `slo` por problema, coerente com as restrições já descritas no problema (ex.: se o enunciado pede "redirect < 100 ms p99", o SLO é esse)
- O usuário pode sobrescrever o SLO por design; o override vai no envelope ([Spec 05](05-persistencia-e-compartilhamento.md)). No modo entrevista, vale o SLO do problema

### Error budget e burn rate

- Um request conta como "ruim" se falhou ou passou do limite de latência do SLO. O goodput da [Spec 07](07-metricas-e-observabilidade.md) é exatamente o complemento disso
- Budget da janela = (1 − availability) × requests na janela
- Burn rate = (fração de requests ruins na janela curta) ÷ (1 − availability). Burn rate 1 consome o budget exatamente no fim da janela
- Janela curta de 30 s simulados para o burn rate exibido; alerta quando passa de 10× (usado pela OBS-07)

### UI

- Barra de budget restante no painel SLO e compacta na TopBar durante o play
- Gráfico de burn rate com os marcadores de fault
- Veredito no fim da execução ou do drill: "SLO cumprido" ou "SLO violado", com o momento da quebra

### Scoring (SLO-03)

Substitui as heurísticas atuais das regras `latency` e `availability` pelos valores medidos, seguindo a rubrica da [Spec 09](09-modo-entrevista-v2.md):

- Latency: p99 medido no pico ≤ limite do SLO (12), p50 (4), caminho síncrono sem hops desnecessários (4)
- Availability: sem SPOF alcançável (6), disponibilidade medida ≥ SLO (10), degradação graciosa (4)

## Critérios de aceite

- [ ] Os 35 problemas têm SLO coerente com o enunciado
- [ ] Budget e burn rate reagem a um fault e param de cair depois do heal
- [ ] SLO violado aparece no relatório da entrevista
- [ ] Regras `latency` e `availability` somam exatamente 20 e nunca ficam negativas

## Testes

- Vitest: burn rate com fração de erro conhecida (ex.: 1% de erro com SLO 99,9% → burn rate 10)
- Vitest: veredito para execuções sintéticas acima e abaixo do SLO
