# Tecnologias dos componentes (component-technologies): Validation, rodada 3

## Validation (rodada 3): component-technologies - PASS ✅

A única lacuna da rodada 2 (mutante W2, TEC-45 do lado da réplica) foi fechada por T43 (`352808c`). Agora a TEC-45 tem teste negativo dos dois lados da condição "os dois ≠ `generic`":

- primário Generic: `tests/unit/engine-tech-compile.test.ts:90-101`;
- réplica Generic: `:103-114`.

Ela também tem o caso positivo (`:64-88`). As 4 mutações da TEC-45 morrem, W2 incluída. O gate passa: typecheck e 1299 testes unitários.

As 51 ACs têm evidência `file:line` que discrimina o resultado definido pela spec.

- **Data**: 2026-10-14
- **Spec**: `.specs/features/component-technologies/spec.md` (TEC-01…TEC-51; emendas da validação em 2026-10-14: TEC-45, TEC-38)
- **Faixa de commits**: `4b8cfca..HEAD`, HEAD `352808c`, branch `feat/component-technologies`. Esta rodada: `ab09590..352808c` (T43; em `tests/` só `engine-tech-compile.test.ts` +13 linhas; `src/` sem mudança).
- **Verifier**: sub-agente independente (author ≠ verifier). Trabalhou só em leitura; as mutações foram aplicadas no repositório real, uma por vez, e restauradas com `git checkout -- <arquivo>`. Sem worktree e sem junção.

### Histórico curto

- **Rodada 1 (FAIL)**, commit `6713060`:
  - Sensor: 13 mutações, 12 mortas. Sobreviveu a M3b (QUORUM k = ⌈RF/2⌉; nenhum teste usava RF par).
  - Lacunas: o seletor de classe desabilitado sem teste (TEC-07), e spec-precision em TEC-45 e TEC-38 (o burst absorvia 0,9 s).
  - Conteúdo: 17 linhas conferidas contra as fontes, 0 erradas.
  - Gates verdes: 1293 unit, 92 e2e, bundle +11,6%.
  - Lições L-015…L-019.
- **Rodada 2 (FAIL)**, commit `ab09590`:
  - T38–T42 fecharam as lacunas da rodada 1: RF 2, 4 e 6; e2e da aba somente leitura com classe e Reset desabilitados; TEC-45 emendada com teste do primário Generic; TEC-38 emendada com o bucket que recarrega antes de consumir; `design.md` com os desvios **[impl]**.
  - Sensor: 9 mutações, 8 mortas. Sobreviveu a W2: o compilador avisava com réplica Generic e nada falhava.
  - Gates verdes: 1298 unit, lint, format, build, bundle +11,6%, 93 e2e.
  - Lição L-020.

---

## Gates

| Gate      | Comando             | Saída                                                                       |
| --------- | ------------------- | --------------------------------------------------------------------------- |
| Typecheck | `npm run typecheck` | exit 0                                                                      |
| Unit      | `npm test`          | **1299 passando**, 60 arquivos, 0 skip (rodada 2: 1298; +1, o teste da T43) |

- **E2E, lint, build e bundle não foram re-rodados nesta rodada**: o diff `ab09590..352808c` não toca `src/` nem `tests/e2e/`, só acrescenta um teste unitário e documentos. Os resultados da rodada 2 continuam valendo para o mesmo código: 93 e2e, lint, format, build e bundle +11,6%.
- **Contagem de testes**: 1016 na base `4b8cfca` e 1299 agora (+283). Nenhum teste foi removido nem afrouxado.
- **Format**: este relatório passou por `oxfmt --check`.

---

## TEC-45: evidência dos dois lados

| Caso (TEC-45 emendada)                                                | Resultado definido pela spec | Evidência (`file:line` + asserção)                                                                                                                                                                                                                       | Resultado |
| --------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Réplica MySQL ← primário PostgreSQL (os dois ≠ `generic`, diferentes) | Avisa, sem bloquear          | `tests/unit/engine-tech-compile.test.ts:64-88` `expect(sim.warnings).toContain("replica: Replica technology differs from its primary (PostgreSQL (RDS)).")`; os nós e a aresta seguem simulados; `tests/e2e/technologies.spec.ts:146-160` aviso no Props | ✅        |
| A mesma tecnologia nos dois                                           | Sem aviso                    | `engine-tech-compile.test.ts:79-87` `…some((w) => w.includes("Replica technology"))).toBe(false)`; e2e `:159-161`                                                                                                                                        | ✅        |
| Primário `generic`, réplica MySQL                                     | Sem aviso                    | `engine-tech-compile.test.ts:90-101` `toBe(false)` (e a réplica tem `tech` "mysql"); e2e `:164-172`                                                                                                                                                      | ✅        |
| Réplica `generic`, primário PostgreSQL                                | Sem aviso                    | `engine-tech-compile.test.ts:103-114` `…tech?.technology).toBe("postgres")` + `warnings.some(…"Replica technology")).toBe(false)`                                                                                                                        | ✅ (novo) |

