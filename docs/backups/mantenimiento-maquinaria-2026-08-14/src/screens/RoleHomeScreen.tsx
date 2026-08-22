import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Screen, Card, SectionTitle } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { BiometricToggle } from '../components/BiometricToggle';
import { ChangePasswordButton } from '../components/ChangePasswordButton';
import CoordinadorQrPanel from '../components/CoordinadorQrPanel';
import { AsistenciaButton } from '../components/AsistenciaButton';
import { useAuth } from '../context/AuthContext';
import { spacing } from '../theme';
import { useTheme } from '../theme/ThemeContext';

/** Mapa módulo → destino de navegación (para el panel de un rol dinámico). */
const MODULE_NAV: Record<string, { label: string; route: string; icon: string; desc: string }> = {
  mantenimiento: { label: 'Mantenimiento de Maquinaria', route: 'MantenimientoMaquinaria', icon: '🛠️', desc: 'Averías por máquina y control de reparaciones' },
  operadores: { label: 'Operadores', route: 'Operadores', icon: '👷', desc: 'Jornadas de operadores (quién trabaja y en qué máquina)' },
  supervision: { label: 'Inspecciones', route: 'Supervision', icon: '🪖', desc: 'Rondas de inspectores: check-ins por máquina' },
  inspecciones_maq: { label: 'Inspecciones de Maquinaria', route: 'InspeccionesMaq', icon: '🔍', desc: 'Control por equipo: herramientas/accesorios y reporte de inspección' },
  equipos: { label: 'Catálogo (equipos)', route: 'Equipos', icon: '🚜', desc: 'Lista de máquinas' },
  mapa: { label: 'Mapa', route: 'Map', icon: '🗺️', desc: 'Ubicación de las máquinas' },
  reportes: { label: 'Reportes', route: 'Reports', icon: '📊', desc: 'Combustible y rondas (PDF)' },
  inventario: { label: 'Inventario', route: 'Inventario', icon: '📦', desc: 'Existencias y almacén' },
  comida: { label: 'Distribución de comida', route: 'Comida', icon: '🍽️', desc: 'Comidas por día y persona' },
  control_maquinaria: { label: 'Control de maquinaria', route: 'ControlMaquinaria', icon: '🛠️', desc: 'Horas trabajadas por máquina' },
  asistencia: { label: 'Control de asistencia', route: 'Asistencia', icon: '🕒', desc: 'Marcar entrada/salida escaneando el carnet' },
};

/**
 * Panel de un usuario con ROL DINÁMICO (coordinador): muestra SOLO los módulos que
 * su rol le permite ver y lo lleva a cada uno. No ve el resto del sistema.
 */
export default function RoleHomeScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { appRole, canSee } = useAuth();

  // Rol con panel de COORDINADOR QR (surtir gasoil, avería, marcar lista).
  if (appRole?.panel_type === 'coordinador_qr') {
    return <CoordinadorQrPanel title={appRole.name} />;
  }

  // La asistencia se ofrece SIEMPRE con el botón grande de abajo; se saca de la
  // lista de módulos para no mostrarla dos veces.
  const keys = Object.keys(appRole?.modules ?? {}).filter((k) => k !== 'asistencia' && MODULE_NAV[k] && canSee(k));

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>{appRole?.name ?? 'Mi panel'}</SectionTitle>
      {keys.length > 0 ? (
        <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.sm }}>
          Tu rol te da acceso a {keys.length === 1 ? 'este módulo' : `estos ${keys.length} módulos`}.
        </Text>
      ) : null}

      {/* Marcar asistencia de empleados (escaneo de carnet) — disponible para todos. */}
      <AsistenciaButton onPress={() => navigation.navigate('Asistencia')} />

      {keys.length === 0 ? null : (
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

      <SectionTitle>Seguridad</SectionTitle>
      <BiometricToggle />
    </Screen>
  );
}
