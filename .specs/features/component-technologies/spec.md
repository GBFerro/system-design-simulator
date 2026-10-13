# Tecnologias dos componentes (spec 1 de 3) — Specification

Oct 12, 2026 · Status: confirmada (2026-10-12); emendas de design em 2026-10-13 (TEC-05, TEC-36, TEC-50, TEC-51) · Escopo: Complex (catálogo + motor + custo + painel + paleta)

## Problem Statement

Cada tipo do catálogo tem hoje um único par capacidade/latência (SQL: 10k rps e 8 ms; NoSQL: 50k rps e 3 ms; Load Balancer: 1M rps e 1 ms) e um único preço. Escolher Cassandra, MongoDB ou DynamoDB, PostgreSQL ou Aurora, ou um balanceador L4 ou L7 só é possível na descrição em texto. O formulário mostra parâmetros que parecem realistas (`consistencyLevel`, `replicationFactor`, `partitions`, `hotPartitionShare`, `writeCapacityRps`, `shards`), mas nenhum deles chega ao motor, ao custo ou ao advisor. O candidato aprende que "um banco NoSQL" é uma caixa com um número e não pratica a escolha que a entrevista cobra: qual tecnologia, por quê, quanto aguenta e quanto custa.

## Goals

- [ ] Os 10 tipos centrais (Load Balancer, API Gateway, SQL Database, Read Replica, NoSQL Database, Cache, Message Queue, Pub/Sub, Search, Object Storage) oferecem tecnologias reais, cada uma com capacidade, latência e preço de fonte publicada e citada.
- [ ] Trocar a tecnologia de um nó muda o resultado da simulação pelos motivos que a distinguem: primário de escrita, partição quente, nível de consistência, partições de consumo, fan-out de shards e limites de serviços gerenciados.
- [ ] Uma classe de instância escala capacidade e preço juntos, e o painel de custo reflete a tecnologia e a classe.
- [ ] Um design só com nós Generic dá resultados bit-idênticos aos de hoje (`engine-golden.test.ts` sem mudar a fixture).

## Out of Scope

| Feature                                                                                          | Reason                                                                                             |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Comportamento CP/AP sob partição ou queda de réplicas (recusar escrita, servir dado velho)       | É a spec 2; aqui a classificação CAP/consistência é só texto.                                      |
| Componentes novos (Serverless function, API externa, Workflow orchestrator)                      | Spec 3.                                                                                            |
| Tecnologias nos 15 tipos com schema genérico (graph-db, timeseries-db, vector-db, reverse-proxy…) | Spec 3.                                                                                            |
| CDN, DNS, Rate Limiter, WAF, App Server e demais tipos fora dos 10 centrais                     | Não estão na lista central; entram depois se a spec 3 os incluir.                                  |
| Migrar as 35 referências para tecnologias reais                                                  | Decisão do usuário: ficam em Generic nesta spec.                                                   |
| Right-size sugerir troca de classe (scale-up)                                                    | O right-size continua sugerindo só instâncias.                                                     |
| Estratégias de escrita do cache (write-through, write-behind) e política de eviction no motor    | Mudam as chamadas entre nós; é outro padrão (já fora do escopo do request-flow).                   |
| Tamanho de payload, banda, armazenamento em GB e custo de transferência                          | O motor não modela bytes; `perGbMonth` continua sem uso.                                           |
| Multi-AZ, multi-região, preço reservado/savings plans                                            | O preço é on-demand, us-east-1, single-AZ, como na tabela atual.                                   |
| Regras novas de score ou de advisor específicas de tecnologia                                    | O score medido já reflete as mecânicas pelo `analyze()`; regras novas são outra spec.              |

---

## Assumptions & Open Questions

