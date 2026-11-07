# دليل نشر التحصين الأمني (P0) — Wasla Tech v2

> **من هذا الدليل؟** خطوات تطبيق التحصين الأمني على قاعدة بيانات Supabase حقيقية موجودة.
> الوقت المتوقع: **10 دقائق**. المخاطر: صفر على البيانات (الملف لا يحذف أي صف أو جدول).

---

## أي ملف أشغّل؟

| حالتك | الملف |
|---|---|
| قاعدة البيانات رُكّبت سابقاً من النسخة القديمة `supabase_setup.sql` | `backend/migrations/0001_security_hardening.sql` |
| تركيب جديد من الصفر على مشروع Supabase فارغ | `backend/supabase_setup.sql` (النسخة الجديدة المُحصَّنة) |

---

## خطوات النشر

### 1) طبّق الترحيل في Supabase SQL Editor

1. افتح لوحة تحكم Supabase → مشروعك → **SQL Editor**.
2. انسخ كامل محتوى `backend/migrations/0001_security_hardening.sql` والصقه، ثم **Run**.
3. الملف متسامح مع الإعادة (idempotent): تشغيله مرتين بأخطاء `DROP POLICY IF EXISTS` الأمنة لا يفسد شيئاً.

### 2) تدوير مفتاح Groq (إلزامي)

> **لماذا؟** الدالة القديمة `get_groq_key_from_vault` كانت متاحة **لأي زائر عبر PostgREST**
> (`/rpc/get_groq_key_from_vault` بمفتاح anon العام!). اعتبر المفتاح الحالي مكشوفاً.

1. أنشئ مفتاحاً جديداً من لوحة Groq (أو أعد توليد الحالي).
2. في **SQL Editor** نفّذ (الهوية هنا postgres المديرة — مسموح لها):

```sql
SELECT public.set_groq_key('ضع_المفتاح_الجديد_هنا');

-- للتحقق يُعاد المفتاح:
SELECT public.get_groq_key_from_vault();
```

3. لا تضع المفتاح في أي ملف داخل المستودع إطلاقاً — الـ Vault فقط.

### 3) أعد نشر الـ Edge Function

الوظيفة `wasla-ai` تعُدِّلَت لتقرأ المفتاح بهوية **service_role** (لأن الوصول عبر
authenticated/anon أُغلق في الخطوة 1). بدون إعادة النشر **سيتوقف المساعد الذكي**.

```bash
supabase functions deploy wasla-ai
```

- اختياري (يُوصى به بعد امتلاك نطاق النشر): حدد المصدر المسموح:

```bash
supabase secrets set WASLA_ALLOWED_ORIGINS=https://موقعك.com
supabase functions deploy wasla-ai
```

بدون هذا المتغير تُقبل أي جهة (فترة الانتقال فقط — مدرجة في المرحلة 3 للقفل).

---

## فحوصات التحقق

### أ) داخل SQL Editor — اتصل دور anon ومحاولات سلوكه

```sql
-- 1. anon يجب أن يرى الأعمدة العامة فقط: هذا الاستعلام ينجح
BEGIN; SET LOCAL ROLE anon;
SELECT id, full_name, device FROM members LIMIT 5;
ROLLBACK;

-- 2. anon يحاول قراءة الهاتف/الإقامة: يجب أن يفشل (permission denied)
BEGIN; SET LOCAL ROLE anon;
SELECT phone FROM members LIMIT 1;
ROLLBACK;

-- 3. anon يحاول اعتماد مهمة: يجب أن يفشل بـ ADMIN_APPROVAL_FORBIDDEN
BEGIN; SET LOCAL ROLE anon;
UPDATE tasks
SET tracking = '{"1": {"status": "approved"}}'::jsonb
WHERE id = (SELECT min(id) FROM tasks);
ROLLBACK;

-- 4. anon يسلّم مهمته للمراجعة: يجب أن ينجح (هذا مسموح)
BEGIN; SET LOCAL ROLE anon;
UPDATE tasks
SET tracking = tracking || '{"1": {"status": "under_review", "submission_url": "https://x.com"}}'::jsonb
WHERE id = (SELECT min(id) FROM tasks);
ROLLBACK;

-- 5. CORS اختبار caller مع مفتاح anon عام: يجب أن يرفض المفتاح
-- نفّذها من Terminal (استبدل القيمتين):
-- curl -s -o /dev/null -w "%{http_code}\n" \
--   "$SUPABASE_URL/rest/v1/rpc/get_groq_key_from_vault" \
--   -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
--   -X POST -d '{}'
-- النتيجة المتوقعة: 404 أو 42501 — وليست 200.
```

> ملاحظة عن الفحص 3 و4 داخل نفس الـ SQL Editor: إذا كان لديك مهام كثيرة، افتح
> محرراً UTF-8 يدعم العربية لإعادة النسخ. لا تستخدم Notepad القديم.

### ب) من المتصفح (تطبيق البوابة)

| # | الفحص | النتيجة المتوقعة |
|---|---|---|
| 1 | دخول الإدارة ببيانات صحيحة | يعمل كالمعتاد |
| 2 | دخول الإدارة ببيانات خاطئة | رسالة خطأ عربية |
| 3 | دخول عضو ببريد مسجل | يعمل كالمعتاد |
| 4 | دخول عضو ببريد غير مسجل | «هذا البريد غير مسجل...» |
| 5 | دخول عضو ببريد يحتوي `%` | **لا** يطابق أحداً (سابقاً كان يفتح أول عضو!) |
| 6 | تسليم مهمة من بوابة العضو | يتحول إلى «قيد المراجعة» |
| 7 | محاولة العضو اعتماد نفسه عبر أدوات المتصفح | مرفوض من الخادم (Trigger) |
| 8 | زر «دخول تجريبي» في بناء الإنتاج | **غير ظاهر** إطلاقاً (dev فقط) |
| 9 | قطع الإنترنت ثم تحديث الصفحة | رسالة خطأ/حالة صادقة — لا بيانات وهمية |

### ج) سلوك متغيّر **بقصد** (راجعه مع الفريق)

- **زر تبديل جاهزية الإسكندرية من بوابة العضو**: سيفشل الآن برسالة صريحة، لأن anon لا
  يملك `UPDATE` على جدول members — الأمان الجديد أغلق باب تعديل العضو لبياناته نفسه
  (نفس الاسم كان أيضاً يسمح له بتعديل نسبة إنجازه!). تنفيذ بديل آمن (Magic Link) مدرج
  في المرحلة 3.

---

## تفريع الصلاحيات الجديد (مرجع سريع)

| الدور | members | tasks | notes | دوال Vault |
|---|---|---|---|---|
| authenticated (الإدارة) | الكل | الكل | الكل | لا وصول |
| anon (بوابة الأعضاء) | قراءة الأعمدة العامة فقط؛ **صفر كتابة** | قراءة الكل + تحديث عمود `tracking` فقط (لا اعتماد) | قراءة فقط | لا وصول |
| service_role (الـ Edge فقط) | — | — | — | تنفيذ set/get |

---

## التراجع (Rollback)

الملف لا يدعم التراجع الآلي — لكن كل شيء قابل للعكس يدوياً:

```sql
-- إعادة صلاحيات الكتابة القديمة لجمهور anon (لا تفعل إلا لسبب قاهر):
GRANT ALL ON public.members, public.tasks, public.notes TO anon;
DROP TRIGGER IF EXISTS trg_tasks_guard_anon ON public.tasks;
```

> لا تفعّل هذا التراجع — هو يعيد كل الثغرات الأربع. موجود هنا للتوثيق فقط.
