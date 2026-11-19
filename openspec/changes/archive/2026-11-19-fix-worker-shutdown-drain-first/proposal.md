# Propuesta: fix-worker-shutdown-drain-first

## Why

`WorkerRuntime.close()` detenía primero el relay (`relay.stop()`, que espera su lote en curso) y solo después la cola (`queue.drain()`). Mientras el relay terminaba, pg-boss seguía sondeando cada 0,5 s y el worker podía tomar jobs encolados DESPUÉS de la señal de apagado (NFR-REL-009: «no se toman jobs nuevos»). Con un host lento el lote del relay o la entrega del SIGTERM tardan más y la ventana se abre: en CI (2026-11-18, runner 4 a 5 veces más lento) `[TC-PLATFORM-STACK-006]` encontró el segundo job `completed` en vez de `created`, y por quedar el worker parado `[TC-PLATFORM-STACK-004]` falló en cascada.

## What Changes

- `apps/api/src/worker/create-worker-runtime.ts`: `close()` arranca `relay.stop()` y `queue.drain()` en paralelo (`Promise.allSettled`) y relanza el primer error; la cola deja de tomar jobs desde el primer instante. Residuo documentado: un fetch de pg-boss ya en vuelo puede devolver un job tras la señal.
- `scripts/stack/test/stack/stack.stack.test.ts` (STACK-006): el segundo job se encola cuando el log del worker muestra `"shutdown started"` (con `docker logs --since` el inicio del stop) en lugar de esperar 700 ms fijos; el log de la aserción se acota igual; el cuerpo va en `try/finally` que relanza `finance-worker` para que un fallo no cascade a STACK-004.
- `apps/api/test/events/cash-flow-watch.int.test.ts`: TC-REPORTING-FORECAST-018 y TC-NOTIFICATIONS-SHORTFALL-003 cuentan los correos por entrega (`Message-ID` = `<deliveryId@dominio>`), sin deduplicar, y el fallo lista asunto, `Message-ID` y fecha de todos los correos del OWNER (commit aparte, solo pruebas).
- Spec: 1 requirement MODIFIED en `platform/event-delivery` (scenario nuevo). TC-PLATFORM-EVENTS-023.

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

- `platform/event-delivery`: el apagado ordenado deja de tomar jobs aunque el relay tarde (1 MODIFIED, Must).

## Impact

**Specs:** `platform/event-delivery` (1 MODIFIED). **Componentes:** `apps/api` (worker), `scripts/stack` (prueba). **APIs, eventos, tablas y migraciones:** ninguno. **Test cases:** AÑADIDO TC-PLATFORM-EVENTS-023.

**Riesgos:** si `relay.stop()` o `drain()` rechaza, `close()` relanza el primer error como antes (sin cerrar el resto). Los eventos que un job en vuelo confirme durante el drenaje quedan pendientes en el outbox hasta el próximo arranque (el relay ya estaba detenido en ese tramo; la durabilidad no cambia).
