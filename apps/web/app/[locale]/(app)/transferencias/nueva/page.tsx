import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { one } from '../../../../../src/ui/common/search-params';
import { NewTransferPage } from '../../../../../src/ui/transactions/TransferForm';

export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  setRequestLocale(use(params).locale);
  const q = use(searchParams);
  const from = one(q['origen']);
  const to = one(q['destino']);
  return (
    <NewTransferPage
      cardPayment={one(q['pagoTarjeta']) === '1'}
      {...(from ? { fromAccountId: from } : {})}
      {...(to ? { toAccountId: to } : {})}
    />
  );
}
