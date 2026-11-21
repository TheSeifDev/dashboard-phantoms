import { useState } from 'react';
import { githubAvatarUrl } from './github';

const TONES = ['var(--crew-1)', 'var(--crew-2)', 'var(--crew-3)', 'var(--chart-cyan)', 'var(--chart-amber)', 'var(--success)'];

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '؟';
  const first = Array.from(parts[0])[0] ?? '';
  const second = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] ?? '' : '';
  return (first + second).toUpperCase();
}

export function toneFor(id: number): string {
  return TONES[Math.abs(id) % TONES.length];
}

/** GitHub avatar when a handle is linked; deterministic initials otherwise (also the load-failure fallback). */
export function PersonAvatar({ id, name, handle, size = 32, className = '' }: { id: number; name: string; handle?: string | null; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(handle) && !failed;
  return (
    <span
      className={`person-avatar ${className}`}
      style={{ width: size, height: size, ['--avatar-tone' as string]: toneFor(id), fontSize: Math.max(10, Math.round(size * 0.36)) }}
      aria-hidden="true"
    >
      {showImage ? (
        <img src={githubAvatarUrl(handle as string, Math.min(160, size * 2))} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <span>{initialsOf(name)}</span>
      )}
    </span>
  );
}
