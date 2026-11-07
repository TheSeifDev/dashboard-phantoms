import type { AdminPermission, AdminPermissions } from '../../../types/db';

export const ADMIN_PERMISSION_OPTIONS: ReadonlyArray<{
  key: AdminPermission;
  label: string;
  description: string;
}> = [
  { key: 'dashboard', label: 'الرئيسية', description: 'عرض ملخص لوحة الإدارة.' },
  { key: 'members', label: 'الأعضاء', description: 'عرض بيانات الأعضاء وإضافتها وتعديلها.' },
  { key: 'tasks', label: 'المهام', description: 'إدارة المهام ومراجعة التسليمات.' },
  { key: 'ranking', label: 'ترتيب الفريق', description: 'عرض ترتيب الأعضاء ونقاطهم.' },
  { key: 'notes', label: 'الملاحظات', description: 'عرض ملاحظات الأعضاء وإضافتها وتعديلها.' },
  { key: 'announcements', label: 'الإعلانات', description: 'إدارة الإعلانات وإرسال التنبيهات.' },
  { key: 'whatsapp', label: 'واتساب', description: 'إرسال المهام ومتابعة اتصال واتساب.' },
  { key: 'ai_assistant', label: 'المساعد الذكي', description: 'استخدام خدمات المساعد الذكي.' },
];

export const FULL_ADMIN_PERMISSIONS: AdminPermissions = {
  dashboard: true,
  members: true,
  tasks: true,
  ranking: true,
  notes: true,
  announcements: true,
  whatsapp: true,
  ai_assistant: true,
};

export function normalizeAdminPermissions(value: unknown): AdminPermissions {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return Object.fromEntries(
    ADMIN_PERMISSION_OPTIONS.map(({ key }) => [key, source[key] === true]),
  ) as AdminPermissions;
}

export function firstAllowedAdminPath(permissions: Partial<AdminPermissions> | null | undefined) {
  const option = ADMIN_PERMISSION_OPTIONS.find(({ key }) => permissions?.[key] === true);
  return option ? ({
    dashboard: '/admin/dashboard',
    members: '/admin/members',
    tasks: '/admin/tasks',
    ranking: '/admin/ranking',
    notes: '/admin/notes',
    announcements: '/admin/announcements',
    whatsapp: '/admin/whatsapp',
    ai_assistant: '/admin/ai-assistant',
  } satisfies Record<AdminPermission, string>)[option.key] : null;
}
