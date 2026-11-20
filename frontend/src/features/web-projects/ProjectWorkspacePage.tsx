import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarDays,
  CheckSquare,
  FileText,
  KanbanSquare,
  LayoutDashboard,
  Link2,
  Settings,
  Users,
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import { ErrorState } from "../../components/ui/ErrorState";
import { Skeleton } from "../../components/ui/Skeleton";
import { useLocale } from "../../i18n/useLocale";
import { useAuthStore } from "../../store/auth";
import { toast } from "../../store/toast";
import {
  useWebCandidates,
  useWebInvitations,
  useWebQuery,
  useWebRoster,
  useWebRpc,
} from "./api";
import type { WebProject } from "./types";
import { Progress, StatusBadge } from "./common";
import { labelStatus } from "./workspace/types";
import type {
  WorkspaceMode,
  WorkspaceProps,
  Project,
  Task,
} from "./workspace/types";
import type { WebProjectProgress, WebTask } from "./workspace/types";
import { WorkspaceQueryError } from "./workspace/WorkspaceQueryError";
import { OverviewTab } from "./workspace/OverviewTab";
import { TimelineTab } from "./workspace/TimelineTab";
import { AgileTab } from "./workspace/AgileTab";
import { TasksTab } from "./workspace/TasksTab";
import { TeamTab, ReportsTab } from "./workspace/PeopleReportsTabs";
import { ResourcesTab, SettingsTab } from "./workspace/ResourcesSettingsTabs";
import { TaskDialog } from "./workspace/TaskDialog";
import "./workspace/workspace.css";

type Props = {
  projectIdOverride?: string;
  initialTab?: string;
  embedded?: boolean;
};
const TAB_KEYS = [
  "overview",
  "timeline",
  "agile",
  "tasks",
  "team",
  "reports",
  "resources",
  "settings",
] as const;
const tabCopy: Record<(typeof TAB_KEYS)[number], [string, string]> = {
  overview: ["نظرة عامة", "Overview"],
  timeline: ["المخطط الزمني", "Timeline"],
  agile: ["لوحة Agile", "Agile board"],
  tasks: ["المهام والتسليمات", "Tasks & deliverables"],
  team: ["الفريق والاتفاق", "Team & agreement"],
  reports: ["التقارير والتحديثات", "Reports & updates"],
  resources: ["الموارد", "Resources"],
  settings: ["الإعدادات", "Settings"],
};
const tabIcons = {
  overview: LayoutDashboard,
  timeline: CalendarDays,
  agile: KanbanSquare,
  tasks: CheckSquare,
  team: Users,
  reports: FileText,
  resources: Link2,
  settings: Settings,
};

