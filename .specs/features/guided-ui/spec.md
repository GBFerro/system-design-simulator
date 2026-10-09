# Interface guiada e ida/volta separadas — Specification

Oct 8, 2026 · Status: rascunho · Escopo: Complex (layout inteiro + modelo de aresta + persistência v4)

## Problem Statement

O app abre com tudo ao mesmo tempo: top bar cheia, paleta, canvas e um painel direito com 10 abas (Props, Sim, Flow, Chaos, SLO, Score, Advisor, Cost, Capacity, Tradeoffs). Quem chega não sabe por onde começar nem em que ordem usar as ferramentas, e no modo entrevista as fases 1–4 (requisitos, estimativas, APIs, entidades) disputam espaço com o canvas num painel lateral. Além disso, ida e volta de uma chamada andam na mesma linha: as bolas de requisição (●) e de resposta (○) se cruzam no mesmo traço, e o único jeito de dizer que uma chamada não espera resposta é um toggle "async" escondido no menu. Fica difícil ler o fluxo e difícil montá-lo.

## Goals

- [ ] O app é usado num wizard de passos em ordem (modo livre: Problem → Design → Simulate → Failures → Evaluate; entrevista: as 6 fases), e cada passo mostra só as ferramentas dele.
- [ ] No modo entrevista, as fases 1–4 ocupam a tela inteira; o canvas aparece a partir da fase 5.
- [ ] Toda chamada síncrona aparece como duas linhas no canvas, uma de ida e uma de volta, e as bolas de requisição e de resposta andam cada uma na sua linha.
- [ ] Desenhar ou apagar a volta é o que torna uma chamada síncrona ou async.
- [ ] Todo design salvo, exportado ou de referência abre com a mesma simulação de antes: bit-idêntica (mesmo grafo + seed) após a migração v3 → v4.

## Out of Scope

| Feature                                                                      | Reason                                                                                                                            |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Pré-requisitos para avançar de passo (ex.: Simulate exige ponto de entrada)  | O usuário escolheu "só a ordem" (ver `context.md`, Deferred Ideas).                                                               |
| Selo, aviso ou finding do Advisor para ida sem volta                         | O usuário escolheu async silencioso: a linha única já comunica.                                                                   |
| Latência, perda de pacote ou faults próprios da volta                        | A volta não carrega parâmetros; o link (latência, perda, faults, métricas) continua na ida e vale para o RTT, como hoje (AD-001). |
| Mudanças no motor, na rubrica de score, no custo ou no SLO                   | A volta só substitui o flag `async`; o motor recebe o mesmo `SimGraph` de hoje.                                                   |
| Tema claro, redesign visual (cores, tipografia, ícones) ou novos componentes | O pedido é organização em passos e leitura do fluxo; o tema continua dark-only, zinc.                                             |
| Mudanças no diagrama de sequência da aba Flow                                | Ele já separa chamada e resposta em setas próprias.                                                                               |

---

## Assumptions & Open Questions

