import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { ToastViewport } from './components/ui/Toast';
import { useThemeStore, parseTheme } from './store/theme';
import { registerSW } from 'virtual:pwa-register';
import { initCapacitorNativeBridge, isRunningInNativeApk } from './lib/capacitor';
import { runLocalStorageMigration } from './lib/storageMigration';
import './index.css';

// إدارة وتهيئة مفاتيح الجلسة المحلية
runLocalStorageMigration();

// تهيئة بيئة تطبيق الأندرويد (زر الرجوع والتكامل الأصلي)
initCapacitorNativeBridge();

// Register the service worker for PWA and push notifications on web only
if (!isRunningInNativeApk()) {
  registerSW({ immediate: true });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

// تطبيق الثيم المحفوظ قبل أول رسم (يمنع وميض الوضع الداكن)
useThemeStore.getState().setTheme(
  parseTheme(localStorage.getItem('tms_theme') ?? localStorage.getItem('theme'))
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <ToastViewport />
    </QueryClientProvider>
  </StrictMode>
);
