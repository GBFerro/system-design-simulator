# Tecnologias dos componentes (component-technologies): Validation, rodada 2

## Validation (rodada 2): component-technologies - FAIL ❌

As quatro lacunas da rodada 1 foram fechadas com evidência que discrimina:

- TEC-29: o mutante M3b agora morre em 3 testes.
- TEC-07: o seletor de classe e o Reset aparecem desabilitados no e2e, e os mutantes P1 e P2 morrem.
- TEC-38: emendada e testada; os mutantes B1–B3 morrem.
- TEC-45: emendada, com teste negativo do primário Generic; os mutantes W1 e P3 morrem.

Os gates passam: typecheck, 1298 testes unitários, lint, format, build, bundle +11,6% e 93 e2e.

O veredito continua FAIL por um único mutante vivo, **W2**. A TEC-45 emendada condiciona o aviso a que **os dois** lados, primário e réplica, sejam ≠ `generic`, mas só o lado do primário tem teste negativo. Um compilador que avisa quando a réplica é Generic e o primário é PostgreSQL passa nos 1298 testes. A correção é um teste unitário (Fix 1).

- **Data**: 2026-10-14
- **Spec**: `.specs/features/component-technologies/spec.md` (TEC-01…TEC-51; emendas da validação em 2026-10-14: TEC-45 e TEC-38)
- **Faixa de commits**: `4b8cfca..HEAD`, HEAD `ab09590`, branch `feat/component-technologies`. As correções desta rodada são `6713060..ab09590`: T38 `86eaf97`, T39 `b0205f3`, T40 `3235643`, T41 `105930b`, T42 `ab09590`.
- **Verifier**: sub-agente independente (author ≠ verifier). Trabalhou só em leitura. As mutações foram aplicadas no próprio arquivo do repositório, uma por vez, e desfeitas com `git checkout -- <arquivo>`. Nenhum worktree e nenhuma junção foram usados.

### Histórico curto

- **Rodada 1 (FAIL)**, commit `6713060`:
  - 13 mutações, das quais 12 morreram. Sobreviveu a M3b (QUORUM k = ⌈RF/2⌉), porque nenhum teste usava RF par.
  - Lacunas: o seletor de classe desabilitado sem teste (TEC-07), e spec-precision em TEC-45 (o Generic conta?) e em TEC-38 (o burst absorvia 0,9 s em vez de 1,0 s).
  - Conteúdo: 17 linhas conferidas contra as fontes, 0 erradas.
  - Lições L-015…L-019.

---

## Gates

| Gate      | Comando                | Saída                                                                      |
| --------- | ---------------------- | -------------------------------------------------------------------------- |
| Typecheck | `npm run typecheck`    | exit 0                                                                     |
| Unit      | `npm test`             | **1298 passando**, 60 arquivos, 0 skip (rodada 1: 1293; +5)                |
| Lint      | `npm run lint`         | exit 0                                                                     |
| Format    | `npm run format:check` | todos os arquivos formatados                                               |
| Build     | `npm run build`        | exit 0                                                                     |
| Bundle    | `npm run bundle:check` | 615,6 KB gzip contra 551,5 KB: **+11,6%** (limite +15%)                    |
| E2E todo  | `npx playwright test`  | **93 passando**, 0 falha (17 em `technologies.spec.ts`; rodada 1: 92 e 16) |

Nenhum teste foi removido. Os testes de RF 3 e do burst foram ajustados ao comportamento novo da T41 (`engine-tech-math.test.ts:275-285` e `engine-tech-tick.test.ts:113-127`), sem afrouxar nada: a janela do primeiro erro passou de [0,85; 1,0] s para [0,95; 1,05] s, centrada no B ÷ (λ − L) = 1,0 s que a spec emendada pede.

---

## ACs tocadas pelas correções e lacunas da rodada 1

