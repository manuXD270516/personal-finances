# 51: Preguntas del informe de rendimiento bajo carga (change 48)

> **Fecha:** 2026-10-25 · **Change:** [`investigate-perf-under-load`](../openspec/changes/investigate-perf-under-load/proposal.md) (48), tarea 4.2 · **Relacionado:** [50-perf-under-load-findings.md](50-perf-under-load-findings.md) (informe), [48-perf-and-rls-owner-decisions.md](48-perf-and-rls-owner-decisions.md) (D291–D293), [46-nightly-and-perf-owner-decisions.md](46-nightly-and-perf-owner-decisions.md) (D285, D290), [38-estado-y-pendientes.md](38-estado-y-pendientes.md)

El informe ([docs/50](50-perf-under-load-findings.md)) muestra que S1 (matcher) y S2 (disponible para gastar) son artefactos del benchmark y se arreglan en el grupo 5 del change, sin cambiar umbrales. Estas preguntas son las que deja abiertas; cada respuesta se registra en el siguiente `…-decisions.md` con su número D (el último vigente es D298). **Ninguna bloquea el grupo 5.** La 5 bloquea el cierre del change (tarea 8.2); la 1 bloquea un nightly completamente verde.

## 1. `imports.perf` falla por conexiones [bloquea un nightly en verde]

**Contexto.** En el nightly, `imports.perf.ts` falla con `timeout exceeded when trying to connect` y con el drenado que vence a los 120 s (en E10 falló a los 34 s). No es un síntoma del change 48 y no se midió. El presupuesto de la plantilla del host es API 22 + worker 33 = 55 de 60, y el harness suma sus propias conexiones.

**Opciones.**
- (a) Change de seguimiento `fix-imports-perf-connection-budget`: medir las conexiones de la suite (pools y `max_connections` del contenedor) y corregir el benchmark o el producto según la causa.
- (b) Incluirlo en el change 48 como parte del aislamiento.
- (c) Subir `max_connections` del contenedor del benchmark sin medir.

**Recomendación: (a).** Es otra causa, con su propia medición; meterla en el 48 retrasaría su cierre, y (c) podría esconder un problema real del presupuesto, que también afecta el despliegue (docs/38 §4).

## 2. Umbral de throughput por consumidor con handler real (D292)

**Contexto.** D292 deja la fila informativa hasta que el informe proponga un umbral por consumidor. El informe no puede proponerlo: E6–E8 (duración por evento, locks y un consumidor a la vez) no corrieron. Con ~1,4 M trabajos pendientes el drenado real ronda 6 ev/s; el matcher en limpio rinde 105–175 ev/s.

**Opciones.**
- (a) Sigue informativa, sin umbral, hasta que un change de optimización mida E6–E8 y proponga los umbrales.
- (b) Fijar ya un umbral por consumidor con los valores de la corrida 39669892721 como piso (no empeorar).
- (c) Umbral único de 42 ev/s por consumidor.

**Recomendación: (a).** Un umbral sin la medición por consumidor sería arbitrario, y (c) daría rojos sin significado con handlers reales (por eso D292).

## 3. Change de producto para el throughput de los consumidores

**Contexto.** Los ~6 ev/s con handler real aparecen al drenar el Large Seed completo de una vez (diez años de datos cargados en minutos), un volumen que el uso real de una persona no genera de golpe. NFR-PERF-008 con handler trivial se cumple (TC-PLATFORM-EVENTS-014). La Phase 6 ya trae la escritura masiva del import (D152), que cambia el volumen de eventos por import.

**Opciones.**
- (a) Redactar ahora `optimize-consumer-throughput`, después de cerrar el 48.
- (b) Diferirlo a Phase 6, junto con la escritura masiva del import, y mantener la fila informativa como señal.
- (c) No hacerlo.

**Recomendación: (b).** No hay un síntoma de producto con el volumen real y la escritura masiva cambiará el perfil de eventos; medir y optimizar antes sería sobre una carga que va a cambiar. La fila informativa sigue avisando si empeora.

## 4. Runner del job `perf` con la precondición de quietud (D293)

**Contexto.** S2 se debe a la contención de CPU en el runner de 4 CPU: con carga a 1 min de 2,9–3,5 el p95 queda en 46–78 ms, con 7,5–7,96 sube a 200–359 ms. El grupo 5 agrega una espera de quietud del host al empezar cada suite; esa espera alarga el job (`timeout-minutes: 240`).

**Opciones.**
- (a) Seguir con el runner estándar y la espera de quietud con un tope; si no se alcanza, la suite falla con `interferencia`.
- (b) Runner más grande (de pago, 8 o más CPU) solo para `perf`.
- (c) Mover `perf` al VPS N1 cuando exista (D248).

**Recomendación: (a).** La contención no es la única causa (S1 era backlog) y se corrige dentro del límite actual. Volver a preguntar solo si la duración del job se acerca al timeout en las corridas de la tarea 7.2.

## 5. Cierre del change con S3 sin causa por consumidor y repeticiones únicas [bloquea la tarea 8.2]

**Contexto.** El design pide tres repeticiones por experimento y que cada fila de S3 bajo meta tenga causa medida. Solo E1 tiene tres repeticiones; E10 y E11, que reproducen y separan S1 y S2, tienen una cada una. E4, E6, E7 y E8 no se lanzaron (cada corrida tarda 2–4 h).

**Opciones.**
- (a) Cerrar con S1 y S2 medidos y confirmados por la tarea 7.2 (dos corridas de `nightly` seguidas con la purga y la quietud); S3 queda con camino (d) diferido según la pregunta 3.
- (b) Antes de cerrar, repetir E10 y E11 ×3 y lanzar E6–E8 ×3 (≈ 15 corridas más).

**Recomendación: (a).** Las corridas independientes ya son coherentes (E1, E10, E11 y el programado de `main`) y la 7.2 repite la medición con el arreglo aplicado; E6–E8 tienen sentido dentro del change que optimice los consumidores, no para cerrar un benchmark.
