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
import { useLedgerEnter, useLedgerRows } from './animations';
import {
  useAdminLedger,
  useDecideLedgerPayment,
  useDeleteLedgerDue,
  useDeleteLedgerEntry,
  useSaveLedgerDue,
  useSaveLedgerEntry,
} from './api';
import type {
  LedgerDue,
  LedgerDueDraft,
  LedgerEntry,
  LedgerEntryDraft,
  LedgerKind,
  LedgerMemberRow,
} from './types';
import { EXPENSE_CATEGORY_LABELS, LEDGER_MEMBER_STATE_LABELS, LEDGER_STATUS_LABELS, money } from './types';
import './ledger.css';
type TabKey = 'all' | 'payment' | 'expense' | 'withdrawal' | 'members' | 'dues';
const KIND_LABEL: Record<LedgerKind, string> = { payment: 'دفعة', expense: 'مصروف', withdrawal: 'خصم' };
const KIND_ICON = { payment: ArrowDownLeft, expense: Receipt, withdrawal: ArrowUpRight } as const;
function StatusChip({ status }: { status: LedgerEntry['status'] }) {
  return <span className={`ldg-chip ldg-chip--${status}`}>{LEDGER_STATUS_LABELS[status]}</span>;
}
/** جسم الخزنة القابل لإعادة الاستخدام: لوحة الإدارة ومساحة الفريق. */
export function LedgerBoard({ teamId, members }: { teamId: string; members?: EntryMemberOption[] }) {
  const { t, number, dir } = useLocale();
  const ledger = useAdminLedger(teamId);
  const saveEntry = useSaveLedgerEntry();
  const removeEntry = useDeleteLedgerEntry();
  const decide = useDecideLedgerPayment();
  const saveDue = useSaveLedgerDue();
  const removeDue = useDeleteLedgerDue();
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
      entry.title,
      entry.note,
      entry.receiver_label,
      entry.receiver_email,
      entry.category ? EXPENSE_CATEGORY_LABELS[entry.category] : null,
    ]));
  const filteredMembers = (payload?.members ?? []).filter((row) => matches([row.full_name, row.academic_number]));
  const filteredDues = (payload?.dues ?? []).filter((row) => matches([row.full_name, row.label]));
  const submitEntry = async (draft: LedgerEntryDraft) => {
    await saveEntry.mutateAsync({ teamId, draft });
    toast.success(t('اتحفظت الحركة في الخزنة.', 'Ledger entry saved.'));
    setEntryModal(null);
  };
  const submitDecision = async (decisionPayload: { id: number; decision: 'approve' | 'reject'; note?: string; amount?: number | null }) => {
    await decide.mutateAsync(decisionPayload);
    toast.success(decisionPayload.decision === 'approve' ? t('تم تأكيد الدفعة.', 'Payment approved.') : t('تم رفض الدفعة.', 'Payment rejected.'));
    setDecideTarget(null);
  };
  const submitDue = async (draft: LedgerDueDraft) => {
    await saveDue.mutateAsync({ teamId, draft });
    toast.success(t('اتحفظ الالتزام.', 'Due saved.'));
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
  const summary = payload?.summary;
  const tabs: Array<{ key: TabKey; label: string; count: number }> = [
    { key: 'all', label: t('كل الحركات', 'All entries'), count: entries.length },
    { key: 'payment', label: t('المدفوعات', 'Payments'), count: entries.filter((entry) => entry.kind === 'payment').length },
    { key: 'expense', label: t('المصروفات', 'Expenses'), count: entries.filter((entry) => entry.kind === 'expense').length },
    { key: 'withdrawal', label: t('الخصومات', 'Deductions'), count: entries.filter((entry) => entry.kind === 'withdrawal').length },
    { key: 'members', label: t('الأعضاء', 'Members'), count: payload?.members.length ?? 0 },
    { key: 'dues', label: t('الالتزامات', 'Dues'), count: payload?.dues.length ?? 0 },
  ];
  useLedgerEnter(boardRef, [Boolean(payload)]);
  useLedgerRows(panelRef, `${tab}:${query}:${teamId}:${entries.length}`);
  if (ledger.isPending) return <CardSkeletons count={3} />;
  if (ledger.isError) {
    return <ErrorState message={t('معرفناش نحمّل خزنة التيم.', 'Could not load the team ledger.')} onRetry={() => { void ledger.refetch(); }} />;
  }
  if (!payload || !summary) return null;
  return (
    <div className="ldg-board" dir={dir} ref={boardRef}>
      <div className="ldg-actions" data-ldg-enter>
        <Button icon={<ArrowDownLeft size={17} aria-hidden="true" />} onClick={() => setEntryModal('payment')}>
          {t('دفعة', 'Payment')}
        </Button>
        <Button variant="secondary" icon={<Receipt size={17} aria-hidden="true" />} onClick={() => setEntryModal('expense')}>
          {t('مصروف', 'Expense')}
        </Button>
        <Button variant="secondary" icon={<ArrowUpRight size={17} aria-hidden="true" />} onClick={() => setEntryModal('withdrawal')}>
          {t('خصم', 'Deduction')}
        </Button>
        <Button variant="secondary" icon={<Target size={17} aria-hidden="true" />} onClick={() => setDueModal({ due: null })}>
          {t('التزام', 'Due')}
        </Button>
      </div>
      <section className="ldg-hero" aria-label={t('ملخص الخزنة', 'Ledger summary')} data-ldg-enter>
        <div className="ldg-hero-main">
          <span className="ldg-hero-label"><Wallet size={15} aria-hidden="true" /> {t('المبلغ المتاح حاليًا', 'Available balance')}</span>
          <strong className="ldg-hero-value">{money(summary.balance)}</strong>
          <span className="ldg-hero-team">{payload.team.name} · {t('الرصيد = المدفوعات المؤكدة − المصروفات − الخصومات', 'Balance = approved payments − expenses − deductions')}</span>
        </div>
        <div className="ldg-hero-side">
          <div><span>{t('إجمالي المدفوع', 'Total collected')}</span><strong>{money(summary.collected)}</strong></div>
          <div><span>{t('إجمالي المصروفات', 'Total expenses')}</span><strong>{money(summary.expenses)}</strong></div>
          <div><span>{t('إجمالي الخصومات', 'Total deductions')}</span><strong>{money(summary.withdrawals)}</strong></div>
        </div>
      </section>
      <section className="ldg-metrics" aria-label={t('مؤشرات الخزنة', 'Ledger metrics')} data-ldg-enter>
        <article className="ldg-metric">
          <span>{t('المستحق على الأعضاء', 'Outstanding dues')}<Target size={15} aria-hidden="true" /></span>
          <strong>{money(summary.outstanding)}</strong>
          <small>{t('من إجمالي', 'out of')} {money(summary.expected)}</small>
        </article>
        <article className="ldg-metric">
          <span>{t('دفعات مستنية التأكيد', 'Pending approvals')}<Clock3 size={15} aria-hidden="true" /></span>
          <strong>{number(summary.pending_count)}</strong>
          <small>{money(summary.pending_amount)} {t('معلّقة', 'on hold')}</small>
        </article>
        <article className="ldg-metric">
          <span>{t('متأخرين عن الدفع', 'Late payers')}<TrendingDown size={15} aria-hidden="true" /></span>
          <strong>{number(summary.late_count)}</strong>
          <small>{t('من', 'of')} {number(summary.member_count)} {t('عضو', 'members')}</small>
        </article>
        <article className="ldg-metric">
          <span>{t('أعضاء دفعوا بالكامل', 'Fully paid')}<BadgeCheck size={15} aria-hidden="true" /></span>
          <strong>{number(payload.members.filter((row) => row.status === 'paid').length)}</strong>
          <small>{t('التزامات مسددة', 'dues settled')}</small>
        </article>
      </section>
      <LedgerInsights
        entries={entries}
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
                {item.label} · {number(item.count)}
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
              <Button variant="secondary" icon={<Target size={16} aria-hidden="true" />} onClick={() => setDueModal({ due: null })}>
                {t('التزام جديد', 'New due')}
              </Button>
            </div>
            {filteredDues.length === 0 ? (
              <EmptyState title={t('مفيش التزامات مسجلة', 'No dues yet')} description={t('حدّد المطلوب من كل عضو (اشتراك شهري، رحلة، معدات) عشان تعرف مين دفع ومين متأخر.', 'Set what each member owes (monthly subscription, trip, equipment) to track who paid and who is late.')} />
            ) : (
              <div className="ldg-table" role="table" aria-label={t('الالتزامات', 'Dues')}>
                <div className="ldg-table-head" role="row">
                  <span role="columnheader">{t('العضو', 'Member')}</span>
                  <span role="columnheader">{t('الالتزام', 'Due')}</span>
                  <span role="columnheader">{t('المبلغ', 'Amount')}</span>
                  <span role="columnheader">{t('الاستحقاق', 'Due date')}</span>
                  <span role="columnheader">{t('إجراء', 'Action')}</span>
                </div>
                {filteredDues.map((due) => (
                  <div key={due.id} className="ldg-table-row" role="row">
                    <span className="ldg-cell ldg-cell--name" role="cell"><strong>{due.full_name}</strong></span>
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
            description={query ? t('جرّب اسم تاني أو امسح البحث.', 'Try another name or clear the search.') : t('ابدأ بتسجيل أول دفعة أو مصروف للتيم.', 'Start by recording the first team payment or expense.')}
            action={query ? <Button variant="secondary" onClick={() => setQuery('')}>{t('مسح البحث', 'Clear search')}</Button> : undefined}
          />
        ) : (
          <div className="ldg-table" role="table" aria-label={t('حركات الخزنة', 'Ledger entries')}>
            <div className="ldg-table-head" role="row">
              <span role="columnheader">{t('الحركة', 'Entry')}</span>
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
        <p>{t('أي عضو في التيم بيشوف من البوابة: المبلغ المتاح، إجمالي المدفوعات والمصروفات، والمصروفات اتصرفت في إيه. تفاصيل دفع كل عضو والالتزامات بتفضل للإدارة وهيدز التيم بس.', 'Every team member sees the available balance, total collected and spent, and what the money went on. Per-member payment details and dues stay with admins and team heads.')}</p>
      </section>
      <section className="ldg-note">
        <Users size={15} aria-hidden="true" />
        <p>{t('العضو بيسجّل «أنا دفعت» من البوابة وتفضل مستنية تأكيد المستلم — والمستلم يقدر يوافق أو يرفض بملاحظة ويصحّح المبلغ لو مش مطابق.', 'Members declare “I paid” from the portal and it stays pending until the receiver approves or rejects it with a note — and corrects the amount if it does not match.')}</p>
      </section>
      {entryModal && (
        <EntryModal
          isOpen
          kind={entryModal}
          entry={null}
          teamId={teamId}
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
          members={memberOptions}
          onClose={() => setDueModal(null)}
          onSubmit={submitDue}
          isPending={saveDue.isPending}
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
