# Tecnologias dos componentes (component-technologies): Validation, rodada 1

## Validation (rodada 1): component-technologies - FAIL ❌

Os 51 ACs têm evidência `file:line`, e 47 deles batem com o resultado que a spec define. Os gates passam: typecheck, 1293 testes unitários, lint, format, build, bundle +11,6% (limite +15%) e e2e completo (92 passando, 16 deles em `technologies.spec.ts`). O conteúdo também está correto: 17 linhas do catálogo conferidas contra as fontes, nenhum número errado.

O veredito é FAIL por um motivo só, que bloqueia: o mutante **M3b** sobrevive. Trocar o k do QUORUM de ⌊RF/2⌋ + 1 para ⌈RF/2⌉ passa nos 1293 testes, porque nenhum teste usa um RF par. A spec fixa a fórmula para RF de 1 a 7 (TEC-29), então essa cláusula está sem teste que a discrimine.

Há ainda uma lacuna de evidência menor, TEC-07 (o seletor de classe desabilitado não tem teste), e dois spec-precision gaps que não bloqueiam (TEC-45 e TEC-38). Os detalhes estão na seção Fix Plans.

- **Data**: 2026-10-14
- **Spec**: `.specs/features/component-technologies/spec.md` (TEC-01…TEC-51; emendas de 2026-10-13 em TEC-05, TEC-11, TEC-36, TEC-50, TEC-51 e TEC-32 alinhado a D4)
- **Faixa de commits**: `4b8cfca..HEAD`, 43 commits, HEAD `6713060`, branch `feat/component-technologies`. A feature começa em `62a6dc6`, o commit dos documentos da spec.
- **Verifier**: sub-agente independente (author ≠ verifier). Trabalhou só em leitura sobre `src/` e `tests/`; as mutações rodaram num worktree descartável.

---

## Gates

| Gate      | Comando                                                                 | Saída                                                                                                 |
| --------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Typecheck | `npm run typecheck`                                                     | exit 0                                                                                                |
| Unit      | `npm test`                                                              | **1293 passando**, 60 arquivos, 0 skip                                                                |
| Lint      | `npm run lint`                                                          | exit 0                                                                                                |
| Format    | `npm run format:check`                                                  | todos os arquivos formatados                                                                          |
| Build     | `npm run build`                                                         | exit 0                                                                                                |
| Bundle    | `npm run bundle:check`                                                  | 615,6 KB gzip contra a baseline de 551,5 KB: **+11,6%** (limite +15%). A baseline não mudou na faixa. |
| E2E área  | `npx playwright test tests/e2e/technologies.spec.ts`                    | **16 passando**                                                                                       |
| E2E todo  | `npx playwright test` (dev em :3100; L-014, a paleta e o Props mudaram) | **92 passando**, 0 falha                                                                              |

- **Contagem de testes unitários**: 1016 na base `4b8cfca`, medida num worktree, e 1293 no HEAD, ou seja, **+277**. Nenhum teste foi removido. As fixtures de `engine-golden.test.ts`, `scoring.test.ts` e `data.test.ts`, e o diretório `src/data`, não mudaram na faixa (`git diff --stat` vazio).
- **Teste de desempenho instável**: na primeira execução, `engine-tick.test.ts > is fast: ≤ 5 ms per tick` falhou com 5,66 ms, porque o e2e rodava em paralelo. Isolado, ele passou 3 vezes de 3, e o gate final, sem carga em paralelo, passou inteiro. Não é regressão da feature.
- **Incidente de ambiente (consertado, sem efeito no código)**:
  - O que houve: o primeiro `git worktree remove --force` do worktree de contagem seguiu a junção `node_modules` desse worktree, que apontava para o `node_modules` real, e apagou parte dele (`.bin`, `.package-lock.json` e uns 544 pacotes).
  - Conserto: `npm install --no-audit --no-fund --prefer-offline`, sem mudar o `package-lock.json`. Depois dele, `npm ls --depth=0` não acusa nada faltando e typecheck, os 1293 testes, lint e format passam de novo.
  - Para o sensor, a junção foi removida com `rmdir` antes do `git worktree remove`.
  - `git status --porcelain` ficou vazio do começo ao fim.

---

## Task Completion

T1–T37 estão marcadas ✅ Complete em `tasks.md`, e nenhuma está bloqueada ou parcial. A rastreabilidade da spec mapeia as 51 ACs para T1–T37, sem nenhuma AC sem tarefa.

---

## Spec-Anchored Acceptance Criteria

Legenda: ✅ o teste mira o resultado que a spec define · ⚠️ spec-precision gap ou ressalva · ❌ lacuna. A notação `u/` abrevia `tests/unit/` e `e2e/` abrevia `tests/e2e/`.

### P1: Escolher a tecnologia de um nó

