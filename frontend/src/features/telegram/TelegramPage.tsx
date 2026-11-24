import { useEffect, useMemo, useState } from 'react';
import {
  Bell, Bot, Check, Copy, Inbox, KeyRound, Link2, MessageSquare, RefreshCw, Send,
  ShieldCheck, Trash2, Users, VolumeX,
} from 'lucide-react';
import { toast } from '../../store/toast';
import { useAuthStore } from '../../store/auth';
import { useLocale } from '../../i18n/useLocale';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { PageHeader } from '../../components/ui/PageHeader';
import { CardSkeletons } from '../../components/ui/Skeleton';
import {
  TELEGRAM_EVENT_LABELS, useBroadcastTelegram, useCreateTelegramLinkCode, useMuteTelegramLink,
  useRetryTelegramMessage, useSaveTelegramSettings, useSendTelegramTest, useSyncTelegramWebhook,
  useTelegramLinks, useTelegramMemberState, useTelegramOutbox, useTelegramState, useUnlinkTelegram,
  type TelegramNotifyFlags,
} from './api';

const inputClass =
  'w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] outline-none transition focus:border-[var(--primary)]';

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition ${
        checked ? 'border-[var(--primary)] bg-[var(--primary)]' : 'border-[var(--border)] bg-[var(--surface-2)]'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute size-4 rounded-full bg-[var(--surface)] shadow-[var(--shadow-sm)] transition-all ${
          checked ? 'right-1' : 'right-6'
        }`}
      />
    </button>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] p-3">
      <p className="text-xs font-semibold text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 text-lg font-black text-[var(--text)]">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{hint}</p>}
    </div>
  );
}

export default function TelegramPage() {
  const { t, number, date } = useLocale();
  const user = useAuthStore((state) => state.user);
  const state = useTelegramState();
  const links = useTelegramLinks();
  const outbox = useTelegramOutbox();
  const memberState = useTelegramMemberState();
  const save = useSaveTelegramSettings();
  const syncWebhook = useSyncTelegramWebhook();
  const sendTest = useSendTelegramTest();
  const retry = useRetryTelegramMessage();
  const unlink = useUnlinkTelegram();
  const mute = useMuteTelegramLink();
  const createCode = useCreateTelegramLinkCode();
  const broadcast = useBroadcastTelegram();

  const [token, setToken] = useState('');
  const [botUsername, setBotUsername] = useState('');
  const [drainUrl, setDrainUrl] = useState('');
  const [flags, setFlags] = useState<TelegramNotifyFlags | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [copied, setCopied] = useState(false);
  const [broadcastText, setBroadcastText] = useState('');
  const [confirmUnlink, setConfirmUnlink] = useState<number | null>(null);

  useEffect(() => {
    if (!state.data) return;
    setBotUsername(state.data.bot_username ?? '');
    setDrainUrl(state.data.drain_url);
    setFlags(state.data.notify);
    setEnabled(state.data.enabled);
  }, [state.data]);

  const linkCode = createCode.data;
  const deepLink = useMemo(() => {
    if (!linkCode) return '';
    return linkCode.deep_link ?? '';
  }, [linkCode]);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error(t('تعذر النسخ', 'Copy failed'));
    }
  };

  if (state.isLoading) return <CardSkeletons count={3} />;
  if (state.isError) return <ErrorState message={t('تعذر تحميل إعدادات بوت تلجرام. أعد المحاولة.', 'Could not load the Telegram bot settings. Retry.')} onRetry={() => void state.refetch()} />;

  const data = state.data;
  const configured = Boolean(data?.configured);

  const persist = (payload: Record<string, unknown>) => {
    save.mutate(payload, {
      onSuccess: () => toast.success(t('تم حفظ إعدادات البوت', 'Bot settings saved')),
      onError: (error: Error) => toast.error(error.message),
    });
  };

  return (
    <div className="grid gap-5 sm:gap-6">
      <PageHeader
        icon={<Bot size={22} aria-hidden="true" />}
        title={t('بوت تلجرام', 'Telegram bot')}
        description={t(
          'كل أحداث الفريق — مهام، إعلانات، تقييمات، تحذيرات، اجتماعات، خزنة، مصادر، مشاريع وطلبات صلاحيات — بتوصل على تلجرام، والأعضاء يقدروا يردوا من نفس الشات.',
          'Every team event — tasks, announcements, evaluations, strikes, meetings, ledger, references, projects and capability requests — lands on Telegram, and members can act from the same chat.',
        )}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={configured ? 'success' : 'warning'} size="sm">
              {configured ? t('التوكن محفوظ', 'Token saved') : t('محتاج توكن', 'Token required')}
            </Badge>
            <Badge variant={data?.enabled ? 'success' : 'neutral'} size="sm">
              {data?.enabled ? t('البوت شغال', 'Bot active') : t('البوت متوقف', 'Bot paused')}
            </Badge>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('شاتات مربوطة', 'Linked chats')} value={number(data?.links.total ?? 0)} hint={t(`من ${number(data?.links.members ?? 0)} عضو`, `of ${number(data?.links.members ?? 0)} members`)} />
        <Stat label={t('رسائل في الانتظار', 'Queued')} value={number(data?.outbox.pending ?? 0)} />
        <Stat label={t('اتبعتت 24 ساعة', 'Sent 24h')} value={number(data?.outbox.sent_24h ?? 0)} />
        <Stat label={t('فشلت', 'Failed')} value={number(data?.outbox.failed ?? 0)} hint={data?.last_error ?? undefined} />
      </div>

      <Card className="grid gap-4">
        <div className="flex items-center gap-2">
          <KeyRound size={18} aria-hidden="true" className="text-[var(--link)]" />
          <h2 className="text-base font-bold text-[var(--text)]">{t('الربط والتوكن', 'Connection and token')}</h2>
        </div>
        <ol className="grid gap-2 text-sm leading-7 text-[var(--text-muted)]">
          <li>{t('1. افتح BotFather على تلجرام وابعت /newbot واختار اسم ويوزرنيم للبوت.', '1. Open BotFather on Telegram, send /newbot and pick a name and username.')}</li>
          <li>{t('2. انسخ التوكن وحطه هنا، واكتب يوزرنيم البوت من غير @.', '2. Copy the token here and type the bot username without @.')}</li>
          <li>{t('3. اضغط «تفعيل الويبهوك» — التلجرام هيبدأ يبعت تحديثات للسيرفر على طول.', '3. Press “Activate webhook” so Telegram starts delivering updates.')}</li>
        </ol>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-semibold text-[var(--text)]">
            {t('توكن البوت', 'Bot token')}
            <input
              type="password"
              className={inputClass}
              value={token}
              placeholder={data?.has_token ? t('محفوظ — اكتب توكن جديد للتغيير', 'Saved — type a new token to replace') : '123456:ABC…'}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-[var(--text)]">
            {t('يوزرنيم البوت', 'Bot username')}
            <input
              className={inputClass}
              value={botUsername}
              placeholder="phantoms_team_bot"
              onChange={(event) => setBotUsername(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-[var(--text)] sm:col-span-2">
            {t('عنوان الويبهوك', 'Webhook URL')}
            <input className={inputClass} value={drainUrl} onChange={(event) => setDrainUrl(event.target.value)} dir="ltr" />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            icon={<Check size={16} />}
            isLoading={save.isPending}
            onClick={() => persist({ bot_token: token, bot_username: botUsername, drain_url: drainUrl, enabled })}
          >
            {t('حفظ', 'Save')}
          </Button>
          <Button
            variant="secondary"
            icon={<RefreshCw size={16} />}
            isLoading={syncWebhook.isPending}
            onClick={() => syncWebhook.mutate(undefined, {
              onSuccess: () => toast.success(t('تم تفعيل الويبهوك', 'Webhook activated')),
              onError: (error: Error) => toast.error(error.message),
            })}
          >
            {t('تفعيل الويبهوك', 'Activate webhook')}
          </Button>
          <Button
            variant="secondary"
            icon={<Send size={16} />}
            isLoading={sendTest.isPending}
            onClick={() => sendTest.mutate(undefined, {
              onSuccess: () => toast.success(t('الرسالة التجريبية في الطابور', 'Test message queued')),
              onError: (error: Error) => toast.error(error.message),
            })}
          >
            {t('رسالة تجريبية', 'Test message')}
          </Button>
          <div className="ms-auto flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
            {t('تشغيل البوت', 'Bot enabled')}
            <Toggle
              checked={enabled}
              label={t('تشغيل البوت', 'Bot enabled')}
              onChange={(value) => {
                setEnabled(value);
                persist({ enabled: value });
              }}
            />
          </div>
        </div>
        {data?.webhook_set_at && (
          <p className="text-xs text-[var(--text-muted)]">
            {t('آخر تفعيل للويبهوك:', 'Webhook activated:')} {date(data.webhook_set_at, { dateStyle: 'medium', timeStyle: 'short' })}
            {data.last_webhook_at ? ` · ${t('آخر تحديث', 'Last update')} ${date(data.last_webhook_at, { timeStyle: 'short' })}` : ''}
          </p>
        )}
        {data?.last_error && (
          <p className="rounded-[var(--radius-md)] border border-[var(--danger-border)] bg-[var(--danger-soft)] p-3 text-xs text-[var(--danger)]" dir="ltr">
            {data.last_error}
          </p>
        )}
      </Card>

      <Card className="grid gap-3">
        <div className="flex items-center gap-2">
          <Link2 size={18} aria-hidden="true" className="text-[var(--link)]" />
          <h2 className="text-base font-bold text-[var(--text)]">{t('ربط حسابك أنت', 'Link your own account')}</h2>
        </div>
        {memberState.data?.linked ? (
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="success" size="sm">{t('حسابك مربوط', 'Your account is linked')}</Badge>
            {memberState.data.username && <span className="text-sm text-[var(--text-muted)]">@{memberState.data.username}</span>}
          </div>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">
            {t('اعمل كود وابعت للبوت:', 'Create a code and send it to the bot:')}{' '}
            <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5" dir="ltr">/start CODE</code>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            icon={<KeyRound size={16} />}
            isLoading={createCode.isPending}
            disabled={!data?.enabled}
            onClick={() => createCode.mutate()}
          >
            {t('كود ربط جديد', 'New link code')}
          </Button>
          {linkCode && (
            <>
              <span className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 font-mono text-sm tracking-widest text-[var(--text)]" dir="ltr">
                {linkCode.code}
              </span>
              <Button variant="ghost" icon={copied ? <Check size={16} /> : <Copy size={16} />} onClick={() => void copy(linkCode.code)}>
                {copied ? t('اتنسخ', 'Copied') : t('نسخ', 'Copy')}
              </Button>
              {deepLink && (
                <a className="text-sm font-semibold text-[var(--link)] underline" href={deepLink} target="_blank" rel="noreferrer">
                  {t('افتح البوت', 'Open bot')}
                </a>
              )}
            </>
          )}
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          {t('الكود صالح 20 دقيقة ولمرة واحدة. الأعضاء بيعملوا نفس الكود من «الحساب والإعدادات» في البوابة.', 'The code is valid for 20 minutes, single use. Members create theirs from Account & settings in the portal.')}
        </p>
      </Card>

      <Card className="grid gap-3">
        <div className="flex items-center gap-2">
          <Bell size={18} aria-hidden="true" className="text-[var(--link)]" />
          <h2 className="text-base font-bold text-[var(--text)]">{t('إشعارات الأحداث', 'Event notifications')}</h2>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {TELEGRAM_EVENT_LABELS.map((event) => {
            const active = flags ? flags[event.key] : false;
            return (
              <div key={event.key} className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
                <span className="min-w-0 truncate text-sm font-semibold text-[var(--text)]">{t(event.ar, event.en)}</span>
                <Toggle
                  checked={active}
                  label={t(event.ar, event.en)}
                  onChange={(value) => {
                    if (!flags) return;
                    const next = { ...flags, [event.key]: value };
                    setFlags(next);
                    persist({ notify: next });
                  }}
                />
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="grid gap-3">
        <div className="flex items-center gap-2">
          <MessageSquare size={18} aria-hidden="true" className="text-[var(--link)]" />
          <h2 className="text-base font-bold text-[var(--text)]">{t('بث رسالة', 'Broadcast')}</h2>
        </div>
        <textarea
          className={`${inputClass} min-h-24 resize-y`}
          value={broadcastText}
          maxLength={3500}
          placeholder={t('اكتب الرسالة اللي هتوصل لكل الأعضاء المربوطين…', 'Write the message every linked member will receive…')}
          onChange={(event) => setBroadcastText(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            icon={<Send size={16} />}
            isLoading={broadcast.isPending}
            disabled={broadcastText.trim().length === 0}
            onClick={() => broadcast.mutate(
              { text: broadcastText.trim(), audience: { type: 'all' } },
              {
                onSuccess: (count) => {
                  setBroadcastText('');
                  toast.success(t(`تم جدولة البث لـ ${number(count)} عضو`, `Broadcast queued for ${number(count)} members`));
                },
                onError: (error: Error) => toast.error(error.message),
              },
            )}
          >
            {t('بث للكل', 'Broadcast to all')}
          </Button>
          <span className="text-xs text-[var(--text-muted)]">{broadcastText.length}/3500</span>
        </div>
      </Card>

      <Card className="grid gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Users size={18} aria-hidden="true" className="text-[var(--link)]" />
            <h2 className="text-base font-bold text-[var(--text)]">{t('الحسابات المربوطة', 'Linked accounts')}</h2>
          </div>
          <Button variant="ghost" icon={<RefreshCw size={16} />} onClick={() => void links.refetch()}>
            {t('تحديث', 'Refresh')}
          </Button>
        </div>
        {links.isLoading ? (
          <CardSkeletons count={1} />
        ) : !links.data?.length ? (
          <EmptyState title={t('مفيش حسابات مربوطة لسه', 'No linked accounts yet')} description={t('ابعت كود الربط للأعضاء أو ابدأ بحسابك.', 'Share a link code with the team, or start with your own account.')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-0 text-sm">
              <thead>
                <tr className="text-start text-xs uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="px-2 py-2 text-start font-semibold">{t('العضو', 'Member')}</th>
                  <th className="px-2 py-2 text-start font-semibold">{t('الشات', 'Chat')}</th>
                  <th className="px-2 py-2 text-start font-semibold">{t('الحالة', 'Status')}</th>
                  <th className="px-2 py-2 text-start font-semibold">{t('الربط', 'Linked')}</th>
                  <th className="px-2 py-2 text-end font-semibold">{t('إجراءات', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {links.data.map((link) => (
                  <tr key={link.id} className="border-t border-[var(--border)]">
                    <td className="px-2 py-2">
                      <p className="font-semibold text-[var(--text)]">{link.full_name ?? link.email ?? '—'}</p>
                      <p className="text-xs text-[var(--text-muted)]" dir="ltr">{link.email ?? ''}</p>
                    </td>
                    <td className="px-2 py-2 text-[var(--text-muted)]" dir="ltr">
                      {link.username ? `@${link.username}` : link.chat_id}
                    </td>
                    <td className="px-2 py-2">
                      <Badge variant={link.muted ? 'neutral' : 'success'} size="sm">
                        {link.muted ? t('مكتوم', 'Muted') : t('نشط', 'Active')}
                      </Badge>
                    </td>
                    <td className="px-2 py-2 text-xs text-[var(--text-muted)]">
                      {date(link.linked_at, { dateStyle: 'medium' })}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          icon={<VolumeX size={15} />}
                          onClick={() => mute.mutate({ linkId: link.id, muted: !link.muted })}
                        >
                          {link.muted ? t('تشغيل', 'Unmute') : t('كتم', 'Mute')}
                        </Button>
                        {confirmUnlink === link.id ? (
                          <Button
                            variant="danger"
                            icon={<Trash2 size={15} />}
                            onClick={() => unlink.mutate(link.id, { onSuccess: () => setConfirmUnlink(null) })}
                          >
                            {t('تأكيد الفصل', 'Confirm')}
                          </Button>
                        ) : (
                          <Button variant="ghost" icon={<Trash2 size={15} />} onClick={() => setConfirmUnlink(link.id)}>
                            {t('فصل', 'Unlink')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="grid gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Inbox size={18} aria-hidden="true" className="text-[var(--link)]" />
            <h2 className="text-base font-bold text-[var(--text)]">{t('سجل الإرسال', 'Delivery log')}</h2>
          </div>
          <Button variant="ghost" icon={<RefreshCw size={16} />} onClick={() => void outbox.refetch()}>
            {t('تحديث', 'Refresh')}
          </Button>
        </div>
        {outbox.isLoading ? (
          <CardSkeletons count={1} />
        ) : !outbox.data?.length ? (
          <EmptyState title={t('مفيش رسائل لسه', 'Nothing sent yet')} description={t('أي حدث في الداشبورد هيتسجل هنا قبل ما يتبعت.', 'Every dashboard event is recorded here before delivery.')} />
        ) : (
          <ul className="grid gap-2">
            {outbox.data.map((row) => (
              <li key={row.id} className="grid gap-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    size="sm"
                    variant={row.status === 'sent' ? 'success' : row.status === 'failed' ? 'danger' : row.status === 'skipped' ? 'neutral' : 'warning'}
                  >
                    {row.status}
                  </Badge>
                  <span className="text-xs font-semibold text-[var(--text-muted)]">{row.kind}</span>
                  <span className="text-xs text-[var(--text-muted)]">{date(row.created_at, { timeStyle: 'short' })}</span>
                  {(row.status === 'failed' || row.status === 'skipped') && (
                    <Button variant="ghost" icon={<RefreshCw size={14} />} onClick={() => retry.mutate(row.id)}>
                      {t('إعادة', 'Retry')}
                    </Button>
                  )}
                </div>
                <p className="line-clamp-2 text-sm text-[var(--text)]">{row.body.replace(/<[^>]+>/g, '')}</p>
                {row.last_error && <p className="text-xs text-[var(--danger)]" dir="ltr">{row.last_error}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-wrap items-center gap-3 text-sm text-[var(--text-muted)]">
        <ShieldCheck size={18} aria-hidden="true" className="text-[var(--success-text)]" />
        <span>
          {t('التوكن والسر محفوظين في الداتابيز ومش بيتقرأوا من المتصفح أبدًا. الوصول للصفحة محتاج صلاحية «المراسلة»', 'The token and webhook secret live in the database and are never exposed to the browser. This page needs the messaging permission')}
          {user?.email ? ` · ${user.email}` : ''}
        </span>
      </Card>
    </div>
  );
}
