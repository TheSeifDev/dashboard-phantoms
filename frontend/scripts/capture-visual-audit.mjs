import { chromium } from '@playwright/test';
import { preview } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = path.resolve('.');
const OUT_DIR = path.resolve('../audit/screenshots/phase2_4');

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];

const mockMembers = [
  {
    id: 101,
    created_at: '2026-09-01T10:00:00Z',
    email: 'ahmed.ali@phantoms.org',
    full_name: 'أحمد علي',
    phone: '+201012345678',
    team: 'تطوير البرمجيات',
    completion_rank: 95,
    bio: 'مهندس نظم ومطور Full-Stack',
    device: 'LAPTOP',
    meeting_attendance: 'REGULAR',
    work_status: 'ACTIVE',
    can_go_alexandria: true,
    residence: 'القاهرة',
    work_conditions: 'متاح دوام كامل',
    gender: 'MALE',
    custom_fields: {}
  },
  {
    id: 102,
    created_at: '2026-09-02T11:00:00Z',
    email: 'sarah.nour@phantoms.org',
    full_name: 'سارة نور',
    phone: '+201098765432',
    team: 'تصميم الواجهات UI/UX',
    completion_rank: 88,
    bio: 'مصممة واجهات وتجربة مستخدم',
    device: 'LAPTOP',
    meeting_attendance: 'REGULAR',
    work_status: 'ACTIVE',
    can_go_alexandria: true,
    residence: 'الجيزة',
    work_conditions: 'متاح جزئي',
    gender: 'FEMALE',
    custom_fields: {}
  },
  {
    id: 103,
    created_at: '2026-09-03T09:00:00Z',
    email: 'omar.tarek@phantoms.org',
    full_name: 'عمر طارق',
    phone: '+201123456789',
    team: 'إدارة العمليات والدعم',
    completion_rank: 78,
    bio: 'منسق عمليات وتشغيل فني',
    device: 'MOBILE',
    meeting_attendance: 'REGULAR',
    work_status: 'ACTIVE',
    can_go_alexandria: false,
    residence: 'الإسكندرية',
    work_conditions: 'متاح دوام كامل',
    gender: 'MALE',
    custom_fields: {}
  }
];

const mockTasks = [
  {
    id: 201,
    created_at: '2026-10-01T12:00:00Z',
    title: 'مراجعة الهوية البصرية وإطلاق نظام PHANTOMS',
    description: 'استكمال تدقيق كافة واجهات لوحة التحكم وبوابة الأعضاء وتوثيق الاعتماد.',
    has_deadline: true,
    deadline_date: '2026-11-15',
    assigned_to: 'ALL',
    tracking: {
      '101': { status: 'approved', note: 'تم اعتماد الفحص الأمني', submission_url: 'https://github.com/TheSeifDev/dashboard-phantoms', updated_at: '2026-11-05T14:00:00Z' },
      '102': { status: 'under_review', note: 'تم تسليم تصاميم الشاشات للمراجعة', submission_url: 'https://figma.com/phantoms', updated_at: '2026-11-06T16:00:00Z' },
      '103': { status: 'in_progress', note: 'جاري التنسيق', updated_at: '2026-11-07T10:00:00Z' }
    }
  },
  {
    id: 202,
    created_at: '2026-10-10T14:00:00Z',
    title: 'إعداد تقرير تدقيق الأمان والاستقرار التقني',
    description: 'فحص ثغرات الحزم وتوثيق اختبارات الحماية وتأكيد حظر استيراد XLSX.',
    has_deadline: true,
    deadline_date: '2026-11-20',
    assigned_to: [101],
    tracking: {
      '101': { status: 'approved', note: 'تم الانتهاء والتحقق 100%', submission_url: 'https://github.com/TheSeifDev/dashboard-phantoms', updated_at: '2026-11-07T12:00:00Z' }
    }
  }
];

const mockNotes = [
  {
    id: 301,
    created_at: '2026-10-05T12:00:00Z',
    text: 'ترحيب بفريق PHANTOMS مع تدشين بيئة العمل الجديدة.',
    author: 'إدارة PHANTOMS',
    author_role: 'ADMIN',
    date: '2026-10-05',
    target_team: null,
    target_member_id: null
  },
  {
    id: 302,
    created_at: '2026-10-12T14:00:00Z',
    text: 'مكافأة تميز في إنجاز التدقيق الأمني',
    author: 'إدارة PHANTOMS',
    author_role: 'ADMIN',
    date: '2026-10-12',
    target_team: null,
    target_member_id: 101,
    bonus_points: 25
  }
];

