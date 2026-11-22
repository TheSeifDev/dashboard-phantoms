import { BookMarked, CalendarCheck2, ClipboardCheck, FolderKanban, LayoutDashboard, ListChecks, Megaphone, Network, Settings, Smartphone } from 'lucide-react';
import type { SidebarGroup } from './AppSidebar';

/**
 * روابط مساحة العمل المشتركة بين بوابة العضو وصفحة التطبيقات.
 * الاتنين لازم يعرضوا نفس السايدبار بالظبط، فأي إضافة بتتحط هنا مرة واحدة.
 */
export const MEMBER_WORKSPACE_GROUPS: SidebarGroup[] = [
  {
    title: 'نظرة عامة',
    items: [
      // `matchSearch` keeps the home pill off while a `?tab=` section is open.
      { to: '/portal', label: 'الرئيسية', icon: LayoutDashboard, end: true, matchSearch: true },
    ],
  },
  {
    title: 'شغلي',
    items: [
      { to: '/portal?tab=TASKS', label: 'مهامي', icon: ListChecks, matchSearch: true },
      { to: '/portal?tab=EVALUATIONS', label: 'تقييماتي', icon: ClipboardCheck, matchSearch: true },
      { to: '/portal/meetings', label: 'اجتماعاتي', icon: CalendarCheck2 },
      { to: '/portal/references', label: 'المصادر', icon: BookMarked },
      { to: '/portal?tab=ANNOUNCEMENTS', label: 'الإعلانات', icon: Megaphone, matchSearch: true },
      { to: '/portal/team', label: 'الفريق الداخلي', icon: Network },
    ],
  },
  {
    title: 'مشروعات الويب',
    items: [{ to: '/portal/projects', label: 'مساحات المشروعات', icon: FolderKanban }],
  },
  {
    title: 'الحساب',
    items: [
      { to: '/portal/settings', label: 'الحساب والإعدادات', icon: Settings },
      { to: '/download', label: 'تطبيقات PHANTOMS', icon: Smartphone, end: true },
    ],
  },
];