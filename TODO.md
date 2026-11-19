# TODO

## إعادة تصميم PHANTOMS — الخطة المعتمدة 2026-11-19
- [x] قشرة Dashboard تحليلية مطابقة لتوزيع المرجع: شريط جانبي/علوي، بطاقات أرقام الفريق الحقيقية، heatmap، اتجاه الإنجاز وتوزيع الحالات والنشاط؛ أسطح باردة ثلجية/كحلية مع Crimson وEmerald، light/dark متناسقان، وتوحيد الحقول والبطاقات والجداول عبر صفحات الإدارة دون حذف الوظائف.
- [x] اختيار عربي/إنجليزي محفوظ (العربية افتراضيًا)، مع `lang`/`dir` فعليين وانعكاس الشريط الجانبي وRTL/LTR، وترجمة تسميات التنقل والدخول وواجهة الإدارة الثابتة وتنسيق التواريخ/الأرقام؛ بيانات الأعضاء والمهام المكتوبة تبقى كما أُدخلت.
- [x] دخول split-screen وشبكة PHANTOMS SVG أصلية، وloading إبداعي بـGSAP مع نص فوري مقروء؛ دخول البطاقات والأرقام والـheatmap وتحريك محسوب، تنظيف timelines عند unmount واحترام `prefers-reduced-motion`، دون تأخير نموذج/قرار صلاحيات أو تحريك حقول أثناء استخدامها.
- [x] Heatmap سنوي واختيار الفريق/عضو وcurrent/best streak؛ اليوم النشط = اعتماد إداري واحد على الأقل بتوقيت Africa/Cairo. دفتر أحداث اعتماد/إلغاء append-only ذري داخل RPCs، وقراءة ملخص محمية؛ تعبئة الاعتمادات الحالية فقط وإظهار حدود التاريخ القديم وعدم اختلاق اعتمادات أُلغيت قبل إطلاق السجل.
- [x] موبايل 320/360/390px بلا قص حقول أو أزرار، قائمة drawer، بطاقات تتكدس، وتمرير heatmap داخل حاويتها فقط؛ حماية تدفقات الدخول/الأعضاء/Owner review وحالات loading/error/empty دون أرقام وهمية.
- [x] إصدار redesign السابق: migration37 مطبقة كـremote version `20261119193932`، والواجهة مدفوعة إلى `main` على `9e02d2e6` مع CI ناجح. هذا status لا يشمل تلوين/Sidebar follow-up الحالي.

**QA للإصدار السابق:** 14 pgTAP suites = 600/600؛ Auth E2E الحقيقي وDashboard Chromium في وضعي VAPID ناجحة؛ TypeScript/lint/build/secret audit والـstrict evidence cleanup ناجحة. resources المحلية توقفت؛ migration37 مطبقة production كـ`20261119193932`، والـmanifest يثبت 13 forward applied وصفر pending. HEAD الحالي `9e02d2e6` وCI السابق ناجح.

## تحديث palette وSidebar — الطلب الأحدث
- [x] كل الأحمر على مستوى الموقع يستخدم عائلة Crimson؛ الجذر `#DC143C` والـtints الضرورية للتباين، دون ترك red/rose palette قديمة في الأزرار أو الحالات أو الرسوم. الشعار الرسمي متعدد الطبقات محفوظ كما هو.
- [x] كل الأخضر يستخدم عائلة Emerald؛ الجذر `#10B981` للنجاح/النشاط وheatmap مع تدرجات متباينة light/dark.
- [x] درجات الأزرق الباردة مشتقة من Prussian Blue؛ الخلفية الأساسية الداكنة exact `#00072D`، ولا يبقى cobalt/sky/blue palette مستقلة. يبقى light theme الفاتح المتاح متناسقًا.
- [x] Sidebar مثل المرجع: الخلفية Prussian Blue، شعار PHANTOMS أعلى، groups وعناوينها الصغيرة، icons 20px مع labels 14px RTL/LTR بلا اقتطاع، active row بتعبئة icy-blue وindicator أزرق فاتح على الحافة المنطقية (لا Crimson)، والخروج Crimson مثبت أسفل؛ نفس المظهر في mobile drawer مع عدم تغيير قائمة المسارات أو الصلاحيات. زر دائري يطوي/يوسع sidebar إلى rail أيقونات بتفضيل محفوظ، مع aria labels وروابط قابلة للوصول عند الطيّ وعدم لمس مخزن Auth. تظهر tooltips على hover/focus، ومسار sign-out الفاشل يعطي رسالة عامة ولا يعلن خروجًا زائفًا.
- [x] المستخدم وافق صراحةً على commit/push لهذا التعديل إلى `main` وقبول احتمال النشر التلقائي؛ إنه تعديل واجهة فقط، ولا يحتاج migration أو نشر Edge.