| Assumption / decision                | Chosen default                                                                                                                                                                                                                                                                                                           | Rationale                                                                                          | Confirmed? |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ---------- |
| Quais passos                         | Modo livre: Problem, Design, Simulate, Failures, Evaluate. Entrevista: Requirements, Estimation, API, Data Model, High-Level Design, Deep Dive, com as fases 1–4 em tela cheia                                                                                                                                           | Decisão do usuário ("os dois", ver `context.md`).                                                  | y          |
| Navegação                            | Next/Back em sequência, sem pré-requisitos; na barra de passos, um passo anterior ao atual é clicável e um posterior não                                                                                                                                                                                                 | Decisão do usuário ("só a ordem"). Voltar por clique não pula nada à frente.                       | y          |
| Ida e volta                          | Duas arestas separadas no canvas; a volta B → A responde a uma ida A → B                                                                                                                                                                                                                                                 | Decisão do usuário.                                                                                | y          |
| O que a volta significa              | Ida com volta = síncrona; ida sem volta = async. O flag `edge.data.async` deixa de existir no formato salvo (v4) e passa a ser derivado da volta                                                                                                                                                                         | Decisão do usuário. Uma fonte de verdade só evita "volta desenhada numa ida marcada async".        | y          |
| Como a volta nasce                   | Desenhada à mão, da alça de volta do alvo até quem chamou. Uma conexão nova pela alça de ida nasce sem volta (async)                                                                                                                                                                                                     | Decisão do usuário.                                                                                | y          |
| Ida sem volta                        | Async silencioso: sem selo, aviso ou finding                                                                                                                                                                                                                                                                             | Decisão do usuário.                                                                                | y          |
| Ferramentas por passo                | Problem (tela cheia): seletor de problema, enunciado/requisitos, Capacity, Learning Path. Design: paleta, Props, Flow. Simulate: Sim, Flow, Props. Failures: Chaos, SLO, Props. Evaluate: Score, Advisor, Cost, Tradeoffs, Props. Props aparece em todo passo com canvas porque ajustar um nó acontece em qualquer passo | Cada aba atual cai num passo só (exceto Props e Flow), e nenhuma some.                             | n          |
| Paleta                               | Só no passo Design (e na fase 5 da entrevista); nos outros passos o canvas continua editável por Props, menu de contexto, atalhos e quick fixes                                                                                                                                                                          | Dá sentido ao passo Design sem travar o ajuste fino nos outros.                                    | n          |
| Simulação entre passos               | Trocar de passo nunca para, pausa ou zera uma execução ao vivo                                                                                                                                                                                                                                                           | Failures precisa da execução iniciada em Simulate (faults só existem numa execução ao vivo).       | n          |
| Persistência do passo                | O passo atual do modo livre persiste no `appStore` (sobrevive ao reload); a fase da entrevista continua no `interviewStore`                                                                                                                                                                                              | Recarregar a página não deve jogar o usuário de volta ao passo 1.                                  | n          |
| Ao terminar a entrevista             | Finish abre o relatório como hoje e a barra volta aos passos do modo livre, no passo Evaluate; abandonar a entrevista volta ao passo em que o modo livre estava                                                                                                                                                          | O que se faz depois do relatório é avaliar o design.                                               | n          |
| Parâmetros da volta                  | Nenhum. Selecionada, a volta mostra em Props a chamada que ela responde ("Response to A → B") e um botão que seleciona a ida                                                                                                                                                                                             | O link e as chamadas moram na ida (AD-001); duplicar campos criaria dois valores para o mesmo RTT. | n          |
| Atalho síncrona/async                | O "Sync / Async" do menu de contexto e de Props continua, agora desenhando ou apagando a volta (uma entrada de undo)                                                                                                                                                                                                     | Desenhar à mão continua sendo o caminho principal; o atalho só evita caçar a alça.                 | n          |
| Apagar a ida                         | Apaga a volta junto, na mesma entrada de undo                                                                                                                                                                                                                                                                            | Volta sem ida não tem significado.                                                                 | n          |
| Volta e ciclos                       | A volta nunca é chamada: o compilador a remove antes do Kahn, então ela não cria ciclo, aresta `back` nem carga. Uma chamada real B → A (alça de ida) continua sendo uma ida, independente da volta                                                                                                                      | A alça diz o que a aresta é; sem isso B → A seria ambíguo.                                         | n          |
| Quick fixes e referências            | Toda aresta síncrona que um quick fix do Advisor, uma mitigação ou o loader de referência cria vem com a volta; `insertBetween` preserva a volta (ou a ausência dela) do link que divide                                                                                                                                 | Um fix não pode transformar o caminho do usuário em async sem o usuário pedir.                     | n          |
| Copiar, colar e duplicar             | A volta vai junto quando a ida vai (os dois nós copiados); uma volta selecionada sozinha não é colada                                                                                                                                                                                                                    | Mesma regra das arestas de hoje (só arestas entre nós copiados).                                   | n          |
| Abas de referência (somente leitura) | O wizard funciona igual; a alça de volta some como a de ida, e o atalho Sync/Async fica desabilitado                                                                                                                                                                                                                     | Regra de abas somente leitura do `CLAUDE.md`.                                                      | n          |
| Mobile (< 768 px)                    | A barra de passos mostra o nome do passo atual, "n / total" e Back/Next; as telas cheias rolam                                                                                                                                                                                                                           | Cinco ou seis rótulos não cabem numa linha de celular.                                             | n          |
| Tour (Walkthrough) e "How it works"  | Passam a apresentar a barra de passos; nenhum passo do tour aponta para um elemento que não existe mais                                                                                                                                                                                                                  | O tour é a primeira coisa que um usuário novo vê.                                                  | n          |
| Schema                               | `SCHEMA_VERSION` = 4; `migrateGraphV3toV4` cria a volta de cada aresta sem `async: true` e remove o flag; export usa `schemaVersion: 4`; import aceita 1–4                                                                                                                                                               | Regra de persistência do `CLAUDE.md`: mudança de formato salvo = versão nova com migração pura.    | n          |
| Idioma                               | Textos da interface em inglês (rótulos dos passos, botões "Next"/"Back", toasts); prosa da spec em português                                                                                                                                                                                                             | Igual ao resto do app e à spec request-flow.                                                       | y          |
| Prefixos                             | `WIZ` (wizard) e `RET` (ida/volta)                                                                                                                                                                                                                                                                                       | Padrão de três letras das specs.                                                                   | y          |

