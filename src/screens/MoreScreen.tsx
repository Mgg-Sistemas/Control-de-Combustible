import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Screen, Card, SectionTitle } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { useAuth } from '../context/AuthContext';
import { colors, spacing } from '../theme';

const items: { label: string; route: string; desc: string }[] = [
  { label: 'Autorizaciones', route: 'Authorizations', desc: 'Solicitudes y aprobaciones de despacho' },
  { label: 'Vehículos', route: 'Vehicles', desc: 'Placas y flota' },
  { label: 'Maquinaria', route: 'Machinery', desc: 'Equipos y maquinaria' },
  { label: 'Traslados', route: 'Transfers', desc: 'Movimientos entre tanques' },
];

export default function MoreScreen({ navigation }: any) {
  const { signOut, session, configured } = useAuth();
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
