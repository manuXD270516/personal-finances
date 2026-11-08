import type { PortabilityExclusion, PortabilitySection } from '@pf/shared-kernel';

/**
 * Secciones de exportación/importación del workspace que pertenecen a NOTIFY (openspec add-workspace-export): SOLO las
 * preferencias y los ajustes de notificación del usuario que importa (el único OWNER del workspace restaurado). Las
 * notificaciones y sus entregas son derivadas y transitorias (retención de 12 meses): NO se exportan.
 */
export const NOTIFICATIONS_PORTABILITY_SECTIONS: readonly PortabilitySection[] = [
  {
    name: 'notification-preferences',
    context: 'notifications',
    table: 'notifications.notification_preference',
    order: 800,
    orderBy: ['user_id', 'notification_type', 'channel'],
    idColumns: [],
    importerColumn: 'user_id',
  },
  {
    name: 'notification-user-settings',
    context: 'notifications',
    table: 'notifications.user_setting',
    order: 801,
    orderBy: ['user_id'],
    idColumns: [],
    importerColumn: 'user_id',
    // add-cash-flow-forecast (FR-NOTIFY-007): un archivo exportado antes del cambio no trae la frecuencia del digest y
    // se importa con el digest desactivado.
    legacyDefaults: { digest_frequency: 'OFF' },
  },
];

export const NOTIFICATIONS_PORTABILITY_EXCLUSIONS: readonly PortabilityExclusion[] = [
  {
    table: 'notifications.notification',
    reason: 'Derivada y transitoria (retención 12 meses, docs/33 D93).',
  },
  {
    table: 'notifications.notification_delivery',
    reason: 'Entregas técnicas de las notificaciones (transitorias).',
  },
];
