# ADR-0002: Estilo arquitectónico — Modular Monolith + DDD + Hexagonal + Clean Architecture

- Estado: Aceptado (2026-10-02, tras SPIKE-04; decisión del owner)
- Fecha: 2026-10-01
- Decisores: Owner (Product/Tech Lead)
- Relacionado: docs/ARCHITECTURE.md §2, §3, §6, §7; docs/05-bounded-contexts.md; docs/06-context-map.md; docs/07-c4-architecture.md; ADR-0003, ADR-0008, ADR-0017, ADR-0018; SPIKE-04

## Contexto y problema

PFOS tiene un dominio rico (18 bounded contexts, ARCHITECTURE §3) con un núcleo de **integridad financiera fuerte**: una transacción registrada debe producir un `JournalEntry` balanceado por moneda, un `AuditLog` y respetar periodos cerrados, **todo en la misma transacción de base de datos**. Al mismo tiempo, el sistema debe:

- ser operado y desarrollado por **una persona**, con presupuesto cloud reducido;
- poder crecer a multi-usuario y, eventualmente, extraer partes (p. ej. Forecasting, Imports) si lo justifican carga o equipo;
- servir como plataforma de aprendizaje de arquitectura "de nivel enterprise" sin pagar el impuesto operativo de un sistema distribuido.

Hay que elegir el estilo de arquitectura macro (cómo se despliega y cómo se separan responsabilidades) y el estilo interno de cada módulo.

## Drivers de decisión

- **Consistencia transaccional** del ledger (ACID entre Transactions, Ledger y Audit).
- **Complejidad** total (desarrollo + operación) asumible por 1 persona.
- **Costo operativo** cloud mínimo (pocos contenedores, una base de datos).
- **Mantenibilidad** a largo plazo y **bajo acoplamiento** entre contextos.
- **Testabilidad** del dominio sin infraestructura (dominio puro).
- **Observabilidad** simple (un trace atraviesa un proceso).
- **Despliegue** simple (una imagen backend).
- **Evolución futura**: posibilidad real de extraer un contexto a servicio sin reescribir el dominio.

## Opciones consideradas

1. **Microservicios** (un servicio por bounded context o por grupo).
2. **Modular Monolith** con DDD + Hexagonal + Clean Architecture y eventos internos vía Transactional Outbox.
3. **Monolito en capas clásico** (controllers → services → repositories globales, sin fronteras de módulo).

## Decisión

Se adopta **Modular Monolith + DDD + Hexagonal (Ports & Adapters) + Clean Architecture**, con eventos de dominio internos vía **Transactional Outbox** (ADR-0008):

- Un único deployable backend `finance-api`, con **dos procesos** desde la misma imagen: `api` (HTTP) y `worker` (jobs/eventos). *Build once, run with different command.*
- Cada bounded context es un paquete pnpm (`packages/contexts/<ctx>`, `@pf/<ctx>`) con capas `domain → application → infrastructure / interface` y una API pública `contracts` (commands, queries, DTOs, eventos).
- **Regla de capas** (verificada con dependency-cruiser): `domain` solo depende de `@pf/shared-kernel` (sin Nest, sin Kysely, sin I/O de Node); `application` depende de `domain`, de sus puertos y de `contracts` de otros contextos; `infrastructure` implementa puertos; `interface` contiene controllers Nest. Otro contexto solo se consume vía `@pf/<ctx>/contracts`.
- **NestJS** se usa solo como composition root y capa `interface` (DI, HTTP, lifecycle), **nunca en `domain`**.
- Cada contexto posee su **schema PostgreSQL**; referencias entre contextos solo por ID, sin FKs cross-schema (salvo `workspace_id` → `iam.workspace` y `currency`).
- Integración **síncrona en la misma transacción** solo donde una invariante lo exige (`Transactions → Ledger`, `Debt/Goals/Commitments → Transactions`); el resto, **asíncrono vía outbox**.
- Forecasting/ML vive fuera (servicio Python, ADR-0017), nunca en el camino crítico.
- **Microservicios rechazados por ahora**; criterios de extracción en ADR-0003.

