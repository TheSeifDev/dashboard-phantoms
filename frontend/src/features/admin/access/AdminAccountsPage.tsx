import { useState } from 'react';
import { KeyRound, Pencil, Save, ShieldCheck, ShieldOff, ShieldPlus, Trash2, UserCog, Users } from 'lucide-react';
import { useAuthStore } from '../../../store/auth';
import { toast } from '../../../store/toast';
import { toAppError } from '../../../lib/supabase/errors';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { PageHeader } from '../../../components/ui/PageHeader';
import { CardSkeletons } from '../../../components/ui/Skeleton';
import { Modal } from '../../../components/ui/Modal';
import { useAdminAccess, useAdminAccounts, useAddAdminAccount, useDemoteAdminAccount, useRemoveAdminAccount, useUpdateAdminPermissions } from './api';
import type { AdminAccount, AdminPermission, AdminPermissions } from '../../../types/db';
import { ADMIN_PERMISSION_OPTIONS, FULL_ADMIN_PERMISSIONS, normalizeAdminPermissions } from './permissions';
import { useLocale } from '../../../i18n/useLocale';

function formatDate(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

const permissionEnglish: Record<AdminPermission, { label: string; description: string }> = {
  dashboard: { label: 'Dashboard', description: 'View the administration dashboard summary.' },
  members: { label: 'Members', description: 'View, add, and edit member records.' },
  tasks: { label: 'Tasks', description: 'Manage tasks and review submissions.' },
  ranking: { label: 'Team ranking', description: 'View member rankings and points.' },
  notes: { label: 'Notes', description: 'View, add, and edit member notes.' },
  announcements: { label: 'Announcements', description: 'Manage announcements and send notifications.' },
  whatsapp: { label: 'WhatsApp', description: 'Send tasks and monitor the WhatsApp connection.' },
  ai_assistant: { label: 'AI assistant', description: 'Use the AI assistant services.' },
  web_projects: { label: 'Web Projects', description: 'Administer the Web Projects program and its projects.' },
};

export default function AdminAccountsPage() {
  const { t, number, dir } = useLocale();
  const dateLocale = dir === 'rtl' ? 'ar-EG' : 'en-GB';
  const user = useAuthStore((state) => state.user);
  const access = useAdminAccess(user?.id ?? null);
  const accounts = useAdminAccounts();
  const addAccount = useAddAdminAccount();
  const demoteAccount = useDemoteAdminAccount();
  const removeAccount = useRemoveAdminAccount();
  const updatePermissions = useUpdateAdminPermissions();
  const [email, setEmail] = useState('');
  const [pendingDemotion, setPendingDemotion] = useState<AdminAccount | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<AdminAccount | null>(null);
  const [editingAccount, setEditingAccount] = useState<AdminAccount | null>(null);
  const [permissionDraft, setPermissionDraft] = useState<AdminPermissions>(FULL_ADMIN_PERMISSIONS);

  const addAdmin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return;
    try {
      const result = await addAccount.mutateAsync(cleanEmail);
      setEmail('');
      toast.success(result.invited
        ? t('اتضاف المشرف بصلاحيات التشغيل وبعتنا له دعوة. مشروعات الويب تحتاج تفعيلًا صريحًا.', 'Administrator added with operational access and an email invitation. Web Projects requires an explicit grant.')
        : t('اتضاف المشرف بصلاحيات التشغيل. يمكنك تفعيل مشروعات الويب وتعديل الأقسام من القائمة.', 'Administrator added with operational access. You can explicitly grant Web Projects and customize sections from the list.'));
    } catch (cause) {
      toast.error(toAppError(cause, t('معرفناش نضيف المشرف.', 'Could not add the administrator.')).message);
    }
  };

  const removeAdmin = async () => {
    if (!pendingRemoval) return;
    try {
      await removeAccount.mutateAsync(pendingRemoval.user_id);
      toast.success(t('اتحذف حساب الدخول وكلمة المرور، واتشال من الإدارة.', 'The sign-in account was deleted and administrator access was removed.'));
      setPendingRemoval(null);
    } catch (cause) {
      toast.error(toAppError(cause, t('معرفناش نحذف المشرف.', 'Could not delete the administrator.')).message);
    }
  };

  const demoteAdmin = async () => {
    if (!pendingDemotion) return;
    try {
      const result = await demoteAccount.mutateAsync(pendingDemotion.user_id);
      toast.success(result.member_linked
        ? t('اتشالت صلاحية الإدارة العامة واتحفظ الربط الدقيق بالعضو. يقدر يستخدم دخول العضو بعد تحقق شروطه الحالية.', 'Global administrator access was removed and the exact Member/Auth binding was preserved. The person can use Member login only if the current Member checks pass.')
        : t('اتشالت صلاحية الإدارة العامة. الهوية غير المرتبطة لم تتحول تلقائياً إلى عضو ولم ننشئ لها ربطاً.', 'Global administrator access was removed. This unbound identity was not automatically turned into a Member and no binding was created.'));
      setPendingDemotion(null);
    } catch (cause) {
      toast.error(toAppError(cause, t('معرفناش نشيل صلاحية الإدارة العامة.', 'Could not remove global administrator access.')).message);
    }
  };

  const openPermissions = (account: AdminAccount) => {
    setEditingAccount(account);
    setPermissionDraft(normalizeAdminPermissions(account.permissions));
  };

  const closePermissions = () => {
    if (updatePermissions.isPending) return;
    setEditingAccount(null);
  };

  const togglePermission = (permission: AdminPermission) => {
    setPermissionDraft((current) => ({ ...current, [permission]: !current[permission] }));
  };

  const savePermissions = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingAccount) return;
    try {
      await updatePermissions.mutateAsync({ userId: editingAccount.user_id, permissions: permissionDraft });
      toast.success(t('اتحفظت صلاحيات المشرف.', 'Administrator permissions saved.'));
      setEditingAccount(null);
    } catch (cause) {
      toast.error(toAppError(cause, t('معرفناش نحفظ الصلاحيات.', 'Could not save permissions.')).message);
    }
  };

  if (access.isPending || (access.isFetching && !access.data)) {
    return (
      <div dir={dir} aria-busy="true" aria-live="polite">
        <span className="sr-only">{t('جارٍ التحقق من الصلاحيات…', 'Checking permissions…')}</span>
        <CardSkeletons count={2} />
      </div>
    );
  }
  if (access.isError) {
    return (
      <div dir={dir}>
        <ErrorState
          message={t('معرفناش نتحقق من صلاحياتك. أعد المحاولة قبل إدارة الحسابات.', 'Could not verify your permissions. Retry before managing accounts.')}
          onRetry={() => { void access.refetch(); }}
        />
      </div>
    );
  }
  if (!access.data?.is_owner) {
    return (
      <div dir={dir}>
        <EmptyState
          title={t('إدارة الحسابات للمالك فقط', 'Account management is restricted to the owner')}
          description={t('حسابك يقدر يدير بيانات النظام، لكن إضافة المشرفين أو حذفهم محصورة بمالك النظام.', 'Your account can manage system data, but only the system owner can add or remove administrators.')}
        />
      </div>
    );
  }

  const enabledDraftCount = ADMIN_PERMISSION_OPTIONS.filter(({ key }) => permissionDraft[key]).length;

  return (
    <div className="grid gap-4" dir={dir}>
      <PageHeader
        icon={<ShieldCheck size={24} />}
        title={t('إدارة المشرفين', 'Manage administrators')}
        description={t('مالك النظام يملك كامل الصلاحيات. حدد الأقسام المتاحة لكل مشرف أو احذف حساب دخوله بالكامل.', 'The system owner keeps full access. Choose which sections each administrator can access, or remove their sign-in account.')}
      />

      <Card>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <form id="admin-account-email-form" onSubmit={(event) => void addAdmin(event)} className="grid min-w-0 gap-3" aria-busy={addAccount.isPending}>
            <label htmlFor="admin-account-email" className="text-sm font-extrabold">{t('إضافة مشرف بالبريد الإلكتروني', 'Add administrator by email')}</label>
            <input
              id="admin-account-email"
              type="email"
              dir="ltr"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@example.com"
              aria-describedby="admin-account-email-help"
              className="min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 text-start text-base placeholder:text-[var(--text-muted)] focus:border-[var(--primary)] focus:outline-none focus:ring-4 focus:ring-[var(--primary-soft)] sm:text-sm"
            />
            <p id="admin-account-email-help" className="text-xs leading-6 text-[var(--text-muted)]">
              {t('لو الحساب موجود هيتضاف له الوصول فوراً، ولو جديد هنبعت له دعوة بالبريد. المشرف الجديد يبدأ بكل الأقسام، وتقدر تخصص الوصول بعد كده. صلاحيات المالك تظل كاملة.', 'Existing accounts receive access immediately; new accounts receive an email invitation. New administrators start with every section enabled, which you can customize later. The owner always keeps full access.')}
            </p>
          </form>
          <Button
            type="submit"
            form="admin-account-email-form"
            icon={<ShieldPlus size={18} />}
            isLoading={addAccount.isPending}
            loadingText={t('بنضيف...', 'Adding...')}
            fullOnMobile
          >
            {t('إضافة مشرف', 'Add administrator')}
          </Button>
        </div>
      </Card>

      <Card>
        <section aria-labelledby="admin-accounts-title" aria-busy={accounts.isFetching}>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 id="admin-accounts-title" className="flex items-center gap-2 text-lg font-black">
                <Users size={20} className="shrink-0 text-[var(--link)]" aria-hidden="true" />
                {t('حسابات الإدارة', 'Administrator accounts')}
              </h2>
              <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
                {number(accounts.data?.length ?? 0)} {t('حسابات — خيارات الأقسام تحدد وصول المشرف، وتُراجع الصلاحيات من الخادم.', 'accounts — section choices define administrator access and are verified by the server.')}
              </p>
            </div>
            <Badge variant="success"><KeyRound size={13} aria-hidden="true" />{t('صلاحيات مضبوطة', 'Access is verified')}</Badge>
          </div>

          {accounts.isPending && (
            <div role="status" aria-live="polite" className="grid gap-2">
              <span className="sr-only">{t('جارٍ تحميل حسابات الإدارة…', 'Loading administrator accounts…')}</span>
              <CardSkeletons count={2} />
            </div>
          )}
          {accounts.isError && (
            <div className="grid gap-2" role="alert">
              <ErrorState
                message={t('معرفناش نحمّل حسابات الإدارة.', 'Could not load administrator accounts.')}
                onRetry={() => { void accounts.refetch(); }}
              />
              {accounts.data && (
                <p className="text-center text-xs leading-5 text-[var(--text-muted)]">
                  {t('قد تكون القائمة المعروضة غير محدثة؛ أعد المحاولة للتحقق من أحدث البيانات.', 'The displayed list may be out of date. Retry to check for the latest data.')}
                </p>
              )}
            </div>
          )}
          {accounts.isFetching && !accounts.isPending && !accounts.isError && (
            <p role="status" aria-live="polite" className="mb-3 text-xs text-[var(--text-muted)]">
              {t('جارٍ تحديث القائمة…', 'Refreshing the list…')}
            </p>
          )}
          {accounts.data?.length === 0 && !accounts.isError && (
            <EmptyState
              title={t('مفيش حسابات إدارة', 'No administrator accounts')}
              description={t('حساب المالك يظهر هنا تلقائياً بعد تسجيل الدخول.', 'The owner account appears here automatically after sign-in.')}
            />
          )}
          {accounts.data && accounts.data.length > 0 && (
            <ul className="grid gap-3" aria-label={t('قائمة حسابات الإدارة', 'Administrator account list')}>
              {accounts.data.map((account) => {
                const isOwner = account.role === 'owner';
                const enabledCount = ADMIN_PERMISSION_OPTIONS.filter(({ key }) => account.permissions?.[key] === true).length;
                return (
                  <li key={account.user_id}>
                    <article className="grid gap-4 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${isOwner ? 'bg-amber-500/10 text-amber-500' : 'bg-[var(--primary-soft)] text-[var(--link)]'}`} aria-hidden="true">
                          {isOwner ? <ShieldCheck size={21} /> : <UserCog size={21} />}
                        </span>
                        <div className="min-w-0">
                          <p className="break-all text-start font-bold" dir="ltr">{account.email}</p>
                          <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                            {isOwner
                              ? t('المالك الأساسي · لا يمكن حذف الحساب أو تقليل صلاحياته.', 'Primary owner · This account cannot be deleted or have its access reduced.')
                              : t(`له ${number(enabledCount)} من ${number(ADMIN_PERMISSION_OPTIONS.length)} أقسام · أُضيف ${formatDate(account.created_at, dateLocale)}`, `Access to ${number(enabledCount)} of ${number(ADMIN_PERMISSION_OPTIONS.length)} sections · Added ${formatDate(account.created_at, dateLocale)}`)}
                          </p>
                        </div>
                      </div>
                      <div className="grid gap-3 sm:justify-items-end">
                        <Badge variant={isOwner ? 'warning' : 'primary'}>
                          {isOwner
                              ? t('مالك النظام', 'System owner')
                              : enabledCount === ADMIN_PERMISSION_OPTIONS.length
                                ? t('مشرف كامل', 'Full administrator')
                                : t(`صلاحيات مخصصة · ${number(enabledCount)}`, `Custom access · ${number(enabledCount)}`)}
                        </Badge>
                        {!isOwner && (
                          <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 sm:flex sm:flex-wrap sm:justify-end">
                            <Button
                              type="button"
                              variant="secondary"
                              icon={<Pencil size={16} />}
                              onClick={() => openPermissions(account)}
                              aria-label={t(`تعديل صلاحيات ${account.email}`, `Edit permissions for ${account.email}`)}
                              fullOnMobile
                            >
                              {t('تعديل الوصول', 'Edit access')}
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              icon={<ShieldOff size={16} />}
                              onClick={() => setPendingDemotion(account)}
                              aria-label={t(`إزالة الإدارة العامة من ${account.email}`, `Remove global administrator access from ${account.email}`)}
                              fullOnMobile
                            >
                              {t('إزالة الإدارة العامة', 'Remove global admin')}
                            </Button>
                            <Button
                              type="button"
                              variant="danger"
                              icon={<Trash2 size={16} />}
                              onClick={() => setPendingRemoval(account)}
                              aria-label={t(`حذف حساب ${account.email}`, `Delete account for ${account.email}`)}
                              fullOnMobile
                            >
                              {t('حذف الحساب', 'Delete account')}
                            </Button>
                          </div>
                        )}
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </Card>

      <ConfirmDialog
        isOpen={pendingDemotion !== null}
        onClose={() => { if (!demoteAccount.isPending) setPendingDemotion(null); }}
        onConfirm={() => void demoteAdmin()}
        title={t('إزالة الإدارة العامة؟', 'Remove global administrator access?')}
        itemName={pendingDemotion?.email}
        description={t('ده يشيل صف الإدارة العامة فقط ويحافظ على حساب Auth وكلمة المرور والأجهزة والدعوات والسجل والفرق والمشروعات. لو فيه ربط Member/Auth دقيق يظل محفوظاً، ويمكن استخدام دخول العضو بعد تحقق شروطه؛ الهوية غير المرتبطة لا تتحول تلقائياً إلى Member.', 'This removes only the global administrator row and preserves the Auth account, password, devices, invitations, history, teams, and projects. An exact existing Member/Auth binding stays intact and may use Member login after its eligibility checks; an unbound identity is not automatically made a Member.')}
        confirmLabel={t('إزالة الإدارة العامة', 'Remove global admin')}
        isPending={demoteAccount.isPending}
        pendingLabel={t('بنزيل الإدارة العامة...', 'Removing global admin...')}
      />

      <ConfirmDialog
        isOpen={pendingRemoval !== null}
        onClose={() => setPendingRemoval(null)}
        onConfirm={() => void removeAdmin()}
        title={t('حذف حساب المشرف نهائياً؟', 'Permanently delete this administrator account?')}
        itemName={pendingRemoval?.email}
        description={t('هيتحذف حساب الدخول من Supabase Auth بما فيه بيانات كلمة المرور ووسائل الدخول، وهتتشال صلاحياته فوراً. مش هيقدر يسجل دخول تاني. الحذف نهائي.', 'This permanently deletes the sign-in account from Supabase Auth, including password and sign-in methods, and immediately removes its access. The person will no longer be able to sign in.')}
        confirmLabel={t('حذف الحساب نهائياً', 'Delete account permanently')}
        isPending={removeAccount.isPending}
        pendingLabel={t('بنحذف الحساب...', 'Deleting account...')}
      />

      <Modal
        isOpen={editingAccount !== null}
        onClose={closePermissions}
        title={t('تعديل صلاحيات المشرف', 'Edit administrator access')}
        subtitle={editingAccount?.email}
        icon={<ShieldCheck size={20} />}
        maxWidth="xl"
        footer={(
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={closePermissions} disabled={updatePermissions.isPending} fullOnMobile>{t('إلغاء', 'Cancel')}</Button>
            <Button type="submit" form="admin-permissions-form" icon={<Save size={17} />} isLoading={updatePermissions.isPending} loadingText={t('بنحفظ...', 'Saving...')} fullOnMobile>{t('حفظ الصلاحيات', 'Save access')}</Button>
          </div>
        )}
      >
        <form id="admin-permissions-form" onSubmit={(event) => void savePermissions(event)} className="grid gap-4">
          <div className="rounded-xl border border-[var(--primary)]/30 bg-[var(--primary-soft)] p-4">
            <p id="admin-permissions-scope" className="text-sm font-bold leading-6">
              {t('حدد الأقسام التي يُسمح لهذا المشرف بالوصول إليها. تظل صلاحيات مالك النظام كاملة؛ أما المشرف فيُتاح له فقط ما تحدده هنا.', 'Choose the sections this administrator is allowed to access. The system owner retains full access; administrators can access only the sections selected here.')}
            </p>
            <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
              {t('يشمل النطاق صفحات القسم والإجراءات المرتبطة به. تُراجع الصلاحيات من الخادم عند تنفيذ العمليات.', 'This scope covers each section’s pages and related actions. Permissions are checked by the server when operations run.')}
            </p>
          </div>
          <fieldset aria-describedby="admin-permissions-scope" className="grid min-w-0 gap-2 sm:grid-cols-2">
            <legend className="sr-only">{t('الأقسام المسموح بها', 'Sections this administrator can access')}</legend>
            {ADMIN_PERMISSION_OPTIONS.map(({ key, label, description }) => (
              <label key={key} className={`flex min-h-16 cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors focus-within:ring-4 focus-within:ring-[var(--primary-soft)] ${permissionDraft[key] ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : 'border-[var(--border)] bg-[var(--bg)]'}`}>
                <input
                  type="checkbox"
                  checked={permissionDraft[key]}
                  onChange={() => togglePermission(key)}
                  aria-describedby={`admin-permission-${key}-description`}
                  className="mt-1 size-5 shrink-0 accent-[var(--primary)]"
                />
                <span className="grid min-w-0 gap-1">
                  <span className="text-sm font-extrabold">{t(label, permissionEnglish[key].label)}</span>
                  <span id={`admin-permission-${key}-description`} className="text-xs leading-5 text-[var(--text-muted)]">{t(description, permissionEnglish[key].description)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="text-xs text-[var(--text-muted)]" aria-live="polite">
            {t(`محدد ${enabledDraftCount} من ${ADMIN_PERMISSION_OPTIONS.length} أقسام.`, `${number(enabledDraftCount)} of ${number(ADMIN_PERMISSION_OPTIONS.length)} sections selected.`)}
          </p>
        </form>
      </Modal>
    </div>
  );
}