| Assumption / decision                       | Chosen default                                                                                                                                                                                                                                                                                                         | Rationale                                                                                                                                         | Confirmed? |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Fatiamento                                  | Spec 1 de 3: tecnologias, números, classe e mecânicas nos tipos centrais. Spec 2: CAP sob falha. Spec 3: componentes novos e genéricos.                                                                                                                                                                                | Decisão do usuário (ver `context.md`).                                                                                                            | y          |
| Modelo da variante                          | Parâmetro `technology` no tipo existente; a paleta mostra as tecnologias como atalhos que criam o tipo já com a tecnologia                                                                                                                                                                                             | Decisão do usuário: score, faults, drills, advisor e referências seguem lendo o tipo, sem migração de id.                                        | y          |
| Classe de instância                         | Parâmetro `instanceClass` para tecnologias provisionadas, com capacidade e preço por classe; tecnologias gerenciadas por requisição não têm classe e cobram por requisição                                                                                                                                             | Decisão do usuário; ensina scale-up vs scale-out.                                                                                                 | y          |
| Referências                                 | Ficam em Generic                                                                                                                                                                                                                                                                                                       | Decisão do usuário.                                                                                                                               | y          |
| Designs salvos                              | Nó sem `technology` (ou com valor desconhecido) resolve para `generic`, com os números e o comportamento de hoje; sem migração nem mudança de `SCHEMA_VERSION`                                                                                                                                                         | Param novo com padrão neutro não precisa de migração (`sanitizeParams`); mantém o golden bit-idêntico.                                           | y          |
| Nó novo                                     | Um nó criado pela paleta, pela busca ou pelo menu nasce com a tecnologia padrão do tipo (abaixo); `generic` continua selecionável ("Generic — custom numbers")                                                                                                                                                         | O objetivo é realismo para o que se desenha daqui em diante; o padrão do schema segue `generic` por compatibilidade.                             | y          |
| Trocar de tecnologia                        | Sobrescreve os parâmetros que a tecnologia define (capacidade, latência, classe, consistência, limites) com os da nova; preserva `instances`, timeouts, retries e os demais; um passo de undo; trocar para Generic mantém os números atuais                                                                           | Trocar de banco é trocar o que o banco aguenta; instâncias e resiliência são decisões do desenho.                                                | y          |
| Tecnologias por tipo                        | LB: NLB (L4), ALB (L7), HAProxy (L7), Envoy (L7). API Gateway: AWS API Gateway (HTTP API), Kong. SQL e Read Replica: PostgreSQL (RDS), MySQL (RDS), Aurora PostgreSQL. NoSQL: DynamoDB (on-demand), Cassandra, ScyllaDB, MongoDB. Cache: Redis (ElastiCache), Memcached (ElastiCache). Message Queue: Kafka (MSK), RabbitMQ (Amazon MQ), SQS Standard, SQS FIFO. Pub/Sub: SNS, Kafka (MSK). Search: OpenSearch. Object Storage: S3 Standard. Todos também com Generic | As mais cobradas em entrevista e com benchmarks e preços públicos; tudo AWS us-east-1 para casar com a tabela de preços atual.                  | y          |
| Tecnologia padrão de um nó novo             | LB: ALB. API Gateway: AWS API Gateway. SQL e Read Replica: PostgreSQL. NoSQL: DynamoDB. Cache: Redis. Message Queue: Kafka. Pub/Sub: SNS. Search: OpenSearch. Object Storage: S3                                                                                                                                       | A escolha mais comum de cada tipo.                                                                                                                | y          |
| Origem dos números                          | Benchmark publicado (fabricante, paper ou benchmark independente reproduzível) ou cota/limite documentado pelo provedor; quando as fontes divergem, o valor conservador para uma carga típica (itens de ~1 KB, mix de leitura/escrita declarado), com a carga escrita nas premissas da linha                           | Pedido do usuário: "perto dos benchmarks já feitos"; o conteúdo ensina e tem de ser defensável.                                                   | y          |
| Preços                                      | AWS us-east-1 on-demand, data da consulta registrada; a versão da tabela de preços sobe (`PRICE_TABLE.version`)                                                                                                                                                                                                         | Mesmo critério da tabela atual (Spec 10).                                                                                                         | y          |
| Mecânicas só fora de Generic                | As mecânicas novas (primário de escrita, partição quente, consistência, partições de consumo, fan-out, prefixos, cotas) valem só quando `technology` ≠ `generic`; params existentes que hoje ninguém lê continuam sem efeito em Generic                                                                                | A fixture do golden congela esses params com os valores de hoje; ligá-los em Generic mudaria todos os resultados.                                | y          |
| Classificação CAP nesta spec                | Texto por tecnologia (ex.: "Cassandra — AP, consistência ajustável por requisição"); para bancos SQL de primário único, o texto descreve o modelo (primário único, réplicas assíncronas) em vez de forçar uma letra                                                                                                    | CAP fala de sistemas distribuídos sob partição; uma letra forçada para um Postgres de nó único ensinaria errado.                                 | y          |
| Read Replica com tecnologia diferente do primário | Permitido, com aviso no Props e um warning do compilador                                                                                                                                                                                                                                                        | Réplica de MySQL ligada a um Postgres não existe, mas bloquear a conexão seria uma regra nova de edição.                                         | y          |
| Idioma                                      | Textos da interface em inglês (nomes, descrições, avisos); prosa da spec em português                                                                                                                                                                                                                                 | Mesmo padrão das specs anteriores.                                                                                                                | y          |
| Prefixo dos requisitos                      | `TEC`                                                                                                                                                                                                                                                                                                                  | Três letras, como CAN, TRF, OBS, CHS, FLW.                                                                                                       | y          |

