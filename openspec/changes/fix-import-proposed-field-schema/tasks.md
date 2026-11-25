# Tareas

> Change 71 (docs/03 §7). Sin preguntas bloqueantes (pregunta 6 de docs/76 con la recomendación). Gates: `pnpm format:check`, `pnpm turbo typecheck lint test build`, `pnpm contract:breaking`, `pnpm traceability:check`, `pnpm spec:validate` y `pnpm test:integration` (los tests de API de imports corren ahí).

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar TC-IMPORTS-PIPELINE-072..074 contra los scenarios; pasar a `ready` y `requirement_status: confirmed`

## 2. API (contrato)

- [ ] 2.1 `ImportProposedIdField`, `ImportProposedIdListField` e `ImportProposedTextField`; `ImportRowProposal` apunta a ellos; retirar `ImportProposedField`; Spectral y Redocly sin errores; `pnpm contract:breaking` limpio: TC-IMPORTS-PIPELINE-072

## 3. APPLICATION

- [ ] 3.1 IMPORTS: vistas tipadas por campo en `toProposalView` (sin conversiones de tipo): TC-IMPORTS-PIPELINE-072, -073

## 4. UI

- [ ] 4.1 `apps/web/src/ui/imports/types.ts` y `pipeline-logic.ts` con los tipos por campo; sin cambios visibles

## 5. AUTOMATED TESTS

- [ ] 5.1 Quitar el filtro de errores de `/proposal/<campo>/value` en `apps/api/test/api/imports-connections.api.test.ts` y validar contra el contrato la vista previa y la edición de una fila en los tests de API del import: TC-IMPORTS-PIPELINE-072..074
- [ ] 5.2 Test con una descripción propuesta con forma de UUID (regla de descripción): TC-IMPORTS-PIPELINE-073

## 6. DOCUMENTATION

- [ ] 6.1 Cerrar en docs/38 §4 el hallazgo del contrato de la vista previa
- [ ] 6.2 Actualizar la matriz de trazabilidad; `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check`
