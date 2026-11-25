import { useEffect } from 'react';
import { useAuthStore } from '../../store/auth';
import { useGithubLinkState } from '../members/github-link-api';

/**
 * صورة الهوية في بوابة الأعضاء.
 *
 * بروفايل جلسة العضو (`lookup_member_by_email`) بيرجع أعمدة عامة بس — من غير
 * `portfolio_url` ولا `custom_fields` — فالصورة كانت بتقع على الحرف الأول.
 * الـ RPC المحصور `member_github_state` بيرجع الـ handle بتاع العضو نفسه، وهنا
 * بنحفظه في الـ store (وبيتخزن مع الجلسة) عشان `MemberAvatar` يلاقيه في
 * السايدبار والهيرو وأي مكان تاني من غير أي تمرير يدوي.
 */
export function useIdentityAvatarHandle(): string | null {
  const member = useAuthStore((state) => state.currentMember);
  const setMember = useAuthStore((state) => state.setMember);
  const { data } = useGithubLinkState({ enabled: Boolean(member?.id) });
  const handle = data?.handle ?? null;

  useEffect(() => {
    if (!member || !handle || member.github_handle === handle) return;
    setMember({ ...member, github_handle: handle });
  }, [handle, member, setMember]);

  return handle ?? member?.github_handle ?? null;
}
