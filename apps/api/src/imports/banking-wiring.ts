import {
  CONNECTION_SYNC_JOB,
  CONNECTION_VERIFY_JOB,
  loadPrivateKeyring,
  type ConnectionJobPayload,
  type ConnectionJobQueue,
} from '@pf/imports/interface/imports.module';
import type { BankingRuntimeOptions } from '@pf/imports/interface/imports.module';
import { requireSqlExecutor } from '@pf/platform/api';
import { currentCorrelation, uuidv7 } from '@pf/platform/logging';
import type { JobQueue, QueueOptions } from '@pf/platform/queue';
import type { ClassificationRuntime } from '@pf/classification/interface/classification.module';

/**
 * Cola de las conexiones (openspec add-banking-providers decisión 6, D249): los jobs `imports.connection-verify` e
 * `imports.connection-sync` se encolan con la conexión de la transacción del comando (`enqueueInTransaction`), así
 * existen solo si el comando confirma. Son jobs de la `JobQueue` existente con concurrencia 1, NO consumidores de
 * eventos ni colas nuevas del presupuesto de conexiones. Los reintentos usan el backoff del runtime (NFR-REL-012).
 */
export const CONNECTION_QUEUE_OPTIONS: QueueOptions = {
  retryLimit: 3,
  retryDelaySeconds: 30,
  retryDelayMaxSeconds: 900,
  expireInSeconds: 1800,
};

export function connectionJobQueue(queue: JobQueue): ConnectionJobQueue {
  const ready = new Map<string, Promise<void>>();
  const ensure = (name: string): Promise<void> => {
    let p = ready.get(name);
    if (!p) {
      p = queue.ensureQueue(name, CONNECTION_QUEUE_OPTIONS).catch((err: unknown) => {
        ready.delete(name);
        throw err;
      });
      ready.set(name, p);
    }
    return p;
  };
  const put = async (name: string, payload: ConnectionJobPayload, startAfter?: Date): Promise<void> => {
    await ensure(name);
    await queue.enqueueInTransaction(
      name,
      [
        {
          id: uuidv7(),
          payload,
          correlationId: currentCorrelation()?.correlationId ?? uuidv7(),
          traceContext: {},
          ...(startAfter ? { startAfter } : {}),
        },
      ],
      requireSqlExecutor(),
    );
  };
  return {
    enqueueVerify: (job, startAfter) => put(CONNECTION_VERIFY_JOB, job, startAfter),
    enqueueSync: (job, startAfter) => put(CONNECTION_SYNC_JOB, job, startAfter),
  };
}

interface BankingConfig {
  readonly PFOS_ENV: BankingRuntimeOptions['environment'];
  readonly IMPORTS_PROVIDER_FAKE_ENABLED?: boolean | undefined;
  readonly CONNECTION_CREDENTIALS_PUBLIC_KEYS?: string | undefined;
  readonly CONNECTION_CREDENTIALS_PRIVATE_KEYS_FILE?: string | undefined;
  readonly CONNECTION_CREDENTIALS_PRIVATE_KEYS?: string | undefined;
  readonly CONNECTION_SYNC_MAX_DAYS?: number | undefined;
  readonly CONNECTION_PROVIDER_REQUESTS_PER_MINUTE?: number | undefined;
}

/**
 * Opciones de las conexiones desde la configuración. La API pasa `workerSide = false`: NO lee las claves privadas
 * (cifra pero no puede descifrar); el worker las lee del archivo montado (D342) o, en local/ci, de la variable.
 */
export function bankingOptionsFrom(
  config: BankingConfig,
  queue: JobQueue | undefined,
  workerSide: boolean,
): BankingRuntimeOptions {
  return {
    environment: config.PFOS_ENV,
    fakeEnabled: config.IMPORTS_PROVIDER_FAKE_ENABLED ?? false,
    publicKeys: config.CONNECTION_CREDENTIALS_PUBLIC_KEYS,
    privateKeys: workerSide
      ? loadPrivateKeyring({
          file: config.CONNECTION_CREDENTIALS_PRIVATE_KEYS_FILE,
          inline: config.CONNECTION_CREDENTIALS_PRIVATE_KEYS,
          environment: config.PFOS_ENV,
        })
      : null,
    queue: queue
      ? connectionJobQueue(queue)
      : {
          enqueueVerify: () => Promise.reject(new Error('connection jobs need the job queue')),
          enqueueSync: () => Promise.reject(new Error('connection jobs need the job queue')),
        },
    settings: {
      ...(config.CONNECTION_SYNC_MAX_DAYS ? { syncMaxDays: config.CONNECTION_SYNC_MAX_DAYS } : {}),
      ...(config.CONNECTION_PROVIDER_REQUESTS_PER_MINUTE
        ? { requestsPerMinute: config.CONNECTION_PROVIDER_REQUESTS_PER_MINUTE }
        : {}),
    },
  };
}

/** Categoría de sistema «comisiones» (CLASSIFICATION) para las filas de comisión de un exchange. */
export function feesCategoryPort(queries: Pick<ClassificationRuntime['queries'], 'systemCategoryId'>) {
  return {
    feesCategoryId: (workspaceId: string): Promise<string | null> =>
      // El catálogo de sistema no depende del usuario; la consulta solo necesita un id para sus mensajes.
      queries.systemCategoryId('00000000-0000-0000-0000-000000000000', workspaceId, 'FEES'),
  };
}
