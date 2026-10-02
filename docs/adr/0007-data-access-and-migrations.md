# ADR-0007: Acceso a datos y migraciones — Kysely + migraciones SQL-first (dbmate)

- Estado: Aceptado (2026-10-02, tras SPIKE-02; decisión del owner)
- Fecha: 2026-10-01
- Decisores: Owner (Product/Tech Lead)
- Relacionado: docs/ARCHITECTURE.md §5, §6, §9; ADR-0002, ADR-0003, ADR-0004, ADR-0005, ADR-0006, ADR-0008, ADR-0023; SPIKE-02

## Contexto y problema

Los adapters de persistencia de cada contexto deben:

1. Ejecutar todas las operaciones de un comando dentro de **una transacción** que empieza con `SET LOCAL app.workspace_id = …` (RLS, ADR-0023) y compartirla entre contextos (Unit of Work: Transactions + Ledger + Audit + Outbox).
2. Leer/escribir `NUMERIC(38,18)` **sin pasar por `number`** (ADR-0006).
3. Convivir con objetos de BD avanzados: constraint triggers diferidos, políticas RLS, roles, schemas por contexto, índices parciales, `SKIP LOCKED`.
4. Mapear filas a **agregados de dominio puros** (el dominio no conoce el ORM).
5. Ofrecer type-safety en TypeScript y buena DX.
6. Gestionar migraciones versionadas, revisables, con patrón expand → migrate → contract y aprobación manual de destructivas.

Hay que elegir la herramienta de acceso a datos y la herramienta de migraciones.

## Drivers de decisión

- Control total del SQL emitido y de la transacción (RLS, locks, triggers).
- Type-safety sin generar un modelo que compita con el dominio.
- Precisión decimal sin pérdida.
- Migraciones SQL revisables, con soporte natural para RLS/triggers/roles.
- Madurez y salud del proyecto (Oct 2026).
- Bajo acoplamiento: el dominio no depende del ORM.

## Opciones consideradas

1. **Prisma ORM 7** (Rust-free query compiler + driver adapters) + Prisma Migrate.
2. **Drizzle ORM** (1.0 RC) + drizzle-kit.
3. **Kysely** (query builder) + migraciones SQL-first con **dbmate** (elegida).
4. **MikroORM** (Data Mapper + Unit of Work + Identity Map).
5. **TypeORM**.
6. SQL crudo con `pg` + tipos generados (pgTyped / `kysely-codegen` sin builder).

## Decisión

Se propone **Kysely** como capa de acceso a datos en los adapters `infrastructure` y **migraciones SQL-first con dbmate** en `db/migrations/` (organizadas por schema/contexto), **sujeto a confirmación en SPIKE-02**. Prisma se evaluó y **no se elige como primario**.

Detalles:
- Tipos de tablas generados desde la BD migrada (`kysely-codegen`) → la BD es la fuente de verdad del esquema; los tipos generados son internos a `infrastructure` y nunca salen de ella.
- `@pf/platform` provee `UnitOfWork`: abre transacción en `pg` Pool, ejecuta `SET LOCAL app.workspace_id`, `app.user_id` (y `app.correlation_id` opcional), expone un `Transaction<DB>` de Kysely a los repositorios de los contextos participantes y escribe outbox + audit antes del `COMMIT`.
- Type parser de `pg` para `NUMERIC` (OID 1700) devuelve string; los mappers lo convierten a `Decimal`.
- Repositorios por agregado con mapping explícito fila ↔ agregado (sin "entities" del ORM).
- Migraciones: archivos `.sql` con bloques `-- migrate:up` / `-- migrate:down`, ejecutadas por el rol `pf_migrator`; el job `migrate` del Compose y del pipeline las aplica. Las destructivas (contract) llevan marcador en nombre/encabezado y requieren aprobación manual en el pipeline (ADR-0015).

## Análisis de opciones

### 1. Prisma ORM 7
- **Pros:** DX excelente (schema declarativo, client generado, Studio); desde v7 el cliente es Rust-free (query compiler en TS/WASM + driver adapters, p. ej. `@prisma/adapter-pg`), imágenes más pequeñas y sin binarios por plataforma; TypedSQL para queries crudas tipadas; gran comunidad; `Decimal` basado en decimal.js.
- **Contras:** RLS requiere envolver cada operación en transacción interactiva vía Client Extension con `set_config(..., true)` — patrón documentado pero con historial de issues de bloqueo/rendimiento en transacciones interactivas; compartir una transacción entre repositorios de varios contextos obliga a propagar el `tx` client; el modelo Prisma (schema.prisma) se convierte en un segundo modelo de datos que tiende a filtrarse al dominio; Prisma Migrate no expresa constraint triggers, políticas RLS ni roles → migraciones SQL manuales igualmente (`--create-only`), perdiendo la ventaja; cambio de arquitectura grande reciente (v6→v7) = superficie de bugs.
- **Costo:** gratis (ORM); Prisma Postgres/Accelerate son opcionales y no necesarios.
- **Complejidad operativa:** media (generate en build, migraciones híbridas).

