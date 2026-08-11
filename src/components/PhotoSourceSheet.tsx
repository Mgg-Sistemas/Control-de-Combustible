// Hoja simple para elegir el ORIGEN de una foto: cámara o galería. Antes muchas
// pantallas solo abrían la cámara directo (con fallback a galería SOLO si la
// cámara fallaba/sin permiso) — este selector deja al usuario elegir de una vez,
// sin depender de que la cámara falle para poder usar la galería.
import React from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable } from 'react-native';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  visible: boolean;
  onClose: () => void;
  onPickCamera: () => void;
  onPickGallery: () => void;
  title?: string;
};

export default function PhotoSourceSheet({ visible, onClose, onPickCamera, onPickGallery, title = 'Agregar foto' }: Props) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }} onPress={onClose}>
        <Pressable onPress={(e) => e.stopPropagation?.()} style={{ backgroundColor: colors.background, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: spacing.lg, gap: spacing.sm }}>
          <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15, marginBottom: spacing.xs }}>{title}</Text>
          <TouchableOpacity onPress={onPickCamera} style={{ backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
            <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>📷 Tomar foto</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onPickGallery} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
            <Text style={{ color: colors.text, fontWeight: '800' }}>🖼️ Elegir de galería</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={{ paddingVertical: spacing.sm, alignItems: 'center' }}>
            <Text style={{ color: colors.muted, fontWeight: '700' }}>Cancelar</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
