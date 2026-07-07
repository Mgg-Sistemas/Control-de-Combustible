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
import { COMPANY_NAME, COMPANY_RIF } from '../lib/company';
import { spacing, radius, AppColors, AppTypography } from '../theme';
import { useTheme } from '../theme/ThemeContext';

export default function LoginScreen() {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => makeStyles(colors, typography), [colors, typography]);
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    setInfo(null);
    setLoading(true);
    const res =
      mode === 'login'
        ? await signIn(firstName, lastName, password)
        : await signUp(firstName, lastName, password);
    setLoading(false);
    if (res.error) {
      setError(res.error);
    } else if (mode === 'signup') {
      setInfo('Usuario creado. Ya puedes iniciar sesión.');
      setMode('login');
      setPassword('');
    }
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
            source={require('../../assets/logo.jpeg')}
            resizeMode="contain"
            style={{ width: 132, height: 132 }}
          />
        </View>
        <Text style={[styles.brand, { textAlign: 'center' }]}>CONTROL INTERNO</Text>
        <Text style={{ color: colors.text, fontWeight: '600', fontSize: 13, textAlign: 'center' }}>{COMPANY_NAME}</Text>
        <Text style={[typography.muted, { marginBottom: spacing.lg, textAlign: 'center' }]}>
          RIF {COMPANY_RIF} · {mode === 'login' ? 'Inicia sesión con tu nombre y apellido' : 'Crea tu cuenta'}
        </Text>

        <TextInput
          style={styles.input}
          placeholder="Nombre"
          placeholderTextColor={colors.muted}
          value={firstName}
          onChangeText={setFirstName}
          autoCapitalize="words"
        />
        <TextInput
          style={styles.input}
          placeholder="Apellido"
          placeholderTextColor={colors.muted}
          value={lastName}
          onChangeText={setLastName}
          autoCapitalize="words"
        />
        <TextInput
          style={styles.input}
          placeholder="Contraseña"
          placeholderTextColor={colors.muted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {info ? <Text style={styles.info}>{info}</Text> : null}

        <TouchableOpacity style={styles.button} onPress={submit} disabled={loading}>
          <Text style={styles.buttonText}>
            {loading ? 'Procesando…' : mode === 'login' ? 'Entrar' : 'Registrarme'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setMode(mode === 'login' ? 'signup' : 'login')}>
          <Text style={[typography.muted, { textAlign: 'center', marginTop: spacing.md }]}>
            {mode === 'login'
              ? '¿No tienes cuenta? Regístrate'
              : '¿Ya tienes cuenta? Inicia sesión'}
          </Text>
        </TouchableOpacity>
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
