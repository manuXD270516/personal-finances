# Diseño

## Contexto

Lote L2 de [docs/78](../../../docs/78-propuesta-mejora-ui-ux-modern-web.md) (change 78 de docs/03 §7). Reúne M-03, M-07, el alta en el lugar con «registrar otro», la cuenta recordada y el acceso «＋». Decisiones del owner ([docs/79](../../../docs/79-ui-ux-modern-web-decisions.md)): D500 (política de navegadores), D502 (quedarse en el formulario con «Deshacer · Ver»), D508 («Deshacer» persistente, sin límite de 10 s), D510 (última cuenta en `localStorage`) y D512 (lo implementa el agente `frontend`).

Estado actual: `TransactionForm` (`apps/web/src/ui/transactions/TransactionForm.tsx`) sirve al alta y a la edición. En el alta, el primer campo es la cuenta (`:446-476`) y nada toma el foco. Al guardar llama a `onSaved(tx)` y `NewTransactionPage` navega al detalle con `window.location.assign(...?aviso=registrada)` (`TransactionDetail.tsx:110-115`). El formulario genera una `Idempotency-Key` por intento. `AppFrame` (`src/ui/AppFrame.tsx`) es un componente de cliente dentro de `SessionProvider` y vive mientras dura el documento: la navegación de la app es por documento completo (P12 se resuelve en `adopt-client-navigation`, D511).

Capa afectada: solo **interface** (`apps/web`). La anulación usa el comando existente `voidTransaction` (`POST /workspaces/{workspaceId}/transactions/{transactionId}/void`, `If-Match`, `Idempotency-Key`, cuerpo `VoidRequest` con `reason`), de `transactions/transaction-recording`. Sin cambios en contextos, tablas, eventos ni contratos.

Depende del change 77 `refine-web-accessibility-foundations` solo por `useFocusFirstError` (M-01): el alta rápida que falla la validación usa el mismo foco al primer error. Se implementa y se archiva después del 77.

## Objetivos / No objetivos

**Objetivos**
- Gasto simple en ≤ 4 interacciones con cuenta y fecha recordadas (NFR-USAB-007): monto, categoría sugerida o elegida, «Registrar».
- Varios gastos seguidos sin salir del formulario.
- Corregir un registro equivocado con un toque, sin borrar nada del ledger.
- Una región de avisos reutilizable por los lotes siguientes.

**No objetivos**
- Barra inferior móvil y cajón (L4). El acceso «＋» de este change está solo en la barra superior.
- «Registrar y seguir» en transferencias y conversiones (otros formularios y otros flujos).
- Avisos de otros flujos (import terminado, etc.).
- Sincronizar la última cuenta entre dispositivos (opción A de P11, descartada por D510).
- Medir los 15 s de NFR-USAB-007 con telemetría: se valida con el owner (SM-03) y con el conteo de interacciones del E2E.

## Decisiones

1. **Orden y foco del alta (M-03).** En el alta, el orden pasa a ser monto → categoría (con el chip de sugerencia de `add-category-suggestions`, sin cambios) → cuenta → fecha → resto, y «Más opciones» sigue en `<details>`. En la edición se conserva el orden actual. El monto lleva `autoFocus` solo cuando el formulario es de alta y está dentro de `/transacciones/nueva` (prop nueva `autoFocusAmount`, que pasa `NewTransactionPage`), `inputMode="decimal"` (ya existe), `enterKeyHint="next"` y `autoComplete="off"`. «Registrar» lleva `enterKeyHint` implícito del envío. El orden del DOM es el visual (requisito del foco al error del change 77). *Alternativa descartada:* reordenar con CSS `order`. Rompe el orden de tabulación y el foco al primer error.

