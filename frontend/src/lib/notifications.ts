import { create } from 'zustand';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

export type NotificationCategory = 'task' | 'evaluation' | 'announcement' | 'review' | 'system';
export type NotificationTargetTab = 'ALL' | 'TASKS' | 'EVALUATIONS' | 'ANNOUNCEMENTS';

export interface PhantomsNotificationItem {
  id: string;
  title: string;
  body: string;
  category: NotificationCategory;
  targetTab: NotificationTargetTab;
  createdAt: string;
  read: boolean;
  senderName?: string;
}

interface NotificationState {
  items: PhantomsNotificationItem[];
  activeBanner: PhantomsNotificationItem | null;
  soundEnabled: boolean;
  drawerOpen: boolean;
  hydrateForMember: (memberId: number) => void;
  pushNotification: (
    memberId: number,
    item: Omit<PhantomsNotificationItem, 'id' | 'createdAt' | 'read'> & { id?: string; createdAt?: string },
    options?: { triggerSystem?: boolean; playSound?: boolean; showBanner?: boolean },
  ) => void;
  dismissBanner: () => void;
  markAsRead: (memberId: number, id: string) => void;
  markAllAsRead: (memberId: number) => void;
  clearAll: (memberId: number) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setDrawerOpen: (open: boolean) => void;
}

const SOUND_PREF_KEY = 'phantoms_notif_sound_enabled';
const ANDROID_CHANNEL_ID = 'phantoms_whatsapp_alerts_v2';

function storageKeyForMember(memberId: number): string {
  return `phantoms_notifications_v2_${memberId}`;
}

function loadStoredItems(memberId: number): PhantomsNotificationItem[] {
  try {
    const primaryKey = storageKeyForMember(memberId);
    const raw = localStorage.getItem(primaryKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PhantomsNotificationItem[]).slice(0, 60) : [];
  } catch {
    return [];
  }
}

function saveStoredItems(memberId: number, items: PhantomsNotificationItem[]): void {
  try {
    localStorage.setItem(storageKeyForMember(memberId), JSON.stringify(items.slice(0, 60)));
  } catch {
    // ignore storage quota errors
  }
}

function loadSoundPref(): boolean {
  try {
    const primary = localStorage.getItem(SOUND_PREF_KEY);
    if (primary !== null) return primary !== '0';
    return true;
  } catch {
    return true;
  }
}

/**
 * تحويل مفتاح VAPID العام من Base64URL إلى Uint8Array
 * ضروري لعمل PushManager.subscribe على متصفحات الهواتف (Android Chrome / iOS Safari PWA)
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * توليد نغمة إشعار احترافية على طراز واتساب كملف WAV مدمج في الذاكرة (بدون الحاجة لملف خارجي)
 * نغمتان متتابعتان (D5 -> A5) مع توافقيات ناعمة وتلاشي تدريجي واضح على سماعة الهاتف
 */
let cachedChimeDataUrl: string | null = null;
function getWhatsAppChimeDataUrl(): string {
  if (cachedChimeDataUrl) return cachedChimeDataUrl;

  const sampleRate = 22050;
  const durationSeconds = 0.48;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i += 1) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  for (let i = 0; i < numSamples; i += 1) {
    const t = i / sampleRate;
    let sample = 0;

    if (t < 0.16) {
      // النغمة الأولى: D5 (587.33 Hz)
      const env = Math.sin((Math.PI * t) / 0.16) * Math.exp(-t * 8);
      sample =
        (Math.sin(2 * Math.PI * 587.33 * t) * 0.75 +
          Math.sin(2 * Math.PI * 1174.66 * t) * 0.25) *
        env;
    } else if (t >= 0.15) {
      // النغمة الثانية الأعلى: A5 (880 Hz)
      const t2 = t - 0.15;
      const attack = Math.min(1, t2 / 0.012);
      const decay = Math.exp(-t2 * 7.5);
      const env = attack * decay;
      sample =
        (Math.sin(2 * Math.PI * 880 * t2) * 0.78 +
          Math.sin(2 * Math.PI * 1760 * t2) * 0.22) *
        env;
    }

    const clamped = Math.max(-1, Math.min(1, sample * 0.92));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  cachedChimeDataUrl = `data:audio/wav;base64,${window.btoa(binary)}`;
  return cachedChimeDataUrl;
}

