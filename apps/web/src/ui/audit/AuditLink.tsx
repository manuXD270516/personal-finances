'use client';

import { useFormat, WithWorkspace } from '../common/workspace';
import { AUDIT_PATH, canQuery } from './logic';

/**
 * Enlace a la pantalla "Auditoría" desde la configuración del workspace (OWNER y EDITOR; la API decide, la UI solo
 * lo oculta a un VIEWER). openspec add-global-audit-view 6.1.
 */
export function AuditSettingsLink() {
  return (
    <WithWorkspace>
      {(ctx) => <SettingsLink role={ctx.ws.role} href={ctx.href(AUDIT_PATH)} ctx={ctx} />}
    </WithWorkspace>
  );
}

function SettingsLink({
  role,
  href,
  ctx,
}: {
  role: string;
  href: string;
  ctx: Parameters<typeof useFormat>[1];
}) {
  const f = useFormat('AuditLog', ctx);
  if (!canQuery(role)) return null;
  return (
    <p>
      <a href={href} data-testid="audit-open">
        {f.t('link.settings')}
      </a>
    </p>
  );
}
