# Backlog: produto

Decisões de produto e comportamento que ficaram em aberto durante o trabalho nas specs. Cada item diz o problema, o que muda e quanto custa, para ser decidido e feito no seu próprio PR.

## P1: Mix de leitura/escrita do problema na simulação ao vivo e no Analyze

**Problema.** A simulação ao vivo e o botão Analyze usam 90% de leituras (`DEFAULT_READ_RATIO`, `engine/core/routing.ts`), a menos que o design tenha um nó Client com `readRatio` próprio. O mix do problema não entra: no URL Shortener (100:1), o ID Generator, ligado por uma aresta `writes`, recebe 10% do tráfego ao vivo em vez de ~1%, e as bolas do canvas mostram essa proporção. O Score já usa o mix certo: `scoring/measure.ts` passa `readRatio = reads / (reads + writes)` do problema.

**Proposta.** Ao vivo e no Analyze, usar o mix do problema ativo quando o design não tiver um Client com `readRatio`, nesta precedência: Client do design → problema → 90%. Hoje a precedência em `resolveConfig` (`engine/analyze.ts`) é `config.readRatio` → Client → padrão. Passar o mix do problema como `config.readRatio` faria o Client ser ignorado, então o mix do problema precisa entrar como um padrão abaixo do Client: um campo novo em `SimConfig` ou o `SimController` lendo o Client antes. Decidir também se o Score deve respeitar o Client do candidato. Hoje ele não respeita, de propósito: o teste usa o mix do enunciado.

**Evidência.** Com a referência do URL Shortener a 10K req/s ao vivo: Cache 9,2K/s, NoSQL 1,9K/s, ID Generator 1K/s. Com o mix 100:1, o ID Generator receberia ~0,1K/s, e o NoSQL ~1,0K/s (misses de 10% das leituras mais as escritas).

**Custo.** `SimConfig`/`resolveConfig`, `SimController` (seguir o problema ativo, como já segue o SLO em vigor), a chamada do Analyze em `app-shell.tsx`, e testes em `engine-analyze` e `sim-controller`. Não muda o Score nem as referências.
