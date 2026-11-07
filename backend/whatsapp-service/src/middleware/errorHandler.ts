import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  const statusCode = typeof (err as { statusCode?: number })?.statusCode === 'number'
    ? (err as { statusCode: number }).statusCode
    : 500;

  // رسائل 4xx تحقق آمنة للعميل؛ أخطاء 5xx تُعمم في الإنتاج لمنع تسريب التفاصيل.
  const message = err instanceof Error ? err.message : 'حدث خطأ داخلي في خدمة واتساب.';
  const safeMessage =
    statusCode >= 500 && config.nodeEnv === 'production'
      ? 'حدث خطأ داخلي في خدمة واتساب.'
      : message.slice(0, 500);

  res.status(statusCode).json({
    success: false,
    error: safeMessage,
  });
}
