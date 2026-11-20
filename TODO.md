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

## إصلاح sidebar والثيمين — الطلب الجديد 2026-11-20
- [x] طلب 2026-11-20: تمركز كل أيقونة وزر خروج في rail المطوي من غير قص أو انحراف RTL/LTR؛ الحفاظ على زر الطي و244→76px وتفضيل المستخدم المحفوظ وtooltips/Chevrons والصلاحيات.
- [x] Sidebar والـDrawer وزر الطي وtooltip يتبعون Light/Dark فعلًا: أسطح فاتحة محايدة في Light وGraphite في Dark، active row حيادي بلا rail ملون، ونصوص/مؤشر focus متباينة.
- [x] حفظ هذا الإصلاح محليًا للمعاينة؛ لا push أو تغييرات DB/Edge/Production دون موافقة إصدار جديدة.

**QA محلي 2026-11-20:** انحراف rail قبل الإصلاح ±16px؛ بعده كل الأيقونات والخروج في المنتصف ضمن 0.5px. Palette 9/9، sidebar mounted 10/10، locale 4/4؛ TypeScript/build/lint/secret audit ناجحة. Browser QA = 28 حالة (16 desktop عبر 1024/1279/1280/1440px + 12 mobile عبر 320/360/390px، باللغتين والثيمين) و4 live theme-switch حالات. حفظ preference بعد reload/resize، focus loop/Escape/scroll restoration، بلا overflow أو اتصال API/DB. لم يتغير كود صلاحيات/مسارات/Sidebar state أو backend، وHEAD لا يزال `596c40d`.

**الفرق الداخلية:** اعتمد المستخدم القواعد في 2026-11-20: Owner global، global admins الحاليون كما هم، Head/Monitor مقاعد team-scoped يختار Owner permissions لكل فريق، ومسؤول واحد يمكن تكليفه بأكثر من فريق، والعضو many-to-many عبر الفرق. البيانات القديمة بلا إسناد تلقائي وتظل للإدارة العامة حتى يصنفها Owner. التنفيذ المحلي بدأ؛ لا migration على الإنتاج ولا push. القرارات المحافظة الموثقة في `plan.md`: هوية أساسية واحدة مع بيانات تشغيل/تقييم/ملاحظات لكل فريق؛ نفس الشخص لا يشغل المقعدين في الفريق؛ reset كلمة المرور وإدارة Auth global-only.

## الفرق الداخلية وصلاحيات النطاق — معتمدة للتنفيذ المحلي 2026-11-20
- [x] إنشاء Teams مثل Software/Hardware/AI وإدارة تغيير اسم/تعطيل الفريق للـOwner؛ يبقى الـOwner cross-team والمشرفون العامون الحاليون global كما هم.
- [x] تعيين Head واحد وMonitor واحد لكل فريق من الـOwner؛ يمكن للمسؤول أن يُعيّن لأكثر من فريق؛ لا يوضع team admin في `admin_accounts` ولا يحصل على global dashboard.
- [x] يختار الـOwner لكل Head/Monitor صلاحيات الخصائص داخل كل فريق معين؛ قراءة وكتابة/إضافة ومراجعة وحذف العضوية والسجلات التشغيلية تُحرس عبر `auth.uid()` والتعيين الفعلي وصلاحية الفريق على الخادم وRLS/RPC؛ لا يُقبل `team_id` من العميل كبرهان تفويض. إزالة تكليف Team Admin لا تحذف Auth user ولا تخص تكليف فريق آخر.
- [x] يدعم العضو عضوية many-to-many في فرق متعددة؛ أذونات member/task/note/evaluation/announcement/ledger لا تتسرب بين الفرق، وسجلات التشغيل لها team scope مفرد. بيانات member identity مشتركة، أما النقاط/الملاحظات/التقييمات/الحقول التشغيلية فلها نطاق فريق.
- [ ] تظل كل البيانات القائمة بلا team scope حتى يصنفها الـOwner؛ لا توزيع تلقائي ولا إتاحة للفرق الجديدة قبل الإسناد. تُراجع/تعدل الحراس بكل الوظائف والـEdge، بما فيها الاستيراد والـpush/WhatsApp/AI/Owner join-review.
- [x] إنشاء إدارة فرق للـOwner وواجهات/اختيار نطاق Head/Monitor، مع منع الوصول إلى إعدادات الإدارة العامة، وحفظ team scope في query keys والتأكد من بدائل loading/error/empty.
- [x] تنفيذ migrations والواجهات والاختبارات محليًا، ثم تطبيق المهاجرات السبع على production بعد موافقة إصدار مستقلة؛ الإصدار الأول دُفع إلى `main`. لم يُنشر Edge ولم تُجرَ تغييرات يدوية على Vercel.

