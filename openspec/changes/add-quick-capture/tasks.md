# Tareas

> Change 78, lote L2 de [docs/78](../../../docs/78-propuesta-mejora-ui-ux-modern-web.md); decisiones D500, D502, D508, D510 y D512 en [docs/79](../../../docs/79-ui-ux-modern-web-decisions.md). **Lo implementa el agente `frontend` (D512).** Depende del change 77 `refine-web-accessibility-foundations` solo por `useFocusFirstError`; se implementa después de su grupo 3 y se archiva después del 77 (este change agrega un requirement a `platform/web-interface`, que crea el 77). Gates: los de `CLAUDE.md`, más `pnpm test:e2e` con `PF_E2E_PROJECT=pfos-e2e-<nombre>` y puertos con prefijo 3 o 4. Reglas comunes: claves i18n en `messages/{es,en,pt}.json` en el mismo commit; ningún `<style>` ni `<script>` en línea ni dependencia nueva (CSP de `apps/web/proxy.ts`); estilos como clases en `app/globals.css`; montos siempre como string decimal con el formateador existente, nunca `number`; `content-security-policy.spec.ts` y `a11y.spec.ts` en verde.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar los deltas de `transactions/transaction-recording` y `platform/web-interface` contra D502, D508 y D510; `openspec validate add-quick-capture --strict`
- [ ] 1.2 Revisar TC-TRANSACTIONS-QUICK-001..015 y TC-PLATFORM-WEBUI-021..024 contra los scenarios. Cifras: 1000.00 − 45.00 = 955.00; 955.00 − 30.00 = 925.00; deshacer: 955.00 + 45.00 = 1000.00 BOB. Pasarlos a `ready`

## 2. DOMAIN

- [ ] 2.1 Sin lógica de dominio: «Deshacer» reutiliza el comando `voidTransaction` existente y sus reglas (FR-TRANSACTIONS-009, INV-008)

## 3. APPLICATION (utilidades de la UI, test-first)

- [ ] 3.1 `last-account.ts` (`readLastAccount`/`writeLastAccount`, clave `pfos:last-account:v1:<userId>:<workspaceId>`, `try/catch` en toda lectura y escritura, escritura solo si cambia) y la función pura `initialAccount({ linkAccountId, remembered, activeAccounts })` con el orden de la decisión 6. Criterio: tests unitarios con almacenamiento que lanza excepción, cuenta archivada y enlace con prioridad: TC-TRANSACTIONS-QUICK-010..012
- [ ] 3.2 Reductor puro del estado de la región de avisos (`push`, `update`, `dismiss`, máximo 3 con salida del más antiguo) en `src/ui/common/notices.ts`. Criterio: tests unitarios del límite y del orden: TC-PLATFORM-WEBUI-024
- [ ] 3.3 Función pura `resetAfterSave(state)` del formulario (conserva tipo, cuenta, fecha y estado; vacía el resto). Criterio: test unitario: TC-TRANSACTIONS-QUICK-003

## 4. INFRASTRUCTURE

- [ ] 4.1 Sin cambios de infraestructura

## 5. UI (`apps/web`)

