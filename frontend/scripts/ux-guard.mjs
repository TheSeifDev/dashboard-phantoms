/**
 * UX Guard — يمنع انتكاس قواعد تجربة المستخدم والأبعاد.
 * جوجل-ستايل: القاعدة التي لا يحرسها فحص آلي ستُكسر.
 *
 * الممنوعات (باستثناءات موثقة داخل الملف نفسه عند الحاجة):
 *  1. alert( / confirm( — استخدم toast المركزي + Modal الموحد
 *  2. min-w-[Npx] — عروض ثابتة بالبكسل؛ استخدم نظام .data-table
 *     المتجاوب أو max-w بالتوكنز
 *  3. لوحات gray/blue الخام (bg-gray-*, text-gray-*, border-gray-*,
 *     *-blue-*) — تكسر الدارك مود؛ استخدم توكنز [var(--*)]
 *  4. ألوان hex ثابتة في className (bg-[#...]) — استخدم التوكنز
 *     (مسموح داخل style={{}} للقيم الديناميكية المحسوبة فقط)
 *
 * الاستخدام: npm run ux:guard
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

const RULES = [
  {
    name: 'no-alert-confirm',
    pattern: /\b(alert|confirm)\s*\(/,
    message: 'استخدم toast المركزي (src/store/toast.ts) و Modal الموحد بدل alert/confirm',
    // ملفات مسموحة: لا شيء
    allowIn: [],
  },
  {
    name: 'no-fixed-min-width',
    pattern: /min-w-\[\d{3,}px\]/,
    message: 'عرض ثابت كبير بالبكسل — استخدم نظام .data-table المتجاوب (src/styles/tables.css). حد اللمس 44px مسموح.',
    allowIn: [],
  },
  {
    name: 'no-raw-gray-palette',
    // يستثني slate-950/xx: طبقات التعتيم (scrim) سوداء في الثيمين عمداً — مثل Material
    pattern: /(bg|text|border|ring|divide|placeholder|accent)-(?!slate-950\/)(gray|slate|zinc|neutral|stone)-\d+/,
    message: 'لوحة رمادية خام تكسر الدارك مود — استخدم توكنز [var(--surface)] / [var(--text-muted)] / [var(--border)]',
    // الاستثناءات الموثقة:
    // - ميداليات المنصة بألوان معدنية مقصودة (ذهبي/فضي/برونزي)
    // - صندوق QR أبيض ثابت عمداً (تباين المسح الضوئي)
    allowIn: ['features/ranking/RankingTable.tsx', 'features/ranking/RankingPodium.tsx', 'features/dashboard/DashboardWidgets.tsx', 'features/whatsapp/WhatsAppQRCodeBox.tsx'],
  },
  {
    name: 'no-raw-blue-palette',
    pattern: /(bg|text|border|ring|accent)-(blue|sky|indigo)-\d+/,
    message: 'لوحة زرقاء خام خارج الهوية — استخدم [var(--primary)] / [var(--link)] / [var(--primary-soft)]',
    // سطح QR أبيض ثابت عمداً (تباين المسح) — لا يُمس
    allowIn: ['features/whatsapp/WhatsAppQRCodeBox.tsx'],
  },
  {
    name: 'no-hardcoded-hex-class',
    pattern: /(bg|text|border)-\[#[0-9a-fA-F]{3,8}\]/,
    message: 'لون hex ثابت في className — استخدم توكنز [var(--*)] أو style للقيم الديناميكية',
    allowIn: [],
  },
];

function collect(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      collect(full, out);
    } else if (['.ts', '.tsx', '.css'].includes(extname(full))) {
      out.push(full);
    }
  }
  return out;
}

let failures = 0;
for (const file of collect(SRC)) {
  const rel = file.split(/src[\\/]/).pop().replace(/\\/g, '/');
  const content = readFileSync(file, 'utf8');
  for (const rule of RULES) {
    if (rule.allowIn.some((suffix) => rel.endsWith(suffix))) continue;
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      if (rule.pattern.test(line)) {
        failures++;
        console.error(`[ux-guard:${rule.name}] ${rel}:${i + 1}\n  ${line.trim()}\n  → ${rule.message}\n`);
      }
    });
  }
}

if (failures > 0) {
  console.error(`UX Guard: ${failures} مخالفة — راجع القواعد أعلاه.`);
  process.exit(1);
}
