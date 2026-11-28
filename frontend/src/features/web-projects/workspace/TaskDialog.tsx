import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { WebAssignee, WebAttachment, WebChecklist, WebComment, WebMilestone, WebSprint, WebTask } from "./types";
import type { WebTaskDifficulty, WebTaskSubmission } from "../types";
type WorkspaceChecklistRow = WebChecklist & { created_by_member_id: number; updated_by_member_id: number | null };
import {
  MessageSquare,
  Paperclip,
  Plus,
  Trash2,
  ListChecks,
} from "lucide-react";
import { Modal } from "../../../components/ui/Modal";
import { Button } from "../../../components/ui/Button";
import { Field } from "../common";
import { useWebMutation, useWebQuery, useWebRpc } from "../api";
import { toast } from "../../../store/toast";
import { useLocale } from "../../../i18n/useLocale";
import {
  PRIORITIES,
  TASK_STATUSES,
  labelStatus,
  dateInputValue,
} from "./types";
import type { Task, WorkspaceProps } from "./types";
import { ConfirmDialog } from "./ConfirmDialog";
import { WorkspaceQueryError } from "./WorkspaceQueryError";
import { SafeLink } from "../common";

export function TaskDialog({
  workspace,
  task,
  onClose,
  onSaved,
}: {
  workspace: WorkspaceProps;
  task: Task | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const { project, projectId, mode, roster, currentMemberId } = workspace;
  const [saving, setSaving] = useState(false);
  const [comment, setComment] = useState("");
  const [checkText, setCheckText] = useState("");
  const [attachmentTitle, setAttachmentTitle] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [deliveryDescription, setDeliveryDescription] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [deliveryStars, setDeliveryStars] = useState(5);
  const [deliveryDifficulty, setDeliveryDifficulty] = useState<WebTaskDifficulty>("medium");
  const [deliveryLinks, setDeliveryLinks] = useState<Array<{ label: string; url: string }>>([{ label: "", url: "" }]);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    status: "backlog",
    priority: "normal",
    start_date: "",
    due_date: "",
    estimated_effort: "",
    actual_effort: "",
    labels: "",
    sprint_id: "",
    milestone_id: "",
    parent_task_id: "",
    reporter_member_id: "",
  });
  const members = useWebQuery<WebAssignee>(mode, "web_project_task_assignees",
    projectId,
    { task_id: task?.id ?? "" },
    Boolean(task?.id),
  );
  const comments = useWebQuery<WebComment>(mode, "web_project_task_comments",
    projectId,
    { task_id: task?.id ?? "" },
    Boolean(task?.id),
  );
  const checklist = useWebQuery<WorkspaceChecklistRow>(mode, "web_project_task_checklist_items",
    projectId,
    { task_id: task?.id ?? "" },
    Boolean(task?.id),
  );
  const attachments = useWebQuery<WebAttachment>(mode, "web_project_task_attachments",
    projectId,
    { task_id: task?.id ?? "" },
    Boolean(task?.id),
  );
  const submissions = useWebQuery<WebTaskSubmission>(mode, "web_project_task_submissions", projectId, { task_id: task?.id ?? "" }, Boolean(task?.id));
  const sprints = useWebQuery<WebSprint>(mode, "web_project_sprints", projectId);
  const milestones = useWebQuery<WebMilestone>(mode, "web_project_milestones",
    projectId,
  );
  const subtasks = useWebQuery<WebTask>(mode, "web_project_tasks",
    projectId,
    { parent_task_id: task?.id ?? "" },
    Boolean(task?.id),
  );
  const mutation = useWebMutation(mode);
  const rpc = useWebRpc(mode);
  const assigned = useMemo(
    () => (members.data ?? []).map((item) => String(item.member_id)),
    [members.data],
  );
  const activeContributors = roster.filter((member) =>
    member.status === "active" && (member.role === "lead" || member.role === "contributor")
      && member.accepted_agreement_version === project.current_agreement_version);
  const currentMembership = activeContributors.find((member) => member.member_id === currentMemberId);
  const canSubmitMemberWork = Boolean(currentMembership);
  const canSubmitThisTask = Boolean(task && canSubmitMemberWork && assigned.includes(String(currentMemberId)) && task.status === "in_progress");
  const mySubmission = (submissions.data ?? []).find((submission) => submission.member_id === currentMemberId);
  useEffect(() => {
    setDeliveryDescription(mySubmission?.description ?? "");
    setDeliveryNotes(mySubmission?.notes ?? "");
    setDeliveryStars(mySubmission?.usefulness_stars ?? 5);
    setDeliveryDifficulty(mySubmission?.difficulty ?? "medium");
    setDeliveryLinks(mySubmission?.links?.length ? mySubmission.links : [{ label: "", url: "" }]);
  }, [task?.id, mySubmission?.id, mySubmission?.updated_at]);
  const editable = workspace.isLead || workspace.isProgramAdmin || (task !== null && assigned.includes(String(currentMemberId)));
  const canEditLinks = workspace.isLead || workspace.isProgramAdmin;
  useEffect(() => {
    setForm({
      title: task?.title ?? "",
      description: task?.description ?? "",
      status: task?.status ?? "backlog",
      priority: task?.priority ?? "medium",
      start_date: dateInputValue(task?.start_date),
      due_date: dateInputValue(task?.due_date),
      estimated_effort:
        task?.estimated_effort == null ? "" : String(task.estimated_effort),
      actual_effort:
        task?.actual_effort == null ? "" : String(task.actual_effort),
      labels: (task?.labels ?? []).join(", "),
      sprint_id: task?.sprint_id ?? "",
      milestone_id: task?.milestone_id ?? "",
      parent_task_id: task?.parent_task_id ?? "",
      reporter_member_id: String(task?.reporter_member_id ?? currentMembership?.member_id ?? activeContributors[0]?.member_id ?? ""),
    });
  }, [task, currentMembership?.member_id, activeContributors]);
  const set = (name: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [name]: value }));
  const canChangeStatus = editable;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      let id = task?.id;
      const data: Record<string, unknown> = {
        project_id: projectId,
        title: form.title.trim(),
        description: form.description.trim(),
        priority: form.priority,
        start_date: form.start_date || null,
        due_date: form.due_date || null,
        estimated_effort: form.estimated_effort
          ? Number(form.estimated_effort)
          : null,
        actual_effort: form.actual_effort ? Number(form.actual_effort) : null,
        labels: form.labels
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        sprint_id: form.sprint_id || null,
        milestone_id: form.milestone_id || null,
        parent_task_id: form.parent_task_id || null,
      };
      if (!data.title)
        throw new Error(t("عنوان المهمة مطلوب.", "A task title is required."));
      if (task)
        await mutation.mutateAsync({
          table: "web_project_tasks",
          operation: "update",
          data,
          id: task.id,
        });
      else {
        const created = await mutation.mutateAsync({
          table: "web_project_tasks",
          operation: "insert",
          data: {
            ...data,
            status: form.status,
            reporter_member_id: Number(form.reporter_member_id),
          },
        });
        id = typeof created?.id === "string" ? created.id : undefined;
      }
      if (task && task.status !== form.status) {
        await rpc.mutateAsync({
          name: "web_transition_project_task",
          args: {
            p_task_id: task.id,
            p_to_status: form.status,
            p_comment: null,
          },
        });
      }
      const desired = document.querySelectorAll<HTMLInputElement>(
        "[data-assignee-option]",
      );
      if (id) {
        for (const input of Array.from(desired)) {
          const memberId = input.value;
          const currently = assigned.includes(memberId);
          if (input.checked && !currently)
            await mutation.mutateAsync({
              table: "web_project_task_assignees",
              operation: "insert",
              data: {
                project_id: projectId,
                task_id: id,
                member_id: Number(memberId),
                is_primary: false,
              },
            });
          if (!input.checked && currently)
            await mutation.mutateAsync({
              table: "web_project_task_assignees",
              operation: "delete",
              filters: {
                project_id: projectId,
                task_id: id,
                member_id: Number(memberId),
              },
            });
        }
      }
      toast.success(t("تم حفظ المهمة.", "Task saved."));
      onSaved();
      if (!task) onClose();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("تعذر حفظ المهمة.", "Could not save task."),
      );
    } finally {
      setSaving(false);
    }
  };
  const addRecord = async (
    table: string,
    data: Record<string, unknown>,
    message: string,
  ) => {
    if (!task) return;
    try {
      await mutation.mutateAsync({
        table,
        operation: "insert",
        data: { project_id: projectId, task_id: task.id, ...data },
      });
      toast.success(message);
      onSaved();
    } catch {
      toast.error(t("تعذر حفظ التغيير.", "Could not save this change."));
    }
  };
  const moveTask = async (status: string) => {
    if (!task) return;
    try {
      await rpc.mutateAsync({
        name: "web_transition_project_task",
        args: { p_task_id: task.id, p_to_status: status, p_comment: null },
      });
      toast.success(t("تم تحديث الحالة.", "Status updated."));
      onSaved();
    } catch {
      toast.error(
        t(
          "هذا الانتقال غير مسموح أو تعذر حفظه.",
          "This transition is not allowed or could not be saved.",
        ),
      );
    }
  };
  const removeTask = async () => {
    if (!task || (!workspace.isLead && !workspace.isProgramAdmin)) return;
    try {
      await rpc.mutateAsync({
        name: "web_delete_project_task",
        args: { p_task_id: task.id },
      });
      toast.success(t("تم إلغاء المهمة مع الاحتفاظ بسجلها.", "Task cancelled; its history was retained."));
      onClose();
      onSaved();
    } catch {
      toast.error(t("تعذر حذف المهمة.", "Could not delete task."));
    }
  };
  const formId = "web-project-task-form";
  const queryError = sprints.error ?? milestones.error ?? members.error ?? comments.error ?? checklist.error ?? attachments.error ?? subtasks.error ?? submissions.error;
  if (queryError) return <WorkspaceQueryError error={queryError} queries={[sprints, milestones, members, comments, checklist, attachments, subtasks, submissions]} />;
  return (
    <Modal
      isOpen
      title={
        task ? t("تفاصيل المهمة", "Task details") : t("مهمة جديدة", "New task")
      }
      subtitle={project.name}
      onClose={onClose}
      maxWidth="3xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("إلغاء", "Cancel")}
          </Button>
          {editable && (
            <Button type="submit" form={formId} isLoading={saving}>
              {t("حفظ المهمة", "Save task")}
            </Button>
          )}
        </>
      }
    >
      <form id={formId} onSubmit={save} className="wp-task-dialog">
        <div className="wp-grid wp-task-fields">
          <Field label={t("العنوان", "Title")}>
            <input
              required
              disabled={!editable}
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
            />
          </Field>
          <Field label={t("الأولوية", "Priority")}>
            <select
              disabled={!editable}
              value={form.priority}
              onChange={(e) => set("priority", e.target.value)}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {labelStatus(p)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("الحالة", "Status")}>
            <select
              disabled={Boolean(task) && !canChangeStatus}
              value={form.status}
              onChange={(e) => set("status", e.target.value)}
            >
              {TASK_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {labelStatus(status)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("تاريخ البدء", "Start date")}>
            <input
              disabled={!editable}
              type="date"
              value={form.start_date}
              onChange={(e) => set("start_date", e.target.value)}
            />
          </Field>
          <Field label={t("موعد التسليم", "Due date")}>
            <input
              disabled={!editable}
              type="date"
              value={form.due_date}
              onChange={(e) => set("due_date", e.target.value)}
            />
          </Field>
          <Field label={t("الجهد المقدّر (ساعات)", "Estimated effort (hours)")}>
            <input
              disabled={!editable}
              type="number"
              min="0"
              step="0.5"
              value={form.estimated_effort}
              onChange={(e) => set("estimated_effort", e.target.value)}
            />
          </Field>
          <Field label={t("الجهد الفعلي (ساعات)", "Actual effort (hours)")}>
            <input
              disabled={!editable}
              type="number"
              min="0"
              step="0.5"
              value={form.actual_effort}
              onChange={(e) => set("actual_effort", e.target.value)}
            />
          </Field>
          <Field label={t("السبرنت", "Sprint")}>
            <select
              disabled={!canEditLinks}
              value={form.sprint_id}
              onChange={(e) => set("sprint_id", e.target.value)}
            >
              <option value="">{t("غير محدد", "Unassigned")}</option>
              {(sprints.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("المرحلة الرئيسية", "Milestone")}>
            <select
              disabled={!canEditLinks}
              value={form.milestone_id}
              onChange={(e) => set("milestone_id", e.target.value)}
            >
              <option value="">{t("غير محددة", "Unassigned")}</option>
              {(milestones.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          </Field>
          {!task && <Field label={t("المبلّغ / المساهم", "Reporter / contributor")}>
            <select required value={form.reporter_member_id} onChange={(e) => set("reporter_member_id", e.target.value)}>
              <option value="">{t("اختر مساهمًا نشطًا", "Choose an active contributor")}</option>
              {activeContributors.map((member) => <option key={member.member_id} value={member.member_id}>{member.full_name}</option>)}
            </select>
          </Field>}
          <Field label={t("وسوم، مفصولة بفواصل", "Labels, comma separated")}>
            <input
              disabled={!editable}
              value={form.labels}
              onChange={(e) => set("labels", e.target.value)}
            />
          </Field>
        </div>
        <Field label={t("الوصف", "Description")}>
          <textarea
            disabled={!editable}
            rows={3}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </Field>
        {editable && (
          <fieldset className="wp-field">
            <legend>{t("المسؤولون", "Assignees")}</legend>
            <div className="wp-assignee-list">
              {roster
                .filter((m) => m.status === "active")
                .map((member) => (
                  <label key={member.member_id}>
                    <input
                      data-assignee-option
                      type="checkbox"
                      value={member.member_id}
                      defaultChecked={assigned.includes(
                        String(member.member_id),
                      )}
                    />
                    {member.full_name}
                  </label>
                ))}
            </div>
          </fieldset>
        )}
        {task && (
          <div className="wp-task-detail-sections">
            {mySubmission && <section className="wp-panel">
              <h3>{t("تسليمك الحالي", "Your current submission")}</h3>
              <p><strong>{t("وقت التسليم:", "Submitted:")}</strong> {new Date(mySubmission.submitted_at).toLocaleString()}</p>
              <p><strong>{t("وصف الإنجاز:", "Completed work:")}</strong> {mySubmission.description}</p>
              {mySubmission.notes && <p><strong>{t("ملاحظات:", "Notes:")}</strong> {mySubmission.notes}</p>}
              <p>{t(`الاستفادة: ${mySubmission.usefulness_stars}/5 نجوم · الصعوبة: ${mySubmission.difficulty}`, `Usefulness: ${mySubmission.usefulness_stars}/5 stars · Difficulty: ${mySubmission.difficulty}`)}</p>
              {mySubmission.links.map((link, index) => <div key={`${link.url}-${index}`}><SafeLink href={link.url}>{link.label || link.url}</SafeLink></div>)}
            </section>}
            {(workspace.isLead || workspace.isProgramAdmin) && (submissions.data ?? []).length > 0 && <section className="wp-panel">
              <h3>{t("تسليمات أعضاء المهمة", "Task member submissions")}</h3>
              {(submissions.data ?? []).map((submission) => <article key={submission.id} className="wp-row">
                <div><strong>{roster.find((member) => member.member_id === submission.member_id)?.full_name ?? `#${submission.member_id}`}</strong>
                  <p>{t("وقت التسليم:", "Submitted:")} {new Date(submission.submitted_at).toLocaleString()}</p>
                  <p>{t("الإنجاز:", "Completed work:")} {submission.description}</p>
                  {submission.notes && <p>{t("ملاحظات:", "Notes:")} {submission.notes}</p>}
                  <p>{t(`الاستفادة: ${submission.usefulness_stars}/5 نجوم · الصعوبة: ${submission.difficulty}`, `Usefulness: ${submission.usefulness_stars}/5 stars · Difficulty: ${submission.difficulty}`)}</p>
                  {submission.links.map((link, index) => <div key={`${link.url}-${index}`}><SafeLink href={link.url}>{link.label || link.url}</SafeLink></div>)}
                </div>
              </article>)}
            </section>}
            {canSubmitThisTask && <section className="wp-panel">
              <h3>{t("تسليم المهمة", "Submit task")}</h3>
              <label>{t("وصف الإنجاز", "Completed work")}<textarea required minLength={1} maxLength={4000} rows={3} value={deliveryDescription} onChange={(event) => setDeliveryDescription(event.target.value)} /></label>
              <label>{t("ملاحظات إضافية", "Additional notes")}<textarea maxLength={2000} rows={2} value={deliveryNotes} onChange={(event) => setDeliveryNotes(event.target.value)} /></label>
              <label>{t("تقييم الاستفادة", "Usefulness rating")}<select value={deliveryStars} onChange={(event) => setDeliveryStars(Number(event.target.value))}>{[1,2,3,4,5].map((star) => <option key={star} value={star}>{"★".repeat(star)} ({star}/5)</option>)}</select></label>
              <label>{t("مستوى الصعوبة", "Difficulty")}<select value={deliveryDifficulty} onChange={(event) => setDeliveryDifficulty(event.target.value as WebTaskDifficulty)}><option value="easy">{t("سهل", "Easy")}</option><option value="medium">{t("متوسط", "Medium")}</option><option value="hard">{t("صعب", "Hard")}</option></select></label>
              {deliveryLinks.map((link, index) => <div key={index} className="wp-inline-add"><input aria-label={t("اسم الرابط", "Link label")} maxLength={80} placeholder="GitHub / Wokwi" value={link.label} onChange={(event) => setDeliveryLinks((current) => current.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} /><input aria-label={t("رابط التسليم", "Submission URL")} type="url" required={Boolean(link.label)} maxLength={2048} placeholder="https://" value={link.url} onChange={(event) => setDeliveryLinks((current) => current.map((item, i) => i === index ? { ...item, url: event.target.value } : item))} />{deliveryLinks.length > 1 && <Button type="button" variant="danger" onClick={() => setDeliveryLinks((current) => current.filter((_, i) => i !== index))}><Trash2 size={14}/></Button>}</div>)}
              <Button type="button" disabled={deliveryLinks.length >= 10} onClick={() => setDeliveryLinks((current) => [...current, { label: "", url: "" }])}><Plus size={15}/>{t("إضافة رابط", "Add link")}</Button>
              <Button type="button" isLoading={rpc.isPending} disabled={!deliveryDescription.trim() || deliveryLinks.some((link) => Boolean(link.label.trim()) !== Boolean(link.url.trim()))} onClick={async () => {
                try {
                  const links = deliveryLinks.filter((link) => link.label.trim() || link.url.trim());
                  await rpc.mutateAsync({ name: "web_submit_project_task", args: { p_task_id: task.id, p_description: deliveryDescription.trim(), p_notes: deliveryNotes.trim(), p_usefulness_stars: deliveryStars, p_difficulty: deliveryDifficulty, p_links: links.map((link) => ({ label: link.label.trim(), url: link.url.trim() })) } });
                  toast.success(t("تم حفظ التسليم ووقت الخادم تلقائيًا.", "Submission saved with server time."));
                  onSaved();
                } catch (error) { toast.error(error instanceof Error ? error.message : t("تعذر حفظ التسليم.", "Could not save submission.")); }
              }}>{mySubmission ? t("تحديث التسليم", "Update submission") : t("إرسال التسليم", "Submit work")}</Button>
              <small>{t("وقت التسليم يحدده الخادم. يمكنك إضافة حتى 10 روابط.", "Submission time is assigned by the server. Add up to 10 links.")}</small>
            </section>}
            {canChangeStatus && (
              <section className="wp-panel">
                <h3>{t("تحديث سير العمل", "Workflow transition")}</h3>
                <div className="wp-toolbar">
                  {TASK_STATUSES.map((status) => (
                    <Button
                      key={status}
                      variant={task.status === status ? "primary" : "secondary"}
                      onClick={() => void moveTask(status)}
                    >
                      {labelStatus(status)}
                    </Button>
                  ))}
                </div>
                <small>
                  {t(
                    "يتم التحقق من انتقالات الحالة عبر الخادم.",
                    "Status transitions are validated server-side.",
                  )}
                </small>
              </section>
            )}
            <section className="wp-panel">
              <h3>
                <ListChecks size={16} /> {t("قائمة التحقق", "Checklist")}
              </h3>
              {(checklist.data ?? []).map((item) => (
                <label className="wp-check-row" key={item.id}>
                  <input
                    type="checkbox"
                    disabled={!(canSubmitMemberWork && (workspace.isLead || item.created_by_member_id === currentMemberId))}
                    checked={Boolean(item.is_done)}
                    onChange={async () => {
                      try {
                        await mutation.mutateAsync({
                          table: "web_project_task_checklist_items",
                          operation: "update",
                          id: item.id,
                          data: { is_done: !item.is_done },
                        });
                        onSaved();
                      } catch {
                        toast.error(
                          t("تعذر تحديث العنصر.", "Could not update item."),
                        );
                      }
                    }}
                  />
                  {item.title}
                  <button
                    type="button"
                    aria-label={t("حذف العنصر", "Delete item")}
                    disabled={!(canSubmitMemberWork && (workspace.isLead || item.created_by_member_id === currentMemberId))}
                    onClick={async () => {
                      await mutation.mutateAsync({
                        table: "web_project_task_checklist_items",
                        operation: "delete",
                        id: item.id,
                      });
                      onSaved();
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </label>
              ))}
              {canSubmitMemberWork && (workspace.isLead || assigned.includes(String(currentMemberId))) && <div className="wp-inline-add">
                <input
                  value={checkText}
                  onChange={(e) => setCheckText(e.target.value)}
                  placeholder={t("إضافة بند", "Add checklist item")}
                />
                <Button
                  icon={<Plus size={15} />}
                  onClick={() => {
                    if (!checkText.trim()) return;
                    void addRecord(
                      "web_project_task_checklist_items",
                      {
                        title: checkText.trim(),
                        is_done: false,
                        sort_order: checklist.data?.length ?? 0,
                        created_by_member_id: currentMemberId,
                      },
                      t("تمت الإضافة.", "Added."),
                    );
                    setCheckText("");
                  }}
                >
                  {t("إضافة", "Add")}
                </Button>
              </div>}
            </section>
            <section className="wp-panel">
              <h3>
                <MessageSquare size={16} /> {t("التعليقات", "Comments")}
              </h3>
              <div className="wp-comment-list">
                {(comments.data ?? []).map((item) => (
                  <article key={item.id}>
                    <p>{item.body}</p>
                    <small>
                      {item.created_at
                        ? new Date(item.created_at).toLocaleString()
                        : ""}
                    </small>
                  </article>
                ))}
              </div>
              {(canSubmitMemberWork || workspace.isProgramAdmin) && <div className="wp-inline-add">
                <textarea
                  rows={2}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={t("اكتب تعليقاً...", "Write a comment...")}
                />
                <Button
                  onClick={() => {
                    if (!comment.trim()) return;
                    void addRecord(
                      "web_project_task_comments",
                      {
                        author_member_id: currentMemberId,
                        body: comment.trim(),
                      },
                      t("تم إرسال التعليق.", "Comment posted."),
                    );
                    setComment("");
                  }}
                >
                  {t("إرسال", "Post")}
                </Button>
              </div>}
            </section>
            <section className="wp-panel">
              <h3>
                <Paperclip size={16} />{" "}
                {t("المرفقات (روابط فقط)", "Attachments (links only)")}
              </h3>
              <p className="wp-muted">
                {t(
                  "رفع الملفات غير مهيأ؛ نحفظ رابطاً خارجياً وبياناته فقط.",
                  "File uploads are not configured; only external links and metadata are stored.",
                )}
              </p>
              {(attachments.data ?? []).map((item) => (
                <div key={item.id} className="wp-row">
                  <SafeLink href={item.external_url}>{item.title}</SafeLink>
                  <small>{t("رابط خارجي", "External link")}</small>
                </div>
              ))}
              {canSubmitMemberWork && <div className="wp-inline-add">
                <input
                  value={attachmentTitle}
                  onChange={(e) => setAttachmentTitle(e.target.value)}
                  placeholder={t("اسم الرابط", "Link title")}
                />
                <input
                  type="url"
                  value={attachmentUrl}
                  onChange={(e) => setAttachmentUrl(e.target.value)}
                  placeholder="https://"
                />
                <Button
                  onClick={() => {
                    if (!attachmentTitle.trim() || !attachmentUrl.trim())
                      return;
                    void addRecord(
                      "web_project_task_attachments",
                      {
                        uploaded_by_member_id: currentMemberId,
                        title: attachmentTitle.trim(),
                        external_url: attachmentUrl.trim(),
                      },
                      t("تم حفظ الرابط.", "Link saved."),
                    );
                    setAttachmentTitle("");
                    setAttachmentUrl("");
                  }}
                >
                  {t("ربط", "Attach")}
                </Button>
              </div>}
            </section>
            <section className="wp-panel">
              <h3>{t("المهام الفرعية", "Subtasks")}</h3>
              {(subtasks.data ?? []).map((item) => (
                <div key={item.id} className="wp-row">
                  <span>{item.title}</span>
                  <span>{labelStatus(item.status)}</span>
                </div>
              ))}
              {canEditLinks && task.reporter_member_id > 0 && <div className="wp-inline-add">
                <input
                  value={subtaskTitle}
                  onChange={(e) => setSubtaskTitle(e.target.value)}
                  placeholder={t("عنوان المهمة الفرعية", "Subtask title")}
                />
                <Button
                  icon={<Plus size={15} />}
                  onClick={async () => {
                    if (!subtaskTitle.trim()) return;
                    try {
                      await mutation.mutateAsync({
                        table: "web_project_tasks",
                        operation: "insert",
                        data: {
                          project_id: projectId,
                          parent_task_id: task.id,
                          reporter_member_id: task.reporter_member_id,
                          title: subtaskTitle.trim(),
                          description: "",
                          status: "backlog",
                          priority: "normal",
                        },
                      });
                      setSubtaskTitle("");
                      onSaved();
                    } catch {
                      toast.error(
                        t(
                          "تعذر إضافة المهمة الفرعية.",
                          "Could not add subtask.",
                        ),
                      );
                    }
                  }}
                >
                  {t("إضافة", "Add")}
                </Button>
              </div>}
            </section>
            {(workspace.isLead || workspace.isProgramAdmin) && (
              <Button
                variant="danger"
                icon={<Trash2 size={15} />}
                onClick={() => setConfirmCancel(true)}
              >
                {t("حذف المهمة", "Delete task")}
              </Button>
            )}
          </div>
        )}
      </form>
      <ConfirmDialog
        isOpen={confirmCancel}
        title={t("إلغاء المهمة", "Cancel task")}
        message={t("سيتم وضع المهمة بحالة ملغاة مع الاحتفاظ بالتعليقات والتعيينات والمرفقات وسجل النشاط.", "The task will be marked cancelled while comments, assignments, attachments, and audit history are retained.")}
        confirmLabel={t("إلغاء المهمة", "Cancel task")}
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => { setConfirmCancel(false); void removeTask(); }}
      />
    </Modal>
  );
}
