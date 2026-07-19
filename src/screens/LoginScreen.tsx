import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { EyeIcon } from '../components/EyeIcon';
import { COMPANY_NAME } from '../lib/company';
import { spacing, radius, AppColors, AppTypography } from '../theme';
import { useTheme } from '../theme/ThemeContext';

export default function LoginScreen() {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => makeStyles(colors, typography), [colors, typography]);
  // Máxima seguridad: SOLO inicio de sesión, BLINDADO por CÉDULA + contraseña.
  // El registro de usuarios lo hace únicamente el administrador (en Usuarios).
  const { signInWithCedula } = useAuth();
  const [cedula, setCedula] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    setLoading(true);
    const res = await signInWithCedula(cedula, password);
    setLoading(false);
    if (res.error) setError(res.error);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}
      >
        <View
          style={{
            alignSelf: 'center',
            marginBottom: spacing.md,
            backgroundColor: '#FFFFFF',
            borderRadius: 24,
            padding: spacing.md,
            shadowColor: '#000',
            shadowOpacity: 0.15,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
            elevation: 4,
          }}
        >
          <Image
            source={require('../../assets/logo.png')}
            resizeMode="contain"
            style={{ width: 132, height: 132 }}
          />
        </View>
        <Text style={[styles.brand, { textAlign: 'center' }]}>CONTROL INTERNO</Text>
        <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13, textAlign: 'center' }}>{COMPANY_NAME}</Text>
        <Text style={[typography.muted, { marginBottom: spacing.lg, textAlign: 'center' }]}>
          Inicia sesión con tu cédula y contraseña
        </Text>

        <TextInput
          style={styles.input}
          placeholder="Cédula"
          placeholderTextColor={colors.muted}
          value={cedula}
          onChangeText={(t) => setCedula(t.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
          inputMode="numeric"
          autoCapitalize="none"
        />
        <View style={{ position: 'relative', justifyContent: 'center' }}>
          <TextInput
            style={[styles.input, { paddingRight: 48 }]}
            placeholder="Contraseña"
            placeholderTextColor={colors.muted}
            secureTextEntry={!showPass}
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
          />
          <TouchableOpacity
            onPress={() => setShowPass((v) => !v)}
            accessibilityLabel={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={{ position: 'absolute', right: 14, height: '100%', justifyContent: 'center', paddingBottom: spacing.md }}
          >
            <EyeIcon size={22} color={colors.muted} open={showPass} />
          </TouchableOpacity>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity style={styles.button} onPress={submit} disabled={loading}>
          <Text style={styles.buttonText}>{loading ? 'Procesando…' : 'Entrar'}</Text>
        </TouchableOpacity>

        <Text style={[typography.muted, { textAlign: 'center', marginTop: spacing.lg, fontSize: 12 }]}>
          🔒 Acceso restringido. Las cuentas las crea únicamente el administrador.
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: AppColors, typography: AppTypography) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, justifyContent: 'center', padding: spacing.lg },
  brand: { ...typography.title, fontSize: 26 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    color: colors.text,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonText: { color: colors.primaryContrast, fontWeight: '700', fontSize: 16 },
  bioButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  bioText: { color: colors.primary, fontWeight: '700', fontSize: 16 },
  error: { color: colors.danger, marginBottom: spacing.sm },
  info: { color: colors.success, marginBottom: spacing.sm },
});
