// 🎛️ Selector de vista para Compras (Actual · Kanban · Lista) + persistencia local por usuario (18-nov-2026)
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import {
  ContextoVistaCompras,
  MODO_VISTA_DEFAULT,
  ModoVistaCompras,
  guardarVistaPreferidaCompras,
  normalizarModoVista,
  obtenerVistaPreferidaCompras,
} from '../../lib/comprasVista';

const OPCIONES_MODO: { key: ModoVistaCompras; label: string; icon: string }[] = [
  { key: 'actual', label: 'Tarjetas (Actual)', icon: '📋' },
  { key: 'kanban', label: 'Kanban', icon: '🗂️' },
  { key: 'lista', label: 'Lista', icon: '≡' },
];

export function useComprasVista(
  contexto: ContextoVistaCompras,
  userId?: string | null,
  permitidos: readonly ModoVistaCompras[] = ['actual', 'kanban', 'lista'],
): [ModoVistaCompras, (m: ModoVistaCompras) => void] {
  const [modo, setModoState] = useState<ModoVistaCompras>(() =>
    obtenerVistaPreferidaCompras(contexto, userId, null, permitidos),
  );

  const key = `compras_vista_${contexto}_${String(userId ?? '').trim() || 'anon'}`;
  const permitidosKey = permitidos.join(',');

  useEffect(() => {
    let vivo = true;
    setModoState(obtenerVistaPreferidaCompras(contexto, userId, null, permitidos));
    AsyncStorage.getItem(key)
      .then((val) => {
        if (!vivo || !val) return;
        setModoState(normalizarModoVista(val, permitidos));
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [key, permitidosKey]);

  const setModo = useCallback(
    (nuevo: ModoVistaCompras) => {
      const limpio = guardarVistaPreferidaCompras(contexto, nuevo, userId, null, permitidos);
      setModoState(limpio);
      AsyncStorage.setItem(key, limpio).catch(() => {});
    },
    [contexto, userId, key],
  );

  return [modo, setModo];
}

export function ComprasViewToggle({
  value,
  onChange,
  permitidos = ['actual', 'kanban', 'lista'],
}: {
  value: ModoVistaCompras;
  onChange: (m: ModoVistaCompras) => void;
  permitidos?: readonly ModoVistaCompras[];
}) {
  const { colors } = useTheme();
  const opciones = OPCIONES_MODO.filter((o) => permitidos.includes(o.key));

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 6,
        backgroundColor: colors.surfaceAlt,
        padding: 4,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        alignSelf: 'flex-start',
        maxWidth: '100%',
      }}
    >
      {opciones.map((op) => {
        const activo = value === op.key;
        return (
          <TouchableOpacity
            key={op.key}
            onPress={() => onChange(op.key)}
            activeOpacity={0.75}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
              paddingHorizontal: spacing.sm + 2,
              paddingVertical: 6,
              borderRadius: radius.sm,
              backgroundColor: activo ? colors.brand : 'transparent',
              borderWidth: 1,
              borderColor: activo ? colors.brand : 'transparent',
            }}
          >
            <Text style={{ fontSize: 13 }}>{op.icon}</Text>
            <Text
              style={{
                fontSize: 12,
                fontWeight: activo ? '800' : '600',
                color: activo ? colors.brandContrast : colors.text,
              }}
            >
              {op.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
