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
import { useAuth } from '../../context/AuthContext';
import { EyeIcon } from '../../components/EyeIcon';
import { COMPANY_NAME } from '../../lib/company';
import { spacing, radius, AppColors } from '../../theme';
import { useTheme } from '../../theme/ThemeContext';
import { passField } from '../../lib/fonts';

/**
 * PILOTO DE REDISEÑO — Sesión (login). Misma lógica que LoginScreen: usa los MISMOS
 * hooks de useAuth (signInWithUsername / biometricLogin / bioLoginAvailable), por lo
 * que no hay lógica duplicada que se desincronice. Solo cambia el look al lenguaje
 * visual nuevo (navy + acento ámbar en "Entrar").
 */
export default function LoginPilot() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { signInWithUsername, bioLoginAvailable, biometricLogin } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    setLoading(true);
    const res = await signInWithUsername(username, password);
    setLoading(false);
    if (res.error) setError(res.error);
  };

  const submitBiometric = async () => {
    setError(null);
    setLoading(true);
    const res = await biometricLogin();
    setLoading(false);
    if (res.error) setError(res.error);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
        {/* Franja de marca navy con el logo. */}
        <View style={styles.brandBadge}>
          <Image source={require('../../../assets/logo.png')} resizeMode="contain" style={{ width: 120, height: 120 }} />
        </View>
        <Text style={styles.brandTitle}>CONTROL INTERNO</Text>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, textAlign: 'center' }}>{COMPANY_NAME}</Text>
        <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.lg, textAlign: 'center', marginTop: 2 }}>
          Inicia sesión con tu usuario y contraseña
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>Usuario</Text>
          <TextInput
            style={styles.input}
            placeholder="Usuario"
            placeholderTextColor={colors.muted}
            value={username}
            onChangeText={(t) => setUsername(t.replace(/\s/g, '').slice(0, 10))}
            maxLength={10}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={[styles.label, { marginTop: spacing.sm }]}>Contraseña</Text>
          <View style={{ position: 'relative', justifyContent: 'center' }}>
            <TextInput
              style={[styles.input, { paddingRight: 48 }]}
              placeholder="Contraseña"
              placeholderTextColor={colors.muted}
              secureTextEntry={!showPass}
              // Al pulsar 👁 esto deja de ser type="password"; la marca es lo
              // único que impide que se vea en MAYÚSCULA. Ver src/lib/fonts.ts.
              {...passField}
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
            />
            <TouchableOpacity
              onPress={() => setShowPass((v) => !v)}
              accessibilityLabel={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={{ position: 'absolute', right: 14, height: '100%', justifyContent: 'center' }}
            >
              <EyeIcon size={22} color={colors.muted} open={showPass} />
            </TouchableOpacity>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity style={styles.button} onPress={submit} disabled={loading} activeOpacity={0.85}>
            <Text style={styles.buttonText}>{loading ? 'Procesando…' : 'Entrar'}</Text>
          </TouchableOpacity>

          {bioLoginAvailable ? (
            <TouchableOpacity style={styles.bioButton} onPress={submitBiometric} disabled={loading}>
              <Text style={styles.bioText}>👆 Entrar con huella</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <Text style={{ color: colors.muted, textAlign: 'center', marginTop: spacing.lg, fontSize: 12 }}>
          🔒 Acceso restringido. Las cuentas las crea únicamente el administrador.
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, justifyContent: 'center', padding: spacing.lg, maxWidth: 460, width: '100%', alignSelf: 'center' },
  brandBadge: {
    alignSelf: 'center',
    marginBottom: spacing.md,
    backgroundColor: colors.brand,
    borderRadius: 28,
    padding: spacing.lg,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  brandTitle: { color: colors.brand, fontWeight: '900', fontSize: 26, textAlign: 'center', letterSpacing: 0.5 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.sm,
    gap: 2,
  },
  label: { color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 4 },
  input: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  buttonText: { color: colors.accentContrast, fontWeight: '900', fontSize: 16 },
  bioButton: {
    borderWidth: 1.5,
    borderColor: colors.brand,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  bioText: { color: colors.brand, fontWeight: '800', fontSize: 15 },
  error: { color: colors.danger, marginTop: spacing.sm, fontWeight: '600' },
});