2. **Registrar y seguir (D502).** `TransactionForm` gana el modo `afterSave: 'stay' | 'detail'`. `NewTransactionPage` usa `'stay'` como acción principal y ofrece «Registrar e ir al detalle» como segundo botón de envío (`type="submit"` con `name="intent" value="detail"`), que mantiene el comportamiento actual (navegación con `?aviso=registrada`). En `'stay'`, tras un `201`:
   - se publica un aviso en la región (decisión 4) con el texto por tipo (`transactions.quick.saved.EXPENSE`: «Gasto de {amount} registrado», y lo mismo para `INCOME`, `REFUND` y `ADJUSTMENT`), con el monto formateado según NFR-USAB-002 desde el string decimal (nunca `number`) y las acciones «Deshacer» y «Ver»;
   - el estado vuelve al inicial **conservando** tipo, cuenta, fecha y estado (`POSTED`/`PENDING`) y limpiando monto, descripción, contraparte, splits, notas, medio de pago y campos personalizados;
   - se genera una `Idempotency-Key` nueva (la del intento anterior ya se usó) y el foco vuelve al monto;
   - se registra la cuenta usada (decisión 6).
   El duplicado (`?duplicar=`) sigue el mismo modo.

3. **Deshacer = anular (D508).** «Deshacer» llama a `voidTransaction` con `If-Match` igual al `ETag` de la respuesta del `POST` (o `W/"<version>"` de la transacción devuelta, según el cliente actual), una `Idempotency-Key` propia del intento de deshacer y `reason` igual a la clave i18n `transactions.quick.undoReason` («Deshecho desde el aviso de registro», traducida al idioma de la UI). Mientras la solicitud está en curso, el botón queda deshabilitado (`aria-disabled` y sin segundo envío). Resultados:
   - `200`: el aviso cambia a «Registro anulado» (sin «Deshacer», con «Ver»), y la transacción queda `VOIDED` con su reversa (INV-008), auditada y con su evento, igual que desde el detalle;
   - `409 PERIOD_CLOSED`, `TRANSACTION_RECONCILED`, `INVALID_STATUS_TRANSITION` o `412`: el aviso muestra el mensaje del catálogo de errores (NFR-USAB-009) y la acción «Ver» para resolver desde el detalle; no se reintenta solo.
   No hay temporizador: «Deshacer» existe mientras el aviso esté en la región (decisión 4). *Alternativa descartada:* un borrado lógico o un `DELETE`. No existe borrado físico (FR-TRANSACTIONS-009) y anular deja el rastro que el ledger exige.

4. **Región de avisos (M-07).** `NoticesProvider` (contexto de React) y `NoticeRegion` en `src/ui/common/notices.tsx`, montados en `AppFrame` también en estado `loading`.
   - **Marcado:** `<section role="region" aria-label={t('shell.notices.label')}>` (es «Avisos», en «Notices», pt «Avisos») con `data-testid="notice-region"`, fija en la esquina inferior (clase `.pf-notices` en `globals.css`, con `scroll-padding-bottom` en el `main` si tapa contenido). Cada aviso es un `<div data-testid="notice">` con texto, acciones y un botón «Cerrar» con nombre accesible.
   - **Capa superior:** si `HTMLElement.prototype.showPopover` existe, cada aviso es `popover="manual"` y se abre con `showPopover()` en un efecto. Si no, se muestra en el flujo normal de la región. Es mejora progresiva (Newly 2025-01, D500).
   - **Foco:** mostrar un aviso nunca mueve el foco. Sus botones son enfocables y están después del contenido principal en el orden de tabulación.
   - **Anuncio:** una sola vez por aviso. Si `'ariaNotify' in document`, se llama `document.ariaNotify(texto)`; si no, el texto se escribe en un `<div role="status" class="pf-visually-hidden">` propio de la región, que se vacía antes de cada anuncio. El tipo de `ariaNotify` no está en `lib.dom.d.ts` de TS 6.0.3: se declara con un `declare global` de pocas líneas en `src/ui/common/aria-notify.d.ts`. El texto sale del catálogo en el idioma de la UI.
   - **Persistencia:** sin temporizador (WCAG 2.2.1). Un aviso sale al pulsar «Cerrar», al pulsar «Ver» (navega) o cuando entra un cuarto aviso (decisión de diseño de docs/79: hasta 3 visibles, sale el más antiguo). No se guarda nada en `sessionStorage` ni en `localStorage`: una navegación o una recarga empiezan sin avisos, para no ofrecer un «Deshacer» sobre un estado viejo.
   - **API del contexto:** `push({ text, actions?, tone? }) → id`, `update(id, partial)` y `dismiss(id)`.

