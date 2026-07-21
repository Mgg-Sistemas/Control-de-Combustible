import React, { useEffect, useState } from 'react';
import { Text, View, Switch, Alert } from 'react-native';
import { Card } from './ui';
import { isBiometricSupported, isBiometricEnabled, enableBiometric, disableBiometric } from '../lib/biometric';
import { useAuth } from '../context/AuthContext';
import { spacing } from '../theme';
import { useTheme } from '../theme/ThemeContext';

/** Tarjeta reutilizable "Iniciar sesión con huella": la ven TODOS los usuarios
 *  (no solo quienes tienen Ajustes). Activa/desactiva la biometría al abrir la app. */
export function BiometricToggle() {
  const { colors } = useTheme();
  const { rememberBiometricSession } = useAuth();
  const [supported, setSupported] = useState(false);
  const [on, setOn] = useState(false);

  useEffect(() => {
    (async () => { setSupported(await isBiometricSupported()); setOn(await isBiometricEnabled()); })();
  }, []);

  const toggle = async (value: boolean) => {
    if (value) {
      const ok = await enableBiometric();
      if (!ok) { Alert.alert('Huella', 'No se pudo activar. Tu dispositivo debe tener huella o Face ID configurado.'); return; }
      // Guarda la sesión actual para poder ENTRAR con huella aunque luego venza.
      await rememberBiometricSession();
    } else {
      await disableBiometric();
    }
    setOn(value);
  };

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flex: 1, paddingRight: spacing.md }}>
          <Text style={{ fontWeight: '700', color: colors.text }}>🔐 Iniciar sesión con huella</Text>
          <Text style={{ color: colors.muted, fontSize: 13 }}>
            {supported ? 'Pide tu huella o Face ID al abrir la app.' : 'Tu dispositivo no tiene huella o Face ID configurado.'}
          </Text>
        </View>
        <Switch value={on} onValueChange={toggle} disabled={!supported} />
      </View>
    </Card>
  );
}
