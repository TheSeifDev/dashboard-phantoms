import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { config, isConfigured } from './config.js';
import { requireAdmin } from './adminAuth.js';
import { disableBridge, enableBridge, getStatus, revokeSession, sendText, setDryRun } from './connection.js';
import { resolveAnnouncementMessage, resolveTaskMessage } from './taskMessage.js';

type JsonRecord = Record<string, unknown>;
const send = (res: ServerResponse, status: number, body: JsonRecord, origin = '') => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}) });
  res.end(JSON.stringify(body));
};

async function readBody(req: IncomingMessage): Promise<JsonRecord> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk.toString();
    if (raw.length > 16_384) throw new Error('حجم الطلب أكبر من المسموح.');
  }
  return raw ? JSON.parse(raw) as JsonRecord : {};
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin ?? '';
  if (origin && !config.origins.includes(origin.toLowerCase())) return send(res, 403, { error: 'النطاق غير مسموح.' });
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'authorization,content-type', Vary: 'Origin' });
    return res.end();
  }
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, configured: isConfigured(), dryRun: config.dryRun }, origin);
  try {
    const admin = await requireAdmin(req.headers.authorization);
    if (req.method === 'GET' && url.pathname === '/v1/status') return send(res, 200, { configured: isConfigured(), ...getStatus() }, origin);
    if (req.method !== 'POST') return send(res, 405, { error: 'الطريقة غير مدعومة.' }, origin);
    if (!isConfigured() && url.pathname !== '/v1/disconnect') return send(res, 503, { error: 'أكمل إعداد خدمة الربط ومفتاح تشفير الجلسة أولًا.' }, origin);
    if (url.pathname === '/v1/connect') return send(res, 200, { configured: isConfigured(), ...await enableBridge() }, origin);
    if (url.pathname === '/v1/disconnect') return send(res, 200, { configured: isConfigured(), ...await disableBridge() }, origin);
    if (url.pathname === '/v1/revoke') return send(res, 200, { configured: isConfigured(), ...await revokeSession() }, origin);
    if (url.pathname === '/v1/send-task') {
      const body = await readBody(req);
      if (!Number.isInteger(body.taskId) || !Array.isArray(body.memberIds) || body.consentConfirmed !== true) return send(res, 400, { error: 'اختر مهمة والأعضاء وأكّد موافقتهم على واتساب.' }, origin);
      
      const results: string[] = [];
      let sentCount = 0;
      let lastResult: unknown = {};
      
      for (const id of body.memberIds) {
        try {
          const memberIdNum = Number(id);
          if (!Number.isInteger(memberIdNum)) continue;
          
          const baseUrl = origin || 'http://localhost:5173';
          const message = await resolveTaskMessage(admin, Number(body.taskId), memberIdNum, baseUrl);
          const result = await sendText(message.phone, message.text);
          sentCount++;
          lastResult = { ...result, memberName: message.memberName, taskTitle: message.taskTitle };
        } catch (err) {
          results.push(`عضو #${id}: ${(err as Error).message}`);
        }
      }
      return send(res, 200, { ...((lastResult as Record<string, unknown>) || {}), sent: sentCount, failed: results.length, errors: results }, origin);
    }
    if (url.pathname === '/v1/send-announcement') {
      const body = await readBody(req);
      if (!Number.isInteger(body.announcementId) || !Array.isArray(body.memberIds)) return send(res, 400, { error: 'اختر الإعلان والأعضاء.' }, origin);
      
      const results: string[] = [];
      let sentCount = 0;
      let lastResult: unknown = {};
      
      for (const id of body.memberIds) {
        try {
          const memberIdNum = Number(id);
          if (!Number.isInteger(memberIdNum)) continue;
          
          const baseUrl = origin || 'http://localhost:5173';
          const message = await resolveAnnouncementMessage(admin, Number(body.announcementId), memberIdNum, baseUrl);
          const result = await sendText(message.phone, message.text);
          sentCount++;
          lastResult = { ...result, memberName: message.memberName, announcementTitle: message.announcementTitle };
        } catch (err) {
          results.push(`عضو #${id}: ${(err as Error).message}`);
        }
      }
      return send(res, 200, { ...((lastResult as Record<string, unknown>) || {}), sent: sentCount, failed: results.length, errors: results }, origin);
    }
    return send(res, 404, { error: 'المسار غير موجود.' }, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'تعذر تنفيذ طلب واتساب.';
    const status = message.includes('جلسة') || message.includes('مخوّل') || message.includes('تسجيل دخول') ? 401 : 400;
    return send(res, status, { error: message }, origin);
  }
}

setDryRun(config.dryRun);
createServer((req, res) => { void handle(req, res); }).listen(config.port, '0.0.0.0', () => {
  console.info(`WhatsApp QR bridge listening on port ${config.port}; dry-run=${config.dryRun}; configured=${isConfigured()}`);
});
