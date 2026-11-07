import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase/client';
import { toAppError } from '../../lib/supabase/errors';

export interface SetMemberInfiniteBonusInput {
  memberId: number;
  enabled: boolean;
  reason: string;
}

export function useSetMemberInfiniteBonus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ memberId, enabled, reason }: SetMemberInfiniteBonusInput) => {
      const { data, error } = await supabase.rpc('set_member_bonus_infinite', {
        p_member_id: memberId,
        p_enabled: enabled,
        p_reason: reason.trim(),
      });
      if (error) throw toAppError(error, 'معرفناش نحدّث حالة البونص غير المحدود.');
      return data;
    },
    onSettled: async (_data, _error, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['members'] }),
        queryClient.invalidateQueries({ queryKey: ['member-bonus-infinite', input.memberId] }),
      ]);
    },
  });
}

export function useCreateMemberRating() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ memberId, points, reason, author }: { memberId: number; points: number; reason: string; author: string }) => {
      const { data, error } = await supabase.rpc('admin_add_member_rating', {
        p_member_id: memberId,
        p_points: points,
        p_reason: reason.trim(),
        p_author: author.trim() || 'إدارة وصلة',
      });
      if (error) throw toAppError(error, 'معرفناش نسجل تقييم العضو.');
      return data;
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['notes'] }),
        queryClient.invalidateQueries({ queryKey: ['members'] }),
        queryClient.invalidateQueries({ queryKey: ['ranking'] }),
      ]);
    },
  });
}