### 2. Drizzle ORM
- **Pros:** schema en TS, SQL-like, ligero, sin codegen en runtime; buen soporte de PG (incluido `pgPolicy`/RLS declarativo en drizzle-kit); transacciones explícitas sencillas; equipo ahora financiado (se unió a PlanetScale en 2026).
- **Contras:** **1.0 aún en release candidate** (rc.1 abril 2026; breaking changes entre RCs); el schema TS es otro modelo paralelo; `numeric` mapea a string (ok) pero el ecosistema de migraciones (drizzle-kit) con triggers diferidos y roles sigue requiriendo SQL custom; riesgo de churn de API a corto plazo.
- **Costo:** gratis. **Complejidad operativa:** media-baja.

### 3. Kysely + dbmate (elegida, a confirmar)
- **Pros:** query builder type-safe que emite exactamente el SQL que se escribe; control total de transacciones (`db.transaction().execute(trx => …)`, `sql\`SET LOCAL …\``); sin modelo propio que compita con el dominio; tipos generados desde la BD real; plugins mínimos; dbmate es un binario único agnóstico de lenguaje, SQL puro → triggers, RLS, roles, grants y funciones se expresan naturalmente y se revisan en PR.
- **Contras:** más código de mapping manual; sin relaciones "mágicas" (includes); Kysely aún es 0.x (API estable en la práctica, pero semver pre-1.0); dbmate no genera migraciones a partir de diffs (se escriben a mano — aceptado como ventaja de revisión); dos herramientas en vez de una.
- **Costo:** gratis. **Complejidad operativa:** baja (dbmate binario en la imagen/contenedor `migrate`).

### 4. MikroORM
- **Pros:** el más alineado a DDD entre los ORMs TS (Data Mapper, Unit of Work, Identity Map, embeddables para VOs); migraciones generadas; buen soporte PG.
- **Contras:** Unit of Work implícito con change tracking → difícil razonar sobre cuándo se emite SQL (append-only y RLS por transacción requieren cuidado); decorators/entities en dominio o mapping XML-like aparte; comunidad menor; rendimiento de flush en lotes grandes.
- **Costo:** gratis. **Complejidad operativa:** media.

### 5. TypeORM
- **Pros:** muy conocido en ecosistema NestJS (`@nestjs/typeorm`).
- **Contras:** historial de mantenimiento irregular y bugs longevos; Active Record/decorators invasivos en entidades; `decimal` devuelto como string pero con inconsistencias; migraciones generadas poco fiables con objetos avanzados; type-safety de queries débil.
- **Costo:** gratis. **Complejidad operativa:** media; **riesgo técnico:** alto.

### 6. SQL crudo + pgTyped
- **Pros:** máximo control, tipos desde SQL.
- **Contras:** composición dinámica de filtros (reporting, búsquedas) engorrosa; más boilerplate que Kysely sin ganar control adicional relevante.
- **Costo:** gratis. **Complejidad:** media.

## Consecuencias

**Positivas**
- RLS por transacción, Unit of Work multi-contexto y constraint triggers son triviales de implementar y de testear.
- La BD (migraciones SQL) es la fuente de verdad del esquema; las revisiones de PR ven el DDL real.
- El dominio queda libre de anotaciones de persistencia.

**Negativas**
- Más mappers manuales por agregado (mitigable con helpers y tests de round-trip).
- Sin herramienta visual tipo Prisma Studio (se usa pgAdmin/DBeaver/psql).

**Riesgos**
- Kysely pre-1.0 introduce breaking changes. *Mitigación:* versión pinneada, Renovate con revisión manual, superficie de uso acotada a `infrastructure`.
- Desincronización entre BD y tipos generados. *Mitigación:* `kysely-codegen` en CI contra BD migrada en Testcontainers; diff ≠ ∅ → falla.

## Validación

