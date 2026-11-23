import { useMemo, useState } from 'react';
import { Wallet } from 'lucide-react';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { PageHeader } from '../../components/ui/PageHeader';
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
  const [teamId, setTeamId] = useState<string | null>(null);
  const teams = useMemo(() => access.data?.teams ?? [], [access.data]);
  const activeTeamId = teamId ?? teams[0]?.team_id ?? null;
  const memberOptions = useMemo<EntryMemberOption[]>(
    () => (membersQuery.data ?? []).map((member) => ({
      id: member.id,
      full_name: member.full_name,
      academic_number: member.academic_number ?? null,
      work_status: member.work_status ?? null,
    })),
    [membersQuery.data],
  );
  const canUseLedger = access.data?.is_owner === true
    || access.data?.permissions?.members === true
    || (access.data?.teams?.length ?? 0) > 0;
  return (
    <div className="ldg-page" dir={dir}>
      <PageHeader
        icon={<Wallet size={22} aria-hidden="true" />}
        title={t('خزنة الفريق', 'Team ledger')}
        description={t('كل معاملات التيم في مكان واحد: المبلغ المتاح، إجمالي المدفوعات والمصروفات، مين دفع ومين لسه، والمصروفات اتصرفت في إيه.', 'Every team transaction in one place: available balance, total paid and spent, who paid and who has not, and what the money went on.')}
      />
      {access.isPending && <CardSkeletons count={2} />}
      {access.isError && <ErrorState message={t('معرفناش نتحقق من صلاحياتك.', 'Could not verify your access.')} onRetry={() => { void access.refetch(); }} />}
      {access.isSuccess && !canUseLedger && (
        <EmptyState
          title={t('الخزنة متاحة للإدارة وهيدز التيمات', 'The ledger is for admins and team heads')}
          description={t('اطلب من المالك يضيفك أدمن أو يعيّنك هيد/مونيتور على تيم عشان تقدر تفتح خزنته.', 'Ask the owner to make you an admin or assign you as a head/monitor on a team to open its ledger.')}
        />
      )}
      {canUseLedger && teams.length > 1 && (
        <div className="ldg-teams" role="group" aria-label={t('اختيار التيم', 'Select team')}>
          {teams.map((team) => (
            <button
              key={team.team_id}
              type="button"
              className="ldg-team-tab"
              aria-pressed={team.team_id === activeTeamId}
              onClick={() => setTeamId(team.team_id)}
            >
              {team.name}
            </button>
          ))}
        </div>
      )}
      {canUseLedger && activeTeamId && <LedgerBoard teamId={activeTeamId} members={memberOptions} />}
    </div>
  );
}