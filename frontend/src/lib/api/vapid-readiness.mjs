/**
 * A configured VAPID public key is ready only when it is non-placeholder,
 * URL-safe base64 and decodes to the existing 65-byte public-key contract.
 * Shared by the browser guard and the Node health check.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isVapidPublicKeyReady(value) {
  if (typeof value !== 'string') return false;
  const key = value.trim();
  if (!key || /placeholder|your-vapid-public-key/i.test(key)) return false;
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(key)) return false;
  const unpadded = key.replace(/=+$/, '');
  if (unpadded.length % 4 === 1) return false;
  const normalized = unpadded.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  try {
    return atob(normalized + padding).length === 65;
  } catch {
    return false;
  }
}
