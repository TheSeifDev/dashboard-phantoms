import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, Check, Copy, ExternalLink, Link2, Loader2, Send } from 'lucide-react';
import { toast } from '../../store/toast';
import { useLocale } from '../../i18n/useLocale';
import {
  useCreateTelegramLinkCode, useTelegramMemberState, useToggleTelegramMuteSelf, useUnlinkTelegramSelf,
} from './api';

/**
 * ربط تلجرام بقى أوتوماتيك: أول ما العضو يفتح الكارت بنجهّز له كود صالح
 * (الـ RPC بيرجّع نفس الكود لو لسه صالح) وبنعرض زر واحد بيفتح تلجرام
 * والكود متضمّن في اللينك — ضغطة واحدة بدون نسخ ولزق.
 */
export function MemberTelegramCard() {
  const { t, date } = useLocale();
  const state = useTelegramMemberState();
  const createCode = useCreateTelegramLinkCode();
  const toggleMute = useToggleTelegramMuteSelf();
  const unlink = useUnlinkTelegramSelf();
  const [copied, setCopied] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const autoRequested = useRef(false);
  const enabled = state.data?.enabled === true;
  const linked = state.data?.linked === true;

  useEffect(() => {
    if (autoRequested.current || !enabled || linked) return;
    if (createCode.isPending || createCode.data) return;
    autoRequested.current = true;
    createCode.mutate(undefined, { onError: () => { autoRequested.current = false; } });
    // بنجهّز الكود مرة واحدة لكل فتح للصفحة
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, linked]);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error(t('تعذر النسخ', 'Copy failed'));
    }
  };

  if (state.isLoading) {
    return (
      <section className="glass-card grid place-items-center p-6">
        <Loader2 className="animate-spin text-[var(--text-muted)]" size={20} aria-hidden="true" />
      </section>
    );
  }

  const data = state.data;
  if (!data?.enabled) {
    return (
      <section className="glass-card grid gap-2 p-5">
        <div className="flex items-center gap-2">
          <Send size={18} aria-hidden="true" className="text-[var(--link)]" />
          <h2 className="text-base font-bold text-[var(--text)]">{t('إشعارات تلجرام', 'Telegram notifications')}</h2>
        </div>
        <p className="text-sm leading-7 text-[var(--text-muted)]">
          {t('بوت التيم لسه مش مفعّل. الإدارة هتفعّله قريب وكل إشعاراتك هتوصلك هنا.', 'The team bot is not active yet. Once the admins enable it, all your notifications arrive here.')}
        </p>
      </section>
    );
  }

  const code = createCode.data;
  return (
    <section className="glass-card grid gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Send size={18} aria-hidden="true" className="text-[var(--link)]" />
          <h2 className="text-base font-bold text-[var(--text)]">{t('إشعارات تلجرام', 'Telegram notifications')}</h2>
        </div>
        {data.linked ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--success-soft)] px-2.5 py-1 text-xs font-bold text-[var(--success-text)]">
            <Check size={13} aria-hidden="true" />
            {t('مربوط', 'Linked')}
          </span>
        ) : (
          <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-xs font-bold text-[var(--text-muted)]">
            {t('غير مربوط', 'Not linked')}
          </span>
        )}
      </div>
      {data.linked ? (
        <>
          <p className="text-sm leading-7 text-[var(--text-muted)]">
            {t('كل مهامك وإعلاناتك وتقييماتك واجتماعاتك بتوصلك على تلجرام.', 'Your tasks, announcements, evaluations and meetings all arrive on Telegram.')}
            {data.username ? <span dir="ltr"> @{data.username}</span> : null}
            {data.linked_at ? ` · ${date(data.linked_at, { dateStyle: 'medium' })}` : ''}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm font-semibold text-[var(--text)] transition hover:border-[var(--border-strong)]"
              onClick={() => toggleMute.mutate(undefined, {
                onSuccess: (muted) => toast.success(muted ? t('تم كتم الإشعارات', 'Notifications muted') : t('تم تشغيل الإشعارات', 'Notifications enabled')),
                onError: (error: Error) => toast.error(error.message),
              })}
            >
              {data.muted ? <Bell size={15} aria-hidden="true" /> : <BellOff size={15} aria-hidden="true" />}
              {data.muted ? t('تشغيل الإشعارات', 'Unmute') : t('كتم الإشعارات', 'Mute')}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3 py-2 text-sm font-semibold text-[var(--danger)] transition"
              onClick={() => unlink.mutate(undefined, {
                onSuccess: () => toast.success(t('تم فصل الحساب', 'Account unlinked')),
                onError: (error: Error) => toast.error(error.message),
              })}
            >
              {t('فصل الحساب', 'Unlink')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm leading-7 text-[var(--text-muted)]">
            {t('اربط حسابك مرة واحدة وهتستقبل كل إشعارات الفريق على تلجرام.', 'Link once and receive every team notification on Telegram.')}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {code?.deep_link ? (
              <a
                className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--primary)] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[var(--primary-hover)]"
                href={code.deep_link}
                target="_blank"
                rel="noreferrer noopener"
              >
                <Send size={16} aria-hidden="true" />
                {t('ربط أوتوماتيك في تلجرام', 'Link automatically on Telegram')}
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            ) : (
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--primary)] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[var(--primary-hover)] disabled:opacity-60"
                disabled={createCode.isPending}
                onClick={() => createCode.mutate(undefined, { onError: (error: Error) => toast.error(error.message) })}
              >
                {createCode.isPending ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Link2 size={15} aria-hidden="true" />}
                {t('جهّز زر الربط', 'Prepare the link button')}
              </button>
            )}
            <button
              type="button"
              className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--link)] underline"
              onClick={() => setShowManual((open) => !open)}
              aria-expanded={showManual}
            >
              {showManual ? t('إخفاء الكود', 'Hide the code') : t('عندي كود بالفعل', 'I already have a code')}
            </button>
          </div>
          <p className="text-xs leading-6 text-[var(--text-muted)]">
            {t('الزر بيفتح تلجرام على البوت والكود جاهز — بتدوس Start وخلاص. الكود صالح 20 دقيقة وبيتجدد لوحده.', 'The button opens the bot on Telegram with the code ready — just press Start. The code lives 20 minutes and renews itself.')}
          </p>
          {showManual && code && (
            <div className="grid gap-1 text-sm leading-7 text-[var(--text-muted)]">
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 font-mono text-sm tracking-widest text-[var(--text)]" dir="ltr">
                  {code.code}
                </code>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--link)] underline"
                  onClick={() => void copy(code.code)}
                >
                  {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                  {copied ? t('اتنسخ', 'Copied') : t('نسخ', 'Copy')}
                </button>
              </div>
              <p>
                {t('أو ابعت للبوت:', 'Or send the bot:')}{' '}
                <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5" dir="ltr">/start {code.code}</code>
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
