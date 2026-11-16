import type { supabase } from '../supabase/client';
import { isVapidPublicKeyReady } from './vapid-readiness.mjs';

/** Deferred Push returns before auth or any Edge Function request. */
export async function sendPushNotificationWithClient(
  client: typeof supabase,
  vapidPublicKey: unknown,
  title: string,
  body: string,
  memberIds: number[],
  url: string = '/',
) {
  if (!isVapidPublicKeyReady(vapidPublicKey)) return null;

  const { data: sessionData } = await client.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('لازم تسجل دخولك الأول');

  const { data, error } = await client.functions.invoke('push-notify', {
    body: {
      title,
      body,
      memberIds,
      url,
      icon: '/branding/phantoms-mark-192.png',
    },
  });

  if (error) {
    throw new Error('معرفناش نبعت الإشعارات: ' + error.message);
  }

  return data;
}