**سجل المرحلة الأولى التاريخي 2026-11-20:** أضيفت migrations أساس الفرق/العضويات/multi-team وOwner RPCs وواجهة `/admin/teams`. في تلك اللقطة لم يكن هناك team-admin dashboard أو feature routes، واختبارات SQL لم تكن قد نُفذت؛ أُغلقت هذه القيود لاحقًا في المرحلة الثانية.

**نتائج النواة المحلية قبل الإصدار:** Owner يفتح مساحة الفريق مع بقاء landing الإدارة العامة، وHead/Monitor يدخلان `/team` دون فتح `/admin`. المهام والمراجعات والنقاط وledger والملاحظات والتقييمات والحقول والإعلانات والمستلمين scoped، والنماذج/queries لكل مستخدم وفريق، مع إخفاء cache أثناء التحقق من الصلاحيات. PG17: 44 migrations و815 assertion ناجحة في 19 ملفًا نهائيًا مع ROLLBACK؛ 600 تاريخية و215 للفرق، دون إسقاط أي plan سابق. نجحت 95 contract/manifest/Sidebar/mounted test و18 access/palette/locale test و4 callback flows، وbuild وlint (0 warnings/errors) وsecret audit (0 credentials). أُوقفت البيئة وتأكد صفر fixtures وبقاء 8 JSON test-results. دعوات الفريق وPush/WhatsApp/AI خارج النواة.

**حالة إصدار النواة بعد الموافقة (2026-11-20):** طُبقت المهاجرات السبع على Supabase Production وتأكدت versions من السجل؛ ملفات المستودع والـforward manifest والاختبارات تعكس timestamps الإنتاج مع بقاء original-source provenance والـhashes. الإصدار الأول `5c12eb25a33a1dd9570b31270481bf0db55f6687` على `main`؛ Android CI نجح. أُصلح في commit `1a698fcf088f957ca545e0070b2e90241aa54dcc` اختبار inventory الذي كان يتوقع 13 applied forward بدل 20، وAndroid CI على هذا SHA نجح أيضًا. Database Runtime Validation وصل إلى PG17 وشغّل 815 assertion في 19 ملفًا؛ 814 نجحت، وفشل assertion واحد في `07_admin_member_projection.test.sql` لأنه توقع source timestamp `20261120125000` بدل production timestamp `20261120075039`. نجح teardown، وتخطت خطوات Auth/HTTP نتيجة توقف pgTAP. التوقع المحلي صُحح فقط؛ لا تغيير migrations أو DB production، ولم يُدفع التصحيح الثالث بعد. لا نشر Edge ولا تغييرات يدوية على Vercel؛ دعوات الفريق الخارجية وPush/WhatsApp/AI ما زالت خارج الإصدار.

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