| AC     | Resultado definido pela spec                                                                                                           | Evidência (`file:line` + asserção)                                                                                                                                                                                                                                             | Resultado                                                                                                                                                                                      |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEC-01 | Os 10 tipos com enum `technology` = `generic` + as da premissa; o padrão é `generic`                                                   | `u/technologies.test.ts:696` `expect(spec.default).toBe("generic")`; `:712-719`, cada tipo central oferece `["generic", ...technologiesOf(id)]`; `:593` + `:600`, CENTRAL_TYPES = SPEC_OPTIONS e `toBe(26)`                                                                    | ✅                                                                                                                                                                                             |
| TEC-02 | Grava a capacidade, o tempo de serviço e os params da tecnologia e da classe padrão; preserva `instances` e o resto; 1 entrada de undo | `u/editor.test.ts:371-385` `toMatchObject({technology:"postgres", instanceClass:"db.r6g.xlarge", capacityPerInstance:40_000, … instances:4, connectionPool:250})` + `history.toHaveLength(1)`; `e2e/technologies.spec.ts:55` (capacidade 16000, instâncias 3, um Ctrl+Z volta) | ✅                                                                                                                                                                                             |
| TEC-03 | Escolher a mesma tecnologia não altera nada e não cria undo                                                                            | `u/editor.test.ts:410-411` `expect(s().nodes).toBe(nodes)` + `history.toHaveLength(1)`                                                                                                                                                                                         | ✅                                                                                                                                                                                             |
| TEC-04 | Trocar para `generic` mantém os números                                                                                                | `u/editor.test.ts:424` `expect(params()).toEqual({ ...before, technology: "generic" })`                                                                                                                                                                                        | ✅                                                                                                                                                                                             |
| TEC-05 | Descrição, consistência/CAP, "Based on: <fonte>, <ano>" com link e (measured/derived/estimate)                                         | `e2e/technologies.spec.ts:83-89` descrição "Wide-column store", consistência "AP with tunable", `toHaveText(/^Based on: .+, \d{4} \(derived\)$/)`, `href` `^https://`; `:114-116` `(estimate)` para o DynamoDB                                                                 | ✅                                                                                                                                                                                             |
| TEC-06 | O rótulo traz a camada ou o modo entre parênteses                                                                                      | `e2e/technologies.spec.ts:62-63` `toHaveText("AWS NLB (L4)")`, `"AWS ALB (L7)"`; `u/technologies.test.ts:701-710` lista de rótulos do LB + "DynamoDB (on-demand)"                                                                                                              | ✅                                                                                                                                                                                             |
| TEC-07 | Em aba somente leitura, os seletores de tecnologia **e de classe** ficam desabilitados e a troca é no-op                               | `e2e/technologies.spec.ts:165-172` `getByLabel("Technology")…toBeDisabled()` (o nó da referência é Generic, então não há classe); `u/editor.test.ts:428-436` as três ações são no-op (`nodes` idêntico, `history` 0)                                                           | ❌ parcial: o seletor de classe desabilitado não tem teste (o código põe `disabled={disabled}` em `src/components/panel/TechnologyPicker.tsx:106`, mas nenhum teste exercita isso). Ver Fix 2. |
| TEC-08 | Uma `technology` desconhecida vira `generic`                                                                                           | `u/technologies.test.ts:876-880` `sanitizeParams("nosql-db",{technology:"oracle"})…technology).toBe("generic")` e `toEqual(defaultParams)`                                                                                                                                     | ✅                                                                                                                                                                                             |
| TEC-09 | `technology`/`instanceClass` em `data.params`; salvar, carregar, exportar e importar preservam; `SCHEMA_VERSION` igual                 | `u/persistence.envelope.test.ts:454-494` round-trip do envelope v4: `back.technology` "cassandra", `back.instanceClass` "i4i.2xlarge" (`:491`), `toEqual(params)`, `SCHEMA_VERSION` 4                                                                                          | ✅ (salvar e carregar em IndexedDB usam o mesmo `serializeNodes`/`deserializeNodes`, em `src/store/savedDesignsStore.ts:81,98`; não há teste próprio)                                          |

### P1: Números de benchmark com fonte

| AC     | Resultado definido pela spec                                                                | Evidência                                                                                                                                                                                                                                                      | Resultado                                                                |
| ------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| TEC-10 | Um módulo único com capacidade, ms, params, preço, fonte (título, URL, ano), premissas      | `u/technologies.test.ts:100-160`: lookups e `techPreset` sobre a lista; `:185-247`: por tecnologia, fonte, premissas, evidência e números; `src/domain/components/technologies/types.ts` (modelo)                                                              | ✅                                                                       |
| TEC-11 | `technologies.test.ts` falha sem URL `https://`, ano, premissas e números finitos positivos | `u/technologies.test.ts:190` `expect(s.url).toMatch(/^https:\/\/\S+$/)`; `:191` ano inteiro; `:204-205` texto não vazio e de uma linha; `:226,232` `positive(n)`. O mutante M11 (uma URL `http://`) morre.                                                     | ✅ (a emenda que leva o teste para `technologies.test.ts` foi conferida) |
| TEC-12 | `generic` = "Generic — custom numbers", com os padrões do catálogo e o preço da tabela      | `u/technologies.test.ts:698` rótulo; `:1030-1031` `pricingOf(id, defaultParams(id))…toBe(getSchema(id).pricing)`; `:957-971` um nó generic sanitiza exatamente como a validação por chave; `:1171-1180` `createComponentNode` sem tecnologia = `defaultParams` | ✅                                                                       |
| TEC-13 | `PRICE_TABLE` registra a versão nova e a data                                               | `u/technologies.test.ts:1036-1037` `version).toBe(2)`, `asOf).toBe("2026-10")`                                                                                                                                                                                 | ✅                                                                       |

### P1: Classe de instância