| AC     | Resultado definido pela spec                                                                                                                                                                 | Evidência (`file:line` + asserção)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Resultado                                                                                                                                                                                                                                                                  |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEC-07 | Em aba somente leitura, os seletores de tecnologia **e de classe** ficam desabilitados e a troca é no-op                                                                                     | `tests/e2e/technologies.spec.ts:184-232`: uma aba com um nó PostgreSQL é marcada `readOnly` no `localStorage` persistido (o estado de uma aba de referência reaberta). Depois do reload: `technology` `toBeDisabled()` (`:208`), `instanceClass` `toBeDisabled()` + `toHaveValue("db.r6g.xlarge")` (`:210-211`), "Reset to benchmark" `toBeDisabled()` (`:212-214`); um `change` forçado no select não muda a classe, a capacidade nem os params persistidos, e o Undo continua desabilitado (`:217-231`). Mais `tests/unit/editor.test.ts:428-436` (store no-op). | ✅ Os mutantes P1 (sem `disabled` no select de classe) e P2 (sem `disabled` no Reset) morrem.                                                                                                                                                                              |
| TEC-29 | k = 1, ⌊RF/2⌋ + 1 ou RF, para RF de 1 a 7; leitura custa k, escrita RF; latência = k-ésima de RF                                                                                             | `tests/unit/tech-profile.test.ts:76-114` (`it.each` RF 2, 4, 6) com RF 2, 4 e 6, para Cassandra e ScyllaDB: QUORUM `read {cost: q, shape: kth(q, rf)}`, `write {cost: rf, shape: kth(q, rf)}`, `throttle {readCost: q, writeCost: rf}`, com q = 2, 3 e 4; ONE `kth(1, rf)`, ALL `kth(rf, rf)`. A cobertura de RF 3 da rodada 1 continua.                                                                                                                                                                                                                           | ✅ O M3b morre (3 testes).                                                                                                                                                                                                                                                 |
| TEC-38 | Cota de 10.000 req/s; o excesso é 429. No tick, um bucket que começa cheio: o primeiro erro depois de B ÷ (λ − L) s, com resolução de um tick; daí em diante λ − L; abaixo de L, nenhum erro | `tests/unit/engine-tech-math.test.ts:259-285`, determinístico: 20 ticks com `throttled` 0 e depois exatamente 5.000; o bucket recarrega até `burst` (`capped.tokens` 5000) e, abaixo de L, `tokens ≈ 1000 + 9000·dt`. `tests/unit/engine-tech-tick.test.ts:113-127` (Poisson): primeiro erro em [0,95; 1,05] s, nenhum antes de 0,95 s, depois `drops ≈ rpsIn − 10000` e `critical`. `:129-135`: a 9.800 req/s, com ticks em que a chegada passa de 10.000, nenhum erro. `tests/unit/engine-tech.test.ts:189-195` (analyze: 15k → 5000 de erro).                   | ✅ Os mutantes B1 (ordem antiga: limita antes de consumir), B2 (sem teto do burst) e B3 (deixa passar L além dos tokens) morrem.                                                                                                                                           |
| TEC-45 | Aviso no Props + warning do compilador quando réplica e primário são **os dois** ≠ `generic` e diferem; um primário `generic` não gera aviso                                                 | `tests/unit/engine-tech-compile.test.ts:64-88`: MySQL ← PostgreSQL avisa, a mesma tecnologia não; `:90-101`: primário Generic com réplica MySQL, sem aviso. `tests/e2e/technologies.spec.ts:146-172`: o aviso aparece no Props, some com a mesma tecnologia e não volta com o primário Generic.                                                                                                                                                                                                                                                                    | ❌ **Conjunção parcial.** O lado "réplica ≠ `generic`" não tem teste negativo: o mutante W2 (`compile.ts:147` → `!primary.tech \|\| replica.tech?.technology === primary.tech.technology`, que avisa com réplica Generic e primário PostgreSQL) passa nos 1298. Ver Fix 1. |

### As outras 47 ACs

As outras 47 ACs não mudaram em relação à rodada 1, e o diff desta rodada não toca o código delas: só `src/engine/core/tech.ts` (o bloco do token bucket) mudou em `src/`. A evidência `file:line` de cada uma continua a da tabela da rodada 1 (commit `c3a0bbf`, este arquivo). Ela foi re-executada pelo gate: os 1298 testes unitários e os 93 e2e passam. Resumo por AC:

