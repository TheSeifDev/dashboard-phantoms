import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { app } from '../index.js';
import { mockBaileysManager } from '../services/mockBaileysManager.js';

test('MockBaileysManager Unit Tests', async (t) => {
  await t.test('Initial state should be disconnected', () => {
    mockBaileysManager.disconnect();
    const status = mockBaileysManager.getStatus();
    assert.equal(status.state, 'disconnected');
    assert.equal(status.connected, false);
    assert.equal(status.phone, null);
    assert.equal(status.isMock, true);
    assert.ok(status.disclaimer.includes('خدمة تجريبية'));
  });

  await t.test('generateQR should transition to qr_ready with valid QR string', () => {
    const qrResult = mockBaileysManager.generateQR();
    assert.equal(qrResult.state, 'qr_ready');
    assert.ok(qrResult.qr.startsWith('2@MOCK_BAILEYS_'));
    assert.equal(qrResult.secondsRemaining, 60);
    assert.ok(qrResult.expiresAt);

    const status = mockBaileysManager.getStatus();
    assert.equal(status.state, 'qr_ready');
    assert.equal(status.connected, false);
  });

  await t.test('simulateConnect should transition to connected', async () => {
    const status = await mockBaileysManager.simulateConnect('201099887766');
    assert.equal(status.state, 'connected');
    assert.equal(status.connected, true);
    assert.ok(status.phone?.includes('7766'));
  });

  await t.test('mockSend should reject without consent', () => {
    assert.throws(
      () => mockBaileysManager.mockSend(1, [10, 11], false),
      /يلزم تأكيد موافقة الأعضاء/
    );
  });

  await t.test('mockSend should succeed when connected with consent', () => {
    const result = mockBaileysManager.mockSend(101, [5, 6], true);
    assert.equal(result.success, true);
    assert.equal(result.simulated, true);
    assert.equal(result.sentCount, 2);
    assert.equal(result.details.length, 2);
    assert.equal(result.details[0].status, 'simulated');
  });

  await t.test('disconnect should reset to disconnected', () => {
    const result = mockBaileysManager.disconnect();
    assert.equal(result.success, true);
    assert.equal(result.state, 'disconnected');
    assert.equal(result.connected, false);
    assert.equal(result.phone, null);
  });

  await t.test('mockSend should reject when disconnected', () => {
    assert.throws(
      () => mockBaileysManager.mockSend(1, [10], true),
      /رقم واتساب غير متصل/
    );
  });
});

