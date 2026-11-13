# Propuesta: fix-worker-user-context

## Why

El worker falla con `PF002` («user context not set») al procesar el workspace del dataset Demo v2: el consumidor `debt.card-activity` reintenta sus entregas hasta agotarlas y el job `debt.card-daily` cuenta un fallo por tarjeta (la corrida de pronósticos que lee los mismos datos queda en `RUNNING`). Reproducido en `main` con `apps/api/test/demo/demo-worker-context.int.test.ts` (8 entregas fallidas del consumidor y 1 fallo del job).

Causa: FX y ACCOUNTS reciben `identityWorkspaceSettings(pool)` (la ruta de la petición: lee `iam.workspace` con la membresía del usuario, política `workspace_member_read`, que exige `app.user_id`). Valorar una cuenta en moneda distinta de la base (las tarjetas en USD de la demo, con base BOB) llama a `RatePairResolver.baseCurrencyOf`, y esta ruta, ejecutada por el worker (actor `WORKER`, sin usuario), lanza `PF002`. No es exclusivo de la demo: lo dispara cualquier tarjeta o cuenta en moneda extranjera. IDENTITY ya tenía el patrón correcto (`actorSettings`: ruta de petición para actores `USER`, directorio de workspaces `pf_workspace_directory` para el resto) y lo usaban COMMITMENTS, PLANNING y DEBT, pero no FX ni ACCOUNTS.

## What Changes

- Cableado (`apps/api/src/identity/identity-wiring.ts`): FX y la valoración de ACCOUNTS usan `actorSettings`. Sin migración: la RLS no se abre; el worker lee la moneda base y la zona horaria por el rol de directorio ya existente (columnas acotadas de `iam.workspace`, sin miembros ni otros datos).
- Pruebas: `demo-worker-context.int.test.ts` (TC-SECURITY-RLS-019) con el dataset Demo v2 y el worker real; `DemoWorld.start` acepta el logger del worker.
- Spec: un requirement ADDED en `security/access-control`.

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

- `security/access-control`: los jobs y consumidores del worker resuelven los ajustes del workspace sin usuario, por el rol de directorio (1 requirement ADDED, Must).

## Impact

**Specs:** `security/access-control` (1 ADDED). **Componentes:** `apps/api` (cableado de IDENTITY). **APIs, eventos, tablas y migraciones:** ninguno. **Test cases:** AÑADIDO TC-SECURITY-RLS-019.

**Riesgos:** el actor `USER` conserva la ruta de petición (sin cambio para la API). Para actores no `USER` la lectura va por una conexión propia (rol de directorio), no por la transacción del llamador: solo ve workspaces ACTIVOS ya confirmados. Fail-closed intacto: sin el rol de directorio el worker no ve `iam.workspace`.

**Pendiente (fuera de alcance):** `identityWorkspaceSettings` sigue cableado directo en PLANNING (presupuestos, cierre) y en el resumen de deudas; los ejecuta la API. Si algún job del worker los usa, aplicar el mismo patrón.
