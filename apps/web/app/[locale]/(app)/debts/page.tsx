import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { LoansListPage } from '../../../../src/ui/debt/LoansList';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return <LoansListPage />;
}
