import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { ForecastsPage } from '../../../../src/ui/forecasts/ForecastsPage';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return <ForecastsPage />;
}
