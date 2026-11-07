import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';

const ROOT_EXIT_PATHS = new Set([
  '/',
  '/login',
  '/admin',
  '/admin/login',
  '/portal',
]);

let initialized = false;

/**
 * تهيئة بيئة الأندرويد (Capacitor APK):
 * ربط زر الرجوع الفعلي في الهاتف مع سجل التصفح الداخلي للتطبيق
 */
export function initCapacitorNativeBridge(): void {
  if (initialized || !Capacitor.isNativePlatform()) {
    return;
  }
  initialized = true;

  void CapacitorApp.addListener('backButton', ({ canGoBack }) => {
    const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
    if (canGoBack && !ROOT_EXIT_PATHS.has(currentPath)) {
      window.history.back();
    } else {
      void CapacitorApp.exitApp();
    }
  });
}

export function isRunningInNativeApk(): boolean {
  return Capacitor.isNativePlatform();
}
