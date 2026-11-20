# 69: Decisiones del owner sobre la persistencia del import (change 63, segunda ronda)

> **Fecha:** 2026-11-20 · **Responde a:** [68](68-import-persist-perf-questions-2.md) · **Evidencia:** [67](67-import-persist-perf-findings.md) · **Anteriores:** [64](64-import-persist-perf-decisions.md) (D403 a D409), D442 como último id usado antes de esta ronda

Respuestas textuales del owner (elección entre las opciones de docs/68).

| Id | Pregunta de docs/68 | Respuesta | Efecto |
|---|---|---|---|
| D443 | 1. Regular el relay durante la persistencia (D406) | «No regular (Recomendado)» | El relay y los consumidores no se regulan; la tarea 7.3 se cierra sin cambios de producto. D406 sigue vigente pero sin uso |
| D444 | 2. Runner del nightly `perf` (D408) | «Mantener ubuntu-latest (Recomendado)» | D302 y D408 no cambian |
| D445 | 3. Medir el peso de los disparadores del ledger (D404) | «Sí, medirlo (Recomendado)» | Corrida de `track_functions` con lectura de `pg_stat_user_functions` en la rama de experimentos; resultado en docs/67 §5. Si el peso es ≥ 25 % del lote, el ADR de D404 va como pregunta al owner, no se implementa |
| (resultado de D445) | Medición hecha el 2026-11-20 | Peso de los disparadores 26–60 % (≥ 25 %) | Pregunta 4 de docs/68 al owner; ADR sin implementar |
| D446 | Meta de 20 s (D403) | «Decidir después de medir» | D403 queda como está; se vuelve a evaluar con el resultado de D445 |