| AC     | Resultado definido pela spec                                                                              | Evidência                                                                                                                                                                                   | Resultado |
| ------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| TEC-14 | Seletor de classe só para cobrança por instância, com nomes reais; escondido para gerenciadas e `generic` | `u/technologies.test.ts:755-766` `visibleIf` true/false por tecnologia; `e2e/technologies.spec.ts:98-117` opções `["i4i.large",…,"i4i.4xlarge"]`, DynamoDB e generic `toHaveCount(0)`       | ✅        |
| TEC-15 | Troca a classe: grava a capacidade, o tempo de serviço e os params da classe, preserva o resto, 1 undo    | `u/editor.test.ts:438-456` `instanceClass:"db.r6g.2xlarge", capacityPerInstance:80_000, writeCapacityRps:8_000, instances:3, failoverSec:45` + `history` 3 (1 por ação)                     | ✅        |
| TEC-16 | Classe fora da tecnologia → classe padrão                                                                 | `u/technologies.test.ts:887` `db.r6g.xlarge`; `:893` Cassandra com classe do MongoDB → `i4i.xlarge`. O mutante M5 morre.                                                                    | ✅        |
| TEC-17 | Custo = `instances` × $/h da classe × 730                                                                 | `u/cost.test.ts:120,125` `toBeCloseTo(2*0.225*730)`, `2*0.899*730`; `e2e/technologies.spec.ts:396` "$329" → "$656"                                                                          | ✅        |
| TEC-18 | Gerenciada: leituras e escritas com preços separados, carga do snapshot                                   | `u/cost.test.ts:131-147` `(800*0.5*0.125 + 200*0.625)*2.592`, igual com 1 e 5 instâncias, fallback pelo read ratio; `e2e/technologies.spec.ts:429` "$454" e "$891"                          | ✅        |
| TEC-19 | O CostPanel mostra tecnologia, classe e origem do preço                                                   | `e2e/technologies.spec.ts:409-417` `cost-line-technology` "PostgreSQL (RDS) · db.r6g.xlarge" + premissa "db.r6g.xlarge (4 vCPU): $0.45/h…AWS us-east-1 on-demand"; `u/cost.test.ts:127-128` | ✅        |

### P1: Tecnologias na paleta

| AC     | Resultado definido pela spec                                                              | Evidência                                                                                                                                                                                                   | Resultado |
| ------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| TEC-20 | Cada tipo central tem um controle que expande a lista (sem `generic`), fechado por padrão | `e2e/technologies.spec.ts:185-197` `aria-expanded` "false" → "true", itens `["DynamoDB (on-demand)","Apache Cassandra","ScyllaDB","MongoDB (replica set)"]`, fecha de novo                                  | ✅        |
| TEC-21 | Arrastar (mouse ou toque) ou ativar cria o nó com a tecnologia e a classe padrão          | `e2e/technologies.spec.ts:199-207` drag com o mouse → `cassandra` e 16000; `:248-256` toque → `scylladb`; `u/technologies.test.ts:1140-1152` `createComponentNode(…,"cassandra")` com a classe e os números | ✅        |
| TEC-22 | A entrada do tipo cria com a tecnologia padrão                                            | `e2e/technologies.spec.ts:216-228` NoSQL → `dynamodb`, LB → `aws-alb`; `:272-277` Ctrl+K "Message Queue" → `kafka`                                                                                          | ✅        |
| TEC-23 | Achar pelo nome na busca da paleta e no Ctrl+K; escolher cria como em TEC-21              | `e2e/technologies.spec.ts:230-245` "kafka" lista em Message Queue e em Pub/Sub, e cria como Pub/Sub; `:259-271` Ctrl+K "scylla" → nó NoSQL `scylladb`                                                       | ✅        |
| TEC-24 | Tag curta ("Cassandra", "ALB · L7") de tamanho fixo                                       | `e2e/technologies.spec.ts:280-310` `toHaveText("DynamoDB")`, `"Cassandra"`, `"ALB · L7"`; `after.width).toBe(before.width)` e o mesmo para a altura                                                         | ✅        |

### P2: Primário de escrita SQL

| AC     | Resultado definido pela spec                                                                                   | Evidência                                                                                                                                                                                                                                                     | Resultado |
| ------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| TEC-25 | Escritas: `shards` × capacidade de escrita, independente de `instances`; leituras: `instances` × capacidade    | `u/engine-tech.test.ts:40-41` `servedRps ≈ min(12000, 1×WRITE_CAP)` e 16 instâncias = 8; `:59` leituras `2*READ_CAP`; `u/tech-profile.test.ts` (estações `[8 × 40000 read, 2 × 5000 write-primary]`). O mutante M1 morre (10 testes).                         | ✅        |
| TEC-26 | Excesso de escrita em fila até `maxQueue`, o resto descartado; mais instâncias não aumentam a vazão de escrita | `u/engine-tech-tick.test.ts:57-59` `primaryBacklog ≈ (i+1)*(6000−WRITE_CAP)*TICK_SEC`, `backlog` 0; `:74-77` `primaryBacklog` 100 (= maxQueue), `overflow` e `dropped` = 3000; `u/engine-tech-math.test.ts:290-297` 8 e 16 instâncias, mesma vazão de escrita | ✅        |
| TEC-27 | `db-primary-failure` usa o `failoverSec` da tecnologia                                                         | `u/engine-tech-properties.test.ts:256-273` Aurora 30 s e Postgres 90 s: `m.endT).toBe(failover)`, erro > 0,99 até o failover e < 0,01 depois                                                                                                                  | ✅        |

### P2: Partição quente e consistência

