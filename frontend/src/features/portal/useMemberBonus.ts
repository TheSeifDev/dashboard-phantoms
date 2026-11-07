import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase/client';
import { toAppError } from '../../lib/supabase/errors';
import { getDeviceToken } from '../../store/auth';

/**
 * إجمالي بونص العضو = مجموع علامات [B:±n] في الملاحظات الموجهة إليه —
 * نفس الحساب الذي يعتمده ترتيب الفريق، فلا يختلف الرقم بين البوابة ولوحة الإدارة.
 */
export function useMemberBonus(memberId: number | null | undefined) {
  const enabled = typeof memberId === 'number' && memberId > 0;
  return useQuery({
    queryKey: ['member-bonus', memberId],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const deviceToken = getDeviceToken();
      if (!deviceToken) throw new Error('DEVICE_REQUIRED: سجّل دخولك من جديد للتحقق من جلسة الجهاز.');
      const { data, error } = await supabase.rpc('get_member_bonus_total', {
        p_member_id: memberId as number,
        p_device_token: deviceToken,
      });
      if (error) throw toAppError(error, 'معرفناش نحمّل رصيد البونص.');
      return Number(data ?? 0);
    },
  });
}

/** Infinite bonus is read only after the current member device session is verified server-side. */
export function useMemberInfiniteBonus(memberId: number | null | undefined) {
  const enabled = typeof memberId === 'number' && memberId > 0;
  return useQuery({
    queryKey: ['member-bonus-infinite', memberId],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const deviceToken = getDeviceToken();
      if (!deviceToken) throw new Error('DEVICE_REQUIRED: سجّل دخولك من جديد للتحقق من جلسة الجهاز.');
      const { data, error } = await supabase.rpc('get_member_bonus_infinite', {
        p_member_id: memberId as number,
        p_device_token: deviceToken,
      });
      if (error) throw toAppError(error, 'معرفناش نحمّل حالة البونص غير المحدود.');
      return data === true;
    },
  });
}
