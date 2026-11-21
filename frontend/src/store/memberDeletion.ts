import { create } from 'zustand';
import type { Member } from '../types/db';
import { useLocaleStore, type Locale } from '../i18n/useLocale';
import { MemberDeletionError, type MemberDeletionErrorCode } from '../features/members/member-delete-errors';
import { toast, useToastStore } from './toast';

interface PendingDeletion {
  member: Member;
  generation: number;
  timerId: number;
  commitFn: (id: number) => Promise<unknown>;
  phase: 'queued' | 'committing';
}

interface DeletionToken {
  generation: number;
  timerId: number;
}

interface MemberDeletionState {
  pendingMap: Record<number, PendingDeletion>;
  scheduleDelete: (
    member: Member,
    commitFn: (id: number) => Promise<unknown>,
    durationMs?: number,
    onError?: (err: unknown) => void,
    onSuccess?: () => void
  ) => void;
  undoDelete: (memberId: number, expectedToken?: DeletionToken) => boolean;
  isPendingDelete: (memberId: number) => boolean;
  clearAll: () => void;
}

const DEFAULT_DELETE_UNDO_MS = 5000;

type DeletionCopy = { arabic: string; english: string };

function getCurrentLocale(): Locale {
  return useLocaleStore.getState().locale;
}

function translate(copy: DeletionCopy): string {
  return getCurrentLocale() === 'ar' ? copy.arabic : copy.english;
}

function failureCopy(code: MemberDeletionErrorCode): DeletionCopy {
  switch (code) {
    case 'member_delete_no_match':
      return {
        arabic: 'العضو ما اتحذفش — البيانات اتغيرت أو العضو مش ظاهر لحسابك. حدّث القائمة وجرّب تاني.',
        english: 'The member was not deleted — the data changed or the member is not visible to your account. Refresh and try again.',
      };
    case 'member_delete_dependency_invitations':
      return {
        arabic: 'الخادم رفض حذف سجل العضو لأن دعوة محفوظة ما زالت مرتبطة به. لم يُحذف سجل العضو؛ احتفظ بالدعوة ولا تحذفها يدويًا أو تغيّر قيد قاعدة البيانات. راجع إجراء المالك الآمن عند الحاجة.',
        english: 'The server rejected deletion of the member record because a saved invitation still references it. The member record was not deleted; preserve the invitation and do not delete it manually or change a database constraint. Review the safe owner action if needed.',
      };
    case 'member_delete_dependency_team':
      return {
        arabic: 'مينفعش نحذف العضو لأنه مرتبط بعضوية فريق. راجع عضويات الفرق أولًا؛ الحذف لا يزيل سجل الفريق تلقائيًا.',
        english: 'The member cannot be deleted because a team membership still references the member. Review team memberships first; deletion does not remove team history automatically.',
      };
    case 'member_delete_dependency_projects':
      return {
        arabic: 'مينفعش نحذف العضو لأنه مرتبط ببيانات مشروع. راجع أدواره ومشاركاته في المشروعات قبل أي إجراء معتمد.',
        english: 'The member cannot be deleted because project data still references the member. Review project roles and participation before an approved lifecycle action.',
      };
    case 'member_delete_dependency_other':
      return {
        arabic: 'مينفعش نحذف العضو لأن فيه سجلًا مرتبطًا به. راجع السجلات المرتبطة واستخدم إجراءً معتمدًا.',
        english: 'The member cannot be deleted because a related record still references the member. Review related records and use an approved lifecycle action.',
      };
    case 'member_delete_permission':
      return {
        arabic: 'معندكش صلاحية حذف العضو، أو صلاحية الحساب اتغيرت. حدّث الجلسة وراجع صلاحيات الإدارة.',
        english: 'You do not have permission to delete this member, or your access changed. Refresh the session and review administrator permissions.',
      };
    case 'member_delete_missing_schema':
      return {
        arabic: 'مسار حذف الأعضاء غير متاح حاليًا بسبب إعداد خادم ناقص. تواصل مع مسؤول النظام؛ العضو ما اتحذفش.',
        english: 'Member deletion is unavailable because the server schema is incomplete. Contact the system administrator; the member was not deleted.',
      };
    case 'member_delete_unknown':
    default:
      return {
        arabic: 'تعذّر تأكيد نتيجة الحذف. حدّث القائمة قبل إعادة المحاولة أو تواصل مع مسؤول النظام.',
        english: 'The deletion outcome could not be confirmed. Refresh the list before retrying or contact the system administrator.',
      };
  }
}