test('HTTP API Integration Tests', async (t) => {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Unable to get test server address');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  // Explicit test-mode bypass only when NODE_ENV=test (see set-test-env preload).
  // In any other mode every protected route must reject anonymous callers.
  const BYPASS = process.env.NODE_ENV === 'test';

  t.after(() => {
    mockBaileysManager.disconnect();
    server.close();
  });

  await t.test('GET /health returns 200 and mock status', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json() as { status: string; isMock: boolean };
    assert.equal(body.status, 'ok');
    assert.equal(body.isMock, true);
  });

  await t.test('anonymous callers are rejected on protected routes outside test mode', async () => {
    if (BYPASS) return;
    for (const [method, route, body] of [
      ['GET', '/status', undefined],
      ['GET', '/qr', undefined],
      ['POST', '/connect', {}],
      ['POST', '/mock-send', { taskId: 42, memberIds: [1, 2], consentConfirmed: true }],
      ['POST', '/v1/send-task', { taskId: 1, memberIds: [1], consentConfirmed: true }],
      ['GET', '/v1/diagnostics', undefined],
      ['POST', '/api/push', { title: 'x', body: 'y', memberIds: [1] }],
    ] as Array<[string, string, unknown?]>) {
      const res = await fetch(`${baseUrl}${route}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      assert.equal(res.status, 401, `${method} ${route} must require auth`);
    }
  });

  await t.test('POST /api/push requires auth and validates payload', async () => {
    if (!BYPASS) return;
    const bad = await fetch(`${baseUrl}/api/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '', body: '', memberIds: ['x'] }),
    });
    assert.equal(bad.status, 400);
  });

  await t.test('GET /v1/diagnostics returns structured checks without secrets', async () => {
    if (!BYPASS) return;
    const res = await fetch(`${baseUrl}/v1/diagnostics`);
    assert.equal(res.status, 200);
    const body = await res.json() as {
      generatedAt: string; mode: string;
      summary: { total: number; fails: number; warns: number };
      checks: Array<{ id: string; category: string; label: string; status: string; detail: string; fix?: string }>;
    };
    assert.ok(body.generatedAt && body.mode);
    assert.ok(Array.isArray(body.checks) && body.checks.length >= 8, 'expected a full checklist');
    for (const check of body.checks) {
      assert.ok(['ok', 'warn', 'fail'].includes(check.status), `bad status on ${check.id}`);
      assert.ok(check.id && check.label && check.detail, `incomplete check ${check.id}`);
    }
    // No secret values may ever appear in a diagnostics payload
    const serialized = JSON.stringify(body);
    assert.ok(!/eyJ[A-Za-z0-9_-]{10,}/.test(serialized), 'JWT-like value leaked in diagnostics');
    assert.ok(!/gsk_[A-Za-z0-9]+/.test(serialized), 'API key leaked in diagnostics');
    assert.ok(!/xapp_[A-Za-z0-9]+/.test(serialized), 'token leaked in diagnostics');
  });

  await t.test('POST /v1/send-task rejects invalid payloads', async () => {
    if (!BYPASS) return;
    const cases: Array<Record<string, unknown>> = [
      { taskId: 1, memberIds: [1, 1], consentConfirmed: true },
      { taskId: 1, memberIds: [1], consentConfirmed: false },
      { taskId: -5, memberIds: [1], consentConfirmed: true },
      { taskId: 1, memberIds: Array.from({ length: 51 }, (_, i) => i + 1), consentConfirmed: true },
    ];
    for (const payload of cases) {
      const res = await fetch(`${baseUrl}/v1/send-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      assert.equal(res.status, 400, `must reject ${JSON.stringify(payload).slice(0, 80)}`);
    }
  });

  await t.test('GET /status returns disconnected state', async () => {
    if (!BYPASS) return;
    mockBaileysManager.disconnect();
    const res = await fetch(`${baseUrl}/status`);
    assert.equal(res.status, 200);
    const body = await res.json() as { state: string; isMock: boolean; connected: boolean };
    assert.equal(body.state, 'disconnected');
    assert.equal(body.isMock, true);
    assert.equal(body.connected, false);
  });

  await t.test('GET /qr returns mock QR string and 60 seconds remaining', async () => {
    if (!BYPASS) return;
    const res = await fetch(`${baseUrl}/qr`);
    assert.equal(res.status, 200);
    const body = await res.json() as { qr: string; secondsRemaining: number; state: string };
    assert.ok(body.qr.startsWith('2@MOCK_BAILEYS_'));
    assert.equal(body.secondsRemaining, 60);
    assert.equal(body.state, 'qr_ready');
  });

  await t.test('POST /connect simulates connection', async () => {
    if (!BYPASS) return;
    const res = await fetch(`${baseUrl}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ simulate: true, phone: '201011112222' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { success: boolean; state: string; connected: boolean; phone: string };
    assert.equal(body.success, true);
    assert.equal(body.state, 'connected');
    assert.equal(body.connected, true);
    assert.ok(body.phone?.includes('2222'));
  });

  await t.test('POST /mock-send dispatches mock messages', async () => {
    if (!BYPASS) return;
    const res = await fetch(`${baseUrl}/mock-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: 42, memberIds: [1, 2, 3], consentConfirmed: true }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { success: boolean; simulated: boolean; sentCount: number };
    assert.equal(body.success, true);
    assert.equal(body.simulated, true);
    assert.equal(body.sentCount, 3);
  });

  await t.test('POST /disconnect resets connection state', async () => {
    if (!BYPASS) return;
    const res = await fetch(`${baseUrl}/disconnect`, {
      method: 'POST',
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { success: boolean; state: string; connected: boolean };
    assert.equal(body.success, true);
    assert.equal(body.state, 'disconnected');
    assert.equal(body.connected, false);
  });

  await t.test('Legacy /v1/* endpoints work seamlessly', async () => {
    if (!BYPASS) return;
    const statusRes = await fetch(`${baseUrl}/v1/status`);
    assert.equal(statusRes.status, 200);
    const statusBody = await statusRes.json() as { configured: boolean; dryRun: boolean };
    assert.equal(statusBody.configured, true);
    assert.equal(statusBody.dryRun, true);

    const connectRes = await fetch(`${baseUrl}/v1/connect`, { method: 'POST' });
    assert.equal(connectRes.status, 200);
    const connectBody = await connectRes.json() as { enabled: boolean; qr: string };
    assert.equal(connectBody.enabled, true);
    assert.ok(connectBody.qr?.startsWith('2@MOCK_BAILEYS_'));

    const disconnectRes = await fetch(`${baseUrl}/v1/disconnect`, { method: 'POST' });
    assert.equal(disconnectRes.status, 200);
    const disconnectBody = await disconnectRes.json() as { state: string };
    assert.equal(disconnectBody.state, 'disconnected');
  });
});
