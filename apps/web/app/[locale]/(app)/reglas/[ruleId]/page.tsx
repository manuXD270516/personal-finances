import { setRequestLocale } from 'next-intl/server';
import { Suspense, use } from 'react';
import { RuleEditorPage } from '../../../../../src/ui/rules/RuleEditor';

export default function Page({ params }: { params: Promise<{ locale: string; ruleId: string }> }) {
  const { locale, ruleId } = use(params);
  setRequestLocale(locale);
  return (
    <Suspense fallback={null}>
      <RuleEditorPage ruleId={ruleId} />
    </Suspense>
  );
}
