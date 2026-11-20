import { useMemo, useState, type FormEvent } from "react";
import type { WebAssignee, WebSprint, WebSprintProgress, WebTask } from "./types";
import { Plus, CalendarRange, GripVertical } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { Field, StatusBadge, Progress } from "../common";
import { useWebMutation, useWebQuery, useWebRpc } from "../api";
import { toast } from "../../../store/toast";
import { useLocale } from "../../../i18n/useLocale";
import {
  BOARD_STATUSES,
  PRIORITIES,
  labelStatus,
  dateInputValue,
} from "./types";
import type { Task, WorkspaceProps } from "./types";
import { TaskDialog } from "./TaskDialog";
import { WorkspaceQueryError } from "./WorkspaceQueryError";

export function AgileTab({ workspace }: { workspace: WorkspaceProps }) {
  const { t, locale } = useLocale();
  const { projectId, mode, roster, currentMemberId } = workspace;
  const canManage = workspace.isLead || workspace.isProgramAdmin;
  const tasksQuery = useWebQuery<WebTask>(mode, "web_project_tasks", projectId);
  const assigneesQuery = useWebQuery<WebAssignee>(mode, "web_project_task_assignees",
    projectId,
  );
  const sprintsQuery = useWebQuery<WebSprint>(mode, "web_project_sprints", projectId);
  const sprintProgressQuery = useWebQuery<WebSprintProgress>(mode, "web_project_sprint_progress",
    projectId,
  );
  const mutation = useWebMutation(mode);
  const rpc = useWebRpc(mode);
  const [task, setTask] = useState<Task | null>(null);
  const [sprintModal, setSprintModal] = useState(false);
  const [sprintEdit, setSprintEdit] = useState<WebSprint | null>(null);
  const [filters, setFilters] = useState({
    sprint: "",
    priority: "",
    assignee: "",
    status: "",
  });
  const [sprintForm, setSprintForm] = useState({
    name: "",
    goal: "",
    starts_on: "",
    ends_on: "",
    retrospective_notes: "",
  });
  const assignees = assigneesQuery.data ?? [];
  const sprints = sprintsQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const progressById = new Map(
    (sprintProgressQuery.data ?? []).map((p) => [p.sprint_id, p]),
  );
  const filtered = useMemo(
    () =>
      tasks.filter((row) => {
        const links = assignees.filter((a) => a.task_id === row.id);
        return (
          (!filters.sprint || row.sprint_id === filters.sprint) &&
          (!filters.priority || row.priority === filters.priority) &&
          (!filters.status || row.status === filters.status) &&
          (!filters.assignee ||
            links.some((a) => String(a.member_id) === filters.assignee))
        );
      }),
    [tasks, assignees, filters],
  );
  const changeStatus = async (taskRow: WebTask, status: string) => {
    try {
      await rpc.mutateAsync({
        name: "web_transition_project_task",
        args: { p_task_id: taskRow.id, p_to_status: status, p_comment: null },
      });
      toast.success(t("تم تحديث حالة المهمة.", "Task status updated."));
      void tasksQuery.refetch();
    } catch {
      toast.error(
        t(
          "انتقال الحالة غير صالح أو غير مسموح.",
          "That workflow transition is invalid or not permitted.",
        ),
      );
    }
  };
  const openSprint = (sprint?: WebSprint) => {
    setSprintEdit(sprint ?? null);
    setSprintForm({
      name: sprint?.name ?? "",
      goal: sprint?.goal ?? "",
      starts_on: dateInputValue(sprint?.starts_on),
      ends_on: dateInputValue(sprint?.ends_on),
      retrospective_notes: sprint?.retrospective_notes ?? "",
    });
    setSprintModal(true);
  };
  const saveSprint = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const data = {
        project_id: projectId,
        name: sprintForm.name.trim(),
        goal: sprintForm.goal.trim(),
        starts_on: sprintForm.starts_on,
        ends_on: sprintForm.ends_on,
        retrospective_notes: sprintForm.retrospective_notes.trim(),
      };
      if (sprintEdit)
        await mutation.mutateAsync({
          table: "web_project_sprints",
          operation: "update",
          id: sprintEdit.id,
          data,
        });
      else
        await mutation.mutateAsync({
          table: "web_project_sprints",
          operation: "insert",
          data: { ...data, status: "planned" },
        });
      setSprintModal(false);
      void sprintsQuery.refetch();
      toast.success(t("تم حفظ السبرنت.", "Sprint saved."));
    } catch {
      toast.error(t("تعذر حفظ السبرنت.", "Could not save sprint."));
    }
  };
  const setSprintStatus = async (sprint: WebSprint, status: WebSprint["status"]) => {
    try {
      await mutation.mutateAsync({
        table: "web_project_sprints",
        operation: "update",
        id: sprint.id,
        data: {
          status,
          completed_at:
            status === "completed" ? new Date().toISOString() : null,
        },
      });
      void sprintsQuery.refetch();
      toast.success(t("تم تحديث السبرنت.", "Sprint updated."));
    } catch {
      toast.error(
        t("تعذر تغيير حالة السبرنت.", "Could not change sprint status."),
      );
    }
  };
  const columns = BOARD_STATUSES.map((status) => ({
    status,
    tasks: filtered.filter((row) => row.status === status),
  }));
  const cards = (row: WebTask) => {
    const memberIds = assignees
      .filter((a) => a.task_id === row.id)
      .map((a) => a.member_id);
    return (
      <article
        key={row.id}
        className="wp-task"
        draggable={canManage}
        onDragStart={(event) => {
          event.dataTransfer.setData("text/plain", row.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        onClick={() => setTask(row)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setTask(row);
          }
        }}
        role="button"
        tabIndex={0}
      >
        <div className="wp-task-card-head">
          <span>
            <GripVertical size={14} />{" "}
            {row.priority === "urgent"
              ? "!"
              : row.priority === "high"
                ? "↑"
                : "·"}{" "}
            {labelStatus(row.priority)}
          </span>
          <small>
            {row.due_date
              ? new Date(`${row.due_date}T00:00:00`).toLocaleDateString(
                  locale === "ar" ? "ar-EG" : "en-GB",
                )
              : ""}
          </small>
        </div>
        <h3>{row.title}</h3>
        {row.description && <p className="wp-muted">{row.description}</p>}
        <div className="wp-task-tags">
          {(row.labels ?? []).map((label: string) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="wp-row">
          <small>
            {sprints.find((s) => s.id === row.sprint_id)?.name ??
              t("قائمة المنتج", "Backlog")}
          </small>
          <small>
            {memberIds
              .map(
                (id: number) =>
                  roster.find((m) => m.member_id === id)?.full_name ?? `#${id}`,
              )
              .join(", ") || t("غير مسندة", "Unassigned")}
          </small>
        </div>
        <label className="wp-status-move" onClick={(e) => e.stopPropagation()}>
          {t("نقل الحالة", "Move to")}
          <select
            disabled={
              !canManage &&
              !(mode === "member" && memberIds.includes(currentMemberId ?? -1))
            }
            value={row.status}
            onChange={(e) => void changeStatus(row, e.target.value)}
            aria-label={t("تغيير حالة المهمة", "Change task status")}
          >
            {[
              ...BOARD_STATUSES,
              ...(row.status === "blocked" || row.status === "cancelled"
                ? [row.status]
                : []),
            ].map((status) => (
              <option key={status} value={status}>
                {labelStatus(status)}
              </option>
            ))}
          </select>
        </label>
      </article>
    );
  };
  const queryError = tasksQuery.error ?? assigneesQuery.error ?? sprintsQuery.error ?? sprintProgressQuery.error;
  if (queryError) return <WorkspaceQueryError error={queryError} queries={[tasksQuery, assigneesQuery, sprintsQuery, sprintProgressQuery]} />;
  return (
    <div className="wp-tab-content">
      <div className="wp-toolbar">
        <Field label={t("السبرنت", "Sprint")}>
          <select
            value={filters.sprint}
            onChange={(e) => setFilters({ ...filters, sprint: e.target.value })}
          >
            <option value="">{t("كل المهام", "All work")}</option>
            <option value="backlog">
              {t("قائمة المنتج", "Product backlog")}
            </option>
            {sprints.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("المسؤول", "Assignee")}>
          <select
            value={filters.assignee}
            onChange={(e) =>
              setFilters({ ...filters, assignee: e.target.value })
            }
          >
            <option value="">{t("الكل", "Anyone")}</option>
            {roster.map((m) => (
              <option key={m.member_id} value={m.member_id}>
                {m.full_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("الأولوية", "Priority")}>
          <select
            value={filters.priority}
            onChange={(e) =>
              setFilters({ ...filters, priority: e.target.value })
            }
          >
            <option value="">{t("الكل", "Any")}</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {labelStatus(p)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("الحالة", "Status")}>
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            <option value="">{t("الكل", "Any")}</option>
            {[...BOARD_STATUSES, "blocked", "cancelled"].map((s) => (
              <option key={s} value={s}>
                {labelStatus(s)}
              </option>
            ))}
          </select>
        </Field>
        {canManage && (
          <>
            <Button
              icon={<Plus size={16} />}
              onClick={() =>
                setTask({
                  id: "",
                  project_id: projectId,
                  parent_task_id: null,
                  milestone_id: null,
                  sprint_id: null,
                  reporter_member_id: roster[0]?.member_id ?? 0,
                  title: "",
                  description: "",
                  priority: "normal",
                  status: "backlog",
                  start_date: null,
                  due_date: null,
                  estimated_effort: null,
                  actual_effort: null,
                  labels: [],
                  created_at: "",
                  updated_at: "",
                  completed_at: null,
                  created_by_auth_user_id: "",
                })
              }
            >
              {t("مهمة جديدة", "New task")}
            </Button>
            <Button
              variant="secondary"
              icon={<CalendarRange size={16} />}
              onClick={() => openSprint()}
            >
              {t("تخطيط سبرنت", "Plan sprint")}
            </Button>
          </>
        )}
      </div>
      <div className="wp-sprint-strip">
        {sprints.map((s) => {
          const p = progressById.get(s.id);
          return (
            <article
              key={s.id}
              className={`wp-sprint-card ${s.status === "active" ? "is-active" : ""}`}
            >
              <div className="wp-row">
                <h3>{s.name}</h3>
                <StatusBadge status={s.status} />
              </div>
              <p>{s.goal || t("بدون هدف محدد.", "No sprint goal set.")}</p>
              <small>
                {s.starts_on} → {s.ends_on}
              </small>
              <Progress
                done={p?.completed_task_count ?? 0}
                total={p?.task_count ?? 0}
              />
              <div className="wp-toolbar">
                {canManage && (
                  <>
                    <Button variant="secondary" onClick={() => openSprint(s)}>
                      {t("تعديل / مراجعة", "Edit / retro")}
                    </Button>
                    {s.status === "planned" && (
                      <Button onClick={() => void setSprintStatus(s, "active")}>
                        {t("بدء السبرنت", "Start sprint")}
                      </Button>
                    )}
                    {s.status === "active" && (
                      <Button
                        onClick={() => void setSprintStatus(s, "completed")}
                      >
                        {t("إنهاء السبرنت", "Complete sprint")}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </article>
          );
        })}
        {sprints.length === 0 && (
          <div className="wp-notice">
            {t(
              "لم يتم تخطيط سبرنت. أنشئ فترة وهدفاً ثم اسحب إليها مهام قائمة المنتج.",
              "No sprint planned. Create a timebox and goal, then assign backlog tasks to it.",
            )}
          </div>
        )}
      </div>
      <div className="wp-board" aria-label={t("لوحة Agile", "Agile board")}>
        {columns.map(({ status, tasks: column }) => (
          <section
            key={status}
            className="wp-column"
            onDragOver={(e) => {
              if (canManage) e.preventDefault();
            }}
            onDrop={(e) => {
              if (!canManage) return;
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain");
              const row = tasks.find((item) => item.id === id);
              if (row && row.status !== status) void changeStatus(row, status);
            }}
          >
            <header>
              <h2>{labelStatus(status)}</h2>
              <span>{column.length}</span>
            </header>
            {column.map(cards)}
            {column.length === 0 && (
              <p className="wp-muted">
                {t("لا توجد مهام هنا.", "No tasks here.")}
              </p>
            )}
          </section>
        ))}
      </div>
      {sprintModal && (
        <Modal
          isOpen
          title={
            sprintEdit
              ? t("تخطيط السبرنت ومراجعته", "Sprint planning & retrospective")
              : t("سبرنت جديد", "New sprint")
          }
          onClose={() => setSprintModal(false)}
          maxWidth="lg"
          footer={
            <>
              <Button variant="secondary" onClick={() => setSprintModal(false)}>
                {t("إلغاء", "Cancel")}
              </Button>
              <Button type="submit" form="sprint-form">
                {t("حفظ السبرنت", "Save sprint")}
              </Button>
            </>
          }
        >
          <form id="sprint-form" onSubmit={saveSprint} className="wp-grid">
            <Field label={t("اسم السبرنت", "Sprint name")}>
              <input
                required
                value={sprintForm.name}
                onChange={(e) =>
                  setSprintForm({ ...sprintForm, name: e.target.value })
                }
              />
            </Field>
            <Field label={t("هدف السبرنت", "Sprint goal")}>
              <input
                value={sprintForm.goal}
                onChange={(e) =>
                  setSprintForm({ ...sprintForm, goal: e.target.value })
                }
              />
            </Field>
            <Field label={t("تاريخ البدء", "Starts")}>
              <input
                required
                type="date"
                value={sprintForm.starts_on}
                onChange={(e) =>
                  setSprintForm({ ...sprintForm, starts_on: e.target.value })
                }
              />
            </Field>
            <Field label={t("تاريخ الانتهاء", "Ends")}>
              <input
                required
                type="date"
                value={sprintForm.ends_on}
                onChange={(e) =>
                  setSprintForm({ ...sprintForm, ends_on: e.target.value })
                }
              />
            </Field>
            <div className="wp-span-all">
              <Field
                label={t("ملاحظات المراجعة الختامية", "Retrospective notes")}
              >
                <textarea
                  rows={5}
                  value={sprintForm.retrospective_notes}
                  onChange={(e) =>
                    setSprintForm({
                      ...sprintForm,
                      retrospective_notes: e.target.value,
                    })
                  }
                  placeholder={t(
                    "ما الذي نجح؟ ما الذي تعلّمناه؟ ما الذي سيتغير؟",
                    "What worked? What did we learn? What will change?",
                  )}
                />
              </Field>
            </div>
          </form>
        </Modal>
      )}
      {task && (
        <TaskDialog
          workspace={workspace}
          task={task.id ? task : null}
          onClose={() => setTask(null)}
          onSaved={() => {
            void tasksQuery.refetch();
            void assigneesQuery.refetch();
          }}
        />
      )}
    </div>
  );
}
