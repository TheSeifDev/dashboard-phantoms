import { create } from 'zustand';

type Theme = 'light' | 'dark';

/** قيمة سليمة فقط — أي شيء آخر من localStorage يُفهم كـ light
    بدل قسر النوع `as Theme` الكاذب على سلسلة عشوائية */
export const parseTheme = (raw: string | null): Theme => (raw === 'dark' ? 'dark' : 'light');

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

/** الثيم مطابق للأصل: data-theme="dark" على عنصر <html> */
export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: parseTheme(localStorage.getItem('tms_theme') ?? localStorage.getItem('theme')),
  setTheme: (theme) => {
    localStorage.setItem('tms_theme', theme);
    localStorage.removeItem('theme');
    document.documentElement.setAttribute('data-theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    set({ theme });
  },
  toggle: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
}));
