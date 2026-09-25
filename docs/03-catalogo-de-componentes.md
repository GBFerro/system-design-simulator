# Spec 03: Catálogo de componentes e regras de aresta

Parte da [v2](00-visao-geral.md) · Fase 1 (CMP-03/04 na Fase 6) · Status: rascunho

| Campo | Valor |
| --- | --- |
| Requisitos | CMP-01 (P0), CMP-02 (P0), CMP-03 (P1), CMP-04 (P1), regras de aresta |
| Depende de | Nada; é a base da [Spec 04](04-motor-de-simulacao.md) |
| Consumida por | 04 (motor), 05 (migração), 08 (chaos), 10 (preços) |
| Arquivos principais | `data/components.ts`, novo `domain/components/` (registry + schemas), `types/`, aba Props do painel |

## Objetivo

Trocar os três números fixos por nó (`maxQPS`, `latencyMs`, `replicas`) por um schema de parâmetros por tipo, que gera o formulário do painel, os defaults e os insumos do motor e do custo. Trocar o "fan-out 100% para cada filho" por uma regra de chamada em cada aresta.

## Requisitos

1. **CMP-01 (P0)** Cada tipo declara um schema de parâmetros (`ParamSpec[]`) que gera o formulário do painel e os valores default. Nada de formulário escrito à mão.
2. **CMP-02 (P0)** Os componentes atuais continuam (os ids são usados por `problems.ts`, `conceptLibrary.ts` e `learningPath.ts`). Novos: Client/Traffic Source, Worker Pool, WAF, Read Replica explícita, DLQ, Autoscaler.
3. **CMP-03 (P1)** Presets por tecnologia (Redis, Memcached, Postgres, DynamoDB, Kafka, RabbitMQ, SQS) que só preenchem defaults do schema.
4. **CMP-04 (P1)** Componente custom com schema próprio (hoje só tem label, QPS e latência).

**Contagem atual:** `components.ts` tem hoje 36 ids (a spec original dizia 37 e o `CLAUDE.md` diz 30). Atualizar o `CLAUDE.md` junto com esta spec.

## Design

### `ParamSpec`

```ts
type ParamValue = number | string | boolean;

interface ParamSpec {
  key: string;                 // ex.: "instances", "hitRate", "ttlSec"
  label: string;
  kind: "number" | "percent" | "duration" | "enum" | "boolean";
  default: ParamValue;
  min?: number; max?: number; step?: number;
  unit?: string;               // "ms", "rps", "s", "GB"
  options?: { value: string; label: string }[]; // kind = "enum"
  group?: "capacity" | "latency" | "resilience" | "cost" | "advanced";
  help?: string;               // uma linha, aparece como tooltip
  visibleIf?: (p: Record<string, ParamValue>) => boolean;
}

interface ComponentSchema {
  id: string;                  // mesmo id de components.ts
  params: ParamSpec[];
  pricing?: PricingSpec;       // ver Spec 10
  routing: RoutingKind;        // ver Spec 04: "lb" | "service" | "cache" | "queue" | "rate-limiter" | "breaker" | "fixed"
}
```

- `ComponentNodeData` ganha `params: Record<string, ParamValue>`. Valores fora do schema são descartados e valores inválidos voltam ao default na validação.
- O painel Props renderiza por `group`, com os grupos `advanced` recolhidos.
- `maxQPS`, `latencyMs` e `replicas` viram params (`capacityPerInstance`, `serviceTimeMs`, `instances`), com migração na [Spec 05](05-persistencia-e-compartilhamento.md).

### Catálogo de parâmetros

