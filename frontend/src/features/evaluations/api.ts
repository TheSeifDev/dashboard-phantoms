import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase/client';
import { memberSupabase } from '../../lib/supabase/member-client';
import { toAppError } from '../../lib/supabase/errors';
import { getDeviceToken } from '../../store/auth';
import { TABLES } from '../../types/db';
import type { Task } from '../../types/db';
import { isMissingRelationError } from '../members/customFieldsApi';

export const EVALUATIONS_QUERY_KEY = ['member_evaluations'] as const;
export const EVAL_CARRIER_PREFIX = '[[PHANTOMS_EVAL]]';

export type EvaluationGrade =
  | 'excellent'
  | 'very_good'
  | 'good'
  | 'needs_improvement'
  | 'warning';

export const EVALUATION_GRADE_LABELS: Record<EvaluationGrade, string> = {
  excellent: 'ممتاز',
  very_good: 'جيد جداً',
  good: 'جيد',
  needs_improvement: 'يحتاج تحسين',
  warning: 'لفت نظر',
};

/**
 * نوع الحركة: منح نجوم، خصم نجوم، أو تحذير (strike).
 * التحذير بياخد grade = warning و points = 0، وبيتحسب في جدول member_strikes.
 */
export type EvaluationKind = 'stars' | 'minus' | 'strike';

export const EVALUATION_KIND_LABELS: Record<EvaluationKind, string> = {
  stars: 'نجوم',
  minus: 'خصم نجوم',
  strike: 'تحذير',
};

export const STRIKE_LIMIT = 3;

/** التقدير بقى مش اختياري: بيتحسب تلقائياً من عدد النجوم. */
export function gradeFromStars(stars: number): EvaluationGrade {
  if (stars >= 5) return 'excellent';
  if (stars >= 4) return 'very_good';
  if (stars >= 3) return 'good';
  if (stars >= 1) return 'needs_improvement';
  return 'warning';
}

function normalizeKind(value: unknown, points: number, grade: EvaluationGrade): EvaluationKind {
  if (value === 'strike' || value === 'minus' || value === 'stars') return value;
  if (grade === 'warning' && points === 0) return 'strike';
  return points < 0 ? 'minus' : 'stars';
}

export interface MemberEvaluation {
  id: number;
  created_at: string;
  member_id: number;
  title: string;
  grade: EvaluationGrade;
  points: number;
  feedback: string;
  evaluator_name: string;
  bonus_note_id: number | null;
  viewed_at: string | null;
  read_at: string | null;
  kind: EvaluationKind;
  mode: 'native' | 'fallback';
}

export interface CreateEvaluationInput {
  memberIds: number[];
  memberNamesMap: Record<number, string>;
  title: string;
  kind: EvaluationKind;
  points: number;
  feedback: string;
  evaluatorName: string;
}

interface FallbackEvalContent {
  __phantoms_eval?: boolean;
  member_id: number;
  grade: EvaluationGrade;
  kind?: EvaluationKind;
  points: number;
  feedback: string;
  evaluator_name: string;
  bonus_note_id: number | null;
}

function normalizeGrade(val: unknown): EvaluationGrade {
  const valid: EvaluationGrade[] = ['excellent', 'very_good', 'good', 'needs_improvement', 'warning'];
  return valid.includes(val as EvaluationGrade) ? (val as EvaluationGrade) : 'very_good';
}