**Open questions:** none - all resolved or logged above (required before the spec is confirmed).

---

## User Stories

### P1: Escolher a tecnologia de um nó ⭐ MVP

**User Story**: Como candidato, quero escolher a tecnologia real de um componente (ex.: Cassandra num NoSQL, ALB num Load Balancer) e ver de onde vêm os números, para praticar a escolha de tecnologia que a entrevista cobra.

**Why P1**: É o pedido central; sem isso os outros itens não têm onde morar.

**Acceptance Criteria**:

1. The schema de cada um dos 10 tipos centrais SHALL ter um parâmetro `technology` (enum) com `generic` e as tecnologias listadas nas premissas, e o padrão do schema SHALL ser `generic`. <!-- TEC-01 -->
2. WHEN o usuário escolhe uma tecnologia no Props de um nó THEN o sistema SHALL gravar nos params do nó os valores dessa tecnologia (e da sua classe padrão, quando tiver classe) para capacidade por instância, tempo de serviço e cada parâmetro que a tecnologia define, SHALL preservar `instances` e os parâmetros que ela não define, e SHALL criar exatamente uma entrada de undo. <!-- TEC-02 -->
3. WHEN o usuário escolhe a tecnologia que o nó já tem THEN o sistema SHALL não alterar o nó nem criar entrada de undo. <!-- TEC-03 -->
4. WHEN o usuário troca uma tecnologia por `generic` THEN o sistema SHALL manter os valores atuais de capacidade, tempo de serviço e demais params. <!-- TEC-04 -->
5. The Props SHALL mostrar, abaixo do seletor, para a tecnologia escolhida: uma descrição de uma linha do seu propósito, a classificação de consistência/CAP em texto, e a linha "Based on: <fonte>, <ano>" com link para a fonte, seguida de "(measured)", "(derived)" ou "(estimate)" conforme a evidência da linha da tabela. <!-- TEC-05 -->
6. The seletor de tecnologia SHALL mostrar para cada opção o nome e, entre parênteses, a camada ou o modo quando a tecnologia tiver um (ex.: "AWS NLB (L4)", "AWS ALB (L7)", "DynamoDB (on-demand)"). <!-- TEC-06 -->
7. WHILE a aba ativa é somente leitura, the Props SHALL mostrar o seletor de tecnologia e o de classe desabilitados, e a ação de troca SHALL ser no-op. <!-- TEC-07 -->
8. IF o valor salvo de `technology` não é uma opção do tipo THEN o sistema SHALL resolvê-lo para `generic` (`sanitizeParams`). <!-- TEC-08 -->
9. The sistema SHALL guardar `technology` e `instanceClass` em `data.params`, de modo que salvar, carregar, exportar e importar JSON (envelope v4) devolva os mesmos valores, sem mudar `SCHEMA_VERSION`. <!-- TEC-09 -->

**Independent Test**: Arrastar um NoSQL, escolher Cassandra: capacidade e latência mudam para os valores da tabela, aparece "Based on: …", Ctrl+Z volta ao estado anterior num passo. Teste unitário: `sanitizeParams` com `technology: "oracle"` devolve `generic`; round-trip do envelope preserva `technology`/`instanceClass`.

---

### P1: Números de benchmark com fonte ⭐ MVP

**User Story**: Como candidato, quero que a capacidade, a latência e o preço de cada tecnologia venham de benchmarks e preços publicados, para que o que aprendo no simulador valha numa entrevista.

**Why P1**: Sem números defensáveis, a tecnologia é só um rótulo.

**Acceptance Criteria**:

