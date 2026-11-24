export type AdminCapability =
  | 'full_owner'
  | 'admin_accounts'
  | 'admin_password_reset'
  | 'strikes'
  | 'app_usage';

export interface CapabilityOption {
  key: AdminCapability;
  label: string;
  labelEn: string;
  description: string;
  descriptionEn: string;
  /** المدة المقترحة بالدقايق عند الموافقة. */
  suggestedMinutes: number;
}

/**
 * القدرات الحساسة اللي بتفضل للمالك بس لحد ما يوافق بمدة محددة.
 * المشرف بيشوفها في الواجهة مقفولة ويقدر يبعت طلب للمالك.
 */
export const CAPABILITY_OPTIONS: ReadonlyArray<CapabilityOption> = [
  {
    key: 'full_owner',
    label: 'صلاحيات المالك الكاملة',
    labelEn: 'Full owner authority',
    description: 'كل حاجة المالك بيعملها، بما فيها حذف الأعضاء نهائيًا وإدارة المشرفين.',
    descriptionEn: 'Everything the owner can do, including permanent member erasure and administrator management.',
    suggestedMinutes: 60,
  },
  {
    key: 'admin_accounts',
    label: 'إدارة حسابات المشرفين',
    labelEn: 'Administrator accounts',
    description: 'إضافة مشرف، تعديل صلاحياته، تنزيله، أو حذف حسابه.',
    descriptionEn: 'Add administrators, edit their access, demote them, or delete their account.',
    suggestedMinutes: 1440,
  },
  {
    key: 'admin_password_reset',
    label: 'تصفير كلمة مرور مشرف',
    labelEn: 'Reset administrator passwords',
    description: 'تعيين كلمة مرور مؤقتة لحساب مشرف تاني.',
    descriptionEn: 'Set a temporary password for another administrator account.',
    suggestedMinutes: 1440,
  },
  {
    key: 'strikes',
    label: 'التحذيرات والطرد',
    labelEn: 'Strikes and expulsion',
    description: 'إصدار تحذيرات رسمية وطرد عضو من الفريق.',
    descriptionEn: 'Issue formal strikes and expel a member from the team.',
    suggestedMinutes: 1440,
  },
  {
    key: 'app_usage',
    label: 'تقرير استخدام التطبيق',
    labelEn: 'App usage report',
    description: 'متابعة مين نزّل التطبيق وبيستخدمه.',
    descriptionEn: 'Track who installed and uses the app.',
    suggestedMinutes: 1440,
  },
];

export const CAPABILITY_BY_KEY: Record<AdminCapability, CapabilityOption> = Object.fromEntries(
  CAPABILITY_OPTIONS.map((option) => [option.key, option]),
) as Record<AdminCapability, CapabilityOption>;

export const CAPABILITY_DURATIONS: ReadonlyArray<{ minutes: number; label: string; labelEn: string }> = [
  { minutes: 60, label: 'ساعة', labelEn: '1 hour' },
  { minutes: 480, label: '8 ساعات', labelEn: '8 hours' },
  { minutes: 1440, label: 'يوم', labelEn: '1 day' },
  { minutes: 10080, label: 'أسبوع', labelEn: '1 week' },
  { minutes: 43200, label: '30 يوم', labelEn: '30 days' },
];

export interface CapabilityRequestState {
  id: number;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  note: string | null;
  requested_at: string;
  decided_at: string | null;
  decided_note: string | null;
  duration_minutes: number | null;
  expires_at: string | null;
}

export interface CapabilityEntry {
  capability: AdminCapability;
  allowed: boolean;
  granted_until: string | null;
  request: CapabilityRequestState | null;
}

export interface CapabilityState {
  is_owner: boolean;
  capabilities: Partial<Record<AdminCapability, CapabilityEntry>>;
  pending_count: number;
}

export interface CapabilityInboxEntry {
  id: number;
  user_id: string;
  email: string;
  capability: AdminCapability;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requested_at: string;
  decided_at: string | null;
  decided_note: string | null;
  duration_minutes: number | null;
  expires_at: string | null;
}

export interface CapabilityGrantEntry {
  id: number;
  user_id: string;
  email: string;
  capability: AdminCapability;
  granted_at: string;
  expires_at: string;
}

export interface CapabilityInbox {
  requests: CapabilityInboxEntry[];
  grants: CapabilityGrantEntry[];
}

export function capabilityOf(state: CapabilityState | undefined, key: AdminCapability): CapabilityEntry | null {
  if (!state) return null;
  if (state.is_owner) {
    return { capability: key, allowed: true, granted_until: null, request: null };
  }
  return state.capabilities?.[key] ?? null;
}

export function formatRemaining(expiresAt: string | null, now = Date.now()): string {
  if (!expiresAt) return '';
  const remaining = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return 'خلصت';
  const minutes = Math.round(remaining / 60000);
  if (minutes < 60) return `${minutes} دقيقة`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ساعة`;
  return `${Math.round(hours / 24)} يوم`;
}
