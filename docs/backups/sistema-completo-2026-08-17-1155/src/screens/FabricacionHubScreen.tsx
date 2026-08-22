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

// Cada tarjeta se gatea por el permiso de módulo que le corresponde: la mayoría
// depende de `mangueras` (el módulo histórico de Fabricación), pero el Kiosco de
// planta tiene su PROPIO permiso `fabricacion_planta` — pensado para un operario
// "solo kiosco" del taller que no debe ver el resto de Fabricación. Así, alguien
// con SOLO `fabricacion_planta` que entre a este hub (ej. porque en el futuro
// también tenga algo de `mangueras`) ve la tarjeta del Kiosco habilitada aunque
// las demás sigan bloqueadas.
const ITEMS: { label: string; desc: string; icon: string; route: string; module: string }[] = [
  { label: 'Mangueras hidráulicas', desc: 'Confección/reparación por máquina, costeo y autorización de pago', icon: '🧵', route: 'Mangueras', module: 'mangueras' },
  { label: 'Centros de trabajo', desc: 'Áreas, máquinas y cuadrillas: capacidad, costo por hora y turnos', icon: '🏗️', route: 'WorkCenters', module: 'mangueras' },
  { label: 'Recetas (BoM)', desc: 'Componentes, cantidades y merma esperada por producto terminado', icon: '📋', route: 'Bom', module: 'mangueras' },
  { label: 'Rutas de producción', desc: 'Pasos por centro de trabajo, con puntos de control de calidad', icon: '🛤️', route: 'Routes', module: 'mangueras' },
  { label: 'Órdenes de fabricación', desc: 'Planifica producción, revisa disponibilidad de insumos y cierra la orden', icon: '📦', route: 'ManufacturingOrders', module: 'mangueras' },
  { label: 'Órdenes de trabajo', desc: 'Gestiona el avance por centro de trabajo: operario, tiempo, calidad', icon: '🧰', route: 'WorkOrders', module: 'mangueras' },
  // (Kiosco de planta se quitó del hub y del menú "Más": salía duplicado. La ruta
  //  PlantaKiosk sigue existiendo para el rol "solo kiosco" que entra directo.)
  { label: 'Reportes de Fabricación', desc: 'OEE (disponibilidad · rendimiento · calidad) y costeo por orden', icon: '📊', route: 'ManufacturingReports', module: 'mangueras' },
];

export default function FabricacionHubScreen() {
  const { colors } = useTheme();
  const { moduleLevel } = useAuth();
  const level = moduleLevel('mangueras');
  const plantaLevel = moduleLevel('fabricacion_planta');
  // Sin acceso a NINGUNO de los dos permisos: ni al resto de Fabricación, ni al
  // Kiosco. Solo entonces se oculta todo el listado y se muestra el aviso.
  const sinAcceso = level === 'none' && plantaLevel === 'none';
  const navigation = useNavigation<any>();

  return (
    <Screen>
      <Card>
        <SectionTitle>🏭 Fabricación</SectionTitle>
        <Text style={{ color: colors.muted, fontSize: 12.5, marginBottom: spacing.sm }}>
          Módulo de Fabricación (MRP). Fase 1 (mangueras hidráulicas), Fase 2 (centros de trabajo,
          recetas y rutas), Fase 3 (órdenes de fabricación y de trabajo), Fase 4 (kiosco de planta)
          y Fase 5 (reportes de OEE y costeo) ya están en producción.
        </Text>
        {sinAcceso ? (
          <Text style={{ color: colors.dangerSoftText, fontSize: 12.5, fontWeight: '700' }}>
            No tienes permiso para este módulo. Pídeselo a un administrador.
          </Text>
        ) : null}
      </Card>

      {!sinAcceso ? (
        <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
          {ITEMS.filter((it) => moduleLevel(it.module) !== 'none').map((it) => (
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
