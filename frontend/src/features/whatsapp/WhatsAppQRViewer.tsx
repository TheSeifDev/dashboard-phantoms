import { AlertCircle, CheckCircle2, Link2, LogOut, PowerOff, QrCode } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import type { ConnectionState, WhatsAppStatus } from './api';
import { WhatsAppQRCodeBox } from './WhatsAppQRCodeBox';

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
    <Card className="grid gap-5 border-s-4 border-s-emerald-600">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
            <QrCode size={20} aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-[var(--text)]">حالة اتصال واتساب:</span>
              {loading ? (
                <Badge variant="neutral">بنراجع...</Badge>
              ) : connectionState === 'connected' ? (
                <Badge variant="success">متصل بنجاح</Badge>
              ) : connectionState === 'qr_ready' ? (
                <Badge variant="warning">مستني المسح</Badge>
              ) : connectionState === 'connecting' ? (
                <Badge variant="info">بنتصل...</Badge>
              ) : (
                <Badge variant="neutral">مش متصل</Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              {status?.phone ? `الرقم المرتبط: ${status.phone}` : 'النظام: سيرفر Baileys التجريبي المستقل'}
            </p>
          </div>
        </div>

        {status?.dryRun && (
          <span className="rounded-lg border border-[var(--primary)] bg-[var(--primary-soft)] px-2.5 py-1 text-xs font-bold text-[var(--link)]">
            وضع محاكاة معزول (Mock)
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
            <p className="font-extrabold">جلسة واتساب متصلة وشغالة ({status?.phone ?? 'رقم الإدارة'})</p>
            <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-300">
              تقدر دلوقتي تختار المهمة وتحدد الأعضاء اللي أكدوا استقبالهم عشان تبعت لهم إشعارات المهام.
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
            فعّل الربط واطلب رمز QR
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
              اقفل الاتصال
            </Button>
            <Button
              type="button"
              variant="danger"
              icon={<LogOut size={17} aria-hidden="true" />}
              disabled={pending}
              onClick={onRevoke}
              fullOnMobile
            >
              افصل الرقم والغي الجلسة نهائيًا
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
            إلغاء جلسة الربط
          </Button>
        )}
      </div>
    </Card>
  );
}
