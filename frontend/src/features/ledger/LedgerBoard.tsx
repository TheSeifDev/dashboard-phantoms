import { useMemo, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  BadgeCheck,
  CircleDollarSign,
  Clock3,
  Receipt,
  Search,
  Target,
  Trash2,
  TrendingDown,
  Users,
  Wallet,
} from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { useLocale } from '../../i18n/useLocale';
import { formatDate } from '../../lib/dateUtils';
import { toast } from '../../store/toast';
import { DecideModal } from './DecideModal';
import { DueModal } from './DueModal';
import { EntryModal, type EntryMemberOption } from './EntryModal';
import { LedgerInsights } from './LedgerInsights';
import { LedgerKpiGrid, LedgerStatStrip } from './LedgerKpis';
import { useLedgerEnter, useLedgerRows } from './animations';
import {
  useAdminLedger,
  useDecideLedgerPayment,
  useDeleteLedgerDue,
  useDeleteLedgerEntry,
  useLedgerDirectory,
  useLedgerSeries,
  useSaveLedgerDue,
  useSaveLedgerDueBulk,
  useSaveLedgerEntry,
} from './api';
import type {
  AdminLedgerPayload,
  LedgerDue,
  LedgerDueBulkDraft,
  LedgerDueDraft,
  LedgerEntry,
  LedgerEntryDraft,
  LedgerKind,
  LedgerMemberRow,
} from './types';
import {
  EXPENSE_CATEGORY_LABELS,
  LEDGER_MEMBER_STATE_LABELS,
  LEDGER_STATUS_LABELS,
  money,
} from './types';
import './ledger.css';

type TabKey = 'all' | 'payment' | 'expense' | 'withdrawal' | 'members' | 'dues';
const KIND_LABEL: Record<LedgerKind, string> = { payment: 'دفعة', expense: 'مصروف', withdrawal: 'خصم' };
const KIND_ICON = { payment: ArrowDownLeft, expense: Receipt, withdrawal: ArrowUpRight } as const;
/** أزرار الحركات: أيقونة + عنوان + سطر توضيحي، والالتزام ليه لون مميز. */
const QUICK_ACTIONS: Array<{
  key: LedgerKind | 'due';
  icon: typeof Wallet;
  ar: string;
  en: string;
  hintAr: string;
  hintEn: string;
  tone: 'primary' | 'neutral' | 'accent';
}> = [
  { key: 'payment', icon: ArrowDownLeft, ar: 'دفعة', en: 'Payment', hintAr: 'فلوس داخلة', hintEn: 'money in', tone: 'primary' },
  { key: 'expense', icon: Receipt, ar: 'مصروف', en: 'Expense', hintAr: 'اتصرف في إيه', hintEn: 'what it went on', tone: 'neutral' },
  { key: 'withdrawal', icon: ArrowUpRight, ar: 'خصم', en: 'Deduction', hintAr: 'سحب عضو', hintEn: 'member withdrawal', tone: 'neutral' },
  { key: 'due', icon: Target, ar: 'الزام', en: 'Due', hintAr: 'على مجموعة أعضاء', hintEn: 'for a group', tone: 'accent' },
];

function StatusChip({ status }: { status: LedgerEntry['status'] }) {
  return <span className={`ldg-chip ldg-chip--${status}`}>{LEDGER_STATUS_LABELS[status]}</span>;
}

