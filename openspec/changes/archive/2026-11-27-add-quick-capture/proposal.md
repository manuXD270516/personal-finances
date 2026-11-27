# Propuesta: add-quick-capture

## Why

Registrar un gasto es el flujo más frecuente de PFOS (RISK-025) y hoy no es rápido. El monto aparece después de la cuenta y no toma el foco, la cuenta no se recuerda y, al guardar, la app navega al detalle en lugar de dejar el formulario listo para el siguiente gasto. Tampoco existe un aviso con «Deshacer», aunque docs/28 §4.1 lo pide. NFR-USAB-007 exige crear un gasto simple en ≤ 15 s y ≤ 4 interacciones con cuenta y fecha recordadas, y NFR-USAB-006 pide la captura rápida optimizada para el teléfono. Es el lote L2 de [docs/78](../../../docs/78-propuesta-mejora-ui-ux-modern-web.md), aprobado por el owner el 2026-11-25 ([docs/79](../../../docs/79-ui-ux-modern-web-decisions.md): D502 quedarse en el formulario, D508 «Deshacer» persistente, D510 última cuenta en el dispositivo).

## What Changes

- **Monto primero (M-03):** en el alta, el monto es el primer campo, toma el foco al abrir `/transacciones/nueva`, mantiene el teclado decimal y lleva `enterKeyHint`. La edición no enfoca nada automáticamente.
- **Registrar y seguir (D502):** tras registrar, el formulario queda limpio con la misma cuenta, la misma fecha y el foco en el monto, y aparece un aviso «Gasto de Bs 45,00 registrado · Deshacer · Ver». «Registrar e ir al detalle» queda como acción secundaria con el comportamiento de hoy.
- **Deshacer = anular (D508):** el mismo comando de anulación (`POST …/void` con If-Match e Idempotency-Key) y un motivo predefinido traducido. Disponible mientras el aviso siga abierto y sin límite de tiempo; después, se anula desde el detalle. Si el periodo se cerró entre medio, el aviso muestra el error del catálogo.
- **Región de avisos de la sesión (M-07):** una región única y con nombre en el marco de la app, con avisos persistentes hasta cerrarlos y hasta 3 visibles. El aviso no roba el foco, se anuncia una vez en el idioma de la UI (`ariaNotify()` si existe y `role="status"` como respaldo) y no se guarda entre documentos.
- **Cuenta recordada por dispositivo (D510):** la última cuenta usada se guarda en `localStorage` por usuario y workspace, sin tocar `/me`. La cuenta que llega por el enlace (`?cuenta=`) tiene prioridad; una cuenta archivada o cerrada no se preselecciona.
- **Acceso «＋ Registrar»** en la barra superior para quien puede editar. La barra inferior móvil es del lote L4.
- **Fuera de alcance:** barra inferior y cajón móvil (L4), avisos de otros flujos (import terminado, etc.: se suman cuando cada flujo lo pida), transferencias y conversiones en modo «registrar y seguir», sincronizar la última cuenta entre dispositivos (opción A de P11) y atajos de teclado (NFR-USAB-008).

## Capabilities

### New Capabilities

Ninguna. `platform/web-interface` la crea el change 77 `refine-web-accessibility-foundations`; este change le agrega un requirement y se archiva después de él.

### Modified Capabilities
- `transactions/transaction-recording`: 5 ADDED (3 Must, 2 Should): monto primero en el alta, registrar y seguir, deshacer desde el aviso, cuenta recordada en el dispositivo y acceso directo para registrar.
- `platform/web-interface`: 1 ADDED (Must): región de avisos de la sesión.

## Impact

**Specs impactadas:** `transactions/transaction-recording` (5 ADDED) y `platform/web-interface` (1 ADDED). Lee sin modificar: `planning/financial-periods` (rechazo por periodo cerrado), `security/access-control` (rol EDITOR para registrar y anular) y `classification/auto-classification` (chip de categoría sugerida, que sigue igual).

**Componentes/contextos impactados:** solo `apps/web` (capa interface): `src/ui/transactions/TransactionForm.tsx` (orden de campos, foco, modo «registrar y seguir», cuenta recordada), `src/ui/transactions/TransactionDetail.tsx` (`NewTransactionPage`), `src/ui/AppFrame.tsx` (región de avisos y botón «＋ Registrar»), `src/ui/common/` (contexto y componente de avisos, almacenamiento seguro de la última cuenta), `app/globals.css`, `messages/{es,en,pt}.json` y `tests/e2e`. Ningún contexto de dominio.

**APIs impactadas:** ninguna. Se usan `POST /workspaces/{workspaceId}/transactions` y `POST …/transactions/{transactionId}/void`, ya existentes, con sus cabeceras `Idempotency-Key` e `If-Match`. `contracts/openapi` no cambia.

**Tablas impactadas:** ninguna.

**Eventos impactados:** ninguno nuevo. «Deshacer» publica el mismo evento de transacción anulada que la anulación desde el detalle.

**Migraciones requeridas:** ninguna.

**Test cases:** AÑADIDOS — TC-TRANSACTIONS-QUICK-001..015 (15) y TC-PLATFORM-WEBUI-021..024 (4). MODIFICADOS — ninguno. DEPRECADOS — ninguno.

**Impacto de regresión:** el alta de transacciones. Los specs E2E que esperan la navegación al detalle con `?aviso=registrada` tras registrar pasan a usar «Registrar e ir al detalle» o a esperar el aviso. El orden de los campos cambia (monto primero); los locators por `data-testid` y por etiqueta siguen valiendo. Sin cambios en el ledger ni en los datos.

**Riesgos introducidos:** sin RISK-id registrado. (1) «Deshacer» anula un registro: si el usuario lo pulsa por error, la anulación es la misma que desde el detalle (reversa, auditada y visible). (2) `localStorage` puede no estar disponible (navegación privada): se tolera sin preselección. (3) `ariaNotify()` es Newly (2026-09): queda el respaldo `role="status"`.

**Invariantes afectadas:** INV-008 (las correcciones son reversas: «Deshacer» anula con reversa, nunca borra). No cambia la regla; se reutiliza el comando existente.
