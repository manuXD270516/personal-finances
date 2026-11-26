# Tareas

> Change 86 de docs/03 §7, decidido por D516 ([docs/79](../../../docs/79-ui-ux-modern-web-decisions.md); evidencia y preguntas en [docs/84](../../../docs/84-webkit-e2e-questions.md)). Depende del change 77 (`refine-web-accessibility-foundations`, fusionado): automatiza sus TC-PLATFORM-WEBUI-019 y -020. Lo implementa el agente `frontend` o el `implementador`. Reglas comunes: **no se toca la cookie de sesión, sus atributos ni `apps/web/src/bff/bff.ts`** (D516); nunca `pnpm stack:*`, `pnpm test:e2e` ni `docker compose` sin `PF_E2E_PROJECT=pfos-e2e-<nombre>` en la misma línea y prefijo de puertos 3 o 4; ningún check obligatorio nuevo ni cambio en la protección de `main` (requiere al owner); ninguna clave ni certificado versionado. Gates: los de `CLAUDE.md`, más `pnpm test:e2e` (cambia el stack de E2E) dos veces seguidas en verde.

## 1. SPEC, TEST CASES y verificaciones previas

- [ ] 1.1 Revisar los TC-PLATFORM-STACK-009..013 y TC-PLATFORM-PIPELINE-044 (`draft`) y pasarlos a `ready` al empezar; actualizar TC-PLATFORM-WEBUI-019 y -020 si cambia algún paso
- [ ] 1.2 Verificar en la PC del owner (Windows) que WebKit de Playwright envía la cookie `__Host-` sobre `https://localhost` con un certificado autofirmado e `ignoreHTTPSErrors` (el spike de Windows solo probó `http`; el de Linux, en el job de prueba del 2026-11-25, sí pasó por HTTPS). Si falla en Windows, el proyecto `webkit` corre solo en CI y se anota aquí y en docs/16

## 2. INFRASTRUCTURE: proxy TLS del stack

- [ ] 2.1 Servicio `tls-proxy` en `deploy/compose/compose.yaml`, perfil `tls`, imagen de Caddy con el mismo digest que `compose.prod.yaml`, `read_only`, `cap_drop: [ALL]`, `no-new-privileges`, `/data` y `/config` en `tmpfs`, puertos en `${PF_BIND_ADDR}` con el mismo número dentro y fuera, `depends_on` con `service_healthy` y healthcheck (design.md, decisión 2): TC-PLATFORM-STACK-009, -010
- [ ] 2.2 `deploy/compose/caddy/Caddyfile.e2e`: `local_certs`, `skip_install_trust`, `admin off`, tres sitios (`finance-web:3000`, `keycloak:8080`, `object-storage:8333`), sin HSTS: TC-PLATFORM-STACK-009
- [ ] 2.3 `PF_WEB_TLS_PORT`, `PF_KEYCLOAK_TLS_PORT` y `PF_OBJECT_STORAGE_TLS_PORT` en `.env.example` (23443, 28443, 29443) y en `docs/config-reference.md`; `pnpm config:docs:check` en verde
- [ ] 2.4 Que Renovate actualice el digest de Caddy en los dos archivos de Compose a la vez (revisar la regla de agrupación de imágenes)
- [ ] 2.5 Test del stack: sin el perfil `tls` no hay contenedor del proxy y la web responde por `http` en su puerto de siempre: TC-PLATFORM-STACK-013

## 3. INFRASTRUCTURE: harness de E2E

- [ ] 3.1 `tests/e2e/src/stack.ts`: `PORT_PREFIX` acepta solo `3` o `4` y falla con un mensaje que nombra `PF_E2E_PORT_PREFIX` antes de tocar Docker; test unitario del harness: TC-PLATFORM-STACK-012
- [ ] 3.2 `createEnvFile()`: `WEB_PUBLIC_URL`, `OIDC_PUBLIC_BASE_URL`, `OBJECT_STORAGE_PUBLIC_ENDPOINT` y `OBJECT_STORAGE_CORS_ORIGINS` por `https://localhost:<puerto TLS>` (design.md, decisión 4); el realm y el issuer los toman por interpolación, sin tocar `realm-pfos-dev.json`: TC-PLATFORM-STACK-009
- [ ] 3.3 `global-setup.ts`: `--profile tls` en `stack:up`; copiar la raíz de la autoridad con `docker compose -p <proyecto E2E> cp` a la carpeta del `.env` desechable y fijar `NODE_EXTRA_CA_CERTS` antes de que arranquen los workers; borrarla en el teardown. Nunca `NODE_TLS_REJECT_UNAUTHORIZED=0`: TC-PLATFORM-STACK-010
- [ ] 3.4 Comprobar que tras `stack:down --volumes` no queda ningún volumen ni archivo de la autoridad, y que `gitleaks` (check `secrets` de CI) no encuentra claves nuevas sin agregar excepciones: TC-PLATFORM-STACK-010