| AC     | Resultado definido pela spec                                                                                                                          | Evidência                                                                                                                                                                                                                                                                                | Resultado                                                                                                          |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| TEC-28 | A partição quente não passa da capacidade por partição; o excesso é erro                                                                              | `u/engine-tech.test.ts:78-84` `droppedRps ≈ h·λ·(1−1/U)`, `limitKind` "hot-partition", `critical`, throughput do cliente; `u/engine-tech-math.test.ts:196-217`. O mutante M2 morre.                                                                                                      | ✅                                                                                                                 |
| TEC-29 | Cassandra/Scylla: ONE/QUORUM/ALL, RF 1–7; k = 1, ⌊RF/2⌋+1 ou RF; leitura = k-ésima de RF; k ops por leitura e RF por escrita                          | `e2e/technologies.spec.ts:44-45` opções `["one","quorum","all"]`; `u/tech-profile.test.ts:46-72` k e custo para RF 3 (QUORUM `kth(2,3)`, ONE `kth(1,3)`, ALL `kth(3,3)`); `u/engine-tech-math.test.ts:305-315` `servedRps ≈ 2500` (500×2 + 500×3); `u/technologies.test.ts:927` RF 9 → 3 | ❌ o mutante M3b (⌈RF/2⌉) sobrevive: k só é testado com RF 3 (e implicitamente RF 1), nunca com RF par. Ver Fix 1. |
| TEC-30 | RF 3, de ONE → QUORUM → ALL: o p99 não cai e a capacidade não sobe                                                                                    | `u/engine-tech.test.ts:112-117` capacidade `c`, `c/2`, `c/3` e p99 `toBeGreaterThanOrEqual`; `u/engine-tech-sampler.test.ts:95-113` p99 amostrado não decrescente e ALL > ONE                                                                                                            | ✅                                                                                                                 |
| TEC-31 | Leitura forte = 2× as unidades de uma eventual (na partição e no preço)                                                                               | `u/engine-tech.test.ts:91-92` `strong.limitUtilization ≈ 2u`, `droppedRps ≈ h·λ·(1−1/(2u))`; `u/cost.test.ts:139-143` `800*1*0.125…`; `u/technologies.test.ts:1014` `readUnitsPerRead` 1                                                                                                 | ✅                                                                                                                 |
| TEC-32 | MongoDB: `primary` só nos primários (um por shard), `secondaryPreferred` nos n − s secundários (nos primários se n = s), `majority` soma a replicação | `u/engine-tech.test.ts:131-138` `primary` serve `1×k0` com "primaries", `secondaryPreferred` limita em `20000/(2·k0)`; `:142-145` `majority − w1 ≈ 2 ms`; `u/tech-profile.test.ts:146-156` n = s → um só station "primaries"                                                             | ✅                                                                                                                 |
| TEC-33 | Esconder o param de consistência que a tecnologia não oferece                                                                                         | `u/technologies.test.ts:780-810` `shown(…)` por tecnologia; `e2e/technologies.spec.ts:36-53` "Consistency level" some no DynamoDB, "Read consistency" aparece                                                                                                                            | ✅                                                                                                                 |

### P2: Limites gerenciados

| AC     | Resultado definido pela spec                                                                       | Evidência                                                                                                                                                                                                                    | Resultado                                                                                                 |
| ------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| TEC-34 | Kafka drena com min(consumers, partitions) consumidores                                            | `u/engine-tech-kafka.test.ts:192` `edge ≈ 6*WORKER_CAP` com 12 consumidores e 6 partições; `:201` no tick; `:207-208` generic drena 12. O mutante M10 morre.                                                                 | ✅                                                                                                        |
| TEC-35 | SQS FIFO, RabbitMQ e SNS: teto de entrada, o excesso é erro                                        | `u/engine-tech.test.ts:151-161` SQS FIFO e SNS: `droppedRps ≈ λ − L`, `servedRps ≈ L`, `critical`; `u/tech-profile.test.ts:233-256` teto por fila do RabbitMQ (15k em large, 20k nas demais)                                 | ✅ (o teto do RabbitMQ é testado no profile; a admissão é a mesma função `admit`)                         |
| TEC-36 | OpenSearch: latência = máx de `shards` amostras; capacidade min(n, shards·(replicas+1))·k ÷ shards | `u/engine-tech.test.ts:163-173` 4, 10 e 20 nós → `4k/5`, `10k/5`, `10k/5`; `u/engine-tech-sampler.test.ts:115-127` p99 não decrescente de 1 a 8 shards; `u/tech-profile.test.ts:187-207` forma `max(5)`                      | ✅                                                                                                        |
| TEC-37 | S3: 5.500 GET/s e 3.500 PUT/s por prefixo × `prefixes`; o excesso é erro                           | `u/engine-tech.test.ts:175-187` 10k GET → 4500 de erro, 4k PUT → 500, 2 prefixos → 0; `u/tech-profile.test.ts:212-219` 3 prefixos → 16500/10500. O mutante M4 morre.                                                         | ✅                                                                                                        |
| TEC-38 | API Gateway: cota de 10.000 req/s em regime + burst; o excesso é 429                               | `u/engine-tech.test.ts:189-195` 15k → 5000 de erro, utilização 1,5; `u/engine-tech-tick.test.ts:107-125` burst sem erros até t < 0,85 s, primeiro erro em [0,85; 1,0] s, depois `drops ≈ rpsIn − 10000`. O mutante M9 morre. | ⚠️ o burst absorve 0,9 s, e não os 1,0 s de um token bucket contínuo (5000 ÷ (15000 − 10000)). Ver Fix 4. |
| TEC-39 | NLB só `hash`, e um valor salvo diferente vira `hash`; L7 só o que suporta                         | `u/technologies.test.ts:902-917` NLB com round robin → `hash`, ALB com hash → round robin; `e2e/technologies.spec.ts:20-34` opções `["hash"]` e `["round-robin","least-connections","weighted"]`                             | ✅                                                                                                        |

### P2: Ver o limite

| AC     | Resultado definido pela spec                                                             | Evidência                                                                                                                                                                                                                                                  | Resultado |
| ------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| TEC-40 | Com utilização ≥ 1, o card nomeia o recurso e a %                                        | `e2e/technologies.spec.ts:358-393` "Write primary: 130%", `data-saturated` "true" + ícone; com 40%, sem destaque; sem os campos, sem linha; `u/tech-limits.test.ts:153-156` rótulos ("Write primary", "Consumers capped by partitions", "S3 prefix limit") | ✅        |
| TEC-41 | O snapshot leva a utilização (nunca em `node.data`); o mesmo número no analyze e no tick | `u/engine-tech-tick.test.ts:128-144` Postgres, DynamoDB e Redis: `tick.limitUtilization ≈ steady.limitUtilization` (12 casas), mesmo `limitKind` e `writeRps`; `u/engine-tech-snapshot.test.ts:246-256` os campos chegam ao snapshot                       | ✅        |
| TEC-42 | O advisor usa a mesma utilização do motor                                                | `u/advisor.test.ts:236` `advisor.utilization ≈ db.limitUtilization` (9 casas); `:248,257` sem fix de instâncias para o primário e para a cota; `:294` Kafka usa o número do motor. O mutante M7 morre.                                                     | ✅        |