function safeDeletionError(cause: unknown): MemberDeletionError {
  return cause instanceof MemberDeletionError ? cause : new MemberDeletionError('member_delete_unknown');
}

export const useMemberDeletionStore = create<MemberDeletionState>((set, get) => {
  let nextGeneration = 0;

  const removePendingIfCurrent = (memberId: number, token: DeletionToken) => {
    set((state) => {
      const current = state.pendingMap[memberId];
      if (!current || current.generation !== token.generation || current.timerId !== token.timerId) return state;
      const next = { ...state.pendingMap };
      delete next[memberId];
      return { pendingMap: next };
    });
  };

  return {
    pendingMap: {},

    scheduleDelete: (member, commitFn, durationMs = DEFAULT_DELETE_UNDO_MS, onError, onSuccess) => {
      // If a deletion is already queued for this exact member, clear existing timer first.
      const existing = get().pendingMap[member.id];
      if (existing?.phase === 'committing') return;
      if (existing) {
        window.clearTimeout(existing.timerId);
      }

      const generation = ++nextGeneration;
      const timerId = window.setTimeout(async () => {
        // Keep the row pending while the request is in flight. It is removed only after
        // the mutation proves that exactly one server row was deleted.
        const current = get().pendingMap[member.id];
        if (!current || current.generation !== generation || current.timerId !== timerId || current.phase !== 'queued') return;
        set((state) => ({ pendingMap: { ...state.pendingMap, [member.id]: { ...current, phase: 'committing' } } }));

        try {
          await commitFn(member.id);
          removePendingIfCurrent(member.id, { generation, timerId });
          toast.success(`${member.full_name} — ${translate({ arabic: 'تم حذف سجل العضو بعد تأكيد الخادم؛ ده مش حذف حساب الدخول.', english: 'member record deleted after server confirmation; this does not delete the Auth account.' })}`);
          onSuccess?.();
        } catch (cause) {
          const safeCause = safeDeletionError(cause);
          removePendingIfCurrent(member.id, { generation, timerId });
          toast.error(`${member.full_name} — ${translate(failureCopy(safeCause.code))}`);
          onError?.(safeCause);
        }
      }, durationMs);

      set((state) => ({
        pendingMap: {
          ...state.pendingMap,
          [member.id]: {
            member,
            generation,
            timerId,
            commitFn,
            phase: 'queued',
          },
        },
      }));

      useToastStore.getState().push(
        'info',
        `${member.full_name} — ${translate({ arabic: 'الحذف متحدد بعد انتهاء المهلة. تقدر تتراجع.', english: 'deletion is scheduled after the countdown. You can undo it.' })}`,
        {
          durationMs,
          action: {
            label: translate({ arabic: 'تراجع', english: 'Undo' }),
            onClick: () => {
              get().undoDelete(member.id, { generation, timerId });
            },
          },
        },
      );
    },

    undoDelete: (memberId: number, expectedToken?: DeletionToken): boolean => {
      const entry = get().pendingMap[memberId];
      if (!entry || entry.phase !== 'queued') return false;
      if (expectedToken && (entry.generation !== expectedToken.generation || entry.timerId !== expectedToken.timerId)) return false;

      window.clearTimeout(entry.timerId);
      set((state) => {
        const next = { ...state.pendingMap };
        delete next[memberId];
        return { pendingMap: next };
      });

      toast.info(`${entry.member.full_name} — ${translate({ arabic: 'تم التراجع عن الحذف.', english: 'deletion was undone.' })}`);
      return true;
    },

    isPendingDelete: (memberId: number): boolean => {
      return Boolean(get().pendingMap[memberId]);
    },

    clearAll: () => {
      const map = get().pendingMap;
      for (const entry of Object.values(map)) {
        window.clearTimeout(entry.timerId);
      }
      set({ pendingMap: {} });
    },
  };
});
