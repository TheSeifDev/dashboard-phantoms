import { useMemo, useState } from 'react';
import { Pause, Play, Search, ShieldCheck, Trash2, UserPlus, UsersRound, X } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorState } from '../../../components/ui/ErrorState';
import { CardSkeletons } from '../../../components/ui/Skeleton';
import { toast } from '../../../store/toast';
import { toAppError } from '../../../lib/supabase/errors';
import { useLocale } from '../../../i18n/useLocale';
import type { TeamMembershipStatus, TeamOverview } from '../../../types/db';
import { useAddTeamMember, useOwnerTeamMemberCandidates, useOwnerTeamMembers, useReviewTeamMember } from '../api';
import { MEMBERSHIP_COPY, initials } from './teamCopy';

type MemberFilter = 'all' | TeamMembershipStatus;

export function MemberRoster({ team }: { team: TeamOverview }) {
  const { t, number } = useLocale();
  const members = useOwnerTeamMembers(team.team_id);
  const candidates = useOwnerTeamMemberCandidates(team.team_id);
  const addMember = useAddTeamMember();
  const reviewMember = useReviewTeamMember();
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MemberFilter>('all');

  const all = members.data ?? [];
  const counts = useMemo(() => ({
    all: all.length,
    active: all.filter((member) => member.membership_status === 'active').length,
    pending: all.filter((member) => member.membership_status === 'pending').length,
    suspended: all.filter((member) => member.membership_status === 'suspended').length,
    removed: all.filter((member) => member.membership_status === 'removed').length,
  }), [all]);
  const activeIds = useMemo(() => new Set(all.filter((member) => member.membership_status === 'active').map((member) => member.member_id)), [all]);
  const available = (candidates.data ?? []).filter((member) => !activeIds.has(member.member_id) && member.membership_status !== 'pending' && member.work_status === 'active');
  const visible = all.filter((member) => {
    if (filter !== 'all' && member.membership_status !== filter) return false;
    const text = query.trim().toLocaleLowerCase();
    return !text || `${member.full_name} ${member.email}`.toLocaleLowerCase().includes(text);
  });

  const add = async () => {
    if (!selected) return;
    try {
      const status = await addMember.mutateAsync({ teamId: team.team_id, memberId: Number(selected) });
      setSelected('');
      toast.success(status === 'active'
        ? t('اتضاف العضو للفريق. يقدر يبقى في فرق تانية كمان.', 'Member added to this team. They may also belong to other teams.')
        : t('اتسجلت عضوية الفريق للمراجعة.', 'Team membership is pending review.'));
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نضيف العضوية.', 'Could not add this membership.')).message);
    }
  };

  const decide = async (memberId: number, decision: 'approve' | 'suspend' | 'remove') => {
    try {
      await reviewMember.mutateAsync({ teamId: team.team_id, memberId, decision });
      toast.success(decision === 'approve'
        ? t('اتفعّلت العضوية في الفريق.', 'Membership activated for this team.')
        : decision === 'suspend'
          ? t('اتوقفت عضوية الفريق بس.', 'Only this team membership was suspended.')
          : t('اتشالت العضوية من الفريق؛ حساب العضو والفرق التانية سليمين.', 'Membership removed from this team; the member account and other teams remain intact.'));
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نغير العضوية.', 'Could not update the membership.')).message);
    }
  };

  const filters: { key: MemberFilter; label: string; count: number }[] = [
    { key: 'all', label: t('الكل', 'All'), count: counts.all },
    { key: 'active', label: t('نشط', 'Active'), count: counts.active },
    { key: 'pending', label: t('بالانتظار', 'Pending'), count: counts.pending },
    { key: 'suspended', label: t('موقوف', 'Suspended'), count: counts.suspended },
    { key: 'removed', label: t('أزيل', 'Removed'), count: counts.removed },
  ];

  return (
    <section className="tms-members" data-tm-anim aria-labelledby={`tms-members-${team.team_id}`}>
      <header className="tms-block-head">
        <div>
          <span className="tms-kicker"><UsersRound size={14} aria-hidden="true" />{t('تسجيل الأعضاء', 'Member enrollment')}</span>
          <h3 id={`tms-members-${team.team_id}`}>{t('عضوية الأعضاء في الفريق', 'Team memberships')}</h3>
        </div>
        <div className="tms-member-totals">
          <span><strong>{number(counts.active)}</strong>{t('نشط', 'active')}</span>
          <span className={counts.pending > 0 ? 'is-warn' : ''}><strong>{number(counts.pending)}</strong>{t('بالانتظار', 'pending')}</span>
        </div>
      </header>

      <div className="tms-add-row">
        <label className="tms-field">
          <span>{t('إضافة عضو موجود لهذا الفريق', 'Add an existing member to this team')}</span>
          <select value={selected} onChange={(event) => setSelected(event.target.value)} disabled={addMember.isPending || !team.is_active}>
            <option value="">{t('اختار عضوًا', 'Select a member')}</option>
            {available.map((member) => <option key={member.member_id} value={member.member_id}>{member.full_name} · {member.email}</option>)}
          </select>
        </label>
        <Button type="button" icon={<UserPlus size={16} aria-hidden="true" />} onClick={() => void add()} disabled={!selected || !team.is_active} isLoading={addMember.isPending}>
          {t('إضافة', 'Add')}
        </Button>
      </div>

      <p className="tms-note">{t('العضوية مرتبطة بهذا الفريق فقط. يمكن للشخص نفسه الانضمام لفرق أخرى من غير إنشاء حساب أو ملف مكرر.', 'Membership is limited to this team, so the same person can join other teams without another account or profile.')}</p>
      {candidates.isPending && <p role="status" className="tms-note">{t('جارٍ تحميل الأعضاء المتاحين للإضافة…', 'Loading members available to add…')}</p>}
      {candidates.isError && <ErrorState message={t('تعذر تحميل قائمة الأعضاء المتاحين.', 'Could not load the members available to add.')} onRetry={() => { void candidates.refetch(); }} />}
      {candidates.data && available.length === 0 && <p className="tms-note">{t('مفيش عضو نشط مؤهل للإضافة دلوقتي. الإضافة مش بتنقل العضو من فريق تاني.', 'No eligible active member is available to add right now. Adding someone never moves them out of another team.')}</p>}

      {members.isPending && <CardSkeletons count={1} />}
      {members.isError && <ErrorState message={t('تعذر تحميل أعضاء الفريق.', 'Could not load team memberships.')} onRetry={() => { void members.refetch(); }} />}
      {members.data?.length === 0 && <EmptyState title={t('لسه مفيش أعضاء في الفريق', 'No members are assigned to this team yet')} description={t('إضافة عضو هنا لا تنقله من فريق آخر.', 'Adding a member here does not remove them from another team.')} />}

      {all.length > 0 && (
        <>
          <div className="tms-member-tools">
            <div className="tms-search">
              <Search size={16} aria-hidden="true" />
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('ابحث بالاسم أو البريد…', 'Search name or email…')} aria-label={t('البحث في أعضاء الفريق', 'Search team members')} />
              {query && <button type="button" onClick={() => setQuery('')} aria-label={t('مسح البحث', 'Clear search')}><X size={14} aria-hidden="true" /></button>}
            </div>
            <div className="tms-filter-chips" role="group" aria-label={t('تصفية حسب حالة العضوية', 'Filter by membership status')}>
              {filters.map(({ key, label, count }) => (
                <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
                  {label}<span>{number(count)}</span>
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0
            ? <p role="status" className="tms-note">{t('مافيش أعضاء مطابقين للبحث أو التصفية.', 'No members match this search or filter.')}</p>
            : <ul className="tms-member-list">
              {visible.map((member) => {
                const copy = MEMBERSHIP_COPY[member.membership_status];
                return (
                  <li key={member.member_id} className="tms-member">
                    <span className="tms-avatar tms-avatar--sm" aria-hidden="true">{initials(member.full_name)}</span>
                    <div className="tms-member-copy">
                      <strong>{member.full_name}</strong>
                      <small dir="ltr">{member.email}</small>
                    </div>
                    <Badge variant={copy.tone}>{t(copy.ar, copy.en)}</Badge>
                    <div className="tms-member-actions">
                      {member.membership_status === 'pending' && <button type="button" className="tms-link" onClick={() => void decide(member.member_id, 'approve')} disabled={reviewMember.isPending}><ShieldCheck size={13} aria-hidden="true" />{t('موافقة', 'Approve')}</button>}
                      {member.membership_status === 'active' && <button type="button" className="tms-link" onClick={() => void decide(member.member_id, 'suspend')} disabled={reviewMember.isPending}><Pause size={13} aria-hidden="true" />{t('إيقاف', 'Suspend')}</button>}
                      {member.membership_status !== 'removed' && <button type="button" className="tms-link tms-link--danger" onClick={() => void decide(member.member_id, 'remove')} disabled={reviewMember.isPending}><Trash2 size={13} aria-hidden="true" />{t('إزالة', 'Remove')}</button>}
                      {(member.membership_status === 'removed' || member.membership_status === 'suspended') && available.some((candidate) => candidate.member_id === member.member_id) && (
                        <button type="button" className="tms-link" onClick={() => setSelected(String(member.member_id))} disabled={!team.is_active}><Play size={13} aria-hidden="true" />{t('إعادة الإضافة', 'Re-add')}</button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>}
        </>
      )}
    </section>
  );
}
