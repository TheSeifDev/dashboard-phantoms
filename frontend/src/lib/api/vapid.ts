export { isVapidPublicKeyReady } from './vapid-readiness.mjs';

export function getConfiguredVapidPublicKey(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env;
  const value = env?.VITE_VAPID_PUBLIC_KEY;
  return typeof value === 'string' ? value : '';
}