function parseFallbackTaskRow(task: Task): MemberEvaluation | null {
  if (!task.title.startsWith(EVAL_CARRIER_PREFIX)) return null;
  const cleanTitle = task.title.slice(EVAL_CARRIER_PREFIX.length).trim() || 'تقييم أداء';
  let parsed: Partial<FallbackEvalContent> = {};
  try {
    parsed = JSON.parse(task.description ?? '{}') as Partial<FallbackEvalContent>;
  } catch {
    parsed = { feedback: task.description ?? '' };
  }

  const assignedArr = Array.isArray(task.assigned_to) ? task.assigned_to : [];
  const memberId = Number(parsed.member_id ?? assignedArr[0] ?? 0);
  if (!memberId) return null;

  const entry = (task.tracking ?? {})[String(memberId)];
  const status = entry?.status;
  const updatedAt = entry?.updated_at ?? null;

  const isRead = status === 'under_review' || status === 'approved';
  const isViewed = isRead || status === 'in_progress';

  return {
    id: task.id,
    created_at: task.created_at,
    member_id: memberId,
    title: cleanTitle,
    grade: normalizeGrade(parsed.grade),
    points: Number(parsed.points ?? 0),
    feedback: typeof parsed.feedback === 'string' ? parsed.feedback : '',
    evaluator_name:
      typeof parsed.evaluator_name === 'string' && parsed.evaluator_name.trim()
        ? parsed.evaluator_name.trim()
        : 'إدارة PHANTOMS',
    bonus_note_id: typeof parsed.bonus_note_id === 'number' ? parsed.bonus_note_id : null,
    viewed_at: isViewed ? updatedAt || task.created_at : null,
    read_at: isRead ? updatedAt || task.created_at : null,
    kind: normalizeKind(parsed.kind, Number(parsed.points ?? 0), normalizeGrade(parsed.grade)),
    mode: 'fallback',
  };
}

async function fetchAdminEvaluations(): Promise<MemberEvaluation[]> {
  const results: MemberEvaluation[] = [];

  const nativeRes = await (supabase as any)
    .from('member_evaluations')
    .select('*')
    .order('created_at', { ascending: false });

  if (!nativeRes.error && Array.isArray(nativeRes.data)) {
    for (const row of nativeRes.data as Array<Record<string, unknown>>) {
      const points = Number(row.points ?? 0);
      const grade = normalizeGrade(row.grade);
      results.push({
        id: Number(row.id),
        created_at: String(row.created_at),
        member_id: Number(row.member_id),
        title: String(row.title ?? ''),
        grade,
        points,
        feedback: String(row.feedback ?? ''),
        evaluator_name: String(row.evaluator_name ?? 'إدارة PHANTOMS'),
        bonus_note_id: typeof row.bonus_note_id === 'number' ? row.bonus_note_id : null,
        viewed_at: typeof row.viewed_at === 'string' ? row.viewed_at : null,
        read_at: typeof row.read_at === 'string' ? row.read_at : null,
        kind: normalizeKind(row.kind, points, grade),
        mode: 'native',
      });
    }
  } else if (nativeRes.error && !isMissingRelationError(nativeRes.error, 'member_evaluations')) {
    throw toAppError(nativeRes.error, 'معرفناش نحمّل سجل التقييمات.');
  }

  // جلب التقييمات المحفوظة في قناة التوافق الفورية
  const fallbackRes = await supabase
    .from(TABLES.tasks)
    .select('*')
    .like('title', `${EVAL_CARRIER_PREFIX}%`)
    .order('created_at', { ascending: false });

  if (!fallbackRes.error && Array.isArray(fallbackRes.data)) {
    for (const row of fallbackRes.data as Task[]) {
      const parsed = parseFallbackTaskRow(row);
      if (parsed) {
        results.push(parsed);
      }
    }
  }

  return results.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

export function useAdminEvaluations() {
  return useQuery({
    queryKey: EVALUATIONS_QUERY_KEY,
    queryFn: fetchAdminEvaluations,
  });
}

async function createBonusNoteForEvaluation(
  memberId: number,
  memberName: string,
  title: string,
  grade: EvaluationGrade,
  points: number,
  feedback: string,
  evaluatorName: string,
): Promise<number | null> {
  if (!points || points === 0) return null;

  const cleanReason = feedback.replace(/\[B:[+-]?[0-9]{1,9}\]/gi, '').trim();
  const gradeLabel = EVALUATION_GRADE_LABELS[grade];
  const tag = points > 0 ? `[B:+${points}]` : `[B:${points}]`;
  const noteText = `${tag} تقييم (${gradeLabel}) — ${title}: ${cleanReason}`.slice(0, 950);
  const todayStr = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from(TABLES.notes)
    .insert({
      text: noteText,
      author: evaluatorName,
      author_role: 'Admin',
      date: todayStr,
      target_member_id: memberId,
      target_name: memberName || null,
    })
    .select('id')
    .single();

  if (!error && data?.id) {
    return Number(data.id);
  }

  if (points >= -5 && points <= 5) {
    const rpcRes = await supabase.rpc('admin_add_member_rating', {
      p_member_id: memberId,
      p_points: points,
      p_reason: `تقييم (${gradeLabel}) — ${title}: ${cleanReason}`.slice(0, 900),
      p_author: evaluatorName,
    });
    if (!rpcRes.error && typeof rpcRes.data === 'number') {
      return rpcRes.data;
    }
  }

  return null;
}

export function useCreateEvaluations() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateEvaluationInput): Promise<number> => {
      const cleanTitle = input.title.trim();
      const cleanFeedback = input.feedback.trim();
      const cleanEvaluator = input.evaluatorName.trim() || 'إدارة PHANTOMS';
      const kind: EvaluationKind = input.kind;
      // التحذير مالوش نجوم ولا خصم؛ النجوم بتتحسب من العدد، والخصم بالسالب.
      const points = kind === 'strike' ? 0 : kind === 'minus' ? -Math.abs(input.points) : Math.abs(input.points);
      const grade: EvaluationGrade = kind === 'strike'
        ? 'warning'
        : kind === 'minus'
          ? 'needs_improvement'
          : gradeFromStars(points);
      let createdCount = 0;

      for (const memberId of input.memberIds) {
        const memberName = input.memberNamesMap[memberId] ?? '';
        const bonusNoteId = await createBonusNoteForEvaluation(
          memberId,
          memberName,
          cleanTitle,
          grade,
          points,
          cleanFeedback,
          cleanEvaluator,
        );

        const nativeInsert = await (supabase as any)
          .from('member_evaluations')
          .insert({
            member_id: memberId,
            title: cleanTitle,
            grade,
            kind,
            points,
            feedback: cleanFeedback,
            evaluator_name: cleanEvaluator,
            bonus_note_id: bonusNoteId,
          });

        if (!nativeInsert.error) {
          createdCount += 1;
          continue;
        }

        if (isMissingRelationError(nativeInsert.error, 'member_evaluations')) {
          const contentPayload: FallbackEvalContent = {
            __phantoms_eval: true,
            member_id: memberId,
            grade,
            kind,
            points,
            feedback: cleanFeedback,
            evaluator_name: cleanEvaluator,
            bonus_note_id: bonusNoteId,
          };

          const fallbackInsert = await supabase.from(TABLES.tasks).insert({
            title: `${EVAL_CARRIER_PREFIX}${cleanTitle}`,
            description: JSON.stringify(contentPayload),
            has_deadline: false,
            deadline_date: null,
            assigned_to: [String(memberId)],
            tracking: {
              [String(memberId)]: {
                status: 'pending',
              },
            },
            bonus_points: 0,
          });

          if (fallbackInsert.error) {
            throw toAppError(fallbackInsert.error, 'معرفناش نحفظ التقييم.');
          }

          createdCount += 1;
          continue;
        }

        throw toAppError(nativeInsert.error, 'معرفناش نحفظ التقييم.');
      }

      return createdCount;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: EVALUATIONS_QUERY_KEY });
      void qc.invalidateQueries({ queryKey: ['notes'] });
      void qc.invalidateQueries({ queryKey: ['members'] });
      void qc.invalidateQueries({ queryKey: ['ranking'] });
      void qc.invalidateQueries({ queryKey: ['member-bonus'] });
      void qc.invalidateQueries({ queryKey: ['member_portal_evaluations'] });
    },
  });
}

