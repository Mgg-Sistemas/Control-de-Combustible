import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AppColors,
  AppTypography,
  lightColors,
  darkColors,
  makeTypography,
} from './index';

type Scheme = 'light' | 'dark';

type ThemeState = {
  scheme: Scheme;
  colors: AppColors;
  typography: AppTypography;
  toggle: () => void;
  setScheme: (s: Scheme) => void;
};

const STORAGE_KEY = 'color_scheme';
const ThemeContext = createContext<ThemeState | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [scheme, setSchemeState] = useState<Scheme>(
    Appearance.getColorScheme() === 'dark' ? 'dark' : 'light'
  );

  // Cargar preferencia guardada
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if (v === 'light' || v === 'dark') setSchemeState(v);
    });
  }, []);

  const setScheme = (s: Scheme) => {
    setSchemeState(s);
    AsyncStorage.setItem(STORAGE_KEY, s);
  };
  const toggle = () => setScheme(scheme === 'dark' ? 'light' : 'dark');

  const value = useMemo<ThemeState>(() => {
    const colors = scheme === 'dark' ? darkColors : lightColors;
    return { scheme, colors, typography: makeTypography(colors), toggle, setScheme };
  }, [scheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme debe usarse dentro de ThemeProvider');
  return ctx;
}
