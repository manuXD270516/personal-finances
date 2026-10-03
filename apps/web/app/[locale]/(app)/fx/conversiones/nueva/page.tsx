import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { one } from '../../../../../../src/ui/common/search-params';
import { NewConversionPage } from '../../../../../../src/ui/fx/ConversionForm';

export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  setRequestLocale(use(params).locale);
  const q = use(searchParams);
  const source = one(q['origen']);
  const target = one(q['destino']);
  const amount = one(q['monto']);
  return (
    <NewConversionPage
      {...(source ? { sourceAccountId: source } : {})}
      {...(target ? { targetAccountId: target } : {})}
      {...(amount ? { amount } : {})}
    />
  );
}
