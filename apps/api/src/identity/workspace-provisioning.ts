import { createAuditRuntime } from '@pf/audit/interface/audit.module';
import { CLASSIFICATION_AUDIT_POLICY } from '@pf/classification/contracts';
import { createClassificationRuntime } from '@pf/classification/interface/classification.module';
import { createFxRuntime } from '@pf/fx/interface/fx.module';
import {
  identityUserLocales,
  identityWorkspaceTimeZones,
  type WorkspaceCreatedHook,
} from '@pf/identity/interface/identity.module';
import type { Clock } from '@pf/shared-kernel';
import type { Pool } from 'pg';

/** Provisores que corren al crear un workspace (los runtimes de CLASSIFICATION y FX los exponen). */
export interface WorkspaceProvisioners {
  readonly classification: { readonly provisioner: WorkspaceCreatedHook };
  readonly fx: {
    readonly provisioner: {
      onWorkspaceCreated(input: { readonly workspaceId: string; readonly userId: string }): Promise<void>;
    };
  };
}

/**
 * Gancho síncrono de `CreateWorkspace` (add-classification design §6; add-manual-conversions): categorías de sistema
 * y catálogo sugerido es-BO (CLASSIFICATION) y monedas por defecto (FX), en la transacción del alta. Es el ÚNICO
 * camino de provisión: lo usan IDENTITY y la Minimal Seed (W1/W2).
 */
export function workspaceCreatedHook(input: WorkspaceProvisioners): WorkspaceCreatedHook {
  return {
    onWorkspaceCreated: async (created) => {
      await input.classification.provisioner.onWorkspaceCreated(created);
      await input.fx.provisioner.onWorkspaceCreated(created);
    },
  };
}

const unavailable = (what: string) => () => {
  throw new Error(`${what} no está disponible durante la provisión de la seed`);
};

/**
 * Provisión fuera de la API (Minimal Seed): los mismos provisores sobre PostgreSQL con el rol de la app (RLS). La
 * provisión de categorías registra su `CREATE` en el recorrido respaldado por `classification.catalog.applied`
 * (docs/31 D52, D54), así que CLASSIFICATION recibe el `LifecyclePort` real; el resto (auditoría directa, outbox,
 * consultas del recorrido y ajustes de workspace) falla en voz alta si alguna vez se usara aquí.
 */
export function seedWorkspaceProvisioning(pool: Pool, clock: Clock): WorkspaceCreatedHook {
  const audit = { append: unavailable('AuditPort') };
  const outbox = { append: unavailable('OutboxPort') };
  const lifecycle = { record: unavailable('LifecyclePort') };
  // Solo CLASSIFICATION escribe aquí (registro del catálogo + CREATE de cada categoría provisionada).
  const classificationLifecycle = createAuditRuntime({
    pool,
    clock,
    policies: [CLASSIFICATION_AUDIT_POLICY],
    timeZones: identityWorkspaceTimeZones(pool),
  }).lifecycle;
  const lifecycleQuery = {
    lifecycleOf: unavailable('LifecycleQuery'),
    machineOf: unavailable('LifecycleQuery'),
  };
  return workspaceCreatedHook({
    classification: createClassificationRuntime({
      pool,
      clock,
      audit,
      lifecycle: classificationLifecycle,
      lifecycleQuery,
      outbox,
      locales: identityUserLocales(pool),
    }),
    fx: createFxRuntime({
      pool,
      clock,
      audit,
      outbox,
      lifecycle,
      lifecycleQuery,
      workspaces: { settingsOf: unavailable('WorkspaceSettingsPort') },
    }),
  });
}
