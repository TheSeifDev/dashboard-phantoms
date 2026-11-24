import { ShieldCheck } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { Card } from '../../../components/ui/Card';
import { EmptyState } from '../../../components/ui/EmptyState';
import { toast } from '../../../store/toast';
import { toAppError } from '../../../lib/supabase/errors';
import { useLocale } from '../../../i18n/useLocale';
import { useCapabilityMatrix, useSetAdminCapability } from './api';
import { CAPABILITY_OPTIONS, type AdminCapability } from './capabilities';

/**
 * المالك بيمنح أو يسحب أي قدرة لأي مشرف بشكل مباشر ودائم، من غير طلبات ولا مدة.
 * القدرات دي هي اللي بتخلي المشرف يشوف ويعمل نفس حاجات المالك.
 */
export function AdminCapabilityMatrix() {
  const { t } = useLocale();
  const matrix = useCapabilityMatrix(true);
  const setCapability = useSetAdminCapability();
  const rows = (matrix.data ?? []).filter((entry) => entry.role !== 'owner');

  const toggle = async (userId: string, capability: AdminCapability, granted: boolean) => {
    try {
      await setCapability.mutateAsync({ userId, capability, granted });
      toast.success(granted
        ? t('الصلاحية اتفعلت للمشرف.', 'The capability is now enabled for this administrator.')
        : t('الصلاحية اتسحبت من المشرف.', 'The capability was removed from this administrator.'));
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نحفظ الصلاحية.', 'Could not save the capability.')).message);
    }
  };

  return (
    <Card className="grid gap-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <ShieldCheck size={18} aria-hidden="true" className="text-[var(--link)]" />
          <h2 className="text-sm font-extrabold">{t('صلاحيات المالك للمشرفين', 'Owner-level capabilities')}</h2>
        </div>
        <Badge variant="primary">{t('تحكم مباشر ودائم', 'Direct, permanent control')}</Badge>
      </div>
      <p className="text-xs leading-6 text-[var(--text-muted)]">
        {t('كل مشرف بيبدأ بصلاحيات المالك كاملة (زي ما بتشوف وتعمل بالظبط). اقفل اللي مش عايزه بس؛ القفل بيمنع الوصول فورًا.', 'Every administrator starts with full owner authority — the same visibility and actions you have. Switch off whatever you do not want; removal takes effect immediately.')}
      </p>
      {matrix.isLoading ? (
        <p className="text-xs text-[var(--text-muted)]">{t('جارٍ التحميل…', 'Loading…')}</p>
      ) : matrix.isError ? (
        <EmptyState title={t('تعذّر تحميل الصلاحيات', 'Could not load capabilities')} description={t('أعد المحاولة بعد لحظات.', 'Please try again in a moment.')} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('مفيش مشرفين غيرك', 'No other administrators')} description={t('ضيف مشرف من فوق عشان تتحكم في صلاحياته.', 'Add an administrator above to control their access.')} />
      ) : (
        <ul className="grid min-w-0 gap-3">
          {rows.map((entry) => (
            <li key={entry.user_id} className="grid min-w-0 gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
              <p className="break-all text-xs font-bold" dir="ltr">{entry.email}</p>
              <div className="flex min-w-0 flex-wrap gap-2">
                {CAPABILITY_OPTIONS.map((option) => {
                  const state = entry.capabilities?.[option.key];
                  const on = state?.allowed === true;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => void toggle(entry.user_id, option.key, !on)}
                      aria-pressed={on}
                      disabled={setCapability.isPending}
                      className={`min-h-9 rounded-lg border px-2.5 text-xs font-bold transition ${on
                        ? 'border-[var(--success-border,var(--border))] bg-[var(--success-soft)] text-[var(--success-text)]'
                        : 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]'}`}
                      title={t(option.description, option.descriptionEn)}
                    >
                      {on ? '✓ ' : ''}{t(option.label, option.labelEn)}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
