import { useEffect, useState } from 'react';
import { AlertCircle, Clock, RefreshCw } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '../../components/ui/Button';

interface WhatsAppQRCodeBoxProps {
  qr: string;
  qrExpiresAt: string | null;
  pending: boolean;
  onRefresh: () => void;
  onSimulatePair: () => void;
}

export function WhatsAppQRCodeBox({
  qr,
  qrExpiresAt,
  pending,
  onRefresh,
  onSimulatePair,
}: WhatsAppQRCodeBoxProps) {
  const [secondsRemaining, setSecondsRemaining] = useState<number>(60);

  useEffect(() => {
    if (!qrExpiresAt) {
      setSecondsRemaining(60);
      return;
    }

    const update = () => {
      const diff = Math.max(0, Math.floor((new Date(qrExpiresAt).getTime() - Date.now()) / 1000));
      setSecondsRemaining(diff);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [qrExpiresAt]);

  const isExpired = secondsRemaining === 0;

  return (
    <div className="relative mx-auto flex w-full max-w-sm flex-col items-center gap-3 rounded-2xl border border-[var(--border)] bg-white p-5 text-center text-slate-800 shadow-xs">
      <div className="relative">
        <QRCodeSVG
          value={qr}
          size={210}
          level="M"
          aria-label="رمز QR لربط واتساب"
          className={isExpired ? 'opacity-15 blur-[1px]' : ''}
        />

        {/* Expired Overlay */}
        {isExpired && (
          <div
            role="alert"
            aria-live="assertive"
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-slate-950/85 p-4 text-white"
          >
            <AlertCircle size={30} className="text-amber-400" aria-hidden="true" />
            <p className="text-sm font-extrabold text-amber-200">انتهت صلاحية الرمز</p>
            <p className="text-xs text-slate-300">مهلة الـ 60 ثانية لمسح الرمز خلصت.</p>
            <Button
              type="button"
              variant="primary"
              icon={<RefreshCw size={15} aria-hidden="true" />}
              disabled={pending}
              onClick={onRefresh}
              className="mt-2 min-h-[44px] text-xs font-bold"
            >
              حدّث الرمز
            </Button>
          </div>
        )}
      </div>

      {!isExpired && (
        <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
          <Clock size={15} className="text-[var(--primary)]" aria-hidden="true" />
          <span>الرمز صلاحيته هتخلص خلال: {secondsRemaining} ثانية</span>
        </div>
      )}

      <p className="text-xs leading-5 text-slate-600">
        من تطبيق واتساب على موبايلك: روح لـ <strong>الأجهزة المرتبطة ← ربط جهاز</strong> وبعدين امسح الرمز.
      </p>

      <div className="flex w-full flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <Button
          type="button"
          variant="secondary"
          icon={<RefreshCw size={15} aria-hidden="true" />}
          disabled={pending}
          onClick={onRefresh}
          className="min-h-[44px] text-xs"
        >
          طلّع رمز جديد
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={pending}
          onClick={onSimulatePair}
          className="min-h-[44px] text-xs"
        >
          جرّب إتمام المسح
        </Button>
      </div>
    </div>
  );
}
