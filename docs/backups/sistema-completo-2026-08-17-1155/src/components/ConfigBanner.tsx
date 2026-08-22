import React from 'react';
import { View, Text } from 'react-native';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { isSupabaseConfigured } from '../lib/supabase';

/** Aviso visible cuando faltan las variables de entorno de Supabase. */
export function ConfigBanner() {
  const { colors } = useTheme();
  if (isSupabaseConfigured) return null;
  return (
    <View
      style={{
        backgroundColor: colors.surfaceAlt,
        borderColor: colors.warning,
        borderWidth: 1,
        borderRadius: radius.md,
        padding: spacing.md,
        margin: spacing.md,
        marginBottom: 0,
        gap: 2,
      }}
    >
      <Text style={{ color: colors.warning, fontWeight: '700', fontSize: 14 }}>
        Modo demo — Supabase sin configurar
      </Text>
      <Text style={{ color: colors.muted, fontSize: 12 }}>
        Copia .env.example a .env, agrega tu URL y anon key, y reinicia con npx expo start -c
      </Text>
    </View>
  );
}