**QA لهذا التعديل:** Sidebar mounted 8/8، palette 7/7، locale 4/4، member-projection/brand 22/22، وmounted join/reset/Admin callbacks 10/10. TypeScript/lint/build/secret audit ناجحة؛ Chromium على المكونات الفعلية أثبت 244→76px و10 حالات عربي/إنجليزي وثيم فاتح/داكن وموبايل، مع active row icy-blue، عدم اقتطاع labels، focus tooltips، وعدم وجود overflow؛ أُعيد فحص mobile drawer وfocus/Escape/scroll. لا API أو DB أو Auth fixtures.

## تصحيح تناسق الألوان والـSidebar — التوجيه الأحدث
- [x] استبدال الأسطح الزرقاء المشبعة كأساس بصندوق Graphite/Charcoal محايد متناسق مع الصورة؛ الحفاظ على crimson وemerald كلونَي accent وظيفيين وبجرعات قليلة، لا ملء أقسام كبيرة بكل لون. الاحتفاظ بـlight theme واضح ومتناغم.
- [x] تنفيذ Sidebar المرجع الأخير: خلفية charcoal، Dashboard ظاهرًا كصف مستقل، active row بسطح charcoal أفتح من غير rail أزرق/أحمر، labels/icons رمادية هادئة، Operations مفتوح افتراضيًا وباقي أقسام navigation قابلة للطي بـchevrons، icon-only rail عند الطيّ، وزر خروج crimson هادئ أسفل. مجموعة المسار النشط تفتح تلقائيًا، ومؤشر keyboard focus يحقق 3:1 على الخلفية الداكنة. الحفاظ على routes والصلاحيات وRTL/mobile drawer.
- [x] عرض التصحيح محليًا للمراجعة، وعدم تنفيذ commit/push إلا بعد موافقة جديدة؛ وصلت موافقة المستخدم بتاريخ 2026-11-20 بعد مراجعة الصور.

**QA قبل الإصدار:** palette/contrast 8/8، sidebar navigation 10/10، locale/member projection 16/16، brand 10/10؛ TypeScript/build وlint وsecret audit ناجحة (0 credential artifacts). Browser smoke للـRTL/LTR والثيمين والrail/mobile drawer = 10/10، route manifest = 22 routes، وملفات test-results بقيت 8. لا اتصال API/DB/Auth fixtures. بعد مراجعة المعاينة، وافق المستخدم على commit/push إلى `main` بتاريخ 2026-11-20 مع قبول احتمال النشر الآلي.

## إصلاح تجربة الدخول وتأكيد طلب الانضمام
- [x] صفحات دخول الإدارة والعضو تتكيف مع شاشات 320 و360 و390px بلا قص أو تمرير أفقي، مع بقاء حقول الدخول والأزرار قابلة للوصول.
- [x] تنبيه ما قبل الإرسال يوضح صراحةً أن الطلب لم يُحفظ بعد؛ لا تظهر حالة نجاح إلا بعد استجابة الحفظ، مع شاشة تأكيد منفصلة بعد join/reset الناجح ورسالة خطأ عملية عند الفشل.
- [x] طابور Owner/Admin يتحدث تلقائيًا أثناء فتح صفحة الأعضاء ويظهر تنبيهًا داخل التطبيق عند وصول join جديد؛ لا تُرسل رسالة خارجية تلقائيًا دون قناة معتمدة.

## Owner review لتسجيل الأعضاء الجدد
- [x] لا يظهر طلب لمجرد إصدار الرابط أو فتحه؛ يصبح الطلب موجودًا بعد إكمال العضو الإرسال بنجاح.
- [x] إبقاء العضوية غير نشطة ومنع الدخول للبوابة قبل قرار مراجعة صريح.
- [x] عرض كل join مكتمل ذي ربط Auth صالح وعضوية غير نشطة؛ يظهر أي email drift كعنصر blocked بدل إخفائه، وتُحمّل الطلبات الأقدم بصفحات keyset من 100.
- [x] حماية الموافقة بصلاحية الإدارة ومطابقة بريد Auth الحالي للدعوة والربط والعضو، وقفل/إعادة تحقق السجلات، وتسجيل قرار Owner/Admin في audit؛ يمنع الحارس كل انتقال عام بعيدًا عن `inactive` (ومنها `NULL`) قبل الموافقة.
- [x] إظهار نجاح التسجيل فقط بعد استجابة الحفظ الناجح، مع عرض الخطأ الفعلي عند الفشل.
- [x] اختبار hardening المحلي السابق: suite 13 = 97/97 assertions داخل transaction rollback مع DDL migration 36، وSQL concurrency v3 = 6/6 مع exact fixture cleanup؛ لهذا follow-up: Auth E2E حقيقي = 1/1 مع 12 stage ناجحة، Dashboard Chromium E2E = 1/1 لكل وضع VAPID، static regressions = 32/32، ومجموعة frontend CI المطابقة = 103/103 عبر أربع عمليات اختبار؛ TypeScript/lint/build/secret audit ناجحة.
- [x] أُطلقت migration `20261119005000_member_password_owner_join_review.sql` في production (remote version `20261119054418`) ونُشرت Edge function المطابقة؛ dashboard source ضمن release إلى `main`. لا نؤكد اكتمال auto-deploy للواجهة دون فحص deployment منفصل.
