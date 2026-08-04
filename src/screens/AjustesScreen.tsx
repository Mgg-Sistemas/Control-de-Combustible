import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View, Switch } from 'react-native';
import { Screen, Card, SectionTitle } from '../components/ui';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import {
  isBiometricSupported,
  isBiometricEnabled,
  enableBiometric,
  disableBiometric,
} from '../lib/biometric';
import { spacing } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { ChangePasswordButton } from '../components/ChangePasswordButton';

/**
 * AJUSTES — preferencias de la cuenta y del dispositivo, reunidas en un módulo
 * propio: apariencia (modo oscuro), seguridad (contraseña + huella/Face ID) y
 * cerrar sesión. Antes vivían al final de la pantalla "Más"; se separaron para
 * que "Más" sea solo el menú de módulos.
 */
export default function AjustesScreen() {
  const { signOut, session, configured } = useAuth();
  const { colors, scheme, toggle } = useTheme();
  const toast = useToast();
  const [bioSupported, setBioSupported] = useState(false);
  const [bioOn, setBioOn] = useState(false);

  useEffect(() => {
    (async () => {
      setBioSupported(await isBiometricSupported());
      setBioOn(await isBiometricEnabled());
    })();
  }, []);

  const toggleBio = async (value: boolean) => {
    if (value) {
      const ok = await enableBiometric();
      if (!ok) {
        toast.error('No se pudo activar. Tu dispositivo debe tener huella o Face ID configurado.');
        return;
      }
    } else {
      await disableBiometric();
    }
    setBioOn(value);
  };

  return (
    <Screen>
      <SectionTitle>Apariencia</SectionTitle>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <Text style={{ fontWeight: '700', color: colors.text }}>Modo oscuro</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>
              {scheme === 'dark' ? 'Activado' : 'Desactivado'} · cambia el tema de la app
            </Text>
          </View>
          <Switch value={scheme === 'dark'} onValueChange={toggle} />
        </View>
      </Card>

      <SectionTitle>Seguridad</SectionTitle>
      <View style={{ marginBottom: spacing.md }}>
        <ChangePasswordButton variant="row" />
      </View>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <Text style={{ fontWeight: '700', color: colors.text }}>Iniciar sesión con huella</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>
              {bioSupported
                ? 'Pide tu huella o Face ID al abrir la app.'
                : 'Tu dispositivo no tiene huella o Face ID configurado.'}
            </Text>
          </View>
          <Switch value={bioOn} onValueChange={toggleBio} disabled={!bioSupported} />
        </View>
      </Card>

      <View style={{ height: spacing.lg }} />
      {configured && session ? (
        <TouchableOpacity onPress={signOut}>
          <Card style={{ alignItems: 'center' }}>
            <Text style={{ color: colors.danger, fontWeight: '700' }}>Cerrar sesión</Text>
          </Card>
        </TouchableOpacity>
      ) : null}
    </Screen>
  );
}
