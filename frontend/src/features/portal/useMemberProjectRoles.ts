import { useWebQuery } from '../web-projects/api';
import type { WebMembership, WebProject } from '../web-projects/types';

/**
 * أدوار العضو في مشروعات الويب: عضو ولا قائد.
 * نفس استعلامات صفحة المشروعات (متخزنة في React Query) عشان السايدبار والبطاقات
 * تعرف تعرض «لوحة القائد» من غير أي طلب إضافي.
 */
export function useMemberProjectRoles(memberId: number | null | undefined) {
  const enabled = typeof memberId === 'number' && memberId > 0;
  const projects = useWebQuery<WebProject>('member', 'web_projects', undefined, {}, enabled);
  const memberships = useWebQuery<WebMembership>('member', 'web_project_members', undefined, {}, enabled);

  const list = projects.data ?? [];
  const rows = memberships.data ?? [];
  // A project counts for the member when they lead it or hold a membership row for it;
  // the member-mode project query can return more rows than the person is actually on.
  const memberProjectIds = new Set(
    rows
      .filter((row) => row.member_id === memberId && row.status !== 'removed')
      .map((row) => row.project_id),
  );
  const mine = list.filter((project) => project.lead_member_id === memberId || memberProjectIds.has(project.id));
  const ledProjects = mine.filter((project) => project.lead_member_id === memberId);
  const memberProjects = mine.filter((project) => project.lead_member_id !== memberId);

  return {
    isLoading: projects.isLoading || memberships.isLoading,
    isError: projects.isError || memberships.isError,
    projects: mine,
    ledProjects,
    memberProjects,
    memberships: rows,
    isLead: ledProjects.length > 0,
    total: mine.length,
  };
}
