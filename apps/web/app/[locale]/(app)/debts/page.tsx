import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { one } from '../../../../src/ui/common/search-params';
import { LoansListPage } from '../../../../src/ui/debt/LoansList';

/** `?vista=tarjetas` abre la pestaña Tarjetas. */
export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  setRequestLocale(use(params).locale);
  const view = one(use(searchParams)['vista']);
  return <LoansListPage initialTab={view === 'tarjetas' ? 'tarjetas' : 'prestamos'} />;
}
