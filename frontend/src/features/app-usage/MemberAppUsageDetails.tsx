import { Smartphone } from 'lucide-react';
import { useLocale } from '../../i18n/useLocale';
import type { MemberAppUsage } from './api';

export type AppUsageStatus = 'checking' | 'unavailable' | 'ready';
export interface AppUsageDisplay {
  status: AppUsageStatus;
  usage?: MemberAppUsage;
}

export function MemberAppUsageDetails({ display, compact = false }: { display: AppUsageDisplay; compact?: boolean }) {
  const { t, date } = useLocale();
  const { status, usage } = display;
  const used = status === 'ready' && Boolean(usage);
  const stamp = (value: string) => date(value, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  // نوع الجهاز بييجي من السجل نفسه؛ من غير سجل مفيش نوع جهاز نعرضه.
  const platformLabel = usage?.platform === 'ios'
    ? t('تطبيق iOS', 'iOS app')
    : usage?.platform === 'android'
      ? t('تطبيق Android', 'Android app')
      : t('التطبيق', 'Mobile app');
  return (
    <section className="grid min-w-0 gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3" aria-label={t('استخدام التطبيق', 'App use')}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-bold text-[var(--text-muted)]"><Smartphone size={15} aria-hidden="true" />{platformLabel}</span>
        <span className={`rounded-md px-2 py-1 text-xs font-bold ${used ? 'bg-[var(--success-soft)] text-[var(--success-text)]' : 'text-[var(--text-2)]'}`}>
          {status === 'checking' ? t('جارٍ التحقق…', 'Checking…') : status === 'unavailable' ? t('المؤشر غير متاح', 'Usage unavailable') : used ? t('استخدم التطبيق', 'Used the app') : t('لم يُرصد استخدام التطبيق', 'No app use recorded')}
        </span>
      </div>
      {used && usage && <dl className="grid min-w-0 gap-1 text-xs leading-5 text-[var(--text-2)]">
        {!compact && <div className="flex flex-wrap justify-between gap-x-3"><dt>{t('أول استخدام', 'First use')}</dt><dd>{stamp(usage.first_used_at)}</dd></div>}
        <div className="flex flex-wrap justify-between gap-x-3"><dt>{t('آخر استخدام', 'Last use')}</dt><dd>{stamp(usage.last_used_at)}</dd></div>
        <div className="flex flex-wrap justify-between gap-x-3"><dt>{t('آخر إصدار مستخدم', 'Last version used')}</dt><dd dir="ltr">{usage.last_app_version} · {usage.last_app_build}</dd></div>
      </dl>}
      {!compact && <p className="text-xs leading-5 text-[var(--text-muted)]">{status === 'unavailable' ? t('تعذّر قراءة السجل. لا نعتبر ذلك عدم استخدام؛ أعد المحاولة من دليل الأعضاء.', 'The usage record could not be read. This does not mean no use; retry from the member directory.') : t('استخدام سابق أبلغ عنه التطبيق بعد الدخول. ليس إثباتًا أن التطبيق ما زال مثبتًا، أو تحققًا من مصدر الجهاز.', 'Prior use reported by the app after sign-in. Not proof of current installation or device attestation.')}</p>}
    </section>
  );
}