**SPIKE-02 (2 días)** implementa el mismo caso (crear transacción + journal entry balanceada + audit + outbox, con RLS) en **Kysely, Prisma 7 y Drizzle 1.0 RC** y compara:
1. `SET LOCAL` por transacción y aislamiento verificado (consulta de otro workspace devuelve 0 filas).
2. Round-trip `NUMERIC(38,18)` sin pérdida (incluyendo `123456789012345678.123456789012345678`).
3. Constraint trigger diferido dispara en `COMMIT`.
4. Mapping a agregado sin filtrar tipos del ORM al dominio.
5. DX de migraciones con RLS/triggers/roles.
6. Rendimiento: inserción de 10⁴ entries.

Criterio: si Kysely cumple 1–5, se acepta este ADR. Si Prisma o Drizzle cumplen todo con menos código **y** sin filtrar su modelo al dominio, se abre ADR que reemplaza a este.

## Notas

- Verificado 2026-10-01 (prisma.io changelog/blog): Prisma ORM 7.0 (nov 2025) hace por defecto el cliente Rust-free (query compiler + driver adapters obligatorios, `prisma.config.ts`); 7.3 mejoró la compilación de queries. El patrón RLS oficial es una Client Extension que envuelve queries en transacción con `set_config('app.…', …, true)`; existen issues reportados de bloqueo con transacciones interactivas extendidas (prisma/prisma#23583).
- Verificado 2026-10-01: Drizzle ORM 1.0 en release candidate (rc.1 2026-04-30, rc.4 2026-06-29), sin 1.0 final a finales de septiembre 2026; el equipo de Drizzle se unió a PlanetScale (marzo 2026).
- Verificado 2026-10-01: Kysely en línea 0.29.x (activamente publicado en septiembre 2026).
- Estado de mantenimiento de dbmate, MikroORM y TypeORM: a verificar en SPIKE-02.

## Resultado del spike (SPIKE-02, 2026-10-01)

Evidencia: [spikes/SPIKE-02-data-access/README.md](../../spikes/SPIKE-02-data-access/README.md) (código, salidas de Vitest/tsc y benchmark en `evidence/`).

**Recomendación: confirmar Kysely + migraciones SQL-first con dbmate.** El estado sigue en *Propuesto* hasta la aceptación del owner.

- Misma suite Vitest (27/27 verde) sobre `postgres:18` (18.6) con rol `pf_app` (no owner, sin `BYPASSRLS`) para **Kysely 0.29.6**, **Prisma 7.10.0 + `@prisma/adapter-pg`** y **Drizzle 1.0.0-rc.4**: transacción con `set_config('app.workspace_id', …, true)`; conversión USDT→BOB balanceada; entry desbalanceada que pasa todos los INSERT y falla en `COMMIT` (`PF001`); round-trip exacto de `0.000000000000000001`, `99999999999999999999.999999999999999999` y `123456789012345678.123456789012345678`; repositorio sin filtro que solo ve su workspace; fail-closed sin contexto; sin fuga entre conexiones reutilizadas del pool ni en 40 transacciones concurrentes; `UPDATE/DELETE` de posting → `42501`.
- Las tres herramientas son **correctas**; la diferencia está en la forma. Kysely: `string` para NUMERIC, error `pg` crudo con SQLSTATE, sin modelo propio (tipos de `kysely-codegen` desde la BD migrada), 3.8 MB runtime. Prisma: obliga a transacción interactiva en toda operación, entrega `Prisma.Decimal`/`Date` (DATE) al mapper, **acepta `number` en escrituras de `Decimal`**, `db pull` ignora triggers/grants/FORCE RLS y desfigura `INCLUDE`, 77 MB runtime, y **Prisma 8 ya está en RC**. Drizzle: correcto y ligero (25.6 MB), pero 1.0 sigue en RC (rc.4, junio 2026), su schema TS es un segundo modelo y `DrizzleQueryError` incluye los parámetros (montos) en el mensaje. **Drizzle queda como plan B.**
- Rendimiento: 6.5–14 ms por entry de 5 postings en todas; la varianza entre corridas supera la diferencia entre herramientas → no es criterio.
- Ajustes a "Detalles": `kysely-codegen` con `dateParser: "string"` y override de columnas monetarias a `ColumnType<string, string, never>` (por defecto acepta `number`); `pg.types.setTypeParser(1082, v => v)`; `dump` de dbmate vía la imagen `ghcr.io/amacneil/dbmate:2.36.0` (el paquete npm en Windows no trae `pg_dump`). dbmate 2.36.0 (MIT, 2026-09-19) activo.
- Pendientes: overhead RLS con/sin política (ADR-0023); la inconsistencia entre el helper de docs/08 §1.4 (`missing_ok` + `NULLIF` → 0 filas en silencio) y el fail-closed de ADR-0023 debe resolverse (el spike usó la variante de ADR-0023).