## Análisis de opciones

Evaluación (1 = peor, 5 = mejor, para el contexto de PFOS):

| Criterio | Microservicios | Modular Monolith | Monolito en capas |
|---|---|---|---|
| Complejidad (dev + ops) | 1 | 4 | 5 (al inicio) → 2 (a los 2 años) |
| Escalabilidad | 5 | 4 (horizontal por réplicas api/worker) | 3 |
| Mantenibilidad | 3 (si hay equipos) | 5 | 2 |
| Costo operativo | 1 | 5 | 5 |
| Acoplamiento | 5 (físico) | 4 (lógico, verificado) | 1 |
| Observabilidad | 2 (tracing distribuido obligatorio) | 4 | 4 |
| Testabilidad | 3 (contract tests, entornos) | 5 | 3 |
| Despliegue | 2 (N pipelines, versionado de APIs) | 5 | 5 |
| Evolución futura | 4 | 4 (extracción planificada) | 1 (big-bang rewrite) |

### 1. Microservicios
- **Pros:** escalado y despliegue independientes; aislamiento de fallos; fronteras físicas imposibles de violar; tecnologías heterogéneas.
- **Contras:** el ledger requiere consistencia entre Transactions, Ledger y Audit → sagas/compensaciones para algo que hoy es un `COMMIT`; tracing distribuido, service discovery, versionado de contratos y N pipelines para 1 persona; latencia de red; debugging difícil; datos de reporting dispersos (necesitaría CDC o réplicas).
- **Costo:** alto: N contenedores siempre encendidos (en Fargate cada tarea tiene costo mínimo), posiblemente un broker gestionado, N bases o schemas con pools separados. Estimación orientativa: 3–6× el costo del monolito en staging+prod.
- **Complejidad operativa:** muy alta (service mesh o al menos gateway, observabilidad distribuida, gestión de versiones entre servicios).

### 2. Modular Monolith + DDD + Hexagonal (elegida)
- **Pros:** transacciones ACID locales para invariantes financieras; un despliegue, un pipeline; fronteras lógicas fuertes verificadas por architecture tests; dominio puro testeable sin infraestructura; schema por contexto + comunicación por contratos/eventos → extracción viable; observabilidad simple; costo mínimo.
- **Contras:** las fronteras dependen de disciplina + tooling (dependency-cruiser), no de la red; escalado no independiente por contexto; un fallo grave (memory leak) afecta a todo el proceso; más ceremonia que un CRUD (puertos, mappers, contracts).
- **Costo:** bajo: 2 procesos (api, worker) + PostgreSQL + Redis/Valkey.
- **Complejidad operativa:** baja-media (outbox y worker son la única pieza "distribuida").

### 3. Monolito en capas clásico
- **Pros:** el más rápido de arrancar; patrón conocido con NestJS por defecto (módulos con services/repositories).
- **Contras:** sin fronteras de contexto, los services se llaman entre sí libremente y comparten tablas → "big ball of mud"; lógica financiera dispersa en services anémicos; imposible extraer un contexto sin reescritura; tests acoplados a la BD.
- **Costo:** bajo. **Complejidad operativa:** baja; **complejidad de evolución:** muy alta.

## Consecuencias

**Positivas**
- Invariantes del ledger garantizadas con transacciones locales y constraints de BD.
- Un solo artefacto backend, mínimo costo y superficie operativa.
- Dominio independiente de frameworks: si NestJS o Kysely cambian, el dominio no se toca.
- Camino de extracción documentado (ADR-0003).

**Negativas**
- Mayor ceremonia por caso de uso (puerto + adapter + mapper + DTO).
- Curva de aprendizaje DDD/Hexagonal para contribuyentes futuros.
- Hay que construir tooling de verificación de fronteras (dependency-cruiser, tests de arquitectura).

