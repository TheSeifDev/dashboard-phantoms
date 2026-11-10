# خط الأساس الفني الجديد للمستودع — المرحلة 1.2
# PHANTOMS — Phase 1.2: New Technical Baseline Report

**تاريخ التوثيق:** 8 نوفمبر 2026  
**المرحلة:** Phase 1.2: Repository Reset Verification & New Baseline  
**مسار المشروع المحلي:** `C:\projects\phantoms\dashboard`  
**الهوية الحالية:** PHANTOMS Management System (v2)  
**الهوية المستهدفة:** PHANTOMS  
**القاعدة المعتمدة:** الملفات المحلية الحالية في مساحة العمل هي **المصدر الوحيد للحقيقة (New Source of Truth)** بعد إعادة ضبط سجل الالتزامات (Git Reset).

---

## 1. فحص الحالة الجنائية لـ Git (Git Repository Forensics)

بناءً على التوجيهات الصارمة بعدم استعادة السجل القديم المحذوف، تم فحص البنية الحالية للـ Git محلياً وعن بُعد:

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                           GIT FORENSIC SUMMARY                                │
├────────────────────────┬──────────────────────────────────────────────────────┤
│ فرع العمل الحالي       │ main                                                 │
│ معرف الالتزام الحالي   │ f8d04fd2836feabefb03a69ba9a9f3250e4ed0ec (HEAD)     │
│ حالة الفرع البعيد      │ origin/main يشير إلى 283f9ea (متأخر بـ 3 التزامات)   │
│ رابط المستودع البعيد   │ https://github.com/TheSeifDev/dashboard-phantoms.git │
│ إجمالي التزامات التاريخ│ 5 التزامات فقط (تم حرق السجل القديم بنجاح)           │
│ حالة شجرة الملفات      │ نظيفة بالكامل باستثناء تقرير التحقق 1.1 غير المتتبع  │
└────────────────────────┴──────────────────────────────────────────────────────┘
```

### 1.1 تسلسل سجل الالتزامات الحالي (Commit Graph)
```
f8d04fd (HEAD -> main) feat: implement spreadsheet security guard and AI assistant features
4846d44 feat: add security runtime integration and secure xlsx guard tests for members feature
e72ff78 feat: add Android APK build workflow, WhatsApp bridge, and member management features
283f9ea (tag: latest-apk, origin/main, origin/HEAD) Add tech stack and architecture documentation for the project
fc4d417 first commit
```

### 1.2 الفروقات الدقيقة بين الفرع المحلي والبعيد (`origin/main...main`)
- الفرع المحلي `main` متقدم عن `origin/main` بثلاث التزامات رئيسية تتضمن كافة التحصينات الأمنية والتقارير:
  * **45 ملفاً معدلاً أو مضافاً** (+5985 سطراً / -800 سطر).
  * يتضمن إضافة تقارير التدقيق الفني الأربعة السابقة.
  * يتضمن درع حماية جداول البيانات [`safeXlsxGuard.ts`](file:///C:/projects/phantoms/dashboard/frontend/src/features/members/safeXlsxGuard.ts).
  * يتضمن مخزن إدارة حذف الأعضاء [`memberDeletion.ts`](file:///C:/projects/phantoms/dashboard/frontend/src/store/memberDeletion.ts).
  * يتضمن الهجرة [`0022_dynamic_system_ownership.sql`](file:///C:/projects/phantoms/dashboard/backend/migrations/0022_dynamic_system_ownership.sql).
  * يتضمن حذف التبعية الميتة `exceljs` من خادم الـ Bridge (`backend/whatsapp-bridge`).
  * يتضمن فك تتبع ملف `backend/whatsapp-service/.env` من فهرس Git.

---

## 2. جرد المكونات المعمارية للمشروع (Project Architecture Inventory)

تم فحص سلامة ووجود كافة المكونات المعمارية الرئيسية على القرص المحلي:

```
dashboard/
├── .github/workflows/          # مسارات العمل المؤتمتة (deploy.yml, build-apk.yml)
├── audit/                      # سجلات التدقيق واللقطات والتقارير التوثيقية
│   └── reports/                # 12 تقريراً توثيقياً شاملاً
├── backend/
│   ├── migrations/             # 22 هجرة SQL لقاعدة بيانات Supabase PostgreSQL
│   ├── supabase/functions/     # 5 دوال حافة Deno Edge Functions
│   ├── whatsapp-bridge/        # خادم جسر الواتساب Baileys QR Bridge (Node/TS)
│   └── whatsapp-service/       # خادم Web-Push وواجهات واتساب (Express/TS)
├── docs/                       # مواصفات وخطط الميزات السابقة (superpowers)
├── frontend/                   # تطبيق الواجهة الأمامية الرئيسي (React 19, Vite, Tailwind v4)
│   ├── scripts/                # سكربتات التدقيق والأمان والفحص
│   └── src/                    # كود التطبيق المصدري المقسم حسب الميزات (Features)
├── legacy/                     # الأصول والأيقونات القديمة للمشروع السابق
└── specs/                      # المواصفات الفنية للتقنيات والبنية التحتية
```

---

## 3. التحقق من ملفات المعالجة للأمان (Phase 1 Remediation Artifacts)

تم التأكد بالدليل القطعي من وجود وتكامل كافة ملفات المعالجة السابقة داخل كود المصدر:

| ملف المعالجة | المسار الدقيق | الوظيفة الفنية والتحقق |
| :--- | :--- | :--- |
| **درع فحص الجداول** | `frontend/src/features/members/safeXlsxGuard.ts` | **موجود ويعمل:** يفرض سقف 5MB، ويفحص البايتات السحرية، ويحظر ZIP64، ويفحص فك الضغط التدفقي (8MB للملف، 15MB إجمالي، ونسبة 40:1). |
| **مخزن تراجع حذف الأعضاء** | `frontend/src/store/memberDeletion.ts` | **موجود ويعمل:** مخزن Zustand عام يحفظ مؤقت الـ 5 ثوانٍ عبر التنقل ويمنع الحذف الإجباري عند unmount. |
| **معالج مصنفات الأعضاء** | `frontend/src/features/members/memberExcel.ts` | **موجود ويعمل:** يستدعي `validateXlsxArchive` كبوابة إجبارية قبل تمرير البيانات لـ ExcelJS، ويحتفظ بحماية `safeCell` والـ RTL. |
| **واجهة استيراد وتصدير الجداول** | `frontend/src/features/members/MemberExcelActions.tsx` | **موجود ويعمل:** يفرض فحصاً فورياً لسقف حجم الملف (5MB) قبل تحميل الـ Buffer في الذاكرة. |
| **تأكيد إجراءات المساعد الذكي** | `frontend/src/features/ai-assistant/useAiConversation.ts`<br>`AiMessages.tsx`<br>`AiAssistantPage.tsx` | **موجود ويعمل:** يعترض إجراءات الحذف (`delete_member`، `delete_task`، `delete_note`)، ويربطها بنافذة Modal تأكيد تفاعلية، ويرفض الأسماء الجزئية. |
| **تصحيح مسار الدخول** | `frontend/src/features/auth/LoginPage.tsx` | **موجود ويعمل:** تم حذف مسار الرجوع المضلل بالكامل، وتأكيد إلزامية التحقق بـ OTP لربط الأجهزة الجديدة. |
| **اختبارات التراجع الأمني** | `frontend/scripts/security-regression.mjs` | **موجود ويعمل:** 45 اختباراً ثابتاً تتحقق من السياسات المعمارية وأمان الرموز والـ CSP. |
| **اختبارات التكامل السلوكي** | `frontend/scripts/security-runtime-integration.mjs` | **موجود ويعمل:** 8 اختبارات محاكاة تختبر منطق الهجرة 0022 وصلاحيات المشرفين. |
| **اختبارات أمان الجداول** | `frontend/scripts/safe-xlsx-test.ts` | **موجود ويعمل:** 10 اختبارات تحاكي قنابل الضغط وتتأكد من إحباطها بنجاح تام. |

---

## 4. جرد الميزات الوظيفية المعتمدة (Feature Functional Inventory)

### 4.1 بوابة الإدارة (Admin Control Center)
- **لوحة المؤشرات (`DashboardPage`):** عرض إحصائيات جاهزية الفريق، توزيع الأجهزة، المهام المتأخرة، وتنبيهات الاستعداد الميداني.
- **دليل الأعضاء وجاهزيتهم (`MembersPage`):** إدارة شاملة لبيانات الأعضاء، الفرز، البحث، الحقول المخصصة، الاستيراد والتصدير، والتسجيل الذاتي.
- **محرك المهام والتحقق (`TasksPage`):** إنشاء المهام، التكليف الفردي والجماعي، دورة التحقق والمراجعة، واعتماد إنجاز المهام.
- **سجل الملاحظات والتقييمات (`NotesPage` & `EvaluationsPage`):** توثيق الملاحظات الإدارية والميدانية، وتقييم أداء الأعضاء الدوري.
- **لوحة الشرف والترتيب (`RankingPage`):** احتساب نقاط الإنجاز والترتيب التنازلي ونظام المكافآت الاستثنائية.
- **مركز الإعلانات (`AnnouncementsPage`):** نشر الإعلانات الرسمية للفريق وتتبع نسب المشاهدة وتفاصيل القراءة.
- **المساعد الذكي (`AiAssistantPage`):** واجهة محادثة ذكية مربوطة بسياق الفريق مع إمكانية اقتراح وتأكيد الإجراءات الإدارية.
- **إدارة الواتساب (`WhatsAppQRPage` & `WhatsAppCloudPage`):** ربط جلسة الواتساب عبر QR، تشخيص الاتصال، وإرسال تنبيهات المهام.
- **إدارة حسابات الإدارة والصلاحيات (`AdminAccountsPage`):** مخصصة لمالك النظام لإضافة المشرفين وضبط مصفوفات الصلاحيات.

### 4.2 بوابة الأعضاء (Member Portal)
- **تسجيل الدخول وربط الأجهزة (`LoginPage`):** التحقق الموثق بـ OTP عبر البريد للأجهزة الجديدة، وتخزين تجزئة رمز الجهاز (SHA-256) لمدة 90 يوماً.
- **مساحة العضو (`MemberPortalPage`):** استعراض المهام المسندة، تحديث حالة التنفيذ، تسليم رابط الإنجاز، ومتابعة التقييمات والإعلانات.

---

## 5. جرد هجرات قاعدة البيانات (Database Migrations Inventory)

يحتوي مجلد [`backend/migrations/`](file:///C:/projects/phantoms/dashboard/backend/migrations/) على 22 هجرة مرتبة تسلسلياً:
- `0001_security_hardening.sql`: تصليب سياسات RLS وإلغاء الصلاحيات المفتوحة.
- `0002_whatsapp_settings.sql`: جدول إعدادات قنوات الواتساب.
- `0003_atomic_approval_and_member_lookup.sql`: المعاملات الذرية لاعتماد المهام واستعلام الأعضاء.
- `0004_push_notifications.sql`: دعم اشتراكات إشعارات الويب (Web Push).
- `0005_announcements_system.sql`: جداول نظام الإعلانات وتتبع المشاهدات.
- `0006_remove_team_concept.sql`: تحرير الهيكل من مفهوم الفرق الجامدة إلى نظام مركزي مرن.
- `0007_device_session_token.sql` إلى `0013_member_device_sessions.sql`: تطوير جلسات ورموز الأجهزة وتأمين الجلسات الفردية.
- `0014_admin_access_control.sql` & `0015_admin_permissions_and_full_delete.sql`: هيكل حسابات الإدارة وصلاحيات الأقسام.
- `0016_member_infinite_bonus.sql` إلى `0021_member_evaluations.sql`: أنظمة المكافآت، الحقول المخصصة، وتقييمات الأعضاء.
- `0022_dynamic_system_ownership.sql`: **الهجرة الأحدث والأهم** — تحرير ملكية النظام من المعرف الثابت (`8ce17aae-...`) وتأمين استعلامات الأعضاء برمز OTP.

---

## 6. الملفات غير المتتبعة والمخلفات المؤقتة

1. **الملفات غير المتتبعة حالياً في Git:**
   - [`audit/reports/PHANTOMS_PHASE1_1_INDEPENDENT_VERIFICATION.md`](file:///C:/projects/phantoms/dashboard/audit/reports/PHANTOMS_PHASE1_1_INDEPENDENT_VERIFICATION.md) (تقرير المرحلة السابقة).
2. **ملفات الاسكربت المؤقتة المعزولة في مجلد الـ Bridge:**
   - `backend/whatsapp-bridge/parse-excel.ts` و `import-members.ts`: ملفات تجارب فردية قديمة تحتوي على مسارات سطح مكتب محلية لمستخدم سابق (`C:\Users\aboha\Desktop\...`). وهي خارج مسار بناء الخادم (`rootDir: src`).

---
**خلاصة خط الأساس:** تم تثبيت وفحص خط الأساس الفني للمشروع بنجاح، وكافة المكونات البرمجية والهندسية متكاملة وسليمة وجاهزة لمراجعة الحالة الأمنية.

