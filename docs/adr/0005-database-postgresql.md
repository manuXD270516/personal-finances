# ADR-0005: Base de datos — PostgreSQL 18

- Estado: Aceptado (2026-10-02, tras SPIKE-02; decisión del owner)
- Fecha: 2026-10-01
- Decisores: Owner (Product/Tech Lead)
- Relacionado: docs/ARCHITECTURE.md §2, §9, §10; docs/08-data-model.md; ADR-0004, ADR-0006, ADR-0007, ADR-0008, ADR-0013, ADR-0023; SPIKE-02

## Contexto y problema

El sistema necesita un almacén principal que garantice transacciones ACID entre contextos (Transactions + Ledger + Audit + Outbox en un mismo `COMMIT`), aritmética decimal exacta, constraints complejos (constraint triggers diferidos para el balance por moneda), aislamiento multi-tenant con Row-Level Security, schemas por contexto y consultas analíticas razonables para reporting personal. También debe existir como servicio gestionado en los proveedores cloud candidatos (ADR-0013) y correr en Docker localmente en Windows.

## Drivers de decisión

- ACID y constraints ricos (CHECK, EXCLUDE, triggers diferidos).
- Tipo decimal exacto de alta precisión (`NUMERIC(38,18)`).
- RLS nativo para multi-tenancy (ADR-0023).
- Schemas como unidad de propiedad por contexto (ADR-0003).
- Disponibilidad gestionada en AWS/GCP/Azure y localmente.
- Capacidad de servir también como cola/outbox (ADR-0008).
- Costo y licencia (open source, sin lock-in).

## Opciones consideradas

1. **PostgreSQL 18** (elegida).
2. MySQL 8.4 LTS / MariaDB.
3. SQLite / libSQL (embebido).
4. MongoDB (documental).
5. CockroachDB / YugabyteDB (Postgres-compatible distribuido).
6. Amazon Aurora PostgreSQL / Aurora Serverless v2 (como *variante de hosting* de PG, evaluada en ADR-0013).

## Decisión

**PostgreSQL 18** como base de datos única del core, con versión menor fijada en implementación (imagen `postgres:18.x` pinneada por digest; en cloud, RDS for PostgreSQL 18 o equivalente).

Convenciones (ARCHITECTURE §9):
- Un schema por contexto + `platform` (outbox, inbox, idempotency keys).
- IDs UUIDv7 generados en la aplicación (columna `uuid`).
- `timestamptz` UTC para instantes; `date` para fechas de negocio + timezone del workspace.
- `NUMERIC(38,18)` para montos y tasas (ADR-0006).
- `workspace_id NOT NULL` + política RLS en toda tabla de negocio (ADR-0023).
- Columna `version int` para optimistic locking en agregados.
- Roles separados: `pf_migrator` (owner de objetos, DDL), `pf_app` (DML, sin `BYPASSRLS`, no owner), `pf_readonly` (reporting/soporte).
- Extensiones permitidas inicialmente: `pgcrypto` (si hiciera falta), `pg_stat_statements`, `btree_gist` (si se usan EXCLUDE). Cualquier otra requiere ADR o nota aquí y verificación de disponibilidad en el servicio gestionado.

## Análisis de opciones

### 1. PostgreSQL 18 (elegida)
- **Pros:** `NUMERIC` arbitrario exacto; constraint triggers diferidos; RLS maduro; schemas; JSONB para metadatos (ConversionDetail, custom fields); `SKIP LOCKED` para outbox/colas; CTEs recursivas y window functions para reporting; extensiones; universal en cloud gestionado; PG 18 trae I/O asíncrono (mejora de lecturas secuenciales) y `uuidv7()` nativo como fallback.
- **Contras:** escalado de escritura vertical (irrelevante a nuestra escala); upgrades mayores requieren planificación (`pg_upgrade`/dump-restore).
- **Costo:** gratis; gestionado desde ~USD 15–30/mes (db.t4g.micro/small en RDS, single-AZ) — detalle en `docs/21-cloud-deployment-options.md`.
- **Complejidad operativa:** baja-media (backups, upgrades, vacuum; gestionado reduce la mayor parte).