- **✅ ACs que batem com a spec**: TEC-01…TEC-06, TEC-08…TEC-28, TEC-30…TEC-37, TEC-39…TEC-44 e TEC-46…TEC-51.
- **Exemplos de evidência que continua valendo**:
  - `tests/unit/technologies.test.ts:696` (`spec.default` "generic", TEC-01)
  - `tests/unit/editor.test.ts:371-385` (preset e 1 undo, TEC-02)
  - `tests/unit/engine-tech.test.ts:40-41` (escritas = `shards` × capacidade de escrita, TEC-25)
  - `tests/unit/engine-tech.test.ts:78-84` (h·λ·(1 − 1/U), TEC-28)
  - `tests/unit/engine-tech-kafka.test.ts:192` (Kafka drena como 6, TEC-34)
  - `tests/unit/engine-tech.test.ts:175-187` (S3 por prefixo, TEC-37)
  - `tests/unit/engine-tech-tick.test.ts:138-155` (o mesmo limite no analyze e no tick, TEC-41)
  - `tests/unit/advisor.test.ts:236` (o advisor usa o número do motor, TEC-42)
  - `tests/unit/cost.test.ts:154` (gerenciado sem × instances, TEC-51)
  - `engine-golden.test.ts` com a fixture intacta (TEC-46).

**Status**: 50/51 ACs com evidência que discrimina; 1 conjunção parcial (TEC-45).

### T42 (`design.md`) e SPEC_DEVIATION

O `design.md` agora descreve o que o código faz em cada um dos 5 desvios (marcados **[impl]**), e acrescenta o token bucket da T41 e o zeramento do ruído de float em `throttled`:

- as estações explícitas (A.1);
- o `QUOTA_HEADROOM` (A.2);
- o `needsSplit` com qualquer tecnologia (A.3);
- o `techTickFlow` em `tick.ts`.

Conferido contra `src/domain/components/technologies/profile.ts`, `src/engine/core/tech.ts:126-134` e `src/engine/core/tick.ts`.

Observação sem tarefa: os comentários `SPEC_DEVIATION` no código (`profile.ts:68,135`, `analyze.ts:212`, `tick.ts:271,464`) ainda dizem "design.md A.1 has…", o que já não é verdade. Vale reescrevê-los como uma referência ao **[impl]** do design numa próxima edição desses arquivos.

---

## Discrimination Sensor (rodada 2)

Cada mutação foi aplicada direto no arquivo do repositório real, rodou-se o teste relevante e o arquivo foi restaurado com `git checkout -- <arquivo>`. `git status --porcelain` ficou vazio antes de cada mutação e depois de cada restauração (registrado pelo script). Não se usou worktree nem junção.

| #   | `file:line`                                         | Mutação                                                                                          | Testes          | Resultado                                                                    |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------- | ---------------------------------------------------------------------------- |
| M3b | `src/domain/components/technologies/profile.ts:174` | QUORUM k = ⌈RF/2⌉ (a sobrevivente da rodada 1)                                                   | unit (1298)     | ✅ morto (3: `tech-profile` RF 2, 4, 6)                                      |
| B1  | `src/engine/core/tech.ts:129-131`                   | Token bucket na ordem antiga, limitando a `burst` antes de consumir (a recarga do tick se perde) | unit            | ✅ morto (2: `engine-tech-math` 20 ticks, `engine-tech-tick` [0,95; 1,05] s) |
| B2  | `src/engine/core/tech.ts:131`                       | Tokens sem o teto de `burst`                                                                     | unit            | ✅ morto (1: `capped.tokens` 5000)                                           |
| B3  | `src/engine/core/tech.ts:130`                       | Admite `L + tokens/dt` (deixa passar a taxa além do bucket)                                      | unit            | ✅ morto (2)                                                                 |
| W1  | `src/domain/graph/compile.ts:147`                   | O compilador avisa com primário Generic                                                          | unit            | ✅ morto (1: `engine-tech-compile:90`)                                       |
| W2  | `src/domain/graph/compile.ts:147`                   | O compilador avisa com **réplica** Generic e primário PostgreSQL                                 | unit            | ❌ **sobreviveu** (1298/1298), vira o Fix 1                                  |
| P1  | `src/components/panel/TechnologyPicker.tsx:106`     | Select de classe sem `disabled`                                                                  | e2e `-g TEC-07` | ✅ morto (`technologies.spec.ts:184`)                                        |
| P2  | `src/components/panel/TechnologyPicker.tsx:171`     | Botão Reset sem `disabled`                                                                       | e2e `-g TEC-07` | ✅ morto (`technologies.spec.ts:184`)                                        |
| P3  | `src/components/panel/TechnologyPicker.tsx:41`      | O Props avisa com primário Generic (`primary ?? replica`)                                        | e2e `-g TEC-45` | ✅ morto (`technologies.spec.ts:146`)                                        |

