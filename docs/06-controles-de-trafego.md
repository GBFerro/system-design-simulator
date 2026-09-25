# Spec 06: Controles de tráfego

Parte da [v2](00-visao-geral.md) · Fase 2 (TRF-01 a 03) e Fase 6 (TRF-04 a 06) · Status: rascunho

| Campo | Valor |
| --- | --- |
| Requisitos | TRF-01 a TRF-03 (P0), TRF-04 e TRF-05 (P1), TRF-06 (P2) |
| Depende de | [Spec 04](04-motor-de-simulacao.md) (loop de tick, `setTraffic`, `setSpeed`) |
| Arquivos principais | novo `engine/traffic/patterns.ts`, controles no painel Sim e na TopBar |

## Objetivo

Dar ao usuário controle do tempo e da carga: rodar, pausar, acelerar, mudar o RPS ao vivo e aplicar padrões como rampa, spike e onda diária.

## Requisitos

1. **TRF-01 (P0)** Play / pause / reset, velocidade 1×, 5× e 20× e tempo simulado visível.
2. **TRF-02 (P0)** Slider de RPS de 10 a 1M em escala logarítmica, que muda ao vivo durante a simulação.
3. **TRF-03 (P0)** Padrões de carga: constante, rampa, spike (×N por T segundos), onda diária e degraus.
4. **TRF-04 (P1)** Mix read/write e tipos de request (ex.: redirect 99% e create 1%) com caminhos diferentes pelo grafo.
5. **TRF-05 (P1)** Várias fontes de tráfego (web, mobile, parceiro) com RPS próprio.
6. **TRF-06 (P2)** Trilha de eventos gravada e reproduzível ("Black Friday": rampa → spike → falha de AZ).

## Design

### `TrafficPattern`

```ts
type TrafficPattern =
  | { kind: "constant"; rps: number }
  | { kind: "ramp"; fromRps: number; toRps: number; durationSec: number }
  | { kind: "spike"; baseRps: number; multiplier: number; startSec: number; durationSec: number }
  | { kind: "diurnal"; meanRps: number; amplitude: number; periodSec: number } // onda: mean × (1 + amplitude·sin)
  | { kind: "steps"; steps: { atSec: number; rps: number }[] };
```

- `patterns.ts` exporta `rateAt(pattern, tSec): number`, puro e testável
- As chegadas de cada tick são Poisson com média λ(t)·Δt, amostradas pelo PRNG com seed da [Spec 04](04-motor-de-simulacao.md)
- A onda diária usa `periodSec` comprimido (ex.: 24 h viram 240 s simulados) para caber na janela de 5 min

### Controles

- Barra com play/pause/reset, seletor 1×/5×/20× e relógio do tempo simulado (`mm:ss`)
- Slider logarítmico de RPS (10 → 1M), que chama `setTraffic` ao vivo; enquanto o usuário arrasta, o padrão vira `constant`
- Seletor de padrão com os campos de cada tipo e um preview em miniatura da curva λ(t)
- Atalhos: Espaço já é pan ([Spec 02](02-editor-confiavel.md)), então play/pause fica em `P`

### Mix e tipos de request (TRF-04)

- A fonte declara `requestTypes: { id, label, share, isWrite }[]` (ex.: `redirect` 0,99 leitura, `create` 0,01 escrita)
- As regras `reads`/`writes` da [Spec 03](03-catalogo-de-componentes.md) usam o mix; regras por tipo de request (`types: ["create"]`) entram como extensão da `EdgeRule`
- O amostrador de requests sintéticos sorteia o tipo antes de percorrer o grafo, então os percentis saem por tipo

### Várias fontes (TRF-05)

Cada nó `client` tem seu próprio padrão de carga e mix. O painel mostra a soma e cada fonte.

### Trilha de eventos (TRF-06)

Uma trilha é uma lista `{ atSec, action }`, em que `action` é mudar o padrão de tráfego ou injetar/curar um fault ([Spec 08](08-chaos-engineering.md)). Pode ser gravada a partir de uma execução manual e reproduzida com a mesma seed. É salva no envelope como `chaosScript` ([Spec 05](05-persistencia-e-compartilhamento.md)).

## Critérios de aceite

- [ ] Play/pause/reset e as três velocidades funcionam, com tempo simulado visível
- [ ] Mudar o slider durante o play altera o RPS no tick seguinte
- [ ] Os 5 padrões geram a curva esperada (preview e métricas batem)
- [ ] Um spike ×5 por 30 s enche a fila e ela se recupera depois
- [ ] (TRF-04) Com mix 99/1, o banco primary recebe ~1% das chamadas quando só writes vão para ele

## Testes

- Vitest: `rateAt` para cada padrão em pontos conhecidos (início, meio, fim, fora do intervalo)
- Vitest: média das chegadas Poisson ao longo de muitos ticks converge para λ