### P3: Valores editados à mão

| AC     | Resultado definido pela spec                                 | Evidência                                                                                                                                              | Resultado |
| ------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| TEC-43 | "Modified from <tecnologia> <classe>" + "Reset to benchmark" | `e2e/technologies.spec.ts:122-143` `toContainText("Modified from Apache Cassandra i4i.xlarge")`, tanto ao mudar a capacidade quanto o tempo de serviço | ✅        |
| TEC-44 | Reset regrava os valores da tecnologia e da classe em 1 undo | `u/editor.test.ts:465-488` `capacityPerInstance:32_000, serviceTimeMs:1.5, instances:6` + `history` +1; no-op quando já está no benchmark e em generic | ✅        |

### Edge cases

| AC     | Resultado definido pela spec                                                                               | Evidência                                                                                                                                                                                                                                                                                                                      | Resultado                                                                                                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEC-45 | Réplica com tecnologia diferente do primário: aviso no Props + warning do compilador, sem bloquear         | `u/engine-tech-compile.test.ts:64-88` warning "replica: Replica technology differs from its primary (PostgreSQL (RDS))." e os nós e a aresta seguem simulados; `e2e/technologies.spec.ts:146-162` aviso no Props, que some com a mesma tecnologia                                                                              | ⚠️ o aviso só aparece quando primário **e** réplica não são generic (`src/domain/graph/compile.ts:147`); a spec não diz se `generic` conta como "tecnologia diferente". Ver Fix 3. |
| TEC-46 | Só nós `generic` → resultados bit-idênticos (golden sem mudar a fixture)                                   | `u/engine-golden.test.ts` passa e a fixture não mudou na faixa; `u/engine-tech.test.ts:198-206` nós generic sem `limitKind`/`limitUtilization`/`writeRps`; `u/engine-tech-compile.test.ts:90-108` sem warnings novos e sem chave `tech`. O mutante M8 morre: 43 de 44 casos do golden.                                         | ✅                                                                                                                                                                                 |
| TEC-47 | Mesmo grafo com tecnologias + seed + tráfego e faults → deep-equal                                         | `u/engine-tech-properties.test.ts:203-226` analyze e tick deep-equal com faults                                                                                                                                                                                                                                                | ✅                                                                                                                                                                                 |
| TEC-48 | Fora da faixa → padrão da tecnologia; tudo finito e served ≤ offered                                       | `u/technologies.test.ts:919-936` MongoDB shards 5000 → 1, OpenSearch → 5, RF 9 → 3, prefixes 0 → 1; `u/engine-tech-properties.test.ts:88-160` grafos aleatórios: served ≤ offered, finito, p50 ≤ p95 ≤ p99                                                                                                                     | ✅                                                                                                                                                                                 |
| TEC-49 | JS inicial de `/` dentro de +15% da baseline                                                               | `npm run bundle:check`: 615,6 KB contra 551,5 KB = +11,6%, exit 0 (gate; `scripts/bundle-size.mjs`)                                                                                                                                                                                                                            | ✅                                                                                                                                                                                 |
| TEC-50 | Tecnologia gerenciada multi-AZ: redundante no scorer e no advisor, e `zone-failure` não derruba instâncias | `u/technologies.test.ts:1055-1075` `isManagedMultiZone` true para as 8 gerenciadas e false para Kong, Cassandra e generic; `:1077-1093` API Gateway sem SPOF e sem "single instance"; `:1109` `targets).not.toContain("dyn")`; `:1116-1133` instance cards. O advisor usa o mesmo `findSpofs` (`src/advisor/structure.ts:52`). | ✅                                                                                                                                                                                 |
| TEC-51 | Gerenciada: esconde `instances` e capacidade; o custo não multiplica por `instances`                       | `u/technologies.test.ts:811-832` `shown(…)` false para as 8; `u/cost.test.ts:154` `four.monthly).toBe(one.monthly)`; `e2e/technologies.spec.ts:112` DynamoDB sem capacidade. O mutante M6 morre.                                                                                                                               | ✅                                                                                                                                                                                 |

**Status**: ❌ uma AC sem discriminação (TEC-29, mutante vivo), uma AC com uma cláusula sem evidência (TEC-07) e dois spec-precision gaps (TEC-45, TEC-38). As outras 47 batem com a spec.

### Notas do autor, julgadas

- **TEC-11 em `technologies.test.ts`**: aceito. A spec foi emendada para dizer isso, e o mutante M11 morre.
- **TEC-38, burst de cerca de 0,9 s**: aceito como ressalva. `admit` reabastece o bucket e limita a `burst` antes de consumir (`src/engine/core/tech.ts:127-130`). Com o bucket cheio, o reabastecimento do primeiro tick se perde, e o bucket esvazia um tick antes do que no modelo contínuo. A spec não fixa o tempo, então não bloqueia (Fix 4).
- **TEC-07, só o seletor de tecnologia no e2e**: não aceito como cobertura completa. A spec pede os dois seletores desabilitados, e o de classe não tem teste (Fix 2).
- **TEC-45, só com as duas tecnologias não generic**: é uma interpretação razoável, porque um primário Generic não tem produto com que comparar. Mas a spec não diz isso: spec-precision gap (Fix 3).

