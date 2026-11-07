import { Router, Request, Response, NextFunction } from 'express';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config(); // Ensure env variables are accessible

const router = Router();

// Validate VAPID configuration
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(
    'mailto:admin@wasla.com',
    vapidPublicKey,
    vapidPrivateKey
  );
} else {
  console.warn('[Push] VAPID keys not configured. Push notifications will fail.');
}

// Ensure proper async handling for express
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) => 
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

router.post('/api/push', asyncHandler(async (req: Request, res: Response) => {
  if (!vapidPublicKey) {
    return res.status(503).json({ error: 'Server not configured for Web Push.' });
  }

  const { title, body, icon, url, memberIds } = req.body as {
    title?: unknown; body?: unknown; icon?: unknown; url?: unknown; memberIds?: unknown;
  };
  if (typeof title !== 'string' || !title.trim() || title.length > 120 ||
      typeof body !== 'string' || !body.trim() || body.length > 500 ||
      !Array.isArray(memberIds)) {
    return res.status(400).json({ error: 'Invalid payload.' });
  }

  const numericIds = (memberIds as unknown[]).filter(
    (id): id is number => Number.isInteger(id) && (id as number) > 0 && (id as number) <= 2147483647
  );
  if (numericIds.length === 0 || numericIds.length > 50 || numericIds.length !== memberIds.length ||
      new Set(numericIds).size !== numericIds.length) {
    return res.status(400).json({ error: 'Invalid member list (1-50 unique ids).' });
  }
  const validIds = numericIds;

  const safeIcon = typeof icon === 'string' && icon !== '' ? icon.slice(0, 2048) : '/wasla-logo.png';
  if (safeIcon !== '/wasla-logo.png' && !safeIcon.startsWith('/') && !/^https:\/\/[^/]+/.test(safeIcon)) {
    return res.status(400).json({ error: 'Invalid icon URL.' });
  }
  const safeUrl = typeof url === 'string' && url !== '' ? url.slice(0, 2048) : '/portal';
  if (!safeUrl.startsWith('/') && !/^https:\/\/[^/]+/.test(safeUrl)) {
    return res.status(400).json({ error: 'Invalid target URL.' });
  }

  // Use Service Role to get push subscriptions
  const supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''
  );

  const { data: members, error } = await supabase
    .from('members')
    .select('id, push_subscription')
    .in('id', validIds)
    .not('push_subscription', 'is', 'null');

  if (error || !members) {
    return res.status(500).json({ error: 'Error fetching subscriptions.' });
  }

  if (members.length === 0) {
    return res.json({ sent: 0, failed: 0, message: 'No active subscriptions found.' });
  }

  const payload = JSON.stringify({
    title: title.trim().slice(0, 120),
    body: body.trim().slice(0, 500),
    icon: safeIcon,
    url: safeUrl,
  });

  let sent = 0;
  let failed = 0;

  for (const member of members) {
    try {
      await webpush.sendNotification(member.push_subscription, payload);
      sent++;
    } catch (err: any) {
      failed++;
      // Clean up invalid subscriptions
      if (err.statusCode === 410 || err.statusCode === 404) {
        await supabase.from('members').update({ push_subscription: null }).eq('id', member.id);
      }
    }
  }

  return res.json({ sent, failed });
}));

export { router as pushRouter };
