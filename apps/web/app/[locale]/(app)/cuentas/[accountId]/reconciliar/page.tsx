import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { one } from '../../../../../../src/ui/common/search-params';
import { ReconciliationPage } from '../../../../../../src/ui/reconciliation/ReconciliationPage';

export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; accountId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, accountId } = use(params);
  setRequestLocale(locale);
  const query = use(searchParams);
  const sessionId = one(query['sesion']);
  const date = one(query['fecha']);
  const balance = one(query['saldo']);
  const prefill =
    date || balance ? { ...(date ? { date } : {}), ...(balance ? { balance } : {}) } : undefined;
  return (
    <ReconciliationPage
      accountId={accountId}
      {...(sessionId ? { sessionId } : {})}
      {...(prefill ? { prefill } : {})}
    />
  );
}