1. The sistema SHALL definir cada tecnologia (e cada classe dela) num único módulo de dados com: capacidade por instância (req/s), tempo médio de serviço (ms), os params que ela fixa, preço (por instância-hora ou por milhão de requisições), a fonte (título, URL, ano) e as premissas de carga (tamanho de item, mix de leitura/escrita, configuração do benchmark). <!-- TEC-10 -->
2. The `catalog.test.ts` SHALL falhar quando uma tecnologia não-generic não tiver fonte com URL `https://`, ano, premissas não vazias e números finitos e positivos. <!-- TEC-11 -->
3. The sistema SHALL tratar `generic` como a linha "Generic — custom numbers", cujos valores são os padrões atuais do catálogo (`maxQPS`, `latencyMs`) e cujo preço é o da tabela atual. <!-- TEC-12 -->
4. The `PRICE_TABLE` SHALL registrar a nova versão e a data da consulta dos preços por tecnologia. <!-- TEC-13 -->

**Independent Test**: `catalog.test.ts` percorre todas as tecnologias e checa fonte, premissas e números; uma linha sem URL faz o teste falhar.

---

### P1: Classe de instância ⭐ MVP

**User Story**: Como candidato, quero escolher o tamanho da máquina de uma tecnologia provisionada e ver capacidade e custo mudarem juntos, para comparar crescer a máquina com adicionar máquinas.

**Why P1**: Decisão do usuário; sem ela o custo de uma tecnologia é um número fixo.

**Acceptance Criteria**:

1. WHERE a tecnologia é provisionada (cobra por instância-hora), the Props SHALL mostrar o seletor `instanceClass` com as classes dessa tecnologia (nome real da classe, ex.: `db.r6g.xlarge`), e SHALL escondê-lo para tecnologias cobradas por requisição e para `generic`. <!-- TEC-14 -->
2. WHEN o usuário troca a classe THEN o sistema SHALL gravar a capacidade por instância e o tempo de serviço dessa classe (e os params que a classe define), SHALL preservar o resto, e SHALL criar exatamente uma entrada de undo. <!-- TEC-15 -->
3. IF o valor salvo de `instanceClass` não é uma classe da tecnologia do nó THEN o sistema SHALL resolvê-lo para a classe padrão dessa tecnologia. <!-- TEC-16 -->
4. The custo mensal de um nó com tecnologia provisionada SHALL ser `instances` × preço/hora da classe × 730 (mais as parcelas fixas e por requisição da tecnologia, quando houver). <!-- TEC-17 -->
5. The custo mensal de um nó com tecnologia cobrada por requisição SHALL usar os preços de leitura e de escrita da tecnologia separadamente, com a carga de leitura e de escrita que o nó recebe no snapshot (o mix que o motor resolveu). <!-- TEC-18 -->
6. The CostPanel SHALL mostrar nas premissas do nó a tecnologia, a classe (quando houver) e a origem do preço. <!-- TEC-19 -->

**Independent Test**: Postgres com `db.r6g.large` → `db.r6g.2xlarge`: a capacidade sobe e o $/mês sobe na proporção da tabela; DynamoDB não mostra classe e o custo cresce com o req/s do snapshot.

---

### P1: Tecnologias na paleta ⭐ MVP

**User Story**: Como candidato, quero encontrar "Cassandra" ou "ALB" direto na paleta, para desenhar com o vocabulário da entrevista.

**Why P1**: Decisão do usuário (param + paleta); é como a tecnologia fica visível.

**Acceptance Criteria**:

1. The paleta SHALL mostrar, em cada um dos 10 tipos centrais, um controle que expande a lista das tecnologias do tipo (sem `generic`), fechada por padrão. <!-- TEC-20 -->
2. WHEN o usuário arrasta (mouse ou toque) ou ativa uma tecnologia da paleta THEN o sistema SHALL criar um nó do tipo com essa tecnologia e os params dela e da classe padrão, pelo mesmo caminho de criação (`lib/nodeFactory.ts`, `placeNode`). <!-- TEC-21 -->
3. WHEN o usuário cria um nó de um tipo central pela entrada do tipo (paleta, busca ou menu de contexto) THEN o sistema SHALL criá-lo com a tecnologia padrão do tipo (premissas). <!-- TEC-22 -->
4. WHEN o usuário busca o nome de uma tecnologia na Command Palette (Ctrl/Cmd+K) ou na busca da paleta THEN o sistema SHALL listar a tecnologia, e escolhê-la SHALL criar o nó como em TEC-21. <!-- TEC-23 -->
5. The nó no canvas SHALL mostrar o nome curto da tecnologia (ex.: "Cassandra", "ALB · L7") com tamanho fixo, sem mudar as dimensões do nó. <!-- TEC-24 -->

