import { useState, useEffect } from 'react';
import { Users, User, Send, AlertCircle } from 'lucide-react';
import AnnouncementsAPI from '../../../lib/api/announcements';
import { supabase } from '../../../lib/supabase/client';
import type { AnnouncementInsert, AnnouncementPriority } from '../../../types/db';
import { sendWhatsAppAnnouncement } from '../../whatsapp/api';
import { sendPushNotification } from '../../../lib/api/push';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { toast } from '../../../store/toast';

interface CreateAnnouncementModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

const fieldLabel = 'grid gap-1.5 text-sm font-bold text-[var(--text-2)]';
const fieldInput =
  'min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm text-[var(--text)] focus:border-[var(--primary)] focus:outline-none';
const checkInput = 'size-5 shrink-0 accent-[var(--primary)]';

export default function CreateAnnouncementModal({
  onClose,
  onSuccess,
}: CreateAnnouncementModalProps) {
  const [formData, setFormData] = useState<AnnouncementInsert>({
    title: '',
    content: '',
    target_audience: { type: 'all' },
    priority: 'normal',
    send_push: true,
    send_whatsapp: false,
    expires_at: null,
    is_active: true,
    created_by: null
  });

  const [members, setMembers] = useState<Array<{ id: number; full_name: string; email: string; residence: string | null }>>([]);
  const [selectedMembers, setSelectedMembers] = useState<number[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);

  // جلب قائمة الأعضاء عند اختيار "أعضاء محددين"
  const loadMembers = async () => {
    if (formData.target_audience.type !== 'specific') return;

    try {
      setMembersLoading(true);
      const { data, error: membersError } = await supabase
        .from('members')
        .select('id, full_name, email, residence')
        .order('full_name');

      if (membersError) throw membersError;
      setMembers(data ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'معرفناش نحمّل الأعضاء.');
    } finally {
      setMembersLoading(false);
    }
  };

  useEffect(() => {
    void loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.target_audience.type]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.title.trim() || !formData.content.trim()) {
      setError('اكتب كل البيانات المطلوبة');
      return;
    }

    if (formData.target_audience.type === 'specific' && selectedMembers.length === 0) {
      setError('اختار عضو واحد على الأقل');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const dataToSubmit: AnnouncementInsert = {
        ...formData,
        target_audience: formData.target_audience.type === 'specific'
          ? { type: 'specific', member_ids: selectedMembers }
          : { type: 'all' },
        expires_at: formData.expires_at || null
      };

      const created = await AnnouncementsAPI.createAnnouncement(dataToSubmit);
      let mIds = dataToSubmit.target_audience.type === 'specific' ? selectedMembers : members.map(m => m.id);
      if (dataToSubmit.target_audience.type !== 'specific' && mIds.length === 0) {
        // قائمة الأعضاء لا تُحمّل في وضع "الكل" — اجلب المعرفات للـ Push فقط
        try {
          const { data: allMembers, error: allMembersError } = await supabase.from('members').select('id').limit(500);
          if (allMembersError) throw allMembersError;
          mIds = (allMembers ?? []).map((m: { id: number }) => m.id);
        } catch {
          mIds = [];
        }
        if (mIds.length === 0) {
          throw new Error('معرفناش نحدد الأعضاء اللي هيوصلهم الإعلان (القائمة فاضية) — اعمل إعادة تحميل للصفحة وجرّب تاني.');
        }
      }

      if (dataToSubmit.send_push) {
        try {
          // push-notify حدها 50 عضو للطلب — نقسم الدفعات ونجمع النتيجة
          // (الدالة تُرجع 200 حتى مع sent=0، فلا بد من قراءة الأرقام لا الاكتفاء بعدم الخطأ)
          let pushSent = 0;
          let pushFailed = 0;
          let pushNote = '';
          for (let i = 0; i < mIds.length; i += 50) {
            const chunk = mIds.slice(i, i + 50);
            const res = await sendPushNotification(dataToSubmit.title, dataToSubmit.content.substring(0, 100), chunk, '/announcements') as { sent?: number; failed?: number; message?: string } | null;
            pushSent += Number(res?.sent ?? 0);
            pushFailed += Number(res?.failed ?? 0);
            if (typeof res?.message === 'string' && res.message && !pushNote) pushNote = res.message;
          }
          if (pushSent > 0 && pushFailed === 0) {
            toast.success(`الإشعار الفوري وصل لـ ${pushSent} عضو.`);
          } else if (pushSent > 0) {
            toast.warning(`الإشعار الفوري وصل لـ ${pushSent} عضو ومجاش لـ ${pushFailed}.`);
          } else if (pushFailed > 0) {
            toast.error(`الإشعار الفوري موصلش لأي عضو (${pushFailed}). ${pushNote}`);
          } else {
            toast.warning(pushNote || 'مفيش أعضاء مفعّلين للإشعارات الفورية — اطلب من الأعضاء يفعّلوها من بوابتهم وبعدين ابعت الإعلان تاني.');
          }
        } catch (pushErr) {
          toast.error('الإشعارات ما اتبعتتش: ' + (pushErr instanceof Error ? pushErr.message : ''));
        }
      }

      if (dataToSubmit.send_whatsapp) {
        try {
          const waResult = await sendWhatsAppAnnouncement(created.id, mIds);
          const sent = waResult?.sent ?? 0;
          const failed = waResult?.failed ?? 0;
          const waErrors = Array.isArray(waResult?.errors) ? waResult.errors.slice(0, 10) : [];
          // وثّق نتيجة الإرسال على صف الإعلان حتى تظهر في "الإحصائيات" لاحقاً
          try {
            await AnnouncementsAPI.updateAnnouncement(created.id, {
              whatsapp_sent_at: new Date().toISOString(),
              whatsapp_sent_count: sent,
              whatsapp_errors: waErrors,
            } as Partial<AnnouncementInsert>);
          } catch {
            // توثيق النتيجة ثانوي — لا يحجب رسالة النتيجة نفسها
          }
          if (sent > 0 && failed === 0) {
            toast.success(`الإعلان اتم نشره واتبعث على واتساب لـ ${sent} عضو بنجاح.`);
          } else if (sent > 0) {
            toast.warning(`الإعلان اتم نشره، وواتساب وصل لـ ${sent} عضو ومجاش لـ ${failed}. راجع "الإحصائيات" للتفاصيل: ${waErrors.slice(0, 2).join('؛ ')}`);
          } else {
            toast.error(`الإعلان اتم نشره، بس رسالة الواتساب موصلتش لأي عضو (فشل ${failed}). السبب: ${waErrors.slice(0, 2).join('؛ ') || 'مش معروف — راجع اتصال الواتساب وأرقام التليفونات.'}`);
          }
        } catch (whatsappErr) {
          toast.error('الإعلان اتم نشره بنجاح، بس حصلت مشكلة وإحنا بنبعت على واتساب: ' + (whatsappErr instanceof Error ? whatsappErr.message : ''));
        }
      } else {
        toast.success('الإعلان اتم نشره بنجاح.');
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حصلت مشكلة مش معروفة');
    } finally {
      setLoading(false);
    }
  };

  const handleTargetAudienceChange = (type: 'all' | 'specific') => {
    setFormData((prev) => ({
      ...prev,
      target_audience: type === 'specific' ? { type, member_ids: selectedMembers } : { type },
    }));
    setSelectedMembers([]);
    setMemberSearch('');
  };

  const handleMemberToggle = (memberId: number) => {
    setSelectedMembers(prev =>
      prev.includes(memberId)
        ? prev.filter(id => id !== memberId)
        : [...prev, memberId]
    );
  };

  const visibleMembers = members.filter((m) => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return true;
    return m.full_name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
  });

  return (
    <Modal isOpen onClose={onClose} title="اعمل إعلان جديد" maxWidth="lg">
      <form onSubmit={handleSubmit} className="grid gap-4" dir="rtl" noValidate>
        {error && (
          <p className="flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-bold text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-100" role="alert">
            <AlertCircle size={20} aria-hidden="true" className="shrink-0" />
            <span>{error}</span>
          </p>
        )}

        {/* العنوان */}
        <label className={fieldLabel}>عنوان الإعلان *
          <input
            type="text"
            value={formData.title}
            onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
            className={fieldInput}
            placeholder="اكتب عنوان الإعلان"
            required
          />
        </label>

        {/* المحتوى */}
        <label className={fieldLabel}>نص الإعلان *
          <textarea
            value={formData.content}
            onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
            rows={4}
            className={`${fieldInput} min-h-24 p-3 leading-6`}
            placeholder="اكتب محتوى الإعلان هنا..."
            required
          />
        </label>

        {/* الأولوية */}
        <label className={fieldLabel}>درجة الأولوية
          <select
            value={formData.priority}
            onChange={(e) => setFormData((prev) => ({ ...prev, priority: e.target.value as AnnouncementPriority }))}
            className={fieldInput}
          >
            <option value="low">منخفضة</option>
            <option value="normal">عادية</option>
            <option value="high">عالية</option>
            <option value="urgent">عاجلة</option>
          </select>
        </label>

        {/* الجمهور المستهدف */}
        <fieldset className="grid gap-3">
          <legend className="text-sm font-bold text-[var(--text-2)]">الجمهور المستهدف</legend>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-[var(--border)] px-3">
            <input
              type="radio"
              name="audience"
              checked={formData.target_audience.type === 'all'}
              onChange={() => handleTargetAudienceChange('all')}
              className={checkInput}
            />
            <span className="flex items-center gap-2 text-sm font-bold">
              <Users size={20} className="text-[var(--link)]" aria-hidden="true" />
              كل الأعضاء
            </span>
          </label>

          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-[var(--border)] px-3">
            <input
              type="radio"
              name="audience"
              checked={formData.target_audience.type === 'specific'}
              onChange={() => handleTargetAudienceChange('specific')}
              className={checkInput}
            />
            <span className="flex items-center gap-2 text-sm font-bold">
              <User size={20} className="text-[var(--link)]" aria-hidden="true" />
              أعضاء معينين
            </span>
          </label>

          {/* قائمة الأعضاء المحددين */}
          {formData.target_audience.type === 'specific' && (
            <div className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
              <label className="block">
                <span className="sr-only">دور على عضو</span>
                <input
                  type="search"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder="دور بالاسم أو الإيميل..."
                  className={fieldInput}
                />
              </label>
              {membersLoading ? (
                <p className="py-4 text-center text-sm text-[var(--text-muted)]" role="status">بنحمّل الأعضاء...</p>
              ) : members.length === 0 ? (
                <p className="py-4 text-center text-[var(--text-muted)]">مفيش أعضاء متاحين</p>
              ) : (
                <div className="grid gap-1">
                  <p className="border-b border-[var(--border)] pb-2 text-sm font-bold text-[var(--text-2)]">
                    اختار الأعضاء ({selectedMembers.length} متحدد)
                  </p>
                  <div className="grid max-h-60 gap-1 overflow-y-auto">
                    {visibleMembers.map((member) => (
                      <label
                        key={member.id}
                        className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-[var(--surface-2)]"
                      >
                        <input
                          type="checkbox"
                          checked={selectedMembers.includes(member.id)}
                          onChange={() => handleMemberToggle(member.id)}
                          className={checkInput}
                          aria-label={`اختار ${member.full_name}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-bold">{member.full_name}</span>
                          <span className="block truncate text-sm text-[var(--text-muted)]" dir="ltr">
                            {member.email}{member.residence ? ` • ${member.residence}` : ''}
                          </span>
                        </span>
                      </label>
                    ))}
                    {visibleMembers.length === 0 && (
                      <p className="py-4 text-center text-sm text-[var(--text-muted)]">مفيش نتائج مطابقة للبحث.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </fieldset>

        {/* خيارات الإرسال */}
        <fieldset className="grid gap-3">
          <legend className="text-sm font-bold text-[var(--text-2)]">طرق الإرسال</legend>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-[var(--border)] px-3 text-sm font-bold">
            <input
              type="checkbox"
              checked={formData.send_push}
              onChange={(e) => setFormData(prev => ({ ...prev, send_push: e.target.checked }))}
              className={checkInput}
            />
            إشعار فوري في التطبيق
          </label>

          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-[var(--border)] px-3 text-sm font-bold">
            <input
              type="checkbox"
              checked={formData.send_whatsapp}
              onChange={(e) => setFormData(prev => ({ ...prev, send_whatsapp: e.target.checked }))}
              className={checkInput}
            />
            رسالة واتساب
          </label>
        </fieldset>

        {/* تاريخ الانتهاء (اختياري) */}
        <label className={fieldLabel}>تاريخ انتهاء الصلاحية (اختياري)
          <input
            type="datetime-local"
            value={formData.expires_at || ''}
            onChange={(e) => setFormData(prev => ({ ...prev, expires_at: e.target.value || null }))}
            className={fieldInput}
          />
          <span className="text-xs font-semibold text-[var(--text-muted)]">
            سيبه فاضي لو الإعلان دائم
          </span>
        </label>

        {/* أزرار الإجراءات */}
        <div className="flex flex-col-reverse gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            fullOnMobile
          >
            إلغاء
          </Button>
          <Button
            type="submit"
            isLoading={loading}
            loadingText="بننشر..."
            icon={<Send size={16} aria-hidden="true" />}
            fullOnMobile
          >
            انشر الإعلان
          </Button>
        </div>
      </form>
    </Modal>
  );
}

