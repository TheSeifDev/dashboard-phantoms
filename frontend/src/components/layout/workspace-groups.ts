import { BarChart3, BookMarked, BookOpen, CalendarCheck2, CalendarDays, ClipboardCheck, FolderKanban, GraduationCap, LayoutDashboard, ListChecks, Megaphone, Network, Settings, Smartphone, Swords, Trophy, Wallet } from 'lucide-react';
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
      { to: '/portal/ledger', label: 'خزنة التيم', icon: Wallet },
      { to: '/portal/ranking', label: 'ترتيب الفريق', icon: Trophy },
      { to: '/portal?tab=ANNOUNCEMENTS', label: 'الإعلانات', icon: Megaphone, matchSearch: true },
      { to: '/portal/team', label: 'الفريق الداخلي', icon: Network },
    ],
  },
  {
    title: 'البرمجة التنافسية',
    items: [
      { to: '/portal/icpc', label: 'ICPC Hub', icon: Swords, end: true },
      { to: '/portal/icpc/training', label: 'خريطة التدريب', icon: GraduationCap },
      { to: '/portal/icpc/problems', label: 'بنك المسائل', icon: ListChecks },
      { to: '/portal/icpc/contests', label: 'المسابقات', icon: Trophy },
      { to: '/portal/icpc/team', label: 'أداء الفريق', icon: Network },
      { to: '/portal/icpc/calendar', label: 'تقويم التدريب', icon: CalendarDays },
      { to: '/portal/icpc/knowledge', label: 'قاعدة المعرفة', icon: BookOpen },
      { to: '/portal/icpc/analytics', label: 'التحليلات', icon: BarChart3 },
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
