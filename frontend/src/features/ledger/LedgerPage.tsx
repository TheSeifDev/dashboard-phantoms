import { useMemo } from 'react';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { CardSkeletons } from '../../components/ui/Skeleton';
import { useLocale } from '../../i18n/useLocale';
import { useAdminAccess } from '../admin/access/api';
import { useMembers } from '../members/api';
import { useAuthStore } from '../../store/auth';
import { LedgerBoard } from './LedgerBoard';
import type { EntryMemberOption } from './EntryModal';
import './ledger.css';

export default function LedgerPage() {
  const { t, dir } = useLocale();
  const user = useAuthStore((state) => state.user);
  const access = useAdminAccess(user?.id ?? null);
  const membersQuery = useMembers();
  const memberOptions = useMemo<EntryMemberOption[]>(
    () => (membersQuery.data ?? []).map((member) => ({
      id: member.id,
      full_name: member.full_name,
      academic_number: member.academic_number ?? null,
      work_status: member.work_status ?? null,
    })),
    [membersQuery.data],
  );
  const canUseLedger = access.data?.owner_authority === true
    || access.data?.permissions?.members === true
    || (access.data?.teams?.length ?? 0) > 0;
  return (
    <div className="ldg-page" dir={dir}>
      {access.isPending && <CardSkeletons count={2} />}
      {access.isError && <ErrorState message={t('معرفناش نتحقق من صلاحياتك.', 'Could not verify your access.')} onRetry={() => { void access.refetch(); }} />}
      {access.isSuccess && !canUseLedger && (
        <EmptyState
          title={t('الخزنة متاحة للإدارة وهيدز التيمات', 'The ledger is for admins and team heads')}
          description={t('اطلب من المالك يضيفك أدمن أو يعيّنك هيد/مونيتور على تيم عشان تقدر تفتح الخزنة.', 'Ask the owner to make you an admin or assign you as a head/monitor on a team to open the ledger.')}
        />
      )}
      {canUseLedger && <LedgerBoard members={memberOptions} />}
    </div>
  );
}
