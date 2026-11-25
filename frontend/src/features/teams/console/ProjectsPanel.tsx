import { useMemo, useState } from 'react';
import { ExternalLink, FileBarChart2, FolderKanban, Layers3 } from 'lucide-react';
import { useLocale } from '../../../i18n/useLocale';
import type { TeamConsole } from '../../../types/db';
import { PanelShell, StateChip } from './shared';

type ProjectTab = 'tasks' | 'reports' | 'resources';

export function ProjectsPanel({ data }: { data: TeamConsole }) {
  const { t, number, date } = useLocale();
  const [tab, setTab] = useState<ProjectTab>('tasks');

  const counts = useMemo(() => ({
    tasks: data.project_tasks.length,
    reports: data.project_reports.length,
    resources: data.resources.length,
  }), [data]);

  return (
    <PanelShell
      id="tmc-projects"
      kicker={<><FolderKanban size={14} aria-hidden="true" />{t('المشروعات', 'Projects')}</>}
      title={t('مشروعات أعضاء الفريق', 'Projects of this team’s members')}
      hint={t('كل حاجة هنا مربوطة بأعضاء الفريق النشطين في مشروعات الويب — مهام وتقارير وموارد.', 'Everything here is tied to this team’s active members across web projects: tasks, reports, and resources.')}
      actions={(
        <div className="tmc-segmented tmc-segmented--sm" role="group" aria-label={t('أقسام المشروعات', 'Project sections')}>
          <button type="button" className={tab === 'tasks' ? 'is-active' : ''} onClick={() => setTab('tasks')}>
            {t('المهام', 'Tasks')} <span className="tmc-count">{number(counts.tasks)}</span>
          </button>
          <button type="button" className={tab === 'reports' ? 'is-active' : ''} onClick={() => setTab('reports')}>
            {t('التقارير', 'Reports')} <span className="tmc-count">{number(counts.reports)}</span>
          </button>
          <button type="button" className={tab === 'resources' ? 'is-active' : ''} onClick={() => setTab('resources')}>
            {t('الموارد', 'Resources')} <span className="tmc-count">{number(counts.resources)}</span>
          </button>
        </div>
      )}
    >
      {tab === 'tasks' && (
        data.project_tasks.length === 0
          ? <p className="tmc-note">{t('مفيش مهام مشروعات مرتبطة بأعضاء الفريق.', 'No project tasks linked to this team’s members.')}</p>
          : (
            <ul className="tmc-proj-list">
              {data.project_tasks.map((task) => (
                <li key={`${task.project_id}-${task.id}`} className="tmc-proj" data-tmc-anim>
                  <div>
                    <strong>{task.title}</strong>
                    <small>{task.project_name}</small>
                  </div>
                  <div className="tmc-proj-meta">
                    <StateChip tone="accent">{task.status}</StateChip>
                    {task.priority ? <StateChip tone="muted">{task.priority}</StateChip> : null}
                    <span>{task.due_date ? date(task.due_date) : t('بدون ميعاد', 'No due date')}</span>
                  </div>
                </li>
              ))}
            </ul>
          )
      )}
      {tab === 'reports' && (
        data.project_reports.length === 0
          ? <p className="tmc-note">{t('مفيش تقارير أسبوعية من أعضاء الفريق.', 'No weekly reports from this team’s members.')}</p>
          : (
            <ul className="tmc-proj-list">
              {data.project_reports.map((report) => (
                <li key={`${report.project_id}-${report.id}`} className="tmc-proj tmc-proj--report" data-tmc-anim>
                  <div>
                    <strong><FileBarChart2 size={13} aria-hidden="true" />{report.member_name}</strong>
                    <small>{report.project_name}{report.period_start ? ` · ${date(report.period_start)}` : ''}</small>
                  </div>
                  <p className="tmc-proj-text">{report.completed_this_week || t('مفيش تفاصيل مكتوبة.', 'No written details.')}</p>
                  {report.blockers ? <p className="tmc-proj-blocker">{t('عوائق', 'Blockers')}: {report.blockers}</p> : null}
                  <StateChip tone={report.status === 'approved' ? 'primary' : 'muted'}>{report.status}</StateChip>
                </li>
              ))}
            </ul>
          )
      )}
      {tab === 'resources' && (
        data.resources.length === 0
          ? <p className="tmc-note">{t('مفيش موارد مرفوعة على مشروعات الفريق.', 'No resources uploaded for this team’s projects.')}</p>
          : (
            <ul className="tmc-proj-list">
              {data.resources.map((resource) => {
                const href = resource.external_url ?? resource.preview_url;
                return (
                  <li key={`${resource.project_name}-${resource.id}`} className="tmc-proj" data-tmc-anim>
                    <div>
                      <strong><Layers3 size={13} aria-hidden="true" />{resource.title}</strong>
                      <small>{resource.project_name} · {resource.category}</small>
                    </div>
                    <div className="tmc-proj-meta">
                      <StateChip tone="muted">{resource.access_status}</StateChip>
                      {href ? (
                        <a href={href} target="_blank" rel="noreferrer noopener" className="tmc-link">
                          {t('فتح', 'Open')}<ExternalLink size={13} aria-hidden="true" />
                        </a>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )
      )}
    </PanelShell>
  );
}
