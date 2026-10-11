import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { SimulatorPage } from '../../../../../src/ui/debt/Simulator';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <SimulatorPage />;
}
