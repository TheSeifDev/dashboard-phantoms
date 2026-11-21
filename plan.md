# خطة إعادة تصميم PHANTOMS

**الحالة:** الخطة معتمدة من المستخدم؛ إصدار palette/sidebar السابق دُفع إلى `main` بالـSHA `647de4571ea9842535d5131bbb86f4b48c09752b` لكن المستخدم طلب تصحيحًا بصريًا جديدًا لأن الألوان لم تتناسق. بعد مراجعة المعاينة المحلية، وافق المستخدم بتاريخ 2026-11-20 على commit/push إلى `main` مع قبول احتمال auto-deploy. لا تغيير DB/Edge/migrations.

## إصلاح تكامل Owner مع الأعضاء — 2026-11-21

الحقول الجديدة موجودة في SELECT وملف العضو؛ المطلوب توحيد البطاقات والبحث على specialization الحقيقي وإظهار الرقم الأكاديمي والمجموعة والبريد الجامعي والروابط وحالة البيانات المطلوبة. يعرض محرر الإدارة الحقول الجديدة بوضوح للقراءة مع شرح أن العضو يستكملها بنفسه في Settings؛ لا direct UPDATE جديد أو بيانات مصطنعة للأعضاء السابقين.

معاينة الإدارة تتيح تجربة الحقول والتحقق بنفس مكون MemberProfileFields، على بيانات تجريبية محلية فقط وبعلامة واضحة. لا Auth أو انتحال عضو أو حفظ خادمي أو إرسال بريد/reset. تشرح المسارات الحقيقية /portal/settings و/member و/forgot-password. التصميم الحالي واللغتان والثيمان وGSAP/reduced motion محفوظة.

إلغاء Admin عملية Owner-only مستقلة تزيل فقط admin_accounts لغير Owner مع قفل وإعادة تحقق ومنع الذات/Owner/الأهداف المفقودة؛ تحفظ Auth UUID والربط وكلمة المرور والجهاز والدعوات والفرق والمشروعات. لا تنشئ عضوًا أو تربطه بالبريد تلقائيًا. تستخدم migration أمامية pending وواجهة تأكيد صريحة.

الحذف الحالي يثبت حذف صف واحد ويتوقف عن إعلان نجاح قبل الخادم، ويميز منع الدعوات/الفرق/المشروعات والصلاحيات/no-op ويعيد ظهور العضو عند الفشل. لا تحويل RESTRICT إلى CASCADE أو حذف Auth لإلغاء Admin. الحذف النهائي للأشخاص المرتبطين يبقى محظورًا؛ الأرشفة/التطهير التاريخي يحتاجان قرار نطاق صريح، ولا يسمى أحدهما حذفًا نهائيًا.

نطاق الملفات: features/members للعرض/البحث/المعاينة؛ features/admin/access وmigration جديدة pending لإلغاء الإدارة؛ store/memberDeletion للنتائج الصادقة. اختبارات disposable فقط بلا حذف أو تغيير أدوار حقيقية. لا تعديل للمهاجرات التاريخية أو Edge4 أو recovery PKCE، ولا تطبيق migration أو commit/push أو إعادة تفعيل Production دون تفويض إصدار جديد.

## الاتجاه التصميمي

سأعيد تشكيل PHANTOMS كـ **Awwwards-inspired Analytics Command Center** يستلهم توزيع ومساحات لوحة التحليلات، شاشة الدخول المقسومة، وشبكة المساهمات في الصور المرفقة، من غير نسخ علامة أو واجهة منتج آخر حرفيًا. الفكرة الأساسية: «أداء الفريق واضح من أول نظرة»؛ واجهة تحريرية منظمة، بيانات حقيقية، وتسلسل بصري يوجّه الانتباه بدل الزخرفة.

**مبادئ التجربة:** وضوح الأرقام قبل الزينة؛ Graphite/Charcoal محايد كأساس موحد؛ Crimson وEmerald كلمسات محدودة ذات معنى لا كأسطح متنافسة؛ الحركة ذات هدف؛ RTL/LTR صحيحان؛ وحالات الانتظار والخطأ والبيانات الفارغة صريحة.

**الألوان (آخر توجيه للمستخدم):** ينتقل الأساس الداكن من Prussian Blue الصريح إلى Graphite `#171A1E` لتقليد مرجع الـsidebar الجديد وتوحيد الإحساس. Crimson `#DC143C` يبقى لون الإجراء المهم/الخروج/الخطر ويظهر باعتدال؛ Emerald `#10B981` للنجاح والنشاط والheatmap بجرعات صغيرة. الأسطح والنصوص وحدود الحالة محايدة من عائلة charcoal/stone لتفادي تعارض الأحمر والأخضر، مع بقاء الثيم الفاتح واضحًا ومتناسقًا.

**Sidebar override:** يطابق الصورة الأخيرة: panel Graphite داكن بلا صبغة زرقاء، علامة PHANTOMS أعلى، روابط بمظهر بسيط وأيقونات/تسميات رمادية، active row بسطح charcoal أفتح بلا شريط accent لوني، وفئات navigation قابلة للطي مع chevrons. يبقى عرض الشريط 244px والrail 76px؛ الحالة المطوية تعرض أيقونات فقط مع مربع charcoal هادئ للعنصر النشط. زر الخروج muted-Crimson مثبت أسفل الشريط. الـDrawer يشارك النمط؛ تبقى permission filtering وRTL/LTR وروابط PHANTOMS الحقيقية كما هي.

