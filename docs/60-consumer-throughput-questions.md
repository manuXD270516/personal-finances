# 60: Preguntas al owner del change 51 (`optimize-consumer-throughput`)

> **Fecha:** 2026-10-29 · **Relacionado:** [59-consumer-throughput-findings.md](59-consumer-throughput-findings.md), [57](57-phase-6-consolidation-decisions.md) (D311 y D312 ya respondidas)

Las dos preguntas del design (fila del host y umbrales por consumidor) las respondió el owner (D311, D312). La medición deja una pregunta nueva, no bloqueante.

## 1. ¿La fila de la ráfaga del import (peor caso con la escritura masiva) pasa a bloqueante?

**Contexto.** D311 hizo bloqueante la fila de `imports.perf.ts` con la configuración del host. Esa fila mide el perfil **actual** del import: la persistencia dura 200+ s y los consumidores drenan mientras tanto, así que el drenado tras la persistencia fue de 23 s con el Large Seed. El perfil que importa para `add-bulk-imported-transactions` (persistencia ≤ 20 s, los 15 000 hechos juntos) lo mide la fase A de `throughput.perf.ts`: antes de la entrega agrupada tardaba 177 s con el Large Seed (sobre los 120 s) y es informativa (D300).

**Opciones.**

- (a) Dejar `throughput.perf.ts` informativa y que `add-bulk-imported-transactions` agregue su propia fila bloqueante cuando exista la escritura masiva (su perfil real).
- (b) Hacer bloqueante desde ya el drenado de la ráfaga (fase A) con la configuración del host ≤ 120 s por consumidor.
- (c) Dejarla informativa sin más.

**Recomendación: (a).** La fila de (b) protegería un perfil que el producto todavía no produce; cuando exista la escritura masiva, su benchmark mide el mismo perfil de forma natural y D311 ya fija el criterio (configuración del host, ≤ 120 s por consumidor). Mientras tanto la fase A queda como señal informativa y su resultado se anota en el resumen del nightly.

## Decisión del owner (2026-10-29)

| ID | Pregunta | Decisión |
|---|---|---|
| D359 | 1. ¿La fila de la ráfaga del import pasa a bloqueante? | **(a):** `throughput.perf.ts` queda informativa y `add-bulk-imported-transactions` (change 52) agrega su propia fila bloqueante cuando exista la escritura masiva. |
