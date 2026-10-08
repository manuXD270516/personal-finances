import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { PeriodsPage } from '../../../../../src/ui/planning/PeriodsPage';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return <PeriodsPage />;
}
