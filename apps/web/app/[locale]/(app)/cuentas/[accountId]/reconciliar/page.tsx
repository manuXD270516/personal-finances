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
  const sessionId = one(use(searchParams)['sesion']);
  return <ReconciliationPage accountId={accountId} {...(sessionId ? { sessionId } : {})} />;
}
