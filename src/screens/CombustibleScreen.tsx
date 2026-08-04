import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useAuth } from '../context/AuthContext';
// Piloto de rediseño: versiones restilizadas (mismo comportamiento, look nuevo).
// Las originales (modules / AuthorizationsScreen) siguen registradas como pantallas
// sueltas en la navegación; aquí las pestañas de Combustible usan las restilizadas.
import TanksPilot from './TanksPilot';
import IntakesPilot from './redesign/IntakesPilot';
import DispatchesPilot from './redesign/DispatchesPilot';
import AuthorizationsPilot from './redesign/AuthorizationsPilot';

// Un solo módulo "Combustible" que agrupa lo que antes eran secciones separadas.
// Cada sub-pestaña respeta el permiso de su módulo (tanques/ingresos/consumos/
// traslados/autorizaciones) y muestra la MISMA pantalla que ya existía.
const TABS: { key: string; label: string; icon: string; Comp: React.ComponentType<any> }[] = [
  { key: 'tanques', label: 'Tanques', icon: '🛢️', Comp: TanksPilot },
  { key: 'ingresos', label: 'Ingresos', icon: '⬇️', Comp: IntakesPilot },
  { key: 'consumos', label: 'Consumos', icon: '⛽', Comp: DispatchesPilot },
  { key: 'autorizaciones', label: 'Solicitudes', icon: '✅', Comp: AuthorizationsPilot },
];

export default function CombustibleScreen() {
  const { colors } = useTheme();
  const { canSee } = useAuth();
  const tabs = TABS.filter((t) => canSee(t.key));
  const [active, setActive] = useState<string>(tabs[0]?.key ?? 'tanques');
  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Barra de sub-pestañas (arriba, fija) */}
      <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, gap: spacing.sm }}>
          {tabs.map((t) => {
            const on = t.key === active;
            return (
              <TouchableOpacity
                key={t.key}
                onPress={() => setActive(t.key)}
                activeOpacity={0.7}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt }}
              >
                <Text style={{ fontSize: 15 }}>{t.icon}</Text>
                <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Contenido de la sub-pestaña activa (cada pantalla trae su propio scroll) */}
      <View style={{ flex: 1 }}>
        {current ? (
          <current.Comp />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg }}>
            <Text style={{ color: colors.muted, textAlign: 'center' }}>No tienes acceso a las secciones de combustible.</Text>
          </View>
        )}
      </View>
    </View>
  );
}
