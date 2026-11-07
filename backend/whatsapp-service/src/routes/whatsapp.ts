import { Router } from 'express';
import { mockBaileysManager } from '../services/mockBaileysManager.js';

export const whatsappRouter = Router();

// Standard Endpoints
whatsappRouter.get('/status', (_req, res) => {
  res.json(mockBaileysManager.getStatus());
});

whatsappRouter.get('/qr', (_req, res) => {
  res.json(mockBaileysManager.generateQR());
});

whatsappRouter.post('/connect', async (req, res, next) => {
  try {
    if (req.body?.simulate === false || req.body?.action === 'qr') {
      const qrResult = mockBaileysManager.generateQR();
      return res.json({ ...mockBaileysManager.getStatus(), ...qrResult });
    }
    const status = await mockBaileysManager.simulateConnect(req.body?.phone);
    return res.json({ success: true, ...status });
  } catch (err) {
    return next(err);
  }
});

whatsappRouter.post('/disconnect', (_req, res) => {
  res.json(mockBaileysManager.disconnect());
});

whatsappRouter.post('/revoke', (_req, res) => {
  res.json(mockBaileysManager.disconnect());
});

whatsappRouter.post('/mock-send', (req, res, next) => {
  try {
    const { taskId, memberIds, consentConfirmed } = req.body;
    if (!Number.isInteger(Number(taskId)) || Number(taskId) <= 0 || !Array.isArray(memberIds)) {
      return res.status(400).json({
        success: false,
        error: 'بيانات المهمة أو قائمة الأعضاء غير مكتملة.',
      });
    }
    const ids = (memberIds as unknown[]).filter(
      (id): id is number => Number.isInteger(id) && (id as number) > 0
    );
    if (ids.length === 0 || ids.length > 50 || ids.length !== memberIds.length ||
        new Set(ids).size !== ids.length || consentConfirmed !== true) {
      return res.status(400).json({
        success: false,
        error: 'يلزم تأكيد الموافقة وقائمة 1-50 عضواً بلا تكرار.',
      });
    }

    const result = mockBaileysManager.mockSend(
      Number(taskId),
      ids,
      true
    );
    return res.json(result);
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'تعذر تنفيذ الإرسال التجريبي.',
    });
  }
});

// Legacy Aliases for Frontend Compatibility (/v1/*)
whatsappRouter.get('/v1/status', (_req, res) => {
  res.json(mockBaileysManager.getStatus());
});

whatsappRouter.post('/v1/connect', async (req, res, next) => {
  try {
    if (req.body?.simulate === true || req.query.simulate === 'true') {
      const result = await mockBaileysManager.simulateConnect();
      return res.json(result);
    }
    // Default legacy behavior: generates QR and returns status with QR populated
    mockBaileysManager.generateQR();
    return res.json(mockBaileysManager.getStatus());
  } catch (err) {
    return next(err);
  }
});

whatsappRouter.post('/v1/disconnect', (_req, res) => {
  res.json(mockBaileysManager.disconnect());
});

whatsappRouter.post('/v1/revoke', (_req, res) => {
  res.json(mockBaileysManager.disconnect());
});

whatsappRouter.post('/v1/send-task', (req, res) => {
  try {
    const { taskId, memberIds, consentConfirmed } = req.body;
    if (!Number.isInteger(Number(taskId)) || Number(taskId) <= 0 || !Array.isArray(memberIds)) {
      return res.status(400).json({
        error: 'اختر مهمة والأعضاء وأكّد موافقتهم على واتساب.',
      });
    }
    const ids = (memberIds as unknown[]).filter(
      (id): id is number => Number.isInteger(id) && (id as number) > 0
    );
    if (ids.length === 0 || ids.length > 50 || ids.length !== memberIds.length ||
        new Set(ids).size !== ids.length || consentConfirmed !== true) {
      return res.status(400).json({
        error: 'يلزم تأكيد الموافقة وقائمة 1-50 عضواً بلا تكرار.',
      });
    }

    const result = mockBaileysManager.mockSend(
      Number(taskId),
      ids,
      true
    );

    return res.json({
      accepted: true,
      simulated: true,
      sent: result.sentCount,
      failed: result.failedCount,
      errors: [],
    });
  } catch (err) {
    return res.status(400).json({
      error: err instanceof Error ? err.message : 'تعذر إرسال التكليف.',
    });
  }
});
