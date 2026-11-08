import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Award, Check, Minus, Plus, Search, Users } from 'lucide-react';
import type { Member } from '../../types/db';
import {
  EVALUATION_GRADE_LABELS,
  useCreateEvaluations,
} from './api';
import type { EvaluationGrade } from './api';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { handleSupabaseError } from '../../lib/errorHandler';
import { toast } from '../../store/toast';
import { sendPushNotification } from '../../lib/api/push';

interface Props {
  isOpen: boolean;
  members: Member[];
  preselectedMemberId?: number | null;
  onClose: () => void;
}

const TITLE_PRESETS = [
  'تقييم الأداء الأسبوعي',
  'تقييم جودة تسليم المهام',
  'تقييم الالتزام والاجتماعات',
  'تقييم التعاون والمبادرة',
] as const;

const GRADES_ORDER: EvaluationGrade[] = [
  'excellent',
  'very_good',
  'good',
  'needs_improvement',
  'warning',
];

const POSITIVE_POINTS = [1, 2, 3, 5, 10] as const;
const NEGATIVE_POINTS = [-1, -2, -3, -5] as const;

export function EvaluationCreateModal({
  isOpen,
  members,
  preselectedMemberId,
  onClose,
}: Props) {
  const createEvaluations = useCreateEvaluations();

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [title, setTitle] = useState('تقييم الأداء الأسبوعي');
  const [grade, setGrade] = useState<EvaluationGrade>('very_good');
  const [points, setPoints] = useState<number>(0);
  const [feedback, setFeedback] = useState('');
  const [evaluatorName, setEvaluatorName] = useState('إدارة PHANTOMS');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      if (preselectedMemberId) {
        setSelectedIds([preselectedMemberId]);
      } else if (members.length > 0) {
        setSelectedIds([members[0].id]);
      } else {
        setSelectedIds([]);
      }
      setMemberSearch('');
      setTitle('تقييم الأداء الأسبوعي');
      setGrade('very_good');
      setPoints(0);
      setFeedback('');
      setError('');
    }
  }, [isOpen, preselectedMemberId, members]);

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.full_name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q),
    );
  }, [members, memberSearch]);

  const toggleMember = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const selectAllFiltered = () => {
    const ids = filteredMembers.map((m) => m.id);
    setSelectedIds((prev) => [...new Set([...prev, ...ids])]);
  };

  const clearSelection = () => {
    setSelectedIds([]);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    if (selectedIds.length === 0) {
      setError('اختر عضواً واحداً على الأقل لإرسال التقييم له.');
      return;
    }

    if (!title.trim()) {
      setError('اكتب عنوان التقييم.');
      return;
    }

    if (!feedback.trim()) {
      setError('اكتب تفاصيل التقييم والرسالة التي ستظهر للعضو في بوابته.');
      return;
    }

    const memberNamesMap: Record<number, string> = {};
    for (const m of members) {
      memberNamesMap[m.id] = m.full_name;
    }

    try {
      const count = await createEvaluations.mutateAsync({
        memberIds: selectedIds,
        memberNamesMap,
        title: title.trim(),
        grade,
        points,
        feedback: feedback.trim(),
        evaluatorName: evaluatorName.trim() || 'إدارة PHANTOMS',
      });
      for (let i = 0; i < selectedIds.length; i += 50) {
        const chunk = selectedIds.slice(i, i + 50);
        void sendPushNotification(
          `تقييم جديد: ${title.trim()}`,
          feedback.trim().slice(0, 120),
          chunk,
          '/portal',
        ).catch(() => {});
      }
      toast.success(
        count === 1
          ? 'تم إرسال التقييم للعضو بنجاح وهيظهر له فور دخوله.'
          : `تم إرسال التقييم لـ ${count} أعضاء بنجاح.`,
      );
      onClose();
    } catch (cause) {
      setError(handleSupabaseError(cause).message);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="إضافة تقييم جديد للأعضاء" maxWidth="lg">
      <form onSubmit={handleSubmit} className="grid gap-4 text-start" dir="rtl" noValidate>
        {error && (
          <p
            className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-bold text-red-900"
            role="alert"
          >
            {error}
          </p>
        )}

        {/* 1) اختيار الأعضاء */}
        <div className="grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-sm font-black text-[var(--text)]">
              <Users size={16} className="text-[var(--link)]" aria-hidden="true" />
              الأعضاء المستهدفون بالتقييم ({selectedIds.length})
            </span>
            <div className="flex items-center gap-2 text-xs font-bold">
              <button
                type="button"
                onClick={selectAllFiltered}
                className="text-[var(--link)] hover:underline"
              >
                تحديد الكل
              </button>
              <span className="text-[var(--text-muted)]">|</span>
              <button
                type="button"
                onClick={clearSelection}
                className="text-[var(--text-muted)] hover:text-[var(--text)]"
              >
                إلغاء التحديد
              </button>
            </div>
          </div>

          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute inset-y-0 start-3 my-auto text-[var(--text-muted)]"
              aria-hidden="true"
            />
            <input
              type="search"
              placeholder="ابحث عن عضو بالاسم..."
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              className="min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pe-3 ps-9 text-xs text-[var(--text)]"
            />
          </div>

          <div className="grid max-h-40 grid-cols-1 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
            {filteredMembers.map((m) => {
              const checked = selectedIds.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleMember(m.id)}
                  className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-start text-xs font-bold transition-colors ${
                    checked
                      ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--text)]'
                      : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)] hover:bg-[var(--bg)]'
                  }`}
                >
                  <span className="truncate">{m.full_name}</span>
                  {checked && <Check size={14} className="shrink-0 text-[var(--link)]" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* 2) عنوان التقييم */}
        <div className="grid gap-1.5">
          <label className="text-sm font-bold text-[var(--text)]" htmlFor="eval-title-input">
            عنوان التقييم *
          </label>
          <input
            id="eval-title-input"
            type="text"
            required
            placeholder="مثال: تقييم الأداء الأسبوعي"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm text-[var(--text)]"
          />
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {TITLE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setTitle(preset)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-bold transition-colors ${
                  title === preset
                    ? 'border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--link)]'
                    : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        {/* 3) التقدير العام */}
        <div className="grid gap-1.5">
          <span className="text-sm font-bold text-[var(--text)]">التقدير العام *</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {GRADES_ORDER.map((g) => {
              const active = grade === g;
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGrade(g)}
                  className={`min-h-10 rounded-xl border px-2.5 text-xs font-black transition-colors ${
                    active
                      ? 'border-[var(--primary)] bg-[var(--primary)] text-white'
                      : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:border-[var(--primary)]'
                  }`}
                >
                  {EVALUATION_GRADE_LABELS[g]}
                </button>
              );
            })}
          </div>
        </div>

        {/* 4) نقاط البونص المصاحبة */}
        <div className="grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3.5">
          <span className="text-sm font-bold text-[var(--text)]">
            نقاط البونص المصاحبة للتقييم (تُضاف تلقائياً لرصيد العضو وترتيب الفريق)
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPoints(0)}
              className={`min-h-9 rounded-lg px-3 text-xs font-black transition-colors ${
                points === 0
                  ? 'bg-[var(--primary)] text-white'
                  : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text)]'
              }`}
            >
              0 (بدون تغيير نقاط)
            </button>
            <span className="ms-1 flex items-center gap-0.5 text-xs font-bold text-emerald-700">
              <Plus size={12} aria-hidden="true" /> مكافأة:
            </span>
            {POSITIVE_POINTS.map((val) => (
              <button
                key={`pos-${val}`}
                type="button"
                onClick={() => setPoints(val)}
                className={`min-h-9 min-w-9 rounded-lg px-2.5 text-xs font-black transition-colors ${
                  points === val
                    ? 'bg-emerald-600 text-white'
                    : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text)]'
                }`}
              >
                +{val}
              </button>
            ))}
            <span className="ms-1 flex items-center gap-0.5 text-xs font-bold text-red-700">
              <Minus size={12} aria-hidden="true" /> خصم:
            </span>
            {NEGATIVE_POINTS.map((val) => (
              <button
                key={`neg-${val}`}
                type="button"
                onClick={() => setPoints(val)}
                className={`min-h-9 min-w-9 rounded-lg px-2.5 text-xs font-black transition-colors ${
                  points === val
                    ? 'bg-red-600 text-white'
                    : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text)]'
                }`}
              >
                {val}
              </button>
            ))}
          </div>
          <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)]">
            <Award size={14} className="text-[var(--link)]" aria-hidden="true" />
            {points === 0
              ? 'سيظهر التقييم للعضو كتقييم توجيهي ومعنوي بدون تعديل نقاط البونص.'
              : points > 0
              ? `سيحصل العضو على مكافأة +${points} نقطة بونص فور حفظ التقييم.`
              : `سيتم خصم ${Math.abs(points)} نقطة من رصيد البونص مع توثيق السبب.`}
          </p>
        </div>

        {/* 5) نص التقييم التفصيلي */}
        <label className="grid gap-1.5 text-sm font-bold text-[var(--text)]">
          رسالة وتفاصيل التقييم (تظهر للعضو مباشرة عند دخوله البوابة) *
          <textarea
            required
            rows={4}
            placeholder="اكتب نقاط القوة والتميز لدى العضو، وأي ملاحظات أو توجيهات للفترة الجاية..."
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 text-sm leading-6 text-[var(--text)]"
          />
        </label>

        {/* 6) اسم المقيم */}
        <label className="grid gap-1.5 text-sm font-bold text-[var(--text)]">
          اسم المسؤول / المقيّم
          <input
            type="text"
            value={evaluatorName}
            onChange={(e) => setEvaluatorName(e.target.value)}
            className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm text-[var(--text)]"
          />
        </label>

        <div className="flex flex-col-reverse gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} fullOnMobile>
            إلغاء
          </Button>
          <Button
            type="submit"
            isLoading={createEvaluations.isPending}
            loadingText="بنحفظ ونبعت التقييم..."
            fullOnMobile
          >
            إرسال وحفظ التقييم
          </Button>
        </div>
      </form>
    </Modal>
  );
}
