import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, TriangleAlert } from 'lucide-react';
import { useLocale } from '../../i18n/useLocale';
import { useMemberProfile } from './profile-api';
import { MissingProfileFields } from './MissingProfileFields';
import { useProfileReminder } from './useProfileReminder';
import './profile-reminder.css';

const TOTAL_FIELDS = 12;

/**
 * Persistent, always-visible completion banner for the member portal. It shows
 * exactly what is missing, the progress toward a complete profile, and keeps a
 * recurring reminder running until the profile is saved.
 */
export function ProfileReminderBanner() {
  const { t, number } = useLocale();
  const navigate = useNavigate();
  const profile = useMemberProfile();
  const snapshot = profile.data;
  useProfileReminder(snapshot, () => navigate('/portal/settings'));

  if (!snapshot || snapshot.profile_complete) return null;

  const missing = snapshot.missing_fields;
  const done = Math.max(0, TOTAL_FIELDS - missing.length);
  const percent = Math.round((done / TOTAL_FIELDS) * 100);

  return (
    <section className="profile-reminder" aria-labelledby="profile-reminder-title">
      <div className="profile-reminder-head">
        <span className="profile-reminder-icon" aria-hidden="true"><TriangleAlert size={20} /></span>
        <div className="profile-reminder-copy">
          <h2 id="profile-reminder-title">{t('بيانات حسابك ناقصة', 'Your profile is incomplete')}</h2>
          <p>{t(
            `فاضل ${number(missing.length)} حقول من ${number(TOTAL_FIELDS)}. هنفضل نذكّرك كل شوية لحد ما تكمّلها وتحفظها.`,
            `${number(missing.length)} of ${number(TOTAL_FIELDS)} fields are still missing. We keep reminding you until they are filled in and saved.`,
          )}</p>
        </div>
        <span className="profile-reminder-count" aria-hidden="true">{number(done)}/{number(TOTAL_FIELDS)}</span>
      </div>
      <div
        className="profile-reminder-progress"
        role="progressbar"
        aria-label={t('نسبة اكتمال البيانات', 'Profile completion')}
        aria-valuemin={0}
        aria-valuemax={TOTAL_FIELDS}
        aria-valuenow={done}
        aria-valuetext={t(`${number(done)} من ${number(TOTAL_FIELDS)} حقول`, `${number(done)} of ${number(TOTAL_FIELDS)} fields`)}
      >
        <span className="profile-reminder-progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <MissingProfileFields fields={missing} />
      <div className="profile-reminder-actions">
        <Link to="/portal/settings" className="profile-reminder-cta">
          {t('كمّل بياناتك الآن', 'Complete your profile now')}
          <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
