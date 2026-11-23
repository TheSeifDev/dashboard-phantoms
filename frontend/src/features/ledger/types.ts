/** عقود RPC الخزنة — مشتركة بين لوحة الإدارة وبوابة العضو. */
export type LedgerKind = 'payment' | 'expense' | 'withdrawal';
export type LedgerStatus = 'pending' | 'approved' | 'rejected';
export type LedgerExpenseCategory =
  | 'equipment'
  | 'software'
  | 'subscription'
  | 'transport'
  | 'food'
  | 'printing'
  | 'event'
  | 'marketing'
  | 'other';
export interface LedgerTeam {
  id: string;
  slug: string;
  name: string;
}
export interface LedgerReceiver {
  user_id: string;
  email: string | null;
  display_name: string;
  label: string;
}
export interface LedgerEntry {
  id: number;
  kind: LedgerKind;
  status: LedgerStatus;
  amount: number;
  title: string | null;
  category: LedgerExpenseCategory | null;
  note: string | null;
  member_id: number | null;
  member_name: string | null;
  receiver_user_id: string | null;
  receiver_label: string | null;
  receiver_email: string | null;
  due_id: number | null;
  occurred_on: string;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
}
export interface LedgerDue {
  id: number;
  member_id: number;
  full_name: string;
  label: string;
  amount: number;
  due_on: string | null;
  created_at: string;
}
export type LedgerMemberState = 'none' | 'extra' | 'paid' | 'partial' | 'unpaid';
export interface LedgerMemberRow {
  member_id: number;
  full_name: string;
  academic_number: string | null;
  due_total: number;
  paid_total: number;
  remaining: number;
  status: LedgerMemberState;
  late: boolean;
  next_due_on: string | null;
  last_payment_on: string | null;
}
export interface LedgerSummary {
  collected: number;
  expenses: number;
  withdrawals: number;
  balance: number;
  expected: number;
  outstanding: number;
  pending_count: number;
  pending_amount: number;
  expense_count: number;
  payment_count: number;
  late_count: number;
  member_count: number;
}
export interface AdminLedgerPayload {
  team: LedgerTeam;
  teams: LedgerTeam[];
  can_manage: boolean;
  summary: LedgerSummary;
  receivers: LedgerReceiver[];
  entries: LedgerEntry[];
  dues: LedgerDue[];
  members: LedgerMemberRow[];
}
export interface MemberLedgerExpense {
  id: number;
  title: string | null;
  category: LedgerExpenseCategory | null;
  amount: number;
  note: string | null;
  occurred_on: string;
}
export interface MemberLedgerDue {
  id: number;
  label: string;
  amount: number;
  due_on: string | null;
}
export interface MemberLedgerPayment {
  id: number;
  amount: number;
  status: LedgerStatus;
  note: string | null;
  receiver_label: string | null;
  receiver_email: string | null;
  due_id: number | null;
  occurred_on: string;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
}
export interface MemberLedgerSummary {
  collected: number;
  expenses: number;
  withdrawals: number;
  balance: number;
  expense_count: number;
  my_paid: number;
  my_pending: number;
  my_expected: number;
  my_remaining: number;
}
export interface MemberLedgerPayload {
  team: LedgerTeam;
  teams: LedgerTeam[];
  summary: MemberLedgerSummary;
  expenses: MemberLedgerExpense[];
  dues: MemberLedgerDue[];
  payments: MemberLedgerPayment[];
  receivers: LedgerReceiver[];
}
export interface LedgerEntryDraft {
  id?: number;
  kind: LedgerKind;
  amount: string;
  title?: string;
  category?: LedgerExpenseCategory;
  note?: string;
  member_id?: number | null;
  receiver_user_id?: string | null;
  due_id?: number | null;
  occurred_on?: string;
}
export interface LedgerDueDraft {
  id?: number;
  member_id: number | null;
  label: string;
  amount: string;
  due_on?: string;
}
export interface LedgerPaymentDraft {
  amount: string;
  receiver_user_id: string;
  due_id?: number | null;
  note?: string;
  occurred_on?: string;
}
export const EXPENSE_CATEGORY_ORDER: LedgerExpenseCategory[] = [
  'equipment',
  'software',
  'subscription',
  'transport',
  'food',
  'printing',
  'event',
  'marketing',
  'other',
];
export const EXPENSE_CATEGORY_LABELS: Record<LedgerExpenseCategory, string> = {
  equipment: 'أجهزة ومعدات',
  software: 'سوفتوير وتراخيص',
  subscription: 'اشتراكات',
  transport: 'مواصلات',
  food: 'أكل وشرب',
  printing: 'طباعة',
  event: 'فعاليات',
  marketing: 'تسويق',
  other: 'مصروفات أخرى',
};
export const LEDGER_STATUS_LABELS: Record<LedgerStatus, string> = {
  pending: 'مستنية تأكيد',
  approved: 'مؤكدة',
  rejected: 'مرفوضة',
};
export const LEDGER_MEMBER_STATE_LABELS: Record<LedgerMemberState, string> = {
  none: 'مفيش التزام',
  extra: 'دفع زيادة',
  paid: 'دفع بالكامل',
  partial: 'دفع جزء',
  unpaid: 'لسه مدفعش',
};
/** تنسيق مبلغ بالجنيه المصري بأرقام واضحة (بدون كسور لو المبلغ صحيح). */
export function money(value: number | string | null | undefined): string {
  const amount = typeof value === 'string' ? Number(value) : value ?? 0;
  const safe = Number.isFinite(amount) ? amount : 0;
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: Number.isInteger(safe) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(safe);
  return `${formatted} ج.م`;
}
/** تاريخ اليوم بصيغة YYYY-MM-DD لخانة التاريخ. */
export function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}