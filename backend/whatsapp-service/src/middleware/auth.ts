import type { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

export interface AuthenticatedUser {
  id?: string;
  email: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  // Allow OPTIONS preflight through
  if (req.method === 'OPTIONS') {
    return next();
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];

  // تجاوز صريح فقط: بيئة test، أو development مع ALLOW_DEV_BYPASS=true.
  // الإنتاج لا يتجاوز أبداً — غياب التوكن = 401.
  const bypassAllowed =
    config.isTest || (config.isDev && config.allowDevBypass);
  if (bypassAllowed && (!token || token === 'dev-token' || token === 'mock-admin-token')) {
    req.user = {
      id: 'mock-admin-id',
      email: 'admin@phantoms.local',
      role: 'admin',
    };
    return next();
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'يلزم تسجيل دخول الإدارة (Authorization token missing).',
    });
  }

  try {
    if (!config.supabaseAnonKey) {
      return res.status(500).json({
        success: false,
        error: 'خدمة التحقق غير مضبوطة على الخادم.',
      });
    }
    const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data, error } = await supabase.auth.getUser(token);
    const email = data.user?.email?.toLowerCase();

    if (error || !email) {
      return res.status(401).json({
        success: false,
        error: 'جلسة الإدارة غير صالحة أو منتهية الصلاحية.',
      });
    }

    const { data: isAdmin, error: roleError } = await supabase.rpc('has_admin_permission', { p_permission: 'whatsapp' });
    if (roleError || isAdmin !== true) {
      return res.status(403).json({
        success: false,
        error: 'هذا الحساب غير مخوّل لإدارة خدمة واتساب.',
      });
    }

    req.user = {
      id: data.user?.id,
      email,
      role: 'admin',
    };
    return next();
  } catch (_err) {
    return res.status(500).json({
      success: false,
      error: 'فشل التحقق من صلاحيات الإدارة.',
    });
  }
}
