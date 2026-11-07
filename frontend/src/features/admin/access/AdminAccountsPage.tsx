import { useState } from 'react';
import { KeyRound, Pencil, Save, ShieldCheck, ShieldPlus, Trash2, UserCog, Users } from 'lucide-react';
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
import { useAdminAccess, useAdminAccounts, useAddAdminAccount, useRemoveAdminAccount, useUpdateAdminPermissions } from './api';
import type { AdminAccount, AdminPermission, AdminPermissions } from '../../../types/db';
import { ADMIN_PERMISSION_OPTIONS, FULL_ADMIN_PERMISSIONS, normalizeAdminPermissions } from './permissions';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium' }).format(new Date(value));
}

export default function AdminAccountsPage() {
  const user = useAuthStore((state) => state.user);
  const access = useAdminAccess(user?.id ?? null);
  const accounts = useAdminAccounts();
  const addAccount = useAddAdminAccount();
  const removeAccount = useRemoveAdminAccount();
  const updatePermissions = useUpdateAdminPermissions();
  const [email, setEmail] = useState('');
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
        ? 'اتضاف المشرف بصلاحيات كاملة وبعتنا له دعوة على البريد.'
        : 'اتضاف المشرف بصلاحيات كاملة. تقدر تعدل أقسامه من القائمة.');
    } catch (cause) {
      toast.error(toAppError(cause, 'معرفناش نضيف المشرف.').message);
    }
  };

  const removeAdmin = async () => {
    if (!pendingRemoval) return;
    try {
      await removeAccount.mutateAsync(pendingRemoval.user_id);
      toast.success('اتحذف حساب الدخول وكلمة المرور، واتشال من الإدارة.');
      setPendingRemoval(null);
    } catch (cause) {
      toast.error(toAppError(cause, 'معرفناش نحذف المشرف.').message);
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
      toast.success('اتحفظت صلاحيات المشرف.');
      setEditingAccount(null);
    } catch (cause) {
      toast.error(toAppError(cause, 'معرفناش نحفظ الصلاحيات.').message);
    }
  };

  if (access.isPending || (access.isFetching && !access.data)) {
    return <CardSkeletons count={2} />;
  }
  if (access.isError) {
    return <ErrorState message="معرفناش نتحقق من صلاحياتك. أعد المحاولة قبل إدارة الحسابات." onRetry={() => { void access.refetch(); }} />;
  }
  if (!access.data?.is_owner) {
    return <EmptyState title="إدارة الحسابات للمالك فقط" description="حسابك يقدر يدير بيانات النظام، لكن إضافة المشرفين أو حذفهم محصورة بحساب AHMEDROMU4." />;
  }

  return (
    <div className="grid gap-4" dir="rtl">
      <PageHeader
        icon={<ShieldCheck size={24} />}
        title="إدارة المشرفين"
        description="حساب AHMEDROMU4 هو مالك النظام الثابت. تقدر تحدد الأقسام المتاحة لكل مشرف وتحذف حساب دخوله بالكامل."
      />

      <Card>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <form id="admin-account-email-form" onSubmit={(event) => void addAdmin(event)} className="grid gap-3">
            <label htmlFor="admin-account-email" className="text-sm font-extrabold">إضافة مشرف بالبريد الإلكتروني</label>
            <input
              id="admin-account-email"
              type="email"
              dir="ltr"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@example.com"
              className="min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 text-start text-base placeholder:text-[var(--text-muted)] focus:border-[var(--primary)] focus:outline-none focus:ring-4 focus:ring-[var(--primary-soft)] sm:text-sm"
            />
            <p className="text-xs leading-6 text-[var(--text-muted)]">لو الحساب موجود هتتضاف له الصلاحية فوراً، ولو جديد هنبعتله دعوة بالبريد. الحساب الجديد يبدأ بكل الأقسام، وتقدر تخصصها بعد كده.</p>
          </form>
          <Button
            type="submit"
            form="admin-account-email-form"
            icon={<ShieldPlus size={18} />}
            isLoading={addAccount.isPending}
            loadingText="بنضيف..."
            fullOnMobile
          >
            إضافة مشرف
          </Button>
        </div>
      </Card>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-black"><Users size={20} className="text-[var(--link)]" aria-hidden="true" />حسابات الإدارة</h3>
            <p className="mt-1 text-sm text-[var(--text-muted)]">{accounts.data?.length ?? 0} حسابات — الصلاحيات تُراجع من الخادم باستمرار.</p>
          </div>
          <Badge variant="success"><KeyRound size={13} aria-hidden="true" />صلاحيات مضبوطة</Badge>
        </div>

        {accounts.isPending && <CardSkeletons count={2} />}
        {accounts.isError && <ErrorState message="معرفناش نحمّل حسابات الإدارة." onRetry={() => { void accounts.refetch(); }} />}
        {accounts.data?.length === 0 && <EmptyState title="مفيش حسابات إدارة" description="حساب المالك يظهر هنا تلقائياً بعد تسجيل الدخول." />}
        {accounts.data && accounts.data.length > 0 && (
          <div className="grid gap-3">
            {accounts.data.map((account) => {
              const isOwner = account.role === 'owner';
              const enabledCount = ADMIN_PERMISSION_OPTIONS.filter(({ key }) => account.permissions?.[key] === true).length;
              return (
                <article key={account.user_id} className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${isOwner ? 'bg-amber-500/10 text-amber-500' : 'bg-[var(--primary-soft)] text-[var(--link)]'}`} aria-hidden="true">
                      {isOwner ? <ShieldCheck size={21} /> : <UserCog size={21} />}
                    </span>
                    <div className="min-w-0">
                      <p className="break-all font-bold" dir="ltr">{account.email}</p>
                      <p className="mt-1 text-xs text-[var(--text-muted)]">{isOwner ? 'المالك الأساسي · لا يمكن حذفه أو تخفيض صلاحياته' : `له ${enabledCount} من ${ADMIN_PERMISSION_OPTIONS.length} أقسام · أُضيف ${formatDate(account.created_at)}`}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <Badge variant={isOwner ? 'warning' : 'primary'}>{isOwner ? 'مالك النظام' : enabledCount === ADMIN_PERMISSION_OPTIONS.length ? 'مشرف كامل' : `صلاحيات مخصصة · ${enabledCount}`}</Badge>
                    {!isOwner && (
                      <div className="flex items-center gap-2">
                        <Button type="button" variant="secondary" icon={<Pencil size={16} />} onClick={() => openPermissions(account)} aria-label={`تعديل صلاحيات ${account.email}`}>
                          تعديل الصلاحيات
                        </Button>
                        <Button type="button" variant="danger" icon={<Trash2 size={16} />} onClick={() => setPendingRemoval(account)} aria-label={`حذف حساب ${account.email}`}>
                          حذف الحساب
                        </Button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Card>

      <ConfirmDialog
        isOpen={pendingRemoval !== null}
        onClose={() => setPendingRemoval(null)}
        onConfirm={() => void removeAdmin()}
        title="حذف حساب المشرف نهائياً؟"
        itemName={pendingRemoval?.email}
        description="هيتحذف حساب الدخول من Supabase Auth بما فيه بيانات كلمة المرور ووسائل الدخول، وهتتشال صلاحياته فوراً. مش هيقدر يسجل دخول تاني. الحذف نهائي."
        confirmLabel="حذف الحساب نهائياً"
        isPending={removeAccount.isPending}
        pendingLabel="بنحذف الحساب..."
      />

      <Modal
        isOpen={editingAccount !== null}
        onClose={closePermissions}
        title="تعديل صلاحيات المشرف"
        subtitle={editingAccount?.email}
        icon={<ShieldCheck size={20} />}
        maxWidth="xl"
        footer={(
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={closePermissions} disabled={updatePermissions.isPending} fullOnMobile>إلغاء</Button>
            <Button type="submit" form="admin-permissions-form" icon={<Save size={17} />} isLoading={updatePermissions.isPending} loadingText="بنحفظ..." fullOnMobile>حفظ الصلاحيات</Button>
          </div>
        )}
      >
        <form id="admin-permissions-form" onSubmit={(event) => void savePermissions(event)} className="grid gap-3">
          <p className="text-sm leading-6 text-[var(--text-muted)]">اختار الأقسام اللي يقدر المشرف يفتحها ويديرها. التغيير بيتطبق على الصفحة وعمليات قاعدة البيانات والخدمات المرتبطة.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {ADMIN_PERMISSION_OPTIONS.map(({ key, label, description }) => (
              <label key={key} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${permissionDraft[key] ? 'border-[var(--primary)] bg-[var(--primary-soft)]' : 'border-[var(--border)] bg-[var(--bg)]'}`}>
                <input
                  type="checkbox"
                  checked={permissionDraft[key]}
                  onChange={() => togglePermission(key)}
                  className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
                />
                <span className="grid gap-1">
                  <span className="text-sm font-extrabold">{label}</span>
                  <span className="text-xs leading-5 text-[var(--text-muted)]">{description}</span>
                </span>
              </label>
            ))}
          </div>
        </form>
      </Modal>
    </div>
  );
}
