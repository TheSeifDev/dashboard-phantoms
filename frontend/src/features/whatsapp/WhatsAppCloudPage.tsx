import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Cloud, Play, Square, Send } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { useMembers } from '../members/api';
import { useTasks } from '../tasks/api';
import { getCloudStatus, setCloudEnabled, sendCloudTasks } from './api';

export default function WhatsAppCloudPage() {
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

  return <section className="grid gap-4" dir="rtl">
    <header className="flex items-start gap-3">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--primary-soft)] text-[var(--link)]">
        <Cloud />
      </span>
      <div>
        <h2 className="text-[var(--fs-xl)] font-black">ربط واتساب السحابي (الرسمي)</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">استخدم Meta Cloud API عشان تبعت الإشعارات بشكل رسمي ومعتمد وعلى دفعات (لحد 50 رسالة).</p>
      </div>
    </header>

    <Card className={`grid gap-4 border-s-4 ${status.data?.enabled ? 'border-s-emerald-500' : 'border-s-[var(--text-muted)]'}`}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 font-extrabold">
          {status.isLoading ? 'بنراجع...' : status.data?.enabled ? <CheckCircle2 className="text-emerald-600" /> : <AlertTriangle className="text-amber-600" />}
          <span>
            {status.isLoading ? '' : !status.data?.configured ? 'الخدمة مش مجهزة' : status.data.enabled ? 'الخدمة مفعلة وجاهزة للبعت' : 'الخدمة واقفة دلوقتي'}
          </span>
        </div>
        {status.data?.configured && <Button
          variant={status.data.enabled ? 'secondary' : 'primary'}
          icon={status.data.enabled ? <Square size={17} /> : <Play size={17} />}
          disabled={toggleStatus.isPending}
          onClick={() => toggleStatus.mutate(!status.data.enabled)}
        >
          {status.data.enabled ? 'وقف البوت' : 'فعّل البوت'}
        </Button>}
      </div>
      {!status.data?.configured && !status.isLoading && <p className="text-sm leading-6 text-[var(--text-muted)]">إعدادات Cloud API مش كاملة على السيرفر (Edge Function). اتأكد من إعداد <code>WHATSAPP_ACCESS_TOKEN</code> والباقي حسب دليل التشغيل.</p>}
      {status.isError && <p role="alert" className="text-sm text-[var(--danger)]">{status.error.message}</p>}
      {toggleStatus.isError && <p role="alert" className="text-sm text-[var(--danger)]">{toggleStatus.error.message}</p>}
    </Card>

    <Card className="grid gap-4">
      <label className="grid gap-2 text-sm font-bold">اختار المهمة
        <select className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base" value={taskId} onChange={(event) => { setTaskId(event.target.value); setMemberIds([]); dispatch.reset(); }}>
          <option value="">اختار مهمة...</option>{(tasks.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
      </label>
      
      {tasks.isError && <p role="alert" className="text-sm text-[var(--danger)]">منعرفناش نحمّل المهام. <button className="underline" onClick={() => void tasks.refetch()}>جرّب تاني</button></p>}
      
      {task && <>
        <div className="flex items-center justify-between">
          <h3 className="font-black">اختار الأعضاء عشان تبعت لهم ({memberIds.length} محدد)</h3>
          {eligible.length > 0 && <div className="flex gap-2">
            <button type="button" className="text-sm text-[var(--primary)] font-bold hover:underline" onClick={selectAll}>تحديد الكل</button>
            <button type="button" className="text-sm text-[var(--text-muted)] hover:underline" onClick={deselectAll}>إلغاء التحديد</button>
          </div>}
        </div>
        
        {members.isLoading ? <p role="status" className="text-sm text-[var(--text-muted)]">بنحمّل الأعضاء...</p> : !eligible.length ? <p className="text-sm text-[var(--text-muted)]">مفيش عضو مكلف عنده رقم تليفون صالح.</p> : <div className="grid gap-2 sm:grid-cols-2">
          {eligible.map((member) => <button type="button" key={member.id} aria-pressed={memberIds.includes(member.id)} className={`flex min-h-12 items-center gap-3 rounded-xl border p-3 text-start ${memberIds.includes(member.id) ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : 'border-[var(--border)]'}`} onClick={() => { toggleMember(member.id); dispatch.reset(); }}>
            <span className="min-w-0 flex-1"><b className="block truncate text-sm">{member.full_name}</b><small dir="ltr" className="block text-start text-[var(--text-muted)]">{member.phone}</small></span>
            <span className="text-xs font-bold text-[var(--text-muted)]">{memberIds.includes(member.id) ? 'محدد' : 'اختيار'}</span>
          </button>)}
        </div>}
        
        <div className="grid gap-3 border-t border-[var(--border)] pt-4">
          <Button icon={<Send size={17} />} disabled={!status.data?.enabled || memberIds.length === 0} onClick={() => setOpenModal(true)} fullOnMobile>كمّل وراجع الإرسال</Button>
          {!status.data?.enabled && <p className="text-sm text-[var(--text-muted)]">لازم تفعّل البوت اللي فوق الأول عشان تقدر تبعت.</p>}
          
          {dispatch.error && <p role="alert" className="flex items-center gap-2 text-sm text-[var(--danger)]"><AlertTriangle size={17} />{dispatch.error.message}</p>}
          {dispatch.data && <div className="rounded-xl border border-[var(--border)] p-4 text-sm leading-6">
            <p className="font-bold text-[var(--text-2)] mb-2 flex items-center gap-2"><CheckCircle2 size={18} />نتيجة البعت:</p>
            <ul className="list-disc list-inside">
              <li>اتبعت بنجاح لـ: <b>{dispatch.data.sent}</b></li>
              <li>البعت فشل لـ: <b>{dispatch.data.failed}</b></li>
              {dispatch.data.errors.length > 0 && <li className="text-[var(--danger)]">الأخطاء: {dispatch.data.errors.join('، ')}</li>}
            </ul>
          </div>}
        </div>
      </>}
    </Card>

    <Modal isOpen={openModal} onClose={() => { setOpenModal(false); setConsent(false); }} title="أكد إرسال الدفعة" subtitle={`لـ ${memberIds.length} عضو بخصوص «${task?.title}»`} maxWidth="lg">
      <div className="grid gap-4">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm leading-6">
          <p>هيتبعت رسالة باستخدام القالب الرسمي <b>{status.data?.templateName || 'wasla_task_assignment'}</b> للأعضاء اللي اخترتهم.</p>
        </div>
        <label className="flex items-start gap-3 rounded-xl border border-amber-300 p-3 text-sm leading-6 dark:border-amber-900">
          <input type="checkbox" className="mt-1 size-5 shrink-0 accent-[var(--primary)]" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
          <span>بأكد إن الأعضاء دول وافقوا قبل كده على استلام رسائل واتساب، وإن المحتوى خاص بالمهام المتسندة لهم بس.</span>
        </label>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => { setOpenModal(false); setConsent(false); }} fullOnMobile>إلغاء</Button>
          <Button disabled={!consent || dispatch.isPending} icon={<Send size={16} />} onClick={() => { dispatch.mutate(); setOpenModal(false); }} fullOnMobile>
            {dispatch.isPending ? 'بنَبعت...' : 'ابدأ البعت'}
          </Button>
        </div>
      </div>
    </Modal>
  </section>;
}