**Open questions:** none - all resolved or logged above (required before the spec is confirmed).

---

## User Stories

### P1: Ida e volta em duas linhas ⭐ MVP

**User Story**: Como candidato, quero ver e desenhar a ida e a volta de uma chamada como duas linhas, para ler o fluxo sem as bolas se cruzarem e decidir no desenho se a chamada espera resposta.

**Why P1**: É a queixa mais concreta: uma linha só deixa o fluxo confuso, e o async é um toggle escondido.

**Acceptance Criteria**:

1. WHEN o usuário arrasta da alça de volta de B até A e existe uma ida A → B sem volta THEN o canvas SHALL criar a volta B → A ligada a essa ida, numa entrada de undo. <!-- RET-01 -->
2. IF o usuário arrasta da alça de volta de B até A e não existe ida A → B THEN o canvas SHALL não criar aresta e SHALL mostrar o toast "A response needs a request: connect A → B first" (com os rótulos dos nós). <!-- RET-02 -->
3. IF a ida A → B já tem volta THEN arrastar outra volta de B até A SHALL não criar aresta nem entrada de undo. <!-- RET-03 -->
4. The canvas SHALL desenhar a ida e a sua volta como duas linhas paralelas que não se sobrepõem: a ida contínua com a seta no alvo e a volta tracejada com a seta em quem chamou. <!-- RET-04 -->
5. The canvas SHALL desenhar uma ida sem volta como uma linha só, sem traço de volta. <!-- RET-05 -->
6. WHILE uma ida não tem volta, o compilador SHALL entregar ao motor a aresta como async (`async: true`), com o mesmo efeito de hoje: carga sim, latência do usuário e bola de resposta não. <!-- RET-06 -->
7. WHEN a volta de uma ida é apagada THEN a ida SHALL passar a async na próxima compilação. <!-- RET-07 -->
8. WHEN o usuário apaga uma ida que tem volta THEN o editor SHALL apagar a volta junto, na mesma entrada de undo. <!-- RET-08 -->
9. The compilador, o scorer e o advisor SHALL ignorar a volta como chamada: ela não carrega carga, não entra no Kahn, não vira aresta `back` e não conta na adjacência do `ScoringGraph`. <!-- RET-09 -->
10. WHILE a simulação roda ou há um snapshot do Analyze, as bolas de requisição SHALL andar sobre a linha da ida, de quem chama até o alvo. <!-- RET-10 -->
11. WHILE a simulação roda ou há um snapshot do Analyze, as bolas de resposta SHALL andar sobre a linha da volta, do alvo até quem chamou. <!-- RET-16 -->
12. WHEN uma volta é selecionada THEN a aba Props SHALL mostrar "Response to A → B" (rótulos dos nós), nenhum campo editável e um botão que seleciona a ida. <!-- RET-11 -->
13. WHEN o usuário escolhe "Sync" no menu de contexto ou em Props de uma ida sem volta THEN o editor SHALL criar a volta, numa entrada de undo. <!-- RET-12 -->
14. WHEN o usuário escolhe "Async" no menu de contexto ou em Props de uma ida com volta THEN o editor SHALL apagar a volta, numa entrada de undo. <!-- RET-13 -->
15. WHILE a aba ativa é somente leitura, o canvas SHALL não mostrar a alça de volta. <!-- RET-14 -->
16. WHILE a aba ativa é somente leitura, o menu de contexto e Props SHALL desabilitar Sync/Async. <!-- RET-17 -->
17. WHEN um nó está expandido em cards de instância THEN o canvas SHALL desenhar a volta de cada cópia de ida, por card, como faz com a ida. <!-- RET-15 -->