export function useDeleteEvaluation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (evaluation: Pick<MemberEvaluation, 'id' | 'mode' | 'bonus_note_id'>) => {
      if (evaluation.mode === 'fallback') {
        const { error } = await supabase
          .from(TABLES.tasks)
          .delete()
          .eq('id', evaluation.id);
        if (error) throw toAppError(error, 'معرفناش نمسح التقييم.');
      } else {
        const { error } = await (supabase as any)
          .from('member_evaluations')
          .delete()
          .eq('id', evaluation.id);
        if (error) throw toAppError(error, 'معرفناش نمسح التقييم.');
      }

      if (evaluation.bonus_note_id) {
        await supabase.from(TABLES.notes).delete().eq('id', evaluation.bonus_note_id);
      }

      return evaluation.id;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: EVALUATIONS_QUERY_KEY });
      void qc.invalidateQueries({ queryKey: ['notes'] });
      void qc.invalidateQueries({ queryKey: ['members'] });
      void qc.invalidateQueries({ queryKey: ['ranking'] });
      void qc.invalidateQueries({ queryKey: ['member-bonus'] });
      void qc.invalidateQueries({ queryKey: ['member_portal_evaluations'] });
    },
  });
}

// =====================================================
// بوابة العضو (Member Portal)
// =====================================================

