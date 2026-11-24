import { useMemo, useRef, useState } from 'react';
import { ArrowDownLeft, CircleDollarSign, HandCoins, Receipt, ShieldCheck, Target, Wallet } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { useLocale } from '../../i18n/useLocale';
import { formatDate } from '../../lib/dateUtils';
import { toast } from '../../store/toast';
import { PayModal } from './PayModal';
import { LedgerInsights } from './LedgerInsights';
import { LedgerKpiGrid, LedgerStatStrip } from './LedgerKpis';
import { useLedgerEnter } from './animations';
import { useDeclarePayment, useLedgerSeries, useMemberLedger } from './api';
import type { LedgerPaymentDraft, MemberLedgerPayload } from './types';
import { EXPENSE_CATEGORY_LABELS, LEDGER_STATUS_LABELS, money } from './types';
import './ledger.css';

/** سلسلة مدفوعات العضو على آخر 6 شهور (من دفعاته هو بس). */
function ownSeries(payload: MemberLedgerPayload | undefined): { paid: number[]; remaining: number[] } {
  const months: string[] = [];
  const now = new Date();
  for (let back = 5; back >= 0; back -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - back, 1);
    months.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
  }
  const paid = months.map((month) => (payload?.payments ?? [])
    .filter((payment) => payment.status === 'approved' && payment.occurred_on.slice(0, 7) === month)
    .reduce((total, payment) => total + Number(payment.amount), 0));
  const expected = payload?.summary.my_expected ?? 0;
  let cumulative = 0;
  const remaining = paid.map((amount) => {
    cumulative += amount;
    return Math.max(expected - cumulative, 0);
  });
  return { paid, remaining };
}