## تحديث UI/UX للصفحات خارج /admin/dashboard — 2026-11-20
- [x] توحيد بنية صفحات العمليات والإدارة: عنوان رئيسي واحد واضح، سياق ووصف وإجراء أساسي، تسلسل أقسام قابل للمسح، أزرار/حقول/بطاقات/حالات موحدة، وحفظ محتوى `/admin/dashboard` وسلوكه من أي تغيير مشترك.
- [x] توحيد الشريط التشغيلي للقوائم التي تحتاجه: بحث ومرشحات معنونة وعدّاد للنتائج ومعايير مفعلة ومسح/إعادة ضبط، مع فصل البيانات الفارغة فعلًا عن عدم وجود نتائج بعد التصفية، دون تغيير معنى البيانات أو API/query.
- [x] إصلاح نواقص الوظائف المرصودة: إظهار إجراء مراجعة المهمة في عرض الجدول كما في البطاقات، إظهار فشل/إعادة محاولة تحميل الأعضاء عند الاعتماد عليهم، عدم عرض عناصر قابلة للنقر دون بديل لوحة مفاتيح، وتحسين تنظيم مراجعات الانضمام والفرق الطويلة.
- [x] استكمال تجربة اللغة والاتجاه في الصفحات ذات النصوص/التواريخ/الأزرار الثابتة؛ المحافظة على Arabic RTL وEnglish LTR، محتوى المستخدم، والثيمين وألوان PHANTOMS الحالية.
- [x] دعم لوحة المفاتيح وقارئ الشاشة وحالات التركيز والتحميل والحوار والتبويبات، وعدم تقليل أهداف اللمس عن 44px إلا لسبب موثق لا يكسر الاستخدام.
- [x] الحفاظ على جميع الصلاحيات، المسارات، نماذج الحقول والتحقق، حالة العضو/المهمة، النتائج والتأكيدات، بيانات الفرق، استدعاءات API/RPC، RLS، ومكونات الـAuth/Edge؛ لا migrations أو DB writes أو إرسال WhatsApp/Push/AI.
- [x] التنفيذ على worktree محلي وفرع `ui/professional-refresh` انطلاقًا من `bce48c0a0a9dbe85fb73a7b781934a0b5fd9ed61`; لا commit/push/deploy دون موافقة منفصلة.
- [x] التحقق من بناء TypeScript وUX guard والاختبارات المستهدفة، ومقارنة route/source الخاصة بـ`/admin/dashboard` للتأكد من عدم تغييرها.
- [ ] التحقق البصري عند 320/390/768/1024+، والعربية/الإنجليزية والثيمين، وkeyboard/reduced-motion والحالات الفارغة/الخطأ/التحميل.

**تشخيص آخر commit:** Android workflow run `44741835205` تعثر في تنزيل تبعيات Gradle متعددة؛ build موقّع لاحق لنفس SHA نجح في `44772684490`. لا يثبت السجل عيب compile ثابتًا في commit الأخير، ولا تُغيّر dependencies إلا إذا تكرر العطل مع دليل جديد.

**حالة التنفيذ المحلي:** اكتملت تغييرات البنية والبحث/التصفية والترجمة والدعم التفاعلي المسجل أعلاه؛ لم تتغير ملفات `/admin/dashboard` أو manifests أو backend، وأُزيل شرط حفظ الملاحظة الذي كان يغيّر السلوك السابق. التغييرات على الفرع المحلي `ui/professional-refresh` دون commit أو push أو نشر.
**نتيجة الفحوص البرمجية:** `npm run build` و`npm run lint` و`npm run test:brand` و`git diff --check` نجحت؛ يتضمن build تشغيل `ux:guard`. فحوص الفرق/المساحة/Auth/password/العلامة الأخرى كانت ناجحة مسبقًا في هذا العمل وفق سجل التنفيذ أعلاه.
**قيد التحقق البصري:** لم تكتمل معاينة المتصفح أو screenshots لمقاسات 320/390/768/1024+ والثيمين؛ `npm run ux:audit` لم يبدأ لأن Chromium الخاص بـPlaywright غير مثبت في البيئة. يبقى التحقق البصري اليدوي/المتصفح مفتوحًا قبل اعتماد الشكل النهائي.
