import { useState, type KeyboardEvent } from 'react';
import { Activity, Cloud, QrCode, ShieldAlert } from 'lucide-react';
import WhatsAppCloudPage from './WhatsAppCloudPage';
import WhatsAppDiagnostics from './WhatsAppDiagnostics';
import WhatsAppQRPage from './WhatsAppQRPage';

import { useLocale } from '../../i18n/useLocale';
type TabKey = 'qr' | 'cloud' | 'diag';
const TAB_KEYS: TabKey[] = ['qr', 'cloud', 'diag'];

export default function WhatsAppTasksPage() {
  const { t, dir } = useLocale();
  const [activeTab, setActiveTab] = useState<TabKey>('qr');
  const panelId = activeTab === 'qr' ? 'panel-qr' : activeTab === 'cloud' ? 'panel-cloud' : 'panel-diag';
  const tabId = activeTab === 'qr' ? 'tab-qr' : activeTab === 'cloud' ? 'tab-cloud' : 'tab-diag';

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const forwardKey = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const backwardKey = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    let nextIndex = index;
    if (event.key === forwardKey) nextIndex = (index + 1) % TAB_KEYS.length;
    else if (event.key === backwardKey) nextIndex = (index - 1 + TAB_KEYS.length) % TAB_KEYS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = TAB_KEYS.length - 1;
    else return;

    event.preventDefault();
    const nextTab = TAB_KEYS[nextIndex];
    setActiveTab(nextTab);
    document.getElementById(`tab-${nextTab}`)?.focus();
  };

  return (
    <div className="grid gap-5 sm:gap-6" dir={dir}>
      <header className="grid gap-1 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:p-6">
        <h1 className="text-[var(--fs-xl)] font-black text-[var(--text)]">{t('إعداد WhatsApp وإرسال المهام', 'WhatsApp setup and task delivery')}</h1>
        <p className="text-sm leading-6 text-[var(--text-muted)]">{t('اتبع الخطوات، اختر طريقة الاتصال، ثم راجع إعداد المهمة والمستلمين قبل أي إرسال.', 'Follow the steps, choose a connection method, then review the task and recipients before sending.')}</p>
      </header>
      <ol
        aria-label={t('خطوات إعداد وإرسال رسائل واتساب', 'WhatsApp setup and send steps')}
        className="grid gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 sm:grid-cols-3 sm:gap-3 sm:p-4"
      >
        <li className="flex min-w-0 items-start gap-3 rounded-xl bg-[var(--surface-2)] p-3 text-sm">
          <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--primary)] text-xs font-black text-white">1</span>
          <span><strong className="block font-extrabold">{t('الإعداد والاتصال', 'Setup and connection')}</strong><span className="mt-0.5 block text-xs leading-5 text-[var(--text-muted)]">{t('اختار طريقة الربط وتحقق من الحالة.', 'Choose a connection method and check its status.')}</span></span>
        </li>
        <li className="flex min-w-0 items-start gap-3 rounded-xl bg-[var(--surface-2)] p-3 text-sm">
          <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--primary-soft)] text-xs font-black text-[var(--link)]">2</span>
          <span><strong className="block font-extrabold">{t('المهمة والمستلمون', 'Task and recipients')}</strong><span className="mt-0.5 block text-xs leading-5 text-[var(--text-muted)]">{t('حدد مهمة واختر الأعضاء المؤهلين فقط.', 'Choose a task and only eligible recipients.')}</span></span>
        </li>
        <li className="flex min-w-0 items-start gap-3 rounded-xl bg-[var(--surface-2)] p-3 text-sm">
          <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--primary-soft)] text-xs font-black text-[var(--link)]">3</span>
          <span><strong className="block font-extrabold">{t('المراجعة والتأكيد', 'Review and confirm')}</strong><span className="mt-0.5 block text-xs leading-5 text-[var(--text-muted)]">{t('راجع الرسالة وأكد الموافقة قبل أي إرسال.', 'Review the message and confirm consent before sending.')}</span></span>
        </li>
      </ol>

      <section
        role="alert"
        aria-label={t('تنبيه سياسات واتساب والأمان', 'WhatsApp policy and security warning')}
        className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200"
      >
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" size={20} aria-hidden="true" />
          <div className="text-sm leading-6">
            <h2 className="text-base font-bold">{t('تنبيه بخصوص سياسات واتساب واحتمال حظر الحساب', 'WhatsApp policies and account suspension risk')}</h2>
            <p className="mt-1">
              {t('طريقة الربط عن طريق QR باستخدام مكتبات الويب (زي Baileys) مش رسمية ومش معتمدة من Meta، واستخدامها في البعت التلقائي ممكن يعرّض رقم التليفون للحظر والإيقاف النهائي حسب سياسات WhatsApp Business.', 'QR linking through web libraries such as Baileys is unofficial and not approved by Meta. Automated use may lead to phone-number bans under WhatsApp Business policies.')}
            </p>
            <p className="mt-1">
              {t('التبويب ده معمول كنموذج تجريبي منفصل للاختبار الإداري الداخلي بس. لو عايز تبعت إشعارات موثوقة في بيئة التشغيل الفعلية، استخدم تبويب', 'This tab is an isolated mock for internal admin testing only. For reliable notifications in production, use the tab')} <strong>{t('الربط السحابي الرسمي (Meta Cloud API)', 'Official Cloud connection (Meta Cloud API)')}</strong>.
            </p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="tablist" aria-orientation="horizontal" aria-label={t('طرق ربط واتساب', 'WhatsApp connection methods')}>
        <button
          type="button"
          role="tab"
          id="tab-qr"
          tabIndex={activeTab === 'qr' ? 0 : -1}
          aria-selected={activeTab === 'qr'}
          aria-controls="panel-qr"
          onKeyDown={(event) => handleTabKeyDown(event, 0)}
          onClick={() => setActiveTab('qr')}
          className={`flex min-h-12 min-w-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-start text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 ${activeTab === 'qr' ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary-ink)]' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'}`}
        >
          <QrCode size={18} className="shrink-0" aria-hidden="true" />
          <span>{t('الربط التجريبي عبر QR', 'Test connection via QR')}</span>
        </button>
        <button
          type="button"
          role="tab"
          id="tab-cloud"
          tabIndex={activeTab === 'cloud' ? 0 : -1}
          aria-selected={activeTab === 'cloud'}
          aria-controls="panel-cloud"
          onKeyDown={(event) => handleTabKeyDown(event, 1)}
          onClick={() => setActiveTab('cloud')}
          className={`flex min-h-12 min-w-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-start text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 ${activeTab === 'cloud' ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary-ink)]' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'}`}
        >
          <Cloud size={18} className="shrink-0" aria-hidden="true" />
          <span>{t('Cloud API الرسمي (Meta)', 'Official Cloud API (Meta)')}</span>
        </button>
        <button
          type="button"
          role="tab"
          id="tab-diag"
          tabIndex={activeTab === 'diag' ? 0 : -1}
          aria-selected={activeTab === 'diag'}
          aria-controls="panel-diag"
          onKeyDown={(event) => handleTabKeyDown(event, 2)}
          onClick={() => setActiveTab('diag')}
          className={`flex min-h-12 min-w-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-start text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 ${activeTab === 'diag' ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary-ink)]' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'}`}
        >
          <Activity size={18} className="shrink-0" aria-hidden="true" />
          <span>{t('فحص الاتصال', 'Connection diagnostics')}</span>
        </button>
      </div>

      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={tabId}
        tabIndex={0}
        className="min-w-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
      >
        {activeTab === 'qr' ? <WhatsAppQRPage /> : activeTab === 'cloud' ? <WhatsAppCloudPage /> : <WhatsAppDiagnostics />}
      </div>
    </div>
  );
}