- [ ] 5.1 `NoticesProvider` y `NoticeRegion` en `src/ui/common/notices.tsx` (decisión 4), montados en `src/ui/AppFrame.tsx` también en `loading`: `<section role="region">` con nombre i18n, `data-testid="notice-region"`, avisos con `data-testid="notice"` y botón «Cerrar»; `popover="manual"` con `showPopover()` si existe y flujo normal si no; anuncio con `document.ariaNotify` detectado y respaldo `role="status"` oculto que se vacía antes de anunciar; `declare global` de `ariaNotify` en `src/ui/common/aria-notify.d.ts`; nada en `sessionStorage`/`localStorage`; clase `.pf-notices` en `globals.css`. Criterio: E2E de 7.5
- [ ] 5.2 `TransactionForm`: en el alta, orden monto → categoría → cuenta → fecha → resto (orden del DOM, sin CSS `order`); `autoFocusAmount` solo desde `NewTransactionPage`; `enterKeyHint="next"` en el monto; la edición sin cambios de orden ni foco. Criterio: E2E de 7.1 y los tests unitarios existentes de `transactions.test.tsx` en verde
- [ ] 5.3 Modo `afterSave: 'stay' | 'detail'` (decisión 2): botón principal «Registrar» (quedarse) y secundario «Registrar e ir al detalle» (`name="intent" value="detail"`, comportamiento actual con `?aviso=registrada`); tras un `201` en `'stay'`: aviso por tipo con el monto formateado y las acciones «Deshacer» y «Ver», `resetAfterSave`, clave de idempotencia nueva, foco al monto y `writeLastAccount`. El foco al primer error usa `useFocusFirstError` del change 77. Criterio: E2E de 7.2
- [ ] 5.4 «Deshacer» (decisión 3): `POST …/void` con `If-Match` de la versión registrada, `Idempotency-Key` propia y motivo `transactions.quick.undoReason` traducido; botón deshabilitado mientras la solicitud está en curso; en `200`, el aviso pasa a «Registro anulado» con «Ver»; en `409`/`412`, el mensaje del catálogo de errores. Criterio: E2E de 7.3
- [ ] 5.5 Cuenta inicial con `initialAccount` en `NewTransactionPage` (`?cuenta=` → recordada activa → vacío). Criterio: E2E de 7.4
- [ ] 5.6 Acceso «＋ Registrar» en la barra superior de `AppFrame` (decisión 5): enlace localizado a `/transacciones/nueva`, «＋» con `aria-hidden`, nombre «Registrar» en es/en/pt, `.pf-icon-button` (≥ 44 px), solo con `ctx.canEdit` y oculto en `/transacciones/nueva`. Criterio: E2E de 7.6
- [ ] 5.7 Ajustar los specs E2E que registran desde `/transacciones/nueva` (`grep -rn "transacciones/nueva" tests/e2e`: `transactions`, `lifecycle`, `custom-fields`, `category-suggestions`, `classification`, `a11y`): los que verifican el detalle pasan a «Registrar e ir al detalle» y los demás esperan el aviso. Criterio: suite completa en verde

## 6. API

- [ ] 6.1 Sin cambios: `contracts/openapi` no cambia (`pnpm contract:breaking` limpio)

## 7. AUTOMATED TESTS y E2E

Specs nuevos en `tests/e2e/specs/quick-capture.spec.ts`, con el TC-id al inicio de cada `test(...)`, `page.clock` para el tiempo y la fecha fija 2026-11-25 en America/La_Paz:

- [ ] 7.1 Monto primero a 360 × 800 (foco, `inputmode`, `enterkeyhint`) y edición sin foco: TC-TRANSACTIONS-QUICK-001, -002
- [ ] 7.2 Dos gastos seguidos (URL, formulario limpio, aviso, claves de idempotencia distintas por intercepción de la solicitud, saldo 925.00 BOB, conteo de interacciones ≤ 4), «Registrar e ir al detalle» y «Ver»: TC-TRANSACTIONS-QUICK-003, -004, -005
- [ ] 7.3 Deshacer (reversa y saldo 1000.00 BOB), periodo cerrado por la API antes de deshacer (`PERIOD_CLOSED`), doble clic con una sola reversa y deshacer a los 10 minutos: TC-TRANSACTIONS-QUICK-006..009
- [ ] 7.4 Cuenta recordada entre workspaces, enlace con prioridad, cuenta archivada, `localStorage` que lanza (con `page.addInitScript`) y sin `PATCH /me` ni cambio de versión del perfil: TC-TRANSACTIONS-QUICK-010..013
- [ ] 7.5 Región de avisos: persistencia a los 5 minutos sin mover el foco, «Cerrar», axe con el aviso visible, anuncio único en inglés (espía de `ariaNotify` con `page.addInitScript` y caso sin `ariaNotify`), recarga sin avisos y límite de 3: TC-PLATFORM-WEBUI-021..024
- [ ] 7.6 Acceso «＋ Registrar» para EDITOR y su ausencia para VIEWER: TC-TRANSACTIONS-QUICK-014, -015
- [ ] 7.7 Suite E2E completa en verde dos veces con `PF_E2E_PROJECT`; si el proyecto `webkit` del change 77 existe, `transactions` también en WebKit
- [ ] 7.8 Actualizar el front matter de los TC automatizados (`automated_tests`, `status: automated`, `automation_status: automated`)

## 8. DOCUMENTATION

- [ ] 8.1 docs/28 §4.1: alta rápida as-built (monto primero, registrar y seguir, «Deshacer» persistente que anula, cuenta recordada por dispositivo) y región de avisos
- [ ] 8.2 `docs/despliegue/GUIA-PRUEBAS-FUNCIONALES.md`: paso de prueba manual del alta rápida en el teléfono (NVDA o TalkBack con el aviso, docs/28 §10)
- [ ] 8.3 Matriz de trazabilidad; `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check`; docs/38 con el estado del change