| Tipo | Parâmetros principais | Efeito na simulação |
| --- | --- | --- |
| Client / Traffic Source | RPS base, padrão de carga, mix read/write, tipos de request | Gera as chegadas (Poisson) |
| DNS | TTL, disponibilidade | Falha de DNS derruba 100% das chegadas novas |
| CDN | Hit rate de estáticos, latência de edge | Hit responde na edge; miss segue para a origem |
| Load Balancer | Algoritmo (round robin, least connections, weighted, hash), health check (intervalo, falhas para marcar down) | Distribui entre instâncias saudáveis e demora o intervalo do health check para tirar uma instância morta |
| API Gateway / Rate Limiter | Limite por segundo, algoritmo (token bucket, sliding window), ação ao exceder (429 ou fila) | Descarta ou atrasa o excedente |
| App Server / Service | Instâncias, concorrência por instância, service time (média e p99), timeout, retries (máx., backoff, jitter), autoscaling (min, max, utilização alvo, cooldown) | Fila M/M/c por instância; timeouts e retries geram carga extra |
| Cache | Hit rate ou (keyspace, capacidade, TTL, LRU/LFU), write strategy (cache-aside, write-through, write-behind), proteção contra stampede | Miss vira chamada ao banco; o flush derruba o hit rate |
| SQL DB | Primary + N read replicas, pool de conexões, latência de read/write, capacidade de write, shards | Pool esgotado enfileira; writes só vão para o primary; replication lag |
| NoSQL | Partições, replication factor, consistency level | Hot partition limita o throughput |
| Queue / Stream | Partições, consumers, profundidade máx., retenção, DLQ, semântica (at-least-once, exactly-once) | Absorve picos; lag = profundidade ÷ taxa de consumo |
| Worker Pool | Concorrência, tempo de processamento | Consome a fila |
| Circuit Breaker | Limiar de erro, tempo aberto, probes em half-open | Abre e falha rápido em vez de esperar o timeout |
| Object Storage / Search | Latência, throughput, shards/réplicas | Serviços com capacidade fixa |

Os demais tipos atuais (service mesh, monitoring, graph DB, vector DB, etc.) começam com o schema genérico de "serviço de capacidade fixa" (instâncias, capacidade por instância, service time) e ganham parâmetros específicos quando fizer sentido.

### Regras de aresta

Cada aresta ganha, além de `label`, `protocol` e `async` (que já existem em `SerializedEdge.data`):

```ts
interface EdgeRule {
  kind: "always" | "on_miss" | "reads" | "writes" | "fraction";
  fraction?: number;           // 0–1, só para kind = "fraction"
  callsPerRequest: number;     // default 1
  networkLatencyMs: number;    // default por protocolo
  packetLoss: number;          // 0–1, default 0
}
```

Isso substitui o "fan-out 100% para cada filho". O motor aplica a regra conforme o tipo do nó de origem ([Spec 04](04-motor-de-simulacao.md), roteamento).

**Defaults ao conectar:**

- Saída de Cache ou CDN → `on_miss`
- Saída de LB → `always` (o LB divide por algoritmo, a regra da aresta não se aplica)
- Service → SQL DB com read replica: aresta para o primary `writes`, para a réplica `reads`
- Qualquer outro caso → `always`

O painel da aresta e o menu de contexto ([Spec 02](02-editor-confiavel.md), CAN-04) editam a regra.

### Novos componentes

| Id | Tipo | Observação |
| --- | --- | --- |
| `client` | Traffic Source | Nó explícito de entrada; os designs sem ele continuam funcionando pela regra atual de entry point |
| `worker-pool` | Worker Pool | Consumidor de fila |
| `waf` | WAF | Filtro com latência fixa e taxa de bloqueio |
| `read-replica` | Read Replica | Recebe `reads`; tem replication lag |
| `dlq` | DLQ | Destino de mensagens que excederam as tentativas |
| `autoscaler` | Autoscaler | Controla `instances` dos nós ligados a ele |

Cada novo componente entra em `components.ts`, ganha entrada na Concept Library e ícone. Nenhuma solução de referência precisa usá-los na Fase 1.

### Presets (CMP-03)

Um preset é `{ id, componentId, label, params: Partial<...> }`. Aplicar um preset só preenche params; o usuário pode editar depois. Ex.: Redis (cache, `hitRate` 0,9, `serviceTimeMs` 0,5), Postgres (sql-db, pool 100), Kafka (queue, partições 12).

### Custom (CMP-04)

O componente `custom` ganha um editor de schema simples: o usuário escolhe o `routing` e adiciona params de uma lista curta (capacidade, service time, instâncias, hit rate, error rate).

## Critérios de aceite

- [ ] Todo id de `components.ts` tem schema com defaults válidos
- [ ] O painel Props é gerado pelo schema; nenhum formulário por tipo escrito à mão
- [ ] Os ids referenciados em `problems.ts`, `conceptLibrary.ts` e `learningPath.ts` continuam existindo
- [ ] Toda aresta tem `EdgeRule` depois da migração ([Spec 05](05-persistencia-e-compartilhamento.md))
- [ ] Cache → DB criado pela UI nasce com `on_miss`
- [ ] Os 6 componentes novos aparecem na paleta com entrada na Concept Library

## Testes

- Vitest: cada schema valida seus próprios defaults; valor fora de `min`/`max` volta ao default
- Vitest: script que cruza os ids de `problems.ts`, `conceptLibrary.ts` e `learningPath.ts` com o registry
