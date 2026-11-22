import { useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Minus, Star } from 'lucide-react';
import { useLocale } from '../../i18n/useLocale';

const MAX_STARS = 5;

interface DisplayProps {
  /** عدد النجوم المكتسبة في هذا التقييم (قد يتجاوز ٥ في بيانات قديمة). */
  value: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** نص بديل يُقرأ لقارئ الشاشة. */
  label?: string;
}

/**
 * عرض ثابت للنجوم الذهبية: ٥ نجوم كحد أقصى للصف، وأي زيادة تُختصر في شارة +N.
 */
export function EvalStars({ value, size = 'md', className = '', label }: DisplayProps) {
  const { t, number } = useLocale();
  const filled = Math.max(0, Math.min(MAX_STARS, Math.round(value)));
  const extra = Math.max(0, Math.round(value) - MAX_STARS);
  const classes = ['eval-stars', size === 'sm' ? 'eval-stars--sm' : size === 'lg' ? 'eval-stars--lg' : '', className]
    .filter(Boolean)
    .join(' ');

  if (filled <= 0 && extra === 0) {
    return <span className="eval-stars-empty">{t('بدون نجوم', 'No stars')}</span>;
  }

  return (
    <span className={classes} role="img" aria-label={label ?? t(`${number(value)} من النجوم الذهبية`, `${number(value)} golden stars`)}>
      {Array.from({ length: MAX_STARS }, (_, index) => (
        <Star
          key={index}
          aria-hidden="true"
          className={`eval-star-glyph ${index < filled ? 'eval-star-glyph--on' : 'eval-star-glyph--off'}`}
        />
      ))}
      {extra > 0 && <span className="eval-star-extra">+{number(extra)}</span>}
    </span>
  );
}

interface InputProps {
  /** ٠ تعني بدون نجوم، و١–٥ عدد النجوم الممنوحة في هذا التقييم. */
  value: number;
  onChange: (next: number) => void;
  label: string;
  describedBy?: string;
}

/**
 * اختيار النجوم الذهبية من ١ إلى ٥ (radiogroup) مع معاينة عند المرور،
 * ودعم الأسهم و Home/End مع مراعاة اتجاه الصفحة.
 */
export function EvalStarInput({ value, onChange, label, describedBy }: InputProps) {
  const { t, number, dir } = useLocale();
  const [preview, setPreview] = useState(0);
  const groupRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const active = preview || value;

  const focusStar = (index: number) => {
    const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>('.eval-star-btn');
    buttons?.[index]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const backward = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    let next: number | null = null;
    if (event.key === forward || event.key === 'ArrowDown') next = Math.min(MAX_STARS, (value || 0) + 1);
    else if (event.key === backward || event.key === 'ArrowUp') next = Math.max(1, (value || 1) - 1);
    else if (event.key === 'Home') next = 1;
    else if (event.key === 'End') next = MAX_STARS;
    if (next === null) return;
    event.preventDefault();
    onChange(next);
    setPreview(0);
    focusStar(next - 1);
  };

  return (
    <div className="eval-star-input">
      <div
        ref={groupRef}
        className="eval-star-track"
        role="radiogroup"
        aria-label={label}
        aria-describedby={describedBy}
        onKeyDown={handleKeyDown}
        onMouseLeave={() => setPreview(0)}
      >
        {Array.from({ length: MAX_STARS }, (_, index) => {
          const starNumber = index + 1;
          const on = starNumber <= active;
          const checked = starNumber === value;
          return (
            <button
              key={starNumber}
              type="button"
              role="radio"
              id={`${id}-${starNumber}`}
              aria-checked={checked}
              tabIndex={checked || (value === 0 && starNumber === 1) ? 0 : -1}
              aria-label={t(`${number(starNumber)} نجمة`, `${number(starNumber)} star${starNumber > 1 ? 's' : ''}`)}
              className={`eval-star-btn ${on ? 'eval-star-btn--on' : ''} ${preview && starNumber > value ? 'eval-star-btn--preview' : ''}`}
              onMouseEnter={() => setPreview(starNumber)}
              onFocus={() => setPreview(starNumber)}
              onBlur={() => setPreview(0)}
              onClick={() => {
                onChange(starNumber);
                setPreview(0);
              }}
            >
              <Star aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="eval-star-clear"
        aria-pressed={value === 0}
        onClick={() => onChange(0)}
      >
        {t('بدون نجوم', 'No stars')}
      </button>
    </div>
  );
}

/**
 * اختيار خصم النجوم (نجوم بالسالب): ١ إلى ٥ نجوم تُخصم من رصيد العضو.
 * نفس سلوك النجوم الذهبية في الكيبورد، لكن الأيقونة نجمة عليها علامة سالب.
 */
export function EvalMinusInput({ value, onChange, label, describedBy }: InputProps) {
  const { t, number, dir } = useLocale();
  const [preview, setPreview] = useState(0);
  const groupRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const active = preview || value;

  const focusStar = (index: number) => {
    const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>('.eval-minus-btn');
    buttons?.[index]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const backward = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    let next: number | null = null;
    if (event.key === forward || event.key === 'ArrowDown') next = Math.min(MAX_STARS, (value || 0) + 1);
    else if (event.key === backward || event.key === 'ArrowUp') next = Math.max(1, (value || 1) - 1);
    else if (event.key === 'Home') next = 1;
    else if (event.key === 'End') next = MAX_STARS;
    if (next === null) return;
    event.preventDefault();
    onChange(next);
    setPreview(0);
    focusStar(next - 1);
  };

  return (
    <div className="eval-star-input">
      <div
        ref={groupRef}
        className="eval-star-track eval-minus-track"
        role="radiogroup"
        aria-label={label}
        aria-describedby={describedBy}
        onKeyDown={handleKeyDown}
        onMouseLeave={() => setPreview(0)}
      >
        {Array.from({ length: MAX_STARS }, (_, index) => {
          const starNumber = index + 1;
          const on = starNumber <= active;
          const checked = starNumber === value;
          return (
            <button
              key={starNumber}
              type="button"
              role="radio"
              id={`${id}-minus-${starNumber}`}
              aria-checked={checked}
              tabIndex={checked || (value === 0 && starNumber === 1) ? 0 : -1}
              aria-label={t(`خصم ${number(starNumber)} نجمة`, `Deduct ${number(starNumber)} star${starNumber > 1 ? 's' : ''}`)}
              className={`eval-star-btn eval-minus-btn ${on ? 'eval-minus-btn--on' : ''}`}
              onMouseEnter={() => setPreview(starNumber)}
              onFocus={() => setPreview(starNumber)}
              onBlur={() => setPreview(0)}
              onClick={() => {
                onChange(starNumber);
                setPreview(0);
              }}
            >
              <Star aria-hidden="true" />
              <Minus className="eval-minus-mark" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { MAX_STARS };
