import { createClassificationRuntime } from '@pf/classification/interface/classification.module';
import { createFxRuntime } from '@pf/fx/interface/fx.module';
import { identityUserLocales, type WorkspaceCreatedHook } from '@pf/identity/interface/identity.module';
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
 * provisión no audita ni publica eventos (el alta del workspace es quien los emite), así que auditoría, recorrido,
 * outbox y ajustes de workspace fallan en voz alta si alguna vez se usaran aquí.
 */
export function seedWorkspaceProvisioning(pool: Pool, clock: Clock): WorkspaceCreatedHook {
  const audit = { append: unavailable('AuditPort') };
  const outbox = { append: unavailable('OutboxPort') };
  return workspaceCreatedHook({
    classification: createClassificationRuntime({
      pool,
      clock,
      audit,
      outbox,
      locales: identityUserLocales(pool),
    }),
    fx: createFxRuntime({
      pool,
      clock,
      audit,
      outbox,
      lifecycle: { record: unavailable('LifecyclePort') },
      lifecycleQuery: {
        lifecycleOf: unavailable('LifecycleQuery'),
        machineOf: unavailable('LifecycleQuery'),
      },
      workspaces: { settingsOf: unavailable('WorkspaceSettingsPort') },
    }),
  });
}
