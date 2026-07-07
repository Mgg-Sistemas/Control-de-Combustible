import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View, Switch, Alert } from 'react-native';
import { Screen, Card, SectionTitle } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { useAuth } from '../context/AuthContext';
import {
  isBiometricSupported,
  isBiometricEnabled,
  enableBiometric,
  disableBiometric,
} from '../lib/biometric';
import { spacing } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const items: { label: string; route: string; desc: string; icon: string }[] = [
  { label: 'Maquinaria', route: 'Machinery', desc: 'Equipos, ubicación y estado', icon: '🚜' },
  { label: 'Mapa', route: 'Map', desc: 'Ubicación de las máquinas en Venezuela', icon: '🗺️' },
  { label: 'Autorizaciones', route: 'Authorizations', desc: 'Solicitudes y aprobaciones', icon: '✅' },
  { label: 'Vehículos', route: 'Vehicles', desc: 'Placas y flota', icon: '🚚' },
  { label: 'Traslados', route: 'Transfers', desc: 'Movimientos entre tanques', icon: '🔄' },
  { label: 'Reportes', route: 'Reports', desc: 'Consumo diario (PDF)', icon: '📊' },
];

export default function MoreScreen({ navigation }: any) {
  const { signOut, session, configured, role } = useAuth();
  const { colors, scheme, toggle } = useTheme();
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
        Alert.alert('Biometría', 'No se pudo activar. Tu dispositivo debe tener huella o Face ID configurado.');
        return;
      }
    } else {
      await disableBiometric();
    }
    setBioOn(value);
  };

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Más</SectionTitle>
      {items.map((it) => (
        <TouchableOpacity key={it.route} onPress={() => navigation.navigate(it.route)}>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Text style={{ fontSize: 26 }}>{it.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', color: colors.text, fontSize: 16 }}>{it.label}</Text>
                <Text style={{ color: colors.muted, fontSize: 13 }}>{it.desc}</Text>
              </View>
            </View>
          </Card>
        </TouchableOpacity>
      ))}

      {role === 'admin' ? (
        <TouchableOpacity onPress={() => navigation.navigate('Users')}>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Text style={{ fontSize: 26 }}>👥</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', color: colors.text, fontSize: 16 }}>Usuarios</Text>
                <Text style={{ color: colors.muted, fontSize: 13 }}>Crear personas, ver conectados y asignar roles</Text>
              </View>
            </View>
          </Card>
        </TouchableOpacity>
      ) : null}

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