export function useMemberEvaluations(memberId: number | null | undefined) {
  const enabled = typeof memberId === 'number' && memberId > 0;
  return useQuery({
    queryKey: ['member_portal_evaluations', memberId],
    enabled,
    queryFn: async (): Promise<MemberEvaluation[]> => {
      const targetId = memberId as number;
      const deviceToken = getDeviceToken() ?? '';
      const results: MemberEvaluation[] = [];

      const nativeRes = await (memberSupabase as any).rpc('get_member_evaluations', {
        p_member_id: targetId,
        p_device_token: deviceToken,
      });

      if (!nativeRes.error && Array.isArray(nativeRes.data)) {
        for (const row of nativeRes.data as Array<Record<string, unknown>>) {
          results.push({
            id: Number(row.id),
            created_at: String(row.created_at),
            member_id: Number(row.member_id ?? targetId),
            title: String(row.title ?? ''),
            grade: normalizeGrade(row.grade),
            points: Number(row.points ?? 0),
            feedback: String(row.feedback ?? ''),
            evaluator_name: String(row.evaluator_name ?? 'إدارة PHANTOMS'),
            bonus_note_id: null,
            viewed_at: typeof row.viewed_at === 'string' ? row.viewed_at : null,
            read_at: typeof row.read_at === 'string' ? row.read_at : null,
            kind: normalizeKind(row.kind, Number(row.points ?? 0), normalizeGrade(row.grade)),
            mode: 'native',
          });
        }
      }

      // جلب التقييمات المحفوظة في قناة التوافق عبر get_member_tasks (VOLATILE)
      const tasksRes = await memberSupabase.rpc('get_member_tasks', {
        p_member_id: targetId,
        p_device_token: deviceToken,
      });

      if (!tasksRes.error && Array.isArray(tasksRes.data)) {
        for (const task of tasksRes.data as Task[]) {
          const parsed = parseFallbackTaskRow(task);
          if (parsed) {
            results.push(parsed);
            if (!parsed.viewed_at) {
              void memberSupabase
                .rpc('submit_task_status', {
                  p_task_id: task.id,
                  p_member_id: targetId,
                  p_device_token: deviceToken,
                  p_status: 'in_progress',
                  p_note: 'VIEWED',
                  p_submission_url: '',
                })
                .then(() => undefined, () => undefined);
            }
          }
        }
      }

      return results.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    },
  });
}

export function useMarkEvaluationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      evaluationId,
      memberId,
      mode,
    }: {
      evaluationId: number;
      memberId: number;
      mode: 'native' | 'fallback';
    }) => {
      const deviceToken = getDeviceToken() ?? '';
      if (mode === 'fallback') {
        const { error } = await memberSupabase.rpc('submit_task_status', {
          p_task_id: evaluationId,
          p_member_id: memberId,
          p_device_token: deviceToken,
          p_status: 'under_review',
          p_note: 'READ',
          p_submission_url: '',
        });
        if (error) throw toAppError(error, 'معرفناش نسجّل قراءة التقييم.');
        return evaluationId;
      }

      const { error } = await (memberSupabase as any).rpc('mark_member_evaluation_read', {
        p_evaluation_id: evaluationId,
        p_member_id: memberId,
        p_device_token: deviceToken,
      });
      if (error) throw toAppError(error, 'معرفناش نسجّل قراءة التقييم.');
      return evaluationId;
    },
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: ['member_portal_evaluations', vars.memberId] });
      void qc.invalidateQueries({ queryKey: EVALUATIONS_QUERY_KEY });
    },
  });
}

// =====================================================
// التحذيرات (Strikes) والطرد من الفريق
// =====================================================

export const MEMBER_STRIKES_QUERY_KEY = ['member_strikes'] as const;

export interface MemberStrike {
  id: number;
  member_id: number;
  evaluation_id: number | null;
  reason: string;
  issued_by: string | null;
  issued_by_name: string | null;
  created_at: string;
}

