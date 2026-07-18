import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { useAuth } from '../context/AuthContext';
import { spacing } from '../theme';
import { useTheme } from '../theme/ThemeContext';

/** Mapa módulo → destino de navegación (para el panel de un rol dinámico). */
const MODULE_NAV: Record<string, { label: string; route: string; icon: string; desc: string }> = {
  mantenimiento: { label: 'Mantenimiento de Maquinaria', route: 'MantenimientoMaquinaria', icon: '🛠️', desc: 'Averías por máquina y control de reparaciones' },
  operadores: { label: 'Operadores', route: 'Operadores', icon: '👷', desc: 'Jornadas de operadores (quién trabaja y en qué máquina)' },
  supervision: { label: 'Supervisión', route: 'Supervision', icon: '🪖', desc: 'Rondas de supervisores: check-ins por máquina' },
  equipos: { label: 'Catálogo (equipos)', route: 'Equipos', icon: '🚜', desc: 'Lista de máquinas' },
  mapa: { label: 'Mapa', route: 'Map', icon: '🗺️', desc: 'Ubicación de las máquinas' },
  reportes: { label: 'Reportes', route: 'Reports', icon: '📊', desc: 'Combustible y rondas (PDF)' },
  inventario: { label: 'Inventario', route: 'Inventario', icon: '📦', desc: 'Existencias y almacén' },
  comida: { label: 'Distribución de comida', route: 'Comida', icon: '🍽️', desc: 'Comidas por día y persona' },
  control_maquinaria: { label: 'Control de maquinaria', route: 'ControlMaquinaria', icon: '🛠️', desc: 'Horas trabajadas por máquina' },
};

/**
 * Panel de un usuario con ROL DINÁMICO (coordinador): muestra SOLO los módulos que
 * su rol le permite ver y lo lleva a cada uno. No ve el resto del sistema.
 */
export default function RoleHomeScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { appRole, canSee } = useAuth();
  const keys = Object.keys(appRole?.modules ?? {}).filter((k) => MODULE_NAV[k] && canSee(k));

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>{appRole?.name ?? 'Mi panel'}</SectionTitle>
      <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.sm }}>
        Tu rol te da acceso a {keys.length === 1 ? 'este módulo' : `estos ${keys.length} módulos`}.
      </Text>

      {keys.length === 0 ? (
        <EmptyState title="Sin módulos asignados" subtitle="Pídele a un administrador que le asigne módulos a tu rol." />
      ) : (
        keys.map((k) => {
          const it = MODULE_NAV[k];
          return (
            <TouchableOpacity key={k} onPress={() => navigation.navigate(it.route)}>
              <Card>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                  <Text style={{ fontSize: 28 }}>{it.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '800', color: colors.text, fontSize: 16 }}>{it.label}</Text>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>{it.desc}</Text>
                  </View>
                  <Text style={{ color: colors.primary, fontSize: 20, fontWeight: '800' }}>›</Text>
                </View>
              </Card>
            </TouchableOpacity>
          );
        })
      )}

      <TouchableOpacity onPress={() => navigation.navigate('Manual')}>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Text style={{ fontSize: 28 }}>📖</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '800', color: colors.text, fontSize: 16 }}>Manual / Ayuda</Text>
              <Text style={{ color: colors.muted, fontSize: 13 }}>Guía paso a paso del sistema</Text>
            </View>
          </View>
        </Card>
      </TouchableOpacity>
    </Screen>
  );
}
