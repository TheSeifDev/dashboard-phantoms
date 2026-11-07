import { supabase } from '../supabase/client';

export async function sendPushNotification(title: string, body: string, memberIds: number[], url: string = '/') {
  // Call the push-notify edge function
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('لازم تسجل دخولك الأول');

  const { data, error } = await supabase.functions.invoke('push-notify', {
    body: {
      title,
      body,
      memberIds,
      url,
      icon: '/wasla-logo.png'
    },
  });

  if (error) {
    throw new Error('معرفناش نبعت الإشعارات: ' + error.message);
  }
  
  return data;
}