## 4. AUTOMATED TESTS y E2E en Chromium por HTTPS

- [ ] 4.1 `playwright.config.ts`: `use.ignoreHTTPSErrors: true` (design.md, decisión 5)
- [ ] 4.2 Suite completa en Chromium por `https` con `PF_E2E_PROJECT=pfos-e2e-<nombre>`; revisar los specs que comparan URL u orígenes (`auth`, `content-security-policy`, `api-conventions`) y los de subida (`documents`, `import-pdf`, `csv-import`, `import-pipeline`, `loans`, `category-suggestions`, `workspace-export`)
- [ ] 4.3 Buscar `http://` literales en `tests/e2e` y reemplazarlos por las URL del `.env`; ninguna violación de CSP ni de contenido mixto en `content-security-policy.spec.ts`
- [ ] 4.4 Prueba de subida directa de un documento por HTTPS sin bloqueo de contenido mixto: TC-PLATFORM-STACK-011
- [ ] 4.5 Prueba de que las tres URL públicas del `.env` desechable son `https://localhost` y el login termina con sesión: TC-PLATFORM-STACK-009

## 5. E2E en WebKit y job `e2e`

- [ ] 5.1 Proyecto `webkit` en `playwright.config.ts` con `testMatch` de `app-shell`, `a11y`, `transactions`, `auth` y `content-security-policy`, `devices['Desktop Safari']`, sin dependencia de `alerts` (D509; design.md, decisión 7). Si un test usa una API exclusiva de Chromium, `test.skip` para WebKit con el motivo anotado aquí: TC-PLATFORM-WEBUI-020
- [ ] 5.2 Prueba de sesión en WebKit: login, dos páginas y cookie `__Host-pfos_sid` con `Secure`, `HttpOnly`, `SameSite=Lax` y `Path=/`, idéntica a la de Chromium: TC-PLATFORM-WEBUI-020
- [ ] 5.3 `.github/workflows/pr.yml`: `playwright install --with-deps chromium webkit` en el job `e2e`, sin cambiar su nombre ni `timeout-minutes: 40`; paso final que escribe en el resumen del job la duración por proyecto desde el reporte JSON: TC-PLATFORM-WEBUI-019, TC-PLATFORM-PIPELINE-044
- [ ] 5.4 Anotar en el PR la duración del job en sus corridas; si pasa de 35 minutos, reducir el subconjunto y anotarlo aquí. Confirmar con `gh api repos/<repo>/branches/main/protection` que la lista de checks obligatorios no cambió: TC-PLATFORM-PIPELINE-044
- [ ] 5.5 Suite completa (Chromium y WebKit) en verde dos veces seguidas con `PF_E2E_PROJECT=pfos-e2e-<nombre>`; actualizar el front matter de los TC automatizados (`automated_tests`, `status: automated`, `automation_status: automated`), incluidos TC-PLATFORM-WEBUI-019 y -020

## 6. DOCUMENTATION

- [ ] 6.1 docs/16 §5 (stack de E2E): esquema `https`, perfil `tls`, autoridad efímera, `NODE_EXTRA_CA_CERTS`, prefijo 3 o 4 y proyecto `webkit`; nota de cómo abrir el stack de E2E a mano en el navegador (aceptar el certificado de prueba)
- [ ] 6.2 NFR-USAB-005 en docs/02: verificación con el subconjunto de WebKit en el job `e2e` por HTTPS (D516), en lugar de la nota de que espera al owner
- [ ] 6.3 Cierre del change 77 según la respuesta a P2 de docs/84: si se archivó con 6.1 a 6.3 diferidas, nada más; si esperó, marcar allí 6.1 a 6.3 con la referencia a este change y archivarlo después de este
- [ ] 6.4 Matriz de trazabilidad; `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check`; docs/38 con el estado del change
