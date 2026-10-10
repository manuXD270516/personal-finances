# Diseño: fix-phase-2-gaps

## Decisiones

1. **Locale tolerante al leer.** `LocaleTag.fromStored(raw, fallback)` para rehidratar (`pg-identity.ts` `findById` y la lectura de workspace); `LocaleTag.of` sigue estricto en escritura. El fallback es `APP_DEFAULT_LOCALE`. Se registra un log `warn` sin PII (solo el id del usuario) para detectar datos así. El importer valida y normaliza el locale con la misma función.
2. **Bucket `costly`.** Nueva política `{ name: 'costly', quota: RATE_LIMIT_COSTLY_PER_MIN, windowSeconds: 60 }` con claves `user:` y `workspace:` (solo `user:` en operaciones sin workspace). Se marca por operación con la extensión del contrato `x-rate-limit: costly`, leída por el interceptor (que ya resuelve la operación del contrato); la petición consume la cuota `costly` además de `writes`. Operaciones: `bulkEditTransactions` (no el preview), `requestWorkspaceExport`, `requestWorkspaceImport` y la exportación CSV de auditoría (reemplaza su `EXPORT_POLICY` manual). Un replay idempotente no consume cuota costosa.
3. **Nombre del actor.** Puerto `UserDisplayNames.namesOf(workspaceId, userIds)` en audit, implementado por identity leyendo `iam.user.display_name` de los usuarios que figuran en el audit log del workspace (incluye ex-miembros, cuyo id ya aparece en la vista global). Se resuelve en bloque por página del export (sin N+1). Columna `actorName` justo después de `actorId`, neutralizada como cualquier celda.
4. **Hash multipart.** La verificación de idempotencia de `requestWorkspaceImport` usa como payload `{ fileSha256 }` (más los campos de formulario si existen), calculado al leer el archivo. Opción preferida: el interceptor delega en un proveedor de payload que la operación multipart resuelve tras leer el archivo, y la clave se reserva recién con el hash completo. Si eso complica el interceptor, la verificación de esa operación se mueve al handler, con el mismo store y la misma política.

## Riesgos

- La cuota costosa puede afectar tests que hacen más de 10 exports o ediciones por minuto con el mismo usuario: el harness sube `RATE_LIMIT_COSTLY_PER_MIN` solo en los tests que no prueban el límite.
