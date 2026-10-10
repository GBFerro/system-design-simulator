# Interface guiada e ida/volta — Context

**Gathered:** 2026-10-08
**Spec:** `.specs/features/guided-ui/spec.md`
**Status:** Ready for design

---

## Feature Boundary

Duas mudanças de interface, sem mexer no motor nem na rubrica:

1. O app passa a ser usado em passos, num wizard: no modo livre, Problema → Desenhar → Simular → Falhas → Avaliar; no modo entrevista, as 6 fases, com as fases 1–4 em tela cheia. Cada passo mostra só as ferramentas dele, no lugar das 10 abas do painel direito.
2. A ida e a volta de uma chamada viram duas conexões separadas no canvas. A volta é desenhada à mão e é ela que define a chamada como síncrona; uma ida sem volta é async.

---

## Implementation Decisions

### Passos

- Valem os dois: wizard de fluxo de trabalho no modo livre e, no modo entrevista, as 6 fases no mesmo wizard, com as fases 1–4 em tela cheia (sem canvas).
- Navegação "só a ordem": Avançar/Voltar em sequência, sem pré-requisitos. Não dá para pular passos à frente.

### Ida e volta

- Ida e volta são duas conexões (arestas) separadas, desenhadas sempre como duas linhas, nunca uma só.
- A volta define a chamada: ida com volta = síncrona (quem chama espera a resposta); ida sem volta = async (fire-and-forget). Designs antigos ganham a volta de cada aresta síncrona na migração.
- A volta é desenhada à mão, ligando a alça de volta do alvo até quem chamou. Não nasce junto com a ida.
- Uma ida sem volta é async silencioso: simula como async, sem selo, aviso ou sugestão do Advisor. O desenho (linha única) já diz que não há volta.
- Requisições (●) andam na linha de ida e respostas (○) na linha de volta.

### Agent's Discretion

- Que ferramentas (abas atuais) ficam em cada passo, e se o passo Problema é tela cheia: proposta na spec (WIZ-03), a confirmar.
- Desenho exato das duas linhas (afastamento, tracejado da volta, posição das alças).
- Onde ficam os controles hoje na top bar (seletor de problema, Simulate, custo, SLO) dentro do novo layout, respeitando o teste de largura da top bar.

### Declined / Undiscussed Gray Areas → Assumptions

- Parâmetros da volta, cascata ao apagar a ida, atalho "síncrona/async" no menu e no painel, passo inicial e persistência do passo, comportamento em abas de referência, mobile e o tour (Walkthrough): registrados como premissas na spec.

---

## Specific References

- Esboço escolhido para as linhas:

```
  Service ────────▶ DB      ida
          ◀╌╌╌╌╌╌╌╌        volta  → síncrona

  Service ────────▶ Queue   só ida → async
```

- Esboço do wizard no modo livre: barra de passos no topo, paleta à esquerda, canvas no centro, ferramentas do passo atual à direita.

---

## Deferred Ideas

- Wizard com pré-requisitos por passo (ex.: Simular exige um ponto de entrada): o usuário escolheu "só a ordem".
- Selo "sem volta = async" e sugestão do Advisor para idas sem volta: o usuário escolheu async silencioso.
