import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Cloud, Play, Square, Send, RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { useMembers } from '../members/api';
import { useTasks } from '../tasks/api';
import { getCloudStatus, setCloudEnabled, sendCloudTasks } from './api';

import { useLocale } from '../../i18n/useLocale';
export default function WhatsAppCloudPage() {
  const { t, number, dir } = useLocale();
  const [taskId, setTaskId] = useState('');
  const [memberIds, setMemberIds] = useState<number[]>([]);
  const [consent, setConsent] = useState(false);
  const [openModal, setOpenModal] = useState(false);

  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['cloud-status'], queryFn: getCloudStatus, retry: false });
  const tasks = useTasks();
  const members = useMembers();

  const toggleStatus = useMutation({
    mutationFn: setCloudEnabled,
    onSuccess: (data) => queryClient.setQueryData(['cloud-status'], data),
  });

  const dispatch = useMutation({
    mutationFn: () => sendCloudTasks(Number(taskId), memberIds, consent),
  });

  const task = tasks.data?.find((item) => String(item.id) === taskId);

  const eligible = useMemo(() => {
    if (!task || !members.data) return [];
    const assigned = task.assigned_to === 'ALL' ? null : new Set((Array.isArray(task.assigned_to) ? task.assigned_to : []).map(String));
    return members.data.filter((member) => member.phone?.trim() && (!assigned || assigned.has(String(member.id))) && member.work_status !== 'inactive');
  }, [members.data, task]);

  const toggleMember = (id: number) => {
    setMemberIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
  };

  const selectAll = () => setMemberIds(eligible.map((item) => item.id));
  const deselectAll = () => setMemberIds([]);

  return (
    <section className="grid gap-4" dir={dir}>
      <header className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--primary-soft)] text-[var(--link)]">
          <Cloud aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[var(--fs-xl)] font-black">{t('اتصال واتساب السحابي الرسمي', 'Official WhatsApp Cloud connection')}</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">{t('استخدم Meta Cloud API لإرسال إشعارات المهام بالقالب المعتمد، على دفعات تصل إلى 50 رسالة.', 'Use the official Meta Cloud API to send task notifications with the approved template, in batches of up to 50 messages.')}</p>
        </div>
      </header>

      <Card className={`grid gap-4 border-s-4 ${status.data?.enabled ? 'border-s-emerald-500' : status.data?.configured ? 'border-s-amber-500' : 'border-s-[var(--border)]'}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3" role="status" aria-live="polite">
            {status.isLoading ? (
              <span aria-hidden="true" className="mt-1 size-4 shrink-0 animate-pulse rounded-full bg-[var(--primary)]" />
            ) : status.data?.enabled ? (
              <CheckCircle2 className="mt-0.5 shrink-0 text-[var(--success-text)]" aria-hidden="true" />
            ) : (
              <AlertTriangle className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
            )}
            <div className="min-w-0">
              <p className="font-extrabold text-[var(--text)]">
                {status.isLoading
                  ? t('جارٍ التحقق من إعداد الخدمة…', 'Checking service setup…')
                  : status.data?.enabled
                    ? t('الخدمة مفعّلة', 'Service enabled')
                    : status.data?.configured
                      ? t('الخدمة متوقفة', 'Service stopped')
                      : t('إعداد الخدمة غير مكتمل', 'Service setup is incomplete')}
              </p>
              <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                {status.data?.templateName
                  ? <>{t('القالب المعتمد:', 'Approved template:')} <code dir="ltr" className="rounded bg-[var(--surface-2)] px-1">{status.data.templateName}</code></>
                  : status.isLoading
                    ? t('سيظهر وضع الخدمة بعد اكتمال الفحص.', 'The service state will appear after the check completes.')
                    : t('تحقق من إعدادات اتصال Meta على الخادم.', 'Check the Meta connection settings on the server.')}
              </p>
            </div>
          </div>
          {status.data?.configured && (
            <Button
              type="button"
              variant={status.data.enabled ? 'secondary' : 'primary'}
              icon={status.data.enabled ? <Square size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}
              disabled={toggleStatus.isPending || status.isLoading}
              isLoading={toggleStatus.isPending}
              loadingText={t('جارٍ تحديث الحالة…', 'Updating status…')}
              onClick={() => toggleStatus.mutate(!status.data?.enabled)}
              fullOnMobile
            >
              {status.data.enabled ? t('إيقاف الخدمة', 'Stop service') : t('تفعيل الخدمة', 'Enable service')}
            </Button>
          )}
        </div>

        {!status.data?.configured && !status.isLoading && status.data && (
          <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
            {t('إعدادات Cloud API غير مكتملة على الخادم. يحتاج المسؤول لإعداد WHATSAPP_ACCESS_TOKEN وباقي القيم المطلوبة في بيئة التشغيل.', 'Cloud API settings are incomplete on the server. An administrator must configure WHATSAPP_ACCESS_TOKEN and the remaining required runtime values.')}
          </p>
        )}

        {(status.isError || toggleStatus.isError) && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]">
            <span className="break-words">{status.isError ? status.error.message : toggleStatus.error?.message}</span>
            {status.isError && (
              <Button type="button" variant="secondary" icon={<RefreshCw size={15} aria-hidden="true" />} isLoading={status.isFetching} loadingText={t('جارٍ الفحص…', 'Checking…')} onClick={() => void status.refetch()} fullOnMobile>
                {t('إعادة فحص الحالة', 'Retry status check')}
              </Button>
            )}
          </div>
        )}
      </Card>

      <Card className="grid gap-4">
        <div className="grid gap-2">
          <label htmlFor="cloud-task-select" className="text-sm font-bold text-[var(--text)]">{t('المهمة', 'Task')}</label>
          <select
            id="cloud-task-select"
            className="min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            value={taskId}
            disabled={tasks.isLoading}
            onChange={(event) => { setTaskId(event.target.value); setMemberIds([]); dispatch.reset(); }}
          >
            <option value="">{t('اختر مهمة…', 'Select a task…')}</option>
            {(tasks.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
          {tasks.isLoading && <p role="status" aria-live="polite" className="text-sm text-[var(--text-muted)]">{t('جارٍ تحميل المهام…', 'Loading tasks…')}</p>}
        </div>

        {tasks.isError && (
          <p role="alert" className="text-sm text-[var(--danger)]">{t('تعذر تحميل المهام.', 'Could not load tasks.')}{' '}
            <button type="button" className="min-h-11 rounded px-1 font-bold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" onClick={() => void tasks.refetch()}>{t('إعادة المحاولة', 'Try again')}</button>
          </p>
        )}

        {!task && !tasks.isLoading && !tasks.isError && (
          <p className="rounded-xl bg-[var(--surface-2)] p-3 text-sm text-[var(--text-muted)]">{t('اختر مهمة لعرض الأعضاء المسندة إليهم فقط.', 'Select a task to see only its assigned members.')}</p>
        )}

        {task && (
          <>
            {members.isError ? (
              <p role="alert" className="text-sm text-[var(--danger)]">{t('تعذر تحميل قائمة الأعضاء.', 'Could not load the recipient list.')}{' '}
                <button type="button" className="min-h-11 rounded px-1 font-bold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" onClick={() => void members.refetch()}>{t('إعادة المحاولة', 'Try again')}</button>
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-black text-[var(--text)]">{t('المستلمون', 'Recipients')} <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs text-[var(--text-muted)]">{number(memberIds.length)} {t('محدد', 'selected')}</span></h3>
                  {eligible.length > 0 && <div className="flex flex-wrap gap-2">
                    <button type="button" className="min-h-11 rounded px-2 text-sm font-bold text-[var(--primary-ink)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" onClick={selectAll}>{t('تحديد الكل', 'Select all')}</button>
                    <button type="button" className="min-h-11 rounded px-2 text-sm text-[var(--text-muted)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" onClick={deselectAll}>{t('إلغاء التحديد', 'Clear selection')}</button>
                  </div>}
                </div>
                {members.isLoading ? (
                  <p role="status" aria-live="polite" className="rounded-xl bg-[var(--surface-2)] p-3 text-sm text-[var(--text-muted)]">{t('جارٍ تحميل المستلمين…', 'Loading recipients…')}</p>
                ) : !eligible.length ? (
                  <p className="rounded-xl border border-dashed border-[var(--border)] p-3 text-sm leading-6 text-[var(--text-muted)]">{t('لا يوجد عضو مؤهل مرتبط بالمهمة ولديه رقم هاتف صالح.', 'No eligible member assigned to this task has a valid phone number.')}</p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {eligible.map((member) => {
                      const selected = memberIds.includes(member.id);
                      return <button type="button" key={member.id} aria-pressed={selected} className={`flex min-h-[60px] min-w-0 items-center gap-3 rounded-xl border p-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 ${selected ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-2)]'}`} onClick={() => { toggleMember(member.id); dispatch.reset(); }}>
                        <span className="min-w-0 flex-1"><b className="block truncate text-sm text-[var(--text)]">{member.full_name}</b><small dir="ltr" className="mt-0.5 block truncate text-start text-xs text-[var(--text-muted)]">{member.phone}</small></span>
                        <span className="shrink-0 text-xs font-bold text-[var(--text-muted)]">{selected ? t('محدد', 'Selected') : t('اختيار', 'Select')}</span>
                      </button>;
                    })}
                  </div>
                )}
              </>
            )}

            <div className="grid gap-3 border-t border-[var(--border)] pt-4">
              <h3 className="font-black text-[var(--text)]">{t('3. مراجعة الإرسال الخارجي', '3. Review external send')}</h3>
              <Button type="button" icon={<Send size={17} aria-hidden="true" />} disabled={!status.data?.enabled || memberIds.length === 0 || dispatch.isPending} isLoading={dispatch.isPending} loadingText={t('جارٍ الإرسال…', 'Sending…')} onClick={() => setOpenModal(true)} fullOnMobile>{t('مراجعة وتأكيد الإرسال', 'Review and confirm send')} ({number(memberIds.length)})</Button>
              {!status.data?.enabled && <p className="rounded-lg bg-[var(--surface-2)] p-3 text-sm text-[var(--text-muted)]">{t('فعّل خدمة Meta Cloud API أولًا قبل بدء الإرسال.', 'Enable the Meta Cloud API service before sending.')}</p>}
              {dispatch.error && <p role="alert" className="flex items-start gap-2 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]"><AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden="true" /><span className="break-words">{dispatch.error.message}</span></p>}
              {dispatch.data && <div role="status" aria-live="polite" className="rounded-xl border border-[var(--border)] p-4 text-sm leading-6">
                <p className="mb-2 flex items-center gap-2 font-bold text-[var(--text)]"><CheckCircle2 size={18} className="text-[var(--success-text)]" aria-hidden="true" />{t('نتيجة الإرسال', 'Send result')}</p>
                <ul className="list-inside list-disc">
                  <li>{t('تم بنجاح:', 'Sent successfully:')} <b>{number(dispatch.data.sent)}</b></li>
                  <li>{t('لم ينجح:', 'Failed:')} <b>{number(dispatch.data.failed)}</b></li>
                  {dispatch.data.errors.length > 0 && <li className="break-words text-[var(--danger)]">{t('التفاصيل:', 'Details:')} {dispatch.data.errors.join('، ')}</li>}
                </ul>
              </div>}
            </div>
          </>
        )}
      </Card>

      <Modal isOpen={openModal} onClose={() => { setOpenModal(false); setConsent(false); }} title={t('مراجعة الإرسال عبر Meta Cloud API', 'Review Meta Cloud API send')} subtitle={t(`لـ ${number(memberIds.length)} مستلم للمهمة «${task?.title}»`, `To ${number(memberIds.length)} recipients for task “${task?.title}”`)} maxWidth="lg">
        <div className="grid gap-4">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm leading-6">
            <p>{t('سيُرسل قالب واتساب المعتمد', 'The approved WhatsApp template')} <bdi dir="ltr" className="font-bold">{status.data?.templateName || 'phantoms_task_assignment'}</bdi> {t('إلى المستلمين المحددين عبر Meta Cloud API.', 'to the selected recipients through the Meta Cloud API.')}</p>
          </div>
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <p><strong>{t('هذا إرسال خارجي فعلي.', 'This is an external send.')}</strong> {t('لن يبدأ إلا بعد تأكيدك النهائي. تحقق من أرقام المستلمين وموافقتهم قبل المتابعة.', 'It will not start until your final confirmation. Verify recipient numbers and consent before continuing.')}</p>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--border)] p-3 text-sm leading-6">
            <input type="checkbox" className="mt-1 size-5 shrink-0 accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            <span>{t('أؤكد أن المستلمين وافقوا مسبقًا على استقبال رسائل واتساب، وأن محتوى الرسائل يخص المهام المسندة إليهم فقط.', 'I confirm that recipients previously consented to WhatsApp messages and that the message content is limited to tasks assigned to them.')}</span>
          </label>
          <div className="flex flex-col-reverse gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => { setOpenModal(false); setConsent(false); }} fullOnMobile>{t('إلغاء', 'Cancel')}</Button>
            <Button type="button" variant="danger" disabled={!consent || dispatch.isPending} icon={<Send size={16} aria-hidden="true" />} isLoading={dispatch.isPending} loadingText={t('جارٍ الإرسال…', 'Sending…')} onClick={() => { dispatch.mutate(); setOpenModal(false); }} fullOnMobile>{t('تأكيد الإرسال الخارجي', 'Confirm external send')}</Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
