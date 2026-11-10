# تقرير التحقق المستقل بعد معالجة المخاطر — المرحلة 1.1
# PHANTOMS — Phase 1.1: Independent Remediation Verification

**تاريخ التدقيق:** 8 نوفمبر 2026  
**طبيعة المهمة:** تدقيق مستقل للقراءة فقط (READ-ONLY Independent Verification)  
**مسار المشروع المحلي:** `C:\projects\phantoms\dashboard`  
**الهوية الحالية:** PHANTOMS Management System (v2)  
**الهوية المستهدفة:** PHANTOMS  
**الأدوار المنفذة:** مهندس معماري أول للبرمجيات (Senior Software Architect)، مهندس أمن تطبيقات (AppSec Engineer)، ومدقق فني مستقل (Independent Technical Auditor).

---

## 1. الحكم النهائي (Final Status)

### الحكم النهائي: **معتمد بقيود فنية مثبتة (VERIFIED WITH LIMITATIONS)**

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                   INDEPENDENT VERIFICATION VERDICT                           │
│                                                                               │
│               [ VERIFIED WITH LIMITATIONS / معتمد بقيود ]                     │
│                                                                               │
│  ✓ تم التحقق الفعلي من إزالة تتبع .env من فهرس Git مع بقائه محلياً.          │
│  ✓ تم التحقق الفعلي من حذف تبعية exceljs الميتة بالكامل من whatsapp-bridge.  │
│  ✓ تم التحقق الفعلي من إيقاف الحذف الفوري لإجراءات الذكاء الاصطناعي وربطها بمودال.│
│  ✓ تم التحقق الفعلي من إلغاء خطاف unmount الذي كان يجبر حذف الأعضاء عند المغادرة.│
│  ✓ تم التحقق الفعلي من إلغاء المسار البديل المضلل في صفحة الدخول (LoginPage). │
│                                                                               │
│  ⚠ محرك ExcelJS لا يزال غير مرقع رسمياً في npm لـ CVE-2026-78206 (Compensating). │
│  ⚠ خطر التفسير المزدوج (Parser Differential): الحارس و ExcelJS يحللان الأرشيف بشكل منفصل.│
│  ⚠ اختبارات التكامل في security-runtime-integration.mjs هي محاكاة Mock وليست Supabase حية.│
│  ⚠ تفاوت أرقام الاختبارات ناتج عن حساب Node.js لكتلة الاختبار الرئيسية (Outer Suite).│
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. التدقيق الجنائي لأمن جداول البيانات (XLSX Security Deep-Dive)

