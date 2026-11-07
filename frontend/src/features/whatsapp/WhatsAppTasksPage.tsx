import { useState } from 'react';
import { Activity, Cloud, QrCode, ShieldAlert } from 'lucide-react';
import WhatsAppCloudPage from './WhatsAppCloudPage';
import WhatsAppDiagnostics from './WhatsAppDiagnostics';
import WhatsAppQRPage from './WhatsAppQRPage';

type TabKey = 'qr' | 'cloud' | 'diag';

export default function WhatsAppTasksPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('qr');

  return (
    <div className="grid gap-6" dir="rtl">
      {/* خطوات الإرسال */}
      <ol aria-label="خطوات إرسال المهام" className="grid gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 text-sm font-bold sm:grid-cols-3">
        <li className="flex items-center gap-2"><span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--primary)] text-xs font-black text-white">1</span> الربط والتفعيل</li>
        <li className="flex items-center gap-2"><span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--primary-soft)] text-xs font-black text-[var(--link)]">2</span> اختيار الأعضاء والمهام</li>
        <li className="flex items-center gap-2"><span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--primary-soft)] text-xs font-black text-[var(--link)]">3</span> الإرسال والتأكيد</li>
      </ol>
      {/* Policy and Ban Risk Disclaimer Banner */}
      <section
        role="alert"
        aria-label="تنبيه سياسات واتساب والأمان"
        className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200"
      >
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" size={20} aria-hidden="true" />
          <div className="text-sm leading-6">
            <h2 className="text-base font-bold">تنبيه بخصوص سياسات واتساب واحتمال حظر الحساب</h2>
            <p className="mt-1">
              طريقة الربط عن طريق QR باستخدام مكتبات الويب (زي Baileys) مش رسمية ومش معتمدة من Meta، واستخدامها في البعت التلقائي ممكن يعرّض رقم التليفون للحظر والإيقاف النهائي حسب سياسات WhatsApp Business.
            </p>
            <p className="mt-1">
              التبويب ده معمول كنموذج تجريبي منفصل للاختبار الإداري الداخلي بس. لو عايز تبعت إشعارات موثوقة في بيئة التشغيل الفعلية، استخدم تبويب <strong>الربط السحابي الرسمي (Meta Cloud API)</strong>.
            </p>
          </div>
        </div>
      </section>

      {/* Tab Navigation */}
      <div className="flex gap-2 overflow-x-auto border-b border-[var(--border)]" role="tablist" aria-label="طرق ربط واتساب">
        <button
          type="button"
          role="tab"
          id="tab-qr"
          aria-selected={activeTab === 'qr'}
          aria-controls="panel-qr"
          onClick={() => setActiveTab('qr')}
          className={`flex min-h-[44px] items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-bold transition-colors ${
            activeTab === 'qr'
              ? 'border-[var(--primary)] text-[var(--primary)]'
              : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
          }`}
        >
          <QrCode size={18} aria-hidden="true" />
          <span>الربط التجريبي عن طريق QR (Baileys Mock)</span>
        </button>
        <button
          type="button"
          role="tab"
          id="tab-cloud"
          aria-selected={activeTab === 'cloud'}
          aria-controls="panel-cloud"
          onClick={() => setActiveTab('cloud')}
          className={`flex min-h-[44px] items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-bold transition-colors ${
            activeTab === 'cloud'
              ? 'border-[var(--primary)] text-[var(--primary)]'
              : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
          }`}
        >
          <Cloud size={18} aria-hidden="true" />
          <span>الربط السحابي الرسمي (Meta Cloud API)</span>
        </button>
        <button
          type="button"
          role="tab"
          id="tab-diag"
          aria-selected={activeTab === 'diag'}
          aria-controls="panel-diag"
          onClick={() => setActiveTab('diag')}
          className={`flex min-h-[44px] items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-bold transition-colors ${
            activeTab === 'diag'
              ? 'border-[var(--primary)] text-[var(--primary)]'
              : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
          }`}
        >
          <Activity size={18} aria-hidden="true" />
          <span>الفحص بالتفصيل</span>
        </button>
      </div>

      {/* Tab Content Panels */}
      <div id={activeTab === 'qr' ? 'panel-qr' : activeTab === 'cloud' ? 'panel-cloud' : 'panel-diag'} role="tabpanel" aria-labelledby={activeTab === 'qr' ? 'tab-qr' : activeTab === 'cloud' ? 'tab-cloud' : 'tab-diag'}>
        {activeTab === 'qr' ? <WhatsAppQRPage /> : activeTab === 'cloud' ? <WhatsAppCloudPage /> : <WhatsAppDiagnostics />}
      </div>
    </div>
  );
}
