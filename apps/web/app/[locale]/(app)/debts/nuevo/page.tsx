import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { NewLoanPage } from '../../../../../src/ui/debt/LoanForm';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return <NewLoanPage />;
}
