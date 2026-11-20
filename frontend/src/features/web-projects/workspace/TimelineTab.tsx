import { useMemo, useState, type CSSProperties, type FormEvent } from "react";
import type { WebDependency, WebMilestone, WebMilestoneProgress, WebTask } from "./types";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  CalendarDays,
  AlertTriangle,
} from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { Field, StatusBadge, Progress } from "../common";
import { useWebMutation, useWebQuery } from "../api";
import { toast } from "../../../store/toast";
import { useLocale } from "../../../i18n/useLocale";
import { dateInputValue } from "./types";
import type { WorkspaceProps } from "./types";
import { TaskDialog } from "./TaskDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { WorkspaceQueryError } from "./WorkspaceQueryError";

const toDay = (v: string | Date) => {
  const d =
    typeof v === "string"
      ? new Date(`${v.slice(0, 10)}T00:00:00`)
      : new Date(v);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};
const daysBetween = (a: Date, b: Date) =>
  Math.round((toDay(b).getTime() - toDay(a).getTime()) / 86400000);

export function TimelineTab({ workspace }: { workspace: WorkspaceProps }) {
  const { t, locale } = useLocale();
  const { projectId, mode, project } = workspace;
  const [period, setPeriod] = useState<"week" | "month">("month");
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<WebMilestone | null>(null);
  const [createMode, setCreateMode] = useState(false);
  const [task, setTask] = useState<WebTask | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WebMilestone | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    phase: "",
    status: "planned",
    start_date: "",
    due_date: "",
    dependency: "",
  });
  const canManage = workspace.isLead || workspace.isProgramAdmin;
  const milestonesQuery = useWebQuery<WebMilestone>(mode, "web_project_milestones",
    projectId,
  );
  const progressQuery = useWebQuery<WebMilestoneProgress>(mode, "web_project_milestone_progress",
    projectId,
  );
  const dependencyQuery = useWebQuery<WebDependency>(mode, "web_project_milestone_dependencies",
    projectId,
  );
  const tasksQuery = useWebQuery<WebTask>(mode, "web_project_tasks", projectId);
  const mutations = useWebMutation(mode);
  const milestones = milestonesQuery.data ?? [];
  const progressMap = new Map(
    (progressQuery.data ?? []).map((x) => [x.milestone_id, x]),
  );
  const start = useMemo(() => {
    const now = new Date();
    if (period === "week") {
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + offset * 7);
      return new Date(
        monday.getFullYear(),
        monday.getMonth(),
        monday.getDate(),
      );
    }
    return new Date(now.getFullYear(), now.getMonth() + offset, 1);
  }, [period, offset]);
  const end = useMemo(() => {
    const d = new Date(start);
    if (period === "week") d.setDate(d.getDate() + 41);
    else d.setMonth(d.getMonth() + 4);
    return d;
  }, [start, period]);
  const totalDays = Math.max(1, daysBetween(start, end));
  const columns =
    period === "week"
      ? Array.from({ length: 6 }, (_, i) => {
          const d = new Date(start);
          d.setDate(d.getDate() + i * 7);
          return d;
        })
      : Array.from(
          { length: 4 },
          (_, i) => new Date(start.getFullYear(), start.getMonth() + i, 1),
        );
  const viewTitle =
    period === "week"
      ? `${start.toLocaleDateString(locale === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "short" })} – ${end.toLocaleDateString(locale === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "short", year: "numeric" })}`
      : start.toLocaleDateString(locale === "ar" ? "ar-EG" : "en-GB", {
          month: "long",
          year: "numeric",
        });
  const openNew = (milestone?: WebMilestone) => {
    setEditing(milestone ?? null);
    setCreateMode(!milestone);
    setForm({
      title: milestone?.title ?? "",
      description: milestone?.description ?? "",
      phase: milestone?.phase ?? "",
      status: milestone?.status ?? "planned",
      start_date: dateInputValue(milestone?.start_date),
      due_date: dateInputValue(milestone?.due_date),
      dependency: milestone
        ? ((dependencyQuery.data ?? []).find(
            (row) => row.milestone_id === milestone.id,
          )?.depends_on_milestone_id ?? "")
        : "",
    });
  };
  const saveMilestone = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    try {
      let id = editing?.id;
      const data = {
        project_id: projectId,
        title: form.title.trim(),
        description: form.description.trim(),
        phase: form.phase.trim(),
        status: form.status,
        start_date: form.start_date || null,
        due_date: form.due_date || null,
      };
      if (editing)
        await mutations.mutateAsync({
          table: "web_project_milestones",
          operation: "update",
          id: editing.id,
          data,
        });
      else {
        const created = await mutations.mutateAsync({
          table: "web_project_milestones",
          operation: "insert",
          data,
        });
        id = typeof created?.id === "string" ? created.id : undefined;
      }
      if (id) {
        const oldDependency = (dependencyQuery.data ?? []).find(
          (row) => row.milestone_id === id,
        );
        if (
          oldDependency?.depends_on_milestone_id !== (form.dependency || null)
        ) {
          if (oldDependency)
            await mutations.mutateAsync({
              table: "web_project_milestone_dependencies",
              operation: "delete",
              id: oldDependency.id,
            });
          if (form.dependency)
            await mutations.mutateAsync({
              table: "web_project_milestone_dependencies",
              operation: "insert",
              data: {
                project_id: projectId,
                milestone_id: id,
                depends_on_milestone_id: form.dependency,
              },
            });
        }
      }
      toast.success(t("تم حفظ المرحلة.", "Milestone saved."));
      setEditing(null);
      setCreateMode(false);
      void milestonesQuery.refetch();
      void dependencyQuery.refetch();
    } catch {
      toast.error(
        t(
          "تعذر حفظ المرحلة أو العلاقة التابعة.",
          "Could not save milestone or dependency.",
        ),
      );
    }
  };
  const remove = async (m: WebMilestone) => {
    if (!canManage) return;
    try {
      await mutations.mutateAsync({ table: "web_project_milestones", operation: "delete", id: m.id });
      void milestonesQuery.refetch();
      toast.success(t("تم حذف المرحلة.", "Milestone deleted."));
    } catch {
      toast.error(t("تعذر حذف المرحلة.", "Could not delete milestone."));
    }
  };
  const changeDependency = async (
    milestoneId: string,
    dependencyId: string,
    existing?: string,
  ) => {
    try {
      if (existing)
        await mutations.mutateAsync({
          table: "web_project_milestone_dependencies",
          operation: "delete",
          id: existing,
        });
      if (dependencyId)
        await mutations.mutateAsync({
          table: "web_project_milestone_dependencies",
          operation: "insert",
          data: {
            project_id: projectId,
            milestone_id: milestoneId,
            depends_on_milestone_id: dependencyId,
          },
        });
      void dependencyQuery.refetch();
    } catch {
      toast.error(
        t(
          "تعذر تحديث الاعتمادية. قد ينتج عن ذلك مسار دائري.",
          "Could not update dependency. The change may create a cycle.",
        ),
      );
    }
  };
  const selectedTasks = tasksQuery.data ?? [];
  const today = toDay(new Date());
  const queryError = milestonesQuery.error ?? progressQuery.error ?? dependencyQuery.error ?? tasksQuery.error;
  if (queryError) return <WorkspaceQueryError error={queryError} queries={[milestonesQuery, progressQuery, dependencyQuery, tasksQuery]} />;
  return (
    <div className="wp-tab-content">
      <div className="wp-toolbar">
        <div
          className="wp-segment"
          role="group"
          aria-label={t("نطاق الجدول الزمني", "Timeline range")}
        >
          <button
            type="button"
            className={period === "week" ? "active" : ""}
            onClick={() => {
              setPeriod("week");
              setOffset(0);
            }}
          >
            {t("أسابيع", "Weeks")}
          </button>
          <button
            type="button"
            className={period === "month" ? "active" : ""}
            onClick={() => {
              setPeriod("month");
              setOffset(0);
            }}
          >
            {t("أشهر", "Months")}
          </button>
        </div>
        <div className="wp-toolbar">
          <Button
            variant="secondary"
            aria-label={t("الفترة السابقة", "Previous period")}
            onClick={() => setOffset((x) => x - 1)}
          >
            <ChevronLeft size={16} />
          </Button>
          <strong>{viewTitle}</strong>
          <Button
            variant="secondary"
            aria-label={t("الفترة التالية", "Next period")}
            onClick={() => setOffset((x) => x + 1)}
          >
            <ChevronRight size={16} />
          </Button>
          <Button variant="secondary" onClick={() => setOffset(0)}>
            {t("اليوم", "Today")}
          </Button>
        </div>
        {canManage && (
          <Button icon={<Plus size={16} />} onClick={() => openNew()}>
            {t("مرحلة جديدة", "New milestone")}
          </Button>
        )}
      </div>
      <div className="wp-panel wp-gantt-wrap">
        <div
          className="wp-gantt"
          style={{ "--gantt-cols": columns.length } as CSSProperties}
        >
          <div className="wp-gantt-head">
            <div className="wp-gantt-name">{t("المرحلة", "Milestone")}</div>
            <div className="wp-gantt-scale">
              {columns.map((d, i) => (
                <span key={i}>
                  {period === "week"
                    ? d.toLocaleDateString(
                        locale === "ar" ? "ar-EG" : "en-GB",
                        { day: "numeric", month: "short" },
                      )
                    : d.toLocaleDateString(
                        locale === "ar" ? "ar-EG" : "en-GB",
                        { month: "short" },
                      )}
                </span>
              ))}
            </div>
          </div>
          {milestones.length === 0 ? (
            <div className="wp-empty-inline">
              {t(
                "لا توجد مراحل بعد. أضف مرحلة لتخطيط التسليمات.",
                "No milestones yet. Add one to plan project delivery.",
              )}
            </div>
          ) : (
            milestones.map((m) => {
              const ms = m.start_date
                ? toDay(m.start_date)
                : m.due_date
                  ? toDay(m.due_date)
                  : start;
              const me = m.due_date
                ? toDay(m.due_date)
                : new Date(ms.getTime() + 7 * 86400000);
              const left = Math.max(
                0,
                (daysBetween(start, ms) / totalDays) * 100,
              );
              const width = Math.max(
                1.5,
                Math.min(
                  100 - left,
                  Math.max(2.2, (daysBetween(ms, me) / totalDays) * 100),
                ),
              );
              const p = progressMap.get(m.id);
              const overdue =
                m.due_date &&
                toDay(m.due_date) < today &&
                !["completed", "cancelled"].includes(m.status);
              const deps = (dependencyQuery.data ?? []).filter(
                (d) => d.milestone_id === m.id,
              );
              return (
                <div className="wp-gantt-row" key={m.id}>
                  <button
                    className="wp-gantt-name"
                    type="button"
                    onClick={() => openNew(m)}
                  >
                    <b>{m.title}</b>
                    <span>{m.phase || project.name}</span>
                    <small>
                      {m.due_date
                        ? new Date(`${m.due_date}T00:00:00`).toLocaleDateString(
                            locale === "ar" ? "ar-EG" : "en-GB",
                          )
                        : t("بدون موعد", "No due date")}
                    </small>
                  </button>
                  <div className="wp-gantt-track">
                    <div className="wp-gantt-gridlines">
                      {columns.map((_, i) => (
                        <span key={i} />
                      ))}
                    </div>
                    {ms <= end && me >= start && (
                      <button
                        type="button"
                        className={`wp-gantt-bar ${overdue ? "is-overdue" : ""} ${m.status === "completed" ? "is-done" : ""}`}
                        style={{ left: `${left}%`, width: `${width}%` }}
                        title={`${m.title} · ${p?.progress_percent ?? "—"}%`}
                        onClick={() => openNew(m)}
                      >
                        <span>{m.title}</span>
                        {Number.isFinite(p?.progress_percent) && (
                          <i
                            style={{
                              width: `${Math.min(100, Number(p?.progress_percent ?? 0))}%`,
                            }}
                          />
                        )}
                      </button>
                    )}
                    {m.status !== "completed" && (
                      <span
                        className="wp-today-line"
                        style={{
                          left: `${Math.max(0, Math.min(100, (daysBetween(start, today) / totalDays) * 100))}%`,
                        }}
                      />
                    )}
                  </div>
                  <div className="wp-gantt-meta">
                    <StatusBadge status={overdue ? "overdue" : m.status} />
                    <Progress
                      done={p?.completed_item_count ?? 0}
                      total={p?.tracked_item_count ?? 0}
                    />
                  </div>
                  <div className="wp-gantt-extra">
                    {overdue && (
                      <span className="wp-overdue">
                        <AlertTriangle size={13} />
                        {t("متأخرة", "Overdue")}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        const target = selectedTasks.find(
                          (task) => task.milestone_id === m.id,
                        );
                        if (target) setTask(target);
                        else
                          toast.info(
                            t(
                              "لا توجد مهام مرتبطة بهذه المرحلة.",
                              "No tasks are linked to this milestone.",
                            ),
                          );
                      }}
                    >
                      {t("المهام", "Tasks")} (
                      {p?.linked_task_count ??
                        selectedTasks.filter(
                          (task) => task.milestone_id === m.id,
                        ).length}
                      )
                    </button>
                  </div>
                  {canManage && (
                    <select
                      aria-label={t("اعتمادية المرحلة", "Milestone dependency")}
                      value={deps[0]?.depends_on_milestone_id ?? ""}
                      onChange={(e) =>
                        void changeDependency(m.id, e.target.value, deps[0]?.id)
                      }
                    >
                      <option value="">
                        {t("لا تعتمد على", "No dependency")}
                      </option>
                      {milestones
                        .filter((candidate) => candidate.id !== m.id)
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.title}
                          </option>
                        ))}
                    </select>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
      <div className="wp-panel wp-milestone-list">
        <h3>
          <CalendarDays size={17} />
          {t("الجدول المخطط", "Milestone schedule")}
        </h3>
        {milestones.map((m) => {
          const p = progressMap.get(m.id);
          return (
            <article key={m.id}>
              <div>
                <strong>{m.title}</strong>
                <span>{m.phase || t("مرحلة", "Phase")}</span>
              </div>
              <div>
                {m.start_date
                  ? new Date(`${m.start_date}T00:00:00`).toLocaleDateString(
                      locale === "ar" ? "ar-EG" : "en-GB",
                    )
                  : "—"}{" "}
                →{" "}
                {m.due_date
                  ? new Date(`${m.due_date}T00:00:00`).toLocaleDateString(
                      locale === "ar" ? "ar-EG" : "en-GB",
                    )
                  : "—"}
              </div>
              <Progress
                done={p?.completed_item_count ?? 0}
                total={p?.tracked_item_count ?? 0}
              />
              <div className="wp-toolbar">
                {canManage && (
                  <>
                    <Button variant="secondary" onClick={() => openNew(m)}>
                      {t("تعديل", "Edit")}
                    </Button>
                    <Button variant="danger" onClick={() => setPendingDelete(m)}>
                      {t("حذف", "Delete")}
                    </Button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const target = selectedTasks.find(
                      (task) => task.milestone_id === m.id,
                    );
                    if (target) setTask(target);
                  }}
                >
                  {t("فتح المهمة المرتبطة", "Open linked task")}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {(editing !== null || createMode) && (
        <Modal
          isOpen
          title={
            editing
              ? t("تعديل المرحلة", "Edit milestone")
              : t("مرحلة جديدة", "New milestone")
          }
          onClose={() => { setEditing(null); setCreateMode(false); }}
          maxWidth="lg"
          footer={
            <>
              <Button variant="secondary" onClick={() => { setEditing(null); setCreateMode(false); }}>
                {t("إغلاق", "Close")}
              </Button>
              {canManage && (
                <Button type="submit" form="milestone-form">
                  {t("حفظ", "Save")}
                </Button>
              )}
            </>
          }
        >
          <form
            id="milestone-form"
            onSubmit={saveMilestone}
            className="wp-grid"
          >
            <Field label={t("العنوان", "Title")}>
              <input
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Field>
            <Field label={t("المرحلة / المسار", "Phase")}>
              <input
                value={form.phase}
                onChange={(e) => setForm({ ...form, phase: e.target.value })}
              />
            </Field>
            <Field label={t("الحالة", "Status")}>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option value="planned">{t("مخططة", "Planned")}</option>
                <option value="in_progress">{t("جارية", "In progress")}</option>
                <option value="completed">{t("مكتملة", "Completed")}</option>
                <option value="blocked">{t("متوقفة", "Blocked")}</option>
              </select>
            </Field>
            <Field label={t("تبدأ في", "Starts")}>
              <input
                type="date"
                value={form.start_date}
                onChange={(e) =>
                  setForm({ ...form, start_date: e.target.value })
                }
              />
            </Field>
            <Field label={t("تاريخ الاستحقاق", "Due date")}>
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              />
            </Field>
            <Field label={t("تعتمد على", "Depends on")}>
              <select
                value={form.dependency}
                onChange={(e) =>
                  setForm({ ...form, dependency: e.target.value })
                }
              >
                <option value="">{t("لا يوجد", "None")}</option>
                {milestones
                  .filter((m) => m.id !== editing?.id)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title}
                    </option>
                  ))}
              </select>
            </Field>
            <div className="wp-span-all">
              <Field label={t("الوصف", "Description")}>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </Field>
            </div>
          </form>
        </Modal>
      )}
      <ConfirmDialog
        isOpen={Boolean(pendingDelete)}
        title={t("حذف المرحلة", "Delete milestone")}
        message={t("قد تمنع المهام أو التسليمات المرتبطة حذف المرحلة.", "Linked tasks or deliverables may prevent deleting this milestone.")}
        confirmLabel={t("حذف المرحلة", "Delete milestone")}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => { if (pendingDelete) void remove(pendingDelete); setPendingDelete(null); }}
      />
      {task && (
        <TaskDialog
          workspace={workspace}
          task={task}
          onClose={() => setTask(null)}
          onSaved={() => void tasksQuery.refetch()}
        />
      )}
    </div>
  );
}