const mockAnnouncements = [
  {
    id: 401,
    created_at: '2026-11-01T10:00:00Z',
    title: 'إعلان تدشين منصة PHANTOMS الرسمية',
    content: 'نعلن لجميع الأعضاء والمشرفين اعتماد الهوية التشغيلية الجديدة لمنظومة PHANTOMS.',
    author_name: 'إدارة PHANTOMS',
    target_audience: 'ALL',
    priority: 'HIGH',
    views_count: 42
  }
];

const mockEvaluations = [
  {
    id: 501,
    created_at: '2026-11-02T11:00:00Z',
    member_id: 101,
    title: 'تقييم الأداء التقني للربع الرابع',
    grade: 'excellent',
    points: 95,
    feedback: 'أداء استثنائي والتزام تام بمعايير الجودة والأمان البرمجي.',
    evaluator_name: 'إدارة PHANTOMS',
    bonus_note_id: 302,
    viewed_at: '2026-11-03T10:00:00Z',
    read_at: '2026-11-03T10:05:00Z',
    mode: 'native'
  },
  {
    id: 502,
    created_at: '2026-11-03T14:00:00Z',
    member_id: 102,
    title: 'تقييم تصاميم الواجهات وتجربة المستخدم',
    grade: 'very_good',
    points: 88,
    feedback: 'مستوى احترافي في إعداد شاشات وتجاوب الهواتف الذكية.',
    evaluator_name: 'إدارة PHANTOMS',
    bonus_note_id: null,
    viewed_at: '2026-11-04T09:00:00Z',
    read_at: '2026-11-04T09:02:00Z',
    mode: 'native'
  }
];

const mockAdminSession = {
  access_token: 'fake-admin-jwt-token',
  token_type: 'bearer',
  expires_in: 3600,
  refresh_token: 'fake-refresh-token',
  user: {
    id: 'admin-ph-uuid',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'admin@phantoms.com',
    app_metadata: { provider: 'email' },
    user_metadata: { full_name: 'إدارة عمليات PHANTOMS' },
    created_at: '2026-09-01T00:00:00Z'
  }
};

const mockMemberSession = {
  id: 101,
  created_at: '2026-09-01T10:00:00Z',
  email: 'ahmed.ali@phantoms.org',
  full_name: 'أحمد علي',
  phone: '+201012345678',
  team: 'تطوير البرمجيات',
  completion_rank: 95,
  bio: 'مهندس نظم ومطور Full-Stack',
  device: 'LAPTOP',
  meeting_attendance: 'REGULAR',
  work_status: 'ACTIVE',
  can_go_alexandria: true
};

