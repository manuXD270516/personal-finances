import { setRequestLocale } from 'next-intl/server';
import { Suspense, use } from 'react';
import { RuleEditorPage } from '../../../../../src/ui/rules/RuleEditor';

/** Admite `?description=…&kind=…&accountId=…&categoryId=…&counterpartyId=…`: prellena sin guardar nada. */
export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return (
    <Suspense fallback={null}>
      <RuleEditorPage />
    </Suspense>
  );
}
