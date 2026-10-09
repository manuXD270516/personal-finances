import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { AuditLogPage } from '../../../../../src/ui/audit/AuditLogPage';
import { filtersFromParams } from '../../../../../src/ui/audit/logic';
import { one } from '../../../../../src/ui/common/search-params';

/** Auditoría global del workspace (add-global-audit-view): los filtros iniciales viajan en la URL para poder enlazarla. */
export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  setRequestLocale(use(params).locale);
  const q = use(searchParams);
  const initial = filtersFromParams({
    ...(one(q['actorUserId']) ? { actorUserId: one(q['actorUserId'])! } : {}),
    ...(one(q['action']) ? { action: one(q['action'])! } : {}),
    ...(one(q['aggregateType']) ? { aggregateType: one(q['aggregateType'])! } : {}),
    ...(one(q['aggregateId']) ? { aggregateId: one(q['aggregateId'])! } : {}),
    ...(one(q['origin']) ? { origin: one(q['origin'])! } : {}),
    ...(one(q['correlationId']) ? { correlationId: one(q['correlationId'])! } : {}),
    ...(one(q['category']) ? { category: one(q['category'])! } : {}),
    ...(one(q['from']) ? { from: one(q['from'])! } : {}),
    ...(one(q['to']) ? { to: one(q['to'])! } : {}),
  });
  return <AuditLogPage initial={initial} />;
}