تم فحص الكود البرمجي الكامل في:
- [`frontend/src/features/members/safeXlsxGuard.ts`](file:///C:/projects/phantoms/dashboard/frontend/src/features/members/safeXlsxGuard.ts)
- [`frontend/src/features/members/memberExcel.ts`](file:///C:/projects/phantoms/dashboard/frontend/src/features/members/memberExcel.ts)
- [`frontend/src/features/members/MemberExcelActions.tsx`](file:///C:/projects/phantoms/dashboard/frontend/src/features/members/MemberExcelActions.tsx)
- [`frontend/scripts/safe-xlsx-test.ts`](file:///C:/projects/phantoms/dashboard/frontend/scripts/safe-xlsx-test.ts)

### 2.1 الوضع الرسمي لثغرة CVE-2026-78206
- **طبيعة الثغرة:** تضخيم البيانات / قنبلة ضغط (CWE-409) في دالة `xlsx.load()` داخل مكتبة `ExcelJS <= 4.4.0`، حيث يقوم المحرك بفك ضغط ملفات XML الداخلية في الذاكرة دون تطبيق قيود على أحجام الملفات أو نسب الضغط.
- **حالة الإصدارات الرسمية:** أحدث إصدار مستقر منشور في سجل npm الرسمي لـ `exceljs` هو `4.4.0`. **لا يوجد حتى تاريخ اليوم إصدار رسمي مستقر (مثل 5.0.0 أو 4.4.1) صادر عن المطورين الرسميين في npm.** (توجد شوكات غير رسمية مثل `exceljs-hardened` ولكن اعتمادها محظور بموجب قواعد التدقيق الأمني لسلاسل التوريد).
- **التوصيف الدقيق:** طبقة `safeXlsxGuard.ts` المنفذة في المشروع هي **ضابط تعويضي (Compensating Control)** وليست ترقيعاً كودياً داخلياً لمكتبة ExcelJS نفسها.

### 2.2 تقييم آليات الحماية في `safeXlsxGuard.ts`

| معيار الفحص الأمني | حالة التحقق | الدليل الكودي والملاحظات الفنية |
| :--- | :---: | :--- |
| **سقف الحجم الأولي للملف** | **متحقق (VERIFIED)** | فحص 5 ميجابايت (`5 * 1024 * 1024`) في `MemberExcelActions.tsx` (سطر 25) وفي `safeXlsxGuard.ts` (سطر 76). |
| **البايتات السحرية للأرشيف** | **متحقق (VERIFIED)** | التحقق من توقيع ZIP المحلي `0x04034b50` (`PK\x03\x04`) في بداية الملف (سطر 87). |
| **سقف عدد الإدخالات** | **متحقق (VERIFIED)** | حظر أي أرشيف يحتوي على أكثر من 50 إدخالاً (`MAX_ZIP_ENTRIES = 50`) في سطر 118. |
| **حظر تجاوز المسارات والأسماء المكررة** | **متحقق (VERIFIED)** | حظر `..` والمسارات المطلقة والرموز الصفرية (سطر 159)، وحظر الأسماء المكررة عبر `seenPaths.has()` (سطر 164). |
| **قياس الحجم الفعلي بعد فك الضغط** | **متحقق (VERIFIED)** | استخدام تدفق `DecompressionStream('deflate-raw')` الفعلي وحظر تجاوز 8MB للإدخال، أو 15MB للإجمالي (سطر 302-318). |
| **سقف نسبة الضغط الديناميكية** | **متحقق (VERIFIED)** | حساب `entryDecompressedBytes / compressedSize` وقطع التدفق فوراً إذا تجاوزت 40:1 (سطر 323). |
| **مهلة المعالجة الزمنية (Timeout)** | **متحقق (VERIFIED)** | حظر استمرار فك الضغط لأكثر من 3000ms عبر `MAX_PROCESSING_TIME_MS` (سطر 242 و 291). |
| **المطابقة المتقاطعة (Cross-Validation)** | **متحقق جزئياً (LIMITATION)** | يتحقق الكود من وجود الترويسة المحلية `0x04034b50` ومواقع البيانات وحدودها، لكنه **لا يقارن اسم الملف المشفر في الترويسة المحلية مع اسمه في الفهرس المركزي، ولا يتحقق من تطابق قيم CRC-32**. |
| **حظر ZIP64** | **متحقق جزئياً (LIMITATION)** | يفحص الكود وجود محدد موقع ZIP64 (`0x07064b50`) في آخر 20 بايت قبل EOCD وحقول `0xFFFF`، لكنه لا يفحص حقول الامتداد الخاصة `0x0001` داخل الترويسات المركزية الفردية. |

### 2.3 الخطر المعماري القائم: التفسير المزدوج للمصنفات (Parser Differential Hazard)
- **آلية العمل الحالية:**
  ```typescript
  // memberExcel.ts (سطر 36-39)
  await validateXlsxArchive(buffer);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  ```
- **الثغرة المعمارية المحتملة:**
  يقوم `safeXlsxGuard` بفحص الـ `buffer` الخام عبر قراءة الفهرس المركزي وفك شرائح معينة. ثم يتم تمرير **نفس الـ buffer الخام بالكامل** إلى `workbook.xlsx.load(buffer)`!
  محرك ExcelJS يستخدم محلل ZIP داخلي خاص به (`unzipper`). إذا تضمن الملف تلاعباً هيكلياً خبيثاً (مثل ملفات ZIP متداخلة، أو ترويسات محلية متناقضة مع الفهرس المركزي)، فقد يتجاهل ExcelJS الفهرس المركزي ويقوم بفك ضغط أجزاء لم يفحصها الحارس!
- **الخلاصة:** الدرع يحمي تماماً من ملفات الـ Zip Bomb القياسية والمتداولة، لكنه لا يلغي خطر التفسير المزدوج للأرشيفات المصنوعة خصيصاً للتلاعب بين محللين.

---

## 3. حقيقة الاختبارات ومطابقة الأعداد (Test Authenticity & Count Reconciliation)

### 3.1 مطابقة أعداد الاختبارات (Reconciliation of Test Counts)
لاحظ التدقيق تفاوت الأعداد بين نصوص التقارير السابقة وقوائم الاختبارات المعروضة:
1. **اختبارات جداول البيانات (`safe-xlsx-test.ts`):**
   - السجل يظهر: `ℹ tests 10, ℹ pass 10`.
   - القائمة المعروضة كانت تحتوي على 9 اختبارات فرعية فقط.
   - **السبب الفني المؤكد:** في مكتبة الاختبارات الأصلية لـ Node.js (`node:test`)، يتم احتساب كتلة الاختبار الأب (`test('Spreadsheet Security Guard...', ...)`) كاختبار مستقل (Test #1)، وتُحتسب الاختبارات الفرعية التسعة بداخله (`await t.test(...)`) كاختبارات تابعة (Tests #2 إلى #10)، ليكون الإجمالي المسجل 10 اختبارات.
2. **اختبارات التكامل الأمني (`security-runtime-integration.mjs`):**
   - السجل يظهر: `ℹ tests 8, ℹ pass 8`.
   - القائمة المعروضة كانت تحتوي على 7 اختبارات فرعية فقط.
   - **السبب الفني المؤكد:** نفس السلوك البرمجي؛ كتلة الاختبار الأب (`test('Security Runtime Integration Suite...', ...)`) هي الاختبار رقم 1، والاختبارات السبعة المرقمة بداخلها هي الاختبارات من 2 إلى 8، ليكون الإجمالي المسجل 8 اختبارات.

### 3.2 تصنيف واجهة الاختبارات في `security-runtime-integration.mjs`
تم فحص الكود البرمجي للملف بدقة لتحديد البيئة التي ينفذ فيها:
- **فحص بيئة Docker المحلية:** استعلام `docker ps` أرجع سابقاً `exit code 1` ('docker' is not recognized)، ولا توجد أي خدمات Supabase محلية قيد التشغيل.
- **الكشف الفعلي:** ملف `security-runtime-integration.mjs` ينشئ كائناً برمجياً داخلياً باسم:
  ```javascript
  class Migration0022DatabaseSimulator {
    constructor() {
      this.adminAccounts = new Map();
      this.members = new Map();
      this.deviceSessions = new Map();
      // ...
  ```
- **التصنيف الدقيق لكافة الاختبارات:**
  * اختبار 1 (رفض ربط أجهزة anon): **محاكاة وحدة برمجية (Mock/Unit Behavior)**.
  * اختبار 2 (ربط أجهزة OTP الموثقة): **محاكاة وحدة برمجية (Mock/Unit Behavior)**.
  * اختبار 3 (رفض انتحال هوية الأعضاء IDOR): **محاكاة وحدة برمجية (Mock/Unit Behavior)**.
  * اختبار 4 (حدود صلاحيات المشرفين): **محاكاة وحدة برمجية (Mock/Unit Behavior)**.
  * اختبار 5 (ثبات صلاحيات المالك وعدم قابليتها للتعديل): **محاكاة وحدة برمجية (Mock/Unit Behavior)**.
  * اختبار 6 (سلوك استعلام العضو للأجهزة غير المربوطة): **محاكاة وحدة برمجية (Mock/Unit Behavior)**.
  * اختبار 7 (رفض مطابقة الأسماء الجزئية في AI): **اختبار وحدة برمجي حقيقي (Unit Test)**.
- **الحكم الصريح:** **لا توجد أي اختبارات تكاملية حية مع قاعدة بيانات PostgreSQL أو حاوية Supabase في هذا الملف.** وصفه في التقارير السابقة كاختبارات تكاملية كان يشير إلى محاكاة المنطق السلوكي للهجرة، وليس اتصالاً فعلياً بقاعدة بيانات حية.

---

## 4. التحقق من إجراءات الذكاء الاصطناعي التخريبية (AI Destructive Actions)

تم فحص التنفيذ الفعلي في:
- [`frontend/src/features/ai-assistant/useAiConversation.ts`](file:///C:/projects/phantoms/dashboard/frontend/src/features/ai-assistant/useAiConversation.ts)
- [`frontend/src/features/ai-assistant/AiAssistantPage.tsx`](file:///C:/projects/phantoms/dashboard/frontend/src/features/ai-assistant/AiAssistantPage.tsx)

### 4.1 التحقق من حظر التنفيذ المسبق
- عند استدعاء `executeAction(messageId, action, isConfirmed = false)` لأي إجراء تخريبي (`delete_member`، `delete_task`، `delete_note`):
  يقوم الكود بالتحقق من صحة الهدف أولاً، ثم يستدعي `setPendingConfirmation(...)` و **يخرج فوراً عبر `return` دون استدعاء أي دالة طفرة (Mutation)**.
- تم التحقق من أن النقر في الواجهة يفتح نافذة المودال [`Modal`](file:///C:/projects/phantoms/dashboard/frontend/src/components/ui/Modal.tsx) ولا ينفذ الحذف.

### 4.2 التحقق من ربط التأكيد بالهدف المحدد ومنع الاستبدال
- يحتوي كائن `pendingConfirmation` على:
  `actionType`، `targetEntityName`، `targetId`، و `details`.
- تعرض نافذة التأكيد اسم الهدف ومعرّف السجل (ID) بوضوح للمشرف.
- دالة `confirmAction` تستدعي `executeAction(messageId, action, true)`.
- دالة `resolveTargetMember` في سطر 80 تشترط المطابقة الصارمة عبر الـ ID أو الاسم الكامل، وترفض أي تطابق جزئي، مما يمنع استبدال الهدف أثناء التأكيد.

### 4.3 استقلالية التوثيق على مستوى الخادم
- تم التحقق من أن استدعاءات `deleteMember.mutateAsync` و `deleteTask.mutateAsync` تخضع لسياسات RLS في قاعدة البيانات (`public.is_admin()`). حتى لو تم الالتفاف على نافذة التأكيد في الواجهة، فإن خادم Supabase يرفض حذف السجلات لأي مستخدم غير مخول.

---

## 5. التحقق من دورة حياة حذف الأعضاء (Member Deletion Lifecycle)

تم فحص الكود البرمجي في:
- [`frontend/src/store/memberDeletion.ts`](file:///C:/projects/phantoms/dashboard/frontend/src/store/memberDeletion.ts)
- [`frontend/src/features/members/MembersPage.tsx`](file:///C:/projects/phantoms/dashboard/frontend/src/features/members/MembersPage.tsx)

### 5.1 النتائج المثبتة بالأدلة
1. **مغادرة الصفحة والتنقل:**
   - تم التحقق من **حذف خطاف التنظيف (`useEffect cleanup`) بالكامل** من `MembersPage.tsx`. مغادرة الصفحة أو إلغاء تحميل المكون لا يؤدي إطلاقاً إلى تشغيل الحذف الفوري.
   - مؤقت الـ 5 ثوانٍ يدار الآن داخل مخزن Zustand العام (`useMemberDeletionStore`).
2. **إلغاء العملية والتراجع (Undo):**
   - زر "تراجع" في إشعار Toast يستدعي `undoDelete(member.id)`.
   - تقوم الدالة باستدعاء `window.clearTimeout(entry.timerId)` فوراً، وحذف العضو من `pendingMap`، مما يلغي إرسال أي طلب إلى الخادم ويعيد العضو للظهور في القائمة.
3. **منع تكرار الطلبات:**
   - إذا تم طلب حذف نفس العضو مجدداً، يقوم `scheduleDelete` بمسح المؤقت السابق (`window.clearTimeout(existing.timerId)`) لمنع تكرار المعاملات.
   - عند انتهاء المؤقت، يتم حذف السجل من الـ Map قبل تنفيذ الـ Mutation، مما يضمن تنفيذ طلب حذف واحد فقط.
4. **إغلاق التطبيق وإعادة التحميل (Teardown):**
   - في حال إغلاق المتصفح أو تحديث الصفحة، تُلغى مؤقتات الجافاسكريبت التلقائية في المتصفح دون أن يتم إرسال طلب الحذف، مما يحمي السجلات من الحذف العرضي عند إغلاق النافذة.
5. **استحالة التعليق الدائم (No Stuck State):**
   - سواء نجحت العملية أو فشلت أو أُلغيت، يتم إخلاء معرّف العضو من `pendingMap` في كافة المسارات.

---

## 6. التحقق الجنائي من Git وملفات البيئة (Git & Environment Verification)

تم تنفيذ الأوامر الرسمية لفحص فهرس Git والقرص المحلي وكانت النتائج كما يلي:

### 6.1 حالة ملف `backend/whatsapp-service/.env`
- **أمر الفحص في الفهرس:** `git ls-files -s backend/whatsapp-service/.env`
- **النتيجة المثبتة:** **فارغة تماماً (Empty)**. تم التحقق من أن الملف غير متتبع إطلاقاً في فهرس Git.
- **أمر فحص الوجود على القرص:** `if exist backend\whatsapp-service\.env (echo EXISTS)`
- **النتيجة المثبتة:** `EXISTS`. الملف الفعلي ما زال موجوداً ومحفوظاً على القرص المحلي لخدمة بيئة التطوير.
- **أمر فحص التجاهل:** `git check-ignore -v backend/whatsapp-service/.env`
- **النتيجة المثبتة:** `.gitignore:19:backend/**/.env`. الملف خاضع رسمياً لقاعدة التجاهل في `.gitignore`.
- **أمر فحص ملف النموذج:** `git ls-files -s backend/whatsapp-service/.env.example`
- **النتيجة المثبتة:** `100644 687e9458c6c99d599df8a90c60dba35019adae23 0`. ملف النموذج متتبع وسليم في المستودع.
- **حماية الأسرار:** لم يتم طباعة أو تسريب أي قيم سرية أثناء الفحص.

### 6.2 حالة شجرة العمل (Working Tree Status)
- **أمر الفحص:** `git status`
- **النتيجة المثبتة:**
  ```
  On branch main
  Your branch is ahead of 'origin/main' by 3 commits.
  nothing to commit, working tree clean
  ```
- **التوصيف الدقيق:** شجرة العمل نظيفة تماماً (Clean) لأن التعديلات السابقة تم تثبيتها محلياً في الالتزامين `4846d44` و `f8d04fd`، والفرع متقدم بثلاث التزامات عن `origin/main` ولم يتم عمل push.

---

## 7. التدقيق المفصل لثغرات التبعيات (Full Dependency Audit Breakdown)

تم استخراج نتائج `npm audit --json` الكاملة وتصنيف كل ثغرة متبقية حسب مساحة العمل:

### 7.1 مساحة `backend/whatsapp-service`
- **كود الخروج:** `0`
- **عدد الثغرات:** `0` (نظيفة تماماً 100%).

### 7.2 مساحة `backend/whatsapp-bridge`
- **كود الخروج:** `1`
- **إجمالي الثغرات:** `1` (0 حرجة، 0 عالية، 0 متوسطة، 1 منخفضة).
- **تفاصيل الثغرة الوحيدة المتبقية:**
  * **الحزمة والإصدار:** `esbuild@0.27.7` (عبر `tsx@4.21.0`).
  * **نوع التبعية:** تبعية تطوير متعدية (`devDependencies` transitive).
  * **معرّف الثغرة:** [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr) (CWE-22: Arbitrary file read in development server on Windows).
  * **الوصولية في الإنتاج:** **غير متضمنة وغير قابلة للوصول في الإنتاج**.
  * **الدليل:** خادم الإنتاج يتم تشغيله عبر `node dist/server.js` (كود جافاسكريبت مترجم مسبقاً)، وخادم التطوير المدمج في esbuild لا يعمل في بيئة الإنتاج إطلاقاً.

### 7.3 مساحة `frontend`
- **كود الخروج:** `1`
- **إجمالي الثغرات:** `8` (0 حرجة، 0 عالية، 6 متوسطة، 2 منخفضة).

| الحزمة المتأثرة | الإصدار المثبت | مباشر/متعدٍ | معرّف الثغرة | مستوى الخطورة | التضمين في الإنتاج | دليل الوصولية والمخاطر الفعلية |
| :--- | :---: | :---: | :--- | :---: | :---: | :--- |
| **`exceljs`** | `4.4.0` | مباشر | GHSA-w5hq-g745-h8pq (via uuid) + CVE-2026-78206 | **متوسطة** | **نعم (ضمن كود الإنتاج)** | تعمل في المتصفح عند تصدير/استيراد الأعضاء. تم تطويقها بدرع فحص مسبق `safeXlsxGuard.ts`. |
| **`uuid`** | `<11.1.1` | متعدٍ | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | **متوسطة** | **نعم (عبر exceljs)** | ثغرة تجاوز حدود الـ buffer في توليد v3/v5/v6. مكتبة exceljs تستدعي `uuid.v4()` فقط دون تمرير buffer خارجي، فلا يوجد استغلال مباشر. |
| **`vite-plugin-pwa`** | `1.2.0` | مباشر (dev) | عبر workbox-build | **متوسطة** | **لا (أداة بناء فقط)** | تعمل أثناء تنفيذ أمر `vite build` لتوليد Service Worker. لا يتم إرسال الحزمة للمستخدم. |
| **`workbox-build`** | `>=6.0.0` | متعدٍ | عبر glob و @rollup/plugin-node-resolve | **متوسطة** | **لا (أداة بناء فقط)** | أداة تجميعية داخل إطار عمل PWA أثناء البناء. |
| **`glob`** | `10.4.5` | متعدٍ | [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) | **متوسطة** | **لا (أداة بناء فقط)** | تجاوز إلغاء AbortSignal أثناء البحث عن الملفات. مسارات الملفات ثابتة في الإعدادات ولا يتحكم فيها مستخدم خارجي. |
| **`minimatch`** | `9.0.5` | متعدٍ | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | **متوسطة** | **لا (أداة بناء فقط)** | ReDoS في فحص أنماط glob. الأنماط المطبقة ثابتة ومحددة برمجياً في المشروع. |
| **`@rollup/plugin-node-resolve`** | `>=8.0.0` | متعدٍ | عبر deepmerge | **منخفضة** | **لا (أداة بناء فقط)** | مكوّن لحل مسارات الحزم أثناء تجميع الـ Rollup. |
| **`deepmerge`** | `4.3.1` | متعدٍ | [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) | **منخفضة** | **لا (أداة بناء فقط)** | تلوث النموذج الأولي (Prototype Poisoning) عند دمج كائنات مدخلة. البيانات المدمجة هي كائنات إعدادات Rollup موثوقة. |

---

## 8. ملخص التحقق النهائي وتوصيات المرحلة القادمة

1. **التحسينات الأمنية المؤكدة:**
   - تم التخلص النهائي من تسريب المفاتيح عبر فك تتبع ملف `.env`.
   - تم تطهير خادم الـ Bridge بحذف حزمة `exceljs` غير المستخدمة بالكامل.
   - تم ضبط تجربة حذف الأعضاء ومنع الحذف الإجباري التلقائي عند مغادرة الصفحة.
   - تم ضبط إجراءات المساعد الذكي واشتراط تأكيد المشرف عبر نافذة منبثقة تفاعلية.
   - تم تصحيح رسائل خطأ تسجيل الدخول وإلغاء المسار المضلل.
2. **المخاطر والقيود الواجب إدراكها للمرحلة القادمة (PHANTOMS Transition):**
   - **الاعتماد على حزمة غير مرقعة رسمياً:** مكتبة `exceljs` ما زالت في إصدار `4.4.0` رسمياً، ويجب متابعة إصدار النسخة المستقرة `5.0.0` أو نقل معالجة الملفات الكبيرة مستقبلاً إلى خدمة سحابية معزولة (Sandboxed Cloud Function).
   - **خطر التفسير المزدوج:** درع `safeXlsxGuard` يفحص الملف ثم يمرره كما هو لـ ExcelJS؛ يجب في المراحل المتقدمة تغذية ExcelJS بالبيانات المفكوكة والمفحوصة مسبقاً بدلاً من إعادة فك الضغط.
   - **الاختبارات الحية:** اختبارات `security-runtime-integration.mjs` تعتمد على محاكاة سلوكية كودية، ويجب عند تجهيز بيئة Staging حقيقية تشغيل حاوية Supabase وتنفيذ استعلامات SQL عبر الشبكة.

---
**نهاية تقرير التحقق المستقل — تم الإعداد والتوثيق بأعلى معايير الشفافية والحياد الهندسي.**

