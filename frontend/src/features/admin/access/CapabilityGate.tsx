import { useState, type ReactNode } from 'react';
import { Clock3, Lock, ShieldCheck, ShieldQuestion, X } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { toast } from '../../../store/toast';
import { toAppError } from '../../../lib/supabase/errors';
import { useLocale } from '../../../i18n/useLocale';
import { useCancelCapabilityRequest, useCapabilityState, useRequestCapability } from './api';
import { CAPABILITY_BY_KEY, formatRemaining, type AdminCapability } from './capabilities';

interface Props {
  capability: AdminCapability;
  children: ReactNode;
  /** عنوان الشاشة المقفولة (افتراضيًا اسم القدرة). */
  title?: string;
}

/**
 * بيعرض المحتوى لو المشرف عنده القدرة، وإلا بيعرض بطاقة مقفولة فيها سبب
 * الحاجة وزر "اطلب من المالك" مع حالة الطلب (منتظر / موافق لمدة / مرفوض).
 */
export function CapabilityGate({ capability, children, title }: Props) {
  const { t, dir } = useLocale();
  const option = CAPABILITY_BY_KEY[capability];
  const state = useCapabilityState(true);
  const request = useRequestCapability();
  const cancel = useCancelCapabilityRequest();
  const [note, setNote] = useState('');

  if (state.isPending) {
    return (
      <Card>
        <p role="status" aria-live="polite" className="text-sm text-[var(--text-muted)]">
          {t('بنراجع صلاحياتك…', 'Checking your access…')}
        </p>
      </Card>
    );
  }

  const entry = state.data?.is_owner
    ? { allowed: true, granted_until: null, request: null }
    : state.data?.capabilities?.[capability] ?? null;

  if (entry?.allowed) return <>{children}</>;

  const pending = entry?.request?.status === 'pending';
  const rejected = entry?.request?.status === 'rejected';

  const submit = async () => {
    try {
      await request.mutateAsync({ capability, note: note.trim() || undefined });
      setNote('');
      toast.success(t('وصل طلبك للمالك. أول ما يوافق هتتفتح الصلاحية للمدة اللي يحددها.', 'Your request reached the owner. Access opens for the duration they choose once approved.'));
    } catch (cause) {
      toast.error(toAppError(cause, t('معرفناش نبعت الطلب.', 'Could not send the request.')).message);
    }
  };

  return (
    <div className="grid gap-4" dir={dir}>
      <Card>
        <div className="grid gap-5">
          <div className="flex items-start gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--primary-soft)] text-[var(--link)]" aria-hidden="true">
              <Lock size={22} />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-extrabold">{title ?? t(option.label, option.labelEn)}</h2>
              <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
                {t(option.description, option.descriptionEn)}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="text-sm font-bold">
              {t('الحاجة دي للمالك بس — لكن تقدر تطلبها منه لمدة محددة.', 'This stays with the owner, but you can request it for a limited time.')}
            </p>
            <p className="mt-1 text-xs leading-6 text-[var(--text-muted)]">
              {t('لما المالك يوافق، الصلاحية بتتفتح لك تلقائيًا وتقفل لوحدها بعد المدة اللي يحددها.', 'When the owner approves, access opens automatically and expires on its own after the duration they set.')}
            </p>
          </div>

          {pending && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--warning-border)] bg-[var(--warning-soft)] p-3 text-sm text-[var(--warning-text)]">
              <Clock3 size={17} aria-hidden="true" />
              <span className="font-bold">{t('طلبك مستني موافقة المالك.', 'Your request is waiting for the owner.')}</span>
              {entry?.request && (
                <Button
                  type="button"
                  variant="ghost"
                  icon={<X size={15} />}
                  isLoading={cancel.isPending}
                  onClick={() => { void cancel.mutateAsync(entry.request!.id); }}
                >
                  {t('إلغاء الطلب', 'Cancel request')}
                </Button>
              )}
            </div>
          )}

          {rejected && (
            <div className="rounded-xl border border-[var(--danger-border)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger-text)]">
              <p className="font-bold">{t('الطلب اتترفض.', 'The request was declined.')}</p>
              {entry?.request?.decided_note && <p className="mt-1 leading-6">{entry.request.decided_note}</p>}
            </div>
          )}

          {!pending && (
            <div className="grid gap-2">
              <label htmlFor={`capability-note-${capability}`} className="text-sm font-bold">
                {t('ليه محتاج الصلاحية؟ (اختياري)', 'Why do you need it? (optional)')}
              </label>
              <textarea
                id={`capability-note-${capability}`}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                maxLength={500}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-4 focus:ring-[var(--primary-soft)]"
                placeholder={t('مثال: محتاج أضيف مشرف جديد النهاردة.', 'Example: I need to add a new administrator today.')}
              />
              <div className="flex flex-wrap gap-2">
                <Button type="button" icon={<ShieldQuestion size={17} />} isLoading={request.isPending} loadingText={t('بنبعت…', 'Sending…')} onClick={() => void submit()}>
                  {t('اطلب الصلاحية من المالك', 'Request owner approval')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

/** شريط صغير بيوضح إن فيه صلاحية مؤقتة سارية. */
export function CapabilityBadge({ capability }: { capability: AdminCapability }) {
  const { t } = useLocale();
  const state = useCapabilityState(true);
  const entry = state.data?.capabilities?.[capability];
  if (!entry?.granted_until) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--success-border)] bg-[var(--success-soft)] px-3 py-1 text-xs font-bold text-[var(--success-text)]">
      <ShieldCheck size={14} aria-hidden="true" />
      {t(`مفتوحة مؤقتًا · باقي ${formatRemaining(entry.granted_until)}`, `Temporary access · ${formatRemaining(entry.granted_until)} left`)}
    </span>
  );
}