async function main() {
  console.log('--- PHANTOMS Phase 2.2 Visual Audit Screenshot Capture ---');
  console.log('1. Starting Vite preview server...');
  const server = await preview({
    root: ROOT_DIR,
    preview: {
      port: 4175,
      strictPort: true,
      host: '127.0.0.1'
    }
  });

  const baseUrl = 'http://127.0.0.1:4175';
  console.log(`Vite preview listening at ${baseUrl}`);

  console.log('2. Launching Google Chrome via Playwright...');
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  });

  const context = await browser.newContext();

  // Setup route interceptors for Supabase REST & Auth & WhatsApp
  await context.route('**/auth/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/user')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockAdminSession.user)
      });
      return;
    }
    if (url.pathname.includes('/token')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockAdminSession)
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await context.route('**/rest/v1/**', async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname.includes('/rpc/get_admin_access')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          is_admin: true,
          is_owner: true,
          permissions: {
            can_manage_members: true,
            can_manage_tasks: true,
            can_view_evaluations: true,
            can_manage_ranking: true,
            can_manage_notes: true,
            can_send_whatsapp: true,
            can_use_ai: true,
            can_manage_announcements: true,
            can_manage_admins: true
          }
        })
      });
      return;
    }

    if (url.pathname.includes('/rpc/admin_list_accounts')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'admin-ph-uuid',
            email: 'admin@phantoms.com',
            full_name: 'إدارة العمليات',
            is_owner: true,
            created_at: '2026-09-01T00:00:00Z',
            permissions: { can_manage_members: true }
          }
        ])
      });
      return;
    }

    if (url.pathname.includes('/rpc/get_member_tasks')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockTasks)
      });
      return;
    }

    if (url.pathname.includes('/rpc/get_member_evaluations')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockEvaluations)
      });
      return;
    }

    if (url.pathname.includes('/rpc/get_member_announcements')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockAnnouncements)
      });
      return;
    }

    if (url.pathname.includes('/members')) {
      const isSingle = route.request().headers()['accept']?.includes('application/vnd.pgrst.object');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(isSingle ? mockMembers[0] : mockMembers)
      });
      return;
    }

    if (url.pathname.includes('/tasks')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockTasks)
      });
      return;
    }

    if (url.pathname.includes('/notes')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockNotes)
      });
      return;
    }

    if (url.pathname.includes('/announcements')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockAnnouncements)
      });
      return;
    }

    if (url.pathname.includes('/member_evaluations')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockEvaluations)
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([])
    });
  });

  await context.route('**/functions/v1/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ configured: true, enabled: true, templateName: 'phantoms_task_assignment' })
    });
  });

  await context.route('**/whatsapp-bridge/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ connected: true, status: 'connected' })
    });
  });

  const page = await context.newPage();

  // Helper to capture across 3 viewports
  async function captureViewports(surfaceKey, urlPath) {
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${baseUrl}${urlPath}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(700);
      const currentUrl = page.url();
      console.log(`  [${vp.name}] URL: ${currentUrl}`);
      const filename = `${surfaceKey}-${vp.name}.png`;
      const targetPath = path.join(OUT_DIR, filename);
      await page.screenshot({ path: targetPath, fullPage: true });
      const stat = fs.statSync(targetPath);
      console.log(`  -> Saved ${filename} (${stat.size} bytes)`);
    }
  }

  // 1. Admin login (public)
  console.log('\n--- 1. Admin Login Surface ---');
  await page.goto(`${baseUrl}/admin/login`, { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await captureViewports('admin-login', '/admin/login');

  // 2. Member login (public)
  console.log('\n--- 2. Member Login Surface ---');
  await captureViewports('member-login', '/login');

  // Perform Admin Login via Form to naturally establish authenticated session
  console.log('\n--- Logging into Admin Session ---');
  await page.goto(`${baseUrl}/admin/login`, { waitUntil: 'networkidle' });
  await page.fill('#admin-email', 'admin@phantoms.com');
  await page.fill('#admin-password', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/admin/dashboard', { timeout: 10000 });
  console.log('Successfully authenticated as Admin. Current URL:', page.url());

  // 3. Admin dashboard
  console.log('\n--- 3. Admin Dashboard Surface ---');
  await captureViewports('dashboard', '/admin/dashboard');

  // 4. Member directory
  console.log('\n--- 4. Member Directory Surface ---');
  await captureViewports('members', '/admin/members');

  // 5. Tasks
  console.log('\n--- 5. Tasks Surface ---');
  await captureViewports('tasks', '/admin/tasks');

  // 6. Evaluations
  console.log('\n--- 6. Evaluations Surface ---');
  await captureViewports('evaluations', '/admin/evaluations');

  // 7. Ranking
  console.log('\n--- 7. Ranking Surface ---');
  await captureViewports('ranking', '/admin/ranking');

  // 8. Announcements
  console.log('\n--- 8. Announcements Surface ---');
  await captureViewports('announcements', '/admin/announcements');

  // 9. AI assistant
  console.log('\n--- 9. AI Assistant Surface ---');
  await captureViewports('ai-assistant', '/admin/ai-assistant');

  // 10. WhatsApp management
  console.log('\n--- 10. WhatsApp Management Surface ---');
  await captureViewports('whatsapp', '/admin/whatsapp');

  // 11. Member portal
  console.log('\n--- 11. Member Portal Surface ---');
  await page.evaluate((m) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('phantoms_member_session', JSON.stringify(m));
    localStorage.setItem('phantoms_device_token', 'mock-device-token-101');
    localStorage.setItem('phantoms_member_remember', '1');
  }, mockMemberSession);
  await captureViewports('member-portal', '/portal');

  console.log('\nAll 11 surfaces captured across 3 viewports (33 screenshots total).');
  console.log('Closing browser and preview server...');
  await browser.close();
  server.httpServer.close();
  console.log('Visual audit capture complete!');
}

main().catch((err) => {
  console.error('Fatal error during visual audit capture:', err);
  process.exit(1);
});
