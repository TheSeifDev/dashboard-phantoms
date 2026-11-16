import { supabase } from '../supabase/client';
import { getConfiguredVapidPublicKey, isVapidPublicKeyReady } from './vapid';

/**
 * Dispatch through the supplied client so the guard remains testable without
 * contacting Supabase. The readiness check must stay before auth as deferred
 * Push is not an authentication failure.
 */
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

export function sendPushNotification(title: string, body: string, memberIds: number[], url: string = '/') {
  return sendPushNotificationWithClient(
    supabase,
    getConfiguredVapidPublicKey(),
    title,
    body,
    memberIds,
    url,
  );
}
