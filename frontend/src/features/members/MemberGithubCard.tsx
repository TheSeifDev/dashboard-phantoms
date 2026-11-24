import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, CheckCircle2, Link2, Loader2, ShieldCheck, Unlink } from 'lucide-react';
import { GithubMark } from '../dashboard/GithubMark';
import { Button } from '../../components/ui/Button';
import { useLocale } from '../../i18n/useLocale';
import {
  fetchGithubProfile,
  GithubLinkError,
  githubAvatarUrl,
  normalizeGithubHandle,
  useGithubLinkState,
  useLinkGithub,
  type GithubProfile,
} from './github-link-api';

type Phase = 'idle' | 'checking' | 'saving';

/** ربط الكود: العضو بيلزق لينك البروفايل، بنتحقق منه على GitHub ونربطه في خطوة واحدة. */
export function MemberGithubCard() {
  const { t, number } = useLocale();
  const inputId = useId();
  const state = useGithubLinkState();
  const link = useLinkGithub();
  const [value, setValue] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [profile, setProfile] = useState<GithubProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // العضو اللي الـ handle بتاعه اتجاب أوتوماتيك من البورتفوليو لازم يقدر يغيّره
  // من غير ما يفك الربط الأول.
  const [replacing, setReplacing] = useState(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const handle = state.data?.handle ?? null;
  const detected = state.data?.source === 'detected';
  const busy = phase !== 'idle' || link.isPending;

  const errorText = (code: string) => {
    if (code === 'INVALID_HANDLE') return t('اللينك أو الاسم مش صحيح. مثال: github.com/username', 'That link or handle is not valid. Example: github.com/username');
    if (code === 'HANDLE_TAKEN') return t('حساب GitHub ده مربوط بعضو تاني. كلّم الإدارة لو ده حسابك.', 'That GitHub account is linked to another member. Contact the admins if it is yours.');
    if (code === 'NOT_FOUND') return t('مفيش حساب GitHub بالاسم ده. راجع الـ username.', 'No GitHub account matches that handle. Check the username.');
    if (code === 'MEMBER_SCOPE_REQUIRED') return t('ربط الكود متاح لأعضاء الفريق بس.', 'Code linking is for team members only.');
    return t('معرفناش نربط الحساب دلوقتي. جرّب تاني.', 'We could not link the account right now. Try again.');
  };

  const submit = async () => {
    setError(null);
    setDone(false);
    const normalized = normalizeGithubHandle(value);
    if (!normalized) {
      setError(errorText('INVALID_HANDLE'));
      return;
    }
    setPhase('checking');
    try {
      const found = await fetchGithubProfile(normalized);
      if (!live.current) return;
      setProfile(found);
      setPhase('saving');
      await link.mutateAsync(normalized);
      if (!live.current) return;
      setValue('');
      setDone(true);
      setReplacing(false);
    } catch (cause) {
      if (!live.current) return;
      setProfile(null);
      setError(errorText(cause instanceof GithubLinkError ? cause.code : 'SERVER_UNAVAILABLE'));
    } finally {
      if (live.current) setPhase('idle');
    }
  };

  const unlink = async () => {
    setError(null);
    setDone(false);
    setPhase('saving');
    try {
      await link.mutateAsync('');
      if (!live.current) return;
      setProfile(null);
    } catch (cause) {
      if (!live.current) return;
      setError(errorText(cause instanceof GithubLinkError ? cause.code : 'SERVER_UNAVAILABLE'));
    } finally {
      if (live.current) setPhase('idle');
    }
  };

  const avatar = handle ? githubAvatarUrl(handle, 120) : null;

  return (
    <div className="mset-github">
      <div className="mset-github-head">
        <span className="mset-github-mark" aria-hidden="true"><GithubMark size={20} /></span>
        <div className="mset-github-copy">
          <h3>{t('ربط الكود (GitHub)', 'Code linking (GitHub)')}</h3>
          <p>
            {t(
              'اللينك ده هو مصدر مساهماتك وأفاتارك في الداشبورد. الصق لينك البروفايل وبنربطه أوتوماتيك.',
              'This link is the source of your contributions and avatar in the dashboard. Paste your profile link and we link it automatically.',
            )}
          </p>
        </div>
        {handle && (
          <span className="mset-github-state" data-on="true">
            <CheckCircle2 size={14} aria-hidden="true" /> {detected ? t('مكتشف أوتوماتيك', 'Auto-detected') : t('مربوط', 'Linked')}
          </span>
        )}
      </div>

      {state.isPending ? (
        <p className="mset-github-note"><Loader2 size={14} className="mset-spin" aria-hidden="true" /> {t('بنتحقق من حالة الربط…', 'Checking the link status…')}</p>
      ) : state.isError ? (
        <p className="mset-github-error" role="alert">{t('معرفناش نقرأ حالة الربط. حدّث الصفحة.', 'Could not read the link status. Refresh the page.')}</p>
      ) : handle && !replacing ? (
        <div className="mset-github-linked">
          <img className="mset-github-avatar" src={avatar ?? ''} alt="" width={56} height={56} loading="lazy" />
          <div className="mset-github-id">
            <strong dir="ltr">@{handle}</strong>
            <small>
              {detected
                ? t('جبناه أوتوماتيك من لينك البورتفوليو — المساهمات بتتحسب من الحساب ده.', 'Detected automatically from your portfolio link — contributions are counted from this account.')
                : t('المساهمات والأفاتار بيقروا من الحساب ده.', 'Contributions and avatar come from this account.')}
            </small>
          </div>
          <div className="mset-github-actions">
            <a className="mset-github-link" href={`https://github.com/${handle}`} target="_blank" rel="noreferrer noopener">
              {t('فتح البروفايل', 'Open profile')} <ArrowUpRight size={15} aria-hidden="true" />
            </a>
            <Button variant="ghost" icon={<Link2 size={16} />} onClick={() => { setReplacing(true); setError(null); setDone(false); }}>
              {t('تغيير الحساب', 'Change account')}
            </Button>
            <Button variant="secondary" icon={<Unlink size={16} />} onClick={() => { void unlink(); }} isLoading={phase === 'saving'} loadingText={t('بيفك…', 'Unlinking…')}>
              {t('فك الربط', 'Unlink')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mset-github-form">
          <label className="mset-github-field" htmlFor={inputId}>
            <span>{t('لينك البروفايل أو الـ username', 'Profile link or username')}</span>
            <div className="mset-github-input">
              <GithubMark size={16} />
              <input
                id={inputId}
                type="text"
                dir="ltr"
                value={value}
                onChange={(event) => { setValue(event.target.value); setError(null); setProfile(null); }}
                placeholder="github.com/username"
                autoComplete="off"
                spellCheck={false}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void submit(); } }}
              />
            </div>
          </label>
          <Button type="button" icon={<Link2 size={17} />} onClick={() => { void submit(); }} isLoading={busy} loadingText={phase === 'checking' ? t('بنتحقق من GitHub…', 'Checking GitHub…') : t('بيربط…', 'Linking…')}>
            {handle ? t('حدّث الحساب', 'Update account') : t('اربط الحساب', 'Link account')}
          </Button>
          {replacing && (
            <Button type="button" variant="ghost" onClick={() => { setReplacing(false); setValue(''); setError(null); }}>
              {t('إلغاء', 'Cancel')}
            </Button>
          )}
        </div>
      )}

      {profile && phase !== 'idle' && (
        <div className="mset-github-preview" role="status">
          <img src={profile.avatarUrl} alt="" width={36} height={36} loading="lazy" />
          <span>
            <strong>{profile.name ?? profile.handle}</strong>
            <small dir="ltr">@{profile.handle} · {number(profile.repos)} repos</small>
          </span>
        </div>
      )}

      {error && <p className="mset-github-error" role="alert">{error}</p>}
      {done && <p className="mset-github-done" role="status"><CheckCircle2 size={15} aria-hidden="true" /> {t('اتربط الحساب — مساهماتك هتظهر في الداشبورد.', 'Account linked — your contributions will show in the dashboard.')}</p>}

      <p className="mset-github-note">
        <ShieldCheck size={14} aria-hidden="true" />
        {t(
          'بنقرأ البروفايل العام بس (مساهمات، أفاتار) — مفيش أي صلاحية على مستودعاتك.',
          'We only read your public profile (contributions, avatar) — no access to your repositories.',
        )}
      </p>
    </div>
  );
}
