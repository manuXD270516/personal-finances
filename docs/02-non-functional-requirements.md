# 02 — Requerimientos no funcionales

> **Estado:** Propuesto · **Fecha:** 2026-10-01 · **Owner:** Principal Architect
> **Relacionado:** [ARCHITECTURE.md](./ARCHITECTURE.md) · [00-product-vision.md](./00-product-vision.md) · [01-functional-requirements.md](./01-functional-requirements.md) · [09-ledger-design.md](./09-ledger-design.md) · [16-testing-strategy.md](./16-testing-strategy.md) · [18-observability.md](./18-observability.md) · [28-ui-ux-design-system.md](./28-ui-ux-design-system.md) · [30-backup-and-disaster-recovery.md](./30-backup-and-disaster-recovery.md) · [26-risk-register.md](./26-risk-register.md)

---

## 1. Convenciones

- **ID:** `NFR-<CAT>-NNN` con `CAT ∈ {SEC, PERF, REL, OBS, PORT, MAINT, USAB, DATA, COMP}` (lista canónica de [ARCHITECTURE §12](./ARCHITECTURE.md#12-calidad-spec--test-traceability-adr-0016-adr-0024)). **Accesibilidad** se ubica en `USAB` (rango `NFR-USAB-1NN`) para no ampliar la lista canónica de categorías; si se decide crear `ACC`, se hará vía cambio de ARCHITECTURE + ADR-0024.
- Cada NFR tiene: **objetivo medible**, **método de verificación**, **fase** desde la que aplica y prioridad MoSCoW. Un NFR sin método de verificación no es aceptable.
- Las mediciones de rendimiento usan el **dataset `large`** ([29-seed-datasets.md](./29-seed-datasets.md): 5 años, ~100 000 transacciones + 20 workspaces satélite, restaurado desde snapshot). Los objetivos se expresan para el **workspace principal con ≥ 50 000 transacciones**, con los workspaces satélite presentes (verifica que RLS e índices escalan).
- Entorno de referencia de rendimiento: (a) **local**: laptop 8 vCPU / 16 GB RAM, Docker Desktop + WSL2; (b) **cloud prod**: perfil mínimo definido en [ADR-0013](./adr/0013-cloud-deployment-strategy.md) (p.ej. 0.5 vCPU / 1 GB por tarea, PG gestionado clase pequeña). Se reporta la peor de ambas cuando aplique.
- "Server time" = desde que el request llega a `finance-api` hasta que sale la respuesta (excluye red del cliente).

## 2. Resumen

| Categoría | Rango | # | Foco |
|-----------|-------|---|------|
| DATA — Integridad financiera y datos | NFR-DATA-001..016 | 16 | Sin float, redondeo, inmutabilidad, invariantes, migraciones |
| SEC — Seguridad y privacidad | NFR-SEC-001..020 | 20 | AuthN/Z, RLS, cifrado, secretos, OWASP, supply chain |
| PERF — Rendimiento | NFR-PERF-001..012 | 12 | Latencias p95, dashboard, imports, jobs |
| REL — Fiabilidad, backup y DR | NFR-REL-001..014 | 14 | RPO/RTO, backups, idempotencia, degradación |
| OBS — Observabilidad | NFR-OBS-001..009 | 9 | Logs, traces, métricas, alertas |
| PORT — Portabilidad | NFR-PORT-001..010 | 10 | Contenedores, Windows, cloud-agnóstico, export |
| MAINT — Mantenibilidad y calidad | NFR-MAINT-001..014 | 14 | Cobertura, arquitectura, specs, deps |
| USAB — Usabilidad, i18n y accesibilidad | NFR-USAB-001..010, 101..108 | 18 | es-first, formatos, navegadores, WCAG 2.2 AA |
| COMP — Cumplimiento | NFR-COMP-001..008 | 8 | Privacidad, licencias, retención, no-asesoría |

---

## 3. DATA — Integridad financiera y gestión de datos

> Estos NFR son **no negociables** (principio PP-02). Un fallo en cualquiera bloquea el release.

| ID | Requerimiento | Objetivo / métrica | Verificación | Fase | Prio |
|----|---------------|--------------------|--------------|------|------|
| NFR-DATA-001 | (INV-001) **Prohibido `number`/float para dinero y tasas.** Todo monto usa `Money` (decimal.js, precisión interna 40 dígitos) y en BD `NUMERIC(38,18)`. | 0 ocurrencias de tipos float para dinero en `domain`/`application`/`infrastructure`; 0 columnas `real/double precision/money` en schemas de negocio. | Lint rule custom + architecture test (dependency-cruiser/ts-morph) + test de catálogo PG (`information_schema`) en CI. | 1 | Must |
| NFR-DATA-002 | (INV-020) **Redondeo determinista HALF_EVEN** a la escala de la moneda solo en puntos de materialización (posting, cuota, asignación, presentación). | Mismo input → mismo output en 100 % de ejecuciones; 0 drift en Σ. | Property-based tests (fast-check, ≥ 1 000 casos por propiedad en CI, ≥ 100 000 nightly). | 1 | Must |
| NFR-DATA-003 | **Reparto exacto** (splits, cuotas, porcentajes) mediante *largest remainder* determinista. | Σ partes = total exactamente en 100 % de casos generados; orden de desempate estable y documentado. | PBT + test cases `TC-TRANSACTIONS-SPLIT-*`. | 1 | Must |
| NFR-DATA-004 | (INV-004) **Balance por moneda**: toda JournalEntry cumple Σ postings = 0 por moneda. | 0 entries desbalanceadas persistidas (doble barrera dominio + constraint trigger diferido). | Unit + integration test que intenta insertar entry desbalanceada vía SQL directo (debe fallar) + job de invariantes en prod. | 1 | Must |
| NFR-DATA-005 | **Inmutabilidad del ledger**: sin UPDATE/DELETE sobre `ledger.posting` y `ledger.journal_entry` (salvo columnas técnicas explícitamente permitidas). | Rol de app sin privilegio UPDATE/DELETE en esas tablas; trigger que rechaza mutaciones. | Integration test con rol de app; revisión de grants en migración. | 1 | Must |
| NFR-DATA-006 | (INV-011) **Historia inmutable de FX y cierres**: tasas históricas, `ConversionDetail` y snapshots de cierre nunca se modifican. | 0 UPDATE sobre esas tablas por rol de app; correcciones solo por nueva versión. | Integration tests + grants. | 1 (FX) / 2 (cierres) | Must |
| NFR-DATA-007 | (INV-029) **Audit síncrono**: todo comando que muta datos financieros escribe AuditLog en la misma transacción. | 100 % de comandos mutantes cubiertos; fallo de audit ⇒ rollback. | Test de arquitectura (cada command handler usa `AuditPort` dentro de la UoW) + test de fallo inyectado. | 1 | Must |
| NFR-DATA-008 | **Invariant checker** en producción ejecuta las verificaciones `INV-*` de [09-ledger-design.md](./09-ledger-design.md). | Ejecución ≥ 1 vez/día y tras cada restore; alerta en < 5 min ante violación; tiempo de ejecución < 60 s con dataset `large`. | Job programado + alerta OBS; ejecución en CI con seed `large`. | 1 | Must |
| NFR-DATA-009 | **Reconstruibilidad**: snapshots de saldo y read models se reconstruyen desde la fuente de verdad. | Rebuild completo con dataset `large` < 5 min; resultado bit a bit igual a los derivados actuales. | Comando `rebuild` testeado en CI (nightly). | 1 | Must |
| NFR-DATA-010 | **Round-trip de montos** NUMERIC ↔ string ↔ Decimal sin pérdida. | 100 % de casos PBT incluyendo escalas 0, 2, 6, 8, 18 y magnitudes hasta 10^20. | PBT (SPIKE-03) + integration test con PG real. | 1 | Must |
| NFR-DATA-011 | **IDs UUIDv7** generados en la app; timestamps `timestamptz` UTC; fechas de negocio `date` interpretadas en la zona del workspace. | 0 columnas `timestamp without time zone` en schemas de negocio. | Test de catálogo PG. | 1 | Must |
| NFR-DATA-012 | **Sin hard delete** en datos financieros; catálogos referenciados se archivan. | 0 `DELETE` en repositorios de agregados financieros (excepto purgas de retención documentadas). | Lint/architecture test sobre repositorios + grants. | 1 | Must |
| NFR-DATA-013 | **Migraciones seguras** expand → migrate → contract; migraciones destructivas requieren aprobación manual. | 100 % de migraciones reversibles o con plan de rollback documentado; 0 migraciones destructivas sin label `destructive-approved`. | Check en CI (lint de SQL de migración) + gate manual en pipeline. | 1 | Must |
| NFR-DATA-014 | **Optimistic locking** en agregados (`version`). | 0 lost updates en test concurrente (2 escritores simultáneos). | Integration test concurrente. | 1 | Must |
| NFR-DATA-015 | **Integridad referencial intra-contexto** con FKs; inter-contexto solo por ID (sin FKs cross-schema salvo `workspace_id` y `currency`). | 0 FKs cross-schema no permitidas. | Test de catálogo PG. | 1 | Must |
| NFR-DATA-016 | **Calidad de datos de imports**: ninguna fila importada se persiste sin pasar validación y aprobación. | 0 transacciones con `importJobId` de un job no `approved`. | Integration test + invariante. | 6 | Must |

## 4. SEC — Seguridad y privacidad

| ID | Requerimiento | Objetivo / métrica | Verificación | Fase | Prio |
|----|---------------|--------------------|--------------|------|------|
| NFR-SEC-001 | Autenticación OIDC Authorization Code + PKCE vía BFF; tokens nunca en JS del navegador ni en `localStorage`. | 0 tokens accesibles desde `document.cookie`/storage. | E2E Playwright inspecciona storage; revisión de cookies (`httpOnly`, `Secure`, `SameSite`). | 1 | Must |
| NFR-SEC-002 | Validación de JWT en API: firma (JWKS con caché y rotación), `iss`, `aud`, `exp`, `nbf`; clock skew ≤ 60 s. | 100 % de endpoints de negocio protegidos (salvo health). | Test que enumera rutas Nest y verifica guard; tests negativos por claim. | 1 | Must |
| NFR-SEC-003 | Autorización RBAC por workspace en la capa de aplicación + **RLS** en PG como defensa en profundidad; rol de app sin `BYPASSRLS` y no owner de tablas. | 0 accesos cross-workspace en suite de tests de aislamiento. | Tests de aislamiento multi-tenant (2 workspaces, todos los endpoints) en CI. | 1 | Must |
| NFR-SEC-004 | `SET LOCAL app.workspace_id` por transacción; nunca a nivel de sesión de pool. | 0 fugas en test de pool con requests intercalados de 2 workspaces. | Integration test de concurrencia (SPIKE-02). | 1 | Must |
| NFR-SEC-005 | Cifrado en tránsito TLS 1.2+ (preferido 1.3) en todo tráfico externo en cloud; HSTS. | Calificación A en escáner TLS; HSTS ≥ 6 meses. | Escaneo en staging. | 9 | Must |
| NFR-SEC-006 | Cifrado en reposo: BD, backups y object storage cifrados (KMS en cloud). | 100 % de volúmenes/buckets/backups cifrados. | Checks de Terraform (tfsec/checkov) + revisión. | 9 | Must |
| NFR-SEC-007 | Gestión de secretos: nunca en repo ni en imágenes; `.env.example` sin secretos; cloud vía secrets manager. | 0 hallazgos de secret scanning. | gitleaks en pre-commit y CI; Trivy secret scan de imágenes. | 0 | Must |
| NFR-SEC-008 | Cabeceras de seguridad web: CSP estricta (sin `unsafe-inline` en scripts, nonces), `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`, CSRF para mutaciones vía BFF. | Observatory/ZAP baseline sin hallazgos High. | ZAP baseline en staging (Hito H), checks en E2E desde Phase 1. | 1 | Must |
| NFR-SEC-009 | Validación de entrada en el borde contra el contrato OpenAPI y en dominio (invariantes). | 100 % de endpoints con schema de request; rechazo con RFC 9457. | Contract tests. | 1 | Must |
| NFR-SEC-010 | Protección OWASP ASVS 4.0 nivel 2 en controles aplicables. | Checklist ASVS L2 ≥ 90 % de controles aplicables cumplidos antes de prod. | Revisión documentada en doc 12 (seguridad). | 9 | Must |
| NFR-SEC-011 | Rate limiting por usuario/IP en BFF y API; límites más estrictos en auth y uploads. | p.ej. 100 req/min usuario en API, 10 uploads/min. | Integration/E2E test. | 1 (básico) / 9 | Should |
| NFR-SEC-012 | Seguridad de uploads: presigned URLs de corta duración (PUT ≤ 10 min, GET ≤ 5 min), validación MIME/extensión/tamaño/checksum, bucket privado, sin listado público. | 0 objetos públicos. | Tests `security/file-upload-security` + policy check. | 6 | Must |
| NFR-SEC-013 | Supply chain: lockfile, dependabot/renovate, `pnpm audit`/OSV, Trivy en imágenes; SBOM por imagen. | 0 vulnerabilidades Critical; High con excepción documentada ≤ 30 días. | CI gates. | 0 | Must |
| NFR-SEC-014 | Imágenes non-root, read-only root filesystem donde sea posible, sin shells innecesarias (distroless/alpine endurecida). | 100 % imágenes non-root. | Trivy config + test de contenedor. | 1 | Must |
| NFR-SEC-015 | Logs sin datos sensibles: nunca tokens, cookies, identificadores completos de cuenta; montos y descripciones solo en nivel `debug` desactivado en prod. | 0 hallazgos en test de redacción (pino redact paths). | Test unitario de redacción + revisión de muestras. | 1 | Must |
| NFR-SEC-016 | Mínimo privilegio en BD: roles separados `migrator`, `app`, `readonly_reporting`, `backup`. | Grants revisados por migración; test de permisos. | Integration test. | 1 | Must |
| NFR-SEC-017 | Sesión: expiración por inactividad 30 min (configurable) y absoluta 12 h; logout invalida sesión del BFF. | Cumplido en E2E. | E2E. | 1 | Must |
| NFR-SEC-018 | MFA disponible y exigible para `OWNER` en producción. | MFA habilitada para 100 % de OWNERs en prod. | Configuración IdP + test manual documentado. | 9 | Should |
| NFR-SEC-019 | Asistente IA: sin acceso directo a BD, tools allowlisted, prompt injection mitigado (datos de usuario tratados como datos), sin envío de PII innecesaria al proveedor. | 0 tool calls fuera de allowlist en suite adversarial. | Red-team suite (doc 27). | 10 | Must |
| NFR-SEC-020 | Threat model (STRIDE) actualizado por fase para nuevos flujos (auth, uploads, imports, IA). | 1 revisión por fase antes del exit. | Doc 12 versionado. | 0 | Should |

## 5. PERF — Rendimiento

| ID | Requerimiento | Objetivo / métrica | Verificación | Fase | Prio |
|----|---------------|--------------------|--------------|------|------|
| NFR-PERF-001 | **Listado de transacciones** paginado (limit 50, filtros por fecha/cuenta/categoría) con dataset de **50 000 transacciones**. | p95 server time ≤ **200 ms**, p99 ≤ 400 ms (cloud prod); local ≤ 300 ms p95. | Benchmark k6/autocannon en CI nightly con seed `large`. | 1 | Must |
| NFR-PERF-002 | Búsqueda de texto en transacciones (50k). | p95 ≤ 400 ms. | Benchmark nightly. | 1 | Should |
| NFR-PERF-003 | **Comandos de escritura** (crear transacción/transfer/conversión con posting + audit + outbox). | p95 ≤ **150 ms** server time. | Benchmark nightly. | 1 | Must |
| NFR-PERF-004 | **Dashboard (Home)**: carga completa de los widgets disponibles. | API de dashboard p95 ≤ **300 ms**; LCP ≤ **2.5 s** y INP ≤ 200 ms en conexión "Fast 4G" emulada; TTI ≤ 3.5 s. | Lighthouse CI + Playwright traces en CI. | 1 | Must |
| NFR-PERF-005 | Saldo de cuenta as-of (con snapshots). | p95 ≤ 50 ms por cuenta; ≤ 150 ms para todas las cuentas del workspace. | Benchmark. | 1 | Must |
| NFR-PERF-006 | **Reportes** agregados (12 meses, 50k txn). | p95 ≤ 800 ms; drill-down ≤ 300 ms. | Benchmark nightly. | 7 | Must |
| NFR-PERF-007 | **Imports**: archivo CSV de 5 000 filas hasta preview. | ≤ 30 s end-to-end (parse + normalize + validate + dedupe + rules); persistencia ≤ 20 s. | Integration test con fixture. | 6 | Must |
| NFR-PERF-008 | **Eventual consistency** de read models y notificaciones. | p95 lag outbox → handler ≤ **5 s**; p99 ≤ 30 s; cada consumidor drena ≥ 42 eventos/s por consumidor (un backlog de 5 000 eventos en 500 agregados en ≤ 120 s con un handler trivial). | Métricas `outbox_lag_seconds`, `event_consumer_backlog` y `event_consumer_duration_seconds`; TC-PLATFORM-EVENTS-014 (integración, `improve-event-throughput`); benchmark nightly de throughput por consumidor con el dataset `large` (`pnpm perf:bench`). | 1 | Must |
| NFR-PERF-009 | Generación de ocurrencias recurrentes (60 definiciones, horizonte 90 días). | ≤ 10 s por workspace. | Integration test. | 3 | Should |
| NFR-PERF-010 | Cash-flow calendar 90 días. | p95 ≤ 500 ms. | Benchmark. | 7 | Should |
| NFR-PERF-011 | Bundle inicial de la web (JS comprimido de la ruta Home). | ≤ 250 KB gzip. | Bundle analyzer en CI con presupuesto. | 1 | Should |
| NFR-PERF-012 | Forecast batch por workspace (todas las series, horizonte 12 meses). | ≤ 5 min; nunca bloquea requests online. | Benchmark del servicio ML. | 8 | Should |

## 6. REL — Fiabilidad, backup y recuperación

Detalle operativo en [30-backup-and-disaster-recovery.md](./30-backup-and-disaster-recovery.md).

| ID | Requerimiento | Objetivo / métrica | Verificación | Fase | Prio |
|----|---------------|--------------------|--------------|------|------|
| NFR-REL-001 | **RPO producción**. | ≤ **15 min** (PITR / WAL archiving continuo). | Drill de restore PITR **mensual** automatizado ([30-backup-and-disaster-recovery.md](./30-backup-and-disaster-recovery.md)). | 9 | Must |
| NFR-REL-002 | **RTO producción**. | ≤ **4 h** para restaurar servicio completo desde backup en la misma región (≤ 1 h ante fallo de instancia; RTO observado en drill < 1 h); ≤ 24 h ante pérdida de región. | Drill mensual (`restore-drill`) que mide RTO observado. | 9 | Must |
| NFR-REL-003 | **Retención de backups** producción. | Diarios 35 días, mensuales 12 meses, anuales 5 años; copia en ubicación/cuenta separada (inmutable/WORM). | Revisión de políticas en IaC + inventario mensual. | 9 | Must |
| NFR-REL-004 | **Backups locales** (uso real antes de cloud). | `pnpm backup:local` produce dump lógico + objetos en < 2 min (dataset real); restore verificado `pnpm restore:local`; recomendación de backup diario a disco externo/cloud del usuario. RPO local ≤ 24 h. | Test automatizado backup→restore→invariant checker en CI nightly. | 1 | Must |
| NFR-REL-005 | **Restore verificado**: todo restore ejecuta el invariant checker y compara conteos/sumas de control. | 100 % de restores verificados; ≥ 1 restore de prueba mensual en prod. | Runbook + registro. | 1 (local) / 9 | Must |
| NFR-REL-006 | **Disponibilidad** producción (single-user, single-region). | ≥ **99.5 %** mensual (excluye mantenimiento anunciado). | Uptime check externo + SLO dashboard. | 9 | Should |
| NFR-REL-007 | (INV-027) **Idempotencia** de comandos financieros y consumidores. | Reintento de cualquier POST con `Idempotency-Key` o reentrega de evento produce 0 efectos duplicados. | Tests de reintento + PBT de reentrega. | 1 | Must |
| NFR-REL-008 | **Entrega at-least-once** de eventos con outbox; ningún evento perdido ante caída del worker. | 0 eventos perdidos en test de caos (kill del worker durante relay). | Integration test (SPIKE-05). | 1 | Must |
| NFR-REL-009 | **Graceful shutdown** de api y worker. | Requests en vuelo completan ≤ 30 s; jobs se re-encolan sin pérdida. | Integration test con SIGTERM. | 1 | Must |
| NFR-REL-010 | **Degradación**: indisponibilidad de Redis, object storage, providers FX, ML o LLM no impide registrar/consultar transacciones (salvo la feature afectada). | Core write/read path funcional con Redis caído (outbox acumula). | Test de resiliencia en compose (stop service). | 1 | Must |
| NFR-REL-011 | Healthchecks `/health/live` y `/health/ready` (PG, Redis, storage). | Ready falla en ≤ 10 s ante dependencia caída. | Integration test. | 1 | Must |
| NFR-REL-012 | Reintentos con backoff exponencial y DLQ para jobs. | Máx. 5 reintentos; DLQ visible y alertada. | Integration test. | 1 | Must |
| NFR-REL-013 | Migraciones en despliegue sin pérdida de datos y con rollback de aplicación posible (compatibilidad N-1 del schema). | 100 % de releases con migraciones expand compatibles con versión anterior. | Test de compatibilidad en CI (app N-1 contra schema N). | 9 | Should |
| NFR-REL-014 | Export portable completo (FR-IDENTITY-010) como último recurso de recuperación independiente de la infraestructura. | Export + import en workspace vacío reproduce saldos idénticos. | Test round-trip nightly. | 2 | Should |

## 7. OBS — Observabilidad

Detalle en [18-observability.md](./18-observability.md) y ADR-0020.

| ID | Requerimiento | Objetivo / métrica | Verificación | Fase | Prio |
|----|---------------|--------------------|--------------|------|------|
| NFR-OBS-001 | Logs estructurados JSON (pino) con `traceId`, `spanId`, `correlationId`, `workspaceId` (no PII), nivel, servicio, versión. | 100 % de logs de app en JSON con campos obligatorios. | Test de formato. | 1 | Must |
| NFR-OBS-002 | Tracing distribuido OpenTelemetry web(BFF) → api → PG/Redis → worker (propagación vía outbox/BullMQ). | Trazas end-to-end para el 100 % de requests muestreados; sampling configurable (100 % local, ≥ 10 % prod + 100 % errores). | Verificación en `otel-lgtm` (SPIKE-10). | 1 | Should |
| NFR-OBS-003 | Métricas RED por endpoint (rate, errors, duration) y USE de recursos. | Dashboards base disponibles en local (profile `observability`) y cloud. | Revisión. | 1 | Should |
| NFR-OBS-004 | Métricas de dominio: transacciones creadas, entries, `outbox_lag_seconds`, `outbox_pending`, jobs fallidos, DLQ, invariantes violadas, imports por estado. | Exportadas y graficadas. | Revisión + test de emisión. | 1 | Must |
| NFR-OBS-005 | Alertas: invariante violada (crítica), DLQ > 0, outbox lag p95 > 60 s, error rate 5xx > 2 % 5 min, backup fallido, certificado < 14 días. | Alertas enrutadas a email del owner. | Prueba de disparo por alerta. | 9 (1 para invariante en local vía log/notify) | Must |
| NFR-OBS-006 | Errores con RFC 9457 incluyen `traceId` para correlación (sin stack trace en prod). | 100 % de respuestas de error. | Contract tests. | 1 | Must |
| NFR-OBS-007 | Logs de auditoría separados de logs técnicos (audit en BD, no en logs). | — | Revisión de arquitectura. | 1 | Must |
| NFR-OBS-008 | Retención de logs/trazas en cloud. | Logs 30 días, trazas 7 días, métricas 90 días (ajustable por costo). | IaC. | 9 | Should |
| NFR-OBS-009 | Observabilidad del servicio ML y del asistente (latencia, tokens, costo por consulta, tasa de "no sé"). | Métricas disponibles antes de activar en prod. | Revisión. | 8/10 | Should |

## 8. PORT — Portabilidad

| ID | Requerimiento | Objetivo / métrica | Verificación | Fase | Prio |
|----|---------------|--------------------|--------------|------|------|
| NFR-PORT-001 | Todo el producto corre con **Docker Compose** (profiles `deps`, `core`, `seed`, `observability`, `ml`) en **Windows 11 (WSL2)**, Linux y macOS. | `pnpm stack:up` funcional en los 3 SO; CI valida Linux; Windows validado por el owner en cada fase. | Checklist de release + job CI. | 0/1 | Must |
| NFR-PORT-002 | **Tiempo de arranque local**: `pnpm stack:up` (profile `core`) con imágenes ya construidas/cacheadas. | Todos los servicios `healthy` en ≤ **90 s**; primer arranque en frío (pull/build) ≤ 10 min. | Medición en SPIKE-08 y CI. | 1 | Must |
| NFR-PORT-003 | **Onboarding**: de clone a app con seed `demo` funcionando. | ≤ 15 min con prerequisitos instalados (Docker, Node LTS, pnpm), siguiendo solo el README. | Prueba en máquina limpia por fase. | 1 | Should |
| NFR-PORT-004 | Scripts **cross-platform** (Node/tsx vía pnpm); prohibidos scripts solo-bash o solo-PowerShell en flujos principales. | 0 scripts `.sh` requeridos en flujos `stack:*`, `db:*`, `test*`, `backup:*`. | Lint de `package.json` scripts + CI Windows runner (smoke). | 0 | Must |
| NFR-PORT-005 | Configuración 12-factor por env vars; sin `localhost` hardcodeado. | 0 hallazgos de grep `localhost` fuera de `.env.example` y docs. | Check en CI. | 1 | Must |
| NFR-PORT-006 | **Misma imagen** para local, CI, staging y prod (tag inmutable por digest). | 100 % de despliegues por digest. | Pipeline. | 1/9 | Must |
| NFR-PORT-007 | Dependencias cloud tras puertos (ObjectStorage S3 API, OIDC estándar, SMTP, PostgreSQL estándar); sin servicios propietarios en el core. | Migrar entre AWS y GCP (Cloud Run) solo requiere cambiar IaC/config. | Revisión de ADR-0013 + spike de plan B. | 9 | Should |
| NFR-PORT-008 | Imágenes multi-arch (amd64 + arm64). | Build multi-arch en CI. | Pipeline. | 9 | Should |
| NFR-PORT-009 | Export de datos en formatos abiertos (JSON versionado con JSON Schema, CSV RFC 4180 UTF-8). | Export validado contra schema. | Test. | 2 | Must |
| NFR-PORT-010 | Fin de línea y encoding: repositorio con `.gitattributes` (LF), archivos UTF-8; herramientas tolerantes a rutas Windows con espacios. | 0 fallos por CRLF/rutas en CI Windows smoke. | CI. | 0 | Must |

## 9. MAINT — Mantenibilidad y calidad

| ID | Requerimiento | Objetivo / métrica | Verificación | Fase | Prio |
|----|---------------|--------------------|--------------|------|------|
| NFR-MAINT-001 | **Spec-first**: todo cambio de comportamiento tiene change OpenSpec validado (`openspec validate --strict`). | 100 % de PRs con cambio de comportamiento enlazan change-id; CI falla si validate falla. | CI gate + plantilla de PR. | 0 | Must |
| NFR-MAINT-002 | **Cobertura de dominio** (`shared-kernel` y `domain` críticos). | `shared-kernel`: líneas ≥ **95 %**, ramas ≥ **90 %**; `domain` críticos (ledger, transactions, fx, debt, commitments, planning): ≥ **90 %** / **85 %**; **mutation score ≥ 80 %** (Stryker) en Money/rounding/allocation, `ledger/domain`, `transactions/domain` y luego `debt/domain` — informativo nightly al inicio, gate posterior ([16-testing-strategy.md §8](./16-testing-strategy.md)). | Vitest coverage + Stryker nightly. | 1 | Must |
| NFR-MAINT-003 | Cobertura del resto de paquetes (`application`, contextos no críticos). | Líneas ≥ 70 % (informativo en Phase 1, bloqueante desde Phase 2). Los umbrales solo pueden subir. | Vitest coverage. | 1 | Should |
| NFR-MAINT-004 | Cobertura de **trazabilidad** (prioritaria sobre la de líneas): todo Requirement `Must` con ≥ 1 TC y todo TC `automated` con test existente. | 100 %. | Matriz ([17-test-traceability.md](./17-test-traceability.md)). | 1 | Must |
| NFR-MAINT-005 | **Trazabilidad**: cada Requirement OpenSpec de una fase liberada tiene ≥ 1 TC y cada TC Must está automatizado. | 100 % (matriz generada en `tests/traceability/`). | Script de matriz en CI (`quality/test-traceability`). | 1 | Must |
| NFR-MAINT-006 | **Reglas de arquitectura** (capas, sin imports cross-context fuera de `contracts`, Nest/Kysely fuera de `domain`). | 0 violaciones dependency-cruiser. | CI gate. | 1 | Must |
| NFR-MAINT-007 | **Duración de la suite**: unit+domain; integration; E2E smoke. | Unit+domain ≤ **2 min**; integration (Testcontainers, paralelo) ≤ **8 min**; pipeline PR completo ≤ **15 min**; E2E completo nightly ≤ 30 min. | Métricas de CI; alerta si se excede 3 días seguidos. | 1 | Should |
| NFR-MAINT-008 | TypeScript `strict` + `noUncheckedIndexedAccess`; ESLint sin warnings; Prettier. | 0 errores/warnings. | CI. | 1 | Must |
| NFR-MAINT-009 | **Contratos**: OpenAPI 3.1 lint (Spectral/Redocly) sin errores; JSON Schemas de eventos versionados; breaking change detectado automáticamente. | 0 breaking changes no versionados. | oasdiff/Spectral en CI. | 1 | Must |
| NFR-MAINT-010 | **ADRs** para toda decisión arquitectónica significativa (formato MADR). | 100 % de decisiones de stack con ADR aceptado antes de implementarse. | Revisión en DESIGN GATE. | 0 | Must |
| NFR-MAINT-011 | Conventional Commits + release-please; changelog generado. | 100 % commits válidos (commitlint). | CI. | 1 | Should |
| NFR-MAINT-012 | Actualización de dependencias. | Dependencias sin parches de seguridad pendientes > 30 días; major upgrades evaluados trimestralmente. | Renovate dashboard. | 1 | Should |
| NFR-MAINT-013 | Complejidad acotada en dominio. | Complejidad ciclomática por función ≤ 10 (warn), ≤ 15 (error). | ESLint `complexity`. | 1 | Could |
| NFR-MAINT-014 | Documentación viva: cada contexto tiene README con lenguaje ubicuo, agregados, eventos y puertos. | 100 % de contextos implementados. | Checklist de exit de fase. | 1 | Should |

## 10. USAB — Usabilidad, i18n, formatos y accesibilidad

### 10.1 Usabilidad e internacionalización

| ID | Requerimiento | Objetivo / métrica | Verificación | Fase | Prio |
|----|---------------|--------------------|--------------|------|------|
| NFR-USAB-001 | **Español primero**: toda la UI, mensajes de error y emails en español; arquitectura i18n (catálogos de mensajes, sin strings hardcodeados en componentes) lista para inglés (`en`) y portugués (`pt-BR`). | 100 % strings vía catálogo; 0 strings literales en JSX (lint). | ESLint i18n rule + revisión. | 1 | Must |
| NFR-USAB-002 | **Formato de moneda** según locale del workspace (default `es-BO`: `Bs 1.234,56`, `US$ 1.234,56`, `1.234,567890 USDT`) usando `Intl.NumberFormat` con escala de la moneda; el formateo NO convierte a float (formateo desde string/Decimal). | 100 % de montos con símbolo/código y escala correcta. | Unit tests de formatter + visual tests. | 1 | Must |
| NFR-USAB-003 | **Entrada de montos** tolerante: acepta separador decimal del locale y punto; nunca pierde precisión; muestra error si excede escala. | Casos de prueba `es-BO` y `en-US`. | Unit + E2E. | 1 | Must |
| NFR-USAB-004 | **Fechas**: formato `dd/MM/yyyy` (es-BO) en UI, `YYYY-MM-DD` en API; semana inicia lunes; zona del workspace para "hoy" y límites de periodo. | 0 errores off-by-one en límites de mes (tests con TZ `America/La_Paz` y UTC). | Unit tests con TZ forzada. | 1 | Must |
| NFR-USAB-005 | **Soporte de navegadores**: últimas 2 versiones estables de Chrome, Edge, Firefox y Safari (desktop y móvil). | Suite E2E en Chromium, Firefox y WebKit. | Playwright matrix (nightly). | 1 | Must |
| NFR-USAB-006 | **Responsive**: usable desde 360 px de ancho; captura rápida de transacción optimizada para móvil. | Flujos críticos E2E en viewport móvil. | Playwright mobile. | 1 | Must |
| NFR-USAB-007 | **Eficiencia de captura**: crear gasto simple en ≤ 15 s (p50) y ≤ 4 interacciones con defaults (cuenta y fecha recordadas). | Medición en test de usabilidad (SM-03). | Prueba con owner + telemetría UX opcional. | 1 | Should |
| NFR-USAB-008 | Atajos de teclado para acciones frecuentes (nueva transacción, búsqueda, navegación). | Documentados y accesibles. | E2E. | 2 | Could |
| NFR-USAB-009 | Mensajes de error accionables, en español, mapeados desde `code` de dominio (nunca stack traces ni códigos crudos). | 100 % de códigos de dominio con mensaje traducido. | Test de catálogo de errores. | 1 | Must |
| NFR-USAB-010 | Lenguaje sin jerga contable en la UI (débito/crédito no aparecen salvo vista técnica). | Revisión de copy por fase. | Checklist UX (doc 28). | 1 | Should |

### 10.2 Accesibilidad (WCAG 2.2 AA)

| ID | Requerimiento | Objetivo / métrica | Verificación | Fase | Prio |
|----|---------------|--------------------|--------------|------|------|
| NFR-USAB-101 | Conformidad **WCAG 2.2 nivel AA** en todas las pantallas. | 0 violaciones `serious`/`critical` de axe-core en flujos E2E; auditoría manual por fase. | `@axe-core/playwright` en CI + checklist manual. | 1 | Must |
| NFR-USAB-102 | Navegación completa por teclado, foco visible (2.4.11/2.4.13), sin trampas de foco. | 100 % de flujos críticos operables solo con teclado. | E2E keyboard-only. | 1 | Must |
| NFR-USAB-103 | Contraste ≥ 4.5:1 texto, ≥ 3:1 componentes UI y gráficos; en modo claro y oscuro. | Tokens de diseño validados. | Validador de tokens (doc 28) + axe. | 1 | Must |
| NFR-USAB-104 | El color nunca es el único medio para comunicar estado (ingreso/gasto, sobre/bajo presupuesto, behind/ahead). | Iconos/texto acompañan al color. | Revisión UX. | 1 | Must |
| NFR-USAB-105 | Gráficos (ECharts) con alternativa textual/tabla accesible y `aria` descriptivo. | 100 % de gráficos con tabla alternativa. | Revisión + axe. | 1 | Must |
| NFR-USAB-106 | Tamaño mínimo de objetivos táctiles 24×24 px (2.5.8). | 0 violaciones. | axe + revisión. | 1 | Must |
| NFR-USAB-107 | Respeta `prefers-reduced-motion` y zoom 200 % sin pérdida de funcionalidad / reflow a 320 px. | Cumplido. | Prueba manual + E2E. | 1 | Should |
| NFR-USAB-108 | Compatibilidad con lectores de pantalla (NVDA + Firefox/Chrome en Windows, VoiceOver en Safari) en flujos críticos. | Flujos de crear transacción y ver dashboard verificados. | Prueba manual por fase. | 2 | Should |

## 11. COMP — Cumplimiento, privacidad y licencias

| ID | Requerimiento | Objetivo / métrica | Verificación | Fase | Prio |
|----|---------------|--------------------|--------------|------|------|
| NFR-COMP-001 | **Privacidad**: datos financieros solo procesados para el propósito del usuario; sin telemetría de contenido financiero; sin compartir con terceros sin consentimiento explícito (incluye proveedores LLM). | Inventario de flujos de datos a terceros = vacío salvo opt-in. | Registro de procesamiento en doc 12. | 1 | Must |
| NFR-COMP-002 | Principios alineados con GDPR / Ley de protección de datos aplicable en Bolivia (minimización, acceso, portabilidad, rectificación); export completo y borrado de workspace disponibles antes de multi-usuario. | Export (Phase 2), borrado (track de Colaboración). | Checklist. | 2/11 | Should |
| NFR-COMP-003 | **Licencias**: solo dependencias con licencias compatibles (MIT, Apache-2.0, BSD, ISC, MPL-2.0 con revisión); AGPL/SSPL/BSL solo como servicios externos no modificados y con ADR (p.ej. object storage, ver SPIKE-07). | 0 licencias no permitidas en dependencias de código. | License checker en CI. | 0 | Must |
| NFR-COMP-004 | **No asesoría financiera**: el producto (incl. forecasting e IA) no emite recomendaciones de inversión; disclaimers en forecasting y asistente. | Copy revisado. | Checklist UX/IA. | 8/10 | Must |
| NFR-COMP-005 | **Retención**: datos financieros conservados mientras exista el workspace; logs técnicos ≤ 30 días; documentos huérfanos purgados tras retención configurable. | Políticas implementadas en IaC/jobs. | Revisión. | 9 | Should |
| NFR-COMP-006 | **Residencia de datos**: región cloud elegida explícitamente por el owner y documentada (preferir región con menor latencia a Bolivia y costo aceptable, p.ej. `sa-east-1` o `us-east-1`). | Documentado en ADR-0013. | Revisión. | 9 | Should |
| NFR-COMP-007 | **Términos de proveedores de datos** (FX, exchanges): uso conforme a ToS; sin scraping prohibido. | Cada adapter documenta fuente y ToS. | Revisión por adapter. | 5 | Must |
| NFR-COMP-008 | **Credenciales bancarias**: el sistema nunca almacena usuario/contraseña de banca; solo tokens delegados cifrados cuando existan APIs. | 0 campos de credenciales bancarias en el modelo. | Revisión de schema. | 6 | Must |

## 12. Matriz NFR ↔ riesgos

| Riesgo ([26-risk-register.md](./26-risk-register.md)) | NFR que lo mitigan |
|------|-----|
| RISK-001 Redondeo/precisión | NFR-DATA-001, 002, 003, 010 |
| RISK-002 Ledger desbalanceado | NFR-DATA-004, 005, 007, 008 |
| RISK-003 Corrupción de FX histórico | NFR-DATA-006 |
| RISK-009 Pérdida de datos | NFR-REL-001..005, 014 |
| RISK-010 Privacidad | NFR-SEC-*, NFR-COMP-001 |
| RISK-018 Suite de tests lenta | NFR-MAINT-007 |
| RISK-019 Fricción Windows | NFR-PORT-001, 002, 004, 010 |

## Preguntas abiertas

1. ¿Se acepta RPO 15 min / RTO 4 h para producción o el owner prefiere un perfil más barato (RPO 24 h con snapshots diarios) dado el uso single-user? Impacta costo (RISK-007).
2. ¿Disponibilidad 99.5 % es necesaria, o basta "best effort" con datos protegidos (el owner puede esperar horas)?
3. ¿Crear categoría `ACC` separada para accesibilidad (requiere enmienda de ARCHITECTURE §12) o mantenerla en `USAB-1NN`?
4. ¿Locale `es-BO` con coma decimal es el deseado? Muchos usuarios bolivianos usan punto decimal en contextos digitales.
5. Umbrales de mutation testing: ¿80 % es realista para un desarrollador solo? Alternativa: 70 % inicial, 80 % al llegar a Phase 4.
6. ¿Es necesaria la validación periódica en Windows nativo (sin WSL2) o WSL2 es el único entorno soportado en Windows?
