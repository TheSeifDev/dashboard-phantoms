import makeWASocket, { DisconnectReason } from '@whiskeysockets/baileys';
import { createEncryptedAuthState } from './sessionStore.js';

type BridgeStatus = { enabled: boolean; connected: boolean; qr: string | null; qrExpiresAt: string | null; phone: string | null; dryRun: boolean };
let socket: ReturnType<typeof makeWASocket> | null = null;
let enabled = false;
let connected = false;
let qr: string | null = null;
let qrExpiresAt: number | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let dryRun = false;

export function setDryRun(value: boolean) {
  dryRun = value;
}

export function getStatus(): BridgeStatus {
  if (qrExpiresAt && qrExpiresAt < Date.now()) { qr = null; qrExpiresAt = null; }
  const phone = socket?.user?.id?.split(':')[0] ?? null;
  return { enabled, connected, qr, qrExpiresAt: qrExpiresAt ? new Date(qrExpiresAt).toISOString() : null, phone: phone ? `••••${phone.slice(-4)}` : null, dryRun };
}

async function openSocket() {
  const auth = await createEncryptedAuthState();
  const current = makeWASocket({ auth: auth.state, printQRInTerminal: false, markOnlineOnConnect: false });
  socket = current;
  current.ev.on('creds.update', () => { void auth.saveCreds(); });
  current.ev.on('connection.update', ({ connection, lastDisconnect, qr: nextQr }) => {
    if (nextQr) { qr = nextQr; qrExpiresAt = Date.now() + 60_000; }
    if (connection === 'open') { connected = true; qr = null; qrExpiresAt = null; }
    if (connection === 'close') {
      connected = false;
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        qr = null;
        qrExpiresAt = null;
        void auth.clear();
        socket = null;
      } else if (enabled && !reconnectTimer) {
        reconnectTimer = setTimeout(() => { reconnectTimer = null; if (enabled) void openSocket(); }, 2_000);
      }
    }
  });
}

export async function enableBridge() {
  enabled = true;
  if (!dryRun && !socket) await openSocket();
  return getStatus();
}

export async function disableBridge() {
  enabled = false;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  qr = null;
  qrExpiresAt = null;
  connected = false;
  socket?.end(undefined);
  socket = null;
  return getStatus();
}

export async function revokeSession() {
  if (socket) await socket.logout();
  socket = null;
  connected = false;
  qr = null;
  qrExpiresAt = null;
  const auth = await createEncryptedAuthState();
  await auth.clear();
  return getStatus();
}

export async function sendText(phone: string, text: string) {
  if (!enabled) throw new Error('البوت واقف. شغّله من لوحة الإدارة الأول.');
  if (dryRun) return { accepted: true, simulated: true };
  if (!connected || !socket) throw new Error('اربط رقم واتساب الأول عن طريق QR.');
  const jid = `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
  await socket.sendMessage(jid, { text });
  return { accepted: true, simulated: false };
}
