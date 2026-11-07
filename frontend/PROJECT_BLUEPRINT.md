# Project Blueprint v2 — Wasla Tech Administration System

> الهدف: نظام إدارة فريق وصلة، مبني على React + TypeScript + Vite، يحافظ على **الهوية البصرية الأصلية 100%** وينهي فوضى الملف الواحد (Spaghetti) نهائياً.

---

## 1. سبب فشل المحاولة الأولى (درس مكتسب)

المحاولة السابقة ارتكبت خطأين معماريين:
1. **إعادة اختراع التصميم بـ Tailwind**: أنتجت واجهة "قالب جاهز" بلا روح، وأضاعت الألوان واللوجو والهوية المخصصة لمشروع وصلة.
2. **تبني ملف CSS ضخم ككتلة واحدة**: نسخ `style.css` (3800 سطر) كما هو يعيد إنتاج الفوضى ولو داخل مشروع حديث.

**التصحيح الجوهري:** الفوضى (Spaghetti) ليست في `style.css` — هذا م_layer تنسيق سليم. الفوضى الحقيقية في `index.html` (3877 سطر) الذي يخلط HTML + 2000+ سطر JavaScript مضمّن في ملف واحد. **الـ Refactor الحقيقي هو فصل هذا الملف إلى مكونات صغيرة، مع الإبقاء على layer التنسيق كما هو.**

---

## 2. Tech Stack (مثبتة بالفعل)

| الطبقة | التقنية | السبب |
|---|---|---|
| Framework | React 18 + TypeScript | أمان الأنواع (Type Safety) = أقل أخطاء عند التوسع |
| Build | Vite 8 | سرعة فائقة في التطوير (HMR) |
| Styling | **CSS الأصلي (design tokens) + Tailwind v4 (layout utilities فقط)** | الحفاظ على الهوية + أدوات تخطيط نظيفة |
| Routing | React Router v7 | فصل حقيقي للصفحات بدل `display:none` |
| State | Zustand | حالة بسيطة (المستخدم، الثيم) بدون boilerplate |
| Data | Supabase JS v2 | قاعدة البيانات والمصادقة |
| Icons | Font Awesome 6.5 (CDN) | مطابق للأصل |

---

## 3. هيكل المشروع (Feature-Sliced Architecture)

كل ميزة في مجلد مستقل، كل ملف صغير (≤ 200 سطر). هذا يضمن أن إضافة 100 ميزة لا تحول أي ملف إلى وحش.

```
wasla-v2/
├── public/
│   ├── icons/icon-192.png, icon-512.png
│   ├── manifest.json
│   └── wasla-logo.png
├── src/
│   ├── main.tsx              # نقطة الدخول (Bootstrap + QueryClient)
│   ├── App.tsx               # RouterProvider فقط
│   ├── index.css             # @import design tokens + tailwind فقط
│   │
│   ├── lib/
│   │   └── supabase/
│   │       └── client.ts     # عميل Supabase (env-driven)
│   │
│   ├── types/
│   │   └── db.ts             # أنواع الجداول (Member, Task, Note)
│   │
│   ├── store/
│   │   └── auth.ts           # Zustand: المستخدم + الثيم
│   │
│   ├── router/
│   │   └── index.tsx         # تعريف المسارات + حارس الحماية
│   │
│   ├── components/
│   │   ├── ui/               # أزرار/حقول/بطاقات قابلة لإعادة الاستخدام
│   │   └── layout/           # Sidebar, Topbar, MobileBottomNav
│   │
│   ├── hooks/                # useMembers, useTasks, useNotes (React Query لاحقاً)
│   │
│   └── features/             # ← كل ميزة معزولة
│       ├── auth/             # LoginPage
│       ├── dashboard/        # DashboardPage + widgets
│       ├── members/          # MembersPage, MembersTable, MemberModal
│       ├── tasks/            # TasksPage, TaskCard, TaskModal
│       ├── ranking/          # RankingPage
│       ├── notes/            # NotesPage
│       ├── ai-assistant/     # AiAssistantPage
│       └── shared/           # مكونات مشتركة بين الميزات
```

**قاعدة صارمة:** أي ميزة جديدة → مجلد جديد تحت `features/`. لا يجوز وضع منطق ميزة في `components/` أو `lib/`.

---

## 4. Data Model (من supabase_setup.sql)

```ts
Member    { id, full_name, team, completion_rank, team_notes, residence, work_conditions,
            bio, phone, device, gender, meeting_attendance, work_status, can_go_alexandria }
Task      { id, title, description, has_deadline, deadline_date,
            assigned_to: jsonb, tracking: jsonb }
Note      { id, text, author, author_role, date, team, target_team,
            target_member_id, target_name }
```
RLS مفعل على الجداول الثلاثة، وصول كامل لـ `authenticated` فقط.

---

## 5. قواعد البناء الإلزامية (Build Rules)

- **MUST** كل ملف ≤ 200 سجراً (سطر). تجاوزها = تقسيم لمجلد.
- **MUST** استخدام TypeScript types من `types/db.ts` لكل بيانات. يُمنع `any`.
- **MUST** الثيم عبر `data-theme="dark"` على `<html>` (مطابق للأصل).
- **MUST NOT** تكرار أي CSS. المتغيرات (`--primary` إلخ) هي المصدر الوحيد للألوان.
- **MUST NOT** دمج HTML مع منطق الجلب في نفس المكون. الجلب في `hooks/`، العرض في `features/`.
- **ALWAYS** RTL: `dir="rtl"` على `<html>`، والخط IBM Plex Sans Arabic.
- **NEVER** رفع أي شيء لـ GitHub حتى تنتهي مرحلة الاختبار المحلي.

---

## 6. خطة التنفيذ (مرحلة مرحلة)

| # | المرحلة | المخرجات | الحالة |
|---|---|---|---|
| 0 | تنظيف + هيكلة | مسح الفوضى، المجلدات، Blueprint v2 | ✅ |
| 1 | الأساس | supabase client, types, auth store, router, index.css | 🔄 |
| 2 | الهيكل العام | Sidebar + Topbar + MobileBottomNav + ProtectedRoute | ⬜ |
| 3 | المصادقة | LoginPage (بنفس تصميم ls-* الأصلي) | ⬜ |
| 4 | لوحة التحكم | DashboardPage + KPIs + widgets | ⬜ |
| 5 | الأعضاء | MembersPage + جدول + فلترة + Excel import/export | ⬜ |
| 6 | المهام | TasksPage + بطاقات + tracking | ⬜ |
| 7 | الترتيب | RankingPage | ⬜ |
| 8 | الملاحظات | NotesPage | ⬜ |
| 9 | المساعد الذكي | AiAssistantPage (ربط edge function) | ⬜ |
| 10 | PWA + الاختبار | service worker، اختبار شامل، ثم Git | ⬜ |

---

## 7. مخاطر مفتوحة

- مفاتيح Supabase غير موجودة في `.env` بعد — يجب توفير `VITE_SUPABASE_URL` و `VITE_SUPABASE_ANON_KEY` قبل مرحلة 5.
- المساعد الذكي يعتمد على `supabase/functions/wasla-ai/index.ts` (Groq) — يحتاج نشر مستقل.
