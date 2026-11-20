import { useState, type FormEvent } from "react";
import type { WebProjectConsent, WebReport, WebTask, WebUpdate } from "./types";
import {
  UserPlus,
  ShieldCheck,
  FileText,
  AlertTriangle,
  Send,
  CheckCircle2,
} from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { Field, StatusBadge, SafeLink } from "../common";
import { useWebMutation, useWebQuery, useWebRpc } from "../api";
import { toast } from "../../../store/toast";
import { useLocale } from "../../../i18n/useLocale";
import type { WebMembership, WorkspaceProps } from "./types";
import type { WebJson } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { WorkspaceQueryError } from "./WorkspaceQueryError";

export function TeamTab({ workspace }: { workspace: WorkspaceProps }) {
  const { t } = useLocale();
  const { project, projectId, mode, roster, candidates, currentMemberId } =
    workspace;
  const canManage = workspace.isLead || workspace.isProgramAdmin;
  const rpc = useWebRpc(mode);
  const consentQuery = useWebQuery<WebProjectConsent>(mode, "web_project_consents",
    projectId,
  );
  const [candidate, setCandidate] = useState("");
  const [role, setRole] = useState("contributor");
  const [responsibility, setResponsibility] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [handoffMember, setHandoffMember] = useState<WebMembership | null>(null);
  const currentVersion = project.current_agreement_version ?? 1;
  const currentConsent = (kind: WebProjectConsent["consent_type"]) => {
    const latest = (consentQuery.data ?? [])
      .filter((row) => row.member_id === currentMemberId
        && row.agreement_version === currentVersion
        && row.consent_type === kind)
      .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0];
    return latest?.granted ?? false;
  };
  if (consentQuery.error)
    return <WorkspaceQueryError error={consentQuery.error} queries={[consentQuery]} />;
  const addMember = async (e: FormEvent) => {
    e.preventDefault();
    if (!candidate) return;
    setAddBusy(true);
    try {
      await rpc.mutateAsync({
        name: "web_add_project_member",
        args: {
          p_project_id: projectId,
          p_member_id: Number(candidate),
          p_role: role,
          p_responsibility: responsibility.trim(),
        },
      });
      toast.success(
        t(
          "تمت إضافة العضو بانتظار قبول الاتفاق.",
          "Member added; agreement acceptance is pending.",
        ),
      );
      setCandidate("");
      setResponsibility("");
    } catch {
      toast.error(
        t(
          "تعذرت إضافة العضو. قد يكون لديه عضوية بالفعل.",
          "Could not add member. They may already belong to this project.",
        ),
      );
    } finally {
      setAddBusy(false);
    }
  };
  const handoff = async (memberId: number) => {
    try {
      await rpc.mutateAsync({
        name: "web_set_project_leader",
        args: { p_project_id: projectId, p_member_id: memberId },
      });
      toast.success(
        t("تم تسجيل تسليم القيادة.", "Leadership handoff recorded."),
      );
    } catch {
      toast.error(t("تعذر تسليم القيادة.", "Could not hand off leadership."));
    }
  };
  const reinvite = async (member: WebMembership) => {
    try {
      await rpc.mutateAsync({ name: "web_add_project_member", args: {
        p_project_id: projectId,
        p_member_id: member.member_id,
        p_role: member.role === "viewer" ? "viewer" : "contributor",
        p_responsibility: member.responsibility,
      }});
      toast.success(t("أعيدت الدعوة؛ يلزم قبول الاتفاق الحالي.", "Invitation renewed; the current agreement must be accepted."));
    } catch {
      toast.error(t("تعذرت إعادة الدعوة.", "Could not renew the invitation."));
    }
  };
  const changeMembership = async (memberId: number, status: string) => {
    try {
      await rpc.mutateAsync({
        name: "web_set_project_member_status",
        args: {
          p_project_id: projectId,
          p_member_id: memberId,
          p_status: status,
        },
      });
      toast.success(t("تم تحديث العضوية.", "Membership updated."));
    } catch {
      toast.error(t("تعذر تحديث العضوية.", "Could not update membership."));
    }
  };
  const recordConsent = async (type: string, granted: boolean) => {
    try {
      await rpc.mutateAsync({
        name: "web_record_project_consent",
        args: {
          p_project_id: projectId,
          p_consent_type: type,
          p_granted: granted,
        },
      });
      void consentQuery.refetch();
      toast.success(
        t(
          "تم تسجيل اختيارك للنسخة الحالية من الاتفاق.",
          "Your choice for the current agreement version was recorded.",
        ),
      );
    } catch {
      toast.error(t("تعذر حفظ الموافقة.", "Could not save consent."));
    }
  };
  const accept = async () => {
    try {
      await rpc.mutateAsync({
        name: "web_accept_project_agreement",
        args: { p_project_id: projectId, p_version: currentVersion },
      });
      toast.success(
        t("تم قبول الاتفاق الحالي.", "Current agreement accepted."),
      );
    } catch {
      toast.error(
        t(
          "تعذر قبول الاتفاق. تأكد أن الدعوة والنسخة لا تزالان ساريتين.",
          "Could not accept agreement. Confirm this invitation and version are current.",
        ),
      );
    }
  };
  const active = roster.filter((m) => m.status === "active");
  return (
    <div className="wp-tab-content">
      <div className="wp-panel">
        <header className="wp-row">
          <h2>{t("فريق المشروع", "Project team")}</h2>
          <span>{roster.length}</span>
        </header>
        <p className="wp-muted">
          {t(
            "الأدوار مستقلة تماماً عن عضويات الفرق الداخلية. العضوية الجديدة تظل معلقة حتى قبول نسخة الاتفاق الحالية.",
            "These roles are separate from internal-team membership. New participation remains pending until the current agreement is accepted.",
          )}
        </p>
        <div className="wp-table-scroll">
          <table className="wp-table">
            <thead>
              <tr>
                <th>{t("العضو", "Member")}</th>
                <th>{t("الدور", "Role")}</th>
                <th>{t("المسؤولية", "Responsibility")}</th>
                <th>{t("الاتفاق", "Agreement")}</th>
                <th>{t("الحالة", "Status")}</th>
                <th>{t("إجراءات", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((member) => (
                <tr key={member.member_id}>
                  <td>
                    <b>{member.full_name}</b>
                    <small>#{member.member_id}</small>
                  </td>
                  <td>
                    <StatusBadge status={member.role ?? "contributor"} />
                    {canManage &&
                      member.role !== "lead" &&
                      member.status === "active" && (
                        <button
                          className="wp-inline-link"
                          onClick={() => setHandoffMember(member)}
                        >
                          {t("تعيين قائداً", "Set as lead")}
                        </button>
                      )}
                  </td>
                  <td>{member.responsibility || "—"}</td>
                  <td>
                    {member.accepted_agreement_version === currentVersion
                      ? t("مقبول", "Accepted")
                      : t("بانتظار القبول", "Acceptance pending")}
                    <small>
                      {member.accepted_agreement_version
                        ? `v${member.accepted_agreement_version}`
                        : ""}
                    </small>
                  </td>
                  <td>
                    <StatusBadge status={member.status ?? "pending"} />
                  </td>
                  <td>
                    {canManage &&
                      member.status === "active" &&
                      member.role !== "lead" && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            void changeMembership(member.member_id, "suspended")
                          }
                        >
                          {t("إيقاف مؤقت", "Suspend")}
                        </Button>
                      )}
                    {canManage && member.status === "suspended" && member.role !== "lead" && (
                      <Button variant="secondary" onClick={() => void reinvite(member)}>
                        {t("إعادة الدعوة", "Re-invite")}
                      </Button>
                    )}
                    {canManage &&
                      member.status !== "removed" &&
                      member.role !== "lead" && (
                        <Button
                          variant="danger"
                          onClick={() =>
                            void changeMembership(member.member_id, "removed")
                          }
                        >
                          {t("إزالة", "Remove")}
                        </Button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {roster.length === 0 && (
          <p className="wp-empty-inline">
            {t("لم تتم إضافة أعضاء بعد.", "No members have been added.")}
          </p>
        )}
      </div>
      {canManage && (
        <div className="wp-panel">
          <h2>
            <UserPlus size={17} />
            {t("إضافة من دليل الأعضاء", "Add from member directory")}
          </h2>
          <form className="wp-toolbar" onSubmit={addMember}>
            <Field label={t("العضو", "Member")}>
              <select
                required
                value={candidate}
                onChange={(e) => setCandidate(e.target.value)}
              >
                <option value="">{t("اختر عضواً", "Choose member")}</option>
                {candidates.map((c) => (
                  <option key={c.member_id} value={c.member_id}>
                    {c.full_name} · #{c.member_id}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("الدور", "Role")}>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="contributor">{t("مساهم", "Contributor")}</option>
                <option value="viewer">{t("مشاهد", "Viewer")}</option>
              </select>
            </Field>
            <Field label={t("المسؤولية", "Responsibility")}>
              <input
                value={responsibility}
                onChange={(e) => setResponsibility(e.target.value)}
                placeholder={t("مثال: تصميم واجهات", "e.g. Interface design")}
              />
            </Field>
            <Button
              type="submit"
              icon={<UserPlus size={15} />}
              isLoading={addBusy}
            >
              {t("إضافة العضو", "Add member")}
            </Button>
          </form>
        </div>
      )}
      <div className="wp-panel">
        <h2>
          <ShieldCheck size={17} />
          {t(
            "اتفاق المشروع والاختيارات الشخصية",
            "Project agreement & personal consents",
          )}
        </h2>
        <div className="wp-agreement-summary">
          <p>
            <b>
              {t("نسخة الاتفاق", "Agreement version")} v{currentVersion}
            </b>
          </p>
          <p>
            <strong>{t("نموذج الملكية", "Ownership model")}:</strong>{" "}
            {project.ownership_model || t("غير محدد", "Not specified")}
          </p>
          <p>
            {project.ownership_notes ||
              t("لم تسجل ملاحظات ملكية.", "No ownership notes recorded.")}
          </p>
          <p>
            <strong>{t("الترخيص", "License")}:</strong>{" "}
            {project.license_name || t("غير محدد", "Not specified")}
          </p>
          <p>
            <strong>{t("الإسناد", "Attribution")}:</strong>{" "}
            {project.attribution_notes || t("غير محدد", "Not specified")}
          </p>
          <p className="wp-muted">
            {t(
              "لا يُفترض أن الملكية تعود تلقائياً إلى PHANTOMS. موافقتك لا تمنح إذناً لعضو آخر.",
              "Ownership is not presumed to belong to PHANTOMS. Your consent does not grant permission on behalf of anyone else.",
            )}
          </p>
        </div>
        {mode === "member" &&
          roster.some(
            (m) => m.member_id === currentMemberId && m.status === "pending",
          ) && (
            <Button
              icon={<CheckCircle2 size={16} />}
              onClick={() => void accept()}
            >
              {t("قبول الاتفاق الحالي", "Accept current agreement")}
            </Button>
          )}
        {mode === "member" &&
          active.some((m) => m.member_id === currentMemberId) && (
            <div className="wp-consent-options">
              <label>
                <input
                  type="checkbox"
                  checked={currentConsent("phantoms_brand_assets")}
                  onChange={(e) =>
                    void recordConsent(
                      "phantoms_brand_assets",
                      e.target.checked,
                    )
                  }
                />
                {t(
                  "أوافق على استخدام أصول وعلامة PHANTOMS في هذا المشروع (اختياري).",
                  "I opt in to use PHANTOMS assets and brand for this project (optional).",
                )}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={currentConsent("public_showcase")}
                  onChange={(e) =>
                    void recordConsent("public_showcase", e.target.checked)
                  }
                />
                {t(
                  "أوافق على العرض العام لهذا المشروع (اختياري).",
                  "I opt in to public showcasing of this project (optional).",
                )}
              </label>
            </div>
          )}
      </div>
      <ConfirmDialog
        isOpen={Boolean(handoffMember)}
        title={t("تسليم قيادة المشروع", "Hand off project leadership")}
        message={t("يحتاج القائد الجديد إلى قبول الاتفاق الحالي.", "The new lead must accept the current agreement.")}
        confirmLabel={t("تسليم القيادة", "Hand off leadership")}
        onCancel={() => setHandoffMember(null)}
        onConfirm={() => { if (handoffMember) void handoff(handoffMember.member_id); setHandoffMember(null); }}
      />
    </div>
  );
}

function weekDates() {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const start = monday.toLocaleDateString("en-CA", {
    timeZone: "Africa/Cairo",
  });
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    start,
    end: sunday.toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" }),
  };
}
export function ReportsTab({ workspace }: { workspace: WorkspaceProps }) {
  const { t, locale } = useLocale();
  const { projectId, mode, currentMemberId, roster } = workspace;
  const canReview = workspace.isLead || workspace.isProgramAdmin;
  const canSubmitMemberWork = Boolean(currentMemberId !== null && workspace.roster.some((member) =>
    member.member_id === currentMemberId && member.status === "active"
    && (member.role === "lead" || member.role === "contributor")
    && member.accepted_agreement_version === workspace.project.current_agreement_version));
  const reportsQuery = useWebQuery<WebReport>(mode, "web_project_member_reports",
    projectId,
  );
  const updatesQuery = useWebQuery<WebUpdate>(mode, "web_project_updates", projectId);
  const tasksQuery = useWebQuery<WebTask>(mode, "web_project_tasks", projectId);
  const mutation = useWebMutation(mode);
  const rpc = useWebRpc(mode);
  const dates = weekDates();
  const [form, setForm] = useState({
    completed: "",
    working: "",
    next: "",
    deliverables: false,
    blockers: "",
    support: false,
    refs: "",
  });
  const [update, setUpdate] = useState({
    type: "progress",
    title: "",
    body: "",
    relatedTask: "",
  });
  const [review, setReview] = useState<WebReport | null>(null);
  const [reviewText, setReviewText] = useState("");
  const [escalate, setEscalate] = useState(false);
  const reports = reportsQuery.data ?? [];
  const current = reports.find(
    (r) =>
      r.member_id === currentMemberId && r.period_start === dates.start,
  );
  const ownReports = reports.filter(
    (r) => canReview || r.member_id === currentMemberId,
  );
  const submitReport = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const refs = form.refs
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((url) => ({ url }));
      await rpc.mutateAsync({
        name: "web_submit_member_report",
        args: {
          p_project_id: projectId,
          p_period_start: dates.start,
          p_period_end: dates.end,
          p_completed_this_week: form.completed,
          p_working_on: form.working,
          p_next_week_plan: form.next,
          p_deliverables_complete: form.deliverables,
          p_blockers: form.blockers,
          p_support_needed: form.support,
          p_references_and_attachments: refs,
        },
      });
      toast.success(
        t("تم إرسال التقرير الأسبوعي.", "Weekly report submitted."),
      );
      void reportsQuery.refetch();
    } catch {
      toast.error(
        t(
          "تعذر إرسال التقرير. تحقق من اكتمال الحقول.",
          "Could not submit report. Check all required fields.",
        ),
      );
    }
  };
  const reviewReport = async (e: FormEvent) => {
    e.preventDefault();
    if (!review) return;
    try {
      await rpc.mutateAsync({
        name: "web_review_member_report",
        args: {
          p_report_id: review.id,
          p_status: reviewText ? "needs_clarification" : "reviewed",
          p_review_notes: reviewText,
          p_blocker_escalated: escalate,
        },
      });
      toast.success(t("تم تسجيل مراجعة التقرير.", "Report review recorded."));
      setReview(null);
      void reportsQuery.refetch();
    } catch {
      toast.error(t("تعذر مراجعة التقرير.", "Could not review report."));
    }
  };
  const postUpdate = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await mutation.mutateAsync({
        table: "web_project_updates",
        operation: "insert",
        data: {
          project_id: projectId,
          author_member_id: currentMemberId,
          update_type: update.type,
          title: update.title.trim(),
          body: update.body.trim(),
          blocker_status: update.type === "blocker" ? "open" : null,
          related_task_id: update.relatedTask || null,
        },
      });
      toast.success(t("تم نشر التحديث.", "Update posted."));
      setUpdate({ type: "progress", title: "", body: "", relatedTask: "" });
      void updatesQuery.refetch();
    } catch {
      toast.error(t("تعذر نشر التحديث.", "Could not post update."));
    }
  };
  const resolveBlocker = async (row: WebUpdate) => {
    try {
      await mutation.mutateAsync({
        table: "web_project_updates",
        operation: "update",
        id: row.id,
        data: {
          blocker_status: "resolved",
          resolved_at: new Date().toISOString(),
        },
      });
      void updatesQuery.refetch();
    } catch {
      toast.error(t("تعذر تحديث العائق.", "Could not update blocker."));
    }
  };
  const queryError = reportsQuery.error ?? updatesQuery.error ?? tasksQuery.error;
  if (queryError) return <WorkspaceQueryError error={queryError} queries={[reportsQuery, updatesQuery, tasksQuery]} />;
  const referenceUrl = (value: WebJson): string | null => typeof value === "object" && value !== null && !Array.isArray(value) && typeof value.url === "string" ? value.url : null;
  return (
    <div className="wp-tab-content">
      {mode === "member" && canSubmitMemberWork && (
        <div className="wp-panel">
          <h2>
            <FileText size={18} />
            {t("التقرير الأسبوعي", "Weekly progress report")} · {dates.start} –{" "}
            {dates.end}
          </h2>
          {current?.status && (
            <p>
              <StatusBadge status={current.status} />{" "}
              {t("آخر إرسال", "Last submitted")}:{" "}
              {current.submitted_at
                ? new Date(current.submitted_at).toLocaleString(
                    locale === "ar" ? "ar-EG" : "en-GB",
                  )
                : ""}
            </p>
          )}
          <form
            id="weekly-report-form"
            onSubmit={submitReport}
            className="wp-report-form"
          >
            <Field
              label={t(
                "ما الذي أنجزته هذا الأسبوع؟",
                "What did you complete this week?",
              )}
            >
              <textarea
                required
                rows={3}
                value={form.completed || current?.completed_this_week || ""}
                onChange={(e) =>
                  setForm({ ...form, completed: e.target.value })
                }
              />
            </Field>
            <Field
              label={t("على ماذا تعمل الآن؟", "What are you working on now?")}
            >
              <textarea
                required
                rows={3}
                value={form.working || current?.working_on || ""}
                onChange={(e) => setForm({ ...form, working: e.target.value })}
              />
            </Field>
            <Field
              label={t(
                "ما خطتك للأسبوع القادم؟",
                "What is your plan for next week?",
              )}
            >
              <textarea
                required
                rows={3}
                value={form.next || current?.next_week_plan || ""}
                onChange={(e) => setForm({ ...form, next: e.target.value })}
              />
            </Field>
            <label>
              <input
                type="checkbox"
                checked={form.deliverables}
                onChange={(e) =>
                  setForm({ ...form, deliverables: e.target.checked })
                }
              />
              {t(
                "هل أكملت التسليمات المكلف بها؟",
                "Did you complete your assigned deliverables?",
              )}
            </label>
            <Field label={t("العوائق التي تواجهك", "Blockers you are facing")}>
              <textarea
                rows={3}
                value={form.blockers}
                onChange={(e) => setForm({ ...form, blockers: e.target.value })}
              />
            </Field>
            <label>
              <input
                type="checkbox"
                checked={form.support}
                onChange={(e) =>
                  setForm({ ...form, support: e.target.checked })
                }
              />
              {t("هل تحتاج إلى دعم تقني؟", "Do you need technical support?")}
            </label>
            <Field
              label={t(
                "مراجع أو روابط (رابط في كل سطر)",
                "References or links (one per line)",
              )}
            >
              <textarea
                rows={2}
                value={form.refs}
                onChange={(e) => setForm({ ...form, refs: e.target.value })}
              />
            </Field>
            <Button type="submit" icon={<Send size={15} />}>
              {current
                ? t("تحديث التقرير", "Update report")
                : t("إرسال التقرير", "Submit report")}
            </Button>
          </form>
        </div>
      )}
      {mode === "member" && !canSubmitMemberWork && <p className="wp-notice">{t("يلزم وجود عضوية مساهم نشطة وقبول الاتفاق الحالي لإرسال تقرير أو تحديث.", "An active contributor membership and current agreement acceptance are required to submit a report or update.")}</p>}
      <div className="wp-panel">
        <h2>
          <AlertTriangle size={18} />
          {t("تحديثات المشروع والعوائق", "Project updates & blockers")}
        </h2>
        {canSubmitMemberWork ? <form className="wp-toolbar" onSubmit={postUpdate}>
          <Field label={t("نوع التحديث", "Update type")}>
            <select
              value={update.type}
              onChange={(e) => setUpdate({ ...update, type: e.target.value })}
            >
              <option value="progress">{t("تقدم", "Progress")}</option>
              <option value="blocker">{t("عائق", "Blocker")}</option>
              <option value="support_request">
                {t("طلب دعم", "Support request")}
              </option>
            </select>
          </Field>
          <Field label={t("العنوان", "Title")}>
            <input
              required
              value={update.title}
              onChange={(e) => setUpdate({ ...update, title: e.target.value })}
            />
          </Field>
          <Field label={t("المهمة المرتبطة", "Related task")}>
            <select
              value={update.relatedTask}
              onChange={(e) =>
                setUpdate({ ...update, relatedTask: e.target.value })
              }
            >
              <option value="">{t("لا يوجد", "None")}</option>
              {(tasksQuery.data ?? []).map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("التفاصيل", "Details")}>
            <textarea
              required
              rows={2}
              value={update.body}
              onChange={(e) => setUpdate({ ...update, body: e.target.value })}
            />
          </Field>
          <Button type="submit">{t("نشر", "Post")}</Button>
        </form> : <p className="wp-muted">{t("النشر متاح للمساهمين ذوي العضوية النشطة فقط.", "Posting is limited to active project contributors.")}</p>}
        <div className="wp-updates-list">
          {(updatesQuery.data ?? [])
            .slice()
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map((item) => (
              <article
                key={item.id}
                className={
                  item.update_type === "blocker" &&
                  item.blocker_status !== "resolved"
                    ? "is-blocked"
                    : ""
                }
              >
                <header>
                  <b>{item.title}</b>
                  <StatusBadge
                    status={
                      item.update_type === "blocker"
                        ? item.blocker_status
                        : item.update_type
                    }
                  />
                  <small>
                    {roster.find((m) => m.member_id === item.author_member_id)
                      ?.full_name ?? `#${item.author_member_id}`}{" "}
                    ·{" "}
                    {item.created_at
                      ? new Date(item.created_at).toLocaleDateString(
                          locale === "ar" ? "ar-EG" : "en-GB",
                        )
                      : ""}
                  </small>
                </header>
                <p>{item.body}</p>
                {canReview &&
                  item.update_type === "blocker" &&
                  item.blocker_status !== "resolved" && (
                    <Button
                      variant="secondary"
                      onClick={() => void resolveBlocker(item)}
                    >
                      {t("حل العائق", "Resolve blocker")}
                    </Button>
                  )}
              </article>
            ))}
        </div>
      </div>
      <div className="wp-panel">
        <h2>{t("تقارير الأعضاء", "Member reports")}</h2>
        {ownReports.length ? (
          <div className="wp-report-list">
            {ownReports
              .slice()
              .sort((a, b) =>
                b.period_start.localeCompare(a.period_start),
              )
              .map((r) => (
                <article key={r.id}>
                  <header>
                    <div>
                      <b>
                        {roster.find((m) => m.member_id === r.member_id)
                          ?.full_name ?? `#${r.member_id}`}
                      </b>
                      <small>
                        {r.period_start} – {r.period_end}
                      </small>
                    </div>
                    <StatusBadge status={r.status} />
                  </header>
                  <dl>
                    <dt>{t("المنجز", "Completed")}</dt>
                    <dd>{r.completed_this_week}</dd>
                    <dt>{t("العمل الحالي", "Current work")}</dt>
                    <dd>{r.working_on}</dd>
                    <dt>{t("الأسبوع القادم", "Next week")}</dt>
                    <dd>{r.next_week_plan}</dd>
                    {r.blockers && (
                      <>
                        <dt>{t("العوائق", "Blockers")}</dt>
                        <dd>{r.blockers}</dd>
                      </>
                    )}
                    {r.support_needed && (
                      <p className="wp-notice">
                        {t("طلب دعم تقني", "Technical support requested")}
                      </p>
                    )}
                    {(r.references_and_attachments ?? []).map((ref, i) => {
                      const url = referenceUrl(ref);
                      return url ? <dd key={i}><SafeLink href={url}>{url}</SafeLink></dd> : null;
                    })}
                  </dl>
                  {r.review_notes && (
                    <p className="wp-notice">{r.review_notes}</p>
                  )}
                  {canReview && r.status !== "reviewed" && (
                    <Button
                      onClick={() => {
                        setReview(r);
                        setReviewText("");
                        setEscalate(Boolean(r.blocker_escalated));
                      }}
                    >
                      {t("مراجعة / تصعيد", "Review / escalate")}
                    </Button>
                  )}
                </article>
              ))}
          </div>
        ) : (
          <p className="wp-empty-inline">
            {t("لا توجد تقارير مرئية بعد.", "No visible reports yet.")}
          </p>
        )}
      </div>
      {review && (
        <Modal
          isOpen
          title={t("مراجعة التقرير", "Review report")}
          subtitle={
            roster.find((m) => m.member_id === review.member_id)?.full_name
          }
          onClose={() => setReview(null)}
          maxWidth="lg"
          footer={
            <>
              <Button variant="secondary" onClick={() => setReview(null)}>
                {t("إلغاء", "Cancel")}
              </Button>
              <Button type="submit" form="report-review-form">
                {t("حفظ المراجعة", "Save review")}
              </Button>
            </>
          }
        >
          <form id="report-review-form" onSubmit={reviewReport}>
            <Field
              label={t(
                "ملاحظات / طلب توضيح",
                "Review notes / clarification request",
              )}
            >
              <textarea
                rows={5}
                value={reviewText}
                onChange={(e) => setReviewText(e.target.value)}
              />
            </Field>
            <label>
              <input
                type="checkbox"
                checked={escalate}
                onChange={(e) => setEscalate(e.target.checked)}
              />
              {t("تصعيد العائق للمتابعة", "Escalate blocker for follow-up")}
            </label>
          </form>
        </Modal>
      )}
    </div>
  );
}
