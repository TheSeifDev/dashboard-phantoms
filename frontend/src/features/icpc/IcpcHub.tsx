import { useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  GraduationCap,
  LayoutDashboard,
  ListChecks,
  Trophy,
  Users,
} from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { useLocale } from '../../i18n/useLocale';
import { useIcpcContext } from './api';
import type { IcpcMode } from './types';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { CalendarPage } from './pages/CalendarPage';
import { ContestsPage } from './pages/ContestsPage';
import { KnowledgePage } from './pages/KnowledgePage';
import { OverviewPage } from './pages/OverviewPage';
import { ProblemsPage } from './pages/ProblemsPage';
import { TeamPage } from './pages/TeamPage';
import { TrainingPage } from './pages/TrainingPage';
import './icpc.css';

const TABS = [
  { key: '', icon: LayoutDashboard, ar: 'نظرة عامة', en: 'Overview' },
  { key: 'training', icon: GraduationCap, ar: 'خريطة التدريب', en: 'Training' },
  { key: 'problems', icon: ListChecks, ar: 'بنك المسائل', en: 'Problems' },
  { key: 'contests', icon: Trophy, ar: 'المسابقات', en: 'Contests' },
  { key: 'team', icon: Users, ar: 'أداء الفريق', en: 'Team' },
  { key: 'calendar', icon: CalendarDays, ar: 'التقويم', en: 'Calendar' },
  { key: 'knowledge', icon: BookOpen, ar: 'قاعدة المعرفة', en: 'Knowledge' },
  { key: 'analytics', icon: BarChart3, ar: 'التحليلات', en: 'Analytics' },
] as const;

export function IcpcHub({ mode }: { mode: IcpcMode }) {
  const { t } = useLocale();
  const location = useLocation();
  const context = useIcpcContext(mode);
  const base = mode === 'admin' ? '/admin/icpc' : '/portal/icpc';

  const tab = useMemo(() => {
    const rest = location.pathname.replace(base, '').replace(/^\//, '').split('/')[0] ?? '';
    return TABS.some((entry) => entry.key === rest) ? rest : '';
  }, [location.pathname, base]);

  const page = (() => {
    switch (tab) {
      case 'training':
        return <TrainingPage mode={mode} />;
      case 'problems':
        return <ProblemsPage mode={mode} />;
      case 'contests':
        return <ContestsPage mode={mode} />;
      case 'team':
        return <TeamPage mode={mode} />;
      case 'calendar':
        return <CalendarPage mode={mode} />;
      case 'knowledge':
        return <KnowledgePage mode={mode} />;
      case 'analytics':
        return <AnalyticsPage mode={mode} />;
      default:
        return <OverviewPage mode={mode} />;
    }
  })();

  return (
    <div className="icpc-page">
      <PageHeader
        icon={<Trophy size={22} aria-hidden="true" />}
        title={t('ICPC HUB', 'ICPC HUB')}
        description={t(
          'مركز البرمجة التنافسية: تدريب، بنك مسائل، مسابقات، وأداء الفريق — كله جوه PHANTOMS.',
          'Competitive programming hub: training, problem bank, contests, and team performance — inside PHANTOMS.',
        )}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span className="icpc-chip" data-tone="primary">
              {context.data?.can_manage
                ? t('صلاحية إدارة', 'Manager')
                : t('عرض عضو', 'Member view')}
            </span>
            {context.data?.member_name && <span className="icpc-chip">{context.data.member_name}</span>}
          </div>
        }
      />

      <nav className="icpc-tabs" aria-label={t('أقسام ICPC', 'ICPC sections')}>
        {TABS.map((entry) => (
          <NavLink
            key={entry.key || 'overview'}
            to={entry.key ? `${base}/${entry.key}` : base}
            end={!entry.key}
            className="icpc-tab"
          >
            <entry.icon size={15} aria-hidden="true" />
            {t(entry.ar, entry.en)}
          </NavLink>
        ))}
      </nav>

      {page}
    </div>
  );
}
