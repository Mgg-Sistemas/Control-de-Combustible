import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Card } from './ui';
import { useAuth } from '../context/AuthContext';
import { spacing } from '../theme';
import { useTheme } from '../theme/ThemeContext';

/**
 * Botón directo "ASISTENCIA EMPLEADOS": lleva a marcar entrada/salida escaneando el
 * carnet. Se muestra a los usuarios que NO tienen acceso completo (no-admin), que
 * de otro modo no verían cómo marcar la asistencia desde su panel. El admin ya la
 * tiene en el menú "Más", así que para él no aparece (evita duplicar).
 * `onPress` navega a la pantalla de asistencia (cada panel sabe su ruta).
 */
export function AsistenciaButton({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  const { role } = useAuth();
  if (role === 'admin') return null;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
      <Card style={{ backgroundColor: colors.primary }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Text style={{ fontSize: 28 }}>🕒</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '900', fontSize: 16 }}>ASISTENCIA EMPLEADOS</Text>
            <Text style={{ color: colors.primaryContrast, fontSize: 12, opacity: 0.9 }}>Escanea el carnet para marcar entrada o salida</Text>
          </View>
          <Text style={{ color: colors.primaryContrast, fontSize: 22, fontWeight: '900' }}>›</Text>
        </View>
      </Card>
    </TouchableOpacity>
  );
}
