# contracts/events — Contratos de eventos de dominio (JSON Schema)

> **Estado:** Propuesto · **Fecha:** 2026-10-01 · **Relacionado:** [docs/11-domain-events.md](../../docs/11-domain-events.md) · [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) §7 · [docs/09-ledger-design.md](../../docs/09-ledger-design.md) · ADR-0008, ADR-0016

*Published Language* de los eventos de integración entre bounded contexts. Borrador de Phase 0: describe contratos, no implementación.

## Estructura

```
contracts/events/
├─ envelope.v1.schema.json            # envelope + $defs comunes (Money, Decimal, Rate, Uuid, LocalDate, Instant, CurrencyCode)
├─ transactions/
│  ├─ TransactionCreated.v1.schema.json   # además define $defs del contexto: TransactionKind, Origin, Leg, Split
│  ├─ TransactionPosted.v1.schema.json
│  ├─ TransactionVoided.v1.schema.json
│  ├─ TransactionCategorized.v1.schema.json
│  ├─ TransferCompleted.v1.schema.json
│  └─ ConversionRecorded.v1.schema.json
├─ ledger/
│  └─ JournalEntryPosted.v1.schema.json
└─ accounts/
   ├─ AccountOpened.v1.schema.json
   └─ AccountArchived.v1.schema.json
```

Ruta: `contracts/events/<context>/<EventName>.v<N>.schema.json` (ARCHITECTURE §6).

## Convenciones

- **Dialecto**: JSON Schema draft 2020-12. `$id` base `https://contracts.pfos.local/events/` (identificador, no resoluble por red: los validadores deben **precargar** todos los schemas, p. ej. `ajv.addSchema()`).
- **Composición**: cada evento hace `allOf: [{$ref: "../envelope.v1.schema.json"}]` y fija `eventType` (`const`), `eventVersion` (`const`), `aggregateType` (`const`) y `payload` (`$ref: #/$defs/Payload`).
- **Nombre**: `eventType = <context>.<EventName>`; el nombre completo es `<eventType>.v<eventVersion>`, p. ej. `transactions.TransactionPosted.v1`.
- **Dinero**: `$defs/Money` = `{ "amount": "<decimal string>", "currency": "<CurrencyCode>" }`. `amount` cumple `^-?(0|[1-9][0-9]{0,19})([.][0-9]{1,18})?$` (compatible con `NUMERIC(38,18)`). **Nunca** números JSON para montos o tasas. `PositiveMoney` para montos siempre positivos. La escala exacta por moneda (`currency.scale`) se valida en dominio, no en el schema.
- **Signo**: los montos de `legs` y `postings` usan convención contable (débito +, crédito −); el resto de montos son magnitudes positivas salvo indicación.
- **Tasas**: `$defs/Rate = {base, quote, value}` ⇒ *1 base = value quote*; `value` string positivo.
- **Fechas**: `LocalDate` (`YYYY-MM-DD`, fecha de negocio en la TZ del workspace) vs `Instant` (RFC 3339 UTC con `Z`).
- **IDs**: UUID en minúsculas; `eventId` debe ser UUIDv7.
- **Nulos explícitos**: los campos opcionales están presentes con `null` (todos los campos son `required`), lo que hace el contrato explícito y facilita la detección de cambios.
- **Estrictez**: `additionalProperties: false` en envelope y payloads ⇒ el **productor** debe emitir exactamente el contrato. Los **consumidores** NO validan estrictamente (tolerant reader): ignoran campos desconocidos para soportar cambios aditivos.
- **Invariantes no expresables** (p. ej. Σ postings por moneda = 0 en `JournalEntryPosted`) se documentan en `description` y se verifican en los tests de contrato del productor.
- **Ejemplos**: cada schema trae `examples` válidos usados por los tests de consumidores.

## Versionado

Resumen de [docs/11-domain-events.md §4](../../docs/11-domain-events.md):
- Aditivo (campo nuevo con `null` permitido, nuevo evento) ⇒ misma versión, actualizar schema + ejemplo.
- Breaking (renombrar/eliminar/cambiar tipo o semántica) ⇒ nuevo archivo `…v<N+1>.schema.json` + publicación dual durante la migración; luego deprecar `vN`.
- El envelope sólo cambia mediante ADR.

## Validación en CI (propuesta)

1. Meta-validación de todos los schemas (draft 2020-12) y validación de sus `examples`.
2. Diff de compatibilidad contra `main` (cambio breaking sin nueva versión ⇒ fallo).
3. Tests de contrato del productor por evento (`[TC-<CTX>-EVENTS-NNN]`), con Ajv (`strict`, `ajv-formats`).
4. Test de cobertura: todo `eventType` emitido en código tiene schema.

## Eventos Phase 1

| Evento | Productor | Consumidores |
|---|---|---|
| `transactions.TransactionCreated.v1` | TRANSACTIONS | RULES, COMMITMENTS, REPORTING |
| `transactions.TransactionPosted.v1` | TRANSACTIONS | PLANNING, REPORTING |
| `transactions.TransactionVoided.v1` | TRANSACTIONS | PLANNING, REPORTING, GOALS, DEBT, COMMITMENTS |
| `transactions.TransactionCategorized.v1` | TRANSACTIONS | PLANNING, REPORTING |
| `transactions.TransferCompleted.v1` | TRANSACTIONS | GOALS, DEBT, REPORTING |
| `transactions.ConversionRecorded.v1` | TRANSACTIONS | FX, REPORTING |
| `ledger.JournalEntryPosted.v1` | LEDGER | REPORTING, GOALS |
| `accounts.AccountOpened.v1` | ACCOUNTS | REPORTING |
| `accounts.AccountArchived.v1` | ACCOUNTS | REPORTING, COMMITMENTS, GOALS |

(Varios consumidores pertenecen a fases posteriores; en Phase 1 el consumidor efectivo es REPORTING.)
