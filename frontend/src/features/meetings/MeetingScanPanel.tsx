import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, CameraOff, CheckCircle2, QrCode, ScanLine, TriangleAlert, UserX } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { useLocale } from '../../i18n/useLocale';
import type { MarkAttendanceResult } from './types';

interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]> }
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function getDetectorCtor(): BarcodeDetectorCtor | null {
  const holder = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
  return typeof holder.BarcodeDetector === 'function' ? holder.BarcodeDetector : null;
}

interface Props {
  meetingTitle: string;
  disabled?: boolean;
  onMark: (code: string) => Promise<MarkAttendanceResult>;
  onMarked?: () => void;
}

type Feedback =
  | { tone: 'ok' | 'warn' | 'bad'; message: string }
  | null;

export function MeetingScanPanel({ meetingTitle, disabled, onMark, onMarked }: Props) {
  const { t } = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<number | null>(null);
  const lastCodeRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const detectorSupported = typeof window !== 'undefined' && getDetectorCtor() !== null;

  const stopCamera = () => {
    if (loopRef.current !== null) {
      window.clearTimeout(loopRef.current);
      loopRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOn(false);
  };

  useEffect(() => () => {
    if (loopRef.current !== null) window.clearTimeout(loopRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled, meetingTitle]);

  const describe = (result: MarkAttendanceResult) => {
    if (result.status === 'marked') {
      const name = result.member?.full_name ?? '—';
      const outside = result.expected === false ? t(' — مش من جمهور الاجتماع', ' — not in this meeting’s audience') : '';
      return { tone: 'ok' as const, message: t(`تم تسجيل حضور ${name}${outside}`, `${name} checked in${outside}`) };
    }
    if (result.status === 'duplicate') {
      return { tone: 'warn' as const, message: t(`${result.member?.full_name ?? 'العضو'} مسجل حضور قبل كده.`, `${result.member?.full_name ?? 'This member'} is already checked in.`) };
    }
    if (result.status === 'not_found') {
      return { tone: 'bad' as const, message: t(`مفيش عضو بالكود ${result.code ?? ''}. جرّب الرقم الأكاديمي يدوي.`, `No member matches ${result.code ?? 'that code'}. Try the academic number manually.`) };
    }
    if (result.status === 'cancelled') {
      return { tone: 'bad' as const, message: t('الاجتماع ملغي — مش بنسجل حضور.', 'This meeting is cancelled — check-in is closed.') };
    }
    return { tone: 'warn' as const, message: t('اكتب أو امسح كود الـQR الأول.', 'Enter or scan a QR code first.') };
  };

  const submitCode = async (raw: string) => {
    const value = raw.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      const result = await onMark(value);
      setFeedback(describe(result));
      setCode('');
      if (result.status === 'marked') onMarked?.();
    } catch (cause) {
      setFeedback({ tone: 'bad', message: cause instanceof Error ? cause.message : t('معرفناش نسجل الحضور.', 'Could not record attendance.') });
    } finally {
      setBusy(false);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitCode(code);
  };

  const startCamera = async () => {
    setCameraError('');
    const Detector = getDetectorCtor();
    if (!Detector) {
      setCameraError(t('المتصفح ده مش بيدعم قراءة QR بالكاميرا. استخدم إدخال الرقم الأكاديمي.', 'This browser cannot scan QR codes with the camera. Use the academic number instead.'));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setCameraOn(true);
      const detector = new Detector({ formats: ['qr_code'] });
      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const found = await detector.detect(videoRef.current);
          const raw = found[0]?.rawValue?.trim() ?? '';
          if (raw && !busy) {
            const now = Date.now();
            if (raw !== lastCodeRef.current.code || now - lastCodeRef.current.at > 4000) {
              lastCodeRef.current = { code: raw, at: now };
              await submitCode(raw);
            }
          }
        } catch {
          // إطار فاشل مش مشكلة — بنكمل الإطار اللي بعده.
        }
        loopRef.current = window.setTimeout(() => { void tick(); }, 350);
      };
      void tick();
    } catch {
      stopCamera();
      setCameraError(t('مقدرناش نفتح الكاميرا. اسمح بالوصول للكاميرا أو استخدم الإدخال اليدوي.', 'Could not open the camera. Allow camera access or use manual entry.'));
    }
  };

  const toneIcon = (() => {
    if (!feedback) return <ScanLine size={15} aria-hidden="true" />;
    if (feedback.tone === 'ok') return <CheckCircle2 size={15} aria-hidden="true" />;
    if (feedback.tone === 'bad') return <UserX size={15} aria-hidden="true" />;
    return <TriangleAlert size={15} aria-hidden="true" />;
  })();

  return (
    <section className="mtg-scan" aria-label={t('تسجيل الحضور بالـQR', 'QR check-in')}>
      <div className="mtg-scan-title">
        <span><QrCode size={16} aria-hidden="true" /> {t('سكان الحضور', 'Attendance scanner')}</span>
        <small>{t('امسح QR العضو أو اكتب رقمه الأكاديمي.', 'Scan the member QR or type the academic number.')}</small>
      </div>
      <form className="mtg-scan-form" onSubmit={submit}>
        <input
          ref={inputRef}
          className="mtg-scan-input"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder={t('الرقم الأكاديمي', 'Academic number')}
          inputMode="text"
          autoComplete="off"
          dir="ltr"
          aria-label={t('الرقم الأكاديمي أو كود الـQR', 'Academic number or QR code')}
          disabled={disabled || busy}
        />
        <Button type="submit" icon={<ScanLine size={16} aria-hidden="true" />} isLoading={busy} disabled={disabled || code.trim().length === 0}>
          {t('تسجيل', 'Check in')}
        </Button>
        {detectorSupported && (
          <Button type="button" variant="secondary" icon={cameraOn ? <CameraOff size={16} aria-hidden="true" /> : <Camera size={16} aria-hidden="true" />} onClick={() => (cameraOn ? stopCamera() : void startCamera())} disabled={disabled || busy}>
            {cameraOn ? t('قفل الكاميرا', 'Stop camera') : t('كاميرا', 'Camera')}
          </Button>
        )}
      </form>
      <div className={`mtg-scan-feedback${feedback ? ` mtg-scan-feedback--${feedback.tone}` : ''}`} role="status" aria-live="polite">
        {toneIcon}
        <span>{feedback?.message ?? t('جاهز للتسجيل — كل عملية بتتسجل باسم الوقت والطريقة.', 'Ready — every check-in stores its time and method.')}</span>
      </div>
      {cameraError && <p className="mtg-scan-feedback mtg-scan-feedback--warn" role="alert">{cameraError}</p>}
      {cameraOn && (
        <div className="mtg-scan-camera">
          <video ref={videoRef} muted playsInline aria-label={t('كاميرا السكان', 'Scanner camera')} />
          <p className="mtg-help">{t('وجّه الكاميرا ناحية كود الـQR — التسجيل تلقائي.', 'Point the camera at the QR code — check-in is automatic.')}</p>
        </div>
      )}
    </section>
  );
}