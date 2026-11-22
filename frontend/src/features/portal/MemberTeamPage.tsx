import { Link } from 'react-router-dom';
import { ArrowUpRight, Crown, Layers, Network, Users } from 'lucide-react';
import { useAuthStore } from '../../store/auth';
import { useLocale } from '../../i18n/useLocale';
import { useMemberTeams } from './useMemberTeams';
import { useMemberProjectRoles } from './useMemberProjectRoles';
import { ErrorState } from '../../components/ui/ErrorState';
import { PhantomLoader } from '../../components/motion/PhantomLoader';

const STATUS_LABEL: Record<string, { ar: string; en: string; tone: 'ok' | 'wait' }> = {
  approved: { ar: 'عضوية معتمدة', en: 'Approved', tone: 'ok' },
  active: { ar: 'نشط', en: 'Active', tone: 'ok' },
  pending: { ar: 'بانتظار الموافقة', en: 'Pending approval', tone: 'wait' },
  rejected: { ar: 'مرفوض', en: 'Rejected', tone: 'wait' },
};

/** الفريق الداخلي (AI / Software / Hardware) + دور العضو في مشروعات الويب. */
export default function MemberTeamPage() {
  const member = useAuthStore((state) => state.currentMember);
  const { t, number } = useLocale();
  const teams = useMemberTeams(member?.id);
  const roles = useMemberProjectRoles(member?.id);

  if (teams.isLoading || roles.isLoading) return <PhantomLoader message={t('بنحمّل فرقك...', 'Loading your teams...')} />;
  if (teams.isError) {
    return <ErrorState message={t('معرفناش نحمّل فرقك الداخلية.', 'Could not load your internal teams.')} onRetry={() => { void teams.refetch(); }} />;
  }

  const list = teams.data ?? [];

  return (
    <div className="grid gap-5">
      <section className="grid gap-3">
        <div className="flex items-baseline justify-between gap-3 px-1">
          <h2 className="text-base font-black">{t('الفريق الداخلي', 'My internal team')}</h2>
          <p className="text-xs text-[var(--text-muted)]">{t('AI · Software · Hardware', 'AI · Software · Hardware')}</p>
        </div>

        {list.length === 0 ? (
          <article className="grid justify-items-start gap-2 rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--surface)] p-5">
            <span className="grid size-9 place-items-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)]" aria-hidden="true"><Network size={18} /></span>
            <h3 className="text-sm font-black">{t('مش متوزع على فريق داخلي لسه', 'Not assigned to an internal team yet')}</h3>
            <p className="text-xs leading-relaxed text-[var(--text-muted)]">
              {t('التوزيع بيتم من الإدارة على فرق AI أو Software أو Hardware. أول ما تتضاف هتلاقي الفريق هنا.', 'Administration assigns you to AI, Software or Hardware. Once you are added, your team appears here.')}
            </p>
          </article>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((team) => {
              const status = STATUS_LABEL[team.status] ?? { ar: team.status, en: team.status, tone: 'wait' as const };
              return (
                <article key={team.team_id} className="grid gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="grid size-9 place-items-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)]" aria-hidden="true"><Users size={18} /></span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10.5px] font-black ${
                        status.tone === 'ok'
                          ? 'bg-[color-mix(in_oklab,var(--success)_16%,transparent)] text-[var(--success-text)]'
                          : 'bg-[color-mix(in_oklab,var(--chart-amber)_18%,transparent)] text-[var(--text)]'
                      }`}
                    >
                      {t(status.ar, status.en)}
                    </span>
                  </div>
                  <h3 className="text-base font-black">{team.name}</h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    {team.approved_at ? t(`معتمد من ${team.approved_at.slice(0, 10)}`, `Approved ${team.approved_at.slice(0, 10)}`) : t('العضوية تحت المراجعة.', 'Membership under review.')}
                  </p>
                </article>
              );
            })}
          </div>
        )}
        <p className="px-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
          {t(
            'عضوية الفريق الداخلي مستقلة عن عضويات مشروعات الويب: ممكن تكون في فريق AI وفي نفس الوقت عضو أو قائد مشروع ويب.',
            'Internal team membership is separate from web project membership: you can be in the AI team and still be a member or lead of a web project.',
          )}
        </p>
      </section>

      <section className="grid gap-3">
        <div className="flex items-baseline justify-between gap-3 px-1">
          <h2 className="text-base font-black">{t('دورك في مشروعات الويب', 'Your web project role')}</h2>
          <Link to="/portal/projects" className="inline-flex items-center gap-1 text-xs font-black text-[var(--link)] hover:underline">
            {t('افتح المشروعات', 'Open projects')}
            <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
        </div>

        {roles.isError ? (
          <article className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 text-xs text-[var(--text-muted)]">
            {t('مقدرناش نقرأ عضويات المشروعات دلوقتي.', 'Project memberships could not be read right now.')}
          </article>
        ) : roles.total === 0 ? (
          <article className="grid justify-items-start gap-2 rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--surface)] p-5">
            <span className="grid size-9 place-items-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)]" aria-hidden="true"><Layers size={18} /></span>
            <h3 className="text-sm font-black">{t('مفيش مشروعات ويب لسه', 'No web projects yet')}</h3>
            <p className="text-xs leading-relaxed text-[var(--text-muted)]">
              {t('المشروعات بتظهر بعد ما تتضاف وتقبل اتفاق المشروع.', 'Projects appear after you are added and accept the project agreement.')}
            </p>
          </article>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <article className="grid gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex items-center gap-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)]" aria-hidden="true"><Layers size={18} /></span>
                <h3 className="min-w-0 flex-1 text-sm font-black">{t('عضو في مشروعات', 'Projects as member')}</h3>
                <strong className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-xs font-black tabular-nums">{number(roles.memberProjects.length)}</strong>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">{t('بتشتغل مع الفريق تحت قيادة قائد المشروع', 'You work with the team under the project lead')}</p>
              <p className="text-xs font-bold text-[var(--text)]" dir="auto">
                {roles.memberProjects.length > 0
                  ? roles.memberProjects.slice(0, 3).map((project) => project.name).join(' · ')
                  : t('مش عضو في مشروع حاليًا.', 'Not a member of any project right now.')}
              </p>
            </article>

            <article className="grid gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex items-center gap-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)]" aria-hidden="true"><Crown size={18} /></span>
                <h3 className="min-w-0 flex-1 text-sm font-black">{t('قائد مشروع', 'Projects you lead')}</h3>
                <strong className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-xs font-black tabular-nums">{number(roles.ledProjects.length)}</strong>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">{t('صلاحياتك جوه المشروع زي المالك', 'Owner-level access inside the project')}</p>
              <p className="text-xs font-bold text-[var(--text)]" dir="auto">
                {roles.ledProjects.length > 0
                  ? roles.ledProjects.map((project) => project.name).join(' · ')
                  : t('مش قائد مشروع حاليًا.', 'You are not leading a project right now.')}
              </p>
              {roles.isLead && (
                <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                  {t(
                    'كقائد بتشوف نفس شاشة المالك جوه مساحة المشروع: مراجعة التسليمات، إدارة الفريق والاتفاق، واعتماد التقارير.',
                    'As lead you get the owner view inside the project workspace: review deliverables, manage the team and agreement, and approve reports.',
                  )}
                </p>
              )}
            </article>
          </div>
        )}
      </section>
    </div>
  );
}