**Riesgos**
- Erosión de fronteras ("solo esta vez importo el repositorio de otro contexto"). *Mitigación:* dependency-cruiser en CI como gate bloqueante; `contracts` como único export público del paquete (campo `exports` de package.json).
- Over-engineering para contextos simples (Notifications, Audit). *Mitigación:* los contextos *Generic* pueden usar una variante simplificada (sin agregados ricos), manteniendo la regla de capas.
- Contención en un único proceso worker. *Mitigación:* colas BullMQ separadas por contexto y concurrencia configurable; réplicas de worker.

## Validación

- **SPIKE-04** (1.5 d): dos contextos (Accounts, Ledger) como paquetes, composición en NestJS sin que `@nestjs/*` aparezca en `domain`, reglas de dependency-cruiser fallando ante violaciones intencionales.
- **Architecture tests** en CI (TS-xxx en backlog): (a) `domain` no importa nada fuera de `shared-kernel`; (b) ningún contexto importa internals de otro; (c) no hay FKs cross-schema salvo las permitidas (test sobre `information_schema`).
- **Métrica**: p95 de `POST /transactions` < 200 ms con PG local (ver NFR-PERF); cero violaciones de dependency-cruiser en `main`.

## Notas

- Verificado 2026-10-01: NestJS v12 (roadmap publicado abril 2026) migra a ESM completo y Vitest por defecto; no cambia la decisión, pero refuerza que el dominio debe quedar fuera de Nest para no acoplarse a migraciones mayores del framework.
- "Hexagonal" y "Clean Architecture" se usan aquí de forma pragmática: puertos/adapters en la frontera, dependencia hacia el dominio; no se exige una capa separada de "entities" vs "use cases" más allá de `domain`/`application`.

## Resultado del spike (SPIKE-04, 2026-10-01)

Evidencia: [`spikes/SPIKE-04-modular-monolith/README.md`](../../spikes/SPIKE-04-modular-monolith/README.md). Versiones verificadas: NestJS 12.1.2 (ESM), TypeScript 7.0.2, Vitest 5.0.3, Turborepo 2.11.6, pnpm 12.4.2, dependency-cruiser 18.5.0.

- **Validado:** `@pf/accounts` y `@pf/ledger` como paquetes con `domain/application/infrastructure/interface/contracts`. Dominio **y** application services son TS plano (sin `@Injectable`); Nest solo aparece en `interface/<ctx>.module.ts` (wiring `useFactory` + tokens `Symbol.for` definidos en `contracts`/`platform`) y en `apps/api`.
- **Transacción compartida:** apertura de cuenta + asiento de saldo inicial en un único COMMIT vía `UnitOfWork` (`@pf/platform`, fake en memoria con `AsyncLocalStorage`, llamadas anidadas se unen). Si Ledger rechaza el asiento, la cuenta no se persiste (rollback probado en unit y e2e; API responde 422).
- **Tests:** dominio sin Nest/SWC (ms); e2e Nest + supertest con SWC. Hallazgo: Vite 8/Oxc ya emite decorator metadata si el tsconfig tiene `emitDecoratorMetadata`; con `@Inject(TOKEN)` explícito el wiring no depende de metadata.
- **Build:** tsc 7 por paquete orquestado por Turbo: frío ≈ 2.5 s, caliente ≈ 25 ms (FULL TURBO); typecheck TS 7 ≈ 8× más rápido que TS 6.
- **Riesgos nuevos:** dependency-cruiser y typescript-eslint aún no soportan TS 7 (TS 6 en la raíz para tooling); `@swc/core` 1.16 no carga en Windows con ACL heredadas (fijar 1.15.47); caché de Turbo obsoleta en `test` si no se usa el patrón `transit`.
- **Recomendación:** aceptar la decisión sin cambios. Ajustes de tooling a ADR-0018.
