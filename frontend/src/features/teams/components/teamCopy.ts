import { useLayoutEffect, type RefObject } from 'react';
import gsap from 'gsap';
import type {
  TeamAdminRole, TeamMembershipStatus, TeamPermission, TeamPermissions,
} from '../../../types/db';
import { TEAM_PERMISSION_OPTIONS } from '../../admin/access/permissions';

export const ROLES: TeamAdminRole[] = ['head', 'monitor'];

export const EMPTY_PERMISSIONS = Object.fromEntries(
  TEAM_PERMISSION_OPTIONS.map(({ key }) => [key, false]),
) as TeamPermissions;

export const PERMISSION_COPY: Record<TeamPermission, { ar: string; en: string }> = {
  dashboard: { ar: 'لوحة الفريق', en: 'Team dashboard' },
  members: { ar: 'الأعضاء', en: 'Members' },
  tasks: { ar: 'المهام', en: 'Tasks' },
  ranking: { ar: 'الترتيب والتقييمات', en: 'Ranking & evaluations' },
  notes: { ar: 'الملاحظات', en: 'Notes' },
  announcements: { ar: 'الإعلانات', en: 'Announcements' },
  whatsapp: { ar: 'واتساب', en: 'WhatsApp' },
  ai_assistant: { ar: 'المساعد الذكي', en: 'AI assistant' },
};

export const MEMBERSHIP_COPY: Record<TeamMembershipStatus, { ar: string; en: string; tone: 'success' | 'warning' | 'neutral' | 'danger' }> = {
  active: { ar: 'نشط', en: 'Active', tone: 'success' },
  pending: { ar: 'بانتظار المراجعة', en: 'Pending review', tone: 'warning' },
  suspended: { ar: 'موقوف', en: 'Suspended', tone: 'neutral' },
  removed: { ar: 'أزيل', en: 'Removed', tone: 'danger' },
};

export function roleCopy(role: TeamAdminRole) {
  return role === 'head'
    ? { ar: 'رئيس الفريق', en: 'Team Head', tag: 'Head', hintAr: 'مسؤول عن اتجاه الفريق وقراراته.', hintEn: 'Owns the team direction and decisions.' }
    : { ar: 'المتابع', en: 'Monitor', tag: 'Monitor', hintAr: 'يتابع الالتزام والتسليم داخل الفريق.', hintEn: 'Tracks commitment and delivery inside the team.' };
}

export function initials(value: string) {
  const clean = value.trim();
  if (!clean) return '?';
  return clean.split(/\s+/).slice(0, 2).map((part) => part.slice(0, 1)).join('').toUpperCase();
}

export function motionAllowed() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * دخول متدرج لعناصر الصفحة. أي عنصر عليه `data-tm-anim` بيتحرك من تحت لفوق،
 * وبيتصلح بعد الأنيميشن عشان ميعطلش الـ layout على الموبايل.
 */
export function useStaggerIn(ref: RefObject<HTMLElement | null>, key: string, options?: { y?: number; stagger?: number }) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !motionAllowed()) return;
    const targets = root.querySelectorAll<HTMLElement>('[data-tm-anim], [data-tmc-anim]');
    if (targets.length === 0) return;
    const timeline = gsap.timeline();
    timeline.fromTo(
      targets,
      { y: options?.y ?? 16, opacity: 0 },
      {
        y: 0, opacity: 1, duration: 0.45, stagger: options?.stagger ?? 0.05,
        ease: 'power2.out', clearProps: 'transform,opacity',
      },
    );
    return () => { timeline.kill(); };
  }, [ref, key, options?.y, options?.stagger]);
}

/** عدّاد أرقام لطيف للمؤشرات — بدون أي أرقام وهمية، بيعدّ للقيمة الحقيقية. */
export function countUp(element: HTMLElement | null, value: number, format: (input: number) => string) {
  if (!element) return;
  if (!motionAllowed()) { element.textContent = format(value); return; }
  const state = { current: 0 };
  gsap.to(state, {
    current: value,
    duration: 0.9,
    ease: 'power2.out',
    onUpdate: () => { element.textContent = format(Math.round(state.current)); },
    onComplete: () => { element.textContent = format(value); },
  });
}
