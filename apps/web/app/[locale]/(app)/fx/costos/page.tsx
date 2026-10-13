import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { ConversionCostsPage } from '../../../../../src/ui/fx/ConversionCostsPage';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return <ConversionCostsPage />;
}