export interface IssueStrikeResult {
  strike_id: number;
  evaluation_id: number;
  member_id: number;
  strikes: number;
  limit: number;
  expulsion_required: boolean;
}

export interface IssueStrikeInput {
  memberId: number;
  title: string;
  feedback: string;
  author: string;
}

function invalidateEvaluationViews(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: EVALUATIONS_QUERY_KEY });
  void qc.invalidateQueries({ queryKey: MEMBER_STRIKES_QUERY_KEY });
  void qc.invalidateQueries({ queryKey: ['members'] });
  void qc.invalidateQueries({ queryKey: ['notes'] });
  void qc.invalidateQueries({ queryKey: ['ranking'] });
  void qc.invalidateQueries({ queryKey: ['member-bonus'] });
  void qc.invalidateQueries({ queryKey: ['member_portal_evaluations'] });
  void qc.invalidateQueries({ queryKey: ['member_portal_strikes'] });
}

/** كل التحذيرات المسجّلة (للإدارة فقط، محمية بـ RLS). */
export function useMemberStrikes() {
  return useQuery({
    queryKey: MEMBER_STRIKES_QUERY_KEY,
    queryFn: async (): Promise<MemberStrike[]> => {
      const { data, error } = await supabase
        .from('member_strikes')
        .select('id, member_id, evaluation_id, reason, issued_by, issued_by_name, created_at')
        .order('created_at', { ascending: false });
      if (error) {
        if (isMissingRelationError(error, 'member_strikes')) return [];
        throw toAppError(error, 'معرفناش نحمّل سجل التحذيرات.');
      }
      return (data ?? []).map((row) => ({
        id: Number((row as Record<string, unknown>).id),
        member_id: Number((row as Record<string, unknown>).member_id),
        evaluation_id:
          typeof (row as Record<string, unknown>).evaluation_id === 'number'
            ? ((row as Record<string, unknown>).evaluation_id as number)
            : null,
        reason: String((row as Record<string, unknown>).reason ?? ''),
        issued_by:
          typeof (row as Record<string, unknown>).issued_by === 'string'
            ? ((row as Record<string, unknown>).issued_by as string)
            : null,
        issued_by_name:
          typeof (row as Record<string, unknown>).issued_by_name === 'string'
            ? ((row as Record<string, unknown>).issued_by_name as string)
            : null,
        created_at: String((row as Record<string, unknown>).created_at ?? ''),
      }));
    },
  });
}

/** إصدار تحذير لعضو واحد؛ بيرجع عدد التحذيرات الحالي وهل لازم طرد. */
export function useIssueStrike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: IssueStrikeInput): Promise<IssueStrikeResult> => {
      const { data, error } = await (supabase as any).rpc('admin_issue_strike', {
        p_member_id: input.memberId,
        p_title: input.title,
        p_feedback: input.feedback,
        p_author: input.author,
      });
      if (error) throw error;
      return data as IssueStrikeResult;
    },
    onSettled: () => invalidateEvaluationViews(qc),
  });
}

/** طرد العضو من الفريق بالكامل — للمالك فقط. */
export function useExpelMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ memberId, reason }: { memberId: number; reason: string }) => {
      const { data, error } = await (supabase as any).rpc('owner_expel_member', {
        p_member_id: memberId,
        p_reason: reason,
      });
      if (error) throw error;
      return data as { member_id: number; expelled: boolean; strikes: number; reason: string | null };
    },
    onSettled: () => invalidateEvaluationViews(qc),
  });
}

export interface MemberMyStrikes {
  limit: number;
  strikes: { id: number; reason: string; created_at: string; issued_by_name: string | null }[];
}

/** تحذيرات العضو نفسه (من بوابته) — الحد الافتراضي ٣. */
export function useMemberMyStrikes(enabled = true) {
  return useQuery({
    queryKey: ['member_portal_strikes'],
    enabled,
    queryFn: async (): Promise<MemberMyStrikes> => {
      const { data, error } = await (memberSupabase as any).rpc('member_my_strikes');
      if (error) return { limit: STRIKE_LIMIT, strikes: [] };
      const payload = (data ?? {}) as Partial<MemberMyStrikes>;
      return {
        limit: typeof payload.limit === 'number' ? payload.limit : STRIKE_LIMIT,
        strikes: Array.isArray(payload.strikes) ? payload.strikes : [],
      };
    },
  });
}
