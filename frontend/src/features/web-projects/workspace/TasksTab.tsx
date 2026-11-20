import { useMemo, useState, type FormEvent } from "react";
import type { WebAssignee, WebDeliverable, WebMilestone, WebSprint, WebTask } from "./types";
import {
  Plus,
  Search,
  PackageCheck,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { Field, StatusBadge, SafeLink } from "../common";
import { useWebMutation, useWebQuery, useWebRpc } from "../api";
import { toast } from "../../../store/toast";
import { useLocale } from "../../../i18n/useLocale";
import { isOverdue } from "../domain";
import { PRIORITIES, TASK_STATUSES, labelStatus } from "./types";
import type { Task, WorkspaceProps } from "./types";
import type { WebJson } from "../types";
import { WorkspaceQueryError } from "./WorkspaceQueryError";
import { useAuthStore } from "../../../store/auth";
import { TaskDialog } from "./TaskDialog";

export function TasksTab({ workspace }: { workspace: WorkspaceProps }) {
  const { t, locale } = useLocale();
  const { projectId, mode, currentMemberId, roster } = workspace;
  const authUserId = useAuthStore((state) => state.user?.id ?? null);
  const canManage = workspace.isLead || workspace.isProgramAdmin;
  const canSubmitEvidence = Boolean(currentMemberId !== null && roster.some((member) =>
    member.member_id === currentMemberId && member.status === "active"
      && (member.role === "lead" || member.role === "contributor")
      && member.accepted_agreement_version === workspace.project.current_agreement_version));
  const tasksQuery = useWebQuery<WebTask>(mode, "web_project_tasks", projectId);
  const assignmentsQuery = useWebQuery<WebAssignee>(mode, "web_project_task_assignees",
    projectId,
  );
  const milestoneQuery = useWebQuery<WebMilestone>(mode, "web_project_milestones",
    projectId,
  );
  const sprintQuery = useWebQuery<WebSprint>(mode, "web_project_sprints", projectId);
  const deliverablesQuery = useWebQuery<WebDeliverable>(mode, "web_project_deliverables",
    projectId,
  );
  const mutation = useWebMutation(mode);
  const rpc = useWebRpc(mode);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [creatingTask, setCreatingTask] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [assignee, setAssignee] = useState("");
  const [sort, setSort] = useState<"due" | "priority" | "updated">("due");
  const [deliverableModal, setDeliverableModal] = useState(false);
  const [deliverableEdit, setDeliverableEdit] = useState<WebDeliverable | null>(null);
  const [reviewPending, setReviewPending] = useState<{ row: WebDeliverable; status: "accepted" | "revision_requested" | "rejected" } | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [deliverableForm, setDeliverableForm] = useState({
    title: "",
    description: "",
    task_id: "",
    milestone_id: "",
    due_date: "",
    evidence: "",
  });
  const tasks = tasksQuery.data ?? [];
  const assignments = assignmentsQuery.data ?? [];
  const deliverables = deliverablesQuery.data ?? [];
  const filtered = useMemo(
    () =>
      tasks
        .filter((task) => {
          const links = assignments.filter((a) => a.task_id === task.id);
          return (
            (!search ||
              `${task.title} ${task.description ?? ""} ${(task.labels ?? []).join(" ")}`
                .toLowerCase()
                .includes(search.toLowerCase())) &&
            (!status || task.status === status) &&
            (!priority || task.priority === priority) &&
            (!assignee ||
              links.some((a) => String(a.member_id) === assignee))
          );
        })
        .sort((a, b) =>
          sort === "priority"
            ? PRIORITIES.indexOf(b.priority) - PRIORITIES.indexOf(a.priority)
            : sort === "updated"
              ? (b.updated_at ?? "").localeCompare(a.updated_at ?? "")
              : (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"),
        ),
    [tasks, assignments, search, status, priority, assignee, sort],
  );
  const refresh = () => {
    void tasksQuery.refetch();
    void assignmentsQuery.refetch();
    void deliverablesQuery.refetch();
  };
  const setTaskStatus = async (task: Task, next: string) => {
    try {
      await rpc.mutateAsync({
        name: "web_transition_project_task",
        args: { p_task_id: task.id, p_to_status: next, p_comment: null },
      });
      toast.success(t("تم تحديث حالة المهمة.", "Task status updated."));
      refresh();
    } catch {
      toast.error(
        t(
          "انتقال الحالة غير صالح أو غير مسموح.",
          "This task transition is not allowed.",
        ),
      );
    }
  };
  const openDeliverable = (row?: WebDeliverable) => {
    setDeliverableEdit(row ?? null);
    setDeliverableForm({
      title: row?.title ?? "",
      description: row?.description ?? "",
      task_id: row?.task_id ?? "",
      milestone_id: row?.milestone_id ?? "",
      due_date: row?.due_date ?? "",
      evidence: (row?.evidence ?? [])
        .map((x: WebJson) => (typeof x === "string" ? x : JSON.stringify(x)))
        .join("\n"),
    });
    setDeliverableModal(true);
  };
  const saveDeliverable = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmitEvidence || currentMemberId === null) {
      toast.error(t("يلزم حساب عضو مساهم نشط لإرسال دليل.", "An active contributor account is required to submit evidence."));
      return;
    }
    const evidence = deliverableForm.evidence.split("\n").map((line) => line.trim()).filter(Boolean).map((url) => ({ url }));
    try {
      await mutation.mutateAsync({
        table: "web_project_deliverables",
        operation: "insert",
        data: {
          project_id: projectId,
          submitted_by_member_id: currentMemberId,
          title: deliverableForm.title.trim(),
          description: deliverableForm.description.trim(),
          evidence,
          due_date: deliverableForm.due_date || null,
          task_id: deliverableForm.task_id || null,
          milestone_id: deliverableForm.milestone_id || null,
          status: "submitted",
          submitted_at: new Date().toISOString(),
        },
      });
      toast.success(t("تم إرسال التسليم.", "Deliverable submitted."));
      setDeliverableModal(false);
      setDeliverableEdit(null);
      void deliverablesQuery.refetch();
    } catch {
      toast.error(t("تعذر إرسال التسليم.", "Could not submit deliverable."));
    }
  };
  const reviewDeliverable = async (row: WebDeliverable, next: "accepted" | "revision_requested" | "rejected") => {
    setReviewPending({ row, status: next });
    setReviewNote(row.review_notes ?? "");
  };
  const saveDeliverableReview = async (event: FormEvent) => {
    event.preventDefault();
    if (!reviewPending) return;
    try {
      await mutation.mutateAsync({ table: "web_project_deliverables", operation: "update", id: reviewPending.row.id,
        data: { status: reviewPending.status, review_notes: reviewNote, reviewed_by_auth_user_id: authUserId, reviewed_at: new Date().toISOString() } });
      setReviewPending(null);
      void deliverablesQuery.refetch();
      toast.success(t("تم حفظ قرار المراجعة.", "Review decision saved."));
    } catch {
      toast.error(t("تعذر تسجيل المراجعة.", "Could not record review."));
    }
  };
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Africa/Cairo",
  });
  const ownDeliverables = deliverables.filter(
    (d) => canManage || d.submitted_by_member_id === currentMemberId,
  );
  const queryError = tasksQuery.error ?? assignmentsQuery.error ?? milestoneQuery.error ?? sprintQuery.error ?? deliverablesQuery.error;
  if (queryError) return <WorkspaceQueryError error={queryError} queries={[tasksQuery, assignmentsQuery, milestoneQuery, sprintQuery, deliverablesQuery]} />;
  return (
    <div className="wp-tab-content">
      <div className="wp-toolbar wp-task-filters">
        <label className="wp-search">
          <Search size={16} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t(
              "ابحث في المهام والوسوم...",
              "Search tasks and labels...",
            )}
          />
        </label>
        <Field label={t("الحالة", "Status")}>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("كل الحالات", "All statuses")}</option>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {labelStatus(s)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("المسؤول", "Assignee")}>
          <select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
          >
            <option value="">{t("كل الأعضاء", "All members")}</option>
            {roster.map((m) => (
              <option key={m.member_id} value={m.member_id}>
                {m.full_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("الأولوية", "Priority")}>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="">{t("كل الأولويات", "All priorities")}</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {labelStatus(p)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("ترتيب حسب", "Sort by")}>
          <select value={sort} onChange={(e) => setSort(e.target.value as "due" | "priority" | "updated")}>
            <option value="due">{t("موعد التسليم", "Due date")}</option>
            <option value="priority">{t("الأولوية", "Priority")}</option>
            <option value="updated">{t("آخر تحديث", "Last updated")}</option>
          </select>
        </Field>
        {canManage && (
          <Button
            icon={<Plus size={16} />}
            onClick={() => setCreatingTask(true)}
          >
            {t("مهمة جديدة", "New task")}
          </Button>
        )}
      </div>
      <div className="wp-panel">
        <div className="wp-row">
          <h2>{t("المهام", "Tasks")}</h2>
          <span>
            {filtered.length} / {tasks.length}
          </span>
        </div>
        {filtered.length ? (
          <div className="wp-table-scroll">
            <table className="wp-table">
              <thead>
                <tr>
                  <th>{t("المهمة", "Task")}</th>
                  <th>{t("الحالة", "Status")}</th>
                  <th>{t("الأولوية", "Priority")}</th>
                  <th>{t("المسؤول", "Assignee")}</th>
                  <th>{t("موعد التسليم", "Due")}</th>
                  <th>{t("السبرنت / المرحلة", "Sprint / milestone")}</th>
                  <th>{t("إجراء", "Action")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((task) => {
                  const memberIds = assignments
                    .filter((a) => a.task_id === task.id)
                    .map((a) => a.member_id);
                  const late = isOverdue(
                    task.due_date,
                    ["done", "cancelled"].includes(task.status),
                    today,
                  );
                  const linkedSprint = sprintQuery.data?.find(
                    (x) => x.id === task.sprint_id,
                  );
                  const linkedMilestone = milestoneQuery.data?.find(
                    (x) => x.id === task.milestone_id,
                  );
                  const assignedMe = memberIds.includes(currentMemberId ?? -1);
                  return (
                    <tr key={task.id}>
                      <td>
                        <button
                          className="wp-table-link"
                          onClick={() => setSelectedTask(task)}
                        >
                          {task.title}
                        </button>
                        <small>{(task.labels ?? []).join(" · ")}</small>
                      </td>
                      <td>
                        <StatusBadge status={task.status} />
                      </td>
                      <td>
                        <StatusBadge status={task.priority} />
                      </td>
                      <td>
                        {memberIds
                          .map(
                            (id: number) =>
                              roster.find((m) => m.member_id === id)
                                ?.full_name ?? `#${id}`,
                          )
                          .join(", ") || "—"}
                      </td>
                      <td>
                        {late && (
                          <AlertTriangle size={14} className="wp-overdue" />
                        )}
                        {task.due_date
                          ? new Date(
                              `${task.due_date}T00:00:00`,
                            ).toLocaleDateString(
                              locale === "ar" ? "ar-EG" : "en-GB",
                            )
                          : "—"}
                      </td>
                      <td>
                        {linkedSprint?.name ?? "—"}
                        {linkedMilestone && (
                          <small>{linkedMilestone.title}</small>
                        )}
                      </td>
                      <td>
                        <div className="wp-task-row-actions">
                          <select
                            aria-label={t(
                              "تغيير حالة المهمة",
                              "Change task status",
                            )}
                            value={task.status}
                            disabled={
                              !canManage && !(mode === "member" && assignedMe)
                            }
                            onChange={(e) =>
                              void setTaskStatus(task, e.target.value)
                            }
                          >
                            {TASK_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {labelStatus(s)}
                              </option>
                            ))}
                          </select>
                          <Button
                            variant="secondary"
                            onClick={() => setSelectedTask(task)}
                          >
                            {t("تفاصيل", "Details")}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="wp-empty-inline">
            {tasks.length
              ? t(
                  "لا توجد مهام تطابق عوامل التصفية.",
                  "No tasks match these filters.",
                )
              : t("لا توجد مهام بعد.", "No tasks yet.")}
          </p>
        )}
      </div>
      <div className="wp-panel">
        <header className="wp-row">
          <h2>
            <PackageCheck size={18} />
            {t("التسليمات والمراجعات", "Deliverables & reviews")}
          </h2>
          {canSubmitEvidence && <Button icon={<Plus size={15} />} onClick={() => openDeliverable()}>
            {t("إرسال دليل", "Submit evidence")}
          </Button>}
        </header>
        <p className="wp-muted">
          {t(
            "اربط الدليل بمهمة أو مرحلة؛ الطلبات والسجلات تخضع لصلاحيات المشروع.",
            "Link evidence to a task or milestone; requests and records remain subject to project permissions.",
          )}
        </p>
        {!canSubmitEvidence && <p className="wp-notice">{t("لا يمكن إرسال تسليمات باسم عضو آخر. يلزم حساب مساهم نشط لقبول المسؤولية عن الدليل.", "Deliverables cannot be submitted on another member’s behalf. An active contributor account is required to own the evidence.")}</p>}
        {ownDeliverables.length ? (
          <div className="wp-table-scroll">
            <table className="wp-table">
              <thead>
                <tr>
                  <th>{t("التسليم", "Deliverable")}</th>
                  <th>{t("المساهم", "Contributor")}</th>
                  <th>{t("الحالة", "Status")}</th>
                  <th>{t("الاستحقاق", "Due")}</th>
                  <th>{t("الدليل", "Evidence")}</th>
                  <th>{t("الإجراء", "Action")}</th>
                </tr>
              </thead>
              <tbody>
                {ownDeliverables.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <b>{item.title}</b>
                      <small>{item.description}</small>
                    </td>
                    <td>
                      {roster.find(
                        (m) => m.member_id === item.submitted_by_member_id,
                      )?.full_name ?? `#${item.submitted_by_member_id}`}
                    </td>
                    <td>
                      <StatusBadge status={item.status} />
                    </td>
                    <td>{item.due_date ?? "—"}</td>
                    <td>
                      {(item.evidence ?? []).map((e, i: number) => (
                        <SafeLink
                          key={i}
                          href={typeof e === "string" ? e : typeof e === "object" && e !== null && !Array.isArray(e) && typeof e.url === "string" ? e.url : null}
                        >
                          <ExternalLink size={13} />
                          {t("مرجع", "Evidence")}
                        </SafeLink>
                      ))}
                    </td>
                    <td>
                      <div className="wp-toolbar">
                        {canSubmitEvidence && item.submitted_by_member_id === currentMemberId && ["draft", "revision_requested"].includes(item.status) && (
                            <Button onClick={() => openDeliverable(item)}>
                              {t("إرسال دليل جديد", "Submit new evidence")}
                            </Button>
                          )}
                        {canManage &&
                          ["submitted", "under_review"].includes(
                            item.status,
                          ) && (
                            <>
                              <Button
                                onClick={() =>
                                  void reviewDeliverable(item, "accepted")
                                }
                              >
                                {t("قبول", "Accept")}
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={() =>
                                  void reviewDeliverable(
                                    item,
                                    "revision_requested",
                                  )
                                }
                              >
                                {t("طلب تعديل", "Request revision")}
                              </Button>
                              <Button
                                variant="danger"
                                onClick={() =>
                                  void reviewDeliverable(item, "rejected")
                                }
                              >
                                {t("رفض", "Reject")}
                              </Button>
                            </>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="wp-empty-inline">
            {t("لا توجد تسليمات مسجلة.", "No deliverables recorded yet.")}
          </p>
        )}
      </div>
      {selectedTask !== null && (
        <TaskDialog
          workspace={workspace}
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onSaved={refresh}
        />
      )}
      {creatingTask && (
        <TaskDialog
          workspace={workspace}
          task={null}
          onClose={() => setCreatingTask(false)}
          onSaved={() => {
            refresh();
            setCreatingTask(false);
          }}
        />
      )}
      {deliverableModal && canSubmitEvidence && (
        <Modal
          isOpen
          title={
            deliverableEdit
              ? t("إرسال التسليم", "Submit deliverable")
              : t("تسليم جديد", "New deliverable")
          }
          onClose={() => setDeliverableModal(false)}
          maxWidth="lg"
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setDeliverableModal(false)}
              >
                {t("إلغاء", "Cancel")}
              </Button>
              <Button type="submit" form="deliverable-form">
                {t("إرسال للمراجعة", "Submit for review")}
              </Button>
            </>
          }
        >
          <form
            id="deliverable-form"
            onSubmit={saveDeliverable}
            className="wp-grid"
          >
            <Field label={t("عنوان التسليم", "Deliverable title")}>
              <input
                required
                value={deliverableForm.title}
                onChange={(e) =>
                  setDeliverableForm({
                    ...deliverableForm,
                    title: e.target.value,
                  })
                }
              />
            </Field>
            <Field label={t("موعد التسليم", "Due date")}>
              <input
                type="date"
                value={deliverableForm.due_date}
                onChange={(e) =>
                  setDeliverableForm({
                    ...deliverableForm,
                    due_date: e.target.value,
                  })
                }
              />
            </Field>
            <Field label={t("المهمة المرتبطة", "Linked task")}>
              <select
                value={deliverableForm.task_id}
                onChange={(e) =>
                  setDeliverableForm({
                    ...deliverableForm,
                    task_id: e.target.value,
                  })
                }
              >
                <option value="">{t("لا يوجد", "None")}</option>
                {tasks.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("المرحلة المرتبطة", "Linked milestone")}>
              <select
                value={deliverableForm.milestone_id}
                onChange={(e) =>
                  setDeliverableForm({
                    ...deliverableForm,
                    milestone_id: e.target.value,
                  })
                }
              >
                <option value="">{t("لا يوجد", "None")}</option>
                {(milestoneQuery.data ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                  </option>
                ))}
              </select>
            </Field>
            <div className="wp-span-all">
              <Field label={t("الوصف", "Description")}>
                <textarea
                  rows={3}
                  value={deliverableForm.description}
                  onChange={(e) =>
                    setDeliverableForm({
                      ...deliverableForm,
                      description: e.target.value,
                    })
                  }
                />
              </Field>
            </div>
            <div className="wp-span-all">
              <Field
                label={t(
                  "روابط الأدلة (رابط واحد بكل سطر)",
                  "Evidence links (one per line)",
                )}
              >
                <textarea
                  rows={3}
                  placeholder="https://"
                  value={deliverableForm.evidence}
                  onChange={(e) =>
                    setDeliverableForm({
                      ...deliverableForm,
                      evidence: e.target.value,
                    })
                  }
                />
              </Field>
            </div>
          </form>
        </Modal>
      )}
      {reviewPending && <Modal isOpen title={t("مراجعة التسليم", "Review deliverable")} onClose={() => setReviewPending(null)} footer={<><Button variant="secondary" onClick={() => setReviewPending(null)}>{t("إلغاء", "Cancel")}</Button><Button type="submit" form="deliverable-review-form">{t("حفظ المراجعة", "Save review")}</Button></>}>
        <form id="deliverable-review-form" onSubmit={saveDeliverableReview}><Field label={t("ملاحظة المراجعة", "Review note")}><textarea rows={4} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} /></Field></form>
      </Modal>}
    </div>
  );
}
