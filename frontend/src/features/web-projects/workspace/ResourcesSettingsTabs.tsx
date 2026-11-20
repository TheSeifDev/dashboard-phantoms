import { useState, type FormEvent } from "react";
import type { WebIntegration, WebProjectAgreement, WebProjectConsent, WebProjectResourceReference, WebResource } from "./types";
import {
  BookOpen,
  Link2,
  Plus,
  Settings2,
  ShieldCheck,
  Save,
} from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { Field, StatusBadge, SafeLink } from "../common";
import { RESOURCE_CATEGORIES } from "../types";
import { useWebMutation, useWebQuery, useWebRpc } from "../api";
import { toast } from "../../../store/toast";
import { useLocale } from "../../../i18n/useLocale";
import type { WorkspaceProps } from "./types";
import { ConfirmDialog } from "./ConfirmDialog";
import { WorkspaceQueryError } from "./WorkspaceQueryError";

export function ResourcesTab({ workspace }: { workspace: WorkspaceProps }) {
  const { t } = useLocale();
  const { projectId, mode, project } = workspace;
  const canManage = workspace.isLead || workspace.isProgramAdmin;
  const projectResources = useWebQuery<WebResource>(mode, "web_resources", projectId);
  const sharedResources = useWebQuery<WebResource>(mode, "web_resources", undefined, {
    project_id: null,
    is_approved: true,
  });
  const refsQuery = useWebQuery<WebProjectResourceReference>(mode, "web_project_resource_refs",
    projectId,
  );
  const integrationsQuery = useWebQuery<WebIntegration>(mode, "web_project_integrations",
    projectId,
  );
  const mutation = useWebMutation(mode);
  const [modal, setModal] = useState(false);
  const [pendingUnlink, setPendingUnlink] = useState<WebProjectResourceReference | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "other",
    tags: "",
    external_url: "",
    version_label: "",
    preview_url: "",
  });
  const [integrationOpen, setIntegrationOpen] = useState(false);
  const [integration, setIntegration] = useState({
    integration_type: "repository",
    label: "",
    link_url: "",
    metadata: "",
  });
  const referencedIds = new Set((refsQuery.data ?? []).map((r) => r.resource_id));
  const all = [...(projectResources.data ?? []), ...(sharedResources.data ?? [])].filter(
    (resource, index, rows) => (!resource.project_id || referencedIds.has(resource.id))
      && rows.findIndex((candidate) => candidate.id === resource.id) === index,
  );
  const addResource = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const row = await mutation.mutateAsync({
        table: "web_resources",
        operation: "insert",
        data: {
          scope_id: projectId,
          project_id: projectId,
          title: form.title.trim(),
          description: form.description.trim(),
          category: form.category,
          tags: form.tags
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
          external_url: form.external_url || null,
          preview_url: form.preview_url || null,
          version_label: form.version_label || null,
          access_status: "pending",
          is_approved: false,
        },
      });
      if (row?.id)
        await mutation.mutateAsync({
          table: "web_project_resource_refs",
          operation: "insert",
          data: {
            project_id: projectId,
            resource_id: row.id,
            resource_scope_id: projectId,
          },
        });
      setModal(false);
      void projectResources.refetch();
      void refsQuery.refetch();
      toast.success(t("تم حفظ المورد.", "Resource saved."));
    } catch {
      toast.error(t("تعذر حفظ المورد.", "Could not save resource."));
    }
  };
  const linkShared = async (resource: WebResource) => {
    try {
      await mutation.mutateAsync({
        table: "web_project_resource_refs",
        operation: "insert",
        data: {
          project_id: projectId,
          resource_id: resource.id,
          resource_scope_id: resource.scope_id,
        },
      });
      void refsQuery.refetch();
      toast.success(
        t(
          "تم ربط المورد المشترك بالمشروع.",
          "Shared resource linked to project.",
        ),
      );
    } catch {
      toast.error(
        t(
          "تعذر ربط المورد؛ قد لا يكون معتمداً أو سبق ربطه.",
          "Could not link this resource; it may not be approved or is already linked.",
        ),
      );
    }
  };
  const unlink = async (row: WebProjectResourceReference) => {
    try {
      await mutation.mutateAsync({ table: "web_project_resource_refs", operation: "delete", filters: { project_id: projectId, resource_id: row.resource_id } });
      void refsQuery.refetch();
      void projectResources.refetch();
    } catch {
      toast.error(t("تعذر إزالة المرجع.", "Could not remove reference."));
    }
  };
  const addIntegration = async (e: FormEvent) => {
    e.preventDefault();
    let metadata: Record<string, unknown> = {};
    try {
      metadata = integration.metadata ? JSON.parse(integration.metadata) : {};
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
        throw new Error();
    } catch {
      toast.error(
        t(
          "البيانات الوصفية يجب أن تكون كائن JSON صالحاً.",
          "Metadata must be a valid JSON object.",
        ),
      );
      return;
    }
    try {
      await mutation.mutateAsync({
        table: "web_project_integrations",
        operation: "insert",
        data: {
          project_id: projectId,
          integration_type: integration.integration_type,
          label: integration.label.trim(),
          link_url: integration.link_url || null,
          metadata,
          connection_state: "metadata_only",
        },
      });
      setIntegrationOpen(false);
      void integrationsQuery.refetch();
      toast.success(
        t(
          "تم حفظ بيانات الربط فقط؛ لا يوجد اتصال بمزود خارجي.",
          "Integration metadata saved only; no external provider is connected.",
        ),
      );
    } catch {
      toast.error(
        t("تعذر حفظ بيانات الربط.", "Could not save integration metadata."),
      );
    }
  };
  const removeIntegration = async (row: WebIntegration) => {
    try {
      await mutation.mutateAsync({
        table: "web_project_integrations",
        operation: "delete",
        id: row.id,
      });
      void integrationsQuery.refetch();
    } catch {
      toast.error(t("تعذر حذف بيانات الربط.", "Could not delete metadata."));
    }
  };
  const openNew = () => {
    setForm({
      title: "",
      description: "",
      category: "other",
      tags: "",
      external_url: "",
      version_label: "",
      preview_url: "",
    });
    setModal(true);
  };
  const resourceError = projectResources.error ?? sharedResources.error ?? refsQuery.error ?? integrationsQuery.error;
  if (resourceError) return <WorkspaceQueryError error={resourceError} queries={[projectResources, sharedResources, refsQuery, integrationsQuery]} />;
  return (
    <div className="wp-tab-content">
      <div className="wp-panel">
        <header className="wp-row">
          <h2>
            <BookOpen size={17} />
            {t("موارد المشروع", "Project resources")}
          </h2>
          {canManage && (
            <Button icon={<Plus size={15} />} onClick={openNew}>
              {t("إضافة مرجع", "Add resource")}
            </Button>
          )}
        </header>
        <p className="wp-muted">
          {t(
            "روابط وبيانات وصفية فقط. لا يوجد إعداد لرفع الملفات في هذه الواجهة.",
            "Links and metadata only. File uploads are not configured in this interface.",
          )}
        </p>
        {all.length ? (
          <div className="wp-resource-grid">
            {all.map((row) => (
              <article key={row.id} className="wp-resource-card">
                <div className="wp-row">
                  <StatusBadge
                    status={row.project_id ? "active" : row.access_status}
                  />
                  <span>{row.version_label || ""}</span>
                </div>
                <h3>{row.title}</h3>
                <p>{row.description}</p>
                <div className="wp-tags">
                  {(row.tags ?? []).map((tag: string) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
                <small>{row.category?.replaceAll("_", " ")}</small>
                <div className="wp-toolbar">
                  <SafeLink href={row.external_url}>
                    {t("فتح الرابط", "Open link")}
                  </SafeLink>
                  {!row.project_id &&
                    canManage &&
                    !referencedIds.has(row.id) && (
                      <Button
                        variant="secondary"
                        onClick={() => void linkShared(row)}
                      >
                        {t("ربط بالمشروع", "Link to project")}
                      </Button>
                    )}
                  {referencedIds.has(row.id) && (
                    <span className="wp-muted">{t("مرتبط", "Linked")}</span>
                  )}

                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="wp-empty-inline">
            {t("لا توجد موارد مرتبطة بعد.", "No linked resources yet.")}
          </p>
        )}
        {(refsQuery.data ?? []).map((ref) => {
          const resource = all.find((r) => r.id === ref.resource_id);
          return (
            resource && (
              <div className="wp-resource-ref" key={ref.resource_id}>
                <span>{resource.title}</span>
                {canManage && (
                  <Button variant="secondary" onClick={() => setPendingUnlink(ref)}>
                    {t("إزالة الربط", "Unlink")}
                  </Button>
                )}
              </div>
            )
          );
        })}
      </div>
      <div className="wp-panel">
        <header className="wp-row">
          <h2>
            <Link2 size={17} />
            {t(
              "روابط المنتج وبيانات التكامل",
              "Product links & integration metadata",
            )}
          </h2>
          {canManage && <Button variant="secondary" onClick={() => setIntegrationOpen(true)}>
            {t("إضافة تكامل", "Add integration")}
          </Button>}
        </header>
        <div className="wp-project-links">
          {([
            { key: "repository_url", label: "Git repository" },
            { key: "live_demo_url", label: "Live demo" },
            { key: "figma_url", label: "Figma" },
            { key: "documentation_url", label: "Documentation" },
          ] as const).map(({ key, label }) => (
            <div key={key}>
              <small>{label}</small>
              <SafeLink href={project[key]}>{project[key] || t("غير محدد", "Not set")}</SafeLink>
            </div>
          ))}
        </div>
        {(integrationsQuery.data ?? []).map((row) => (
          <article className="wp-integration-row" key={row.id}>
            <div>
              <b>{row.label}</b>
              <small>
                {row.integration_type} ·{" "}
                {row.connection_state || "metadata_only"}
              </small>
              <pre>{JSON.stringify(row.metadata ?? {}, null, 2)}</pre>
              <SafeLink href={row.link_url}>
                {row.link_url || t("لا يوجد رابط", "No link")}
              </SafeLink>
            </div>
            {canManage && (
              <Button
                variant="danger"
                onClick={() => void removeIntegration(row)}
              >
                {t("حذف", "Delete")}
              </Button>
            )}
          </article>
        ))}
        <div className="wp-notice">
          {t(
            "هذه بيانات روابط وامتدادات فقط. لم يتم ربط GitHub أو Figma أو أي خدمة API خارجية.",
            "These are references and extension metadata only. GitHub, Figma, and external APIs are not connected.",
          )}
        </div>
      </div>
      {modal && (
        <Modal
          isOpen
          title={t("مورد أو مرجع جديد", "New resource or reference")}
          onClose={() => setModal(false)}
          maxWidth="lg"
          footer={
            <>
              <Button variant="secondary" onClick={() => setModal(false)}>
                {t("إلغاء", "Cancel")}
              </Button>
              <Button type="submit" form="resource-form">
                {t("حفظ المورد", "Save resource")}
              </Button>
            </>
          }
        >
          <form id="resource-form" onSubmit={addResource} className="wp-grid">
            <Field label={t("العنوان", "Title")}>
              <input
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Field>
            <Field label={t("الفئة", "Category")}>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                {RESOURCE_CATEGORIES.map((x) => (
                  <option key={x} value={x}>
                    {x.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("الرابط الخارجي", "External link")}>
              <input
                type="url"
                value={form.external_url}
                onChange={(e) =>
                  setForm({ ...form, external_url: e.target.value })
                }
                placeholder="https://"
              />
            </Field>
            <Field label={t("رابط معاينة", "Preview URL")}>
              <input
                type="url"
                value={form.preview_url}
                onChange={(e) =>
                  setForm({ ...form, preview_url: e.target.value })
                }
                placeholder="https://"
              />
            </Field>
            <Field label={t("الوسوم (فاصلة)", "Tags (comma separated)")}>
              <input
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
              />
            </Field>
            <Field label={t("رقم الإصدار", "Version label")}>
              <input
                value={form.version_label}
                onChange={(e) =>
                  setForm({ ...form, version_label: e.target.value })
                }
              />
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
        isOpen={Boolean(pendingUnlink)}
        title={t("إزالة ربط المورد", "Remove resource link")}
        message={t("سيُزال المرجع من هذا المشروع دون حذف المورد نفسه.", "This removes the project reference without deleting the resource.")}
        confirmLabel={t("إزالة الربط", "Unlink")}
        onCancel={() => setPendingUnlink(null)}
        onConfirm={() => { if (pendingUnlink) void unlink(pendingUnlink); setPendingUnlink(null); }}
      />
      {integrationOpen && (
        <Modal
          isOpen
          title={t(
            "بيانات التكامل (metadata only)",
            "Integration metadata (metadata only)",
          )}
          onClose={() => setIntegrationOpen(false)}
          maxWidth="lg"
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setIntegrationOpen(false)}
              >
                {t("إلغاء", "Cancel")}
              </Button>
              <Button type="submit" form="integration-form">
                {t("حفظ البيانات", "Save metadata")}
              </Button>
            </>
          }
        >
          <form
            id="integration-form"
            onSubmit={addIntegration}
            className="wp-grid"
          >
            <Field label={t("النوع", "Type")}>
              <select
                value={integration.integration_type}
                onChange={(e) =>
                  setIntegration({
                    ...integration,
                    integration_type: e.target.value,
                  })
                }
              >
                <option value="repository">Repository</option>
                <option value="github">GitHub</option>
                <option value="figma">Figma</option>
                <option value="live_demo">Live demo</option>
                <option value="documentation">Documentation</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label={t("الاسم", "Label")}>
              <input
                required
                value={integration.label}
                onChange={(e) =>
                  setIntegration({ ...integration, label: e.target.value })
                }
              />
            </Field>
            <Field label={t("الرابط", "Link URL")}>
              <input
                type="url"
                value={integration.link_url}
                onChange={(e) =>
                  setIntegration({ ...integration, link_url: e.target.value })
                }
              />
            </Field>
            <Field
              label={t("بيانات JSON وصفية اختيارية", "Optional JSON metadata")}
            >
              <textarea
                rows={5}
                value={integration.metadata}
                onChange={(e) =>
                  setIntegration({ ...integration, metadata: e.target.value })
                }
                placeholder="{ }"
              />
            </Field>
          </form>
        </Modal>
      )}
    </div>
  );
}

const PROJECT_STATUSES = [
  "proposed",
  "reviewing",
  "approved",
  "planning",
  "active",
  "on_hold",
  "completed",
  "archived",
  "rejected",
];
export function SettingsTab({ workspace }: { workspace: WorkspaceProps }) {
  const { t } = useLocale();
  const { projectId, project, mode } = workspace;
  const canManage = workspace.isLead || workspace.isProgramAdmin;
  const rpc = useWebRpc(mode);
  const mutation = useWebMutation(mode);
  const [saving, setSaving] = useState(false);
  const [confirmAmendment, setConfirmAmendment] = useState(false);
  const [form, setForm] = useState({
    name: project.name ?? "",
    slug: project.slug ?? "",
    short_description: project.short_description ?? "",
    description: project.description ?? "",
    category: project.category ?? "",
    priority: project.priority ?? "normal",
    expected_delivery_date: project.expected_delivery_date ?? "",
    problem_statement: project.problem_statement ?? "",
    proposed_solution: project.proposed_solution ?? "",
    target_audience: project.target_audience ?? "",
    phantoms_benefit: project.phantoms_benefit ?? "",
    graduation_project: Boolean(project.graduation_project),
    tech_stack: JSON.stringify(project.tech_stack ?? []),
    repository_url: project.repository_url ?? "",
    live_demo_url: project.live_demo_url ?? "",
    figma_url: project.figma_url ?? "",
    documentation_url: project.documentation_url ?? "",
    expected_phantoms_contribution:
      project.expected_phantoms_contribution ?? "",
    technical_support_arrangement: project.technical_support_arrangement ?? "",
    phantoms_integration_status: project.phantoms_integration_status ?? "",
    phantoms_assets_used: Boolean(project.phantoms_assets_used),
  });
  const agreementQuery = useWebQuery<WebProjectAgreement>(mode, "web_project_agreements",
    projectId,
  );
  const consentQuery = useWebQuery<WebProjectConsent>(mode, "web_project_consents",
    projectId,
  );
  const agreementForm = useState({
    ownership_model: project.ownership_model ?? "",
    ownership_notes: project.ownership_notes ?? "",
    license_name: project.license_name ?? "",
    attribution_notes: project.attribution_notes ?? "",
  });
  const [owner, setOwner] = agreementForm;
  const [status, setStatus] = useState(project.status);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      let techStack: unknown;
      try {
        techStack = JSON.parse(form.tech_stack);
      } catch {
        throw new Error(
          t(
            "قائمة التقنيات يجب أن تكون JSON صالحة.",
            "Tech stack must be valid JSON.",
          ),
        );
      }
      if (!Array.isArray(techStack))
        throw new Error(
          t(
            "التقنيات يجب أن تكون قائمة JSON.",
            "Tech stack must be a JSON array.",
          ),
        );
      await mutation.mutateAsync({
        table: "web_projects",
        operation: "update",
        id: projectId,
        data: {
          name: form.name.trim(),
          short_description: form.short_description.trim(),
          description: form.description.trim(),
          category: form.category.trim(),
          priority: form.priority,
          expected_delivery_date: form.expected_delivery_date || null,
          problem_statement: form.problem_statement.trim(),
          proposed_solution: form.proposed_solution.trim(),
          target_audience: form.target_audience.trim(),
          phantoms_benefit: form.phantoms_benefit.trim(),
          graduation_project: form.graduation_project,
          tech_stack: techStack,
          repository_url: form.repository_url || null,
          live_demo_url: form.live_demo_url || null,
          figma_url: form.figma_url || null,
          documentation_url: form.documentation_url || null,
          expected_phantoms_contribution:
            form.expected_phantoms_contribution.trim(),
          technical_support_arrangement:
            form.technical_support_arrangement.trim(),
          phantoms_assets_used: form.phantoms_assets_used,
        },
      });
      toast.success(t("تم حفظ بيانات المشروع.", "Project information saved."));
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("تعذر حفظ إعدادات المشروع.", "Could not save project settings."),
      );
    } finally {
      setSaving(false);
    }
  };
  const setLifecycle = async () => {
    try {
      await rpc.mutateAsync({
        name: "web_set_project_status",
        args: { p_project_id: projectId, p_status: status },
      });
      toast.success(t("تم تحديث مرحلة المشروع.", "Project lifecycle updated."));
      workspace.reloadProject();
    } catch {
      toast.error(
        t(
          "لا يمكن تفعيل المشروع قبل قبول القائد للاتفاق الحالي، أو أن التغيير غير مسموح.",
          "Project cannot activate before the lead accepts the current agreement, or this change is not permitted.",
        ),
      );
    }
  };
  const amendAgreement = async () => {
    try {
      await rpc.mutateAsync({
        name: "web_amend_project_agreement",
        args: {
          p_project_id: projectId,
          p_ownership_model: owner.ownership_model,
          p_ownership_notes: owner.ownership_notes,
          p_license_name: owner.license_name,
          p_attribution_notes: owner.attribution_notes,
          p_terms: agreementQuery.data?.find((agreement) => agreement.version === project.current_agreement_version)?.terms ?? {},
        },
      });
      toast.success(
        t("تم إصدار نسخة اتفاق جديدة.", "New agreement version created."),
      );
      workspace.reloadProject();
    } catch {
      toast.error(t("تعذر تعديل الاتفاق.", "Could not amend agreement."));
    }
  };
  const latestConsentCount = (type: WebProjectConsent["consent_type"]) => {
    const latestByMember = new Map<number, WebProjectConsent>();
    for (const consent of (consentQuery.data ?? [])
      .filter((row) => row.agreement_version === project.current_agreement_version && row.consent_type === type)
      .slice().sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))) {
      if (!latestByMember.has(consent.member_id)) latestByMember.set(consent.member_id, consent);
    }
    return [...latestByMember.values()].filter((row) => row.granted).length;
  };
  const brandConsents = latestConsentCount("phantoms_brand_assets");
  const showcaseConsents = latestConsentCount("public_showcase");
  const setPermissions = async (brand: boolean, showcase: boolean) => {
    try {
      await rpc.mutateAsync({
        name: "web_set_project_permissions",
        args: {
          p_project_id: projectId,
          p_brand_use: brand,
          p_public_showcase: showcase,
        },
      });
      toast.success(
        t(
          "تم تحديث أذونات المشروع بناءً على موافقات المساهمين.",
          "Project permissions updated based on contributor consent.",
        ),
      );
      workspace.reloadProject();
    } catch {
      toast.error(
        t(
          "يلزم وجود موافقة صريحة من كل قائد ومساهم نشط في الاتفاق الحالي.",
          "Explicit consent from every active lead and contributor is required.",
        ),
      );
    }
  };
  const input = (key: keyof typeof form, label: string, type = "text") => (
    <Field key={key} label={t(label, label)}>
      <input
        type={type}
        value={form[key] as string}
        onChange={(e) =>
          setForm({
            ...form,
            [key]: type === "checkbox" ? e.target.checked : e.target.value,
          } as typeof form)
        }
      />
    </Field>
  );
  const settingsError = agreementQuery.error ?? consentQuery.error;
  if (settingsError) return <WorkspaceQueryError error={settingsError} queries={[agreementQuery, consentQuery]} />;
  return (
    <div className="wp-tab-content">
      <div className="wp-panel">
        <h2>
          <Settings2 size={18} />
          {t("إعدادات المشروع والمنتج", "Project & product settings")}
        </h2>
        {canManage ? (
          <form onSubmit={save} className="wp-grid">
            <Field label={t("اسم المشروع", "Project name")}>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label={t("المعرّف (slug)", "Slug")}>
              <input disabled value={form.slug} />
            </Field>
            {input("category", "الفئة")}
            <Field label={t("الأولوية", "Priority")}>
              <select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value as typeof form.priority })}
              >
                {["low", "normal", "high", "urgent"].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </Field>
            {input("expected_delivery_date", "تاريخ التسليم المتوقع", "date")}
            <label>
              <input
                type="checkbox"
                checked={form.graduation_project}
                onChange={(e) =>
                  setForm({ ...form, graduation_project: e.target.checked })
                }
              />
              {t("مشروع تخرج", "Graduation project")}
            </label>
            {[
              ["short_description", "وصف مختصر"],
              ["description", "الوصف الكامل"],
              ["problem_statement", "المشكلة"],
              ["proposed_solution", "الحل المقترح"],
              ["target_audience", "الجمهور المستهدف"],
              ["phantoms_benefit", "منفعة PHANTOMS"],
              ["expected_phantoms_contribution", "مساهمة PHANTOMS المتوقعة"],
              ["technical_support_arrangement", "ترتيب الدعم التقني"],
              ["phantoms_integration_status", "حالة التكامل"],
            ].map(([k, label]) => (
              <div className="wp-span-all" key={k}>
                <Field label={t(label, label)}>
                  <textarea
                    rows={
                      k === "description" || k === "problem_statement" ? 4 : 2
                    }
                    value={String(form[k as keyof typeof form])}
                    onChange={(e) => setForm({ ...form, [k as keyof typeof form]: e.target.value } as typeof form)}
                  />
                </Field>
              </div>
            ))}
            <Field label={t("حالة التكامل", "Integration status (read only)")}><input disabled value={form.phantoms_integration_status} /></Field>
            {input("tech_stack", "التقنيات (قائمة JSON)")}
            <label>
              <input
                type="checkbox"
                checked={form.phantoms_assets_used}
                onChange={(e) =>
                  setForm({ ...form, phantoms_assets_used: e.target.checked })
                }
              />
              {t("يستخدم أصول PHANTOMS", "Uses PHANTOMS assets")}
            </label>
            {input("repository_url", "رابط Git repository", "url")}
            {input("live_demo_url", "رابط العرض الحي", "url")}
            {input("figma_url", "رابط Figma", "url")}
            {input("documentation_url", "رابط التوثيق", "url")}
            <Button type="submit" icon={<Save size={15} />} isLoading={saving}>
              {t("حفظ بيانات المنتج", "Save product information")}
            </Button>
          </form>
        ) : (
          <p className="wp-notice">
            {t(
              "هذه الإعدادات متاحة لقائد المشروع أو مسؤول البرنامج.",
              "Settings are available to the project lead or program administrator.",
            )}
          </p>
        )}
      </div>
      <div className="wp-panel">
        <h2>
          {t("الملكية والترخيص والاتفاق", "Ownership, license & agreement")} · v
          {project.current_agreement_version}
        </h2>
        <div className="wp-notice">
          {t(
            "لا يوجد افتراض بملكية PHANTOMS. تعديل الاتفاق ينشئ نسخة غير قابلة للتغيير ويطلب القبول مجدداً.",
            "PHANTOMS ownership is not assumed. Amending records an immutable version and requires renewed acceptance.",
          )}
        </div>
        {canManage && (
          <div className="wp-grid">
            <Field label={t("نموذج الملكية", "Ownership model")}>
              <select
                value={owner.ownership_model}
                onChange={(e) =>
                  setOwner({ ...owner, ownership_model: e.target.value })
                }
              >
                {[
                  "undetermined",
                  "creator_owned",
                  "joint",
                  "licensed_to_phantoms",
                  "licensed_from_phantoms",
                  "other",
                ].map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </Field>
            {[
              ["ownership_notes", "ملاحظات الملكية"],
              ["license_name", "اسم الترخيص"],
              ["attribution_notes", "ملاحظات الإسناد"],
            ].map(([key, label]) => (
              <Field key={key} label={t(label, label)}>
                <textarea
                  rows={2}
                  value={owner[key as keyof typeof owner]}
                  onChange={(e) =>
                    setOwner({ ...owner, [key]: e.target.value })
                  }
                />
              </Field>
            ))}
            <Button onClick={() => setConfirmAmendment(true)}>
              {t("إصدار نسخة اتفاق جديدة", "Amend agreement")}
            </Button>
          </div>
        )}
        <div className="wp-table-scroll">
          <table className="wp-table">
            <thead>
              <tr>
                <th>{t("نسخة", "Version")}</th>
                <th>{t("الملكية", "Ownership")}</th>
                <th>{t("الترخيص", "License")}</th>
                <th>{t("تاريخ الحفظ", "Recorded")}</th>
              </tr>
            </thead>
            <tbody>
              {(agreementQuery.data ?? []).map((a) => (
                <tr key={a.version}>
                  <td>v{a.version}</td>
                  <td>
                    {a.ownership_model}
                    <small>{a.ownership_notes}</small>
                  </td>
                  <td>
                    {a.license_name}
                    <small>{a.attribution_notes}</small>
                  </td>
                  <td>{a.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="wp-panel">
        <h2>
          <ShieldCheck size={17} />
          {t(
            "أذونات PHANTOMS والموافقة الصريحة",
            "PHANTOMS permissions & explicit consent",
          )}
        </h2>
        <p>
          {t(
            "موافقات النسخة الحالية: أصول العلامة",
            "Current-version brand asset consents",
          )}
          : {brandConsents}/
          {
            workspace.roster.filter(
              (m) =>
                ["lead", "contributor"].includes(m.role ?? "") &&
                m.status === "active",
            ).length
          }{" "}
          · {t("العرض العام", "public showcase")}: {showcaseConsents}
        </p>
        {canManage && (
          <div className="wp-toolbar">
            <Button
              disabled={!project.phantoms_brand_permission}
              variant="secondary"
              onClick={() =>
                void setPermissions(
                  false,
                  Boolean(project.public_showcase_permission),
                )
              }
            >
              {t("إيقاف إذن العلامة", "Disable brand use")}
            </Button>
            <Button
              disabled={!project.public_showcase_permission}
              variant="secondary"
              onClick={() =>
                void setPermissions(
                  Boolean(project.phantoms_brand_permission),
                  false,
                )
              }
            >
              {t("إيقاف العرض العام", "Disable showcase")}
            </Button>
            <Button onClick={() => void setPermissions(true, true)}>
              {t("تفعيل الموافقات المستوفاة", "Enable consented permissions")}
            </Button>
          </div>
        )}
        <p className="wp-muted">
          {t(
            "التفعيل لا ينجح إلا بعد موافقة كل مساهم نشط على النسخة الحالية؛ الأذونات تظل معطلة افتراضياً.",
            "Enabling requires current-version opt-in from every active contributor; permissions default off.",
          )}
        </p>
      </div>
      <div className="wp-panel">
        <h2>{t("دورة حياة المشروع", "Project lifecycle")}</h2>
        <div className="wp-toolbar">
          <StatusBadge status={project.status} />
          {canManage && (
            <>
              <Field label={t("الحالة التالية", "Next status")}>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as typeof status)}
                >
                  {PROJECT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </Field>
              <Button onClick={() => void setLifecycle()}>
                {t("تحديث الحالة", "Update lifecycle")}
              </Button>
            </>
          )}
        </div>
        <p className="wp-muted">
          {t(
            "التفعيل يتطلب قبول الاتفاق الحالي من القائد. الأرشفة שומרת التاريخ والسجلات.",
            "Activation requires the lead to accept the current agreement. Archiving preserves history.",
          )}
        </p>
      </div>
      <ConfirmDialog
        isOpen={confirmAmendment}
        title={t("إصدار نسخة اتفاق جديدة", "Amend project agreement")}
        message={t("سيُعاد الأعضاء النشطون إلى انتظار القبول وتُعطّل أذونات العلامة والعرض العام.", "Active members return to pending acceptance and brand/showcase permissions are reset.")}
        confirmLabel={t("إصدار النسخة", "Amend agreement")}
        onCancel={() => setConfirmAmendment(false)}
        onConfirm={() => { setConfirmAmendment(false); void amendAgreement(); }}
      />
    </div>
  );
}
