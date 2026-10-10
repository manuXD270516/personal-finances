import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { DefinitionDetailPage } from '../../../../../src/ui/recurring/DefinitionDetail';

export default function Page({ params }: { params: Promise<{ locale: string; definitionId: string }> }) {
  const { locale, definitionId } = use(params);
  setRequestLocale(locale);
  return <DefinitionDetailPage definitionId={definitionId} />;
}
