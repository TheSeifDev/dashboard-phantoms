import { useState } from 'react';
import { Check, Clock3, ShieldCheck, X } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { EmptyState } from '../../../components/ui/EmptyState';
import { toast } from '../../../store/toast';
import { toAppError } from '../../../lib/supabase/errors';
import { useLocale } from '../../../i18n/useLocale';
import { useCapabilityInbox, useDecideCapabilityRequest, useRevokeCapabilityGrant } from './api';
import { CAPABILITY_BY_KEY, CAPABILITY_DURATIONS, formatRemaining } from './capabilities';

function formatWhen(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/**
 * صندوق المالك: طلبات المشرفين على الصلاحيات الحساسة + المنح السارية.
 * الموافقة بتكون بمدة محددة وبعدها الصلاحية بتقفل لوحدها.
 */
export function OwnerCapabilityPanel() {
  const { t, dir, number } = useLocale();
  const dateLocale = dir === 'rtl' ? 'ar-EG' : 'en-GB';
  const inbox = useCapabilityInbox(true);
  const decide = useDecideCapabilityRequest();
  const revoke = useRevokeCapabilityGrant();
  const [durations, setDurations] = useState<Record<number, number>>({});

  const pending = (inbox.data?.requests ?? []).filter((entry) => entry.status === 'pending');
  const decided = (inbox.data?.requests ?? []).filter((entry) => entry.status !== 'pending').slice(0, 6);
  const grants = inbox.data?.grants ?? [];

  const act = async (requestId: number, approve: boolean) => {
    try {
      await decide.mutateAsync({ requestId, approve, minutes: durations[requestId] ?? 1440 });
      toast.success(approve
        ? t('اتفتحت الصلاحية للمشرف للمدة المحددة.', 'Access was granted for the selected duration.')
        : t('الطلب اتترفض.', 'The request was declined.'));
    } catch (cause) {
      toast.error(toAppError(cause, t('معرفناش نحفظ القرار.', 'Could not save the decision.')).message);
    }
  };

  return (
    <Card>
      <div className="grid gap-4" dir={dir}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="grid size-10 place-items-center rounded-xl bg-[var(--warning-soft)] text-[var(--warning-text)]" aria-hidden="true">
              <ShieldCheck size={19} />
            </span>
            <div>
              <h2 className="text-base font-extrabold">{t('طلبات صلاحيات المشرفين', 'Administrator access requests')}</h2>
              <p className="text-xs leading-5 text-[var(--text-muted)]">
                {t('الموافقة بتفتح الصلاحية للمدة اللي تختارها وبعدها بتقفل لوحدها.', 'Approval opens the capability for the duration you pick, then it closes on its own.')}
              </p>
            </div>
          </div>
          {pending.length > 0 && (
            <Badge variant="warning">{t(`${number(pending.length)} طلب مستني`, `${number(pending.length)} waiting`)}</Badge>
          )}
        </div>

        {inbox.isPending && (
          <p role="status" aria-live="polite" className="text-sm text-[var(--text-muted)]">{t('بنحمّل الطلبات…', 'Loading requests…')}</p>
        )}

        {!inbox.isPending && pending.length === 0 && (
          <EmptyState
            title={t('مفيش طلبات جديدة', 'No new requests')}
            description={t('أي مشرف يحاول يستخدم صلاحية من صلاحياتك هيوصلك طلب هنا.', 'Any administrator who needs one of your capabilities will send a request here.')}
          />
        )}

        {pending.map((entry) => {
          const option = CAPABILITY_BY_KEY[entry.capability];
          return (
            <article key={entry.id} className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-all text-sm font-extrabold" dir="ltr">{entry.email}</p>
                  <p className="mt-1 text-sm font-bold">{t(option?.label ?? entry.capability, option?.labelEn ?? entry.capability)}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{formatWhen(entry.requested_at, dateLocale)}</p>
                </div>
                <Badge variant="warning">{t('مستني قرارك', 'Awaiting you')}</Badge>
              </div>
              {entry.note && (
                <p className="rounded-lg bg-[var(--surface)] p-3 text-sm leading-6">{entry.note}</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor={`duration-${entry.id}`} className="text-xs font-bold text-[var(--text-muted)]">{t('المدة', 'Duration')}</label>
                <select
                  id={`duration-${entry.id}`}
                  value={durations[entry.id] ?? 1440}
                  onChange={(event) => setDurations((current) => ({ ...current, [entry.id]: Number(event.target.value) }))}
                  className="min-h-10 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm focus:border-[var(--primary)] focus:outline-none focus:ring-4 focus:ring-[var(--primary-soft)]"
                >
                  {CAPABILITY_DURATIONS.map((duration) => (
                    <option key={duration.minutes} value={duration.minutes}>{t(duration.label, duration.labelEn)}</option>
                  ))}
                </select>
                <Button type="button" icon={<Check size={16} />} isLoading={decide.isPending} onClick={() => void act(entry.id, true)}>
                  {t('وافق وافتح', 'Approve')}
                </Button>
                <Button type="button" variant="secondary" icon={<X size={16} />} disabled={decide.isPending} onClick={() => void act(entry.id, false)}>
                  {t('رفض', 'Decline')}
                </Button>
              </div>
            </article>
          );
        })}

        {grants.length > 0 && (
          <div className="grid gap-2">
            <h3 className="text-sm font-extrabold">{t('صلاحيات مفتوحة دلوقتي', 'Currently open access')}</h3>
            {grants.map((grant) => {
              const option = CAPABILITY_BY_KEY[grant.capability];
              return (
                <div key={grant.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
                  <div className="min-w-0">
                    <p className="break-all text-sm font-bold" dir="ltr">{grant.email}</p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {t(option?.label ?? grant.capability, option?.labelEn ?? grant.capability)}
                      {' · '}
                      <span className="inline-flex items-center gap-1">
                        <Clock3 size={12} aria-hidden="true" />
                        {t(`باقي ${formatRemaining(grant.expires_at)}`, `${formatRemaining(grant.expires_at)} left`)}
                      </span>
                    </p>
                  </div>
                  <Button type="button" variant="ghost" disabled={revoke.isPending} onClick={() => { void revoke.mutateAsync(grant.id); }}>
                    {t('اسحب الصلاحية', 'Revoke')}
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {decided.length > 0 && (
          <div className="grid gap-1">
            <h3 className="text-sm font-extrabold">{t('آخر القرارات', 'Recent decisions')}</h3>
            {decided.map((entry) => {
              const option = CAPABILITY_BY_KEY[entry.capability];
              return (
                <p key={entry.id} className="text-xs leading-6 text-[var(--text-muted)]">
                  <span dir="ltr">{entry.email}</span>
                  {' · '}
                  {t(option?.label ?? entry.capability, option?.labelEn ?? entry.capability)}
                  {' · '}
                  {entry.status === 'approved' ? t('موافقة', 'Approved') : entry.status === 'rejected' ? t('مرفوض', 'Declined') : t('ملغي', 'Cancelled')}
                  {entry.decided_at ? ` · ${formatWhen(entry.decided_at, dateLocale)}` : ''}
                </p>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