### SPEC_DEVIATION (5 marcadores na faixa)

Todos divergem do `design.md`, não de uma AC. Nenhum estreita um critério, e cada um registra o motivo.

1. `src/domain/components/technologies/profile.ts:68`: cada estação lista suas instâncias e seu limite, em vez de `primary?` + `mainLimit`. A forma de A.1 não comporta as duas estações do MongoDB. Aceito.
2. `profile.ts:135`: a estação de um serviço com cota recebe `QUOTA_HEADROOM` = 4× a cota. Sem isso, o tráfego admitido na cota saturaria a estação (ρ = 1) e o S3 com 2 prefixos descartaria leituras. Aceito. Efeito colateral: um nó gerenciado na cota quase não mostra fila. Isso bate com TEC-35/37/38 ("excesso = erro").
3. `src/engine/analyze.ts:212` e 4. `src/engine/core/tick.ts:464`: o split leitura/escrita roda com qualquer nó com tecnologia, não só com classes ou throttle, porque todo nó com tecnologia reporta `writeRps` para o custo. Num grafo só generic nada novo roda (o golden passa, e o M8 prova que ele discrimina). Aceito.
4. `tick.ts:271`: `techTickFlow` fica em `tick.ts`, e não em `core/tech.ts`, para evitar um ciclo de imports. Aceito.

Nenhum deles fere uma AC. O `design.md`, porém, ficou desatualizado em A.1, A.2, A.3 e na localização de `techTickFlow` (lição registrada).

---

## Discrimination Sensor

Nível expandido (motor e custo são o núcleo da feature): 13 mutações de comportamento, rodadas num worktree descartável em `HEAD` (o `node_modules` entrou por junção). Cada mutação rodou contra a suíte unitária inteira (1293 testes); depois o arquivo original foi restaurado.

| #   | `file:line`                                         | Mutação                                                                                    | Resultado                                                                                  |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| M1  | `src/domain/components/technologies/profile.ts:216` | Primário SQL com `instances: n` em vez de `shards`                                         | ✅ morto (10 testes: engine-tech, engine-tech-tick, engine-tech-math, properties, advisor) |
| M2  | `src/engine/core/tech.ts:139`                       | Throttle da partição quente proporcional no nó todo (`keep = 1/u`) em vez de h·λ·(1 − 1/U) | ✅ morto (2)                                                                               |
| M3a | `profile.ts:174`                                    | QUORUM k = ⌊RF/2⌋ (sem o +1)                                                               | ✅ morto (4)                                                                               |
| M3b | `profile.ts:174`                                    | QUORUM k = ⌈RF/2⌉ (só difere com RF par)                                                   | ❌ **sobreviveu** (1293/1293), vira o Fix 1                                                |
| M4  | `profile.ts:345`                                    | Limites do S3 sem multiplicar por `prefixes`                                               | ✅ morto (3)                                                                               |
| M5  | `src/domain/components/registry.ts:180`             | `normalizeTechParams` cai na primeira opção (classe errada) em vez da padrão da tecnologia | ✅ morto (1)                                                                               |
| M6  | `src/domain/components/pricing.ts:271`              | Preço por hora de um gerenciado em `perInstanceHour` (× instances)                         | ✅ morto (2: cost TEC-51, technologies TEC-51)                                             |
| M7  | `src/advisor/load.ts:111`                           | O advisor dimensiona instâncias mesmo quando `scalesWithInstances` é false                 | ✅ morto (1: API Gateway na cota)                                                          |
| M8  | `profile.ts:185`                                    | Um nó generic ganha um profile (chave `tech`)                                              | ✅ morto (85 no total; **43 de 44 no `engine-golden.test.ts` sozinho**)                    |
| M9  | `src/engine/core/tech.ts:127`                       | Token bucket do API Gateway sem o burst de 5.000                                           | ✅ morto (2: engine-tech-math, engine-tech-tick)                                           |
| M10 | `src/engine/core/routing.ts:242`                    | Consumidores do Kafka sem o teto de partições                                              | ✅ morto (3)                                                                               |
| M11 | `src/domain/components/technologies/storage.ts:107` | Fonte com URL `http://` (porta do catálogo, TEC-11)                                        | ✅ morto (1)                                                                               |

**Sensor depth**: expandido (≥ 6, núcleo do motor). 12 mortos e 1 vivo (M3b), um mutante que a spec cobre (TEC-29 fixa k = ⌊RF/2⌋ + 1 para RF de 1 a 7).

**Isolamento**: o `git status --porcelain` do repositório real estava vazio antes e continuou vazio depois. O worktree foi removido (`git worktree remove --force` depois de tirar a junção, e então `git worktree prune`). `git worktree list` mostra só o repositório principal.

---

## Conferência de conteúdo (17 linhas, 0 erradas)

Fontes lidas em 2026-10-14. Os preços vieram do AWS Price List (JSON) e as cotas das páginas da AWS.

