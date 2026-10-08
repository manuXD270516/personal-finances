import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { BudgetsPage } from '../../../../../src/ui/planning/BudgetsPage';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return <BudgetsPage />;
}
