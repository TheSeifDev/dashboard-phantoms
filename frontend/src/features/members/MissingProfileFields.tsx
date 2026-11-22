import { useLocale } from '../../i18n/useLocale';
import { MEMBER_PROFILE_FIELD_LABELS, type MemberProfileField } from './profile-fields';
import './profile-reminder.css';

/** Server field codes (member_profile_settings_payload) plus the read-only email. */
export type MissingProfileFieldCode = MemberProfileField | 'email';

const emailLabel = ['البريد الإلكتروني', 'Email address'] as const;

export function missingFieldLabel(code: string): readonly [string, string] {
  if (code === 'email') return emailLabel;
  const label = MEMBER_PROFILE_FIELD_LABELS[code as MemberProfileField];
  return label ?? [code, code];
}

export interface MissingProfileFieldsProps {
  fields: readonly string[];
  className?: string;
  max?: number;
}

/** Compact, accessible list of the fields a member still has to fill in. */
export function MissingProfileFields({ fields, className = '', max = 12 }: MissingProfileFieldsProps) {
  const { t } = useLocale();
  if (fields.length === 0) return null;
  const shown = fields.slice(0, max);
  return (
    <ul className={`profile-missing-list ${className}`.trim()} aria-label={t('الحقول الناقصة', 'Missing fields')}>
      {shown.map((code) => {
        const label = missingFieldLabel(code);
        return <li key={code} className="profile-missing-chip">{t(label[0], label[1])}</li>;
      })}
      {fields.length > shown.length && (
        <li className="profile-missing-chip profile-missing-chip--more">
          {t(`+${fields.length - shown.length} حقول`, `+${fields.length - shown.length} more`)}
        </li>
      )}
    </ul>
  );
}
