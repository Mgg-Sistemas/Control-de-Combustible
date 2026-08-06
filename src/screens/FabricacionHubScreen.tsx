// Módulo de Fabricación (MRP) — panel de entrada. Une el flujo ya en producción
// (Mangueras hidráulicas, Fase 1) con los maestros de la Fase 2 (Centros de
// trabajo, Recetas/BoM, Rutas de producción) en un solo lugar. Es un simple
// router/dashboard — cada tarjeta navega a su pantalla ya existente; no
// duplica ni reescribe ninguna de ellas.
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Screen, Card, SectionTitle } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const ITEMS: { label: string; desc: string; icon: string; route: string }[] = [
  { label: 'Mangueras hidráulicas', desc: 'Confección/reparación por máquina, costeo y autorización de pago', icon: '🧵', route: 'Mangueras' },
  { label: 'Centros de trabajo', desc: 'Áreas, máquinas y cuadrillas: capacidad, costo por hora y turnos', icon: '🏗️', route: 'WorkCenters' },
  { label: 'Recetas (BoM)', desc: 'Componentes, cantidades y merma esperada por producto terminado', icon: '📋', route: 'Bom' },
  { label: 'Rutas de producción', desc: 'Pasos por centro de trabajo, con puntos de control de calidad', icon: '🛤️', route: 'Routes' },
  { label: 'Órdenes de fabricación', desc: 'Planifica producción, revisa disponibilidad de insumos y cierra la orden', icon: '📦', route: 'ManufacturingOrders' },
  { label: 'Órdenes de trabajo', desc: 'Gestiona el avance por centro de trabajo: operario, tiempo, calidad', icon: '🧰', route: 'WorkOrders' },
];

export default function FabricacionHubScreen() {
  const { colors } = useTheme();
  const { moduleLevel } = useAuth();
  const level = moduleLevel('mangueras');
  const navigation = useNavigation<any>();

  return (
    <Screen>
      <Card>
        <SectionTitle>🏭 Fabricación</SectionTitle>
        <Text style={{ color: colors.muted, fontSize: 12.5, marginBottom: spacing.sm }}>
          Módulo de Fabricación (MRP). Fase 1 (mangueras hidráulicas), Fase 2 (centros de trabajo,
          recetas y rutas) y Fase 3 (órdenes de fabricación y de trabajo) ya están en producción.
        </Text>
        {level === 'none' ? (
          <Text style={{ color: colors.dangerSoftText, fontSize: 12.5, fontWeight: '700' }}>
            No tienes permiso para este módulo. Pídeselo a un administrador.
          </Text>
        ) : null}
      </Card>

      {level !== 'none' ? (
        <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
          {ITEMS.map((it) => (
            <TouchableOpacity
              key={it.route}
              onPress={() => navigation.navigate(it.route)}
              activeOpacity={0.7}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.md,
                padding: spacing.md,
              }}
            >
              <Text style={{ fontSize: 26 }}>{it.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14.5 }}>{it.label}</Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{it.desc}</Text>
              </View>
              <Text style={{ color: colors.muted, fontSize: 18 }}>›</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}