**وضوح التفاعل:** زر الطيّ 44px، وتظهر أسماء الأيقونات في rail كـtooltips مرئية على hover/focus خارج scroll container. مؤشر التركيز في sidebar الداكن يحقق تباينًا غير نصي لا يقل عن 3:1 حتى عندما يكون الثيم العام فاتحًا. النصوص تستعمل foreground مشتقة ومتباينة بدل وضع الأبيض مباشرة فوق Emerald أو Crimson tint فاتحة. نجاح تسجيل الخروج يحتفظ بالتنظيف والتنقل السابقين؛ أما error/exception فيعرض رسالة عامة وإعادة محاولة دون إعلان نجاح زائف أو عرض تفاصيل Supabase الخام.

**الخط والعلامة:** الإبقاء على علامة الشبح الحالية وخطّي IBM Plex Sans Arabic وMontserrat، مع أحجام ومسافات وأوزان أوضح. لا تُضاف صورة stock؛ لوحة الشبكة في الدخول والتحميل ستكون SVG أصلية متوافقة مع هوية PHANTOMS.

## تركيب الواجهات

- **القشرة المشتركة:** شريط جانبي ينعكس تلقائيًا بين يمين العربية ويسار الإنجليزية، وشريط علوي للبحث والإشعارات واللغة والثيم والحساب. تبقى الصلاحيات والقوائم الفعلية كما هي.
- **الرئيسية:** عنوان ترحيبي ومسارات سريعة، ثم بطاقات أرقام ملائمة للفريق (الأعضاء، المهام المعتمدة، قيد المراجعة والمتأخرة)، يليها سجل نشاط المهام بشكل GitHub-style، ثم رسوم اتجاه الإكمال وتوزيع حالة التكليفات وقائمة النشاط/الأعضاء. ستُعاد صياغة القياسات الحالية بدل إضافة أرقام شكلية مثل الإيراد أو الجلسات.
- **تفاصيل التشغيل:** توحيد أسطح البطاقات والحقول والجداول والحالات الفارغة عبر صفحات الإدارة الحالية بواسطة design tokens، مع إبقاء محتوى النظام وتدفقات الأعضاء دون حذف.
- **الدخول والتحميل:** تكوين split-screen أنظف على الشاشات الواسعة، مع نموذج واضح ولوحة شبكة PHANTOMS متحركة. شاشة الانتظار تظل مفهومة كنص حتى لو أوقف المستخدم الحركة؛ الرسوم والنقاط وخطّ التقدم هي الزخرفة المتحركة فقط.
- **الموبايل:** قائمة جانبية قابلة للفتح، بطاقات تتكدس، ورسوم قابلة للتمرير أفقيًا عند الحاجة من غير قص النص أو الأزرار.

## العربية والإنجليزية

إضافة اختيار لغة دائم ومحفوظ، العربية هي الافتراضية. يحدّث التطبيق `lang` و`dir` فعليًا، ويقلب ترتيب القشرة والرسوم ذات الاتجاه المكاني بين RTL/LTR. تُترجم التسميات والتنقل والحالات وعناصر واجهة الإدارة وتدفقات الدخول الثابتة؛ أما أسماء الأعضاء وعناوين المهام والملاحظات التي كتبها المستخدم فتبقى كما أُدخلت. تُنسق الأرقام والتواريخ بحسب اللغة والمنطقة.

## GSAP وسلوك الحركة