**Independent Test**: Ligar Client → Service pela alça de ida, rodar a simulação e ver só bolas ● numa linha; desenhar a volta Service → Client e ver as bolas ○ voltando pela segunda linha.

---

### P1: Designs existentes continuam iguais (migração v4) ⭐ MVP

**User Story**: Como usuário com designs salvos, quero abri-los com as voltas já desenhadas e a mesma simulação de antes, para não refazer nada.

**Why P1**: Sem migração, toda aresta salva viraria async e todo número mudaria.

**Acceptance Criteria**:

1. WHEN um design v3 é migrado THEN `migrateGraphV3toV4` SHALL criar uma volta para cada aresta entre nós de componente sem `async: true` e nenhuma para as arestas com `async: true`. <!-- RET-20 -->
2. The migração v3 → v4 SHALL ser pura, idempotente e nunca lançar exceção, e SHALL deixar nós de texto, strokes e arestas que tocam nós de texto inalterados. <!-- RET-21 -->
3. WHEN um grafo v2 ou v3 é migrado para v4 e compilado THEN o motor SHALL produzir snapshots bit-idênticos aos de antes (mesmo grafo + seed), com `engine-golden.test.ts` passando sem alterar o fixture. <!-- RET-22 -->
4. WHEN o usuário exporta um design THEN o JSON SHALL usar `schemaVersion: 4` e carregar as voltas como arestas. <!-- RET-23 -->
5. WHEN o usuário importa JSON com `schemaVersion` 1, 2, 3 ou 4 (ausente = 1) THEN `importDesign` SHALL migrar até v4 e devolver `{ ok: true }`. <!-- RET-24 -->
6. WHEN o loader de referência monta uma das 35 soluções THEN ele SHALL criar a volta de cada aresta da referência que não é `async`. <!-- RET-25 -->
7. WHEN um quick fix do Advisor ou uma mitigação de fault cria uma aresta síncrona THEN o `GraphDiff` SHALL incluir a volta dela. <!-- RET-26 -->
8. WHEN `insertBetween` divide um link A → B em A → X → B THEN as duas metades SHALL ter volta se e só se o link original tinha. <!-- RET-27 -->
9. WHEN o usuário copia e cola ou duplica uma seleção THEN o editor SHALL copiar a volta de cada ida copiada e SHALL não colar uma volta cuja ida não foi copiada. <!-- RET-28 -->
10. The stores persistidos SHALL usar `version: STORE_VERSION` = 4, e `canvasStore` e `savedDesignsStore` SHALL rodar a cadeia `migrateGraph` até v4. <!-- RET-29 -->

**Independent Test**: Importar um JSON v3 de uma referência, ver as voltas desenhadas, rodar Analyze e comparar o snapshot com o de antes da mudança.

---

### P1: Wizard de passos no modo livre ⭐ MVP

**User Story**: Como usuário novo, quero seguir passos em ordem (escolher o problema, desenhar, simular, testar falhas, avaliar) e ver só as ferramentas do passo atual, para saber o que fazer a seguir.