export default function MemberLedgerPage() {
  const { t, number, dir } = useLocale();
  const ledger = useMemberLedger();
  const seriesQuery = useLedgerSeries(null, 'member');
  const declare = useDeclarePayment();
  const [payOpen, setPayOpen] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const payload = ledger.data;
  const series = seriesQuery.data ?? [];
  const summary = payload?.summary;
  const expenses = payload?.expenses ?? [];
  const mine = useMemo(() => ownSeries(payload), [payload]);
  const totalSpentByCategory = useMemo(() => {
    const map = new Map<string, number>();
    expenses.forEach((expense) => {
      const key = expense.category ?? 'other';
      map.set(key, (map.get(key) ?? 0) + Number(expense.amount));
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [expenses]);
  const submitPayment = async (draft: LedgerPaymentDraft) => {
    const result = await declare.mutateAsync({ draft });
    toast.success(t(
      `اتسجلت دفعتك ${money(result.amount)} — مستنية تأكيد ${result.receiver_label ?? 'المستلم'}.`,
      `Your ${money(result.amount)} payment is recorded — waiting for ${result.receiver_label ?? 'the receiver'} to confirm.`,
    ));
    setPayOpen(false);
  };
  useLedgerEnter(pageRef, [Boolean(payload)]);
  return (
    <div className="ldg-page" dir={dir} ref={pageRef}>
      {ledger.isPending && <CardSkeletons count={3} />}
      {ledger.isError && (
        <ErrorState
          message={ledger.error instanceof Error ? ledger.error.message : t('معرفناش نحمّل الخزنة.', 'Could not load the ledger.')}
          onRetry={() => { void ledger.refetch(); }}
        />
      )}
      {payload && summary && (
        <>
          <div className="ldg-topbar" data-ldg-enter>
            <div className="ldg-units">
              <span className="ldg-unit-chip ldg-unit-chip--mine">
                <ShieldCheck size={14} aria-hidden="true" /> {t('تيمك/وحدتك', 'Your unit')}: {payload.unit}
              </span>
            </div>
            <div className="ldg-actions">
              <Button icon={<HandCoins size={17} aria-hidden="true" />} onClick={() => setPayOpen(true)}>
                {t('أنا دفعت', 'I paid')}
              </Button>
            </div>
          </div>

          <section className="ldg-hero" aria-label={t('ملخص الخزنة', 'Ledger summary')} data-ldg-enter>
            <div className="ldg-hero-main">
              <span className="ldg-hero-label"><Wallet size={15} aria-hidden="true" /> {t('المبلغ المتاح حاليًا', 'Available balance')}</span>
              <strong className="ldg-hero-value">{money(summary.balance)}</strong>
              <span className="ldg-hero-team">
                {t('خزنة الفريق كلها', 'The whole team ledger')} · {t('الرصيد = المدفوعات المؤكدة − المصروفات − الخصومات', 'Balance = approved payments − expenses − deductions')}
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
                key: 'my-paid',
                title: t('أنا دفعت', 'I paid'),
                value: summary.my_paid,
                detail: t('دفعات مؤكدة', 'approved payments'),
                icon: ArrowDownLeft,
                tone: 'violet',
                series: mine.paid,
              },
              {
                key: 'my-remaining',
                title: t('فاضل عليّ', 'My remaining'),
                value: summary.my_remaining,
                detail: `${t('من إجمالي', 'out of')} ${money(summary.my_expected)}`,
                icon: Target,
                tone: 'amber',
                series: mine.remaining,
              },
              {
                key: 'team-expenses',
                title: t('مصروفات الفريق', 'Team expenses'),
                value: summary.expenses,
                detail: `${number(summary.expense_count)} ${t('مصروف مسجل', 'recorded expenses')}`,
                icon: Receipt,
                tone: 'blue',
                series: series.map((point) => Number(point.expenses) || 0),
              },
              {
                key: 'balance',
                title: t('المتاح في الخزنة', 'Available balance'),
                value: summary.balance,
                detail: t('رصيد تراكمي على آخر 6 شهور', 'Cumulative balance over 6 months'),
                icon: Wallet,
                tone: 'violet',
                series: series.map((point) => Number(point.balance) || 0),
              },
            ]}
          />

          <LedgerStatStrip
            items={[
              { key: 'my-pending', label: t('مستنية تأكيد', 'Pending'), value: money(summary.my_pending), hint: t('دفعات لسه بتتراجع', 'payments under review') },
              { key: 'collected', label: t('اللي اتدفع للفريق', 'Collected'), value: money(summary.collected), hint: `${number(summary.payment_count)} ${t('دفعة', 'payments')}` },
              { key: 'withdrawals', label: t('الخصومات', 'Deductions'), value: money(summary.withdrawals), hint: t('فلوس اتسحبت من الخزنة', 'taken out of the ledger') },
              { key: 'outstanding', label: t('مستحق على الفريق', 'Team outstanding'), value: money(summary.outstanding), hint: `${t('من إجمالي', 'out of')} ${money(summary.expected)}` },
            ]}
          />

          <LedgerInsights
            series={series}
            paidTotal={summary.collected}
            remainingTotal={summary.outstanding}
            expectedTotal={summary.expected}
            variant="member"
          />

          <div className="ldg-split">
            <section className="ldg-panel" aria-label={t('الفلوس اتصرفت في إيه', 'What the money was spent on')}>
              <header className="ldg-panel-head">
                <span><Receipt size={16} aria-hidden="true" /> {t('الفلوس اتصرفت في إيه', 'What the money was spent on')}</span>
                <small>{number(expenses.length)}</small>
              </header>
              {expenses.length === 0 ? (
                <div className="ldg-panel-body">
                  <p className="ldg-muted">{t('لسه مفيش مصروفات متسجلة على الفريق.', 'No team expenses recorded yet.')}</p>
                </div>
              ) : (
                <div className="ldg-panel-body">
                  {totalSpentByCategory.length > 0 && (
                    <div className="ldg-bars" aria-hidden="true">
                      {totalSpentByCategory.map(([category, total]) => {
                        const max = totalSpentByCategory[0][1] || 1;
                        const label = EXPENSE_CATEGORY_LABELS[category as keyof typeof EXPENSE_CATEGORY_LABELS] ?? EXPENSE_CATEGORY_LABELS.other;
                        return (
                          <div key={category} className="ldg-bar-row">
                            <span>{label}</span>
                            <span className="ldg-bar-track"><span className="ldg-bar-fill" style={{ width: `${Math.max(6, Math.round((total / max) * 100))}%` }} /></span>
                            <strong>{money(total)}</strong>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <ul className="ldg-list">
                    {expenses.map((expense) => (
                      <li key={expense.id}>
                        <div>
                          <strong>{expense.title ?? t('مصروف', 'Expense')}</strong>
                          <small>
                            {expense.category ? EXPENSE_CATEGORY_LABELS[expense.category] : t('أخرى', 'Other')} · {formatDate(expense.occurred_on)}
                            {expense.note ? ` · ${expense.note}` : ''}
                          </small>
                        </div>
                        <span>{money(expense.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
            <section className="ldg-panel" aria-label={t('دفعاتي', 'My payments')}>
              <header className="ldg-panel-head">
                <span><HandCoins size={16} aria-hidden="true" /> {t('دفعاتي', 'My payments')}</span>
                <small>{number(payload.payments.length)}</small>
              </header>
              <div className="ldg-panel-body">
                {payload.dues.length > 0 && (
                  <ul className="ldg-dues">
                    {payload.dues.map((due) => (
                      <li key={due.id}>
                        <span>{due.label}</span>
                        <strong>{money(due.amount)}</strong>
                        <small>{due.due_on ? formatDate(due.due_on) : t('بدون تاريخ استحقاق', 'No due date')}</small>
                      </li>
                    ))}
                  </ul>
                )}
                {payload.payments.length === 0 ? (
                  <EmptyState
                    title={t('لسه مسجلتش أي دفعة', 'No payments recorded yet')}
                    description={t('لو دفعت للفريق، سجّل المبلغ واختار استلم من مين — وتابع التأكيد هنا.', 'If you paid the team, record the amount and who received it — track the confirmation here.')}
                    action={<Button onClick={() => setPayOpen(true)}>{t('أنا دفعت', 'I paid')}</Button>}
                  />
                ) : (
                  <ul className="ldg-list">
                    {payload.payments.map((payment) => (
                      <li key={payment.id}>
                        <div>
                          <strong>{money(payment.amount)}</strong>
                          <small>
                            {t('دفعت لـ', 'Paid to')} {payment.receiver_label ?? '—'} · {formatDate(payment.occurred_on)}
                            {payment.note ? ` · ${payment.note}` : ''}
                            {payment.decision_note ? ` · ${t('ملاحظة المراجعة', 'Review note')}: ${payment.decision_note}` : ''}
                          </small>
                        </div>
                        <span className={`ldg-chip ldg-chip--${payment.status}`}>{LEDGER_STATUS_LABELS[payment.status]}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>

          <section className="ldg-note">
            <CircleDollarSign size={15} aria-hidden="true" />
            <p>{t('إنت شايف الخزنة كلها: المتاح، إجمالي اللي اتدفع، إجمالي المصروفات، والفلوس اتصرفت في إيه. الحاجة الوحيدة المخفية عنك هي مين دفع ومين لسه مدفعش — دي للإدارة وهيدز التيمات بس.', 'You see the whole ledger: the balance, total collected, total spent, and what the money went on. The only thing hidden from you is who paid and who has not — that stays with admins and team heads.')}</p>
          </section>
          <section className="ldg-note">
            <Target size={15} aria-hidden="true" />
            <p>{t('دفعاتك إنت ظاهرة لك بالكامل (مؤكدة / مستنية / مرفوضة) مع ملاحظة المراجعة، ولو دفعت لحد مش من الإدارة أو هيد/مونيتور تيمك مش هينفع تسجّلها.', 'Your own payments stay fully visible to you (approved / pending / rejected) with the review note. You can only record a payment to an admin or a head/monitor of your own team.')}</p>
          </section>

          <PayModal
            isOpen={payOpen}
            receivers={payload.receivers}
            dues={payload.dues}
            remaining={summary.my_remaining}
            onClose={() => setPayOpen(false)}
            onSubmit={submitPayment}
            isPending={declare.isPending}
          />
        </>
      )}
    </div>
  );
}
