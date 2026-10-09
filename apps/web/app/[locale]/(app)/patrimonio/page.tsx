import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { NetWorthEvolutionPage } from '../../../../src/ui/networth/NetWorthEvolution';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return <NetWorthEvolutionPage />;
}
