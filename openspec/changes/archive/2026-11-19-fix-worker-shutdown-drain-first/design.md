# Diseño: fix-worker-shutdown-drain-first

## Orden del apagado

Antes: `draining = true` → `await relay.stop()` → `await queue.drain()` → `context.close()` → `queue.stop()` → …

`relay.stop()` espera el lote en curso del relay (una transacción con `SKIP LOCKED` y encolado en pg-boss); en un host cargado puede tardar cientos de milisegundos o más. Hasta que `queue.drain()` llamaba a `offWork`, pg-boss seguía sondeando (`JOB_QUEUE_POLLING_INTERVAL_SECONDS = 0.5`) y podía entregar jobs nuevos al worker.

Ahora: `await Promise.allSettled([relay.stop(), queue.drain()])` y, si alguno rechazó, se relanza el primer error (mismo comportamiento de fallo que antes: no se sigue cerrando). Ambos son independientes:

- `relay.stop()` solo detiene su bucle y espera su lote.
- `queue.drain()` hace `offWork({ wait: true })` por cada cola: deja de sondear y espera los jobs activos.

Ningún evento se pierde: el relay y el drenaje no comparten estado; los eventos confirmados por jobs activos mientras drenan quedan en `platform.outbox` sin publicar hasta el siguiente arranque, igual que los confirmados tras `relay.stop()`.

## Residuo

Un fetch de pg-boss que ya salió hacia la base cuando se llama `offWork` puede devolver un job; ese job se procesa (o expira y se reintenta) como cualquier job activo. No se elimina la ventana, solo se reduce a la latencia de un fetch.

## Pruebas

- TC-PLATFORM-EVENTS-023 (integración, worker real): el lote del relay se detiene en `afterEnqueue`; con el orden anterior el job de diagnóstico encolado tras `close()` quedaba `completed`; con el nuevo queda `created`.
- STACK-006 (stack-smoke): espera `"shutdown started"` en el log (acotado con `--since`) en vez de 700 ms, y restaura el worker en un `finally`.