تُثبت حزم GSAP محليًا في `package.json` و`package-lock.json`، مع React hook وإدارة cleanup scoped. نقاط الحركة المقترحة: رسم شبكة loading، انتقال قصير للمحتوى، دخول البطاقات والأرقام، ورسم خلايا heatmap. لا تُؤخر الحركة إرسال نموذج أو قرار صلاحيات، ولا تُحرّك عناصر الإدخال أثناء تفاعل المستخدم. يُحترم `prefers-reduced-motion` في JavaScript وCSS، مع حذف الحركة أو اختصارها بوضوح. مراجع التكامل: [GSAP React](https://gsap.com/resources/React/) و[gsap.matchMedia](https://gsap.com/docs/v3/GSAP/gsap.matchMedia/).

## تعريف سجل إنجاز المهام

الـheatmap والـstreak سيحسبان **المهمات التي اعتمدتها الإدارة**، لا مجرد المهمات المسندة ولا التسليمات التي لم تُراجع. يوم الفريق النشط هو يوم حدث فيه اعتماد واحد على الأقل؛ وعند اختيار عضو يُعرض نشاط اعتماده وحده. يُعرض الـcurrent streak والـbest streak على أساس هذه الأيام، مع تاريخ محلي ثابت وتلميح يوضح عدد الاعتمادات.

تعرض الشبكة سنة تقويمية كاملة. السلاسل محسوبة داخل السنة المختارة من الأيام المرصودة فقط؛ لا تدّعي امتدادًا بين السنوات أو أفضل تاريخي كامل. السلسلة الحالية تظهر للسنة الحالية فقط، أما السنة القديمة فيظهر بدلها «—» بتفسير واضح. الأيام السابقة للتسجيل غير مكتملة ويظهر لها نمط مختلف، وليس صفر نشاط مؤكد.

يوجد قيد بيانات مهم: `tasks.tracking` يحتفظ بالحالة الحالية فقط، وعند إلغاء اعتماد يُستبدل وقت الحالة القديمة. لذلك لا يمكن إعادة بناء تواريخ اعتماد أُلغيت قبل إطلاق السجل الجديد بدقة. لتحقيق سجل مستقبلي حقيقي شبيه بالمساهمات، تتضمن الخطة migration أمامية تنشئ دفتر أحداث append-only للاعتماد/الإلغاء؛ التنفيذ يسجل انتقال tracking بواسطة trigger داخل معاملة الـRPC الإدارية نفسها، دون إعادة كتابة أو تغيير توقيعات ومنطق RPCs القائمة. يمكن تعبئة الاعتمادات الحالية فقط من توقيتها الحالي؛ لا توجد طريقة آمنة لاستعادة اعتمادات سابقة أُلغيت. ستُعرض بداية فترة التتبع بوضوح، ولن تُصطنع خلايا تاريخية. قراءة السجل تكون عبر RPC محمي بصلاحية لوحة التحكم، وترجع ملخص الأيام لا بيانات حساسة.

## نطاق الملفات والمسؤوليات

- `frontend/src/styles/tokens.css` و`index.css`: لوحة الألوان والأسطح والخطوط والوصول وتقليل الحركة.
- `frontend/src/i18n/` و`frontend/src/store/`: قاموس اللغتين وحالة التفضيل واتجاه المستند.
- `frontend/src/components/layout/` و`frontend/src/features/auth/`: القشرة والتنقل والدخول والـloading.
- `frontend/src/features/dashboard/`: إعادة تركيب اللوحة، الرسوم، و`TaskStreakHeatmap` مع اختبار خالص لحساب اليوم والـstreak.
- `backend/supabase/migrations/` و`backend/supabase/tests/database/`: سجل اعتماد/إلغاء محمي، RPC قراءة ملخص، واختبارات pgTAP للصلاحيات والذرية وعدم فقدان الأحداث.
- تحديث اختبارات الواجهة وPlaywright ذات الصلة مع الاحتفاظ بمعرّفات الحقول وتدفقات تسجيل الدخول، واستعمال بيانات اختبار محلية فقط.

## حدود الإصدار

بعد موافقة الإصدار، migration 37 طُبقت والواجهة السابقة دُفعت إلى `main` واجتازت CI. هذا الـfollow-up بصري فقط: يغير semantic palette وsidebar styles مع طيّ/توسيع؛ لا migration جديدة ولا نشر Edge. تمت مراجعة المعاينة المحلية والموافقة على commit/push غير قسري إلى `main`، مع احتمال auto-deploy حسب إعدادات المشروع؛ لا تغييرات يدوية على Vercel. صلاحيات المشرفين، تحقق الجلسة، تدفقات الدخول، اعتماد المهام وسياسات تخزين العضو لا تتغير.

## الطلب الجديد 2026-11-20 — الفرق الداخلية وإصلاح Sidebar

**حالة العمل:** الإصدار السابق `596c40d4dceaccc49c5d889c6fecefa9f37a8902` دُفع ونجح CI. الطلب الجديد محلي فقط حتى إصدار معتمد جديد؛ لا تطبيق migrations أو نشر Edge أو push تلقائيًا استنادًا إلى الموافقة السابقة.

**تصحيح Sidebar الأحدث:** يلغي اشتراط أن الشريط يظل داكنًا في الثيم الفاتح. يشارك sidebar والـdrawer وزر الطي وtooltips ثيم التطبيق: أبيض/رمادي في الفاتح وGraphite في الداكن. تبقى الخلفية النشطة حيادية بلا rail ملون، والأيقونات عند الطي في مركز مساحة العنصر بصريًا، من غير قص أو انحراف في RTL أو LTR. لا تتغير المسارات أو الصلاحيات أو preference الطي أو focus/Escape/logout.

**قواعد الفرق المعتمدة من المستخدم (2026-11-20):** جداول مستقلة للفرق الداخلية وتكليف Head وMonitor بكل فريق، دون ترقيتهم إلى Admin عام. الـOwner يدير كل الفرق، والمشرفون العامون الحاليون يحتفظون بصلاحياتهم. يختار الـOwner permissions لكل مسؤول داخل نطاق الفرق التي عيّنه فيها، ولا يملك المسؤول إدارة النظام أو فرقًا أخرى. للفريق مقعد Head واحد ومقعد Monitor واحد؛ يمكن للمسؤول إدارة أكثر من فريق بتكليف صريح. العضو يستطيع الانتماء إلى أكثر من فريق، لذلك تمثل العضويات بجدول many-to-many لا عمود مفرد على `members`. البيانات القديمة تبقى بلا توزيع تلقائي ومتاحة للإدارة العامة فقط حتى يصنفها الـOwner. مهمة/ملاحظة/إعلان/تقييم/حدث ledger لها نطاق فريق واحد في الإصدار الأول؛ العضو الذي ينتمي لعدة فرق يرى المهام الموجهة إليه بحسب عضوية كل فريق. لا تتحول فرق متعددة إلى صلاحية عالمية.

**قرارات تنفيذية محافظة لعدم توسيع الصلاحية:** `members` تظل هوية أساسية واحدة؛ المعرّف والاسم والبريد والهاتف حقول مشتركة تظهر لمسؤول الفريق فقط للأشخاص المنتسبين لذلك الفريق وصلاحية `members`. حالة الانتساب (`team_memberships.status`) مستقلة عن `members.work_status` العام. الملاحظات والتقييمات/النقاط/الرتب والأنشطة المخصصة للعضو فريقية، لا تُكتب إلى نقاط العضو العامة. سجلات custom fields الحالية تبقى عامة/غير معينة ولا تظهر لمشرف الفريق؛ حقول الفريق الجديدة وقيمها تسجل بنطاق الفريق. Head وMonitor يسميان المقعد فقط؛ لا امتياز ضمني خارج feature bits المختارة من Owner، ولا يجوز للحساب نفسه شغل المقعدين في الفريق ذاته. يمكن تعيين حساب Auth موجود فقط من قبل Owner؛ إضافة Head/Monitor لا تنشئ Auth ولا تغير `admin_accounts`. صلاحية members تتيح الدعوات والمراجعة/إدارة عضوية الفريق المحدد فقط، بينما إعادة ضبط كلمة المرور وتفعيل/تعطيل Auth تظلان global-owner/admin فقط لأنهما تؤثران على عضويات الشخص الأخرى. إشعار `all` للإعلان يثبت قائمة مستلمي الفريق عند النشر؛ أما `ALL` في المهمة فيظل ديناميكيًا للأعضاء النشطين في فريق المهمة حفاظًا على سلوك بوابة العضو الحالي ضمن نطاق أضيق.


**نطاق المشروع للتنفيذ:** `backend/supabase/migrations` للجداول/RLS/RPC وتوافق البيانات القديمة؛ `backend/supabase/functions` للتحقق من team scope في join-review/invitations/push/WhatsApp/AI؛ `frontend/src/features/admin/access` و`router` للـaccess context وحماية المسارات؛ `frontend/src/features/teams` لواجهة إدارة الفرق؛ `frontend/src/features/{members,tasks,ranking,notes,announcements,dashboard}` لتقييد الاستعلامات والعمليات بالنطاق. `frontend/src/styles/{tokens,sidebar}.css` و`components/layout` لإصلاح الثيم والمحاذاة. الإصدار إلى الإنتاج يحتاج موافقة منفصلة بعد اكتمال التنفيذ المحلي.

**حالة النواة المحلية قبل الإصدار (2026-11-20):** صفحة Owner-only `/admin/teams` ومساحة `/team/:teamId` مستقلة. يفتح Owner كل فريق عبر RPCs ضيقة، وHead/Monitor يشغّلان الأقسام المصرح بها للفريق المختار فقط. المهام والمراجعات والنقاط والملاحظات والتقييمات والحقول والإعلانات والمستلمون وledger معزولة؛ البيانات القديمة تبقى NULL-team، وheatmap العامة تستبعد أحداث الفرق. نجح تطبيق 44 migration على PostgreSQL 17 المعزول و815 assertion في 19 ملفًا نهائيًا (600 تاريخية و215 للفرق)، مع ROLLBACK لكل ملف وصفر fixtures بعده وإيقاف الحاوية. نجحت 95 contract/manifest/Sidebar/mounted test و18 access/palette/locale test و4 callback flows، وbuild وlint وsecret audit. ظلت دعوات الفريق وPush/WhatsApp/AI خارج نطاق النواة.
**التنفيذ المعتمد محليًا:** migration أمامية جديدة تضيف `teams` و`team_memberships` (عضويات أعضاء many-to-many) و`team_admin_assignments` (Head/Monitor + صلاحيات ضمن الفريق)، وحقول team scope لسجلات التشغيل ذات الصلة؛ تحقق RLS وRPC وEdge مستقل من `auth.uid()` والتكليف الموثوق، ومنع تعيين أو قراءة أهداف عبر الفرق. لا تصبح team id القادمة من المتصفح دليل صلاحية. صفحة إدارة فرق للـOwner، اختيار الفريق المصرح في واجهة مسؤولي الفرق، وقوائم وأرقام وledger ودعوات محصورة بالفريق مع query keys تتضمن النطاق. إزالة تكليف المسؤول/العضو من فريق لا تحذف حساب Auth أو عضويات/تكليفات أخرى. لا تعديل للمهاجرات التاريخية التي أزالت team concept. كل سيناريو cross-team يعالج بقرار/تحقق صريح، ولا تعتمد الأمان على إخفاء عناصر الواجهة.

**سجل التنفيذ قبل تطبيق الإنتاج:** أُصلح قيد إسناد الحساب العام وقرارات المراجعة الفارغة، وأُضيفت APIs تشغيلية مستقلة لكل فريق ومساحة `/team` منفصلة عن `/admin` العام؛ لم تُوسّع حراس النظام العام. كل ميزة مفعّلة لها عقد خادمي scoped وصلاحيات فريق صريحة؛ الأعضاء هوية مشتركة والـAuth/reset عام فقط.

**حالة إصدار 2026-11-20 بعد موافقة المستخدم:** طُبقت المهاجرات السبع واُتحقق من ظهورها في سجل المشروع: `20261120074604`, `20261120074634`, `20261120074653`, `20261120074723`, `20261120074850`, `20261120074944`, `20261120075039`. أعيدت تسمية الملفات المحلية إلى timestamps الإنتاج مع الحفاظ على provenance وSHA256، وحُدث forward manifest والاختبارات. الإصدار الأول `5c12eb25a33a1dd9570b31270481bf0db55f6687` دُفع إلى `main`؛ Android CI نجح. كشف CI أولًا assertion قديمًا داخل `frontend/scripts/supabase-cli-safety.test.mjs` كان يتوقع 13 applied forwards بدل 20؛ عُدّل في commit `1a698fcf088f957ca545e0070b2e90241aa54dcc` ودُفع إلى `main`. بعد ذلك وصل Database Runtime Validation إلى PG17 وشغّل 815 assertion في 19 ملفًا؛ نجح 814 وفشل واحد فقط لأن test07 ما زال يتوقع source timestamp `20261120125000` بينما النسخة الفعلية في `schema_migrations` هي production timestamp `20261120075039`. نجح teardown، وتخطت الخطوات اللاحقة لفشل pgTAP. عُدّل توقع test07 محليًا إلى production timestamp؛ هذا test/documentation-only change ولا يغيّر مهاجرات أو بيانات production، ولم يُدفع بعد. لا تغيير يدوي على Vercel ولا نشر Edge؛ الدعوات الخارجية وPush/WhatsApp/AI تظل غير مفعلة ضمن هذه النواة.


## طلب 2026-11-20 — تحديث UI/UX للصفحات خارج /admin/dashboard

**نطاق العمل المحلي:** تحسين شامل للصفحات التشغيلية والإدارية والعامة خارج `/admin/dashboard`، بما فيها الدخول والعضو والمهام والأعضاء والتقييمات والترتيب والملاحظات والإعلانات وAI وWhatsApp والفرق. المرجع البرمجي الحالي `origin/main` هو `bce48c0a0a9dbe85fb73a7b781934a0b5fd9ed61`، والتنفيذ يجري على worktree محلي `ui/professional-refresh`؛ لا commit أو push أو نشر من دون طلب صريح.

**الاتجاه:** professional operations workspace باستعمال نظام PHANTOMS القائم لا استبداله: Crimson `#DC143C` وEmerald `#10B981` ولمسات graphite، Light/Dark حقيقيان، Arabic RTL وEnglish LTR. توحيد التسلسل (عنوان واحد واضح، سياق ووصف وإجراء أساسي)، المسافات والبطاقات والأزرار والحقول والحالات، وتجميع البحث/الفلاتر/العداد/المسح حيث توجد قوائم تشغيلية. تظل واجهة `/admin/dashboard` وسلوكها كما هما؛ أي تعديل على القشرة المشتركة يكون مشروطًا خارج هذا المسار ويختبر عدم الانحدار.

**ثوابت التنفيذ:** لا تغييرات قاعدة بيانات أو RLS/RPC/API أو Auth/Edge أو بيانات أو دلالات حالات أو ranking/calculations أو صلاحيات أو إرسال خارجي. تحفظ الحقول والتحقق والتأكيدات والتدفقات ومسارات الرواتر كما هي. لا يستخدم إخفاء عنصر كوسيلة تفويض. تبقى البيانات المكتوبة من المستخدم كما هي. لا يعتمد تغيير جمالي على مرئيات لم تُفحص بصريًا.

**معايير تجربة مشتركة:** صفحة ذات سياق وعنوان هرمي مفهوم؛ عدم الخلط بين empty/no matches/error/loading؛ إبقاء الإجراء والسياق متاحين في حالات الانتظار والفشل حيثما تسمح التدفقات؛ دعم touch targets 44px وfocus-visible وkeyboard/ARIA؛ preserve reduced motion، responsive behavior، safe areas، الثيمين، واتجاهي العربية والإنجليزية.

**نتيجة فحص آخر commit:** CI run `44741835205` على هذا SHA فشل أثناء حل عدد من تبعيات Android/Gradle (منها Kotlin/ASM/Gson/Protobuf من Google Maven/Maven Central)، لا أثناء compile من ملفات آخر commit. بناء يدوي لاحق لنفس SHA `bce48c0a0a9dbe85fb73a7b781934a0b5fd9ed61` نجح موقّعًا في run `44772684490`. لذلك هذا دليل على تعثر dependency resolution عابر، وليس إثبات عيب Android متكرر في commit؛ يعاد التحقق إن تكرر.


**خاتمة تنفيذ UI/UX المحلي (2026-11-20):** أُنجزت تحديثات الصفحات التشغيلية خارج `/admin/dashboard` على `ui/professional-refresh`: توحيد رؤوس الصفحات، إكمال البحث/الفلاتر والحالات حيث يلزم، دعم اللغة والاتجاه في بوابة العضو ومركز الإشعارات، وتحسين تنظيم الفرق والتقييمات وWhatsApp. لم يتغير مصدر `features/dashboard` أو ملفات الاعتماديات، ولا backend/migrations/Auth/Edge أو الصلاحيات أو التدفقات؛ أُزيل تحقق المستهدف الإضافي في محرر الملاحظات بعد ثبوت تغييره لسلوك سابق. اجتاز آخر تشغيل `npm run build`, `npm run lint`, `npm run test:brand` و`git diff --check`. لم يتوفر Chromium لتشغيل `ux:audit` لذلك تظل معاينة المتصفح للمقاسات والثيمين مفتوحة؛ لا screenshots أُنتجت ولا يُدّعى اكتمال QA بصري. التغييرات تبقى محلية بلا commit أو push أو نشر.


## Implementation plan — PHANTOMS Web Projects (2026-11-20)

**Status and boundary:** Implement an additive, first-class Web Projects workspace inside this Dashboard. Preserve the existing `/admin/dashboard`, Internal Teams, member/auth flows, profiles, global-role model, and `public.tasks` workflow. The implementation and migration remain local until separately authorized; do not apply migrations to the shared PHANTOMS Supabase project, push, or deploy. Read-only DB discovery is preserved in `WEB_PROJECTS_DATABASE_DISCOVERY.md`.

### Product architecture and authorization

Use one project domain and one canonical identity: project memberships reference `public.members.id`; authenticated users are resolved through the existing `member_auth_bindings`. Do not use team memberships, team administrator assignments, or the global `public.tasks` table for project work. Add a dedicated `web_projects` feature permission to the existing global administrator permission schema: `owner` is implicitly allowed, existing global admins default to denied, and only explicitly permitted global admins become Web Projects program administrators. This permission is not a Team permission and does not itself grant Internal Teams access. Project roles remain per-project (`lead`, `contributor`, `viewer`) and may vary per member/project.

Program administrators may see and manage the program; a project lead may manage only a project where the actor is an active, agreement-accepted project member with the `lead` role; contributors may work on project tasks and submit updates/reports/deliverables; viewers receive read-only project access. All authorization is checked in PostgreSQL RLS and guarded RPCs, with frontend route guards as a usability layer only. Never trust a caller-supplied project/member/role as proof of access. Reports are readable by their author, that project's lead, and program administrators; shared task/project data is visible only within the active project membership. Resources are readable only where they are globally approved or explicitly linked to a project.

Project members are added from the canonical member directory. A project agreement is versioned; new/changed ownership or permissions require relevant contributors to explicitly accept. Participation starts pending and no intellectual-property default is implied. Store ownership model/notes, license, creator attribution, PHANTOMS asset/brand permission, technical-support arrangement, and showcase permission explicitly. Brand use and public showcase are opt-in, off by default, and require the recorded contributor consent appropriate to each project; PHANTOMS is never assumed to own project IP. Future-product, GitHub, Figma, documentation, demo, and repository values are integration metadata/links only; do not claim APIs are connected.

### Data and transaction boundaries

Add a namespaced additive schema in a forward migration, with project-scoped keys/constraints and indexes. Core relations: `web_ideas`, `web_projects`, `web_project_members`, `web_project_agreements` and acceptance history, `web_project_milestones` and same-project dependencies, `web_project_deliverables`, `web_project_sprints`, `web_project_tasks`, task comments/checklists/attachments and append-only task/activity events, `web_project_member_reports`, project updates/blockers, shared/project resources and project-resource references, and integration metadata. Use existing members/auth identities; do not copy profile/contact data. Use a transactional, idempotent idea-to-project RPC that retains the source idea, submitter, approved decision, and source-project link, and cannot produce a duplicate conversion. Use same-project foreign keys for all references. Enforce coherent lifecycle, role, status, due-date, and agreement constraints in the database.

Calculate progress from actual records: project task completion from non-cancelled project tasks; milestone progress from linked task/deliverable statuses; sprint progress from its actual non-cancelled tasks. Do not store manually invented percentages or rank contributors with a productivity score. With no tracked work, display an explicit empty/zero state rather than claiming completion. Overdue status is derived from dates and unfinished state. Prevent cross-project task/milestone/sprint/dependency references and dependency cycles. Record each sensitive lifecycle, membership, agreement, task, report-review, blocker, deliverable, and resource action in project-scoped activity history. Resource files, if uploaded, use a dedicated Supabase Storage bucket with policies consistent with the database project authorization; URL-only metadata must remain available if storage upload is not configured.

### Existing application placement and responsibilities

- `frontend/src/features/web-projects/`: typed feature API/repository, query keys/cache scoping, access helpers, domain types, reusable timeline/board/task/report/resource components, and module pages. Keep database/business rules out of presentational components.
- `frontend/src/features/portal/projects/`: member-facing project index, contributor dashboard, agreement acceptance, report submission, blockers, deliverables, and project workspace using the existing authenticated member session.
- `frontend/src/router/index.tsx`: lazy-load admin routes under `/admin/web-projects/*` behind existing Admin authorization plus the new `web_projects` permission; add `/portal/projects/*` behind the existing `MemberAccessGuard`. A project member must never receive Admin/Team permissions by taking part in a project.
- `frontend/src/components/layout/AppSidebar.tsx` and `AdminHeader.tsx`: add a separate first-class “Web Projects” group and nested route titles/search that are filtered by the new permission. Do not place the module inside Internal Teams.
- `frontend/src/features/members/MemberPortalPage.tsx` and its current navigation/components: add the contributor entry point and `/portal/projects` access, reusing the existing profile identity and session boundary.
- `frontend/src/types/db.ts` and administrator access-management UI/API: add the `web_projects` global feature bit with a safe false default for existing administrators; keep project role types and membership records domain-specific.
- `backend/supabase/migrations/`: add the project schema, permission constraint/default, RLS policies, narrow security-definer helpers/RPCs, same-project constraints, and activity hooks. `backend/supabase/tests/database/`: add pgTAP coverage for role boundaries, anonymous/authenticated access, cross-project isolation, agreement gates, conversion atomicity/idempotency, status/date invariants, dependency cycles, and legacy-team/task non-interference. Do not alter historical migrations or legacy task RPC semantics.
- `frontend/public/manus-routes.json`: keep the declared page route set synchronized with the complete source routes, including dynamic project patterns.

### Screen design and interaction direction

Reuse the current PHANTOMS design tokens, typography, components, themes, and localization (`useLocale`, Arabic RTL, English LTR). Adapt the supplied project-management references as functional patterns rather than copying their branding: compact Gantt lanes and time-range navigation, task cards and review states, a practical sprint board, and readable report/analytics hierarchy. Keep the current graphite/neutral surfaces with restrained Crimson `#DC143C` actions and Emerald `#10B981` success/progress; maintain light/dark contrast. Avoid decorative metrics, excessive cards, gradients, and new stock imagery.

The admin overview uses live database-derived counts and project rows with status, lead, member count, calculated progress, current milestone, latest activity and expected delivery. Separate views cover ideas/review, directory, timeline, Agile board, project tasks, reports, resources and project settings. The member portal shows only accessible projects and a useful individual workload: assigned/completed/in-progress/overdue tasks, milestones/deliverables, pending reviews, reports and blockers. Project workspace tabs provide overview, timeline, Agile board, tasks, team, reports, resources and settings according to role. Kanban supports keyboard-accessible status transitions as well as drag-and-drop; every move persists a validated workflow transition and history event. Timeline period navigation and milestone detail use stored dates/dependencies and permission-checked edits. Every page supports loading, empty, no-results, error/retry, responsive desktop/tablet/mobile layout, accessible focus/touch targets, and reduced motion.

### Conservative workflow defaults

Ideas are visible to their submitter and program administrators while under review; the program administrator controls approval/rejection. A reviewed/approved idea converts once. Each active project has exactly one primary project lead; project membership is many-to-many and has no fixed size. A member can belong to many projects and can be lead in one and contributor/viewer in others. New membership is pending until the current agreement is accepted. A project cannot be publicly showcased unless explicit project permission and the required contributor consents are recorded. Only the author, project lead and program administrator see an individual progress report; project-level metrics aggregate records without exposing unrelated projects' private data. Archive is non-destructive and preserves activity/history. Existing internal task, contribution, ranking, bonus, profile, authentication, team, and notification semantics remain unchanged.

## Member information and Settings — 2026-11-21

تنفيذ داخل Dashboard القائم مع استمرار الدعوة ذات الاستخدام الواحد ومراجعة الإدارة. الاسم الكامل والرقم الأكاديمي والمجموعة ورقم WhatsApp والبريد المسجل والتخصص الأساسي Software / Hardware / AI إلزامية في التسجيل الجديد وحفظ Settings. الرقم الأكاديمي نص رقمي يحتفظ بالأصفار الأولية؛ مجموعة الطالب نص لأن قائمة مجموعات معتمدة لم تُحدد. البريد الجامعي قيمة مشتقة خادمياً: `<academic_number>@batechu.com`. LinkedIn وGitHub / Portfolio / Behance اختياريان. الهاتف الحالي هو رقم WhatsApp للتوافق، وليس دليلاً لإسناد الهوية.

أعمدة members الجديدة nullable حتى لا تحذف أو تعيد إنشاء الأعضاء السابقين. RPC خاص يشتق العضو من Auth UUID والربط الدقيق والجلسة الحية والجهاز، ويعيد بياناته وحالة اكتمال خادمية. حفظ الملف يتحقق من allowlist كاملة ومتطلبات الحقول في الخادم؛ لا يقبل email/Auth UUID أو الأدوار أو التيم أو حالة العضوية. البريد المسجل ظاهر للقراءة؛ تغييره عملية هوية منفصلة. Gate واجهة مستقل عن صحة الهوية يوجّه العضو السابق إلى `/portal/settings` للاستكمال مع بقاء Settings والخروج متاحين. تخصص الملف لا يمنح عضوية Internal Team أو صلاحيات Head/Monitor. لا تُغيّر صلاحيات العمل الحالية لمجرد نقص الملف؛ الحالة الخادمية والتحقق عند حفظ الملف والتسجيل هما مصدر الإلزام.

Forgot password عبر بريد Auth المسجل للحساب المؤهل فقط، مع نتيجة عامة تمنع كشف وجود الحساب وrate limiting خادمي. Callback يستخدم عميل recovery معزول ولا يكتب جلسة الإدارة أو جلسة العضو العادية. عند الحفظ يثبت الخادم recovery AMR والجلسة والربط، ثم ينشئ reset reservation دقيقة تستخدم نفس controller وtrigger وquarantine الحاليين. لا يُحدّث password مباشرة متجاوزاً الدعوة. الحسابات الاصطناعية أو غير المرتبطة أو غير المفعلة تبقى بحاجة إلى رابط إدارة أو مراجعة هوية. SMTP وredirect allowlist متطلبات تشغيلية؛ لا تُغير أو يُدعى توفرها في هذه المهمة.

التصميم امتداد PHANTOMS Graphite/Charcoal، Crimson #DC143C وEmerald #10B981، IBM Plex Sans Arabic وMontserrat. Settings بمنطقة تعريف وحالة اكتمال جانبية تتحول لرأس مضغوط على الموبايل، وأقسام للدراسة والتواصل والروابط والمعلومات الإضافية. GSAP matchMedia وprefers-reduced-motion مع revert، وتحريك الحاويات لا الكتابة النشطة. الحفاظ على العربية/الإنجليزية وRTL/LTR وlight/dark بلا صور زخرفية أو مكتبة حركة جديدة.

البنية: `frontend/src/features/members/profile-*` للvalidator والحقول وAPI وSettings، و`features/auth/member-recovery*` للاستعادة المعزولة، وrouter/PortalHeader للتنقل. migrations additive pending في backend؛ controller/modules في Edge enrollment. كل التعديلات محلية، بلا migration مشتركة أو Edge deploy أو commit/push أو Vercel حتى تفويض منفصل.

تصحيح recovery بعد native GoTrue v2.197.0: implicit recovery ينتج `otp` وليس `recovery`، ولذلك يعتمد التنفيذ PKCE S256 فقط بدل قبول OTP أو URL type كإثبات. المتصفح ينشئ verifier عشوائيًا ويحفظ verifier + timestamp فقط لمدة 30 دقيقة في localStorage مستقلة؛ Edge يستقبل challenge فقط ويرسله إلى Auth مع redirect ثابت. callback يمسح code من URL ويزيل verifier قبل exchange، ولا يحفظ Auth session/tokens. يعمل فتح البريد في تبويب جديد من نفس المتصفح؛ المتصفح المختلف أو verifier المفقود/المنتهي يحتاج طلبًا جديدًا أو reset إداريًا. signed recovery AMR والسجل الدائم الحديث المطابق للجلسة يظلان شرطًا، ولا تتغير migration أو حماية Auth أو الصلاحيات بسبب هذا التصحيح.

## Owner/member integration — 2026-11-21

إصلاح الربط في Dashboard القائم: تعرض بطاقات الأعضاء البيانات الأكاديمية والتخصص الأساسي من الأعمدة canonical، والبريد الجامعي وحالة الاستكمال وروابط مهنية HTTPS آمنة. البحث يشمل الرقم والمجموعة والاتصال؛ محرر الإدارة يعرض البيانات الجديدة للقراءة ولا يفتح UPDATE أو يختلق بيانات للأعضاء. يبقى إدخال البيانات الجديدة من العضو نفسه عبر Settings.

زر واضح في `/admin/members` يفتح `/admin/members/experience` تحت صلاحية الأعضاء الحالية. معاينة تفاعلية معلّمة كبيانات تجريبية محلية تستخدم نفس الحقول والـvalidator، بلا Auth أو تخزين أو طلبات حفظ أو إرسال بريد. تشرح مسار العضو الحقيقي `/login` ثم `/portal/settings` و`/forgot-password`. تعيد استخدام تصميم PHANTOMS، العربية/الإنجليزية وRTL/LTR والثيمين وGSAP مع reduced motion.

الإلغاء العام لـAdmin عملية Owner منفصلة عن حذف Auth: RPC ضيق يقفل ويتحقق من Owner والهدف، يرفض self/Owner/null/unknown، ويحذف صف الإدارة العامة وحده. يحافظ على Auth والربط وكلمة المرور والجهاز والفرق والمشاريع والتاريخ. وجود ربط لا يعني جاهزية الدخول مطلقًا؛ لا ننشئ Member أو نعيد الربط بالبريد تلقائيًا، وHead/Monitor نطاق مستقل.

الحذف الحالي يثبت صفًا واحدًا مطابقًا وينتظر الخادم قبل نجاحه، ويمنع تراجع أو تكرار عملية بدأت، ويربط التراجع بالتوليد المحدد. فشل القيود يعيد الظهور برسالة مفهومة، وفشل النقل يعلن عدم تأكد النتيجة. تبقى RESTRICT وسجلات التاريخ محمية؛ أرشفة/تعطيل الأشخاص أو purge نهائي تحتاج قرارًا صريحًا مستقلًا. هذا إصلاح محلي؛ migration demotion مسجلة pending بلا تطبيق، ولا commit/push أو تفعيل نشر أو QA على أشخاص حقيقيين.
