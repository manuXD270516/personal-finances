import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { one } from '../../../../../src/ui/common/search-params';
import { NewTransactionPage } from '../../../../../src/ui/transactions/TransactionDetail';

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
  const duplicateOf = one(q['duplicar']);
  return (
    <NewTransactionPage
      {...(accountId ? { accountId } : {})}
      {...(kind ? { kind } : {})}
      {...(duplicateOf ? { duplicateOf } : {})}
    />
  );
}