**Why P1**: É a outra metade do pedido: o layout atual mostra tudo de uma vez.

**Acceptance Criteria**:

1. WHILE o modo é livre, o app SHALL mostrar uma barra com os passos Problem, Design, Simulate, Failures e Evaluate, nessa ordem, destacando o passo atual. <!-- WIZ-01 -->
2. WHEN o usuário clica em Next THEN o app SHALL ir ao passo seguinte. <!-- WIZ-02 -->
3. WHEN o usuário clica em Back THEN o app SHALL ir ao passo anterior. <!-- WIZ-03 -->
4. WHILE o passo atual é o primeiro, o app SHALL desabilitar Back. <!-- WIZ-04 -->
5. WHILE o passo atual é o último, o app SHALL desabilitar Next. <!-- WIZ-15 -->
6. WHEN o usuário clica na barra num passo anterior ao atual THEN o app SHALL ir a esse passo. <!-- WIZ-05 -->
7. IF o usuário clica na barra num passo posterior ao atual THEN o app SHALL não mudar de passo. <!-- WIZ-06 -->
8. WHILE o passo é Problem, o app SHALL esconder o canvas e mostrar em tela cheia o seletor de problema, o enunciado com os requisitos, Capacity e o Learning Path. <!-- WIZ-07 -->
9. WHILE o passo é Design, Simulate, Failures ou Evaluate, o painel direito SHALL mostrar só as ferramentas desse passo (Design: Props, Flow; Simulate: Sim, Flow, Props; Failures: Chaos, SLO, Props; Evaluate: Score, Advisor, Cost, Tradeoffs, Props). <!-- WIZ-08 -->
10. WHILE o passo é Design, o app SHALL mostrar a paleta de componentes; nos demais passos, SHALL escondê-la. <!-- WIZ-09 -->
11. The app SHALL manter alcançável, em pelo menos um passo, cada ferramenta que existe hoje (as 10 abas, paleta, seletor de problema, Learning Path, controles de simulação, custo e SLO da top bar). <!-- WIZ-10 -->
12. WHEN o usuário troca de passo THEN o app SHALL não alterar o grafo, não criar entrada de undo e não parar, pausar nem zerar a execução ao vivo. <!-- WIZ-11 -->
13. WHEN o usuário recarrega a página THEN o app SHALL reabrir no passo em que estava. <!-- WIZ-12 -->
14. WHILE a largura é menor que 768 px, a barra de passos SHALL mostrar só o nome do passo atual, "n / 5" e os botões Back e Next. <!-- WIZ-13 -->
15. WHEN o tour (Walkthrough) roda THEN cada passo do tour SHALL apontar para um elemento visível, e um deles SHALL apresentar a barra de passos. <!-- WIZ-14 -->

**Independent Test**: Abrir o app limpo, ver o passo Problem em tela cheia, avançar até Evaluate com Next e conferir que cada passo mostra só as abas da tabela.

---

### P2: Entrevista no wizard, fases 1–4 em tela cheia

**User Story**: Como candidato em entrevista simulada, quero que requisitos, estimativas, APIs e entidades ocupem a tela inteira, e que o canvas só apareça na fase de design, para focar em uma coisa por vez como numa entrevista real.

**Why P2**: O modo entrevista já funciona; isto melhora o foco, mas depende do wizard do P1.

**Acceptance Criteria**:

