import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { SpendingAnomaliesPage } from '../../../../src/ui/spending-anomalies/SpendingAnomaliesPage';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return <SpendingAnomaliesPage />;
}