O teste novo mira o resultado da spec, e não só a existência de uma asserção. Ele prova que o primário tem um profile `postgres`, então o compilador tinha um lado com tecnologia para comparar, e que nenhum warning de réplica sai. No Props, o aviso nem é procurado sem a tecnologia da réplica (`src/components/panel/TechnologyPicker.tsx:69-71`, `tech && componentId === "read-replica"`).

### As outras 50 ACs

Nenhuma mudou desde a rodada 2: `src/` não mudou e nenhum teste foi alterado ou removido. A evidência de cada uma continua a da rodada 2 (TEC-07, TEC-29, TEC-38, commit `8a5df3f`) e da rodada 1 (as outras 47, commit `c3a0bbf`), e foi re-executada pelos 1299 testes unitários. Exemplos:

- `tests/unit/tech-profile.test.ts:76-114` (RF 2, 4 e 6, TEC-29)
- `tests/e2e/technologies.spec.ts:184-232` (classe e Reset desabilitados, TEC-07)
- `tests/unit/engine-tech-math.test.ts:259-285` e `tests/unit/engine-tech-tick.test.ts:113-135` (burst B ÷ (λ − L), TEC-38)
- `tests/unit/engine-tech.test.ts:40-41` (primário de escrita, TEC-25)
- `tests/unit/technologies.test.ts:190` (fontes `https`, TEC-11)
- `engine-golden.test.ts` com a fixture intacta (TEC-46)

**Status**: ✅ as 51 ACs têm evidência que discrimina o resultado da spec.

---

## Discrimination Sensor (rodada 3)

O `git status --porcelain` estava vazio antes; cada mutação foi aplicada em `src/domain/graph/compile.ts:147` no repositório real, seguida da suíte unitária inteira e de `git checkout -- src/domain/graph/compile.ts`. A porcelain ficou vazia depois de cada restauração e no fim.

| #   | Mutação em `compile.ts:147`                                                                           | Resultado                                                                |
| --- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| W2  | `!primary.tech \|\| replica.tech?.technology === primary.tech.technology`: avisa com réplica Generic  | ✅ morto (`engine-tech-compile.test.ts:103`), a sobrevivente da rodada 2 |
| W1  | `!replica.tech \|\| primary.tech?.technology === replica.tech.technology`: avisa com primário Generic | ✅ morto (`:90`)                                                         |
| W3  | `!primary.tech \|\| !replica.tech`: avisa mesmo com a mesma tecnologia                                | ✅ morto (`:64`)                                                         |
| W4  | `if (true)`: nunca avisa                                                                              | ✅ morto (`:64`)                                                         |

**Sensor depth**: focado na mudança (4 mutações sobre a AC tocada). 4 de 4 mortas. Todos os mutantes das rodadas 1 e 2 já estão mortos: os sobreviventes M3b e W2 morrem agora, e a mudança desta rodada só acrescenta um teste, sem mexer nos outros 21 mutantes.

---

## Code Quality

| Princípio                   | Status                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| Mudança mínima              | ✅ +13 linhas de teste; `src/` intacto                                                         |
| Spec-anchored outcome check | ✅ o teste novo afirma o resultado da TEC-45 emendada (sem warning) com a pré-condição provada |
| Todo teste mapeia uma AC    | ✅ o título cita TEC-45                                                                        |
| Diretrizes do projeto       | ✅ `CLAUDE.md`                                                                                 |

---

## Observação sem tarefa

Os comentários `SPEC_DEVIATION` no código (`src/domain/components/technologies/profile.ts:68,135`, `src/engine/analyze.ts:212`, `src/engine/core/tick.ts:271,464`) ainda descrevem o `design.md` antigo; o design já registra esses pontos como **[impl]**. Vale reescrevê-los numa próxima edição desses arquivos. Não bloqueia.

---

## Requirement Traceability Update

| Requirement  | Previous Status         | New Status  |
| ------------ | ----------------------- | ----------- |
| TEC-45       | ❌ Needs Fix (rodada 2) | ✅ Verified |
| As outras 50 | ✅ Verified             | ✅ Verified |

---

## Summary

**Overall**: ✅ Ready.

**Spec-anchored check**: 51/51 ACs com evidência que discrimina.
**Sensor**: rodada 3, 4/4 mutações mortas. M3b (rodada 1) e W2 (rodada 2) morrem.
**Gate**: typecheck e 1299 testes unitários passam. E2E, lint, build e bundle seguem válidos da rodada 2, porque o código não mudou.

**What works**: o catálogo com fontes conferidas, a edição e a paleta, todas as mecânicas no analyze e no tick, o custo por tecnologia, o advisor, os gerenciados multi-AZ, o golden bit-idêntico e o aviso de réplica com os dois lados testados.

**Next steps**: o orquestrador marca TEC-01…TEC-51 como Verified na `spec.md` e commita este relatório.
