import { uuidv7 } from '@pf/platform/logging';
import type { Client } from 'pg';
import minimalCatalog from './minimal/institutions.json' with { type: 'json' };

/**
 * Catálogo inicial OPCIONAL de instituciones ficticias por workspace (openspec add-accounts-management 2.4, design §8;
 * FR-ACCOUNTS-012; docs/29 §1: nombres inventados). Es un archivo de seed (`seed/<perfil>/institutions.json`), nunca
 * una migración ni constantes de dominio/aplicación: cada entrada se convierte en una institución NORMAL del workspace
 * (sin filas globales `workspace_id NULL`), editable y archivable como cualquier otra.
 */
export interface InstitutionCatalogEntry {
  readonly name: string;
  readonly kind: 'BANK' | 'FINTECH' | 'EXCHANGE' | 'BROKER' | 'WALLET_PROVIDER' | 'OTHER';
  readonly countryCode?: string | null;
  readonly website?: string | null;
}

export interface InstitutionCatalog {
  readonly catalogVersion: string;
  readonly institutions: readonly InstitutionCatalogEntry[];
}

export const MINIMAL_INSTITUTION_CATALOG = minimalCatalog as InstitutionCatalog;

/**
 * Carga el catálogo en UN workspace, en su propia transacción con el contexto RLS del usuario (rol de la app).
 * Idempotente: omite las entradas cuyo nombre (sin distinguir mayúsculas) ya existe entre las no archivadas, de modo
 * que re-ejecutar la seed no duplica y un nombre editado por el usuario no se "restaura". Devuelve cuántas creó.
 */
export async function seedInstitutionCatalog(
  client: Client,
  target: { readonly userId: string; readonly workspaceId: string },
  catalog: InstitutionCatalog = MINIMAL_INSTITUTION_CATALOG,
): Promise<number> {
  await client.query('BEGIN');
  try {
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`,
      [target.userId, target.workspaceId],
    );
    let created = 0;
    for (const entry of catalog.institutions) {
      const { rowCount } = await client.query(
        `INSERT INTO accounts.institution (id, workspace_id, name, kind, country_code, website)
         SELECT $1, $2, $3, $4, $5, $6
          WHERE NOT EXISTS (
            SELECT 1 FROM accounts.institution
             WHERE workspace_id = $2 AND lower(name) = lower($3) AND archived_at IS NULL)`,
        [
          uuidv7(),
          target.workspaceId,
          entry.name,
          entry.kind,
          entry.countryCode ?? null,
          entry.website ?? null,
        ],
      );
      created += rowCount ?? 0;
    }
    await client.query('COMMIT');
    return created;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  }
}
