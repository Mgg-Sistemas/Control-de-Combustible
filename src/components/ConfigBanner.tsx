import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../theme';
import { isSupabaseConfigured } from '../lib/supabase';

/** Aviso visible cuando faltan las variables de entorno de Supabase. */
export function ConfigBanner() {
  if (isSupabaseConfigured) return null;
  return (
    <View style={styles.banner}>
      <Text style={styles.title}>Modo demo — Supabase sin configurar</Text>
      <Text style={styles.text}>
        Copia .env.example a .env, agrega tu URL y anon key, y reinicia con
        {'  '}npx expo start -c
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#FEF3C7',
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    margin: spacing.md,
    marginBottom: 0,
    gap: 2,
  },
  title: { color: colors.warning, fontWeight: '700', fontSize: 14 },
  text: { color: '#78350F', fontSize: 12 },
});
