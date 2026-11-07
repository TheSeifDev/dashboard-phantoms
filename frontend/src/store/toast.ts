import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
  durationMs?: number;
}

interface ToastState {
  toasts: ToastItem[];
  push: (kind: ToastKind, message: string, opts?: { action?: ToastAction; durationMs?: number }) => void;
  success: (message: string, opts?: { action?: ToastAction; durationMs?: number }) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

const DEFAULT_DURATION_MS = 4200;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (kind, message, opts) => {
    const id = nextId++;
    const durationMs = opts?.durationMs ?? DEFAULT_DURATION_MS;
    set((state) => ({ toasts: [...state.toasts.slice(-3), { id, kind, message, action: opts?.action, durationMs }] }));
    window.setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, durationMs);
  },
  success: (message, opts) => useToastStore.getState().push('success', message, opts),
  error: (message) => useToastStore.getState().push('error', message),
  info: (message) => useToastStore.getState().push('info', message),
  warning: (message) => useToastStore.getState().push('warning', message),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

// Helpers للاستخدام خارج React (api / errorHandler)
export const toast = {
  success: (message: string, opts?: { action?: ToastAction; durationMs?: number }) => useToastStore.getState().push('success', message, opts),
  error: (message: string) => useToastStore.getState().push('error', message),
  info: (message: string) => useToastStore.getState().push('info', message),
  warning: (message: string) => useToastStore.getState().push('warning', message),
};
