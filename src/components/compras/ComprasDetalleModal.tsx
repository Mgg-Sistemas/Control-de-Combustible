// 📋 Modal contenedor de detalle para abrir órdenes desde Kanban o Lista sin duplicar lógica (18-nov-2026)
import React from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';

export function ComprasDetalleModal({
  visible,
  titulo,
  subtitulo,
  onClose,
  children,
}: {
  visible: boolean;
  titulo: string;
  subtitulo?: string | null;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.58)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: spacing.sm + 4,
          zIndex: 9998,
        }}
      >
        <View
          style={{
            width: '100%',
            maxWidth: 820,
            maxHeight: '92%',
            backgroundColor: colors.background,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: colors.border,
            overflow: 'hidden',
          }}
        >
          {/* Cabecera */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm + 2,
              backgroundColor: colors.surface,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              gap: spacing.sm,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15 }} numberOfLines={1}>
                {titulo}
              </Text>
              {subtitulo ? (
                <Text style={{ color: colors.muted, fontSize: 11.5 }} numberOfLines={1}>
                  {subtitulo}
                </Text>
              ) : null}
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: radius.sm,
                backgroundColor: colors.surfaceAlt,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>✕ Cerrar</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