**Independent Test**: E2E: expandir NoSQL na paleta, arrastar Cassandra; o nó mostra "Cassandra" e o Props mostra a tecnologia. Ctrl+K "scylla" cria um NoSQL com ScyllaDB.

---

### P2: Primário de escrita em bancos SQL

**User Story**: Como candidato, quero que as escritas de um PostgreSQL, MySQL ou Aurora esbarrem no primário mesmo com muitas instâncias, para aprender que réplicas escalam leituras e não escritas.

**Why P2**: É a diferença mais cobrada entre escalar leitura e escrita num banco relacional.

**Acceptance Criteria**:

1. WHILE a tecnologia de um SQL Database não é `generic`, the motor SHALL atender as escritas do nó com capacidade `shards` × capacidade de escrita da classe, independente de `instances`, e as leituras com `instances` × capacidade de leitura da classe. <!-- TEC-25 -->
2. WHEN as escritas oferecidas a esse nó passam de `shards` × capacidade de escrita THEN o motor SHALL acumular o excesso de escrita em fila até `maxQueue` e descartar o resto, e aumentar `instances` SHALL não aumentar a vazão de escrita. <!-- TEC-26 -->
3. WHEN a fault `db-primary-failure` atinge um SQL Database com tecnologia THEN o motor SHALL usar o `failoverSec` da tecnologia (ex.: Aurora menor que RDS Multi-AZ, conforme a fonte). <!-- TEC-27 -->

**Independent Test**: Unitário em `analyze()`: PostgreSQL com 1 shard, 8 instâncias, escritas acima da capacidade de escrita da classe → escritas saturam; dobrar `instances` não muda a vazão de escrita; dobrar `shards` dobra.

---

### P2: Partição quente e consistência em NoSQL

**User Story**: Como candidato, quero que DynamoDB, Cassandra, ScyllaDB e MongoDB respondam à chave quente e ao nível de consistência como na vida real, para entender por que a chave de partição e o QUORUM importam.

**Why P2**: Dá sentido aos params que hoje estão no formulário sem efeito.

**Acceptance Criteria**:

1. WHILE a tecnologia de um NoSQL Database não é `generic`, the motor SHALL limitar a vazão do nó para que a partição mais quente (que recebe `hotPartitionShare` das requisições) não passe da capacidade por partição da tecnologia, e SHALL contar o excesso como requisições com erro (throttling). <!-- TEC-28 -->
2. WHERE a tecnologia é Cassandra ou ScyllaDB, the Props SHALL oferecer `consistencyLevel` ONE, QUORUM e ALL e `replicationFactor` de 1 a 7, e o motor SHALL dar a cada leitura a latência da k-ésima réplica mais rápida entre `replicationFactor` (k = 1, ⌊RF/2⌋ + 1 ou RF) e SHALL consumir k operações de réplica por leitura e RF por escrita. <!-- TEC-29 -->
3. WHEN o nível de consistência de um Cassandra com RF = 3 sobe de ONE para QUORUM e de QUORUM para ALL, com tudo o mais igual THEN o p99 de leitura do nó SHALL não diminuir e a capacidade de leitura do nó SHALL não aumentar. <!-- TEC-30 -->
4. WHERE a tecnologia é DynamoDB, the Props SHALL oferecer leituras "eventually consistent" e "strongly consistent", e uma leitura forte SHALL custar o dobro de unidades de leitura de uma eventual (na capacidade por partição e no preço). <!-- TEC-31 -->
5. WHERE a tecnologia é MongoDB, the Props SHALL oferecer read preference `primary` e `secondaryPreferred` e write concern `1` e `majority`; com `primary` as leituras SHALL ser atendidas só pelos primários (um por shard), com `secondaryPreferred` por todos os membros, e `majority` SHALL somar à latência de escrita o tempo de replicação para a maioria. <!-- TEC-32 -->
6. WHERE a tecnologia não oferece um parâmetro de consistência (ex.: `consistencyLevel` no DynamoDB), the Props SHALL escondê-lo. <!-- TEC-33 -->

