import type { AccountCatalogQuery } from '@pf/accounts/contracts';
import type { ClassificationValidator } from '@pf/classification/contracts';
import type { OccurrenceLinkPort, OccurrenceMatchCandidatesQuery } from '@pf/commitments/contracts';
import type { DocumentsRuntime } from '@pf/documents/interface/documents.module';
import type { ImportsRuntimeOptions } from '@pf/imports/interface/imports.module';
import { currentRequestContext } from '@pf/platform/api';
import type { RuleEvaluationQuery } from '@pf/rules/contracts';
import { DomainError } from '@pf/shared-kernel';

/**
 * Puertos de IMPORTS que satisfacen los contratos públicos de otros contextos (openspec add-import-pipeline § Puertos
 * que consume): DOCUMENTS, COMMITMENTS, CLASSIFICATION, ACCOUNTS y RULES. Composición pura: ningún contexto importa la
 * capa interna de otro.
 */

type ImportsPorts = Pick<
  ImportsRuntimeOptions,
  'documents' | 'rules' | 'counterparties' | 'matching' | 'occurrenceLinks' | 'institutions' | 'refs'
>;

/** Referencia mutable al runtime de DOCUMENTS (se crea después que IMPORTS; undefined = documentos deshabilitados). */
export interface DocumentsRef {
  current?: DocumentsRuntime | undefined;
}

const unavailable = () => new DomainError('SERVICE_UNAVAILABLE', 'documents are not enabled');

/** Lee el flujo verificado del documento con un tope de bytes (el documento ya está acotado por DOCUMENTS). */
async function collect(
  stream: AsyncIterable<Buffer | Uint8Array | string>,
  maxBytes: number,
): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) throw new DomainError('UPLOAD_TOO_LARGE', `the document exceeds ${maxBytes} bytes`);
    chunks.push(buf);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function ambientUserId(): string {
  const actor = currentRequestContext()?.actor;
  // Los procesos de fondo no tienen usuario: la validación del catálogo solo necesita uno para sus mensajes.
  return actor && actor.type === 'USER' ? actor.userId : '00000000-0000-0000-0000-000000000000';
}

export function importsPortsFor(input: {
  readonly documents: DocumentsRef;
  readonly commitments: {
    readonly linkPort: OccurrenceLinkPort;
    readonly matchCandidates: OccurrenceMatchCandidatesQuery;
  };
  readonly classification: ClassificationValidator;
  readonly rules: RuleEvaluationQuery;
  readonly accountCatalog: Pick<AccountCatalogQuery, 'listAccounts'>;
}): ImportsPorts {
  const documents: ImportsPorts['documents'] = {
    async getForProcessing(workspaceId, documentId) {
      const runtime = input.documents.current;
      if (!runtime) throw unavailable();
      const d = await runtime.download.getForProcessing({ workspaceId, documentId });
      return d
        ? {
            documentId: d.documentId,
            status: d.status,
            purpose: d.purpose,
            detectedFormat: d.detectedFormat,
            sizeBytes: d.sizeBytes,
            sha256: d.sha256,
            originalName: d.originalName,
          }
        : null;
    },
    async readBytes(workspaceId, documentId, maxBytes) {
      const runtime = input.documents.current;
      if (!runtime) throw unavailable();
      return collect(await runtime.download.open({ workspaceId, documentId }), maxBytes);
    },
    async linkToImport(link) {
      const runtime = input.documents.current;
      if (!runtime) throw unavailable();
      await runtime.attachments.asCommand().link({
        workspaceId: link.workspaceId,
        documentId: link.documentId,
        targetType: 'IMPORT_JOB',
        targetId: link.importJobId,
        actorUserId: link.actorUserId,
      });
    },
  };

  return {
    documents,
    // Reglas (add-rule-engine): `RuleEvaluationQuery.evaluate` con `trigger = IMPORT` y `mode = FILL_EMPTY`.
    rules: {
      evaluate: ({ workspaceId, subjects }) =>
        input.rules.evaluate({ workspaceId, trigger: 'IMPORT', mode: 'FILL_EMPTY', subjects }),
    },
    // Pendiente: CLASSIFICATION sigue sin un contrato para resolver alias de contraparte ni la categoría por defecto
    // de una contraparte por lote (add-rule-engine no lo agregó): el adaptador devuelve vacío y ninguna fila trae esa propuesta.
    counterparties: {
      resolveAliases: async (_workspaceId, descriptions) =>
        new Map(descriptions.map((d) => [d, null] as const)),
      defaultCategories: async (_workspaceId, ids) => new Map(ids.map((id) => [id, null] as const)),
    },
    matching: {
      async findCandidates({ workspaceId, rows }) {
        const found = await input.commitments.matchCandidates.findCandidates({
          workspaceId,
          rows: rows.map((r) => ({
            rowRef: r.rowRef,
            kind: r.kind,
            accountId: r.accountId,
            ...(r.toAccountId ? { toAccountId: r.toAccountId } : {}),
            amount: r.amount,
            businessDate: r.businessDate,
            ...(r.counterpartyId ? { counterpartyId: r.counterpartyId } : {}),
          })),
        });
        return found.map((entry) => ({
          rowRef: entry.rowRef,
          candidates: entry.candidates.map((c) => ({
            occurrenceId: c.occurrenceId,
            definitionId: c.definitionId,
            definitionName: c.definitionName,
            dueDate: c.dueDate,
            score: c.score,
            confidence: c.confidence,
            ambiguous: c.ambiguous,
          })),
        }));
      },
    },
    occurrenceLinks: {
      async link(link) {
        await input.commitments.linkPort.link({
          workspaceId: link.workspaceId,
          occurrenceId: link.occurrenceId,
          transactionId: link.transactionId,
          matchedBy: 'USER_LINK',
          userId: link.userId,
        });
      },
    },
    institutions: {
      async institutionOf(workspaceId, accountId) {
        const accounts = await input.accountCatalog.listAccounts({ workspaceId, includeArchived: true });
        return accounts.find((a) => a.accountId === accountId)?.institutionId ?? null;
      },
      async accountNumberLast4Of(workspaceId, accountId) {
        const accounts = await input.accountCatalog.listAccounts({ workspaceId, includeArchived: true });
        return accounts.find((a) => a.accountId === accountId)?.accountNumberLast4 ?? null;
      },
    },
    refs: {
      async assertCategory(workspaceId, categoryId, kind, pointer) {
        const attempt = (splitKind: 'EXPENSE' | 'INCOME') =>
          input.classification.validate({
            userId: ambientUserId(),
            workspaceId,
            categoryIds: [{ categoryId, splitKind }],
          });
        try {
          if (kind !== null) await attempt(kind);
          else {
            // Sin tipo (transferencia o lote): vale una categoría activa de cualquiera de los dos tipos.
            try {
              await attempt('EXPENSE');
            } catch (err) {
              if (err instanceof DomainError && err.code === 'CATEGORY_KIND_MISMATCH')
                await attempt('INCOME');
              else throw err;
            }
          }
        } catch (err) {
          throw err instanceof DomainError ? err.at(pointer) : err;
        }
      },
      async assertCounterparty(workspaceId, counterpartyId, pointer) {
        try {
          await input.classification.validate({ userId: ambientUserId(), workspaceId, counterpartyId });
        } catch (err) {
          throw err instanceof DomainError ? err.at(pointer) : err;
        }
      },
      async assertTags(workspaceId, tagIds, pointer) {
        try {
          await input.classification.validate({ userId: ambientUserId(), workspaceId, tagIds });
        } catch (err) {
          throw err instanceof DomainError ? err.at(pointer) : err;
        }
      },
    },
  };
}
