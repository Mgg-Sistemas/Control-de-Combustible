import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { colors, spacing, radius, typography } from '../theme';

export default function BiometricLockScreen() {
  const { unlock, signOut } = useAuth();

  // Lanza el prompt de huella automáticamente al entrar.
  useEffect(() => {
    unlock();
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={{ fontSize: 56 }}>🔒</Text>
        <Text style={[typography.title, { marginTop: spacing.md }]}>Sesión bloqueada</Text>
        <Text style={[typography.muted, { textAlign: 'center', marginTop: spacing.xs }]}>
          Confirma tu identidad con la huella para continuar.
        </Text>

        <TouchableOpacity style={styles.button} onPress={unlock}>
          <Text style={styles.buttonText}>👆 Desbloquear con huella</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={signOut} style={{ marginTop: spacing.lg }}>
          <Text style={typography.muted}>Usar otra cuenta</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  buttonText: { color: colors.primaryContrast, fontWeight: '700', fontSize: 16 },
});
