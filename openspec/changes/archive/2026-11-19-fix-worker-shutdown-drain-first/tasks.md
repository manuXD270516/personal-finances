# Tareas

## 1. SPEC y TEST CASES

- [x] 1.1 Delta de `platform/event-delivery` (1 MODIFIED) y TC-PLATFORM-EVENTS-023 — 2026-11-18

## 2. PRUEBAS primero (rojo)

- [x] 2.1 `[TC-PLATFORM-EVENTS-023]` en `event-delivery.int.test.ts` — 2026-11-18: rojo previo (`expected 'completed' to be 'created'`)

## 3. IMPLEMENTACIÓN

- [x] 3.1 `create-worker-runtime.ts`: `close()` con `Promise.allSettled([relay.stop(), queue.drain()])` — 2026-11-18
- [x] 3.2 `stack.stack.test.ts` (STACK-006): espera del log `shutdown started` acotada con `--since` y `try/finally` que relanza el worker — 2026-11-18: en local no se corrió el stack; lo valida el job `stack-smoke`
- [x] 3.3 `cash-flow-watch.int.test.ts`: correos contados por entrega, sin deduplicar, con diagnóstico (commit aparte, solo pruebas) — 2026-11-18

## 4. TESTS AUTOMATIZADOS y regresión

- [x] 4.1 Gates: format, typecheck, lint, test, arch:check, traceability:check, spec:validate, config:docs:check e integración de los archivos afectados — 2026-11-18: ver el informe de cierre
