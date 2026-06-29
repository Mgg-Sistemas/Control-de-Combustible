import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View, Switch, Alert, Platform } from 'react-native';
import { Screen, Card, SectionTitle } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { useAuth } from '../context/AuthContext';
import {
  isBiometricSupported,
  isBiometricEnabled,
  setBiometricEnabled,
  authenticateBiometric,
} from '../lib/biometric';
import { colors, spacing } from '../theme';

const items: { label: string; route: string; desc: string }[] = [
  { label: 'Autorizaciones', route: 'Authorizations', desc: 'Solicitudes y aprobaciones de despacho' },
  { label: 'Vehículos', route: 'Vehicles', desc: 'Placas y flota' },
  { label: 'Maquinaria', route: 'Machinery', desc: 'Equipos y maquinaria' },
  { label: 'Traslados', route: 'Transfers', desc: 'Movimientos entre tanques' },
];

export default function MoreScreen({ navigation }: any) {
  const { signOut, session, configured, role } = useAuth();
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
      // Exigir una verificación antes de activar.
      const ok = await authenticateBiometric();
      if (!ok) {
        Alert.alert('Huella', 'No se pudo verificar la huella.');
        return;
      }
    }
    await setBiometricEnabled(value);
    setBioOn(value);
  };

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Más</SectionTitle>
      {items.map((it) => (
        <TouchableOpacity key={it.route} onPress={() => navigation.navigate(it.route)}>
          <Card>
            <Text style={{ fontWeight: '700', color: colors.text }}>{it.label}</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>{it.desc}</Text>
          </Card>
        </TouchableOpacity>
      ))}

      {role === 'admin' ? (
        <TouchableOpacity onPress={() => navigation.navigate('Users')}>
          <Card>
            <Text style={{ fontWeight: '700', color: colors.text }}>Usuarios</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>
              Crear personas, ver conectados y asignar roles
            </Text>
          </Card>
        </TouchableOpacity>
      ) : null}

      <SectionTitle>Seguridad</SectionTitle>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <Text style={{ fontWeight: '700', color: colors.text }}>Iniciar sesión con huella</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>
              {bioSupported
                ? 'Pide tu huella al abrir la app.'
                : Platform.OS === 'web'
                ? 'Disponible solo en el teléfono (no en el navegador).'
                : 'Tu dispositivo no tiene huella configurada.'}
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
