# Tecnologias dos componentes — Context

**Gathered:** 2026-10-12
**Spec:** `.specs/features/component-technologies/spec.md`
**Status:** Ready for design

---

## Feature Boundary

Os tipos centrais do catálogo (Load Balancer, API Gateway, SQL Database, Read Replica, NoSQL Database, Cache, Message Queue, Pub/Sub, Search, Object Storage) ganham uma tecnologia real (ex.: NLB L4, ALB L7; PostgreSQL, MySQL, Aurora; Cassandra, ScyllaDB, MongoDB, DynamoDB; Redis, Memcached; Kafka, RabbitMQ, SQS) com capacidade, latência e preço tirados de benchmarks publicados e da tabela de preços da AWS, uma classe de instância que escala capacidade e preço juntos, e o comportamento que distingue a tecnologia no motor (primário de escrita, partição quente, nível de consistência, partições de consumo, fan-out de shards, limites de serviços gerenciados). É a spec 1 de 3.

---

## Implementation Decisions

### Fatiamento

- Três specs em sequência, cada uma verificada e mergeada antes da próxima:
  1. **Esta:** tecnologias, números de benchmark, classe de instância e mecânicas do motor nos tipos centrais.
  2. CAP e consistência sob falha (CP recusa, AP serve dado velho, métrica de leituras stale).
  3. Componentes novos (Serverless function, API externa de terceiros, Workflow orchestrator) e tecnologias nos 15 tipos que hoje usam o schema genérico.

### Modelo da variante

- A tecnologia é um parâmetro do tipo (`technology`), não um componente novo. O tipo continua um só (`nosql-db`), então score, faults, drills, advisor e referências seguem lendo o tipo sem migração de id.
- A paleta mostra as tecnologias como atalhos: arrastar "Cassandra" cria um `nosql-db` já com Cassandra.

### Profundidade

- Números de benchmark + mecânicas no motor nesta spec; o comportamento CP/AP sob falha é da spec 2. Nesta spec a classificação CAP/consistência de cada tecnologia aparece como texto informativo.

### Números e instância

- Classe de instância por tecnologia para o que é provisionado (RDS, ElastiCache, Cassandra em EC2…), com capacidade de benchmark e preço AWS por classe. Serviços gerenciados por requisição (DynamoDB on-demand, S3, SQS, API Gateway) usam limites e preço por requisição, sem classe.

### Referências

- As 35 referências ficam em Generic nesta spec (números e comportamento de hoje); só designs novos usam tecnologias.

### Agent's Discretion

- Quais tecnologias entram em cada tipo e qual é a padrão de um nó novo (registrado nas premissas da spec; o usuário revisa).
- Forma dos atalhos na paleta (grupo expansível por tipo e busca).
- Fórmulas das mecânicas e números exatos (Design, com pesquisa de benchmarks e fonte citada).

### Declined / Undiscussed Gray Areas → Assumptions

- Designs salvos e nós sem tecnologia carregam como Generic, bit-idênticos aos de hoje (premissa anunciada, sem objeção).
- Trocar de tecnologia sobrescreve os parâmetros que ela define e preserva instâncias, num passo de undo (premissa anunciada, sem objeção).

---

## Specific References

- "um loadbalancer pode ser de camada L4 ou camada L7, um NoSQL pode ser Mongo ou Cassandra ou outro e cada um tem um objetivo e uma relação CAP, mesma coisa com SQL" — pedido original.
- "capacidades, throughput, latencia etc perto dos benchmarks já feitos" — números com fonte publicada.

---

## Deferred Ideas

- Spec 2: CAP e consistência sob partição e queda de réplicas.
- Spec 3: Serverless function, API externa, Workflow orchestrator; tecnologias para graph-db, timeseries-db, vector-db, reverse-proxy, distributed-lock, coordination-service e os demais genéricos.
- Migrar as referências para tecnologias reais (decidido: fora desta spec).
- Right-size sugerir troca de classe (scale-up) além de instâncias.
