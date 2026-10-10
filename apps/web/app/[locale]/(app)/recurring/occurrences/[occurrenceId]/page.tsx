import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { OccurrenceDetailPage } from '../../../../../../src/ui/recurring/OccurrenceDetail';

export default function Page({ params }: { params: Promise<{ locale: string; occurrenceId: string }> }) {
  const { locale, occurrenceId } = use(params);
  setRequestLocale(locale);
  return <OccurrenceDetailPage occurrenceId={occurrenceId} />;
}