5. **Acceso «＋ Registrar».** En la barra superior de `AppFrame`, un enlace `<a href={localized('/transacciones/nueva')}>` con el texto «＋ Registrar» (el «＋» con `aria-hidden`, nombre accesible «Registrar», i18n es/en/pt) y objetivo táctil ≥ 44 px (`.pf-icon-button`). Solo se muestra si el rol del workspace actual puede editar (`ctx.canEdit`). No se muestra en `/transacciones/nueva`, para no duplicar la acción.

6. **Cuenta recordada (D510).** Módulo `src/ui/transactions/last-account.ts` con `readLastAccount(userId, workspaceId)` y `writeLastAccount(userId, workspaceId, accountId)`, clave `pfos:last-account:v1:<userId>:<workspaceId>`. Toda lectura y escritura va en `try/catch`: sin almacenamiento disponible, devuelve `null` y no falla. Se escribe solo tras un registro exitoso y solo si cambia. Al abrir el alta, la cuenta inicial se elige en este orden: (1) `?cuenta=` del enlace; (2) la recordada, si está entre las cuentas activas del catálogo; (3) vacío. Una cuenta archivada, cerrada o de otro workspace no se preselecciona. No se llama a `PATCH /me`, así que no cambia `Me.version` ni genera el evento de auditoría `identity.user.preferences_changed`. El id de la cuenta no es un dato sensible (identificador interno, sin nombre ni saldo).

7. **Interacciones contadas (NFR-USAB-007).** Con cuenta recordada, fecha de hoy y categoría sugerida aceptada: (1) escribir el monto, (2) aceptar la sugerencia o elegir la categoría, (3) «Registrar». Son 3 interacciones (4 si hay que elegir la categoría en la lista). El E2E de la tarea 7.2 las cuenta.

8. **i18n y CSP.** Claves nuevas en `es`, `en` y `pt` (`transactions.quick.*`, `shell.notices.*`, `shell.quickAdd`). Los avisos con montos usan el formateador existente. Sin `<style>` ni `<script>` en línea ni dependencias nuevas; estilos en `globals.css`; `content-security-policy.spec.ts` en verde. Se prueba a 360 px con los textos en español, que son los más largos.

## Riesgos / Trade-offs

- **Specs E2E que esperan la navegación al detalle.** `transactions`, `lifecycle`, `custom-fields`, `category-suggestions`, `classification` y `a11y` registran desde `/transacciones/nueva`. Mitigación: los que verifican el detalle pasan a «Registrar e ir al detalle»; los demás esperan el aviso. Se revisa con `grep -rn "transacciones/nueva" tests/e2e`.
- **«Deshacer» por error.** Es una anulación real. Mitigación: el aviso cambia a «Registro anulado» y la transacción anulada sigue visible en el detalle y en el listado con su motivo.
- **Avisos que se pierden al navegar.** Es intencional (docs/78 § 11.1 punto 3). La información queda en el detalle de la transacción.
- **`localStorage` compartido en un dispositivo con varios usuarios.** La clave incluye el usuario y el workspace; el valor es solo un id.

## Plan de migración

Sin migraciones de datos ni de contratos. El despliegue es el de la web y la vuelta atrás es revertir el PR. Los datos de `localStorage` que quedan tras una vuelta atrás no tienen efecto.

## Preguntas abiertas

Ninguna. La cantidad de avisos visibles (3) es una decisión de diseño registrada en docs/79 y se puede ajustar en la revisión del change.
