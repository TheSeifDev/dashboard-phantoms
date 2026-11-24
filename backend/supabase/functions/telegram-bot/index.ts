// PHANTOMS team bot — one webhook for every surface of the dashboard.
//
// POST /telegram-bot            ← Telegram update webhook (secret token header)
// POST /telegram-bot {action}   ← { action: 'drain' } from pg_cron, { action: 'sync' } from
//                                 the admin page (sets the webhook), { action: 'status' }.
//
// Everything the bot says is queued in public.telegram_outbox by database triggers, so a
// message survives a cold start and is retried up to five times before it is marked failed.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const TELEGRAM_API = 'https://api.telegram.org';
const MAX_MESSAGE = 3900;

type Json = Record<string, unknown>;

const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const esc = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const money = (value: unknown) =>
  Number(value ?? 0).toLocaleString('en-EG', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const clip = (value: unknown, size = MAX_MESSAGE) => {
  const text = String(value ?? '');
  return text.length > size ? `${text.slice(0, size - 1)}…` : text;
};

const cairoTime = (value: unknown) => {
  if (!value) return '—';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short',
  }).format(date);
};

type BotConfig = {
  enabled: boolean;
  token: string | null;
  bot_username: string | null;
  webhook_secret: string;
  drain_url: string;
};

async function loadConfig(): Promise<BotConfig | null> {
  const { data, error } = await admin.rpc('telegram_bot_config');
  if (error || !data) return null;
  return data as BotConfig;
}

