# 00 — Visión de producto

> **Estado:** Propuesto · **Fecha:** 2026-10-01 · **Owner:** Product Owner (owner del producto)
> **Relacionado:** [ARCHITECTURE.md](./ARCHITECTURE.md) · [01-functional-requirements.md](./01-functional-requirements.md) · [02-non-functional-requirements.md](./02-non-functional-requirements.md) · [03-openspec-strategy.md](./03-openspec-strategy.md) · [24-roadmap.md](./24-roadmap.md) · [25-product-backlog.md](./25-product-backlog.md) · [26-risk-register.md](./26-risk-register.md) · [28-ui-ux-design-system.md](./28-ui-ux-design-system.md)

---

## 1. Resumen ejecutivo

**Personal Finance Operating System (PFOS)** es un sistema integral de finanzas personales, multi-moneda (fiat + cripto), que permite registrar, planificar, controlar y entender el dinero de una persona —y más adelante de un hogar— con **integridad contable de nivel profesional** (ledger de doble entrada interno, invisible para el usuario) y una experiencia simple orientada a responder preguntas concretas.

El producto nace para un **usuario inicial en Bolivia** (moneda base BOB, uso cotidiano de USD y conversiones P2P con USDT), pero está diseñado desde el modelo de datos como **multi-usuario / multi-workspace** (ver [ARCHITECTURE §1](./ARCHITECTURE.md#1-naturaleza-del-producto)).

PFOS es **completamente útil sin IA, sin ML y sin integraciones bancarias**. La inteligencia (forecasting estadístico, asistente IA de solo lectura) se incorpora **tarde**, cuando el núcleo financiero es maduro, auditable y está probado.

> **Declaración de visión:** *"Saber en todo momento cuánto dinero tengo, en qué monedas, cuánto ya está comprometido, cuánto puedo gastar y si voy a cumplir mis metas — con números en los que puedo confiar al centavo."*

## 2. Problema

| # | Problema | Manifestación hoy (usuario inicial) |
|---|----------|-------------------------------------|
| P1 | **Dinero fragmentado** en bancos, efectivo, billeteras digitales, exchanges y wallets cripto. | No hay una vista única de patrimonio ni de liquidez real. |
| P2 | **Multi-moneda real y volátil**: BOB, USD, USDT con conversiones P2P cuyo tipo de cambio efectivo difiere del oficial. | Las hojas de cálculo pierden el costo real de cada conversión (spread, fees) y mezclan tasas históricas con actuales. |
| P3 | **Compromisos invisibles**: suscripciones, cuotas de préstamos, tarjetas, pagos recurrentes. | Se descubre el gasto comprometido cuando ya ocurrió; no se sabe cuánto queda "libre" en el mes. |
| P4 | **Planificación sin cierre**: presupuestos que no se comparan contra lo real ni se cierran mensualmente. | No existe un histórico confiable mes a mes; las comparaciones MoM/YoY son manuales. |
| P5 | **Desconfianza en los números**: errores de redondeo, ediciones sin rastro, saldos que no cuadran. | Se abandona la herramienta porque "no cuadra con el banco". |
| P6 | **Ausencia de integraciones bancarias locales**: en Bolivia la mayoría de bancos solo ofrece extractos PDF/CSV o nada. | La captura es manual; las herramientas extranjeras asumen open banking. |
| P7 | **Herramientas existentes** (apps comerciales) no manejan bien cripto + fiat + P2P, no son portables y retienen los datos. | Lock-in, privacidad dudosa, imposibilidad de exportar el histórico completo. |

## 3. Usuarios objetivo y personas

### 3.1 Persona primaria — "El Owner" (Phase 1+)

- **Perfil:** profesional técnico en Bolivia, ingresos en BOB y/o USD, ahorro en USD y USDT, usa bancos locales, billeteras digitales (QR), efectivo, tarjetas de crédito y exchanges P2P.
- **Objetivos:** visibilidad total de patrimonio y liquidez; controlar gasto mensual; anticipar pagos; medir el costo real de convertir monedas; ahorrar hacia metas concretas; salir de deudas.
- **Frustraciones:** hojas de cálculo frágiles; apps que no entienden USDT ni BOB; no poder confiar en un saldo calculado.
- **Contexto técnico:** usa Windows como entorno principal; valora poder correr todo localmente y respaldarlo.
- **Rol en el sistema:** `OWNER` del workspace personal.

### 3.2 Persona secundaria futura — "Hogar / workspace compartido" (track de Colaboración, post Phase 11)

- **Perfil:** pareja o familia que comparte cuentas y presupuesto del hogar, manteniendo finanzas personales separadas.
- **Necesidades:** workspace compartido con roles (`OWNER`, `EDITOR`), visibilidad de cuentas compartidas, presupuestos conjuntos, atribución de quién registró qué (audit).
- **Implicación de diseño hoy:** `workspace_id` en toda tabla de negocio, RBAC por workspace y RLS desde Phase 1 (ver [ADR-0023](./adr/0023-multi-tenancy-and-row-level-security.md)).

### 3.3 Persona terciaria futura — "Asesor / Viewer" (track de Colaboración, post Phase 11)

- **Perfil:** asesor financiero, contador o familiar de confianza con acceso de **solo lectura**.
- **Necesidades:** ver reportes, net worth, cumplimiento de metas; nunca modificar datos; acceso revocable y auditado.
- **Implicación de diseño hoy:** rol `VIEWER` definido desde el modelo de autorización ([ADR-0010](./adr/0010-authentication-and-authorization.md)).

### 3.4 Anti-persona

- Empresas que buscan contabilidad formal (facturación, impuestos corporativos, nómina). PFOS **no** es un ERP ni un software contable fiscal.

## 4. Propuesta de valor

| Para… | que… | PFOS es… | que… | a diferencia de… |
|-------|------|----------|------|------------------|
| personas con finanzas multi-moneda (fiat + cripto) en mercados sin open banking | necesitan control real y confiable de su dinero | un sistema operativo financiero personal, local-first-friendly y portable | garantiza integridad contable (doble entrada), registra el costo real de cada conversión, planifica y cierra cada mes, y proyecta pagos y metas de forma explicable | hojas de cálculo (frágiles, sin integridad) y apps comerciales (lock-in, sin cripto/P2P, sin cierre mensual, dependientes de integraciones bancarias) |

**Pilares de valor:**
1. **Confianza**: cada saldo es la suma de postings inmutables; todo cambio es auditable; jamás se usa aritmética de punto flotante.
2. **Claridad**: el dashboard responde 9 preguntas concretas (§6) sin jerga contable.
3. **Control**: plan mensual, presupuestos, compromisos y cierres de mes.
4. **Previsión**: calendario de flujo de caja y, más adelante, forecasting explicable.
5. **Propiedad de los datos**: exportación completa, despliegue local o cloud, sin lock-in.

## 5. Principios de producto

Los principios son **criterios de decisión**: ante un conflicto de prioridades, gana el principio de rango superior.

| # | Principio | Significado operativo |
|---|-----------|-----------------------|
| PP-01 | **Specification before implementation** | Ningún comportamiento se implementa sin spec OpenSpec aprobada (Requirement + Scenarios) y test cases trazables ([03-openspec-strategy.md](./03-openspec-strategy.md), [ADR-0024](./adr/0024-spec-driven-development-with-openspec.md)). |
| PP-02 | **Financial integrity over speed** | Ninguna optimización, atajo o feature justifica romper invariantes del ledger (Σ por moneda = 0, inmutabilidad, audit síncrono). |
| PP-03 | **Correctness over cleverness** | Soluciones simples y verificables antes que ingeniosas. Property-based testing en dominio financiero. |
| PP-04 | **Usable sin IA, sin ML, sin bancos** | Toda capacidad central funciona con captura manual e imports de archivos. IA/ML/integraciones son aditivos. |
| PP-05 | **AI only after maturity** | El asistente IA no se inicia hasta pasar el *AI Feature Gate* ([24-roadmap.md §4](./24-roadmap.md)). Siempre de solo lectura en su primera versión. |
| PP-06 | **Explainable forecasting** | Toda predicción muestra intervalo de confianza, baseline, versión de modelo y fecha; separa costos futuros conocidos de costos variables predichos. Nunca se afirma "gastarás exactamente X". |
| PP-07 | **Historical immutability** | El pasado no se recalcula: tasas de conversión, snapshots de cierre y postings históricos son inmutables; las correcciones son explícitas (reversa + nueva entrada). |
| PP-08 | **Portability & data ownership** | Contenedores, configuración 12-factor, export completo (JSON/CSV), sin dependencias propietarias obligatorias en el core. Corre en Windows, Linux y macOS. |
| PP-09 | **Nada hardcodeado del dominio del usuario** | Instituciones, categorías, monedas, cuentas y tasas son datos configurables, nunca constantes de código. |
| PP-10 | **Privacy by default** | Datos financieros cifrados en tránsito y en reposo, mínimo privilegio, sin telemetría de contenido financiero, sin envío a terceros sin consentimiento explícito. |
| PP-11 | **Single-user first, multi-user ready** | Optimizar la UX para un usuario, sin bloquear el modelo multi-workspace. Evitar sobre-ingeniería operacional (no microservicios, no Kubernetes). |
| PP-12 | **Incremental value** | Cada fase entrega algo usable a diario por el owner (vertical slices end-to-end). |
| PP-13 | **Transparencia contable sin jerga** | El ledger es invisible; el usuario ve cuentas, transacciones y categorías. La UI nunca exige entender débitos y créditos. |

## 6. Las 9 preguntas del Home (contrato del dashboard)

El dashboard (capability `reporting/dashboard`, a especificar en Phase 1) existe para responder estas preguntas en **menos de 5 segundos de lectura**. Cada pregunta tiene una definición operativa precisa (las fórmulas finales se especifican en OpenSpec y en [14-reporting.md](./14-reporting.md)).

| # | Pregunta | Definición operativa (borrador) | Fuente | Disponible desde |
|---|----------|----------------------------------|--------|------------------|
| Q1 | **¿Cuánto dinero tengo?** | Σ saldos de cuentas ASSET líquidas (banco, efectivo, wallet, cripto) convertidos a moneda base con la tasa de referencia vigente; desglose por moneda original. Net worth = activos − pasivos en vista separada. | Ledger balances + FX | Phase 1 (tasa manual) |
| Q2 | **¿Cuánto ingresó?** | Σ splits de tipo ingreso con fecha en el periodo actual (excluye transfers, conversiones y refunds). | Transactions/Reporting | Phase 1 |
| Q3 | **¿Cuánto gasté?** | Σ splits de gasto del periodo, netos de refunds; excluye transfers y principal de deudas. Incluye fees de conversión. | Transactions/Reporting | Phase 1 |
| Q4 | **¿Cuánto está comprometido?** | Σ de ocurrencias recurrentes pendientes del periodo (suscripciones, cuotas, pagos fijos) + transacciones `pending`. | Commitments + Transactions | Phase 3 (parcial en Phase 1 con `pending`) |
| Q5 | **¿Cuánto puedo gastar?** | Disponible líquido − comprometido restante del periodo − aportes planificados a metas − reserva mínima configurada; alternativamente, presupuesto restante por categoría. | Planning + Commitments + Goals | Phase 2 (presupuesto) / Phase 4 (completo) |
| Q6 | **¿Cuánto ahorré?** | Ingresos − gastos del periodo (tasa de ahorro %) y aportes efectivos a metas. | Reporting + Goals | Phase 1 (neto) / Phase 4 (metas) |
| Q7 | **¿Cómo estoy respecto al mes pasado?** | Variación MoM de Q2, Q3, Q6 y top categorías, en valor y %. | Reporting | Phase 1 (básico) / Phase 7 (completo) |
| Q8 | **¿Qué pagos vienen?** | Próximos N días de ocurrencias recurrentes, cuotas de préstamo, vencimientos de tarjeta, con saldo esperado. | Commitments + Debt + Reporting (cash-flow calendar) | Phase 3 / Phase 7 |
| Q9 | **¿Voy a cumplir mis metas?** | Por meta: % completado, aporte mensual requerido, fecha esperada, estado `behind/on-track/ahead`. | Goals | Phase 4 |

Regla de UX: si una pregunta todavía no puede responderse (fase no implementada o datos insuficientes), el widget lo **dice explícitamente** y sugiere la acción para habilitarlo; nunca muestra un número inventado.

## 7. Alcance por fase (vista rápida)

Detalle completo en [24-roadmap.md](./24-roadmap.md).

| Fase | Nombre | Resultado visible para el owner |
|------|--------|---------------------------------|
| 0 | Discovery, Design Gate & Implementation Gate | Documentación, ADRs, specs OpenSpec, catálogo de test cases, spikes; esqueleto de repo, stack local y CI. |
| 1 | Core financiero (MVP) | Login, workspace, cuentas multi-moneda, ledger, transacciones (ingreso, gasto, transferencia, conversión manual USDT↔BOB↔USD, refund, ajuste), categorías/tags, audit base, dashboard básico (Q1, Q2, Q3, Q6, Q7 básico). |
| 2 | Planificación y presupuestos | Periodos mensuales, plan mensual, templates versionados, presupuestos con umbrales, cierre de mes, notificaciones base. |
| 3 | Compromisos recurrentes | Motor de recurrencia, suscripciones con historial de precios; (Could) import CSV básico. Q4, Q8 parcial. |
| 4 | Metas y deudas | Savings goals, préstamos con amortización, tarjetas de crédito. Q5 completo, Q9. |
| 5 | FX y cripto avanzado | MarketRateProviders automáticos, tasas históricas, análisis de spread/costo de conversión. |
| 6 | Documentos, imports y reglas | Adjuntos seguros, pipeline de import completo (CSV/OFX/QIF/JSON), BankingProvider port, rules engine. |
| 7 | Reportes avanzados | 16 reportes, drill-down, MoM/YoY/custom, cash-flow calendar 7/30/60/90. |
| 8 | Forecasting | Servicio ML separado, forecasts explicables 1/3/6/12 meses. |
| 9 | Producción y hardening | Despliegue cloud, backups/DR, seguridad endurecida, suite de testing completa (prerrequisitos del AI gate). |
| 10 | Asistente IA (solo lectura) | Preguntas en lenguaje natural sobre datos propios, vía tools autorizadas. |
| 11 | Colaboración e integraciones | Workspaces compartidos, rol asesor/viewer, providers bancarios/agregadores cuando existan. |

## 8. Non-goals explícitos

PFOS **no** hará (al menos en el horizonte de este roadmap):

1. **No** es software contable/fiscal para empresas (facturación, IVA/IT, libros contables legales, nómina).
2. **No** ejecuta pagos, transferencias ni operaciones de trading reales; **registra** lo que el usuario hizo. Nunca mueve dinero.
3. **No** ofrece asesoría de inversión personalizada ni recomendaciones de compra/venta de activos.
4. **No** depende de integraciones bancarias para ser útil; no hará scraping de banca en línea con credenciales del usuario.
5. **No** almacena credenciales bancarias del usuario.
6. **No** es un exchange ni un custodio de cripto; no maneja llaves privadas.
7. **No** valora en tiempo real portafolios de trading de alta frecuencia; la valoración de inversiones es periódica y aproximada.
8. **No** usa microservicios ni Kubernetes en el horizonte actual ([ADR-0003](./adr/0003-module-boundaries-and-extraction-criteria.md), [ADR-0013](./adr/0013-cloud-deployment-strategy.md)).
9. **No** tiene app móvil nativa (la web es responsive; PWA puede evaluarse más adelante).
10. **No** permite que la IA modifique datos financieros en su primera versión; la IA nunca accede directamente a la base de datos.
11. **No** promete predicciones exactas; el forecasting es probabilístico y explicable.
12. **No** es un producto SaaS multi-tenant comercial en este horizonte (aunque el modelo lo permite).

## 9. Métricas de éxito

### 9.1 Métricas de producto (owner)

| ID | Métrica | Objetivo | Medición |
|----|---------|----------|----------|
| SM-01 | Adopción diaria | El owner registra ≥ 90 % de sus movimientos en PFOS durante 3 meses consecutivos tras Phase 1 | Conteo de transacciones vs extractos bancarios en reconciliación |
| SM-02 | Exactitud de saldos | 100 % de cuentas reconciliadas con diferencia 0.00 al cierre de mes (o diferencia explicada por ajuste auditado) | Reporte de reconciliación |
| SM-03 | Tiempo de captura | Registrar una transacción manual ≤ 15 s (p50); una conversión USDT→BOB ≤ 30 s | Telemetría de UX (sin contenido financiero) |
| SM-04 | Cierre mensual | Cerrar un mes ≤ 10 min incluyendo reconciliación | Timestamps de flujo de cierre |
| SM-05 | Respuesta a las 9 preguntas | Las 9 preguntas visibles en el Home al terminar Phase 7 | Checklist de aceptación del dashboard |
| SM-06 | Visibilidad de costo FX | 100 % de conversiones con tasa efectiva y fees registrados | Reporte de conversiones |
| SM-07 | Pagos sorpresa | 0 pagos recurrentes conocidos no anticipados por mes (Phase 3+) | Comparar ocurrencias vs transacciones no planificadas |
| SM-08 | Metas | ≥ 1 meta de ahorro con estado `on-track` o `ahead` sostenido 3 meses (Phase 4+) | Goals report |

### 9.2 Métricas de calidad e integridad

| ID | Métrica | Objetivo |
|----|---------|----------|
| SM-09 | Incidentes de integridad del ledger (entry desbalanceada, posting mutado) | **0** en todo momento (verificado por job de invariantes) |
| SM-10 | Trazabilidad | 100 % de Requirements OpenSpec de fases liberadas con ≥ 1 test case automatizado |
| SM-11 | Cobertura de dominio | Ver [NFR-MAINT-002](./02-non-functional-requirements.md) |
| SM-12 | Restauración probada | Restore de backup verificado al menos mensualmente (RPO/RTO según [NFR-REL](./02-non-functional-requirements.md)) |
| SM-13 | Lead time de cambio | Cambio pequeño spec→producción ≤ 2 días hábiles (desde Hito H) |

### 9.3 Métricas de costo

| ID | Métrica | Objetivo |
|----|---------|----------|
| SM-14 | Costo cloud mensual (staging + prod) | Dentro del presupuesto definido por el owner tras SPIKE-09. Referencia preliminar: Cloud Run ~60–110 USD/mes, ECS/Fargate ~120–195 USD/mes para staging+prod; local-only ≈ 0 (ver [RISK-007](./26-risk-register.md), [21-cloud-deployment-options.md](./21-cloud-deployment-options.md)) |

## 10. Supuestos

- El owner es a la vez Product Owner, arquitecto y único desarrollador durante las fases iniciales (capacidad limitada → ver [RISK-004](./26-risk-register.md)).
- Moneda base BOB, zona horaria `America/La_Paz`, idioma `es-BO` (pendiente de confirmación).
- Las tasas P2P USDT/BOB se registran manualmente en Phase 1; providers automáticos en Phase 5 dependen de disponibilidad de fuentes públicas.
- Los bancos bolivianos ofrecen como máximo extractos CSV/XLS/PDF; no se asume open banking.

## Preguntas abiertas

1. ¿Se confirma BOB como moneda base del workspace inicial y `America/La_Paz` como zona horaria? ¿El locale de formato es `es-BO` (separador decimal coma) o se prefiere punto decimal?
2. ¿Cuál es el presupuesto mensual máximo aceptable para cloud (SM-14)? ¿Se acepta operar Phase 1–8 solo en local con backups, desplegando a cloud recién en Phase 9?
3. ¿Q5 "¿Cuánto puedo gastar?" debe basarse en presupuesto restante, en liquidez libre de compromisos, o mostrar ambas vistas?
4. ¿Inversiones (acciones, fondos) son relevantes para el owner en el corto plazo o basta con cuentas `investment` con valoración manual?
5. ¿El rol "asesor/viewer" debe soportar acceso a un subconjunto de cuentas (scoping fino) o es suficiente acceso de lectura a todo el workspace?
6. ¿Es deseable una PWA instalable para captura rápida desde el teléfono antes del track de Colaboración?
7. ¿Qué nivel de detalle de telemetría de UX (SM-03) acepta el owner, dado el principio PP-10?
