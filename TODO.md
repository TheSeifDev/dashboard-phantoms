# TODO

## Owner review لتسجيل الأعضاء الجدد
- [x] لا يظهر طلب لمجرد إصدار الرابط أو فتحه؛ يصبح الطلب موجودًا بعد إكمال العضو الإرسال بنجاح.
- [x] إبقاء العضوية غير نشطة ومنع الدخول للبوابة قبل قرار مراجعة صريح.
- [x] عرض كل join مكتمل ذي ربط Auth صالح وعضوية غير نشطة؛ يظهر أي email drift كعنصر blocked بدل إخفائه، وتُحمّل الطلبات الأقدم بصفحات keyset من 100.
- [x] حماية الموافقة بصلاحية الإدارة ومطابقة بريد Auth الحالي للدعوة والربط والعضو، وقفل/إعادة تحقق السجلات، وتسجيل قرار Owner/Admin في audit؛ يمنع الحارس كل انتقال عام بعيدًا عن `inactive` (ومنها `NULL`) قبل الموافقة.
- [x] إظهار نجاح التسجيل فقط بعد استجابة الحفظ الناجح، مع عرض الخطأ الفعلي عند الفشل.
- [x] اختبار hardening المحلي: suite 13 = 97/97 assertions داخل transaction rollback مع DDL migration 36، وSQL concurrency v3 = 6/6 مع exact fixture cleanup واستعادة تعريف RPC المحلي؛ 38/38 migration/workflow tests و56/56 controller/projection tests؛ Dashboard Chromium E2E = 1/1 في وضعي VAPID؛ TypeScript/lint/build/secret audit ناجحة.
- [x] أُطلقت migration `20261119005000_member_password_owner_join_review.sql` في production (remote version `20261119054418`) ونُشرت Edge function المطابقة؛ dashboard source ضمن release إلى `main`. لا نؤكد اكتمال auto-deploy للواجهة دون فحص deployment منفصل.
