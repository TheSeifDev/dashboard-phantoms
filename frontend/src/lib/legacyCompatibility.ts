/**
 * =========================================================================
 * PHANTOMS Architecture — Legacy Compatibility Module
 * =========================================================================
 * This module isolates all legacy "Wasla" compatibility layers, carrier markers,
 * LocalStorage fallback keys, and deprecated event types in a single controlled
 * boundary.
 *
 * SUNSET CRITERIA:
 * 1. Storage Keys: Once all active members have logged in on their devices at least once,
 *    localStorage migration has completed. (Scheduled sunset: v2.7).
 * 2. Carrier Prefixes: Once database migration 0020 (custom fields) and 0021 (evaluations)
 *    have fully converted all historical records. (Scheduled sunset: v3.0).
 * 3. External Fallbacks: Remove fallback origins once old preview deployments expire.
 * =========================================================================
 */

/**
 * Historical Carrier Prefixes used in early prototypes before dedicated tables
 */
export const LEGACY_COMPATIBILITY_MARKERS = {
  EVAL_CARRIER_PREFIX: '[[WASLA_EVAL]]',
  PHANTOMS_EVAL_CARRIER_PREFIX: '[[PHANTOMS_EVAL]]',
  CF_MARKER_PREFIX: '[[WASLA_CF:',
  PHANTOMS_CF_MARKER_PREFIX: '[[PHANTOMS_CF:',
  CF_MARKER_REGEX: /\s*\[\[(?:PHANTOMS|WASLA)_CF:(\{[\s\S]*\})\]\]$/,
  ONBOARDING_CARRIER_LABEL: '__WASLA_ONBOARDING__',
  INVITE_PLACEHOLDER_DOMAIN: '@invite.wasla.local',
} as const;

/**
 * Historical LocalStorage keys and their modern PHANTOMS mappings
 */
export const LEGACY_STORAGE_MAP = {
  wasla_device_token: 'phantoms_device_token',
  wasla_member_session: 'phantoms_member_session',
  wasla_admin_remember: 'phantoms_admin_remember',
  wasla_member_remember: 'phantoms_member_remember',
  wasla_notif_sound_enabled: 'phantoms_notif_sound_enabled',
  wasla_push_key_fp: 'phantoms_push_key_fp',
  wasla_member_custom_fields_v1: 'phantoms_member_custom_fields_v1',
} as const;

/**
 * Historical Push & Notification action identifiers
 */
export const LEGACY_NOTIFICATION_EVENTS = {
  PUSH_RECEIVED: 'WASLA_PUSH_RECEIVED',
  NOTIFICATION_CLICKED: 'WASLA_NOTIFICATION_CLICKED',
  PRIMARY_PUSH_RECEIVED: 'PHANTOMS_PUSH_RECEIVED',
  PRIMARY_NOTIFICATION_CLICKED: 'PHANTOMS_NOTIFICATION_CLICKED',
} as const;

/**
 * Checks whether a given string uses a legacy evaluation carrier prefix.
 */
export function isLegacyEvaluationCarrier(title: string): boolean {
  return typeof title === 'string' && (
    title.startsWith(LEGACY_COMPATIBILITY_MARKERS.PHANTOMS_EVAL_CARRIER_PREFIX) ||
    title.startsWith(LEGACY_COMPATIBILITY_MARKERS.EVAL_CARRIER_PREFIX)
  );
}

/**
 * Strips any evaluation carrier prefix (PHANTOMS or legacy) from a title.
 */
export function stripEvaluationCarrier(title: string): string {
  if (!title) return '';
  if (title.startsWith(LEGACY_COMPATIBILITY_MARKERS.PHANTOMS_EVAL_CARRIER_PREFIX)) {
    return title.slice(LEGACY_COMPATIBILITY_MARKERS.PHANTOMS_EVAL_CARRIER_PREFIX.length).trim();
  }
  if (title.startsWith(LEGACY_COMPATIBILITY_MARKERS.EVAL_CARRIER_PREFIX)) {
    return title.slice(LEGACY_COMPATIBILITY_MARKERS.EVAL_CARRIER_PREFIX.length).trim();
  }
  return title;
}
