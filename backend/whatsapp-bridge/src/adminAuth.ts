import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

export type AdminRequest = { token: string; email: string };

export async function requireAdmin(authorization: string | undefined): Promise<AdminRequest> {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new Error('لازم تسجّل دخول الإدارة الأول.');
  const client = createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data, error } = await client.auth.getUser(token);
  const email = data.user?.email?.toLowerCase();
  if (error || !email) throw new Error('جلسة الإدارة مش صالحة. سجّل دخولك تاني.');
  const { data: isAdmin, error: roleError } = await client.rpc('has_admin_permission', { p_permission: 'whatsapp' });
  if (roleError || isAdmin !== true) throw new Error('الحساب ده مش مسموح له يدير ربط واتساب.');
  return { token, email };
}
