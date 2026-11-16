import { supabase } from '../supabase/client';
import { sendPushNotificationWithClient } from './push-dispatch';
import { getConfiguredVapidPublicKey } from './vapid';

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
