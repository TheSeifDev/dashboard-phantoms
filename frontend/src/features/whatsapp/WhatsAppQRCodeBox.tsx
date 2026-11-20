import { useEffect, useState } from 'react';
import { AlertCircle, Clock, RefreshCw, ShieldAlert } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '../../components/ui/Button';

import { useLocale } from '../../i18n/useLocale';
interface WhatsAppQRCodeBoxProps {
  qr: string;
  qrExpiresAt: string | null;
  pending: boolean;
  onRefresh: () => void;
  onSimulatePair: () => void;
}

export function WhatsAppQRCodeBox({ qr, qrExpiresAt, pending, onRefresh, onSimulatePair }: WhatsAppQRCodeBoxProps) {
  const { t, number, dir } = useLocale();
  const [secondsRemaining, setSecondsRemaining] = useState<number>(60);

  useEffect(() => {
    if (!qrExpiresAt) {
      setSecondsRemaining(60);
      return;
    }

    const update = () => {
      const remaining = (new Date(qrExpiresAt).getTime() - Date.now()) / 1000;
      setSecondsRemaining(Number.isFinite(remaining) ? Math.max(0, Math.floor(remaining)) : 0);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [qrExpiresAt]);

  const isExpired = secondsRemaining === 0;

  return (
    <div className="grid w-full justify-items-center gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-3 sm:p-5" dir={dir}>
      <div className="flex w-full max-w-md items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-start text-xs leading-5 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100" role="note" aria-label={t('حماية رمز الربط', 'Protect your linking code')}>
        <ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <p><strong>{t('رمز مؤقت وحساس.', 'Temporary, sensitive code.')}</strong> {t('ما تشاركوش أو تصوّروش. امسحه فقط من تطبيق واتساب على هاتف تملكه.', 'Do not share or screenshot it. Scan it only in WhatsApp on a phone you control.')}</p>
      </div>

      <div className="grid w-full max-w-sm justify-items-center gap-3 rounded-2xl border border-[var(--border)] bg-white p-4 text-center shadow-sm">
        <div className="grid min-h-[210px] w-full place-items-center rounded-xl bg-white p-1">
          {isExpired ? (
            <div aria-hidden="true" className="size-[210px] max-w-full bg-white" />
          ) : (
            <QRCodeSVG
              value={qr}
              size={210}
              level="M"
              role="img"
              aria-label={t('رمز QR مؤقت وسري لربط واتساب', 'Temporary private QR code for linking WhatsApp')}
              className="h-auto w-full max-w-[210px]"
            />
          )}
        </div>

        {isExpired ? (
          <div role="status" aria-live="polite" className="grid justify-items-center gap-2 rounded-xl bg-slate-950/90 p-4 text-white">
            <AlertCircle size={28} className="text-amber-400" aria-hidden="true" />
            <p className="text-sm font-extrabold text-amber-200">{t('انتهت صلاحية الرمز', 'QR code expired')}</p>
            <p className="text-xs text-slate-200">{t('لم يعد الرمز ظاهرًا أو قابلًا للمسح. اطلب رمزًا جديدًا للمتابعة.', 'The code is no longer shown or scannable. Request a new one to continue.')}</p>
            <Button
              type="button"
              variant="primary"
              icon={<RefreshCw size={15} aria-hidden="true" />}
              disabled={pending}
              isLoading={pending}
              loadingText={t('جارٍ تحديث الرمز…', 'Refreshing code…')}
              onClick={onRefresh}
              className="mt-1 min-h-11 text-xs"
            >
              {t('تحديث رمز الربط', 'Refresh linking code')}
            </Button>
          </div>
        ) : (
          <div role="timer" aria-live="off" aria-label={t(`متبقي ${number(secondsRemaining)} ثانية على انتهاء رمز الربط`, `${number(secondsRemaining)} seconds until the linking code expires`)} className="flex flex-wrap items-center justify-center gap-2 rounded-full bg-[var(--surface-2)] px-3 py-2 text-xs font-bold text-[var(--text-2)]">
            <Clock size={15} className="text-[var(--primary-ink)]" aria-hidden="true" />
            <span>{t('تنتهي صلاحية الرمز خلال', 'Code expires in')} <bdi>{number(secondsRemaining)}</bdi> {t('ثانية', 'seconds')}</span>
          </div>
        )}

        <p className="text-xs leading-5 text-[var(--text-2)]">
          {t('من تطبيق واتساب على هاتفك: افتح', 'In WhatsApp on your phone, open')} <strong>{t('الأجهزة المرتبطة ← ربط جهاز', 'Linked devices → Link a device')}</strong> {t('ثم امسح الرمز.', 'then scan the code.')}
        </p>

        <div className="grid w-full gap-2 border-t border-slate-200 pt-3 sm:grid-cols-2">
          <Button
            type="button"
            variant="secondary"
            icon={<RefreshCw size={15} aria-hidden="true" />}
            disabled={pending}
            onClick={onRefresh}
            className="min-h-11 text-xs"
            fullOnMobile
          >
            {t('طلب رمز جديد', 'Request a new code')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={pending || isExpired}
            onClick={onSimulatePair}
            className="min-h-11 text-xs"
            fullOnMobile
          >
            {t('محاكاة اكتمال المسح', 'Simulate scan completion')}
          </Button>
        </div>
      </div>
    </div>
  );
}
