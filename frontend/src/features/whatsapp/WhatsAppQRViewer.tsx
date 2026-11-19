import { AlertCircle, CheckCircle2, Link2, LogOut, PowerOff, QrCode } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import type { ConnectionState, WhatsAppStatus } from './api';
import { WhatsAppQRCodeBox } from './WhatsAppQRCodeBox';

import { useLocale } from '../../i18n/useLocale';
interface WhatsAppQRViewerProps {
  status: WhatsAppStatus | undefined;
  loading: boolean;
  error?: string;
  pending: boolean;
  onConnect: () => void;
  onSimulatePair: () => void;
  onDisconnect: () => void;
  onRevoke: () => void;
}

export function WhatsAppQRViewer({
  status,
  loading,
  error,
  pending,
  onConnect,
  onSimulatePair,
  onDisconnect,
  onRevoke,
}: WhatsAppQRViewerProps) {
  const { t, dir } = useLocale();
  const connectionState: ConnectionState =
    status?.state ??
    (status?.connected
      ? 'connected'
      : status?.qr
        ? 'qr_ready'
        : status?.enabled
          ? 'connecting'
          : 'disconnected');

  return (
    <Card className="grid gap-5 border-s-4 border-s-emerald-600" dir={dir}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
            <QrCode size={20} aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-[var(--text)]">{t("حالة اتصال واتساب:", "WhatsApp connection:")}</span>
              {loading ? (
                <Badge variant="neutral">{t("بنراجع...", "Checking...")}</Badge>
              ) : connectionState === 'connected' ? (
                <Badge variant="success">{t("متصل بنجاح", "Connected")}</Badge>
              ) : connectionState === 'qr_ready' ? (
                <Badge variant="warning">{t("مستني المسح", "Awaiting scan")}</Badge>
              ) : connectionState === 'connecting' ? (
                <Badge variant="info">{t("بنتصل...", "Connecting...")}</Badge>
              ) : (
                <Badge variant="neutral">{t("مش متصل", "Disconnected")}</Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              {status?.phone ? t(`الرقم المرتبط: ${status.phone}`, `Linked number: ${status.phone}`) : t('النظام: سيرفر Baileys التجريبي المستقل', 'System: standalone Baileys test server')}
            </p>
          </div>
        </div>

        {status?.dryRun && (
          <span className="rounded-lg border border-[var(--primary)] bg-[var(--primary-soft)] px-2.5 py-1 text-xs font-bold text-[var(--link)]">
            {t('وضع محاكاة معزول (Mock)', 'Isolated simulation mode (Mock)')}
          </span>
        )}
      </div>

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
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950 dark:border-emerald-800/60 dark:bg-emerald-950/20 dark:text-emerald-200">
          <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" size={20} aria-hidden="true" />
          <div className="text-sm leading-6">
            <p className="font-extrabold">{t("جلسة واتساب متصلة وشغالة", "WhatsApp session connected and active")} ({status?.phone ?? t('رقم الإدارة', 'Admin number')})</p>
            <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-300">
              {t("تقدر دلوقتي تختار المهمة وتحدد الأعضاء اللي أكدوا استقبالهم عشان تبعت لهم إشعارات المهام.", "You can now choose a task and select members who consented to receive task notifications.")}
            </p>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="flex items-center gap-2 text-sm text-[var(--danger)]">
          <AlertCircle size={17} aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2 pt-2">
        {connectionState !== 'connected' && !status?.qr && (
          <Button
            type="button"
            icon={<Link2 size={17} aria-hidden="true" />}
            disabled={pending}
            onClick={onConnect}
            fullOnMobile
          >
            {t('فعّل الربط واطلب رمز QR', 'Enable connection and request QR code')}
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
              {t('اقفل الاتصال', 'Disconnect')}
            </Button>
            <Button
              type="button"
              variant="danger"
              icon={<LogOut size={17} aria-hidden="true" />}
              disabled={pending}
              onClick={onRevoke}
              fullOnMobile
            >
              {t('افصل الرقم والغي الجلسة نهائيًا', 'Unlink number and end session permanently')}
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
