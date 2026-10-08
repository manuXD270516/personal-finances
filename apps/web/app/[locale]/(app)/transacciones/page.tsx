import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { one } from '../../../../src/ui/common/search-params';
import { TransactionsPage } from '../../../../src/ui/transactions/TransactionsPage';

export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  setRequestLocale(use(params).locale);
  const q = use(searchParams);
  const accountId = one(q['cuenta']);
  const kind = one(q['tipo']);
  // `?sinExtracto=1`: filtro "conciliadas sin extracto — pendientes de revisión" (docs/33 D111).
  const withoutStatement = one(q['sinExtracto']) === '1';
  return (
    <TransactionsPage
      {...(accountId ? { accountId } : {})}
      {...(kind ? { kind } : {})}
      {...(withoutStatement ? { withoutStatement: true } : {})}
    />
  );
}