async function telegram(config: BotConfig, method: string, payload: Json) {
  if (!config.token) return { ok: false, description: 'missing token' } as Json;
  try {
    const response = await fetch(`${TELEGRAM_API}/bot${config.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return (await response.json()) as Json;
  } catch (error) {
    return { ok: false, description: String(error) } as Json;
  }
}

async function send(config: BotConfig, chatId: number, text: string, keyboard?: Json) {
  const payload: Json = {
    chat_id: chatId,
    text: clip(text),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (keyboard) payload.reply_markup = keyboard;
  return telegram(config, 'sendMessage', payload);
}

const backKeyboard = { inline_keyboard: [[{ text: 'القائمة', callback_data: 'menu' }]] };

/* ─────────────────────────── outbox drain ─────────────────────────── */

async function drain(config: BotConfig, limit = 20) {
  if (!config.token) return { sent: 0, failed: 0, skipped: 0 };
  const { data: rows, error } = await admin.rpc('telegram_claim_outbox', { p_limit: limit });
  if (error || !rows) return { sent: 0, failed: 0, skipped: 0, error: error?.message };
  let sent = 0;
  let failed = 0;
  for (const row of rows as Array<{ id: number; chat_id: number; body: string }>) {
    const result = await telegram(config, 'sendMessage', {
      chat_id: row.chat_id,
      text: clip(row.body),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    if (result.ok) {
      sent += 1;
      const messageId = (result.result as Json | undefined)?.message_id;
      await admin.rpc('telegram_complete_outbox', {
        p_id: row.id, p_ok: true, p_error: null, p_message_id: typeof messageId === 'number' ? messageId : null,
      });
    } else {
      failed += 1;
      const description = String(result.description ?? 'unknown error');
      const blocked = /blocked|chat not found|user is deactivated|bot was kicked/i.test(description);
      await admin.rpc('telegram_complete_outbox', {
        p_id: row.id,
        p_ok: false,
        p_error: description,
        p_message_id: null,
      });
      if (blocked) {
        await admin.from('telegram_outbox').update({ status: 'skipped' }).eq('id', row.id);
      }
    }
  }
  return { sent, failed, skipped: rows.length - sent - failed };
}

/* ─────────────────────────── commands ─────────────────────────── */

const HELP = [
  '<b>بوت PHANTOMS</b>',
  'كل حاجة التيم في مكان واحد. الأوامر:',
  '',
  '/me — بياناتك ونقاطك وترتيبك',
  '/tasks — مهامك المفتوحة',
  '/points — نقاطك وتفاصيل البونص',
  '/ranking — ترتيب الفريق',
  '/announcements — آخر الإعلانات',
  '/meetings — الاجتماعات الجاية وحضورك',
  '/ledger — الخزنة وحسابك',
  '/refs — المصادر',
  '/evals — تقييماتك',
  '/strikes — تحذيراتك',
  '/team — تيماتك',
  '/projects — مشاريع الويب',
  '/requests — طلبات الصلاحيات (للمالك)',
  '/stats — نظرة سريعة (للإدارة)',
  '/broadcast نص — بث لكل الفريق (للإدارة)',
  '/mute و /unmute — توقف/تشغل الإشعارات',
  '/unlink — فصل الحساب',
].join('\n');

// ربط أوتوماتيك: تلجرام بيبعت رقم العضو اللي هو نفسه ضغط الزر، فبنطابقه مع
// members.phone من غير أي كود يتكتب بالإيد.
const contactKeyboard = {
  keyboard: [[{ text: 'شارك رقمي واربط أوتوماتيك', request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

function backToMenuKeyboard() {
  return { inline_keyboard: [[{ text: 'إلغاء', callback_data: 'menu' }]] };
}

function menuKeyboard(isAdmin: boolean) {
  const rows: Json[][] = [
    [{ text: 'بياناتي', callback_data: 'me' }, { text: 'مهامي', callback_data: 'tasks' }],
    [{ text: 'نقاطي', callback_data: 'points' }, { text: 'الترتيب', callback_data: 'ranking' }],
    [{ text: 'الإعلانات', callback_data: 'announcements' }, { text: 'الاجتماعات', callback_data: 'meetings' }],
    [{ text: 'الخزنة', callback_data: 'ledger' }, { text: 'المصادر', callback_data: 'refs' }],
    [{ text: 'تقييماتي', callback_data: 'evals' }, { text: 'تحذيراتي', callback_data: 'strikes' }],
  ];
  if (isAdmin) {
    rows.push([{ text: 'نظرة الإدارة', callback_data: 'stats' }, { text: 'طلبات الصلاحيات', callback_data: 'requests' }]);
  }
  return { inline_keyboard: rows };
}

type Context = {
  linked: boolean;
  user_id?: string;
  member_id?: number | null;
  full_name?: string | null;
  email?: string | null;
  muted?: boolean;
  is_admin?: boolean;
  is_owner?: boolean;
  can_manage_bot?: boolean;
};

async function context(chatId: number): Promise<Context> {
  const { data } = await admin.rpc('telegram_bot_context', { p_chat_id: chatId });
  return (data ?? { linked: false }) as Context;
}

async function memberSnapshot(memberId: number) {
  const { data } = await admin.rpc('telegram_member_snapshot', { p_member_id: memberId });
  return data as Json | null;
}

async function renderMe(ctx: Context) {
  if (!ctx.member_id) {
    return `<b>${esc(ctx.full_name ?? 'حساب إداري')}</b>\n${esc(ctx.email ?? '')}\nحسابك مش مربوط بعضو في الفريق، فمفيش نقاط أو مهام.`;
  }
  const snap = await memberSnapshot(Number(ctx.member_id));
  if (!snap) return 'مش لاقي بياناتك.';
  const teams = Array.isArray(snap.teams) ? (snap.teams as string[]).join(' · ') : '—';
  const lines = [
    `<b>${esc(snap.full_name)}</b>`,
    `${esc(snap.email)} · ${esc(snap.work_status ?? '—')}`,
    `الفريق: ${esc(teams || '—')}`,
    '',
    `النقاط: <b>${esc(snap.bonus)}</b> · الترتيب: <b>#${esc(snap.rank)}</b>`,
    `مهام مفتوحة: ${esc(snap.open_tasks)} · متأخرة: ${esc(snap.late_tasks)}`,
    `تحذيرات: ${esc(snap.strikes)} من 3`,
    `مستحقات الخزنة: ${money(snap.dues_outstanding)}`,
  ];
  const next = snap.next_meeting as Json | null;
  if (next) lines.push('', `أقرب اجتماع: ${esc(next.title)} — ${cairoTime(next.starts_at)}`);
  return lines.join('\n');
}

async function renderTasks(ctx: Context) {
  if (!ctx.member_id) return 'الحساب ده مش مربوط بعضو.';
  const { data } = await admin.rpc('telegram_member_tasks', { p_member_id: ctx.member_id, p_limit: 8 });
  const rows = (data ?? []) as Json[];
  if (!rows.length) return 'مفيش مهام مفتوحة عندك. تمام.';
  const lines = ['<b>مهامك المفتوحة</b>'];
  const buttons: Json[][] = [];
  rows.forEach((task, index) => {
    lines.push('', `${index + 1}. ${esc(task.title)}`);
    if (task.deadline) lines.push(`   الموعد: ${esc(task.deadline)}`);
    lines.push(`   الحالة: ${esc(task.status)}`);
    if (index < 5) buttons.push([{ text: `أنهيت: ${String(task.title).slice(0, 22)}`, callback_data: `done:${task.id}` }]);
  });
  return { text: lines.join('\n'), keyboard: { inline_keyboard: buttons } };
}

async function renderPoints(ctx: Context) {
  if (!ctx.member_id) return 'الحساب ده مش مربوط بعضو.';
  const snap = await memberSnapshot(Number(ctx.member_id));
  if (!snap) return 'مش لاقي بياناتك.';
  return [
    '<b>نقاطك</b>',
    `الإجمالي: <b>${esc(snap.bonus)}</b>`,
    `ترتيبك: #${esc(snap.rank)}`,
    snap.bonus ? '' : 'لسه مفيش بونص مسجل.',
  ].filter(Boolean).join('\n');
}

async function renderRanking() {
  const { data } = await admin.rpc('telegram_leaderboard_top', { p_limit: 10 });
  const rows = (data ?? []) as Json[];
  if (!rows.length) return 'الترتيب فاضي.';
  return ['<b>ترتيب الفريق</b>', ...rows.map((row) =>
    `${esc(row.rank)}. ${esc(row.full_name)} — ${row.bonus_infinite ? 'بونص مفتوح' : esc(row.bonus)}`)].join('\n');
}

async function renderAnnouncements(ctx: Context) {
  if (!ctx.member_id) return 'الحساب ده مش مربوط بعضو.';
  const { data } = await admin.rpc('telegram_member_announcements', { p_member_id: ctx.member_id, p_limit: 5 });
  const rows = (data ?? []) as Json[];
  if (!rows.length) return 'مفيش إعلانات حالية.';
  return ['<b>آخر الإعلانات</b>', ...rows.map((row) =>
    `\n<b>${esc(row.title)}</b> (${cairoTime(row.created_at)})\n${esc(clip(row.content, 500))}`)].join('\n');
}

async function renderMeetings(ctx: Context) {
  if (!ctx.member_id) return 'الحساب ده مش مربوط بعضو.';
  const { data } = await admin.rpc('telegram_member_meetings', { p_member_id: ctx.member_id, p_limit: 6 });
  const rows = (data ?? []) as Json[];
  if (!rows.length) return 'مفيش اجتماعات قريبة.';
  const lines = ['<b>الاجتماعات</b>'];
  rows.forEach((row) => {
    lines.push('', `<b>${esc(row.title)}</b> — ${cairoTime(row.starts_at)}`);
    lines.push(`النوع: ${row.mode === 'online' ? 'أونلاين' : 'أوفلاين'}`);
    if (row.mode === 'online' && row.online_url) lines.push(`الرابط: ${esc(row.online_url)}`);
    if (row.mode !== 'online' && row.location) lines.push(`المكان: ${esc(row.location)}`);
    lines.push(row.attended ? 'الحضور: مسجل' : 'الحضور: لسه');
  });
  return lines.join('\n');
}

async function renderLedger(ctx: Context) {
  if (!ctx.member_id) return 'الحساب ده مش مربوط بعضو.';
  const { data } = await admin.rpc('telegram_member_ledger', { p_member_id: ctx.member_id });
  const payload = (data ?? {}) as Json;
  const summary = (payload.summary ?? {}) as Json;
  const mine = (payload.mine ?? {}) as Json;
  return [
    '<b>الخزنة</b>',
    `المتاح: ${money(summary.available)}`,
    `إجمالي المدفوع: ${money(summary.collected)}`,
    `المصروف: ${money(summary.expenses)}`,
    `قيد المراجعة: ${money(summary.pending)}`,
    '',
    `<b>حسابك</b>`,
    `دفعت: ${money(mine.paid)}`,
    `قيد المراجعة: ${money(mine.pending)}`,
    `مستحق عليك: ${money(mine.dues)}`,
  ].join('\n');
}

async function renderRefs(ctx: Context) {
  const teamSlug = await primaryTeamSlug(ctx);
  const { data } = await admin.rpc('telegram_references_all', { p_team_slug: teamSlug, p_limit: 10 });
  const rows = (data ?? []) as Json[];
  if (!rows.length) return 'مفيش مصادر مسجلة.';
  return ['<b>المصادر</b>', ...rows.map((row) =>
    `\n<b>${esc(row.title)}</b>${row.team ? ` (${esc(row.team)})` : ' (عام)'}\n${esc(row.url)}`)].join('\n');
}

async function primaryTeamSlug(ctx: Context): Promise<string | null> {
  if (!ctx.member_id) return null;
  const { data } = await admin
    .from('team_memberships')
    .select('teams!inner(slug, is_active)')
    .eq('member_id', ctx.member_id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  const team = (data as { teams?: { slug?: string } } | null)?.teams;
  return team?.slug ?? null;
}

async function renderEvals(ctx: Context) {
  if (!ctx.member_id) return 'الحساب ده مش مربوط بعضو.';
  const { data } = await admin.rpc('telegram_member_evaluations', { p_member_id: ctx.member_id, p_limit: 5 });
  const rows = (data ?? []) as Json[];
  if (!rows.length) return 'مفيش تقييمات لسه.';
  return ['<b>تقييماتك</b>', ...rows.map((row) =>
    `\n<b>${esc(row.title)}</b> — ${esc(row.grade ?? '—')} (${esc(row.points ?? 0)} نقطة)\n${esc(clip(row.feedback, 300))}`)].join('\n');
}

async function renderStrikes(ctx: Context) {
  if (!ctx.member_id) return 'الحساب ده مش مربوط بعضو.';
  const { data } = await admin.rpc('telegram_member_strikes', { p_member_id: ctx.member_id });
  const rows = (data ?? []) as Json[];
  if (!rows.length) return 'مفيش تحذيرات. سجل نضيف.';
  return [`<b>تحذيراتك (${rows.length} من 3)</b>`, ...rows.map((row) =>
    `\n${cairoTime(row.created_at)} — ${esc(row.reason)}\nبواسطة: ${esc(row.issued_by ?? '—')}`)].join('\n');
}

async function renderTeam(ctx: Context) {
  if (!ctx.member_id) return 'الحساب ده مش مربوط بعضو.';
  const { data } = await admin
    .from('team_memberships')
    .select('status, teams(name, slug, is_active)')
    .eq('member_id', ctx.member_id);
  const rows = (data ?? []) as Array<{ status: string; teams?: { name?: string; is_active?: boolean } }>;
  if (!rows.length) return 'مش مسجل في تيم داخلي.';
  return ['<b>تيماتك</b>', ...rows.map((row) =>
    `${esc(row.teams?.name ?? '—')} — ${row.status === 'active' ? 'نشط' : row.status}`)].join('\n');
}

async function renderProjects() {
  const { data } = await admin
    .from('web_projects')
    .select('name, status, priority, expected_delivery_date')
    .order('created_at', { ascending: false })
    .limit(10);
  const rows = (data ?? []) as Json[];
  if (!rows.length) return 'مفيش مشاريع ويب.';
  return ['<b>مشاريع الويب</b>', ...rows.map((row) =>
    `\n<b>${esc(row.name)}</b>\nالحالة: ${esc(row.status ?? '—')} · الأولوية: ${esc(row.priority ?? '—')}` +
    (row.expected_delivery_date ? `\nالتسليم: ${esc(row.expected_delivery_date)}` : ''))].join('\n');
}

async function renderStats() {
  const { data } = await admin.rpc('telegram_admin_snapshot');
  const s = (data ?? {}) as Json;
  return [
    '<b>نظرة الإدارة</b>',
    `الأعضاء: ${esc(s.members)} · المشرفين: ${esc(s.admins)}`,
    `مهام مفتوحة: ${esc(s.open_tasks)}`,
    `دفعات بانتظار التأكيد: ${esc(s.pending_payments)}`,
    `طلبات صلاحيات: ${esc(s.pending_capability_requests)}`,
    `طلبات حذف حساب: ${esc(s.pending_account_deletions)}`,
    `اجتماعات جاية: ${esc(s.upcoming_meetings)}`,
    '',
    `شاتات مربوطة: ${esc(s.linked_chats)} · رسائل في الانتظار: ${esc(s.outbox_pending)}`,
  ].join('\n');
}

async function renderRequests() {
  const { data } = await admin.rpc('telegram_owner_requests');
  const rows = (data ?? []) as Json[];
  if (!rows.length) return 'مفيش طلبات صلاحيات معلقة.';
  const lines = ['<b>طلبات الصلاحيات</b>'];
  const buttons: Json[][] = [];
  rows.forEach((row) => {
    lines.push('', `#${esc(row.id)} — ${esc(row.capability)}`);
    lines.push(`من: ${esc(row.email ?? '—')} · ${cairoTime(row.requested_at)}`);
    if (row.note) lines.push(`ملاحظة: ${esc(clip(row.note, 160))}`);
    buttons.push([
      { text: `موافقة 60د #${row.id}`, callback_data: `cap:60:${row.id}` },
      { text: `موافقة 24س #${row.id}`, callback_data: `cap:1440:${row.id}` },
      { text: `رفض #${row.id}`, callback_data: `cap:0:${row.id}` },
    ]);
  });
  return { text: lines.join('\n'), keyboard: { inline_keyboard: buttons } };
}

async function pendingLedgerButtons(ctx: Context): Promise<Json | null> {
  if (!ctx.user_id) return null;
  const { data } = await admin
    .from('team_ledger_entries')
    .select('id, title, amount, member_id')
    .eq('receiver_user_id', ctx.user_id)
    .eq('status', 'pending')
    .eq('kind', 'payment')
    .order('id', { ascending: false })
    .limit(5);
  const rows = (data ?? []) as Json[];
  if (!rows.length) return null;
  const buttons = rows.flatMap((row) => [[
    { text: `تأكيد ${money(row.amount)} #${row.id}`, callback_data: `ledger:1:${row.id}` },
    { text: `رفض #${row.id}`, callback_data: `ledger:0:${row.id}` },
  ]]);
  return { inline_keyboard: buttons };
}

/* ─────────────────────────── updates ─────────────────────────── */

async function handleCommand(config: BotConfig, chatId: number, text: string, ctx: Context) {
  const [raw, ...rest] = text.trim().split(/\s+/);
  const command = raw.replace(/@\w+$/, '').toLowerCase();
  const argument = rest.join(' ').trim();

  switch (command) {
    case '/start': {
      if (argument) {
        const { data } = await admin.rpc('telegram_link_chat', {
          p_code: argument,
          p_chat_id: chatId,
          p_username: null,
          p_first_name: null,
        });
        const result = (data ?? {}) as Json;
        if (result.ok) {
          const refreshed = await context(chatId);
          await send(config, chatId,
            `تم ربط حسابك${refreshed.full_name ? ` يا ${refreshed.full_name}` : ''}.\n` +
            'من دلوقتي كل إشعارات الفريق هتوصلك هنا.\n\n' + HELP,
            menuKeyboard(Boolean(refreshed.is_admin)));
          return;
        }
        await send(config, chatId, 'الكود غير صالح أو انتهت صلاحيته. اعمل كود جديد من إعدادات البوابة.');
        return;
      }
      if (!ctx.linked) {
        await send(config, chatId,
          'أهلًا بيك في بوت PHANTOMS.\n\n' +
          'أسهل طريقة للربط: اضغط الزرار اللي تحت وشارك رقم الموبايل المسجل في البوابة — الربط بيتم أوتوماتيك.\n\n' +
          'أو لو عندك كود من البوابة ابعتلي: <code>/start الكود</code>',
          contactKeyboard);
        return;
      }
      await send(config, chatId, `أهلًا ${esc(ctx.full_name ?? '')}\n\n${HELP}`, menuKeyboard(Boolean(ctx.is_admin)));
      return;
    }
    case '/help':
    case '/menu':
      await send(config, chatId, HELP, menuKeyboard(Boolean(ctx.is_admin)));
      return;
    case '/id':
      await send(config, chatId, `chat id: <code>${chatId}</code>`);
      return;
    default:
      break;
  }

  if (!ctx.linked) {
    await send(config, chatId, 'حسابك مش مربوط. ابعت /start مع الكود من البوابة.');
    return;
  }

  switch (command) {
    case '/me':
      await send(config, chatId, await renderMe(ctx), menuKeyboard(Boolean(ctx.is_admin)));
      return;
    case '/tasks': {
      const view = await renderTasks(ctx);
      if (typeof view === 'string') await send(config, chatId, view, backKeyboard);
      else await send(config, chatId, view.text as string, view.keyboard as Json);
      return;
    }
    case '/points':
      await send(config, chatId, await renderPoints(ctx), backKeyboard);
      return;
    case '/ranking':
      await send(config, chatId, await renderRanking(), backKeyboard);
      return;
    case '/announcements':
      await send(config, chatId, await renderAnnouncements(ctx), backKeyboard);
      return;
    case '/meetings':
      await send(config, chatId, await renderMeetings(ctx), backKeyboard);
      return;
    case '/ledger': {
      await send(config, chatId, await renderLedger(ctx), backKeyboard);
      const keyboard = await pendingLedgerButtons(ctx);
      if (keyboard) await send(config, chatId, 'عندك دفعات بانتظار تأكيدك:', keyboard);
      return;
    }
    case '/refs':
      await send(config, chatId, await renderRefs(ctx), backKeyboard);
      return;
    case '/evals':
      await send(config, chatId, await renderEvals(ctx), backKeyboard);
      return;
    case '/strikes':
      await send(config, chatId, await renderStrikes(ctx), backKeyboard);
      return;
    case '/team':
      await send(config, chatId, await renderTeam(ctx), backKeyboard);
      return;
    case '/projects':
      await send(config, chatId, await renderProjects(), backKeyboard);
      return;
    case '/requests': {
      if (!ctx.is_owner) {
        await send(config, chatId, 'الأمر ده للمالك بس.');
        return;
      }
      const view = await renderRequests();
      if (typeof view === 'string') await send(config, chatId, view);
      else await send(config, chatId, view.text as string, view.keyboard as Json);
      return;
    }
    case '/stats': {
      if (!ctx.is_admin) {
        await send(config, chatId, 'الأمر ده للإدارة بس.');
        return;
      }
      await send(config, chatId, await renderStats(), backKeyboard);
      return;
    }
    case '/broadcast': {
      if (!ctx.can_manage_bot) {
        await send(config, chatId, 'الأمر ده للإدارة بس.');
        return;
      }
      if (!argument) {
        await send(config, chatId, 'اكتب: <code>/broadcast نص الرسالة</code>');
        return;
      }
      const { data, error } = await admin.rpc('telegram_broadcast', {
        p_text: argument, p_audience: { type: 'all' },
      });
      await send(config, chatId, error ? `فشل البث: ${esc(error.message)}` : `تم جدولة البث لـ ${esc(data)} عضو.`);
      return;
    }
    case '/approve':
    case '/reject': {
      if (!ctx.is_owner) {
        await send(config, chatId, 'القرار ده للمالك بس.');
        return;
      }
      const [requestId, minutes] = argument.split(/\s+/);
      if (!requestId) {
        await send(config, chatId, `اكتب: <code>${command} رقم_الطلب [دقائق]</code>`);
        return;
      }
      const { data, error } = await admin.rpc('telegram_decide_request', {
        p_actor: ctx.user_id,
        p_request_id: Number(requestId),
        p_approve: command === '/approve',
        p_minutes: Number(minutes ?? 60),
        p_note: null,
      });
      await send(config, chatId, error ? `فشل: ${esc(error.message)}` : `تم: ${esc((data as Json)?.status)}`);
      return;
    }
    case '/mute':
    case '/unmute': {
      const { data } = await admin.rpc('telegram_set_muted_for_chat', {
        p_chat_id: chatId, p_muted: command === '/mute',
      });
      await send(config, chatId, data ? 'تم كتم الإشعارات. /unmute عشان ترجع.' : 'تم تشغيل الإشعارات.');
      return;
    }
    case '/unlink': {
      await admin.from('telegram_links').update({ revoked_at: new Date().toISOString() })
        .eq('chat_id', chatId).is('revoked_at', null);
      await send(config, chatId, 'تم فصل الحساب. تقدر تربط تاني في أي وقت من البوابة.');
      return;
    }
    default:
      await send(config, chatId, 'مش فاهم الأمر ده. /help فيه كل الأوامر.', backKeyboard);
  }
}

async function handleCallback(config: BotConfig, callbackId: string, chatId: number, data: string, ctx: Context) {
  await telegram(config, 'answerCallbackQuery', { callback_query_id: callbackId });
  const [scope, ...parts] = data.split(':');

  if (scope === 'menu') {
    await send(config, chatId, HELP, menuKeyboard(Boolean(ctx.is_admin)));
    return;
  }

  const simple: Record<string, () => Promise<string>> = {
    me: () => renderMe(ctx),
    points: () => renderPoints(ctx),
    ranking: () => renderRanking(),
    announcements: () => renderAnnouncements(ctx),
    meetings: () => renderMeetings(ctx),
    ledger: () => renderLedger(ctx),
    refs: () => renderRefs(ctx),
    evals: () => renderEvals(ctx),
    strikes: () => renderStrikes(ctx),
    team: () => renderTeam(ctx),
    projects: () => renderProjects(),
    stats: async () => (ctx.is_admin ? renderStats() : 'الأمر ده للإدارة بس.'),
    tasks: async () => {
      const view = await renderTasks(ctx);
      return typeof view === 'string' ? view : (view.text as string);
    },
    requests: async () => {
      if (!ctx.is_owner) return 'الأمر ده للمالك بس.';
      const view = await renderRequests();
      return typeof view === 'string' ? view : (view.text as string);
    },
  };

  if (simple[scope]) {
    await send(config, chatId, await simple[scope](), backKeyboard);
    return;
  }

  if (scope === 'done') {
    const taskId = Number(parts[0]);
    if (!ctx.member_id) {
      await send(config, chatId, 'الحساب ده مش مربوط بعضو.');
      return;
    }
    const { error } = await admin.rpc('telegram_task_done', { p_member_id: ctx.member_id, p_task_id: taskId });
    await send(config, chatId, error ? `فشل: ${esc(error.message)}` : 'تم تسجيل المهمة كمنتهية.');
    return;
  }

  if (scope === 'cap') {
    if (!ctx.is_owner) {
      await send(config, chatId, 'القرار ده للمالك بس.');
      return;
    }
    const minutes = Number(parts[0]);
    const requestId = Number(parts[1]);
    const { data, error } = await admin.rpc('telegram_decide_request', {
      p_actor: ctx.user_id,
      p_request_id: requestId,
      p_approve: minutes > 0,
      p_minutes: minutes > 0 ? minutes : 60,
      p_note: null,
    });
    await send(config, chatId, error ? `فشل: ${esc(error.message)}` : `تم تنفيذ القرار: ${esc((data as Json)?.status)}`);
    return;
  }

  if (scope === 'ledger') {
    const approve = parts[0] === '1';
    const entryId = Number(parts[1]);
    const { error } = await admin.rpc('telegram_ledger_decide', {
      p_actor: ctx.user_id, p_entry_id: entryId, p_approve: approve, p_note: null,
    });
    await send(config, chatId, error ? `فشل: ${esc(error.message)}` : (approve ? 'تم تأكيد الدفعة.' : 'تم رفض الدفعة.'));
  }
}

async function handleUpdate(config: BotConfig, update: Json) {
  const updateId = Number(update.update_id ?? 0);
  const message = update.message as Json | undefined;
  const callback = update.callback_query as Json | undefined;
  const chatId = Number(
    ((message?.chat as Json | undefined)?.id) ?? ((callback?.message as Json | undefined)?.chat as Json | undefined)?.id ?? 0,
  );

  if (updateId) {
    const { data: fresh } = await admin.rpc('telegram_log_update', { p_update_id: updateId, p_chat_id: chatId || null });
    if (fresh === false) return;
  }

  if (message && chatId) {
    const contact = message.contact as Json | undefined;
    if (contact) {
      const from = message.from as Json | undefined;
      const ownerId = Number((contact.user_id as number | undefined) ?? 0);
      // بنقبل الرقم بس لو العضو شارك رقمه هو (مش رقم حد تاني من دفتر تليفونه).
      if (ownerId && from?.id && ownerId !== Number(from.id as number | undefined)) {
        await send(config, chatId, 'ابعت رقمك إنت من نفس حسابك — مش رقم حد تاني.', contactKeyboard);
        return;
      }
      const { data, error } = await admin.rpc('telegram_link_self_by_contact', {
        p_phone: String(contact.phone_number ?? ''),
        p_chat_id: chatId,
        p_username: (from?.username as string | undefined) ?? null,
        p_first_name: (from?.first_name as string | undefined) ?? null,
      });
      const result = (data ?? {}) as Json;
      if (!error && result.ok) {
        const refreshed = await context(chatId);
        await send(config, chatId,
          `تم ربط حسابك${refreshed.full_name ? ` يا ${esc(refreshed.full_name)}` : ''} أوتوماتيك من رقمك.\n` +
          'من دلوقتي كل إشعارات الفريق هتوصلك هنا.\n\n' + HELP,
          menuKeyboard(Boolean(refreshed.is_admin)));
        return;
      }
      const reason = String(result.reason ?? '');
      const reply = reason === 'AMBIGUOUS'
        ? 'في أكتر من عضو مسجل بنفس الرقم، فمحتاج كود من البوابة: <code>/start الكود</code>'
        : reason === 'NO_MATCH'
          ? 'الرقم ده مش مسجل في البوابة. حدّث رقمك في «الحساب والإعدادات» أو اربط بكود: <code>/start الكود</code>'
          : 'معرفناش نربط الرقم ده. جرّب كود من البوابة: <code>/start الكود</code>';
      await send(config, chatId, reply, backToMenuKeyboard());
      return;
    }
    const text = String(message.text ?? '');
    if (!text.startsWith('/')) {
      const ctx = await context(chatId);
      if (ctx.linked) await send(config, chatId, 'اختار من القائمة:', menuKeyboard(Boolean(ctx.is_admin)));
      return;
    }
    const ctx = await context(chatId);
    try {
      await handleCommand(config, chatId, text, ctx);
      await admin.rpc('telegram_audit', {
        p_chat_id: chatId, p_user_id: ctx.user_id ?? null,
        p_command: text.split(/\s+/)[0].slice(0, 60), p_status: 'ok', p_detail: null,
      });
    } catch (error) {
      await admin.rpc('telegram_audit', {
        p_chat_id: chatId, p_user_id: ctx.user_id ?? null,
        p_command: text.split(/\s+/)[0].slice(0, 60), p_status: 'error', p_detail: String(error),
      });
      await send(config, chatId, 'حصل خطأ غير متوقع. جرّب تاني.');
    }
    return;
  }

  if (callback && chatId) {
    const ctx = await context(chatId);
    await handleCallback(config, String(callback.id), chatId, String(callback.data ?? ''), ctx);
  }
}

/* ─────────────────────────── entrypoint ─────────────────────────── */

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: Json = {};
  try {
    body = (await request.json()) as Json;
  } catch {
    body = {};
  }

  const config = await loadConfig();
  if (!config) return json({ error: 'config unavailable' }, 500);

  const action = String(body.action ?? '');

  if (action === 'drain') {
    if (request.headers.get('x-telegram-secret') !== config.webhook_secret) {
      return json({ error: 'forbidden' }, 403);
    }
    const result = await drain(config, 25);
    return json({ ok: true, ...result });
  }

  if (action === 'sync') {
    if (request.headers.get('x-telegram-secret') !== config.webhook_secret) {
      return json({ error: 'forbidden' }, 403);
    }
    if (!config.token) return json({ ok: false, error: 'missing token' }, 400);
    const result = await telegram(config, 'setWebhook', {
      url: config.drain_url,
      secret_token: config.webhook_secret,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    });
    if (result.ok) await admin.rpc('telegram_mark_webhook_set');
    else await admin.rpc('telegram_record_error', { p_error: String(result.description ?? 'setWebhook failed') });
    return json(result, result.ok ? 200 : 400);
  }

  // نفس التفعيل لكن من صفحة الإدارة بجلسة مشرف (من غير ما التوكين يطلع للمتصفح).
  if (action === 'sync-auth') {
    const bearer = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: userData } = await admin.auth.getUser(bearer);
    const userId = userData?.user?.id;
    if (!userId) return json({ error: 'unauthorized' }, 401);
    const { data: allowed } = await admin.rpc('telegram_admin_allowed', { p_user_id: userId });
    if (allowed !== true) return json({ error: 'forbidden' }, 403);
    if (!config.token) return json({ ok: false, description: 'لسه مفيش توكن محفوظ للبوت.' }, 400);
    const result = await telegram(config, 'setWebhook', {
      url: config.drain_url,
      secret_token: config.webhook_secret,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    });
    if (result.ok) await admin.rpc('telegram_mark_webhook_set');
    else await admin.rpc('telegram_record_error', { p_error: String(result.description ?? 'setWebhook failed') });
    return json(result, result.ok ? 200 : 400);
  }

  if (action === 'status') {
    if (request.headers.get('x-telegram-secret') !== config.webhook_secret) {
      return json({ error: 'forbidden' }, 403);
    }
    const info = config.token ? await telegram(config, 'getWebhookInfo', {}) : { ok: false };
    return json({ ok: true, webhook: info });
  }

  if (request.headers.get('x-telegram-bot-api-secret-token') !== config.webhook_secret) {
    return json({ error: 'forbidden' }, 403);
  }

  if (!config.enabled) return json({ ok: true, skipped: 'disabled' });

  try {
    await handleUpdate(config, body);
  } catch (error) {
    await admin.rpc('telegram_record_error', { p_error: String(error).slice(0, 400) });
  }

  // كل تحديث بيسحب شوية من الصادر، فالإشعارات بتوصل حتى لو الكرون واقف.
  const drainResult = await drain(config, 10).catch(() => ({ sent: 0 }));
  return json({ ok: true, ...drainResult });
});