**Independent Test**: Unitário: DynamoDB com `hotPartitionShare` alto satura antes da capacidade total e mostra erros; Cassandra RF 3 ONE → QUORUM → ALL com p99 não decrescente; DynamoDB forte custa 2× por leitura.

---

### P2: Limites de filas, busca, armazenamento e API Gateway gerenciados

**User Story**: Como candidato, quero que Kafka, SQS, RabbitMQ, OpenSearch, S3 e o API Gateway da AWS tenham os limites que derrubam sistemas reais, para aprender onde está o gargalo de cada um.

**Why P2**: Esses limites (partições de consumo, cotas por prefixo, throttle de conta) são perguntas clássicas de entrevista.

**Acceptance Criteria**:

1. WHILE a tecnologia de uma Message Queue ou Pub/Sub é Kafka, the motor SHALL drenar cada aresta de consumo com no máximo min(`consumers`, `partitions`) consumidores. <!-- TEC-34 -->
2. WHILE a tecnologia de uma Message Queue é SQS FIFO ou RabbitMQ, ou a de um Pub/Sub é SNS, the motor SHALL limitar a vazão de entrada ao teto de mensagens por segundo da tecnologia (cota documentada para SQS FIFO e SNS; benchmark por fila para RabbitMQ) e SHALL contar o excesso como erro. <!-- TEC-35 -->
3. WHILE a tecnologia de um Search é OpenSearch, the motor SHALL dar a cada consulta a latência da mais lenta entre `shards` amostras do tempo de serviço (fan-out) e SHALL dar ao nó a capacidade de consulta min(`instances`, `shards` × (`replicas` + 1)) × capacidade por nó ÷ `shards` (réplicas só aumentam a vazão quando há nós para recebê-las). <!-- TEC-36 -->
4. WHILE a tecnologia de um Object Storage é S3, the motor SHALL limitar o nó a 5.500 GET/s e 3.500 PUT/s por prefixo, multiplicados pelo parâmetro `prefixes` (1 a 1.000), e SHALL contar o excesso como erro (503 SlowDown). <!-- TEC-37 -->
5. WHILE a tecnologia de um API Gateway é AWS API Gateway, the motor SHALL limitar o nó à cota de throttling da conta (req/s em regime e burst, valores da cota documentada) e SHALL contar o excesso como erro (429). <!-- TEC-38 -->
6. WHILE a tecnologia de um Load Balancer é AWS NLB, the Props SHALL oferecer só o algoritmo `hash` (flow hash) e um valor salvo diferente SHALL resolver para `hash`; para as tecnologias L7, o Props SHALL oferecer só os algoritmos que a tecnologia suporta. <!-- TEC-39 -->

**Independent Test**: Unitário: Kafka com 12 consumidores e 6 partições drena como 6; S3 com 1 prefixo e 10.000 GET/s → ~4.500 req/s de erro; OpenSearch com 1 → 8 shards tem p99 não decrescente.

---

### P2: Ver o limite que a tecnologia impõe

**User Story**: Como candidato, quero que o nó diga qual limite da tecnologia está segurando a vazão (primário de escrita, partição quente, partições de consumo, cota), para saber o que mudar no desenho.

**Why P2**: Sem isso o candidato vê erro ou fila e não sabe a causa.

**Acceptance Criteria**:

1. WHEN uma mecânica de TEC-25…TEC-38 limita um nó no snapshot (utilização do recurso limitante ≥ 1) THEN o NodeInsightCard SHALL nomear o recurso (ex.: "Write primary", "Hot partition", "Consumers capped by partitions", "S3 prefix limit", "Account throttle") e a utilização dele em %. <!-- TEC-40 -->
2. The snapshot SHALL levar a utilização do recurso limitante de cada nó com tecnologia em `runtimeStore` (nunca em `node.data`), e SHALL ser o mesmo número no `analyze()` e no tick. <!-- TEC-41 -->
3. The advisor SHALL usar, para decidir que um nó com tecnologia está quente ou saturado, a mesma utilização do recurso limitante que o motor reporta. <!-- TEC-42 -->

**Independent Test**: Simular Postgres com escritas acima do primário: o card mostra "Write primary 130%"; o advisor marca o nó como saturado.