1. WHILE uma entrevista está ativa, a barra SHALL mostrar as 6 fases (Requirements, Estimation, API, Data Model, High-Level Design, Deep Dive) no lugar dos passos do modo livre. <!-- WIZ-20 -->
2. WHILE a fase atual é uma das fases 1–4, o app SHALL esconder o canvas e mostrar em tela cheia o formulário da fase e o seu guia. <!-- WIZ-21 -->
3. WHILE a fase atual é High-Level Design, o app SHALL mostrar o canvas com a paleta e as ferramentas dos passos Design e Simulate. <!-- WIZ-22 -->
4. WHILE a fase atual é Deep Dive, o app SHALL mostrar o canvas com o painel do drill e o botão Finish. <!-- WIZ-23 -->
5. WHEN o usuário avança ou volta de fase pela barra THEN o `interviewStore` SHALL acumular os segundos da fase que ele deixa em `phaseSeconds`, como hoje. <!-- WIZ-24 -->
6. IF o usuário clica na barra numa fase posterior à atual THEN o app SHALL não mudar de fase. <!-- WIZ-25 -->
7. WHEN o usuário conclui com Finish THEN o app SHALL abrir o relatório e SHALL voltar aos passos do modo livre no passo Evaluate. <!-- WIZ-26 -->
8. WHEN o usuário abandona a entrevista THEN o app SHALL voltar aos passos do modo livre no passo em que estava antes de começá-la. <!-- WIZ-27 -->
9. WHEN o usuário recarrega a página durante a entrevista THEN o app SHALL reabrir na mesma fase, com o cronômetro correto. <!-- WIZ-28 -->

**Independent Test**: Iniciar uma entrevista, ver Requirements em tela cheia sem canvas, avançar até High-Level Design e ver o canvas aparecer.

---

## Edge Cases

- IF o usuário arrasta a alça de volta até o próprio nó ou até um nó de texto THEN o canvas SHALL não criar aresta. <!-- RET-30 -->
- WHEN existem chamadas A → B e B → A (duas idas) THEN cada uma SHALL aceitar a sua própria volta, e o canvas SHALL desenhar as quatro linhas sem sobreposição. <!-- RET-31 -->
- IF um JSON importado tem uma volta cuja ida não existe THEN `importDesign` SHALL descartá-la com um aviso em `warnings`. <!-- RET-32 -->
- WHEN o seletor de problema da top bar ou o loader de referência troca o problema fora do passo Problem THEN o app SHALL manter o passo atual. <!-- WIZ-30 -->
- WHILE o passo é Problem e a simulação está ao vivo, o app SHALL manter a execução rodando com o canvas escondido. <!-- WIZ-31 -->

---

## Implicit-Requirement Sweep

| Dimension                   | Coverage                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Input validation & bounds   | RET-02, RET-03, RET-30, RET-32.                                                                               |
| Failure / partial-failure   | RET-21 (migração nunca lança), RET-24 (import), RET-32.                                                       |
| Idempotency / duplicates    | RET-03 (volta duplicada), RET-21 (migração idempotente).                                                      |
| Auth & rate limits          | N/A because o app é 100% client-side, sem contas nem backend.                                                 |
| Concurrency / ordering      | RET-08 e RET-12/13 (uma entrada de undo por edição); WIZ-11 (troca de passo não toca o grafo nem a execução). |
| Data lifecycle              | RET-20 a RET-29 (schema v4, migração, export/import); WIZ-12 e WIZ-28 (passo e fase persistidos).             |
| Observability               | N/A because não há backend; a observabilidade do usuário são as bolas por linha (RET-10).                     |
| External-dependency failure | N/A because o recurso não chama serviço externo.                                                              |
| State-transition integrity  | WIZ-02 a WIZ-06, WIZ-24 a WIZ-27 (só a ordem); RET-06/07 (síncrona ⇄ async pela volta).                       |

---

## Requirement Traceability