### 2. MySQL / MariaDB
- **Pros:** muy difundido; gestionado barato.
- **Contras:** sin RLS nativo; sin constraint triggers diferidos; DDL transaccional limitado (migraciones parcialmente aplicadas); "schemas" = databases; DECIMAL máx. 65 dígitos ok, pero el resto de requisitos falla.
- **Costo:** similar. **Complejidad:** baja, pero obliga a reimplementar aislamiento e invariantes en app.

### 3. SQLite / libSQL
- **Pros:** cero operación; ideal para app local single-user.
- **Contras:** sin RLS, sin schemas reales, concurrencia de escritura limitada, `NUMERIC` no exacto (afinidad REAL/TEXT), no encaja con api+worker en procesos/contenedores separados ni con multi-usuario.
- **Costo:** nulo. **Complejidad:** muy baja, pero no cumple requisitos.

### 4. MongoDB
- **Pros:** flexibilidad de esquema.
- **Contras:** transacciones multi-documento más costosas; Decimal128 (34 dígitos) aceptable pero sin constraints declarativos; sin RLS; reporting relacional pobre; licencia SSPL.
- **Costo:** Atlas desde tier gratuito limitado. **Complejidad:** media; inadecuado para un ledger.

### 5. CockroachDB / YugabyteDB
- **Pros:** escalado horizontal, compatibilidad de wire con PG.
- **Contras:** compatibilidad parcial (triggers, RLS y extensiones con limitaciones o diferencias); latencia de consenso; costo; licencia de Cockroach no OSS desde 2024.
- **Costo:** alto. **Complejidad:** alta. Resuelve un problema (escala global) que no tenemos.

### 6. Aurora PostgreSQL
- Es PostgreSQL; se trata como opción de hosting en ADR-0013. Aurora Serverless v2 tiene mínimo de ACUs facturable que suele superar a una instancia RDS pequeña para cargas tan bajas — evaluar en SPIKE-09.

## Consecuencias

**Positivas**
- Las invariantes financieras pueden reforzarse en la propia BD (defense-in-depth).
- Una sola tecnología de persistencia para negocio, outbox, inbox, idempotencia y (potencialmente) colas.
- Portabilidad total entre clouds y local.

**Negativas**
- Dependencia de características específicas de PG (RLS, constraint triggers, `SET LOCAL`): migrar a otra BD sería costoso (aceptado).
- Gestionar upgrades mayores (PG 18 → 19+) cada pocos años.

**Riesgos**
- Versión 18 no disponible aún en algún proveedor gestionado elegido. *Mitigación:* verificar en SPIKE-09; el código no depende de features exclusivas de 18 salvo que se documente (p. ej. `uuidv7()` es solo fallback; IDs se generan en app).
- RLS mal configurado (rol owner o `BYPASSRLS`) anula aislamiento. *Mitigación:* ADR-0023 + test de arquitectura.

## Validación

- SPIKE-02: constraint trigger diferido de balance, RLS con `SET LOCAL`, round-trip `NUMERIC(38,18)` sin pérdida, benchmark de inserción de 10⁵ entries.
- Test de integración (Testcontainers con la misma imagen pinneada): migraciones aplican desde cero y son idempotentes en re-ejecución de dbmate.
- Métrica: p95 de queries del dashboard < 100 ms con dataset `seeds/large`.

## Notas

- Verificado 2026-10-01 (postgresql.org / endoflife.date): PostgreSQL 18 publicado 2025-09-25, soporte hasta noviembre 2030; la serie 18.x está en minors recientes (18.6 reportada en agosto 2026) y PostgreSQL 19 estaba en beta a mediados de 2026. Elegir 18 (y no 19 recién salido) es deliberado: priorizar disponibilidad en servicios gestionados y estabilidad. Reevaluar 19 cuando esté GA en RDS/Cloud SQL ≥ 6 meses.
- Verificado 2026-10-01: BullMQ v6 incorpora un backend PostgreSQL (MIT) además de Redis; refuerza la opción de PG como única dependencia stateful (ver ADR-0008).
- Disponibilidad exacta de PG 18 en RDS/Cloud SQL/Azure Flexible Server: a verificar en SPIKE-09.