let sharedAudioContext: AudioContext | null = null;
let audioUnlocked = false;

export function unlockNotificationAudio(): void {
  if (audioUnlocked || typeof window === 'undefined') return;

  const unlockHandler = () => {
    if (audioUnlocked) return;
    audioUnlocked = true;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        if (!sharedAudioContext) sharedAudioContext = new AudioCtx();
        if (sharedAudioContext.state === 'suspended') {
          void sharedAudioContext.resume();
        }
      }
    } catch {
      // ignore
    }
    window.removeEventListener('pointerdown', unlockHandler);
    window.removeEventListener('keydown', unlockHandler);
  };

  window.addEventListener('pointerdown', unlockHandler, { passive: true });
  window.addEventListener('keydown', unlockHandler, { passive: true });
}

/**
 * تشغيل صوت إشعار واضح على طراز واتساب + اهتزاز الهاتف
 */
export function playWhatsAppNotificationSound(force = false): void {
  if (typeof window === 'undefined') return;
  if (!force && !loadSoundPref()) return;

  // 1) اهتزاز الهاتف إن كان مدعوماً
  try {
    if ('vibrate' in navigator) {
      navigator.vibrate([180, 70, 220]);
    }
  } catch {
    // ignore
  }

  // 2) تشغيل ملف الصوت المدمج عبر عنصر Audio (يعمل على الهواتف وWebView)
  try {
    const audio = new Audio(getWhatsAppChimeDataUrl());
    audio.volume = 1.0;
    const playPromise = audio.play();
    if (playPromise) {
      playPromise.catch(() => {
        playWebAudioFallbackChime();
      });
      return;
    }
  } catch {
    // fallback to WebAudio
  }

  playWebAudioFallbackChime();
}

function playWebAudioFallbackChime(): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    if (!sharedAudioContext) sharedAudioContext = new AudioCtx();
    if (sharedAudioContext.state === 'suspended') {
      void sharedAudioContext.resume();
    }

    const now = sharedAudioContext.currentTime;
    const osc1 = sharedAudioContext.createOscillator();
    const gain1 = sharedAudioContext.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.exponentialRampToValueAtTime(0.35, now + 0.015);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc1.connect(gain1);
    gain1.connect(sharedAudioContext.destination);
    osc1.start(now);
    osc1.stop(now + 0.165);

    const osc2 = sharedAudioContext.createOscillator();
    const gain2 = sharedAudioContext.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.15);
    gain2.gain.setValueAtTime(0.001, now + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.42, now + 0.17);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc2.connect(gain2);
    gain2.connect(sharedAudioContext.destination);
    osc2.start(now + 0.15);
    osc2.stop(now + 0.46);
  } catch {
    // ignore
  }
}

let androidChannelInitialized = false;

export async function ensureAndroidNotificationChannel(): Promise<void> {
  if (!Capacitor.isNativePlatform() || androidChannelInitialized) return;
  try {
    await LocalNotifications.createChannel({
      id: ANDROID_CHANNEL_ID,
      name: 'إشعارات PHANTOMS الفورية',
      description: 'تنبيهات المهام والتقييمات والإعلانات الهامة بأعلى أولوية مع الصوت والاهتزاز',
      importance: 5,
      visibility: 1,
      vibration: true,
      lights: true,
      lightColor: '#E51C19',
    });
    androidChannelInitialized = true;
  } catch {
    // ignore
  }
}

export async function checkUnifiedNotificationPermission(): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    try {
      const status = await LocalNotifications.checkPermissions();
      return status.display === 'granted';
    } catch {
      return false;
    }
  }
  if (typeof Notification !== 'undefined') {
    return Notification.permission === 'granted';
  }
  return false;
}