**Sensor depth**: expandido (motor e UI tocados pelas correções). 9 mutações, 8 mortas e 1 viva (W2). A W2 mexe numa cláusula que a spec emendada fixa: TEC-45 diz "têm, **os dois**, tecnologia diferente de `generic`".

---

## Conteúdo

Nenhum número do catálogo mudou nesta rodada: o diff de `src/domain/components/technologies/` está vazio em `6713060..HEAD`. A conferência da rodada 1 continua valendo: 17 linhas, 0 erradas.

---

## Code Quality

| Princípio                   | Status                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mudança mínima e cirúrgica  | ✅ em `src/` só o bloco do bucket (`tech.ts`, +7/−4); o resto são testes, spec e design                                                            |
| Spec-anchored outcome check | ❌ TEC-45, conjunção parcial (W2); as outras ACs tocadas (TEC-07, 29, 38) batem com a spec                                                         |
| Testes não rasos            | ✅ o e2e da TEC-07 testa os dois seletores, o Reset, o no-op por evento forçado e o Undo; o bucket tem casos determinístico, Poisson e abaixo de L |
| Diretrizes do projeto       | ✅ `CLAUDE.md` (e2e inteiro rodado, golden intacto)                                                                                                |

---

## Fix Plans

### Fix 1 (bloqueia): teste negativo do lado da réplica em TEC-45 (mutante W2)

- **Causa**: os testes negativos cobrem a mesma tecnologia e o primário Generic, mas não uma réplica Generic alimentada por um primário com tecnologia. O código está certo (`compile.ts:147` exige `replica.tech`; `TechnologyPicker.tsx:70` só procura o primário quando a réplica tem `tech`), mas nada impede a regressão.
- **Tarefa**: em `tests/unit/engine-tech-compile.test.ts`, acrescentar o caso primário `postgres` → réplica `generic`: `sim.warnings.some(w => w.includes("Replica technology"))` deve ser `false`. Opcionalmente, um passo no e2e da TEC-45: com o primário PostgreSQL, trocar a réplica para Generic e verificar que o aviso some.
- **Pronto quando**: o W2 falha a suíte.
- **Prioridade**: Minor (é um teste só, e o comportamento já está correto).

---

## Requirement Traceability Update

| Requirement            | Previous Status         | New Status           |
| ---------------------- | ----------------------- | -------------------- |
| TEC-07, TEC-29, TEC-38 | ❌ Needs Fix / ressalva | ✅ Verified          |
| TEC-45                 | ressalva (Fix 3)        | ❌ Needs Fix (Fix 1) |
| As outras 47           | ✅ Verified             | ✅ Verified          |

---

## Summary

**Overall**: ❌ Not Ready, por um teste só (Fix 1). O código, a spec emendada, o design e o conteúdo estão corretos.

**Spec-anchored check**: 50/51 ACs com evidência que discrimina; TEC-45 com uma conjunção parcial.
**Sensor**: 9 mutações, 8 mortas e 1 viva (W2).
**Gate**: typecheck, 1298 unit, lint, format, build, bundle +11,6% e 93 e2e: tudo passa.

**Next steps**: Fix 1 e, depois, a re-verificação (rodada 3, a última do limite de 3).