| Requirement ID | Story                          | Phase   | Status |
| -------------- | ------------------------------ | ------- | ------ |
| RET-01         | P1: Ida e volta em duas linhas | Execute | Done   |
| RET-02         | P1: Ida e volta em duas linhas | Execute | Done   |
| RET-03         | P1: Ida e volta em duas linhas | Execute | Done   |
| RET-04         | P1: Ida e volta em duas linhas | Execute | Done   |
| RET-05         | P1: Ida e volta em duas linhas | Execute | Done   |
| RET-06         | P1: Ida e volta em duas linhas | Execute | Done   |
| RET-07         | P1: Ida e volta em duas linhas | Execute | Done   |
| RET-08         | P1: Ida e volta em duas linhas | Execute | Done   |
| RET-09         | P1: Ida e volta em duas linhas | Execute | Done   |
| RET-10         | P1: Ida e volta em duas linhas | Execute | Done   |
| RET-11         | P1: Ida e volta em duas linhas | Execute | Done   |
| RET-12         | P1: Ida e volta em duas linhas | Execute | Done   |
| RET-13         | P1: Ida e volta em duas linhas | Execute | Done   |
| RET-14         | P1: Ida e volta em duas linhas | Execute | Done   |
| RET-15         | P1: Ida e volta em duas linhas | Execute | Done   |
| RET-16         | P1: Ida e volta em duas linhas | Execute | Done   |
| RET-17         | P1: Ida e volta em duas linhas | Execute | Done   |
| RET-20         | P1: Migração v4                | Execute | Done   |
| RET-21         | P1: Migração v4                | Execute | Done   |
| RET-22         | P1: Migração v4                | Execute | Done   |
| RET-23         | P1: Migração v4                | Execute | Done   |
| RET-24         | P1: Migração v4                | Execute | Done   |
| RET-25         | P1: Migração v4                | Execute | Done   |
| RET-26         | P1: Migração v4                | Execute | Done   |
| RET-27         | P1: Migração v4                | Execute | Done   |
| RET-28         | P1: Migração v4                | Execute | Done   |
| RET-29         | P1: Migração v4                | Execute | Done   |
| RET-30         | Edge cases                     | Execute | Done   |
| RET-31         | Edge cases                     | Execute | Done   |
| RET-32         | Edge cases                     | Execute | Done   |
| WIZ-01         | P1: Wizard no modo livre       | Execute | Done   |
| WIZ-02         | P1: Wizard no modo livre       | Execute | Done   |
| WIZ-03         | P1: Wizard no modo livre       | Execute | Done   |
| WIZ-04         | P1: Wizard no modo livre       | Execute | Done   |
| WIZ-05         | P1: Wizard no modo livre       | Execute | Done   |
| WIZ-06         | P1: Wizard no modo livre       | Execute | Done   |
| WIZ-07         | P1: Wizard no modo livre       | Execute | Done   |
| WIZ-08         | P1: Wizard no modo livre       | Execute | Done   |
| WIZ-09         | P1: Wizard no modo livre       | Execute | Done   |
| WIZ-10         | P1: Wizard no modo livre       | Execute | Done   |
| WIZ-11         | P1: Wizard no modo livre       | Execute | Done   |
| WIZ-12         | P1: Wizard no modo livre       | Execute | Done   |
| WIZ-13         | P1: Wizard no modo livre       | Execute | Done   |
| WIZ-14         | P1: Wizard no modo livre       | Execute | Done   |
| WIZ-15         | P1: Wizard no modo livre       | Execute | Done   |
| WIZ-20         | P2: Entrevista no wizard       | Execute | Done   |
| WIZ-21         | P2: Entrevista no wizard       | Execute | Done   |
| WIZ-22         | P2: Entrevista no wizard       | Execute | Done   |
| WIZ-23         | P2: Entrevista no wizard       | Execute | Done   |
| WIZ-24         | P2: Entrevista no wizard       | Execute | Done   |
| WIZ-25         | P2: Entrevista no wizard       | Execute | Done   |
| WIZ-26         | P2: Entrevista no wizard       | Execute | Done   |
| WIZ-27         | P2: Entrevista no wizard       | Execute | Done   |
| WIZ-28         | P2: Entrevista no wizard       | Execute | Done   |
| WIZ-30         | Edge cases                     | Execute | Done   |
| WIZ-31         | Edge cases                     | Execute | Done   |

**Coverage:** 62 total, 62 implemented (RET-* and WIZ-* → Done); verification report: `validation.md`.

---

## Success Criteria

- [ ] Um usuário novo chega de Problem a Evaluate só com Next, sem abrir menu nem aba escondida.
- [ ] As 35 referências abrem com as voltas desenhadas e scores idênticos aos de antes.
- [ ] `engine-golden.test.ts` passa sem alterar o fixture.
- [ ] Nenhuma bola de resposta anda sobre a linha da ida.
