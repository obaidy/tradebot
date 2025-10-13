import React, { createContext, useContext, useMemo, useState } from 'react';
import { ColorSchemeName, useColorScheme } from 'react-native';

export type ThemeMode = 'light' | 'dark';

export interface Theme {
  mode: ThemeMode;
  colors: {
    background: string;
    surface: string;
    surfaceAlt: string;
    border: string;
    textPrimary: string;
    textSecondary: string;
    accent: string;
    accentSoft: string;
    positive: string;
    negative: string;
    warning: string;
    overlay: string;
  };
  spacing: (factor: number) => number;
  radii: {
    sm: number;
    md: number;
    lg: number;
    xl: number;
  };
  typography: {
    fontFamily: string;
    weightRegular: string;
    weightMedium: string;
    weightBold: string;
    sizes: {
      xs: number;
      sm: number;
      md: number;
      lg: number;
      xl: number;
      hero: number;
    };
  };
  shadows: {
    sm: { shadowColor: string; shadowOpacity: number; shadowRadius: number; elevation: number };
    md: { shadowColor: string; shadowOpacity: number; shadowRadius: number; elevation: number };
  };
}

interface ThemeContextValue {
  theme: Theme;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
}

const spacing = (factor: number) => factor * 8;

const baseTheme = {
  spacing,
  radii: {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
  },
  typography: {
    fontFamily: 'System',
    weightRegular: '400',
    weightMedium: '600',
    weightBold: '700',
    sizes: {
      xs: 12,
      sm: 14,
      md: 16,
      lg: 20,
      xl: 24,
      hero: 32,
    },
  },
  shadows: {
    sm: {
      shadowColor: '#000',
      shadowOpacity: 0.12,
      shadowRadius: 6,
      elevation: 3,
    },
    md: {
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 12,
      elevation: 6,
    },
  },
};

const darkColors = {
  background: '#050710',
  surface: '#0B1020',
  surfaceAlt: '#131A2F',
  border: '#1F2942',
  textPrimary: '#F4F7FF',
  textSecondary: '#8F9BB3',
  accent: '#3A7BFA',
  accentSoft: '#274B8F',
  positive: '#3BD39C',
  negative: '#FF6B6B',
  warning: '#F5A623',
  overlay: 'rgba(8, 12, 24, 0.65)',
};

const lightColors = {
  background: '#F7F9FC',
  surface: '#FFFFFF',
  surfaceAlt: '#EFF3FB',
  border: '#D6DEED',
  textPrimary: '#191F33',
  textSecondary: '#62718A',
  accent: '#2F6AF5',
  accentSoft: '#C7D5FF',
  positive: '#1E9E73',
  negative: '#D94D4D',
  warning: '#C7791F',
  overlay: 'rgba(25, 31, 51, 0.45)',
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function resolveInitialMode(systemPreference: ColorSchemeName): ThemeMode {
  if (systemPreference === 'light') return 'light';
  return 'dark';
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const systemPreference = useColorScheme();
  const [mode, setMode] = useState<ThemeMode>(resolveInitialMode(systemPreference));

  const value = useMemo<ThemeContextValue>(() => {
    const theme: Theme = {
      mode,
      ...baseTheme,
      colors: mode === 'dark' ? darkColors : lightColors,
    };

    return {
      theme,
      mode,
      setMode,
      toggleMode: () => setMode((prev) => (prev === 'dark' ? 'light' : 'dark')),
    };
  }, [mode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx.theme;
}

export function useThemeMode(): Pick<ThemeContextValue, 'mode' | 'setMode' | 'toggleMode'> {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useThemeMode must be used within ThemeProvider');
  }
  return {
    mode: ctx.mode,
    setMode: ctx.setMode,
    toggleMode: ctx.toggleMode,
  };
}
