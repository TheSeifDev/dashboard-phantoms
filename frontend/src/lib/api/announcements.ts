import { supabase } from '../supabase/client';
import { toAppError } from '../supabase/errors';
import { getDeviceToken } from '../../store/auth';
import { isPositiveId } from '../validators';
import type {
  Announcement,
  AnnouncementInsert,
  MemberAnnouncement,
  AnnouncementMemberDetail,
  AnnouncementStats,
} from '../../types/db';
import type { AnnouncementTargetAudience } from '../../types/db';

export class AnnouncementsAPI {
  // ===== Admin APIs =====

  /**
   * إنشاء إعلان جديد (للإدارة فقط)
   */
  static async createAnnouncement(data: AnnouncementInsert): Promise<Announcement> {
    const { data: announcement, error } = await supabase
      .from('announcements')
      .insert(data)
      .select()
      .single();

    if (error) {
      throw toAppError(error, 'معرفناش نعمل الإعلان.');
    }

    return announcement;
  }

  /**
   * جلب جميع الإعلامات (للإدارة فقط)
   */
  static async getAnnouncements(): Promise<Announcement[]> {
    const { data: announcements, error } = await supabase
      .from('announcements')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw toAppError(error, 'معرفناش نحمّل الإعلانات.');
    }

    return (announcements || []).filter(
      (ann) => !ann.title.startsWith('[[PHANTOMS_EVAL]]') && !ann.title.startsWith('[[WASLA_EVAL]]'),
    );
  }

  /**
   * تحديث إعلان موجود (للإدارة فقط)
   */
  static async updateAnnouncement(
    id: number,
    data: Partial<AnnouncementInsert>,
  ): Promise<Announcement> {
    const { data: announcement, error } = await supabase
      .from('announcements')
      .update(data)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw toAppError(error, 'معرفناش نحدّث الإعلان.');
    }

    return announcement;
  }

  /**
   * حذف إعلان (للإدارة فقط)
   */
  static async deleteAnnouncement(id: number): Promise<void> {
    const { error } = await supabase
      .from('announcements')
      .delete()
      .eq('id', id);

    if (error) {
      throw toAppError(error, 'معرفناش نمسح الإعلان.');
    }
  }

  /**
   * جلب إعلان واحد بالمعرف (للإدارة فقط) — يُستخدم لعرض حالة إرسال الواتساب.
   */
  static async getAnnouncementById(id: number): Promise<Announcement | null> {
    if (!isPositiveId(id)) {
      throw toAppError(new Error('INVALID_ID'), 'رقم الإعلان مش صالح.');
    }
    const { data: announcement, error } = await supabase
      .from('announcements')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw toAppError(error, 'معرفناش نحمّل الإعلان.');
    }

    return announcement ?? null;
  }

  /**
   * جلب إحصائيات الإعلان (للإدارة فقط)
   */
  static async getAnnouncementStats(announcementId: number): Promise<AnnouncementStats | null> {
    const { data: stats, error } = await supabase
      .rpc('get_announcement_stats', { p_announcement_id: announcementId });

    if (error) {
      throw toAppError(error, 'معرفناش نحمّل إحصائيات الإعلان.');
    }

    return stats && stats.length > 0 ? stats[0] : null;
  }

  /**
   * جلب تفاصيل كل مستلم (للإدارة فقط): المشاهدة والقراءة والمسح لكل عضو.
   */
  static async getAnnouncementDetails(announcementId: number): Promise<AnnouncementMemberDetail[]> {
    if (!isPositiveId(announcementId)) {
      throw toAppError(new Error('INVALID_ID'), 'رقم الإعلان مش صالح.');
    }
    const { data: details, error } = await supabase
      .rpc('get_announcement_details', { p_announcement_id: announcementId });

    if (error) {
      throw toAppError(error, 'معرفناش نحمّل تفاصيل الإعلان.');
    }

    return details || [];
  }

  // ===== Member APIs =====

  /**
   * جلب إعلامات العضو المخصصة له فقط — برمز جهازه (منع BOLA).
   */
  static async getMemberAnnouncements(memberId: number): Promise<MemberAnnouncement[]> {
    if (!isPositiveId(memberId)) throw toAppError(new Error('INVALID_ID'), 'رقم العضو مش صالح.');
    const { data: announcements, error } = await supabase
      .rpc('get_member_announcements', { p_member_id: memberId, p_device_token: getDeviceToken() });

    if (!error) {
      return (announcements || []).filter(
      (ann) => !ann.title.startsWith('[[PHANTOMS_EVAL]]') && !ann.title.startsWith('[[WASLA_EVAL]]'),
    );
    }

    const msg = String(error.message ?? '').toLowerCase();
    if (msg.includes('read-only transaction')) {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session) {
        const directRes = await supabase
          .from('announcements')
          .select('*')
          .eq('is_active', true)
          .order('created_at', { ascending: false });

        if (!directRes.error && Array.isArray(directRes.data)) {
          const nowMs = Date.now();
          return (directRes.data as Announcement[])
            .filter((a) => {
              if (a.title.startsWith('[[PHANTOMS_EVAL]]') || a.title.startsWith('[[WASLA_EVAL]]')) return false;
              if (a.expires_at && new Date(a.expires_at).getTime() <= nowMs) return false;
              const receipt = (a.read_receipts ?? {})[String(memberId)];
              if (receipt?.dismissed_at) return false;
              if (a.target_audience?.type === 'all') return true;
              if (a.target_audience?.type === 'specific') {
                return (a.target_audience.member_ids ?? []).map(Number).includes(memberId);
              }
              return false;
            })
            .map((a) => {
              const receipt = (a.read_receipts ?? {})[String(memberId)];
              return {
                id: a.id,
                created_at: a.created_at,
                title: a.title,
                content: a.content,
                priority: a.priority,
                is_read: Boolean(receipt?.read_at),
                is_dismissed: Boolean(receipt?.dismissed_at),
              };
            });
        }
      }
      return [];
    }

    throw toAppError(error, 'معرفناش نحمّل إعلانات العضو.');
  }

  /**
   * تسجيل مشاهدة العضو للإعلان (تُستدعى عند ظهور الإعلان في بوابته —
   * حدث منفصل عن ضغط "تمت القراءة").
   */
  static async markAnnouncementViewed(
    announcementId: number,
    memberId: number,
  ): Promise<boolean> {
    if (!isPositiveId(announcementId) || !isPositiveId(memberId)) {
      throw toAppError(new Error('INVALID_ID'), 'أرقام الإعلان والعضو مش صالحة.');
    }
    const { data: result, error } = await supabase
      .rpc('mark_announcement_viewed', {
        p_announcement_id: announcementId,
        p_member_id: memberId,
        p_device_token: getDeviceToken(),
      });

    if (error) {
      throw toAppError(error, 'معرفناش نسجّل المشاهدة.');
    }

    return result === true;
  }

  /**
   * تعليم الإعلان كمقروء (يبقى ظاهراً) — برمز الجهاز.
   */
  static async markAnnouncementRead(
    announcementId: number,
    memberId: number,
  ): Promise<boolean> {
    if (!isPositiveId(announcementId) || !isPositiveId(memberId)) {
      throw toAppError(new Error('INVALID_ID'), 'أرقام الإعلان والعضو مش صالحة.');
    }
    const { data: result, error } = await supabase
      .rpc('mark_announcement_read', {
        p_announcement_id: announcementId,
        p_member_id: memberId,
        p_device_token: getDeviceToken(),
      });

    if (error) {
      throw toAppError(error, 'معرفناش نعلّم الإعلان كمقروء.');
    }

    return result === true;
  }

  /**
   * مسح الإعلان (إخفاؤه نهائياً من بوابة العضو) — برمز الجهاز.
   */
  static async dismissAnnouncement(
    announcementId: number,
    memberId: number,
  ): Promise<boolean> {
    if (!isPositiveId(announcementId) || !isPositiveId(memberId)) {
      throw toAppError(new Error('INVALID_ID'), 'أرقام الإعلان والعضو مش صالحة.');
    }
    const { data: result, error } = await supabase
      .rpc('dismiss_announcement', {
        p_announcement_id: announcementId,
        p_member_id: memberId,
        p_device_token: getDeviceToken(),
      });

    if (error) {
      throw toAppError(error, 'معرفناش نمسح الإعلان.');
    }

    return result === true;
  }

  // ===== Utility Methods =====

  /**
   * جلب عدد الإعلامات غير المقروءة للعضو
   */
  static async getUnreadCount(memberId: number): Promise<number> {
    const announcements = await this.getMemberAnnouncements(memberId);
    return announcements.filter((ann) => !ann.is_read).length;
  }

  /**
   * تحويل أولوية الإعلان إلى نص عربي
   */
  static getPriorityLabel(priority: string): string {
    const labels: Record<string, string> = {
      low: 'منخفضة',
      normal: 'عادية',
      high: 'عالية',
      urgent: 'عاجلة',
    };
    return labels[priority] || priority;
  }

  /**
   * تحويل نوع الجمهور إلى نص عربي
   */
  static getAudienceLabel(targetAudience: AnnouncementTargetAudience | null | undefined): string {
    if (targetAudience?.type === 'all') {
      return 'كل الأعضاء';
    } else if (targetAudience?.type === 'specific') {
      const count = targetAudience.member_ids?.length || 0;
      return `${count} عضو معين`;
    }
    return 'مش متحدد';
  }
}

export default AnnouncementsAPI;
