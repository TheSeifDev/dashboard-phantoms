import { useEffect, useState } from 'react';
import { Check, Crown, Pencil, Save, Trash2, UserCog, X } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { toast } from '../../../store/toast';
import { toAppError } from '../../../lib/supabase/errors';
import { useLocale } from '../../../i18n/useLocale';
import type { TeamAdminCandidate, TeamAdminRole, TeamPermissions, TeamOverview } from '../../../types/db';
import { TEAM_PERMISSION_OPTIONS } from '../../admin/access/permissions';
import { useSetTeamAdminSeat } from '../api';
import { EMPTY_PERMISSIONS, PERMISSION_COPY, initials, roleCopy } from './teamCopy';

export function SeatCard({ team, role, candidates, isOwner }: {
  team: TeamOverview;
  role: TeamAdminRole;
  candidates: TeamAdminCandidate[];
  isOwner: boolean;
}) {
  const { t } = useLocale();
  const copy = roleCopy(role);
  const existing = team.assignments.find((assignment) => assignment.role === role);
  const eligible = candidates.filter((candidate) => candidate.global_role === null);
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState(existing?.user_id ?? '');
  const [permissions, setPermissions] = useState<TeamPermissions>(existing?.permissions ?? EMPTY_PERMISSIONS);
  const setSeat = useSetTeamAdminSeat();

  useEffect(() => {
    setUserId(existing?.user_id ?? '');
    setPermissions(existing?.permissions ?? EMPTY_PERMISSIONS);
  }, [existing?.id, existing?.user_id, existing?.permissions]);

  const enabled = TEAM_PERMISSION_OPTIONS.filter(({ key }) => (existing?.permissions ?? EMPTY_PERMISSIONS)[key]);
  const draftEnabled = TEAM_PERMISSION_OPTIONS.filter(({ key }) => permissions[key]);
  const personLabel = existing
    ? (candidates.find((candidate) => candidate.user_id === existing.user_id)?.member_name || existing.email)
    : '';

  const save = async () => {
    if (!userId) {
      toast.error(t('اختار حسابًا للمنصب قبل الحفظ.', 'Choose an account for this seat before saving.'));
      return;
    }
    try {
      await setSeat.mutateAsync({ teamId: team.team_id, role, userId, permissions });
      setOpen(false);
      toast.success(t('اتحفظ التعيين وصلاحياته لهذا الفريق فقط.', 'Assignment and permissions saved for this team only.'));
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نحفظ تعيين الفريق.', 'Could not save the team assignment.')).message);
    }
  };

  const clear = async () => {
    try {
      await setSeat.mutateAsync({ teamId: team.team_id, role, userId: null, permissions: null });
      setOpen(false);
      setUserId('');
      setPermissions(EMPTY_PERMISSIONS);
      toast.success(t('اتشال تعيين المنصب بس؛ حساب الدخول والفرق التانية ما اتلمستش.', 'Only this team assignment was removed; the sign-in and other team assignments remain.'));
    } catch (error) {
      toast.error(toAppError(error, t('معرفناش نشيل التعيين.', 'Could not remove the assignment.')).message);
    }
  };

  return (
    <article className={`tms-seat${existing ? ' is-filled' : ' is-empty'}${open ? ' is-open' : ''}`} data-tm-anim>
      <header className="tms-seat-head">
        <span className={`tms-seat-tag tms-seat-tag--${role}`}>
          {role === 'head' ? <Crown size={13} aria-hidden="true" /> : <UserCog size={13} aria-hidden="true" />}
          {copy.tag}
        </span>
        <span className="tms-seat-state">
          {existing
            ? <><Check size={13} aria-hidden="true" />{t('مُعيّن', 'Assigned')}</>
            : <>{t('المقعد متاح', 'Seat open')}</>}
        </span>
      </header>

      {existing ? (
        <>
          <div className="tms-seat-person">
            <span className="tms-avatar" aria-hidden="true">{initials(personLabel || existing.email)}</span>
            <div className="tms-seat-person-copy">
              <strong>{personLabel || t('حساب مُعيّن', 'Assigned account')}</strong>
              <small dir="ltr">{existing.email}</small>
            </div>
          </div>
          <p className="tms-seat-hint">{t(copy.hintAr, copy.hintEn)}</p>
          <div className="tms-chips" aria-label={t('صلاحيات هذا المقعد', 'Seat permissions')}>
            {enabled.length === 0
              ? <span className="tms-chip tms-chip--muted">{t('بدون صلاحيات', 'No permissions')}</span>
              : <>
                {enabled.slice(0, 4).map(({ key }) => <span key={key} className="tms-chip">{t(PERMISSION_COPY[key].ar, PERMISSION_COPY[key].en)}</span>)}
                {enabled.length > 4 && <span className="tms-chip tms-chip--muted">+{enabled.length - 4}</span>}
              </>}
          </div>
          <footer className="tms-seat-foot">
            <button type="button" className="tms-link" onClick={() => setOpen((value) => !value)} disabled={!isOwner} aria-expanded={open}>
              <Pencil size={13} aria-hidden="true" />{open ? t('إغلاق التعديل', 'Close editor') : t('تعديل المقعد', 'Edit seat')}
            </button>
            <button type="button" className="tms-link tms-link--danger" onClick={() => void clear()} disabled={!isOwner || setSeat.isPending}>
              <Trash2 size={13} aria-hidden="true" />{t('إزالة', 'Remove')}
            </button>
          </footer>
        </>
      ) : (
        <>
          <p className="tms-seat-hint">{t(copy.hintAr, copy.hintEn)}</p>
          <div className="tms-seat-empty">
            <span className="tms-avatar tms-avatar--ghost" aria-hidden="true"><UserCog size={18} strokeWidth={1.6} /></span>
            <div>
              <strong>{t(`مفيش ${copy.ar} متعيّن`, `No ${copy.en} assigned`)}</strong>
              <small>{t('التعيين بيفتح مساحة الفريق فقط، من غير حساب Admin عام.', 'Team-only access, never a global Admin account.')}</small>
            </div>
          </div>
          <footer className="tms-seat-foot">
            <Button type="button" variant="secondary" onClick={() => setOpen((value) => !value)} disabled={!isOwner} aria-expanded={open}>
              {open ? t('إغلاق', 'Close') : t(`تعيين ${copy.ar}`, `Assign ${copy.en}`)}
            </Button>
          </footer>
        </>
      )}

      {open && (
        <div className="tms-seat-editor">
          <label className="tms-field">
            <span>{t('حساب Auth موجود', 'Existing Auth account')}</span>
            <select value={userId} onChange={(event) => setUserId(event.target.value)} disabled={!isOwner || !team.is_active || setSeat.isPending}>
              <option value="">{t('اختار مسؤولًا', 'Select a manager')}</option>
              {eligible.map((candidate) => (
                <option key={candidate.user_id} value={candidate.user_id}>
                  {candidate.member_name ? `${candidate.member_name} · ` : ''}{candidate.email}
                </option>
              ))}
            </select>
          </label>
          <div className="tms-perm-head">
            <strong>{t('الصلاحيات داخل الفريق', 'Permissions inside this team')}</strong>
            <span>{draftEnabled.length}/{TEAM_PERMISSION_OPTIONS.length}</span>
          </div>
          <div className="tms-perms">
            {TEAM_PERMISSION_OPTIONS.map(({ key }) => (
              <label key={key} className={`tms-perm${permissions[key] ? ' is-on' : ''}`}>
                <input
                  type="checkbox"
                  checked={permissions[key]}
                  onChange={() => setPermissions((current) => ({ ...current, [key]: !current[key] }))}
                  disabled={!isOwner || !team.is_active || setSeat.isPending}
                />
                <span>{t(PERMISSION_COPY[key].ar, PERMISSION_COPY[key].en)}</span>
              </label>
            ))}
          </div>
          <div className="tms-seat-editor-actions">
            <Button type="button" icon={<Save size={15} aria-hidden="true" />} onClick={() => void save()} isLoading={setSeat.isPending} disabled={!team.is_active || !isOwner}>
              {t('حفظ المقعد', 'Save seat')}
            </Button>
            <Button type="button" variant="ghost" icon={<X size={15} aria-hidden="true" />} onClick={() => setOpen(false)} disabled={setSeat.isPending}>{t('إلغاء', 'Cancel')}</Button>
          </div>
          <p className="tms-note">{t('التعيين يضيف مساحة الفريق فقط. الشخص ممكن يتعيّن في فرق مختلفة، لكن مش في المقعدين داخل نفس الفريق.', 'This grants team-only access and never creates a global Admin. A person may serve other teams, but cannot hold both seats in the same team.')}</p>
        </div>
      )}
    </article>
  );
}
