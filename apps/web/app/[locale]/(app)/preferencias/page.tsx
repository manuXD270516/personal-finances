import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { InstallApp } from '../../../../src/ui/common/InstallApp';
import { PreferencesForm } from '../../../../src/ui/forms';
import { NotificationPreferencesPanel } from '../../../../src/ui/notifications/NotificationPreferencesPanel';

export default function PreferencesPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  return (
    <>
      <PreferencesForm />
      <InstallApp />
      <NotificationPreferencesPanel />
    </>
  );
}
