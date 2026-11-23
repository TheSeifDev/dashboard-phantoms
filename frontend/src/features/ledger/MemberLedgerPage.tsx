import { useMemo, useState } from 'react';
import { ArrowDownLeft, CircleDollarSign, HandCoins, Receipt, Target, Wallet } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { PageHeader } from '../../components/ui/PageHeader';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { useLocale } from '../../i18n/useLocale';
import { formatDate } from '../../lib/dateUtils';
import { toast } from '../../store/toast';
import { PayModal } from './PayModal';
import { useDeclarePayment, useMemberLedger } from './api';
import type { LedgerPaymentDraft, MemberLedgerPayload } from './types';
import { EXPENSE_CATEGORY_LABELS, LEDGER_STATUS_LABELS, money } from './types';
import './ledger.css';
export default function MemberLedgerPage() {
  const { t, number, dir } = useLocale();
  const [teamId, setTeamId] = useState<string | null>(null);
  const ledger = useMemberLedger(teamId);
  const declare = useDeclarePayment();
  const [payOpen, setPayOpen] = useState(false);
  const payload: MemberLedgerPayload | undefined = ledger.data;
  const activeTeamId = teamId ?? payload?.team.id ?? null;
  const summary = payload?.summary;
  const expenses = payload?.expenses ?? [];
  const totalSpentByCategory = useMemo(() => {
    const map = new Map<string, number>();
    expenses.forEach((expense) => {
      const key = expense.category ?? 'other';
      map.set(key, (map.get(key) ?? 0) + Number(expense.amount));
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [expenses]);
  const submitPayment = async (draft: LedgerPaymentDraft) => {
    if (!activeTeamId) return;
    const result = await declare.mutateAsync({ teamId: activeTeamId, draft });
    toast.success(t(
      `اتسجلت دفعتك ${money(result.amount)} — مستنية تأكيد ${result.receiver_label ?? 'المستلم'}.`,
      `Your ${money(result.amount)} payment is recorded — waiting for ${result.receiver_label ?? 'the receiver'} to confirm.`,
    ));
    setPayOpen(false);
  };
  return (
    <div className="ldg-page" dir={dir}>
      <PageHeader
        icon={<Wallet size={22} aria-hidden="true" />}
        title={t('خزنة التيم', 'Team ledger')}
        description={t('شفافية كاملة: كام متاح في الخزنة، إجمالي اللي اتدفع واتصرف، والفلوس اتصرفت في إيه. وتقدر تسجّل «أنا دفعت» لحد ما المستلم يأكدها.', 'Full transparency: the available balance, total collected and spent, and what the money went on. You can also declare “I paid” until the receiver confirms it.')}
        actions={
          <Button icon={<HandCoins size={17} aria-hidden="true" />} onClick={() => setPayOpen(true)} disabled={!payload}>
            {t('أنا دفعت', 'I paid')}
          </Button>
        }
      />
      {ledger.isPending && <CardSkeletons count={3} />}
      {ledger.isError && (
        <ErrorState
          message={ledger.error instanceof Error ? ledger.error.message : t('معرفناش نحمّل خزنة التيم.', 'Could not load the team ledger.')}
          onRetry={() => { void ledger.refetch(); }}
        />
      )}
      {payload && summary && (
        <>
          {payload.teams.length > 1 && (
            <div className="ldg-teams" role="group" aria-label={t('اختيار التيم', 'Select team')}>
              {payload.teams.map((team) => (
                <button
                  key={team.id}
                  type="button"
                  className="ldg-team-tab"
                  aria-pressed={team.id === payload.team.id}
                  onClick={() => setTeamId(team.id)}
                >
                  {team.name}
                </button>
              ))}
            </div>
          )}
          <section className="ldg-hero" aria-label={t('ملخص الخزنة', 'Ledger summary')}>
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
          <section className="ldg-metrics" aria-label={t('حالتي مع الخزنة', 'My ledger status')}>
            <article className="ldg-metric">
              <span>{t('دفعت', 'I paid')}<ArrowDownLeft size={15} aria-hidden="true" /></span>
              <strong>{money(summary.my_paid)}</strong>
              <small>{t('دفعات مؤكدة', 'approved payments')}</small>
            </article>
            <article className="ldg-metric">
              <span>{t('فاضل عليّ', 'Remaining')}<Target size={15} aria-hidden="true" /></span>
              <strong>{money(summary.my_remaining)}</strong>
              <small>{t('من إجمالي', 'out of')} {money(summary.my_expected)}</small>
            </article>
            <article className="ldg-metric">
              <span>{t('مستنية تأكيد', 'Pending')}<CircleDollarSign size={15} aria-hidden="true" /></span>
              <strong>{money(summary.my_pending)}</strong>
              <small>{t('دفعات لسه بتتراجع', 'payments under review')}</small>
            </article>
            <article className="ldg-metric">
              <span>{t('مصروفات التيم', 'Team expenses')}<Receipt size={15} aria-hidden="true" /></span>
              <strong>{money(summary.expenses)}</strong>
              <small>{number(summary.expense_count)} {t('مصروف مسجل', 'recorded expenses')}</small>
            </article>
          </section>
          <div className="ldg-split">
            <section className="ldg-panel" aria-label={t('الفلوس اتصرفت في إيه', 'What the money was spent on')}>
              <header className="ldg-panel-head">
                <span><Receipt size={16} aria-hidden="true" /> {t('الفلوس اتصرفت في إيه', 'What the money was spent on')}</span>
                <small>{number(expenses.length)}</small>
              </header>
              {expenses.length === 0 ? (
                <div className="ldg-panel-body">
                  <p className="ldg-muted">{t('لسه مفيش مصروفات متسجلة على التيم.', 'No team expenses recorded yet.')}</p>
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
                    description={t('لو دفعت للتيم، سجّل المبلغ واختار استلم من مين — وتابع التأكيد هنا.', 'If you paid the team, record the amount and who received it — track the confirmation here.')}
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
            <p>{t('الخزنة دي شفافة للتيم كله في الأرقام الأساسية بس. تفاصيل دفعات باقي الأعضاء والتزاماتهم متاحة لإدارة التيم وهيدزها — إنت بتشوف بياناتك إنت بس.', 'The ledger is transparent to the whole team for the headline numbers only. Other members’ payments and dues stay with the team admins and heads — you only see your own data.')}</p>
          </section>
          {activeTeamId && (
            <PayModal
              isOpen={payOpen}
              receivers={payload.receivers}
              dues={payload.dues}
              remaining={summary.my_remaining}
              onClose={() => setPayOpen(false)}
              onSubmit={submitPayment}
              isPending={declare.isPending}
            />
          )}
        </>
      )}
    </div>
  );
}