---

### P3: Valores editados à mão

**User Story**: Como candidato, quero saber quando mexi nos números de uma tecnologia e poder voltar aos valores do benchmark.

**Why P3**: Útil, mas o fluxo principal funciona sem.

**Acceptance Criteria**:

1. WHILE a capacidade por instância ou o tempo de serviço de um nó com tecnologia difere dos valores da tecnologia e classe atuais, the Props SHALL mostrar "Modified from <tecnologia> <classe>" com a ação "Reset to benchmark". <!-- TEC-43 -->
2. WHEN o usuário aciona "Reset to benchmark" THEN o sistema SHALL regravar os valores da tecnologia e classe atuais num passo de undo. <!-- TEC-44 -->

---

## Edge Cases

- IF um nó Read Replica tem tecnologia diferente do SQL Database que o alimenta THEN o Props SHALL mostrar o aviso "Replica technology differs from its primary (<x>)" e o compilador SHALL emitir um warning, sem bloquear. <!-- TEC-45 -->
- IF um design tem só nós `generic` THEN o motor SHALL produzir resultados bit-idênticos aos de hoje (`engine-golden.test.ts` passa sem mudar a fixture). <!-- TEC-46 -->
- The motor SHALL produzir resultados deep-equal para o mesmo grafo com tecnologias, a mesma seed e o mesmo padrão de tráfego e faults. <!-- TEC-47 -->
- IF uma mecânica de tecnologia recebe `shards`, `partitions`, `prefixes`, `replicationFactor` ou `consumers` fora da faixa THEN `sanitizeParams` SHALL trocar pelo padrão da tecnologia, e todo número reportado SHALL continuar finito com served ≤ offered. <!-- TEC-48 -->
- WHEN `npm run bundle:check` roda depois do build THEN o JS inicial de `/` SHALL ficar dentro do limite de +15% da baseline atual. <!-- TEC-49 -->
- WHERE a tecnologia de um nó é um serviço gerenciado multi-AZ (DynamoDB, S3, SQS Standard, SQS FIFO, SNS, AWS API Gateway, AWS NLB, AWS ALB), o scorer e o advisor SHALL tratá-lo como redundante (nunca SPOF) e a fault `zone-failure` SHALL não derrubar instâncias dele, como já fazem para `MANAGED_MULTI_ZONE`. <!-- TEC-50 -->
- WHERE a tecnologia de um nó é um serviço gerenciado, the Props SHALL esconder `instances` e capacidade por instância, e o custo SHALL não multiplicar o preço por `instances`. <!-- TEC-51 -->

### Dimensões implícitas

| Dimensão                      | Tratamento                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| Validação e limites           | TEC-08, TEC-16, TEC-39, TEC-48.                                                                    |
| Falha / falha parcial         | Throttling, cotas e saturação viram erros contados (TEC-28, TEC-35, TEC-37, TEC-38); failover por tecnologia (TEC-27). CP/AP sob falha: spec 2. |
| Idempotência / repetição      | TEC-03 (mesma tecnologia não cria entrada de undo).                                                |
| Autorização e rate limits     | Cotas dos serviços gerenciados (TEC-35, TEC-37, TEC-38). Autorização: N/A, o app é 100% cliente e sem contas. |
| Concorrência / ordem          | Aba somente leitura (TEC-07); determinismo (TEC-47). Edição concorrente: N/A, editor de um usuário só. |
| Ciclo de vida dos dados       | Persistência e import/export dos params novos (TEC-09); sem migração (premissa). TTL/expiração: N/A. |
| Observabilidade               | TEC-40, TEC-41.                                                                                    |
| Falha de dependência externa  | N/A: não há chamadas externas; os preços e benchmarks são dados estáticos versionados.             |
| Integridade de transições     | Trocas de tecnologia e de classe (TEC-02, TEC-04, TEC-15).                                         |

---

## Requirement Traceability

