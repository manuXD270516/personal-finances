# 45: Preguntas del change fix-demo-golden-clock-dependence

> **Fecha:** 2026-10-20 · **Change:** [`fix-demo-golden-clock-dependence`](../openspec/changes/fix-demo-golden-clock-dependence/proposal.md) · **Relacionado:** [design.md](../openspec/changes/fix-demo-golden-clock-dependence/design.md), [38-estado-y-pendientes.md](38-estado-y-pendientes.md), ADR-0026 (datos demo), D36 ([31](31-phase-1-consolidation-decisions.md)) y D223 ([41](41-phase-5-consolidation-decisions.md))

El 2026-10-20, TC-IDENTITY-DEMO-007 falló en el nightly con un "Retiro de efectivo" de 600.00 BOB de más. El worker del test usaba el reloj real y ejecutó, en el minuto 10 UTC, el motor de recurrencia sobre una demo con la ancla 2026-09-30, lo que materializó la ocurrencia automática del 2026-10-02. El change corrige las pruebas y endurece la verificación del cargador. Quedan dos preguntas sobre el producto. **Ninguna bloquea el orden de implementación:** el change se implementa con las recomendaciones. Cada respuesta se registra en el siguiente `…-decisions.md` con su número D.

## 1. ¿La demo sigue el reloj de la instalación después de la carga?

**Contexto.** Hoy un workspace demo es un workspace `ACTIVE` más. Las tareas programadas lo procesan cada hora con la fecha real: crean el sueldo y el retiro automáticos cuando llega su día, pasan a atrasadas las ocurrencias, emiten estados de cuenta de las tarjetas, terminan el trial de la suscripción de prueba y reevalúan metas. Desde la app la ancla es "hoy", así que al cargar la demo no hay nada atrasado, pero a la semana la demo ya no coincide con su resumen de referencia. La spec actual admite "ocurrencias, cuotas y cargos futuros que generan los propios cronogramas", pero no dice si la demo debe evolucionar sola. El change lo hace explícito con un requirement Should y TC-IDENTITY-DEMO-024 `provisional`.

**Opciones.**
- (a) **Demo viva** (comportamiento actual): evoluciona con el reloj como un workspace real. Muestra cómo se ve PFOS con el paso de los días; las cifras del día de la carga dejan de valer con el tiempo.
- (b) **Demo congelada:** las tareas programadas excluyen los workspaces demo. La demo conserva siempre sus cifras de carga, pero envejece: las fechas quedan en el pasado y nada pasa a "próximo" ni a "atrasado". Requiere un change aparte que filtre el directorio de workspaces de las tareas programadas.
- (c) **Viva con aviso:** como (a), y la UI muestra "Cargada el <fecha>" junto al indicador "Datos de demostración", con la acción de recargar.

**Recomendación: (a).** Es lo que ya hace el producto, es coherente con que la demo use los mismos casos de uso que la operación real y no requiere cambios. Para volver a las cifras de referencia basta con limpiar la demo y cargarla de nuevo. (c) se puede agregar después como mejora de UI.

## 2. ¿Se recalcula la ancla si el job de carga corre otro día que la solicitud?

**Contexto.** La ancla se fija al pedir la carga: hoy en la zona horaria del workspace de origen. El job `demo.load` corre en el worker. Si la cola está atrasada o la carga cruza la medianoche de La Paz, el job usa la ancla de ayer, y apenas termina las tareas programadas materializan lo que venció hoy. Con este change la carga ya no falla por eso, porque verifica antes de publicar sus datos. Solo cambia que la demo nace con un día de "historia viva".

**Opciones.**
- (a) **Mantener la ancla de la solicitud** (actual).
- (b) **Recalcularla al empezar el job**, guardando la ancla real en el registro de la carga.

**Recomendación: (a).** Es un caso raro (minutos alrededor de la medianoche o una cola caída), su efecto es correcto para una demo viva y (b) cambiaría lo que ya se audita al pedir la carga (`anchorDate` en `identity.demo.load_requested`).
