import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { ClassificationPage } from '../../../../src/ui/classification/ClassificationPage';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return <ClassificationPage />;
}
