import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { ReportsCatalogPage } from '../../../../src/ui/reports/ReportsPages';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return <ReportsCatalogPage />;
}
