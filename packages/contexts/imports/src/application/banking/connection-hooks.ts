import { DomainError } from '@pf/shared-kernel';
import type { ConnectionHooksPort, ImportsDeps } from '../ports/index.js';
import { recordConnection } from './connections.service.js';
import type { ConnectionRepository } from './ports.js';

/**
 * Ciclo del import → conexión (openspec add-banking-providers decisión 6): el cursor CONFIRMADO avanza solo cuando el
 * import de la sincronización llega a `COMPLETED*`; cancelar, expirar o fallar lo deja como estaba (la siguiente
 * sincronización vuelve a traer esos registros y la idempotencia evita duplicados). Corre en la unidad de trabajo del
 * cambio de estado del import. `deps` se entrega perezosamente porque el gancho forma parte de las dependencias.
 */
export class ConnectionHooks implements ConnectionHooksPort {
  constructor(
    private readonly deps: () => ImportsDeps,
    private readonly connections: ConnectionRepository,
  ) {}

  async onImportCompleted(workspaceId: string, connectionId: string, importJobId: string): Promise<void> {
    const deps = this.deps();
    const connection = await this.connections.findById(workspaceId, connectionId, { lock: 'update' });
    if (!connection) return;
    const before = connection.state.syncCursor;
    if (!connection.confirmCursor(importJobId, deps.clock.now().toString())) return;
    await this.save(connection);
    await recordConnection(deps, connection, 'cursor_confirmed', {
      changes: [{ field: 'syncCursor', before, after: connection.state.syncCursor }],
    });
  }

  async onImportAbandoned(workspaceId: string, connectionId: string, importJobId: string): Promise<void> {
    const deps = this.deps();
    const connection = await this.connections.findById(workspaceId, connectionId, { lock: 'update' });
    if (!connection) return;
    if (!connection.abandonSync(importJobId, deps.clock.now().toString())) return;
    await this.save(connection);
  }

  private async save(connection: Parameters<ConnectionRepository['save']>[0]): Promise<void> {
    if (!(await this.connections.save(connection))) {
      throw new DomainError('CONCURRENCY_CONFLICT', 'the connection was modified concurrently');
    }
    connection.markPersisted();
  }
}
