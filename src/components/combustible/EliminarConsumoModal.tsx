// 🗑️ Modal para eliminar consumo de combustible con opción de revertir o mantener el descuento del tanque
import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { useToast } from '../ToastProvider';
import { etiquetaEquipoCombustible } from '../../lib/fuelRules';
import {
  eliminarConsumoCombustible,
  ModoEliminarConsumo,
} from '../../lib/combustibleEliminar';

export interface EliminarConsumoModalProps {
  visible: boolean;
  despacho: any | null;
  nombreTanque?: string | null;
  onClose: () => void;
  onDeleted?: (modo: ModoEliminarConsumo) => void;
}

const fmtLitros = (n: any) =>
  (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('es-VE', { maximumFractionDigits: 2 });

export default function EliminarConsumoModal({
  visible,
  despacho,
  nombreTanque,
  onClose,
  onDeleted,
}: EliminarConsumoModalProps) {
  const { colors } = useTheme();
  const toast = useToast();
  const [procesando, setProcesando] = useState(false);

  if (!visible || !despacho) return null;

  const infoEquipo = etiquetaEquipoCombustible(despacho);
  const nombreEquipo =
    infoEquipo.codigo !== 'MAQUINARIA' && infoEquipo.codigo !== 'VEHICULO'
      ? infoEquipo.codigo
      : String((despacho as any).apoyo_nombre || infoEquipo.codigo || 'Equipo');
  const placa = infoEquipo.placa || (despacho as any).apoyo_placa || 'S/P (Sin placa)';
  const serial = infoEquipo.serial || (despacho as any).apoyo_serial || 'S/S (Sin serial)';
  const litros = Number(despacho.liters) || 0;
  const tanqueFinal =
    nombreTanque ||
    (despacho.tank?.name ? String(despacho.tank.name) : despacho.tank_id ? 'Tanque asignado' : 'Bomba directa / Sin tanque');
  const fecha = despacho.dispatch_date ? String(despacho.dispatch_date).slice(0, 10) : '—';
  const operador = despacho.driver_operator ? String(despacho.driver_operator).trim() : null;

  const handleEliminar = async (modo: ModoEliminarConsumo) => {
    if (procesando) return;
    setProcesando(true);
    try {
      const res = await eliminarConsumoCombustible({
        despachoId: despacho.id,
        modo,
        despacho,
      });

      if (!res.ok) {
        toast.error(res.error || 'No se pudo eliminar el consumo.');
        setProcesando(false);
        return;
      }

      if (modo === 'revertir') {
        toast.success(`✅ Consumo eliminado y ${fmtLitros(litros)} L devueltos al tanque (${tanqueFinal}).`);
      } else {
        toast.success(`🔒 Consumo eliminado. El tanque (${tanqueFinal}) mantiene los ${fmtLitros(litros)} L descontados.`);
      }

      onDeleted?.(modo);
      onClose();
    } catch (e: any) {
      toast.error('Error al procesar eliminación: ' + (e?.message || 'Error'));
    } finally {
      setProcesando(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={procesando ? undefined : onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.65)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: spacing.md,
          zIndex: 10001,
        }}
      >
        <View
          style={{
            width: '100%',
            maxWidth: 500,
            maxHeight: '90%',
            backgroundColor: colors.surface,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: colors.border,
            padding: spacing.lg,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.25,
            shadowRadius: 10,
            elevation: 8,
          }}
        >
          <ScrollView contentContainerStyle={{ gap: spacing.md }}>
            {/* Cabecera */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                <Text style={{ fontSize: 22 }}>🗑️</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.danger, fontWeight: '900', fontSize: 16 }}>
                    ELIMINAR CONSUMO
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    Elige cómo deseas manejar el inventario del tanque
                  </Text>
                </View>
              </View>
              {!procesando ? (
                <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={{ color: colors.muted, fontWeight: '900', fontSize: 18 }}>✕</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Ficha Resumen del Consumo */}
            <View
              style={{
                backgroundColor: colors.surfaceAlt,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.border,
                padding: spacing.md,
                gap: 6,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 6 }}>
                <View style={{ flex: 1, minWidth: 160 }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>
                    🚜 {nombreEquipo}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    Placa: <Text style={{ fontWeight: '700', color: colors.text }}>{placa}</Text>
                    {serial && serial !== 'S/S (Sin serial)' ? ` · Serial: ${serial}` : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: colors.primary, fontWeight: '900', fontSize: 18, fontVariant: ['tabular-nums'] as any }}>
                    {fmtLitros(litros)} L
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>
                    ⛽ Litros surtidos
                  </Text>
                </View>
              </View>

              <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 2 }} />

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
                <View>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>🛢️ Tanque de origen</Text>
                  <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>{tanqueFinal}</Text>
                </View>
                <View>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>📅 Fecha</Text>
                  <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>{fecha}</Text>
                </View>
                {operador ? (
                  <View>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>👤 Operador / Conductor</Text>
                    <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>{operador}</Text>
                  </View>
                ) : null}
              </View>
            </View>

            {/* Opciones de Eliminación */}
            <View style={{ gap: spacing.sm }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>
                ¿Cómo deseas procesar esta eliminación?
              </Text>

              {/* Opción 1: Revertir al tanque */}
              <TouchableOpacity
                disabled={procesando}
                onPress={() => handleEliminar('revertir')}
                activeOpacity={0.8}
                style={{
                  backgroundColor: colors.surface,
                  borderWidth: 2,
                  borderColor: colors.primary,
                  borderRadius: radius.md,
                  padding: spacing.md,
                  gap: 4,
                  opacity: procesando ? 0.6 : 1,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontSize: 18 }}>🔄</Text>
                  <Text style={{ color: colors.primary, fontWeight: '900', fontSize: 14 }}>
                    ELIMINAR Y REVERTIR AL TANQUE
                  </Text>
                </View>
                <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 17, marginLeft: 26 }}>
                  Devuelve los <Text style={{ fontWeight: '800', color: colors.text }}>{fmtLitros(litros)} L</Text> al tanque ({tanqueFinal}), aumentando su stock disponible.
                  {'\n'}
                  <Text style={{ color: colors.primary, fontStyle: 'italic' }}>
                    💡 Útil si fue un error, duplicado o si el combustible nunca salió físicamente.
                  </Text>
                </Text>
              </TouchableOpacity>

              {/* Opción 2: Solo eliminar sin revertir tanque */}
              <TouchableOpacity
                disabled={procesando}
                onPress={() => handleEliminar('sin_revertir')}
                activeOpacity={0.8}
                style={{
                  backgroundColor: colors.surface,
                  borderWidth: 2,
                  borderColor: colors.danger,
                  borderRadius: radius.md,
                  padding: spacing.md,
                  gap: 4,
                  opacity: procesando ? 0.6 : 1,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ fontSize: 18 }}>🔒</Text>
                  <Text style={{ color: colors.danger, fontWeight: '900', fontSize: 14 }}>
                    SOLO ELIMINAR (SIN REVERTIR TANQUE)
                  </Text>
                </View>
                <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 17, marginLeft: 26 }}>
                  Quita el consumo de las listas, historiales de maquinaria y reportes, pero los <Text style={{ fontWeight: '800', color: colors.text }}>{fmtLitros(litros)} L permanecen descontados</Text> del tanque ({tanqueFinal}).
                  {'\n'}
                  <Text style={{ color: colors.danger, fontStyle: 'italic' }}>
                    💡 Útil si el combustible sí salió físicamente del tanque y no debe reponerse.
                  </Text>
                </Text>
              </TouchableOpacity>
            </View>

            {/* Spinner de carga o botón cancelar */}
            {procesando ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: spacing.sm }}>
                <ActivityIndicator color={colors.primary} />
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>
                  Procesando eliminación de consumo…
                </Text>
              </View>
            ) : (
              <TouchableOpacity
                onPress={onClose}
                style={{
                  paddingVertical: spacing.sm + 2,
                  alignItems: 'center',
                  borderRadius: radius.md,
                  backgroundColor: colors.surfaceAlt,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>
                  Cancelar
                </Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
