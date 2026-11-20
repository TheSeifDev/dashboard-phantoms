import { AlertCircle, CheckCircle2, Link2, LogOut, PowerOff, QrCode, RefreshCw } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import type { ConnectionState, WhatsAppStatus } from './api';
import { WhatsAppQRCodeBox } from './WhatsAppQRCodeBox';

import { useLocale } from '../../i18n/useLocale';
interface WhatsAppQRViewerProps {
  status: WhatsAppStatus | undefined;
  loading: boolean;
  statusError?: boolean;
  error?: string;
  pending: boolean;
  onRetryStatus: () => void;
  onConnect: () => void;
  onSimulatePair: () => void;
  onDisconnect: () => void;
  onRevoke: () => void;
}

export function WhatsAppQRViewer({
  status,
  loading,
  statusError = false,
  error,
  pending,
  onRetryStatus,
  onConnect,
  onSimulatePair,
  onDisconnect,
  onRevoke,
}: WhatsAppQRViewerProps) {
  const { t, dir } = useLocale();
  const connectionState: ConnectionState | undefined = status
    ? status.state ?? (status.connected ? 'connected' : status.qr ? 'qr_ready' : status.enabled ? 'connecting' : 'disconnected')
    : undefined;
  const borderClass = connectionState === 'connected'
    ? 'border-s-emerald-600'
    : connectionState === 'qr_ready' || connectionState === 'connecting'
      ? 'border-s-amber-500'
      : 'border-s-[var(--border)]';

  return (
    <Card className={`grid gap-5 border-s-4 ${borderClass}`} dir={dir}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--primary-soft)] text-[var(--link)]">
            <QrCode size={20} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-extrabold text-[var(--text)]">{t('حالة اتصال واتساب', 'WhatsApp connection status')}</span>
              {loading && !status ? (
                <Badge variant="neutral">{t('جارٍ التحقق…', 'Checking…')}</Badge>
              ) : connectionState === 'connected' ? (
                <Badge variant="success">{t('متصل', 'Connected')}</Badge>
              ) : connectionState === 'qr_ready' ? (
                <Badge variant="warning">{t('بانتظار المسح', 'Awaiting scan')}</Badge>
              ) : connectionState === 'connecting' ? (
                <Badge variant="info">{t('جارٍ الاتصال', 'Connecting')}</Badge>
              ) : connectionState === 'disconnected' ? (
                <Badge variant="neutral">{t('غير متصل', 'Disconnected')}</Badge>
              ) : statusError ? (
                <Badge variant="danger">{t('الحالة غير متاحة', 'Status unavailable')}</Badge>
              ) : (
                <Badge variant="neutral">{t('الحالة غير معروفة', 'Status unknown')}</Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {status?.phone
                ? <>{t('الرقم المرتبط:', 'Linked number:')} <bdi dir="ltr" className="font-semibold">{status.phone}</bdi></>
                : t('اتصال الاختبار المستقل (Baileys)', 'Standalone Baileys test connection')}
            </p>
          </div>
        </div>

        {status?.dryRun && (
          <span className="rounded-lg border border-[var(--primary)] bg-[var(--primary-soft)] px-2.5 py-1 text-xs font-bold text-[var(--link)]">
            {t('محاكاة معزولة (Mock)', 'Isolated simulation (Mock)')}
          </span>
        )}
      </div>

      {loading && !status && (
        <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4 text-sm text-[var(--text-muted)]">
          <span className="size-4 animate-pulse rounded-full bg-[var(--primary)]" aria-hidden="true" />
          {t('جارٍ تحميل حالة الاتصال الآمنة…', 'Loading the secure connection status…')}
        </div>
      )}

      {pending && (
        <p role="status" aria-live="polite" className="rounded-xl bg-[var(--surface-2)] p-3 text-sm text-[var(--text-muted)]">
          {t('جارٍ تنفيذ طلب الاتصال. انتظر حتى تتحدث الحالة قبل المحاولة مرة أخرى.', 'Connection request in progress. Wait for the status to update before trying again.')}
        </p>
      )}

      {status?.qr && connectionState !== 'connected' && (
        <WhatsAppQRCodeBox
          qr={status.qr}
          qrExpiresAt={status.qrExpiresAt}
          pending={pending}
          onRefresh={onConnect}
          onSimulatePair={onSimulatePair}
        />
      )}

      {connectionState === 'connected' && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-[var(--success-border)] bg-[var(--success-soft)] p-4 text-[var(--success-text)]">
          <CheckCircle2 className="mt-0.5 shrink-0" size={20} aria-hidden="true" />
          <div className="text-sm leading-6">
            <p className="font-extrabold">{t('جلسة واتساب متصلة', 'WhatsApp session connected')}{status?.phone ? <> (<bdi dir="ltr">{status.phone}</bdi>)</> : ''}</p>
            <p className="mt-1 text-xs">{t('انتقل لاختيار المهمة والأعضاء الذين وافقوا على استقبال الرسائل، ثم راجع المحتوى قبل التأكيد.', 'Choose a task and recipients who consented to messages, then review the content before confirming.')}</p>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="flex flex-wrap items-start gap-3 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]">
          <AlertCircle className="mt-0.5 shrink-0" size={17} aria-hidden="true" />
          <p className="min-w-0 flex-1 break-words">{error}</p>
          {statusError && !status && (
            <Button type="button" variant="secondary" icon={<RefreshCw size={15} aria-hidden="true" />} onClick={onRetryStatus} disabled={pending} className="min-h-11">
              {t('إعادة فحص الحالة', 'Retry status check')}
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-4 sm:flex-row sm:flex-wrap">
        {status && connectionState !== 'connected' && !status.qr && (
          <Button
            type="button"
            icon={<Link2 size={17} aria-hidden="true" />}
            disabled={pending || loading}
            onClick={onConnect}
            fullOnMobile
          >
            {t('بدء الربط وطلب رمز QR', 'Start connection and request QR')}
          </Button>
        )}

        {connectionState === 'connected' && (
          <>
            <Button
              type="button"
              variant="secondary"
              icon={<PowerOff size={17} aria-hidden="true" />}
              disabled={pending}
              onClick={onDisconnect}
              fullOnMobile
            >
              {t('قطع الاتصال', 'Disconnect')}
            </Button>
            <Button
              type="button"
              variant="danger"
              icon={<LogOut size={17} aria-hidden="true" />}
              disabled={pending}
              onClick={onRevoke}
              fullOnMobile
            >
              {t('إلغاء ربط الرقم وإنهاء الجلسة', 'Unlink number and end session')}
            </Button>
          </>
        )}

        {status?.qr && connectionState !== 'connected' && (
          <Button
            type="button"
            variant="secondary"
            icon={<PowerOff size={17} aria-hidden="true" />}
            disabled={pending}
            onClick={onDisconnect}
            fullOnMobile
          >
            {t('إلغاء جلسة الربط', 'Cancel connection session')}
          </Button>
        )}
      </div>
    </Card>
  );
}