export default function ProjectWorkspacePage({
  projectIdOverride,
  initialTab,
  embedded = false,
}: Props) {
  const { projectId: routeProjectId } = useParams();
  const [params, setParams] = useSearchParams();
  const { t, dir } = useLocale();
  const pathname = window.location.pathname;
  const mode: WorkspaceMode = pathname.startsWith("/portal/")
    ? "member"
    : "admin";
  const projectId = projectIdOverride ?? routeProjectId ?? "";
  const currentMemberId = useAuthStore(
    (state) => state.currentMember?.id ?? null,
  );
  const [taskDetail, setTaskDetail] = useState<Task | null>(null);
  const [agreementChecked, setAgreementChecked] = useState(false);
  const [localTab, setLocalTab] = useState<string>(initialTab ?? "overview");
  useEffect(() => {
    if (embedded && initialTab) setLocalTab(initialTab);
  }, [embedded, initialTab]);
  const requested = embedded
    ? localTab
    : (params.get("tab") ?? initialTab ?? "overview");
  const tab =
    TAB_KEYS.find((candidate) => candidate === requested) ?? "overview";
  const projectQuery = useWebQuery<WebProject>(
    mode,
    "web_projects",
    projectId,
    {},
    Boolean(projectId),
  );
  const projectProgressQuery = useWebQuery<WebProjectProgress>(
    mode,
    "web_project_progress",
    projectId,
    {},
    Boolean(projectId),
  );
  const routeTasksQuery = useWebQuery<WebTask>(
    mode,
    "web_project_tasks",
    projectId,
    {},
    Boolean(projectId && params.get("task")),
  );
  const rosterQuery = useWebRoster(mode, projectId);
  const candidatesQuery = useWebCandidates(mode, projectId, mode === "admin");
  const invitationsQuery = useWebInvitations();
  useEffect(() => {
    const wanted = params.get("task");
    if (!wanted || !routeTasksQuery.data?.length) return;
    const found = routeTasksQuery.data.find((row) => row.id === wanted);
    if (found) {
      setTaskDetail(found as Task);
      const next = new URLSearchParams(params);
      next.delete("task");
      setParams(next, { replace: true });
    }
  }, [params, routeTasksQuery.data]);
  const rpc = useWebRpc(mode);
  const invitation =
    mode === "member"
      ? (invitationsQuery.data ?? []).find(
          (item) => item.project_id === projectId,
        )
      : undefined;
  const project = projectQuery.data?.[0] as Project | undefined;
  const roster: WorkspaceProps["roster"] = rosterQuery.data ?? [];
  const role = roster.find(
    (member) =>
      member.member_id === currentMemberId && member.status === "active",
  );
  const isProgramAdmin = mode === "admin"; // Usability only; database RLS/RPC remains authoritative.
  const isLead =
    isProgramAdmin ||
    Boolean(
      role?.role === "lead" &&
        role.accepted_agreement_version === project?.current_agreement_version,
    );
  const candidates: WorkspaceProps["candidates"] = candidatesQuery.data ?? [];
  const workspace = useMemo<WorkspaceProps | null>(
    () =>
      project
        ? {
            project,
            projectId,
            mode,
            currentMemberId,
            isLead,
            isProgramAdmin,
            roster,
            candidates,
            reloadProject: () => {
              void projectQuery.refetch();
              void rosterQuery.refetch();
            },
          }
        : null,
    [
      project,
      projectId,
      mode,
      currentMemberId,
      isLead,
      isProgramAdmin,
      roster,
      candidates,
    ],
  );
  const goToTab = (key: string) => {
    if (embedded) setLocalTab(key);
    else {
      const next = new URLSearchParams(params);
      next.set("tab", key);
      setParams(next, { replace: false });
    }
  };
  const acceptInvitation = async () => {
    if (!invitation) return;
    try {
      await rpc.mutateAsync({
        name: "web_accept_project_agreement",
        args: {
          p_project_id: projectId,
          p_version: invitation.current_agreement_version,
        },
      });
      toast.success(
        t(
          "تم قبول الاتفاق. يمكنك الآن فتح مساحة المشروع.",
          "Agreement accepted. You can now open the project workspace.",
        ),
      );
      void invitationsQuery.refetch();
      void projectQuery.refetch();
      void rosterQuery.refetch();
    } catch {
      toast.error(
        t(
          "تعذر قبول الاتفاق الحالي.",
          "Could not accept the current agreement.",
        ),
      );
    }
  };
  if (!projectId)
    return (
      <main className="wp-page" dir={dir}>
        <ErrorState
          message={t(
            "معرّف المشروع غير موجود في الرابط.",
            "Project identifier is missing from the route.",
          )}
        />
      </main>
    );
  if (projectQuery.isLoading)
    return (
      <main className="wp-page wp-workspace-loading" dir={dir}>
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="h-8 w-full" />
        <div className="wp-panel">
          <Skeleton className="h-56 w-full" />
        </div>
      </main>
    );
  if (!project && invitation)
    return (
      <main className="wp-page" dir={dir}>
        <section className="wp-panel wp-invitation-card">
          <p className="wp-kicker">
            {t("دعوة مشروع معلقة", "Pending project invitation")}
          </p>
          <h1>{invitation.project_name}</h1>
          <p>
            {t(
              "يبدأ الوصول إلى مساحة المشروع بعد قراءة الاتفاق وقبوله.",
              "Workspace access begins after reviewing and accepting the agreement.",
            )}
          </p>
          <div className="wp-agreement-summary">
            <b>
              {t("نسخة الاتفاق", "Agreement version")} v
              {invitation.current_agreement_version}
            </b>
            <p>
              <strong>{t("الملكية", "Ownership")}:</strong>{" "}
              {invitation.ownership_model}
            </p>
            <p>{invitation.ownership_notes}</p>
            <p>
              <strong>{t("الترخيص", "License")}:</strong>{" "}
              {invitation.license_name}
            </p>
            <p>
              <strong>{t("الإسناد", "Attribution")}:</strong>{" "}
              {invitation.attribution_notes}
            </p>
            <p>{JSON.stringify(invitation.terms ?? {}, null, 2)}</p>
          </div>
          <label className="wp-agreement-check">
            <input
              type="checkbox"
              checked={agreementChecked}
              onChange={(event) => setAgreementChecked(event.target.checked)}
            />
            {t(
              "قرأت هذه الشروط وأوافق على نسخة الاتفاق الحالية.",
              "I have read and agree to the current agreement version.",
            )}
          </label>
          <Button
            disabled={!agreementChecked}
            onClick={() => void acceptInvitation()}
          >
            {t("قبول الاتفاق الحالي", "Accept current agreement")}
          </Button>
        </section>
      </main>
    );
  if (projectQuery.error)
    return (
      <main className="wp-page" dir={dir}>
        <ErrorState
          message={
            projectQuery.error instanceof Error
              ? projectQuery.error.message
              : t(
                  "تعذر تحميل مساحة المشروع.",
                  "Could not load the project workspace.",
                )
          }
          onRetry={() => {
            void projectQuery.refetch();
            void invitationsQuery.refetch();
          }}
        />
      </main>
    );
  const dependentQueryError =
    rosterQuery.error ??
    projectProgressQuery.error ??
    candidatesQuery.error ??
    (params.get("task") ? routeTasksQuery.error : null);
  if (dependentQueryError)
    return (
      <main className="wp-page" dir={dir}>
        <WorkspaceQueryError
          error={dependentQueryError}
          queries={[
            rosterQuery,
            projectProgressQuery,
            candidatesQuery,
            routeTasksQuery,
          ]}
        />
      </main>
    );
  if (!project || !workspace)
    return (
      <main className="wp-page" dir={dir}>
        <ErrorState
          message={t(
            "المشروع غير متاح لحسابك أو لم يعد موجوداً. لا يتم منح الوصول بمجرد تغيير الرابط.",
            "This project is unavailable to your account or no longer exists. Changing the URL does not grant access.",
          )}
          onRetry={() => void projectQuery.refetch()}
        />
      </main>
    );
  const base = mode === "member" ? "/portal/projects" : "/admin/web-projects";
  const projectProgress = projectProgressQuery.data?.[0];
  const renderTab = () => {
    switch (tab) {
      case "overview":
        return (
          <OverviewTab
            workspace={workspace}
            onOpenTask={(task) => setTaskDetail(task)}
          />
        );
      case "timeline":
        return <TimelineTab workspace={workspace} />;
      case "agile":
        return <AgileTab workspace={workspace} />;
      case "tasks":
        return <TasksTab workspace={workspace} />;
      case "team":
        return <TeamTab workspace={workspace} />;
      case "reports":
        return <ReportsTab workspace={workspace} />;
      case "resources":
        return <ResourcesTab workspace={workspace} />;
      case "settings":
        return <SettingsTab workspace={workspace} />;
    }
  };
  return (
    <main
      className={`wp-page wp-project-workspace ${embedded ? "is-embedded" : ""}`}
      dir={dir}
    >
      <header className="wp-workspace-header">
        <div className="wp-workspace-title">
          <Link to={base} className="wp-back-link">
            <ArrowLeft size={15} />
            {t("كل المشروعات", "All projects")}
          </Link>
          <p className="wp-kicker">
            {project.category || t("مساحة عمل المنتج", "Product workspace")}
          </p>
          <h1>{project.name}</h1>
          <p>{project.short_description}</p>
          <div className="wp-workspace-meta">
            <StatusBadge status={project.status} />
            {project.expected_delivery_date && (
              <span>
                <CalendarDays size={14} />
                {project.expected_delivery_date}
              </span>
            )}
            <span>
              {roster.filter((m) => m.status === "active").length}{" "}
              {t("عضو نشط", "active members")}
            </span>
          </div>
        </div>
        <div className="wp-workspace-progress">
          <small>{t("التقدم المسجل", "Tracked progress")}</small>
          <Progress
            done={projectProgress?.completed_task_count ?? 0}
            total={projectProgress?.task_count ?? 0}
          />
          <span>
            {isLead
              ? t("صلاحية قيادة", "Lead access")
              : role?.role
                ? labelStatus(role.role)
                : t(
                    "مسؤول البرنامج أو عضو المشروع",
                    "Program administrator or project member",
                  )}
          </span>
        </div>
      </header>
      {!embedded && (
        <nav
          className="wp-workspace-tabs"
          aria-label={t("أقسام مساحة المشروع", "Workspace sections")}
        >
          {TAB_KEYS.map((key) => {
            const Icon = tabIcons[key];
            return (
              <button
                type="button"
                key={key}
                className={tab === key ? "active" : ""}
                aria-current={tab === key ? "page" : undefined}
                onClick={() => goToTab(key)}
              >
                <Icon size={15} />
                {t(...tabCopy[key])}
              </button>
            );
          })}
        </nav>
      )}
      {mode === "member" && role?.status === "pending" && (
        <div className="wp-notice">
          {t(
            "الوصول مقيد حتى قبول نسخة الاتفاق الحالية.",
            "Workspace access is restricted until the current agreement is accepted.",
          )}
        </div>
      )}
      <section className="wp-workspace-body" aria-live="polite">
        {renderTab()}
      </section>
      {taskDetail && (
        <TaskDialog
          workspace={workspace}
          task={taskDetail}
          onClose={() => setTaskDetail(null)}
          onSaved={() => {
            void projectQuery.refetch();
          }}
        />
      )}
    </main>
  );
}
