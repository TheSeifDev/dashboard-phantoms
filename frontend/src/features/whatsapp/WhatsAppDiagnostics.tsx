import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, CheckCircle2, AlertTriangle, XCircle, Copy, RefreshCw, PlugZap } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { supabase } from '../../lib/supabase/client';
import { toast } from '../../store/toast';
import { getBridgeDiagnostics, getBridgeUrl, BRIDGE_MISCONFIGURED_MESSAGE, type BridgeDiagnostics, type DiagCheck } from './api';

import { useLocale } from '../../i18n/useLocale';
const STATUS_META: Record<DiagCheck['status'], { icon: typeof CheckCircle2; label: string; chip: string }> = {
  ok: { icon: CheckCircle2, label: 'سليم', chip: 'bg-[var(--success-soft)] text-[var(--success-text)] dark:text-[var(--success-text)]' },
  warn: { icon: AlertTriangle, label: 'تحذير', chip: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  fail: { icon: XCircle, label: 'عطل', chip: 'bg-[var(--danger-soft)] text-[var(--danger-text)] dark:text-[var(--danger-text)]' },
};

const CATEGORY_LABELS: Record<DiagCheck['category'], string> = {
  env: 'إعدادات الخادم',
  network: 'الشبكة',
  auth: 'تسجيل الدخول',
  service: 'الخدمة',
  cloud: 'السحابة الرسمية',
};

function verdict(data: BridgeDiagnostics | undefined, t: (arabic: string, english: string) => string): string {
  if (!data) return '';
  const firstFail = data.checks.find((c) => c.status === 'fail');
  if (!firstFail) {
    return data.summary.warns > 0
      ? t('الجسر شغال — فيه تحذيرات بسيطة تحت.', 'The bridge is running, with some warnings below.')
      : t('كل الفحوصات تمام — الجسر جاهز للربط والإرسال.', 'All checks passed — the bridge is ready to connect and send.') ;
  }
  return t(`أقرب سبب للعطل: ${firstFail.label} — ${firstFail.detail}`, `Likely cause: ${firstFail.label} — ${firstFail.detail}`);
}

export default function WhatsAppDiagnostics() {
  const { t, dir, number, date } = useLocale();
  const [sessionOk, setSessionOk] = useState<boolean | null>(null);
  const queryKey = ['whatsapp-diagnostics'];
  const bridgeUrl = getBridgeUrl();
  const diag = useQuery({
    queryKey,
    queryFn: async () => {
      if (!bridgeUrl) throw new Error(BRIDGE_MISCONFIGURED_MESSAGE);
      const { data } = await supabase.auth.getSession();
      setSessionOk(Boolean(data.session?.access_token));
      return getBridgeDiagnostics();
    },
    retry: false,
  });

  const copyReport = async () => {
    if (!diag.data) return;
    const lines = [
      t(`تقرير فحص جسر واتساب — ${date(diag.data.generatedAt, { dateStyle: 'medium', timeStyle: 'short' })} (وضع ${diag.data.mode})`, `WhatsApp bridge diagnostics — ${date(diag.data.generatedAt, { dateStyle: 'medium', timeStyle: 'short' })} (mode ${diag.data.mode})`),
      t(`الملخص: ${diag.data.summary.total} فحص — أعطال ${diag.data.summary.fails} — تحذيرات ${diag.data.summary.warns}`, `Summary: ${number(diag.data.summary.total)} checks — ${number(diag.data.summary.fails)} failures — ${number(diag.data.summary.warns)} warnings`),
      '',
      ...diag.data.checks.map((c) => `[${t(c.status === 'ok' ? 'سليم' : c.status === 'warn' ? 'تحذير' : 'عطل', c.status === 'ok' ? 'OK' : c.status === 'warn' ? 'Warning' : 'Failure')}] ${c.label}: ${c.detail}${c.fix ? ` | ${t('الحل:', 'Fix:')} ${c.fix}` : ''}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast.success(t('التقرير اتنسخ — مفيهوش أي أسرار.', 'Report copied — it contains no secrets.'));
    } catch {
      toast.error(t('منعرفناش ننسخ من المتصفح.', 'Could not copy from the browser.'));
    }
  };

  return (
    <section className="grid gap-4" dir={dir}>
      <header className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--primary-soft)] text-[var(--link)]">
          <Activity />
        </span>
        <div>
          <h2 className="text-[var(--fs-xl)] font-black">{t("فحص الجسر بالتفصيل", "Detailed bridge diagnostics")}</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {t('بيفحص كل طبقة (إعدادات، شبكة، تسجيل دخول، خدمة، سحابة) وبيحدد السبب بدقة — التقرير مفيهوش أي أسرار.', 'Checks each layer (configuration, network, sign-in, service, cloud) to pinpoint issues. The report contains no secrets.')}
          </p>
        </div>
      </header>

      <Card className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-2 text-sm font-bold text-[var(--text-2)]">
          <PlugZap size={16} aria-hidden="true" />
          {bridgeUrl
            ? <span dir="ltr">{bridgeUrl}</span>
            : <span className="text-[var(--danger)]">{BRIDGE_MISCONFIGURED_MESSAGE}</span>}
        </span>
        <span className="text-xs text-[var(--text-muted)]">
          {t("جلسة الإدارة:", "Admin session:")} {sessionOk === null ? '…' : sessionOk ? t('موجودة', 'Present') : t('مش موجودة — سجّل الدخول', 'Missing — sign in')}
        </span>
        <span className="ms-auto flex gap-2">
          <Button variant="secondary" onClick={() => void diag.refetch()} isLoading={diag.isFetching} loadingText={t('بنَفحص...', 'Checking...')} icon={<RefreshCw size={16} />}>
            {t('افحص تاني', 'Check again')}
          </Button>
          <Button variant="secondary" onClick={() => void copyReport()} disabled={!diag.data} icon={<Copy size={16} />}>
            {t('نسخ التقرير', 'Copy report')}
          </Button>
        </span>
      </Card>

      {diag.isPending ? (
        <Card><p className="text-sm text-[var(--text-muted)]" role="status">{t('بنَفحص الجسر…', 'Checking the bridge…')}</p></Card>
      ) : diag.isError ? (
        <Card>
          <p role="alert" className="flex items-start gap-2 text-sm font-bold text-[var(--danger)]">
            <XCircle size={18} className="mt-0.5 shrink-0" />
            {t('منقدرناش نوصل للجسر:', 'Could not reach the bridge:')} {diag.error.message}
          </p>
          <ul className="mt-3 grid gap-1.5 text-sm leading-6 text-[var(--text-2)]">
            <li>• {t('لو الرسالة عن اتصال مرفوض: الجسر مطفي — شغّله على نفس العنوان اللي فوق.', 'If the error says the connection was refused, the bridge is stopped — start it at the URL above.')}</li>
            <li>• {t('لو كانت 401: الجسر شغال بس من غير مفاتيح تحقق — راجع `.env.local` وشغّله تاني.', 'For 401: the bridge is running without verification credentials — check `.env.local` and restart it.')}</li>
            <li>• {t('لو كانت 403: جلستك صالحة بس إيميلك مش ضمن مديري الجسر.', 'For 403: your session is valid, but your email is not listed as a bridge administrator.')}</li>
          </ul>
        </Card>
      ) : diag.data ? (
        <>
          <Card className={diag.data.summary.fails > 0 ? 'border-[var(--danger-border)]' : 'border-[var(--success-border)]'}>
            <p className="text-sm font-black leading-7">{verdict(diag.data, t)}</p>
          </Card>
          {(Object.keys(CATEGORY_LABELS) as Array<DiagCheck['category']>).map((cat) => {
            const items = diag.data?.checks.filter((c) => c.category === cat) ?? [];
            if (items.length === 0) return null;
            return (
              <Card key={cat} className="grid gap-3">
                <h3 className="font-black text-[var(--text)]">{t(CATEGORY_LABELS[cat], ({ env: 'Server configuration', network: 'Network', auth: 'Sign-in', service: 'Service', cloud: 'Official cloud' } as const)[cat])}</h3>
                <ul className="grid gap-2">
                  {items.map((check) => {
                    const meta = STATUS_META[check.status];
                    const Icon = meta.icon;
                    return (
                      <li key={check.id} className="grid gap-1 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
                        <p className="flex items-center gap-2 font-bold">
                          <Icon size={17} aria-hidden="true" />
                          {check.label}
                          <span className={`ms-auto rounded-full px-2 py-0.5 text-xs font-black ${meta.chip}`}>{t(meta.label, ({ ok: 'OK', warn: 'Warning', fail: 'Failure' } as const)[check.status])}</span>
                        </p>
                        <p className="text-sm leading-6 text-[var(--text-2)]">{check.detail}</p>
                        {check.fix && <p className="text-sm leading-6 font-bold text-[var(--link)]">{t('الحل:', 'Fix:')} {check.fix}</p>}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </>
      ) : null}
    </section>
  );
}