export async function requestUnifiedNotificationPermission(): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    try {
      const status = await LocalNotifications.requestPermissions();
      if (status.display === 'granted') {
        await ensureAndroidNotificationChannel();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  if (typeof Notification !== 'undefined') {
    const perm = await Notification.requestPermission();
    return perm === 'granted';
  }
  return false;
}

/**
 * إظهار إشعار حقيقي في شريط إشعارات الهاتف (سواء داخل APK أو PWA)
 */
export async function dispatchPhoneSystemNotification(item: {
  title: string;
  body: string;
  tag?: string;
  targetTab?: NotificationTargetTab;
}): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      const granted = await checkUnifiedNotificationPermission();
      if (!granted) return;
      await ensureAndroidNotificationChannel();
      const numericId = Math.floor(100000 + Math.random() * 899999);
      await LocalNotifications.schedule({
        notifications: [
          {
            id: numericId,
            title: item.title,
            body: item.body,
            largeBody: item.body,
            summaryText: 'PHANTOMS — بوابة الفريق',
            channelId: ANDROID_CHANNEL_ID,
            schedule: { at: new Date(Date.now() + 120) },
            extra: {
              targetTab: item.targetTab ?? 'ALL',
              url: '/portal',
            },
          },
        ],
      });
      return;
    } catch {
      // fallback below
    }
  }

  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return;
  }

  const options: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
    body: item.body,
    icon: '/branding/phantoms-mark-192.png',
    badge: '/branding/phantoms-mark-192.png',
    tag: item.tag || `phantoms-${Date.now()}`,
    renotify: true,
    vibrate: [200, 100, 200],
    dir: 'rtl',
    lang: 'ar',
    data: {
      url: '/portal',
      targetTab: item.targetTab ?? 'ALL',
    },
  };

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.showNotification(item.title, options);
        return;
      }
    }
  } catch {
    // fallback to window Notification
  }

  try {
    new Notification(item.title, options);
  } catch {
    // ignore
  }
}

let bannerTimeoutId: number | null = null;

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],
  activeBanner: null,
  soundEnabled: loadSoundPref(),
  drawerOpen: false,

  hydrateForMember: (memberId) => {
    set({ items: loadStoredItems(memberId) });
  },

  pushNotification: (memberId, payload, options = {}) => {
    const {
      triggerSystem = true,
      playSound = true,
      showBanner = true,
    } = options;

    const id = payload.id || `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const existing = get().items;
    if (existing.some((item) => item.id === id)) {
      return;
    }

    const newItem: PhantomsNotificationItem = {
      id,
      title: payload.title,
      body: payload.body,
      category: payload.category,
      targetTab: payload.targetTab,
      senderName: payload.senderName || 'PHANTOMS — الإدارة',
      createdAt: payload.createdAt || new Date().toISOString(),
      read: false,
    };

    const nextItems = [newItem, ...existing].slice(0, 60);
    saveStoredItems(memberId, nextItems);

    if (bannerTimeoutId !== null && typeof window !== 'undefined') {
      window.clearTimeout(bannerTimeoutId);
      bannerTimeoutId = null;
    }

    set({
      items: nextItems,
      activeBanner: showBanner ? newItem : get().activeBanner,
    });

    if (showBanner && typeof window !== 'undefined') {
      bannerTimeoutId = window.setTimeout(() => {
        set((state) => (state.activeBanner?.id === newItem.id ? { activeBanner: null } : state));
      }, 6500);
    }

    if (playSound && get().soundEnabled) {
      playWhatsAppNotificationSound();
    }

    if (triggerSystem) {
      void dispatchPhoneSystemNotification({
        title: newItem.title,
        body: newItem.body,
        tag: newItem.id,
        targetTab: newItem.targetTab,
      });
    }
  },

  dismissBanner: () => {
    if (bannerTimeoutId !== null && typeof window !== 'undefined') {
      window.clearTimeout(bannerTimeoutId);
      bannerTimeoutId = null;
    }
    set({ activeBanner: null });
  },

  markAsRead: (memberId, id) => {
    const next = get().items.map((item) => (item.id === id ? { ...item, read: true } : item));
    saveStoredItems(memberId, next);
    set({ items: next });
  },

  markAllAsRead: (memberId) => {
    const next = get().items.map((item) => ({ ...item, read: true }));
    saveStoredItems(memberId, next);
    set({ items: next });
  },

  clearAll: (memberId) => {
    saveStoredItems(memberId, []);
    set({ items: [] });
  },

  setSoundEnabled: (enabled) => {
    try {
      localStorage.setItem(SOUND_PREF_KEY, enabled ? '1' : '0');
    } catch {
      // ignore
    }
    set({ soundEnabled: enabled });
    if (enabled) {
      playWhatsAppNotificationSound(true);
    }
  },

  setDrawerOpen: (open) => set({ drawerOpen: open }),
}));
