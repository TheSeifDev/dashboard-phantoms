import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info' | 'warning' | 'loading';
export type ToastTask = 'download' | 'save' | 'upload' | 'sync' | 'export' | 'import' | 'process' | 'task' | (string & {});

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  action?: ToastAction;
  durationMs?: number;
  title?: string;
  detail?: string;
  task?: ToastTask;
  /** null means indeterminate; numeric progress is clamped to 0..100. */
  progress?: number | null;
}

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
  durationMs?: number;
  title?: string;
  detail?: string;
  task?: ToastTask;
  progress?: number | null;
}

export type ToastUpdate = Partial<Omit<ToastItem, 'id'>>;

interface ToastState {
  toasts: ToastItem[];
  push: (kind: ToastKind, message: string, opts?: ToastOptions) => number;
  success: (message: string, opts?: ToastOptions) => number;
  error: (message: string, opts?: ToastOptions) => number;
  info: (message: string, opts?: ToastOptions) => number;
  warning: (message: string, opts?: ToastOptions) => number;
  loading: (message: string, opts?: Omit<ToastOptions, 'durationMs'>) => number;
  update: (id: number, patch: ToastUpdate) => void;
  dismiss: (id: number) => void;
}

type TimerHandle = ReturnType<typeof setTimeout>;
interface ToastTimer {
  handle: TimerHandle;
  token: number;
}

type ToastSet = (updater: (state: ToastState) => Partial<ToastState>) => void;

let nextId = 1;
const DEFAULT_DURATION_MS = 4200;
const MAX_VISIBLE_TOASTS = 4;
const timers = new Map<number, ToastTimer>();
const timerTokens = new Map<number, number>();

function normalizeDuration(durationMs: number | undefined): number {
  if (durationMs === undefined || !Number.isFinite(durationMs)) return DEFAULT_DURATION_MS;
  return Math.max(0, durationMs);
}

function normalizeProgress(progress: number | null | undefined): number | null | undefined {
  if (progress === null || progress === undefined) return progress;
  if (!Number.isFinite(progress)) return 0;
  return Math.min(100, Math.max(0, progress));
}

function clearTimer(id: number): void {
  const timer = timers.get(id);
  if (timer) {
    globalThis.clearTimeout(timer.handle);
    timers.delete(id);
  }
  // Incrementing the token makes a stale callback harmless even when a test
  // fake or host timer implementation invokes a cleared callback.
  timerTokens.set(id, (timerTokens.get(id) ?? 0) + 1);
}

function scheduleTimer(item: ToastItem, set: ToastSet): void {
  clearTimer(item.id);
  if (item.kind === 'loading' || !item.durationMs || item.durationMs <= 0) return;

  const token = (timerTokens.get(item.id) ?? 0) + 1;
  timerTokens.set(item.id, token);
  const handle = globalThis.setTimeout(() => {
    const current = timers.get(item.id);
    if (!current || current.token !== token) return;
    timers.delete(item.id);
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== item.id) }));
  }, item.durationMs);
  timers.set(item.id, { handle, token });
}

function makeItem(id: number, kind: ToastKind, message: string, opts?: ToastOptions): ToastItem {
  const durationMs = kind === 'loading' ? 0 : normalizeDuration(opts?.durationMs);
  return {
    id,
    kind,
    message,
    action: opts?.action,
    durationMs,
    title: opts?.title,
    detail: opts?.detail,
    task: opts?.task,
    progress: kind === 'loading' ? normalizeProgress(opts?.progress ?? null) ?? null : normalizeProgress(opts?.progress),
  };
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (kind: ToastKind, message: string, opts?: ToastOptions): number => {
    const id = nextId++;
    const item = makeItem(id, kind, message, opts);
    set((state) => {
      const toasts = [...state.toasts, item];
      const evicted = toasts.slice(0, Math.max(0, toasts.length - MAX_VISIBLE_TOASTS));
      evicted.forEach((toast) => clearTimer(toast.id));
      return { toasts: toasts.slice(-MAX_VISIBLE_TOASTS) };
    });
    scheduleTimer(item, set);
    return id;
  },
  success: (message: string, opts?: ToastOptions): number => useToastStore.getState().push('success', message, opts),
  error: (message: string, opts?: ToastOptions): number => useToastStore.getState().push('error', message, opts),
  info: (message: string, opts?: ToastOptions): number => useToastStore.getState().push('info', message, opts),
  warning: (message: string, opts?: ToastOptions): number => useToastStore.getState().push('warning', message, opts),
  loading: (message: string, opts?: Omit<ToastOptions, 'durationMs'>): number => useToastStore.getState().push('loading', message, opts),
  update: (id: number, patch: ToastUpdate): void => {
    let updated: ToastItem | undefined;
    set((state) => {
      const existing = state.toasts.find((toast) => toast.id === id);
      if (!existing) return state;
      const kind = patch.kind ?? existing.kind;
      const hasDuration = Object.prototype.hasOwnProperty.call(patch, 'durationMs');
      const hasProgress = Object.prototype.hasOwnProperty.call(patch, 'progress');
      const durationMs = kind === 'loading'
        ? 0
        : hasDuration
          ? normalizeDuration(patch.durationMs)
          : existing.kind === 'loading'
            ? DEFAULT_DURATION_MS
            : normalizeDuration(existing.durationMs);
      const progress = kind === 'loading'
        ? (hasProgress ? normalizeProgress(patch.progress) ?? null : existing.progress ?? null)
        : hasProgress
          ? normalizeProgress(patch.progress)
          : existing.progress;
      updated = {
        ...existing,
        ...patch,
        kind,
        durationMs,
        progress,
      };
      return { toasts: state.toasts.map((toast) => toast.id === id ? updated as ToastItem : toast) };
    });
    if (updated) scheduleTimer(updated, set);
  },
  dismiss: (id: number): void => {
    clearTimer(id);
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },
}));

export const dismiss = (id: number): void => {
  useToastStore.getState().dismiss(id);
};

// Helpers للاستخدام خارج React (api / errorHandler)
export const toast = {
  push: (kind: ToastKind, message: string, opts?: ToastOptions) => useToastStore.getState().push(kind, message, opts),
  success: (message: string, opts?: ToastOptions) => useToastStore.getState().success(message, opts),
  error: (message: string, opts?: ToastOptions) => useToastStore.getState().error(message, opts),
  info: (message: string, opts?: ToastOptions) => useToastStore.getState().info(message, opts),
  warning: (message: string, opts?: ToastOptions) => useToastStore.getState().warning(message, opts),
  loading: (message: string, opts?: Omit<ToastOptions, 'durationMs'>) => useToastStore.getState().loading(message, opts),
  update: (id: number, patch: ToastUpdate) => useToastStore.getState().update(id, patch),
  dismiss,
};