| Requirement ID | Story                                  | Phase  | Status  |
| -------------- | -------------------------------------- | ------ | ------- |
| TEC-01         | P1: Escolher a tecnologia              | Design | Pending |
| TEC-02         | P1: Escolher a tecnologia              | Design | Pending |
| TEC-03         | P1: Escolher a tecnologia              | Design | Pending |
| TEC-04         | P1: Escolher a tecnologia              | Design | Pending |
| TEC-05         | P1: Escolher a tecnologia              | Design | Pending |
| TEC-06         | P1: Escolher a tecnologia              | Design | Pending |
| TEC-07         | P1: Escolher a tecnologia              | Design | Pending |
| TEC-08         | P1: Escolher a tecnologia              | Design | Pending |
| TEC-09         | P1: Escolher a tecnologia              | Design | Pending |
| TEC-10         | P1: Números de benchmark               | Design | Pending |
| TEC-11         | P1: Números de benchmark               | Design | Pending |
| TEC-12         | P1: Números de benchmark               | Design | Pending |
| TEC-13         | P1: Números de benchmark               | Design | Pending |
| TEC-14         | P1: Classe de instância                | Design | Pending |
| TEC-15         | P1: Classe de instância                | Design | Pending |
| TEC-16         | P1: Classe de instância                | Design | Pending |
| TEC-17         | P1: Classe de instância                | Design | Pending |
| TEC-18         | P1: Classe de instância                | Design | Pending |
| TEC-19         | P1: Classe de instância                | Design | Pending |
| TEC-20         | P1: Tecnologias na paleta              | Design | Pending |
| TEC-21         | P1: Tecnologias na paleta              | Design | Pending |
| TEC-22         | P1: Tecnologias na paleta              | Design | Pending |
| TEC-23         | P1: Tecnologias na paleta              | Design | Pending |
| TEC-24         | P1: Tecnologias na paleta              | Design | Pending |
| TEC-25         | P2: Primário de escrita SQL            | Design | Pending |
| TEC-26         | P2: Primário de escrita SQL            | Design | Pending |
| TEC-27         | P2: Primário de escrita SQL            | Design | Pending |
| TEC-28         | P2: Partição quente e consistência     | Design | Pending |
| TEC-29         | P2: Partição quente e consistência     | Design | Pending |
| TEC-30         | P2: Partição quente e consistência     | Design | Pending |
| TEC-31         | P2: Partição quente e consistência     | Design | Pending |
| TEC-32         | P2: Partição quente e consistência     | Design | Pending |
| TEC-33         | P2: Partição quente e consistência     | Design | Pending |
| TEC-34         | P2: Limites gerenciados                | Design | Pending |
| TEC-35         | P2: Limites gerenciados                | Design | Pending |
| TEC-36         | P2: Limites gerenciados                | Design | Pending |
| TEC-37         | P2: Limites gerenciados                | Design | Pending |
| TEC-38         | P2: Limites gerenciados                | Design | Pending |
| TEC-39         | P2: Limites gerenciados                | Design | Pending |
| TEC-40         | P2: Ver o limite                       | Design | Pending |
| TEC-41         | P2: Ver o limite                       | Design | Pending |
| TEC-42         | P2: Ver o limite                       | Design | Pending |
| TEC-43         | P3: Valores editados à mão             | Design | Pending |
| TEC-44         | P3: Valores editados à mão             | Design | Pending |
| TEC-45         | Edge cases                             | Design | Pending |
| TEC-46         | Edge cases                             | Design | Pending |
| TEC-47         | Edge cases                             | Design | Pending |
| TEC-48         | Edge cases                             | Design | Pending |
| TEC-49         | Edge cases                             | Design | Pending |
| TEC-50         | Edge cases                             | Design | Pending |
| TEC-51         | Edge cases                             | Design | Pending |

**Coverage:** 51 total, 0 mapped to tasks, 51 unmapped ⚠️ (Tasks ainda não criadas)

---

## Success Criteria

- [ ] Os 10 tipos centrais oferecem ao todo 26 opções de tecnologia não-generic (contando as de Read Replica à parte), cada uma com fonte citada, e `catalog.test.ts` checa todas.
- [ ] Em Analyze, trocar um NoSQL de DynamoDB para Cassandra QUORUM, ou um SQL de 8 para 16 instâncias com escritas saturadas, muda o resultado pelo motivo descrito na spec, e o NodeInsightCard nomeia esse motivo.
- [ ] `engine-golden.test.ts`, `scoring.test.ts`, `data.test.ts` e `advisor.test.ts` passam sem mudar fixtures nem referências.
- [ ] Nenhum número de tecnologia diverge da fonte citada além das premissas de carga escritas na linha (checado pelo Verifier por amostragem de fontes).
