import type { AuditPort } from '@pf/audit/contracts';
import { DomainError } from '@pf/shared-kernel';
import type { PreferencesInput } from '../domain/index.js';
import type { PreferencesDeps } from './ports/index.js';

export interface PreferencesView {
  readonly types: readonly { readonly type: string; readonly inApp: boolean; readonly email: boolean }[];
  readonly quietHours: { readonly start: string; readonly end: string } | null;
  readonly includeDetailsInEmail: boolean;
  /** ETag de las preferencias (`If-Match` del `PUT`). */
  readonly version: number;
}

const preconditionFailed = (currentVersion?: number): DomainError =>
  new DomainError('PRECONDITION_FAILED', 'If-Match does not match the current version', {
    ...(currentVersion === undefined ? {} : { details: { currentVersion } }),
  });

/** Valores compuestos de auditoría como texto JSON (docs/31 D19). */
const auditValue = (value: unknown): unknown =>
  typeof value === 'object' && value !== null ? JSON.stringify(value) : value;

/**
 * Preferencias por tipo y canal, horario de silencio e inclusión de detalles en el email (FR-NOTIFY-003/006). Son
 * propias de cada usuario y workspace (cualquier rol). Los cambios SÍ se auditan —son configuración, FR-AUDIT-001—
 * en la misma transacción (docs/33 D92); leer/archivar notificaciones no.
 */
export class PreferencesService {
  constructor(private readonly deps: PreferencesDeps & { readonly audit: AuditPort }) {}

  get(workspaceId: string, userId: string): Promise<PreferencesView> {
    return this.deps.uow.run(workspaceId, async () => {
      const prefs = await this.deps.preferences.load(workspaceId, userId);
      return { ...prefs.toView(), version: prefs.version };
    });
  }

  /** `PUT …/notification-preferences` (`If-Match`): reemplaza lo enviado; los tipos omitidos conservan su valor. */
  update(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly expectedVersion: number;
    readonly preferences: PreferencesInput;
  }): Promise<PreferencesView> {
    const { workspaceId, userId } = input;
    return this.deps.uow.run(workspaceId, async () => {
      const prefs = await this.deps.preferences.load(workspaceId, userId);
      if (prefs.version !== input.expectedVersion) throw preconditionFailed(prefs.version);
      const changes = prefs.update(input.preferences);
      if (changes.length > 0) {
        if (!(await this.deps.preferences.save(prefs))) {
          const current = await this.deps.preferences.load(workspaceId, userId);
          throw preconditionFailed(current.version);
        }
        await this.deps.audit.append({
          workspaceId,
          action: 'notifications.preferences.updated',
          aggregateType: 'NotificationPreferences',
          aggregateId: userId,
          aggregateVersion: prefs.version,
          changes: changes.map((c) => ({
            field: c.field,
            before: auditValue(c.before),
            after: auditValue(c.after),
          })),
        });
      }
      return { ...prefs.toView(), version: prefs.version };
    });
  }
}
