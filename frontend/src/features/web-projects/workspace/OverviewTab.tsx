import { useMemo } from "react";
import type { WebActivity, WebDeliverable, WebMilestone, WebMilestoneProgress, WebProjectProgress, WebTask, WebUpdate } from "./types";
import {
  Activity,
  CalendarClock,
  CheckSquare,
  ExternalLink,
  Users,
  AlertTriangle,
} from "lucide-react";
import { Progress, SafeLink, StatusBadge } from "../common";
import { useWebQuery } from "../api";
import { isOverdue, trackedProgress } from "../domain";
import { useLocale } from "../../../i18n/useLocale";
import type { WorkspaceProps } from "./types";
import { WorkspaceQueryError } from "./WorkspaceQueryError";

export function OverviewTab({
  workspace,
  onOpenTask,
}: {
  workspace: WorkspaceProps;
  onOpenTask: (task: WebTask) => void;
}) {
  const { t, locale } = useLocale();
  const { projectId, project, mode, roster } = workspace;
  const tasksQ = useWebQuery<WebTask>(mode, "web_project_tasks", projectId);
  const milestonesQ = useWebQuery<WebMilestone>(mode, "web_project_milestones",
    projectId,
  );
  const progressQ = useWebQuery<WebProjectProgress>(mode, "web_project_progress", projectId);
  const milestoneProgressQ = useWebQuery<WebMilestoneProgress>(mode, "web_project_milestone_progress",
    projectId,
  );
  const updatesQ = useWebQuery<WebUpdate>(mode, "web_project_updates", projectId);
  const activityQ = useWebQuery<WebActivity>(mode, "web_project_activity_logs",
    projectId,
  );
  const deliverablesQ = useWebQuery<WebDeliverable>(mode, "web_project_deliverables",
    projectId,
  );
  const tasks = tasksQ.data ?? [];
  const milestones = milestonesQ.data ?? [];
  const progress = (progressQ.data ?? [])[0];
  const workload = trackedProgress(tasks);
  const mp = new Map<string, WebMilestoneProgress>(
    (milestoneProgressQ.data ?? []).map((m) => [m.milestone_id, m]),
  );
  const upcoming = useMemo(() => {
    const taskDates = tasks.filter((item) => item.due_date && !["done", "cancelled"].includes(item.status))
      .map((item) => ({ id: item.id, title: item.title, due_date: item.due_date as string, kind: "task" as const, task: item }));
    const milestoneDates = milestones.filter((item) => item.due_date && item.status !== "completed")
      .map((item) => ({ id: item.id, title: item.title, due_date: item.due_date as string, kind: "milestone" as const }));
    return [...taskDates, ...milestoneDates].sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 6);
  }, [tasks, milestones]);
  const blockers = (updatesQ.data ?? []).filter(
    (x) => x.update_type === "blocker" && x.blocker_status !== "resolved",
  );
  const recentTasks = tasks
    .slice()
    .sort((a, b) =>
      (b.updated_at ?? "").localeCompare(a.updated_at ?? ""),
    )
    .slice(0, 5);
  const activities = (activityQ.data ?? [])
    .slice()
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .slice(0, 7);
  const currentMilestone =
    milestones.find((m) => m.status === "in_progress") ??
    milestones.find((m) => m.status === "planned");
  const queryError = tasksQ.error ?? milestonesQ.error ?? progressQ.error ?? milestoneProgressQ.error ?? updatesQ.error ?? activityQ.error ?? deliverablesQ.error;
  if (queryError) return <WorkspaceQueryError error={queryError} queries={[tasksQ, milestonesQ, progressQ, milestoneProgressQ, updatesQ, activityQ, deliverablesQ]} />;
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Africa/Cairo",
  });
  return (
    <div className="wp-tab-content">
      <div className="wp-overview-hero">
        <div>
          <p className="wp-kicker">
            {project.category || t("منتج مستقل", "Independent product")}
          </p>
          <h2>{project.name}</h2>
          <p>{project.short_description || project.description}</p>
          <div className="wp-toolbar">
            <StatusBadge status={project.status} />
            {project.expected_delivery_date && (
              <span>
                <CalendarClock size={15} />
                {t("التسليم المتوقع", "Expected delivery")}:{" "}
                {project.expected_delivery_date}
              </span>
            )}
          </div>
        </div>
        <div className="wp-project-lead-card">
          <Users size={17} />
          <span>{t("القائد", "Project lead")}</span>
          <strong>
            {roster.find((m) => m.member_id === project.lead_member_id)
              ?.full_name ?? t("غير معيّن", "Unassigned")}
          </strong>
          <small>
            {roster.filter((m) => m.status === "active").length}{" "}
            {t("عضو نشط", "active members")}
          </small>
        </div>
      </div>
      <div className="wp-metrics">
        <div className="wp-metric">
          <strong>{progress?.task_count ?? workload.total}</strong>
          <span>{t("مهام متتبعة", "Tracked tasks")}</span>
        </div>
        <div className="wp-metric">
          <strong>{progress?.completed_task_count ?? workload.done}</strong>
          <span>{t("مهام مكتملة", "Completed tasks")}</span>
        </div>
        <div className="wp-metric">
          <strong>{blockers.length}</strong>
          <span>{t("عوائق مفتوحة", "Open blockers")}</span>
        </div>
        <div className="wp-metric">
          <strong>
            {
              (deliverablesQ.data ?? []).filter(
                (x) => x.status === "submitted",
              ).length
            }
          </strong>
          <span>{t("تسليمات للمراجعة", "Deliverables to review")}</span>
        </div>
      </div>
      <div className="wp-overview-grid">
        <section className="wp-panel">
          <header className="wp-row">
            <h2>{t("التقدم المسجل", "Tracked progress")}</h2>
            <Progress
              done={progress?.completed_task_count ?? workload.done}
              total={progress?.task_count ?? workload.total}
            />
          </header>
          <p className="wp-muted">
            {t(
              "التقدم مشتق من المهام الفعلية؛ لا تُعرض نسبة عند غياب عمل متتبع.",
              "Progress is derived from persisted tasks; no percentage is claimed without tracked work.",
            )}
          </p>
          {currentMilestone && (
            <div className="wp-current-milestone">
              <small>{t("المرحلة الحالية", "Current milestone")}</small>
              <b>{currentMilestone.title}</b>
              <StatusBadge status={currentMilestone.status} />
              <Progress
                done={mp.get(currentMilestone.id)?.completed_item_count ?? 0}
                total={mp.get(currentMilestone.id)?.tracked_item_count ?? 0}
              />
            </div>
          )}
          <h3>{t("أقرب المواعيد", "Upcoming deadlines")}</h3>
          {upcoming.length ? (
            <div className="wp-deadline-list">
              {upcoming.map((item) => {
                const late = isOverdue(item.due_date, false, today);
                return (
                  <div key={`${item.kind}-${item.id}`}>
                    <span>
                      {item.kind === "milestone"
                        ? t("مرحلة", "Milestone")
                        : t("مهمة", "Task")}
                    </span>
                    <button
                      onClick={() => { if (item.kind === "task") onOpenTask(item.task); }}
                    >
                      {item.title}
                    </button>
                    <time className={late ? "wp-overdue" : ""}>
                      {item.due_date}
                    </time>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="wp-empty-inline">
              {t(
                "لا توجد مواعيد قادمة مسجلة.",
                "No upcoming deadlines recorded.",
              )}
            </p>
          )}
        </section>
        <section className="wp-panel">
          <header className="wp-row">
            <h2>
              <CheckSquare size={17} />
              {t("آخر المهام", "Recent tasks")}
            </h2>
          </header>
          {recentTasks.length ? (
            <div className="wp-recent-task-list">
              {recentTasks.map((task) => (
                <button key={task.id} onClick={() => onOpenTask(task)}>
                  <span>
                    <b>{task.title}</b>
                    <small>
                      {task.due_date
                        ? `${t("الاستحقاق", "Due")} ${task.due_date}`
                        : t("بدون موعد", "No due date")}
                    </small>
                  </span>
                  <StatusBadge status={task.status} />
                </button>
              ))}
            </div>
          ) : (
            <p className="wp-empty-inline">
              {t("لا توجد مهام مرتبطة بالمشروع بعد.", "No project tasks yet.")}
            </p>
          )}
        </section>
        <section className="wp-panel">
          <h2>
            <AlertTriangle size={17} />
            {t("العوائق المفتوحة", "Open blockers")}
          </h2>
          {blockers.length ? (
            blockers.map((item) => (
              <article className="wp-blocker-card" key={item.id}>
                <div className="wp-row">
                  <b>{item.title}</b>
                  <StatusBadge status={item.blocker_status} />
                </div>
                <p>{item.body}</p>
                <small>
                  {roster.find((m) => m.member_id === item.author_member_id)
                    ?.full_name ?? `#${item.author_member_id}`}
                </small>
              </article>
            ))
          ) : (
            <p className="wp-empty-inline">
              {t("لا توجد عوائق مفتوحة.", "No open blockers.")}
            </p>
          )}
        </section>
        <section className="wp-panel">
          <h2>
            <Activity size={17} />
            {t("آخر النشاط", "Recent activity")}
          </h2>
          {activities.length ? (
            <div className="wp-activity">
              {activities.map((event) => (
                <article key={event.id}>
                  <b>{event.action?.replaceAll("_", " ")}</b>
                  <span>
                    {event.entity_type} ·{" "}
                    {event.occurred_at
                      ? new Date(event.occurred_at).toLocaleString(
                          locale === "ar" ? "ar-EG" : "en-GB",
                        )
                      : ""}
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <p className="wp-empty-inline">
              {t("لا يوجد نشاط مسجل بعد.", "No activity recorded yet.")}
            </p>
          )}
        </section>
        <section className="wp-panel">
          <h2>{t("معلومات المنتج والروابط", "Product context & links")}</h2>
          <p className="wp-detail-copy">
            {project.description ||
              t(
                "لم يسجل وصف تفصيلي بعد.",
                "No detailed description recorded yet.",
              )}
          </p>
          <dl className="wp-product-context">
            {[
              ["Problem", project.problem_statement],
              ["Solution", project.proposed_solution],
              ["Audience", project.target_audience],
              ["PHANTOMS benefit", project.phantoms_benefit],
            ].map(
              ([label, value]) =>
                value && (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ),
            )}
          </dl>
          <div className="wp-project-links">
            {[
              ["Repository", project.repository_url],
              ["Live demo", project.live_demo_url],
              ["Figma", project.figma_url],
              ["Documentation", project.documentation_url],
            ].map(([label, url]) => (
              <div key={label}>
                <span>{label}</span>
                <SafeLink href={url}>
                  <ExternalLink size={14} />
                  {url || t("غير متاح", "Not set")}
                </SafeLink>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