| Linha                      | Afirmação no catálogo                                                                                                                    | Fonte lida                                                                                                                                                                       | Veredito |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| S3 Standard                | ≥ 5.500 GET/HEAD e 3.500 PUT/COPY/POST/DELETE por prefixo; 503 Slow Down; mediana de dezenas de ms abaixo de 512 KB                      | `optimizing-performance.html` ("at least 3,500 … 5,500 … per partitioned Amazon S3 prefix"); `…-design-patterns.html` ("median latencies are often in the tens of milliseconds") | ✅       |
| AWS API Gateway            | 10.000 req/s + bucket de 5.000, compartilhado por HTTP, REST e WebSocket; HTTP API $1,00/M, REST $3,50/M                                 | `limits.html` (tabela por conta e Região); página de preços                                                                                                                      | ✅       |
| DynamoDB                   | Tabela on-demand com 40.000 RRU e 40.000 WRU; partição com 3.000 RCU e 1.000 WCU; $0,125/M RRU e $0,625/M WRU; eventual 0,5 e forte 1    | `ServiceQuotas.html`, `bp-partition-key-design.html`, página on-demand                                                                                                           | ✅       |
| SQS FIFO                   | 300 chamadas/s por ação e 3.000 msgs/s em lotes; HT de 70.000 TPS e 700.000 msgs/s em us-east-1; $0,50/M                                 | `quotas-messages.html`; Price List `AWSQueueService` ("$0.50 per million … FIFO requests in Tier1")                                                                              | ✅       |
| SQS Standard               | $0,40/M por requisição; 1 MiB por mensagem                                                                                               | Price List ("$0.40 per million … standard requests in Tier1"); `quotas-messages.html` ("maximum is 1,048,576 bytes")                                                             | ✅       |
| SNS                        | Publish em us-east-1: 30.000/s (soft); 9.000 em us-west-2 e eu-west-1; 300 nas outras                                                    | `gr/sns.html` (tabela Publish API throttling)                                                                                                                                    | ✅       |
| PostgreSQL (RDS)           | db.r6g.large/xlarge/2xlarge/4xlarge = 0,225/0,45/0,899/1,798 $/h; failover Multi-AZ de 60–120 s                                          | Price List `rds-postgresql-ondemand` (Single-AZ us-east-1); `Concepts.MultiAZ.Failover.html`                                                                                     | ✅       |
| MySQL (RDS)                | 0,215/0,43/0,859/1,718                                                                                                                   | Price List `rds-mysql-ondemand`                                                                                                                                                  | ✅       |
| Aurora PostgreSQL I/O-Opt. | 0,338/0,675/1,349/2,699; "typically … less than 60 seconds, and often less than 30"                                                      | Price List `rds-aurora-ondemand` ("Aurora IO Optimization Mode"); `Concepts.AuroraHighAvailability.html`                                                                         | ✅       |
| Redis (ElastiCache)        | cache.r6g 0,206/0,411/0,821/1,642; 349k ops/s em r6g.xlarge (Redis 7, 80% GET, 512 B); p50 de 0,44 ms a 142k rps; Valkey 20% mais barato | Price List `AmazonElastiCache`; blog "Enhanced IO multiplexing" (349,239 ops/s; 0.44 ms a 142,000 rps); Valkey 0,6568 vs 0,821                                                   | ✅       |
| Memcached (ElastiCache)    | Mesmo preço do Redis OSS                                                                                                                 | Price List (Memcached 0,821 e 1,642 em 2xlarge e 4xlarge)                                                                                                                        | ✅       |
| Kafka (MSK)                | kafka.m7g.large…4xlarge = 0,204/0,408/0,816/1,632 $/hora de broker                                                                       | Price List `AmazonMSK` (USE1-Kafka.m7g.*)                                                                                                                                        | ✅       |
| HAProxy                    | 2,04M req/s num c6gn.16xlarge de 64 vCPU, corpo de 0 byte                                                                                | Blog da HAProxy ("about 2.04 million RPS … zero-byte body")                                                                                                                      | ✅       |
| Kong                       | 3.16, c5.4xlarge, HTTPS sem plugins 144k; rate limiting + key-auth 102k                                                                  | `developer.konghq.com/gateway/performance/benchmarks` (144,273.5 e 102,088.8)                                                                                                    | ✅       |
| MongoDB                    | Eleição com mediana ≤ 12 s                                                                                                               | `replica-set-elections` ("should not typically exceed 12 seconds")                                                                                                               | ✅       |
| AWS ALB                    | $0,0225/h + $0,008/LCU-h; 1 GB/h por LCU → ≈ $0,033/M a 4 KB                                                                             | Página de preços do ELB; conta: 1e9 ÷ 4096 = 244k req por LCU-h → 0,008 ÷ 0,244 = $0,0328/M                                                                                      | ✅       |
| AWS NLB                    | $0,0225/h + $0,006/NLCU-h → ≈ $0,025/M a 4 KB                                                                                            | Página de preços do ELB; 0,006 ÷ 0,244 = $0,0246/M                                                                                                                               | ✅       |

As derivações de rede também foram conferidas na aritmética: cache.r6g.large a 0,75 Gbps ÷ (1084 B × 8) ≈ 86k e c6g.large a 0,75 Gbps ÷ 4 KB ≈ 22,9k (× 0,9 ≈ 20k).

---

## Code Quality

| Princípio                                                                     | Status                                                                                                    |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Código mínimo / mudanças cirúrgicas                                           | ✅ os ganchos do motor caem na expressão antiga sem `tech` (o golden e o M8 provam)                       |
| Sem scope creep                                                               | ✅ nada fora dos 10 tipos centrais; referências e quick fixes seguem generic                              |
| Segue os padrões                                                              | ✅ `ParamsForm` gerado (`optionsFor`, `omitKeys`), ações com `MUTATING_ACTIONS`, `ModalShell`/`styles.ts` |
| Spec-anchored outcome check                                                   | ❌ TEC-29 (M3b); ⚠️ TEC-07, TEC-45, TEC-38                                                                |
| Cobertura por camada (domínio 1:1 com ACs; e2e no caminho feliz e nas bordas) | ⚠️ falta o caminho da classe desabilitada em aba somente leitura (TEC-07)                                 |
| Todo teste mapeia uma AC                                                      | ✅ os testes nomeiam a AC ou a tarefa (T1–T37) no título                                                  |
| Diretrizes do projeto                                                         | ✅ `CLAUDE.md` (invariantes do motor, golden, stores, runtime metrics, L-014: e2e inteiro rodado)         |

