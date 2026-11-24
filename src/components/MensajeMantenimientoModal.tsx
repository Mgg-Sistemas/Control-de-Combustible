// 💬 Visor / Compartir mensaje de WhatsApp para Mantenimiento Preventivo (24-nov-2026).
import React from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, Linking, Platform, Share } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from './ToastProvider';

type Props = {
  visible: boolean;
  titulo?: string;
  mensaje: string;
  onClose: () => void;
};

export function MensajeMantenimientoModal({ visible, titulo = '💬 Mensaje WhatsApp de Mantenimiento', mensaje, onClose }: Props) {
  const { colors } = useTheme();
  const toast = useToast();

  const copiar = async () => {
    try {
      if (Platform.OS === 'web' && (globalThis as any)?.navigator?.clipboard?.writeText) {
        await (globalThis as any).navigator.clipboard.writeText(mensaje);
        toast.success('Mensaje copiado al portapapeles.');
        return;
      }
      await Share.share({ message: mensaje });
    } catch {
      toast.error('No se pudo copiar el mensaje automáticamente.');
    }
  };

  const abrirWhatsApp = async () => {
    try {
      await Linking.openURL('https://wa.me/?text=' + encodeURIComponent(mensaje));
    } catch {
      toast.error('No se pudo abrir WhatsApp en este dispositivo.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: spacing.md }}>
        <View style={{ width: '100%', maxWidth: 500, maxHeight: '88%', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surfaceAlt }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 14.5, flex: 1 }}>{titulo}</Text>
            <TouchableOpacity onPress={onClose} style={{ padding: spacing.xs }}>
              <Text style={{ color: colors.muted, fontWeight: '800', fontSize: 16 }}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
            <View style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md }}>
              <Text selectable style={{ color: colors.text, fontSize: 13, lineHeight: 19 }}>
                {mensaje}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              <TouchableOpacity
                onPress={copiar}
                style={{ flex: 1, minWidth: 130, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm + 2, alignItems: 'center' }}
              >
                <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 13 }}>📋 Copiar mensaje</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={abrirWhatsApp}
                style={{ flex: 1, minWidth: 140, backgroundColor: '#16A34A', borderRadius: radius.md, paddingVertical: spacing.sm + 2, alignItems: 'center' }}
              >
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>💬 Enviar por WhatsApp</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={onClose}
              style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}
            >
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Cerrar</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
