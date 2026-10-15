import { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type Theme = 'dark' | 'light' | 'system';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: 'dark' | 'light';
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = 'forgeloop-audit-theme';

export function ThemeProvider({ children, defaultTheme = 'dark' }: { children: React.ReactNode; defaultTheme?: Theme }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : defaultTheme;
    } catch {
      return defaultTheme;
    }
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true);
  const resolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return undefined;
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* preference storage is optional */ }
  };

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