/** ملخص محسوب من الصفوف المفلترة (لما الإدارة تختار تيم/وحدة معينة). */
function summarizeFiltered(payload: AdminLedgerPayload) {
  const approved = payload.entries.filter((entry) => entry.status === 'approved');
  const sum = (kind: LedgerKind) => approved.filter((entry) => entry.kind === kind).reduce((total, entry) => total + Number(entry.amount), 0);
  const pending = payload.entries.filter((entry) => entry.status === 'pending');
  const collected = sum('payment');
  const expenses = sum('expense');
  const withdrawals = sum('withdrawal');
  return {
    collected,
    expenses,
    withdrawals,
    balance: collected - expenses - withdrawals,
    expected: payload.dues.reduce((total, due) => total + Number(due.amount), 0),
    outstanding: payload.members.reduce((total, row) => total + Number(row.remaining), 0),
    pending_count: pending.length,
    pending_amount: pending.reduce((total, entry) => total + Number(entry.amount), 0),
    expense_count: approved.filter((entry) => entry.kind === 'expense').length,
    payment_count: approved.filter((entry) => entry.kind === 'payment').length,
    late_count: payload.members.filter((row) => row.late).length,
    member_count: payload.members.length,
  };
}

/** جسم الخزنة: خزنة واحدة global + فلتر التيم/الوحدة. */
export function LedgerBoard({ members }: { members?: EntryMemberOption[] }) {
  const { t, number, dir } = useLocale();
  const [unit, setUnit] = useState<string | null>(null);
  const ledger = useAdminLedger(unit);
  const seriesQuery = useLedgerSeries(unit);
  const saveEntry = useSaveLedgerEntry();
  const removeEntry = useDeleteLedgerEntry();
  const decide = useDecideLedgerPayment();
  const saveDue = useSaveLedgerDue();
  const removeDue = useDeleteLedgerDue();
  const saveDueBulk = useSaveLedgerDueBulk();
  const directory = useLedgerDirectory();
  const [tab, setTab] = useState<TabKey>('all');
  const [query, setQuery] = useState('');
  const [entryModal, setEntryModal] = useState<LedgerKind | null>(null);
  const [decideTarget, setDecideTarget] = useState<LedgerEntry | null>(null);
  const [dueModal, setDueModal] = useState<{ due: LedgerDue | null; memberId?: number } | null>(null);
  const [deleteEntry, setDeleteEntry] = useState<LedgerEntry | null>(null);
  const [deleteDue, setDeleteDue] = useState<LedgerDue | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const payload = ledger.data;
  const series = seriesQuery.data ?? [];
  const memberOptions = useMemo<EntryMemberOption[]>(() => {
    if (members && members.length > 0) return members;
    return (payload?.members ?? []).map((row) => ({
      id: row.member_id,
      full_name: row.full_name,
      academic_number: row.academic_number,
      work_status: null,
    }));
  }, [members, payload?.members]);
  const entries = payload?.entries ?? [];
  const pending = entries.filter((entry) => entry.status === 'pending');
  const needle = query.trim().toLowerCase();
  const matches = (values: Array<string | null | undefined>) =>
    !needle || values.filter(Boolean).some((value) => String(value).toLowerCase().includes(needle));
  const filteredEntries = entries
    .filter((entry) => (tab === 'all' ? true : entry.kind === tab))
    .filter((entry) => matches([
      entry.member_name,
      entry.member_unit,
      entry.title,
      entry.note,
      entry.receiver_label,
      entry.receiver_email,
      entry.category ? EXPENSE_CATEGORY_LABELS[entry.category] : null,
    ]));
  const filteredMembers = (payload?.members ?? []).filter((row) => matches([row.full_name, row.academic_number, row.unit]));
  const filteredDues = (payload?.dues ?? []).filter((row) => matches([row.full_name, row.label, row.unit]));
  const submitEntry = async (draft: LedgerEntryDraft) => {
    await saveEntry.mutateAsync({ draft });
    toast.success(t('اتحفظت الحركة في الخزنة.', 'Ledger entry saved.'));
    setEntryModal(null);
  };
  const submitDecision = async (decisionPayload: { id: number; decision: 'approve' | 'reject'; note?: string; amount?: number | null }) => {
    await decide.mutateAsync(decisionPayload);
    toast.success(decisionPayload.decision === 'approve' ? t('تم تأكيد الدفعة.', 'Payment approved.') : t('تم رفض الدفعة.', 'Payment rejected.'));
    setDecideTarget(null);
  };
  const submitDue = async (draft: LedgerDueDraft) => {
    await saveDue.mutateAsync({ draft });
    toast.success(t('اتحفظ الالتزام.', 'Due saved.'));
    setDueModal(null);
  };
  const submitDueBulk = async (draft: LedgerDueBulkDraft) => {
    const result = await saveDueBulk.mutateAsync({ draft });
    if (result.created === 0) {
      toast.info(t('الأعضاء المختارين عندهم نفس الالتزام بالفعل.', 'The selected members already have that due.'));
      setDueModal(null);
      return;
    }
    toast.success(
      result.skipped > 0
        ? t(
          `اتضاف الالتزام لـ ${result.created} عضو · ${result.skipped} كان عندهم نفس الالتزام.`,
          `Due added for ${result.created} members · ${result.skipped} already had it.`,
        )
        : t(
          `اتضاف الالتزام لـ ${result.created} عضو — ${money(result.per_member)} للفرد.`,
          `Due added for ${result.created} members — ${money(result.per_member)} each.`,
        ),
    );
    setDueModal(null);
  };
  const confirmDeleteEntry = async () => {
    if (!deleteEntry) return;
    try {
      await removeEntry.mutateAsync(deleteEntry.id);
      toast.success(t('اتحذفت الحركة.', 'Entry deleted.'));
      setDeleteEntry(null);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('معرفناش نحذف الحركة.', 'Could not delete the entry.'));
    }
  };
  const confirmDeleteDue = async () => {
    if (!deleteDue) return;
    try {
      await removeDue.mutateAsync(deleteDue.id);
      toast.success(t('اتحذف الالتزام.', 'Due deleted.'));
      setDeleteDue(null);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('معرفناش نحذف الالتزام.', 'Could not delete the due.'));
    }
  };
  const summary = payload ? (unit === null ? payload.summary : summarizeFiltered(payload)) : null;
  const units = payload?.units ?? [];
  const totalMembers = units.reduce((total, item) => total + item.count, 0);
  const fullyPaid = (payload?.members ?? []).filter((row) => row.status === 'paid' || row.status === 'extra').length;
  const tabs: Array<{ key: TabKey; label: string; count: number }> = [
    { key: 'all', label: t('كل الحركات', 'All entries'), count: entries.length },
    { key: 'payment', label: t('المدفوعات', 'Payments'), count: entries.filter((entry) => entry.kind === 'payment').length },
    { key: 'expense', label: t('المصروفات', 'Expenses'), count: entries.filter((entry) => entry.kind === 'expense').length },
    { key: 'withdrawal', label: t('الخصومات', 'Deductions'), count: entries.filter((entry) => entry.kind === 'withdrawal').length },
    { key: 'members', label: t('الأعضاء', 'Members'), count: payload?.members.length ?? 0 },
    { key: 'dues', label: t('الالتزامات', 'Dues'), count: payload?.dues.length ?? 0 },
  ];
  useLedgerEnter(boardRef, [Boolean(payload)]);
  useLedgerRows(panelRef, `${tab}:${query}:${unit ?? 'all'}:${entries.length}`);

  if (ledger.isPending) return <CardSkeletons count={3} />;
  if (ledger.isError) {
    return <ErrorState message={t('معرفناش نحمّل الخزنة.', 'Could not load the ledger.')} onRetry={() => { void ledger.refetch(); }} />;
  }
  if (!payload || !summary) return null;

  return (
    <div className="ldg-board" dir={dir} ref={boardRef}>
      <div className="ldg-topbar" data-ldg-enter>
        <div className="ldg-units" role="group" aria-label={t('فلتر التيم/الوحدة', 'Filter by team or unit')}>
          <button type="button" className="ldg-unit" aria-pressed={unit === null} onClick={() => setUnit(null)}>
            <span>{t('الكل', 'All')}</span>
            <span className="ldg-unit-count">{number(totalMembers)}</span>
          </button>
          {units.map((item) => (
            <button
              key={item.unit}
              type="button"
              className="ldg-unit"
              aria-pressed={unit === item.unit}
              onClick={() => setUnit(unit === item.unit ? null : item.unit)}
            >
              <span>{item.unit}</span>
              <span className="ldg-unit-count">{number(item.count)}</span>
            </button>
          ))}
        </div>
        <div className="ldg-actions" role="group" aria-label={t('تسجيل حركة', 'Record an entry')}>
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.key}
                type="button"
                className="ldg-action"
                data-tone={action.tone}
                onClick={() => (action.key === 'due' ? setDueModal({ due: null }) : setEntryModal(action.key))}
              >
                <span className="ldg-action-icon" aria-hidden="true"><Icon size={17} /></span>
                <span className="ldg-action-copy">
                  <strong>{t(action.ar, action.en)}</strong>
                  <small>{t(action.hintAr, action.hintEn)}</small>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <section className="ldg-hero" aria-label={t('ملخص الخزنة', 'Ledger summary')} data-ldg-enter>
        <div className="ldg-hero-main">
          <span className="ldg-hero-label"><Wallet size={15} aria-hidden="true" /> {t('المبلغ المتاح حاليًا', 'Available balance')}</span>
          <strong className="ldg-hero-value">{money(summary.balance)}</strong>
          <span className="ldg-hero-team">
            {unit ?? t('كل الخزنة', 'Whole ledger')} · {t('الرصيد = المدفوعات المؤكدة − المصروفات − الخصومات', 'Balance = approved payments − expenses − deductions')}
          </span>
        </div>
        <div className="ldg-hero-side">
          <div><span>{t('إجمالي المدفوع', 'Total collected')}</span><strong>{money(summary.collected)}</strong></div>
          <div><span>{t('إجمالي المصروفات', 'Total expenses')}</span><strong>{money(summary.expenses)}</strong></div>
          <div><span>{t('إجمالي الخصومات', 'Total deductions')}</span><strong>{money(summary.withdrawals)}</strong></div>
        </div>
      </section>

      <LedgerKpiGrid
        tiles={[
          {
            key: 'balance',
            title: t('المتاح في الخزنة', 'Available balance'),
            value: summary.balance,
            detail: t('رصيد تراكمي على آخر 6 شهور', 'Cumulative balance over 6 months'),
            icon: Wallet,
            tone: 'violet',
            series: series.map((point) => Number(point.balance) || 0),
          },
          {
            key: 'collected',
            title: t('إجمالي المدفوع', 'Total collected'),
            value: summary.collected,
            detail: `${number(summary.payment_count)} ${t('دفعة مؤكدة', 'approved payments')}`,
            icon: ArrowDownLeft,
            tone: 'blue',
            series: series.map((point) => Number(point.collected) || 0),
          },
          {
            key: 'expenses',
            title: t('إجمالي المصروفات', 'Total expenses'),
            value: summary.expenses,
            detail: `${number(summary.expense_count)} ${t('مصروف مسجل', 'recorded expenses')}`,
            icon: Receipt,
            tone: 'amber',
            series: series.map((point) => Number(point.expenses) || 0),
          },
          {
            key: 'withdrawals',
            title: t('الخصومات', 'Deductions'),
            value: summary.withdrawals,
            detail: t('فلوس اتسحبت من الخزنة', 'Money taken out of the ledger'),
            icon: ArrowUpRight,
            tone: 'violet',
            series: series.map((point) => Number(point.withdrawals) || 0),
          },
        ]}
      />

      <LedgerStatStrip
        items={[
          {
            key: 'outstanding',
            label: t('المستحق على الأعضاء', 'Outstanding dues'),
            value: money(summary.outstanding),
            hint: `${t('من إجمالي', 'out of')} ${money(summary.expected)}`,
          },
          {
            key: 'pending',
            label: t('دفعات مستنية التأكيد', 'Pending approvals'),
            value: number(summary.pending_count),
            hint: `${money(summary.pending_amount)} ${t('معلّقة', 'on hold')}`,
          },
          {
            key: 'late',
            label: t('متأخرين عن الدفع', 'Late payers'),
            value: number(summary.late_count),
            hint: `${t('من', 'of')} ${number(summary.member_count)} ${t('عضو', 'members')}`,
          },
          {
            key: 'paid',
            label: t('أعضاء دفعوا بالكامل', 'Fully paid'),
            value: number(fullyPaid),
            hint: t('التزامات مسددة', 'dues settled'),
          },
        ]}
      />

      <LedgerInsights
        series={series}
        paidTotal={summary.collected}
        remainingTotal={summary.outstanding}
        expectedTotal={summary.expected}
        variant="admin"
      />

      {pending.length > 0 && (
        <section className="ldg-pending" aria-label={t('دفعات مستنية التأكيد', 'Pending payments')} data-ldg-enter>
          <header className="ldg-pending-head">
            <span><Clock3 size={16} aria-hidden="true" /> {t('مستنية تأكيدك', 'Waiting for your confirmation')}</span>
            <small>{number(pending.length)}</small>
          </header>
          <div className="ldg-pending-list">
            {pending.map((entry) => (
              <div key={entry.id} className="ldg-pending-row">
                <div className="ldg-pending-who">
                  <strong>{entry.member_name ?? t('عضو', 'Member')}</strong>
                  <small>
                    {t('دفع لـ', 'paid to')} {entry.receiver_label ?? '—'} · {formatDate(entry.occurred_on)}
                    {entry.note ? ` · ${entry.note}` : ''}
                  </small>
                </div>
                <strong className="ldg-pending-amount">{money(entry.amount)}</strong>
                <Button variant="secondary" onClick={() => setDecideTarget(entry)}>{t('مراجعة', 'Review')}</Button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="ldg-panel" aria-label={t('حركات الخزنة', 'Ledger entries')} ref={panelRef} data-ldg-enter>
        <div className="ldg-toolbar">
          <div className="ldg-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('ابحث بالعضو أو المصروف أو المستلم…', 'Search by member, expense, or receiver…')}
              aria-label={t('بحث في الخزنة', 'Search the ledger')}
            />
          </div>
          <div className="ldg-tabs" role="group" aria-label={t('تصفية الحركات', 'Filter entries')}>
            {tabs.map((item) => (
              <button key={item.key} type="button" className="ldg-tab" aria-pressed={tab === item.key} onClick={() => setTab(item.key)}>
                <span>{item.label}</span>
                <span className="ldg-tab-count">{number(item.count)}</span>
              </button>
            ))}
          </div>
        </div>
        {tab === 'members' ? (
          filteredMembers.length === 0 ? (
            <EmptyState title={t('مفيش أعضاء على الخزنة لسه', 'No members on the ledger yet')} description={t('أضف التزام على عضو أو سجّل دفعة، وبعدها هيظهر هنا بحالة الدفع بتاعته.', 'Add a due or record a payment and the member appears here with their payment status.')} />
          ) : (
            <div className="ldg-table" role="table" aria-label={t('حالة دفع الأعضاء', 'Member payment status')}>
              <div className="ldg-table-head" role="row">
                <span role="columnheader">{t('العضو', 'Member')}</span>
                <span role="columnheader">{t('التيم/الوحدة', 'Unit')}</span>
                <span role="columnheader">{t('المطلوب', 'Due')}</span>
                <span role="columnheader">{t('دفع', 'Paid')}</span>
                <span role="columnheader">{t('فاضل', 'Remaining')}</span>
                <span role="columnheader">{t('الحالة', 'Status')}</span>
                <span role="columnheader">{t('إجراء', 'Action')}</span>
              </div>
              {filteredMembers.map((row: LedgerMemberRow) => (
                <div key={row.member_id} className="ldg-table-row" role="row">
                  <span className="ldg-cell ldg-cell--name" role="cell">
                    <strong>{row.full_name}</strong>
                    <small>{row.academic_number ?? '—'}{row.next_due_on ? ` · ${t('استحقاق', 'due')} ${formatDate(row.next_due_on)}` : ''}</small>
                  </span>
                  <span className="ldg-cell" role="cell" data-label={t('التيم/الوحدة', 'Unit')}>
                    <span className="ldg-unit-chip">{row.unit}</span>
                  </span>
                  <span className="ldg-cell" role="cell" data-label={t('المطلوب', 'Due')}>{money(row.due_total)}</span>
                  <span className="ldg-cell" role="cell" data-label={t('دفع', 'Paid')}>{money(row.paid_total)}</span>
                  <span className="ldg-cell" role="cell" data-label={t('فاضل', 'Remaining')}>{money(row.remaining)}</span>
                  <span className="ldg-cell" role="cell" data-label={t('الحالة', 'Status')}>
                    <span className={`ldg-chip ldg-chip--state-${row.status}`}>{LEDGER_MEMBER_STATE_LABELS[row.status]}</span>
                    {row.late && <span className="ldg-chip ldg-chip--late">{t('متأخر', 'Late')}</span>}
                  </span>
                  <span className="ldg-cell" role="cell" data-label={t('إجراء', 'Action')}>
                    <Button variant="ghost" onClick={() => setDueModal({ due: null, memberId: row.member_id })}>{t('التزام', 'Due')}</Button>
                  </span>
                </div>
              ))}
            </div>
          )
        ) : tab === 'dues' ? (
          <>
            <div className="ldg-toolbar-actions">
              <Button icon={<Target size={16} aria-hidden="true" />} onClick={() => setDueModal({ due: null })}>
                {t('التزام جديد', 'New due')}
              </Button>
            </div>
            {filteredDues.length === 0 ? (
              <EmptyState title={t('مفيش التزامات مسجلة', 'No dues yet')} description={t('حدّد المطلوب من كل عضو (اشتراك، رحلة، معدات) عشان تعرف مين دفع ومين متأخر.', 'Set what each member owes (subscription, trip, equipment) to track who paid and who is late.')} />
            ) : (
              <div className="ldg-table" role="table" aria-label={t('الالتزامات', 'Dues')}>
                <div className="ldg-table-head" role="row">
                  <span role="columnheader">{t('العضو', 'Member')}</span>
                  <span role="columnheader">{t('التيم/الوحدة', 'Unit')}</span>
                  <span role="columnheader">{t('الالتزام', 'Due')}</span>
                  <span role="columnheader">{t('المبلغ', 'Amount')}</span>
                  <span role="columnheader">{t('الاستحقاق', 'Due date')}</span>
                  <span role="columnheader">{t('إجراء', 'Action')}</span>
                </div>
                {filteredDues.map((due) => (
                  <div key={due.id} className="ldg-table-row" role="row">
                    <span className="ldg-cell ldg-cell--name" role="cell"><strong>{due.full_name}</strong></span>
                    <span className="ldg-cell" role="cell" data-label={t('التيم/الوحدة', 'Unit')}><span className="ldg-unit-chip">{due.unit}</span></span>
                    <span className="ldg-cell" role="cell" data-label={t('الالتزام', 'Due')}>{due.label}</span>
                    <span className="ldg-cell" role="cell" data-label={t('المبلغ', 'Amount')}>{money(due.amount)}</span>
                    <span className="ldg-cell" role="cell" data-label={t('الاستحقاق', 'Due date')}>{due.due_on ? formatDate(due.due_on) : '—'}</span>
                    <span className="ldg-cell ldg-cell--actions" role="cell" data-label={t('إجراء', 'Action')}>
                      <button type="button" className="ldg-icon-btn" aria-label={t('تعديل الالتزام', 'Edit due')} onClick={() => setDueModal({ due })}>
                        <Target size={16} aria-hidden="true" />
                      </button>
                      <button type="button" className="ldg-icon-btn ldg-icon-btn--danger" aria-label={t('حذف الالتزام', 'Delete due')} onClick={() => setDeleteDue(due)}>
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : filteredEntries.length === 0 ? (
          <EmptyState
            title={query ? t('مفيش نتايج للبحث ده', 'No results for this search') : t('الخزنة لسه فاضية', 'The ledger is empty')}
            description={query ? t('جرّب اسم تاني أو امسح البحث.', 'Try another name or clear the search.') : t('ابدأ بتسجيل أول دفعة أو مصروف للفريق.', 'Start by recording the first team payment or expense.')}
            action={query ? <Button variant="secondary" onClick={() => setQuery('')}>{t('مسح البحث', 'Clear search')}</Button> : undefined}
          />
        ) : (
          <div className="ldg-table" role="table" aria-label={t('حركات الخزنة', 'Ledger entries')}>
            <div className="ldg-table-head" role="row">
              <span role="columnheader">{t('الحركة', 'Entry')}</span>
              <span role="columnheader">{t('التيم/الوحدة', 'Unit')}</span>
              <span role="columnheader">{t('المبلغ', 'Amount')}</span>
              <span role="columnheader">{t('المستلم', 'Receiver')}</span>
              <span role="columnheader">{t('التاريخ', 'Date')}</span>
              <span role="columnheader">{t('الحالة', 'Status')}</span>
              <span role="columnheader">{t('إجراء', 'Action')}</span>
            </div>
            {filteredEntries.map((entry) => {
              const Icon = KIND_ICON[entry.kind];
              return (
                <div key={entry.id} className="ldg-table-row" role="row">
                  <span className="ldg-cell ldg-cell--name" role="cell">
                    <span className={`ldg-kind ldg-kind--${entry.kind}`} aria-hidden="true"><Icon size={15} /></span>
                    <span className="ldg-cell-copy">
                      <strong>{entry.kind === 'expense' ? entry.title : entry.member_name ?? t('عضو', 'Member')}</strong>
                      <small>
                        {KIND_LABEL[entry.kind]}
                        {entry.kind === 'expense' && entry.category ? ` · ${EXPENSE_CATEGORY_LABELS[entry.category]}` : ''}
                        {entry.note ? ` · ${entry.note}` : ''}
                      </small>
                    </span>
                  </span>
                  <span className="ldg-cell" role="cell" data-label={t('التيم/الوحدة', 'Unit')}>
                    {entry.member_unit ? <span className="ldg-unit-chip">{entry.member_unit}</span> : '—'}
                  </span>
                  <span className="ldg-cell ldg-cell--amount" role="cell" data-label={t('المبلغ', 'Amount')}>{money(entry.amount)}</span>
                  <span className="ldg-cell" role="cell" data-label={t('المستلم', 'Receiver')}>{entry.kind === 'payment' ? entry.receiver_label ?? '—' : '—'}</span>
                  <span className="ldg-cell" role="cell" data-label={t('التاريخ', 'Date')}>{formatDate(entry.occurred_on)}</span>
                  <span className="ldg-cell" role="cell" data-label={t('الحالة', 'Status')}>
                    <StatusChip status={entry.status} />
                    {entry.decision_note && <small className="ldg-decision-note">{entry.decision_note}</small>}
                  </span>
                  <span className="ldg-cell ldg-cell--actions" role="cell" data-label={t('إجراء', 'Action')}>
                    {entry.status === 'pending' && (
                      <Button variant="secondary" onClick={() => setDecideTarget(entry)}>{t('مراجعة', 'Review')}</Button>
                    )}
                    <button type="button" className="ldg-icon-btn ldg-icon-btn--danger" aria-label={t('حذف الحركة', 'Delete entry')} onClick={() => setDeleteEntry(entry)}>
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="ldg-note">
        <CircleDollarSign size={15} aria-hidden="true" />
        <p>{t('الخزنة واحدة للفريق كله — مفيش خزنة لكل تيم لوحده. الفلتر فوق بيقول العضو تابع لأنهي تيم/وحدة (AI، Software، HR، PR، المالك…) والأرقام بتتغير مع الفلتر.', 'One ledger for the whole team — no per-team ledgers. The filter above shows which team/unit a member belongs to (AI, Software, HR, PR, the owner…), and the numbers follow the filter.')}</p>
      </section>
      <section className="ldg-note">
        <Users size={15} aria-hidden="true" />
        <p>{t('العضو بيسجّل «أنا دفعت» من البوابة وتفضل مستنية تأكيد المستلم — والمستلم يقدر يوافق أو يرفض بملاحظة ويصحّح المبلغ. الاستلام متاح للإدارة وهيدز/مونيتورز تيم العضو.', 'Members declare “I paid” from the portal and it stays pending until the receiver approves or rejects it with a note and can correct the amount. Receiving is open to admins plus the heads/monitors of the member’s team.')}</p>
      </section>
      <section className="ldg-note">
        <BadgeCheck size={15} aria-hidden="true" />
        <p>{t('كل الأرقام هنا بأرقام عادية زي صفحة الـ home، والـ sparkline جنبها بيوضح اتجاه آخر 6 شهور بس.', 'Every number here is plain like the home page, with a sparkline showing the last 6 months of movement.')}</p>
      </section>
      <section className="ldg-note">
        <TrendingDown size={15} aria-hidden="true" />
        <p>{t('عايز تغيّر تيم/وحدة عضو (زي co-leader أو PR)؟ عدّل خانة unit في البيانات الإضافية للعضو من صفحة الأعضاء، والفلتر هيقرأها على طول.', 'Need to relabel a member (co-leader, PR…)? Edit the unit key in the member’s custom fields from the members page and the filter picks it up immediately.')}</p>
      </section>

      {entryModal && (
        <EntryModal
          isOpen
          kind={entryModal}
          entry={null}
          members={memberOptions}
          receivers={payload.receivers}
          onClose={() => setEntryModal(null)}
          onSubmit={submitEntry}
          isPending={saveEntry.isPending}
        />
      )}
      <DecideModal
        entry={decideTarget}
        onClose={() => setDecideTarget(null)}
        onSubmit={submitDecision}
        isPending={decide.isPending}
      />
      {dueModal && (
        <DueModal
          isOpen
          due={dueModal.due}
          members={directory.data && directory.data.length > 0 ? directory.data : memberOptions}
          presetMemberId={dueModal.memberId}
          onClose={() => setDueModal(null)}
          onSubmit={submitDue}
          onSubmitBulk={submitDueBulk}
          isPending={saveDue.isPending || saveDueBulk.isPending}
        />
      )}
      <ConfirmDialog
        isOpen={deleteEntry !== null}
        onClose={() => setDeleteEntry(null)}
        onConfirm={() => void confirmDeleteEntry()}
        title={t('حذف الحركة من الخزنة؟', 'Delete this ledger entry?')}
        itemName={deleteEntry ? money(deleteEntry.amount) : undefined}
        description={t('هتتحذف من الخزنة وهتتغير الأرصدة والإجماليات على طول.', 'It is removed from the ledger and the balances and totals change immediately.')}
        confirmLabel={t('حذف', 'Delete')}
        isPending={removeEntry.isPending}
        pendingLabel={t('بيتحذف…', 'Deleting…')}
      />
      <ConfirmDialog
        isOpen={deleteDue !== null}
        onClose={() => setDeleteDue(null)}
        onConfirm={() => void confirmDeleteDue()}
        title={t('حذف الالتزام؟', 'Delete this due?')}
        itemName={deleteDue?.label}
        description={t('الالتزام هيتشال من حساب العضو. الدفعات المسجلة مش هتتأثر.', 'The due is removed from the member’s balance. Recorded payments are not affected.')}
        confirmLabel={t('حذف', 'Delete')}
        isPending={removeDue.isPending}
        pendingLabel={t('بيتحذف…', 'Deleting…')}
      />
    </div>
  );
}
