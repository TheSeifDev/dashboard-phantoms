import { useEffect, useState, type ReactNode } from 'react';
import { githubAvatarUrl, resolveGithubHandle } from '../../features/dashboard/github';

export type MemberAvatarSource = {
  full_name?: string | null;
  portfolio_url?: string | null;
  custom_fields?: Record<string, string | number | boolean | null> | null;
  /** Handle محسوب مسبقًا للجلسة الحالية (بوابة الأعضاء). */
  github_handle?: string | null;
};

export interface MemberAvatarProps {
  /** Member row (or projection) carrying the portfolio URL / GitHub custom field. */
  member?: MemberAvatarSource | null;
  /** Explicit GitHub handle when it is already resolved. */
  handle?: string | null;
  /** Name used for the initials fallback and the accessible label. */
  name?: string | null;
  /** Requested GitHub image size in pixels (rendered size is controlled by CSS). */
  size?: number;
  /** Existing wrapper class from the surrounding design (size, radius, colours). */
  className?: string;
  /** Custom fallback node (for example an icon) instead of the first letter. */
  fallback?: ReactNode;
}

/**
 * Member identity avatar. Uses the GitHub profile picture whenever the member
 * linked a GitHub handle (custom field or github.com portfolio URL) and falls
 * back to the first letter of the name if GitHub is unreachable.
 */
export function MemberAvatar({ member, handle, name, size = 96, className = '', fallback = null }: MemberAvatarProps) {
  const resolved = handle ?? (member
    ? resolveGithubHandle({
      portfolio_url: member.portfolio_url ?? null,
      custom_fields: member.custom_fields ?? undefined,
      github_handle: member.github_handle ?? null,
    })
    : null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [resolved]);

  const label = (member?.full_name ?? name ?? '').trim();
  const showImage = Boolean(resolved) && !failed;

  return (
    <span className={`member-avatar ${className}`.trim()} aria-hidden="true" data-avatar={showImage ? 'github' : 'initials'}>
      {showImage ? (
        <img
          className="member-avatar-img"
          src={githubAvatarUrl(resolved as string, size)}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        fallback ?? (label ? label.charAt(0) : '؟')
      )}
    </span>
  );
}