---

## Fix Plans

### Fix 1 (bloqueia): k do QUORUM sem teste com RF par (TEC-29, mutante M3b)

- **Causa**: todo teste de quorum usa RF 3, e ali ⌊RF/2⌋ + 1 = ⌈RF/2⌉ = 2. A implementação (`profile.ts:174`) está certa, mas nada impede a regressão para RF 2, 4 e 6.
- **Tarefa**: em `tests/unit/tech-profile.test.ts`, verificar que Cassandra com `consistencyLevel: "quorum"` dá `kth(2, 2)` com RF 2, `kth(3, 4)` com RF 4 e `kth(4, 6)` com RF 6 (custo de leitura k, de escrita RF). Opcionalmente, um caso em `engine-tech.test.ts` com RF 4 QUORUM e capacidade de leitura `n·k0/3`.
- **Pronto quando**: o M3b (`Math.ceil(rf / 2)`) falha a suíte.
- **Prioridade**: Major.

### Fix 2: seletor de classe desabilitado em aba somente leitura sem teste (TEC-07)

- **Causa**: o e2e abre uma referência, cujos nós são Generic, e por isso o seletor de classe nem aparece. O `disabled` em `TechnologyPicker.tsx:106` (e o do botão Reset em `:171`) não tem teste.
- **Tarefa**: em `tests/e2e/technologies.spec.ts`, deixar uma aba somente leitura com um nó PostgreSQL. Um caminho é `?e2e` + estado da store. Outro é abrir uma referência e trocar a tecnologia de um nó antes de marcar a aba como somente leitura, se houver esse caminho. Depois, verificar que `getByLabel("Instance class")` está `toBeDisabled()`.
- **Prioridade**: Minor.

### Fix 3 (spec-precision, não bloqueia): `generic` conta como tecnologia diferente em TEC-45?

- **Causa**: o código (`compile.ts:147`, `TechnologyPicker.tsx:26`) só avisa quando primário e réplica têm tecnologia não generic. A spec diz só "tecnologia diferente".
- **Tarefa**: emendar TEC-45 para dizer "quando os dois têm tecnologia (≠ `generic`) e elas diferem", e acrescentar um caso negativo (primário Generic com réplica MySQL: sem aviso) em `engine-tech-compile.test.ts`.
- **Prioridade**: Minor.

### Fix 4 (spec-precision, não bloqueia): tempo de absorção do burst (TEC-38)

- **Causa**: `admit` faz `full = min(burst, tokens + L·dt)` antes de consumir. Com o bucket cheio, o reabastecimento do tick se perde, e 15k req/s esvaziam o bucket em cerca de 0,9 s, não nos 1,0 s do token bucket contínuo. A spec não define o tempo.
- **Tarefa**: decidir e registrar. Uma opção é emendar a TEC-38 com a tolerância de 1 tick (e o teste já cobre [0,85; 1,0] s). A outra é consumir antes de limitar (`tokens + L·dt − admitted·dt`, limitado a `burst` depois), com o teste apertado para ≈ 1,0 s.
- **Prioridade**: Cosmetic.

### Observações sem tarefa

- **TEC-09**: o round-trip está provado no envelope. Salvar e carregar em IndexedDB usam o mesmo `serializeNodes`/`deserializeNodes`, então nenhum teste novo é exigido.
- **`design.md`**: está desatualizado em relação aos 5 SPEC_DEVIATION. Vale emendá-lo (A.1 estações, A.2 `QUOTA_HEADROOM`, A.3 `needsSplit` e a localização de `techTickFlow`) quando o Fix 1 for feito.

---

## Requirement Traceability Update

| Requirement                                                | Previous Status | New Status                        |
| ---------------------------------------------------------- | --------------- | --------------------------------- |
| TEC-01…TEC-06, TEC-08…TEC-28, TEC-30…TEC-44, TEC-46…TEC-51 | Implemented     | ✅ Verified                       |
| TEC-07                                                     | Implemented     | ❌ Needs Fix (Fix 2)              |
| TEC-29                                                     | Implemented     | ❌ Needs Fix (Fix 1)              |
| TEC-38                                                     | Implemented     | ✅ Verified, com ressalva (Fix 4) |
| TEC-45                                                     | Implemented     | ✅ Verified, com ressalva (Fix 3) |

(A coluna Status da `spec.md` não foi editada: o orquestrador atualiza depois da re-verificação.)

---

## Summary

**Overall**: ❌ Not Ready. Falta uma correção de teste: Fix 1 é obrigatório e Fix 2 recomendado. O código e o conteúdo estão corretos.

**Spec-anchored check**: 47/51 ACs batem com a spec. TEC-29 não discrimina (mutante vivo); TEC-07 tem uma cláusula sem evidência; TEC-38 e TEC-45 são spec-precision gaps.
**Sensor**: 13 mutações, 12 mortas e 1 viva (M3b).
**Gate**: typecheck, 1293 unit, lint, format, build, bundle +11,6% e 92 e2e: tudo passa.

**What works**: o catálogo (26 opções, 17 linhas conferidas contra as fontes sem erro), a edição (preset, classe, reset, um undo, somente leitura), a paleta, o Ctrl+K e a tag, todas as mecânicas do motor no analyze e no tick com o mesmo número, o custo por tecnologia, o advisor sem fix de instâncias para limites que não escalam, os gerenciados multi-AZ e o golden bit-idêntico (que discrimina: M8 derruba 43 de 44 casos).

**Next steps**: Fix 1 (testes de RF par) e Fix 2 (e2e da classe desabilitada); emendar TEC-45 e TEC-38 na spec; então re-verificar (iteração 2 de 3).
