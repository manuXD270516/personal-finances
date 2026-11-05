import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { isReportSlug } from '../../../../../src/ui/reports/logic';
import { ReportPage } from '../../../../../src/ui/reports/ReportsPages';

export default function Page({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = use(params);
  setRequestLocale(locale);
  if (!isReportSlug(slug)) notFound();
  return <ReportPage slug={slug} />;
}
