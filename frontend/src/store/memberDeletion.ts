import { create } from 'zustand';
import type { Member } from '../types/db';
import { toast } from './toast';

interface PendingDeletion {
  member: Member;
  timerId: number;
  commitFn: (id: number) => Promise<unknown>;
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
  undoDelete: (memberId: number) => boolean;
  isPendingDelete: (memberId: number) => boolean;
  clearAll: () => void;
}

const DEFAULT_DELETE_UNDO_MS = 5000;

export const useMemberDeletionStore = create<MemberDeletionState>((set, get) => ({
  pendingMap: {},

  scheduleDelete: (member, commitFn, durationMs = DEFAULT_DELETE_UNDO_MS, onError, onSuccess) => {
    // If a deletion is already queued for this exact member, clear existing timer first
    const existing = get().pendingMap[member.id];
    if (existing) {
      window.clearTimeout(existing.timerId);
    }

    const timerId = window.setTimeout(async () => {
      // Deletion timer expired: execute deletion once
      set((state) => {
        const next = { ...state.pendingMap };
        delete next[member.id];
        return { pendingMap: next };
      });

      try {
        await commitFn(member.id);
        toast.success(`تم حذف "${member.full_name}" نهائيًا.`);
        onSuccess?.();
      } catch (cause) {
        toast.error(`معرفناش نمسح العضو "${member.full_name}".`);
        onError?.(cause);
      }
    }, durationMs);

    set((state) => ({
      pendingMap: {
        ...state.pendingMap,
        [member.id]: {
          member,
          timerId,
          commitFn,
        },
      },
    }));

    toast.success(`تم حذف "${member.full_name}".`, {
      durationMs,
      action: {
        label: 'تراجع',
        onClick: () => {
          get().undoDelete(member.id);
        },
      },
    });
  },

  undoDelete: (memberId: number): boolean => {
    const entry = get().pendingMap[memberId];
    if (!entry) return false;

    window.clearTimeout(entry.timerId);
    set((state) => {
      const next = { ...state.pendingMap };
      delete next[memberId];
      return { pendingMap: next };
    });

    toast.info(`تم التراجع عن حذف "${entry.member.full_name}".`);
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
}));

