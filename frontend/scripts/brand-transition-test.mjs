import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const read = (relPath) => readFileSync(resolve(ROOT, relPath), 'utf8');

test('PHANTOMS Brand Transition Verification Suite', async (t) => {
  await t.test('1. Document Title & Head Metadata', () => {
    const html = read('index.html');
    assert.match(html, /<title>PHANTOMS.*<\/title>/);
  });

  await t.test('2. Web App Manifest Metadata', () => {
    const manifest = JSON.parse(read('public/manifest.json'));
    assert.equal(manifest.name, 'نظام إدارة PHANTOMS');
    assert.equal(manifest.short_name, 'PHANTOMS');
    assert.match(manifest.description, /منصة PHANTOMS/);
  });

  await t.test('3. Mobile Configurations (Capacitor & Android)', () => {
    const capacitor = JSON.parse(read('capacitor.config.json'));
    assert.equal(capacitor.appName, 'PHANTOMS');
    assert.equal(capacitor.appId, 'com.phantoms.app');

    const androidStrings = read('android/app/src/main/res/values/strings.xml');
    assert.match(androidStrings, /<string name="app_name">PHANTOMS<\/string>/);
    assert.match(androidStrings, /<string name="title_activity_main">PHANTOMS<\/string>/);
    assert.match(androidStrings, /<string name="package_name">com\.phantoms\.app<\/string>/);
    assert.match(androidStrings, /<string name="custom_url_scheme">com\.phantoms\.app<\/string>/);

    const gradle = read('android/app/build.gradle');
    assert.match(gradle, /namespace = "com\.phantoms\.app"/);
    assert.match(gradle, /applicationId "com\.phantoms\.app"/);
  });

  await t.test('4. Navigation & Layout Branding', () => {
    const sidebar = read('src/components/layout/AppSidebar.tsx');
    assert.match(sidebar, /aria-label=\{t\('PHANTOMS — الرئيسية', 'PHANTOMS — Home'\)\}/);
    assert.match(sidebar, /<span>PHANTOMS<\/span>/);

    const authShell = read('src/components/layout/AuthShell.tsx');
    assert.match(authShell, /aria-label=\{t\('PHANTOMS — الرئيسية', 'PHANTOMS — Home'\)\}/);
    assert.match(authShell, /<strong>PHANTOMS<\/strong>/);
    assert.match(authShell, /© 2026 PHANTOMS/);

    const portalHeader = read('src/features/portal/PortalHeader.tsx');
    assert.match(portalHeader, /<strong className="block text-sm font-black sm:text-base">PHANTOMS<\/strong>/);
  });

  await t.test('5. Authentication Screens Branding', () => {
    const login = read('src/features/auth/LoginPage.tsx');
    assert.match(login, /title=\{t\('دخول أعضاء PHANTOMS', 'PHANTOMS member sign-in'\)\}/);
    assert.match(login, /name@phantoms\.com/);

    const adminLogin = read('src/features/auth/AdminLoginPage.tsx');
    assert.match(adminLogin, /title=\{t\('دخول إدارة PHANTOMS', 'PHANTOMS administrator sign-in'\)\}/);
    assert.match(adminLogin, /admin@phantoms\.com/);

    const adminSetPassword = read('src/features/auth/AdminSetPasswordPage.tsx');
    assert.match(adminSetPassword, /badge=\{t\('دعوة إدارة PHANTOMS', 'PHANTOMS administrator invitation'\)\}/);
  });

  await t.test('6. AI Operations Assistant Identity & Safety', () => {
    const header = read('src/components/layout/AdminHeader.tsx');
    assert.match(header, /path: '\/admin\/ai-assistant', ar: 'مساعد PHANTOMS الذكي', en: 'AI assistant'/);

    const aiPage = read('src/features/ai-assistant/AiAssistantPage.tsx');
    assert.match(aiPage, /t\('مساعد PHANTOMS الذكي', 'PHANTOMS AI Assistant'\)/);

    const aiMessages = read('src/features/ai-assistant/AiMessages.tsx');
    assert.match(aiMessages, /t\('جارٍ إعداد الرد\.\.\.', 'Preparing a response\.\.\.'\)/);

    const conversation = read('src/features/ai-assistant/useAiConversation.ts');
    assert.match(conversation, /أنا مساعد PHANTOMS الذكي/);
    assert.match(conversation, /author: 'PHANTOMS Assistant'/);

    const aiApi = read('src/features/ai-assistant/api.ts');
    assert.match(aiApi, /مساعد PHANTOMS الذكي/);
  });

  await t.test('7. Spreadsheet Management: XLSX Import Gate & Export Hardening', () => {
    const actions = read('src/features/members/MemberExcelActions.tsx');
    assert.match(actions, /const XLSX_IMPORT_DISABLED = true/);
    assert.match(actions, /CVE-2026-78206/);
    assert.match(actions, /disabled={XLSX_IMPORT_DISABLED}/);

    const excel = read('src/features/members/memberExcel.ts');
    assert.match(excel, /workbook\.addWorksheet\('أعضاء PHANTOMS'/);
    assert.match(excel, /phantoms-members-\$\{new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\}\.xlsx/);
    assert.match(excel, /title: 'دليل أعضاء PHANTOMS'/);
    assert.match(excel, /function safeCell\(value/);
    assert.match(excel, /['`]\${text}/);
  });

  await t.test('8. Feature Pages & Notification Surfaces', () => {
    const dashboard = read('src/features/dashboard/DashboardPage.tsx');
    assert.match(dashboard, /لوحة الفريق', 'Team dashboard'/);
    assert.match(dashboard, /PhantomsSymbol/);
    assert.match(dashboard, /'المساعد الذكي', 'AI assistant'/);

    const pwa = read('src/hooks/usePWA.ts');
    assert.match(pwa, /تم تفعيل إشعارات PHANTOMS/);
    assert.match(pwa, /رسالة إشعار تجريبية — PHANTOMS/);

    const notifs = read('src/lib/notifications.ts');
    assert.match(notifs, /name: 'إشعارات PHANTOMS الفورية'/);
    assert.match(notifs, /summaryText: 'PHANTOMS — بوابة الفريق'/);
    assert.match(notifs, /senderName: payload\.senderName \|\| 'PHANTOMS — الإدارة'/);

    const notifCenter = read('src/features/portal/WhatsAppNotificationCenter.tsx');
    assert.match(notifCenter, /إشعارات PHANTOMS الفورية/);
    assert.match(notifCenter, /PHANTOMS — الإدارة/);
  });

  await t.test('9. CI Workflow & Release Artifacts', () => {
    const ci = readFileSync(resolve(ROOT, '..', '.github', 'workflows', 'build-apk.yml'), 'utf8');
    assert.match(ci, /name: Build PHANTOMS Android APK/);
    assert.match(ci, /name: "تطبيق PHANTOMS للأندرويد \(Release APK\)"/);
    assert.match(ci, /phantoms-app\.apk/);

    const script = read('scripts/build-apk.mjs');
    assert.match(script, /phantoms-app\.apk/);
  });
});
