import { setRequestLocale } from 'next-intl/server';
import { Suspense, use } from 'react';
import { RulesPage } from '../../../../src/ui/rules/RulesList';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return (
    <Suspense fallback={null}>
      <RulesPage />
    </Suspense>
  );
}
