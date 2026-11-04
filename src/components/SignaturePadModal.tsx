// PIZARRA DE FIRMA DIGITAL + CÁMARA Y GALERÍA (04-nov-2026)
//
// Permite al trabajador o responsable firmar con el dedo (teléfono) o ratón (PC)
// generando un SVG en data-URI (`data:image/svg+xml;utf8,...`) que se guarda en el
// expediente y se imprime directamente en el PDF del Acta de Compromiso.
// Además incluye botones de 📷 Cámara y 🖼️ Galería por si se prefiere fotografiar
// la firma en papel.

import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, PanResponder, Image } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { takePhotoAndUpload, pickPhotoAndUpload } from '../lib/photo';
import { useToast } from './ToastProvider';

type Props = {
  visible: boolean;
  title: string;
  subtitle?: string;
  folderKey: string;
  onClose: () => void;
  onSaveSignature: (signatureUri: string) => void;
};

/** Convierte una lista de trazos SVG (`M x y L x y ...`) en un data-URI SVG listo para `<img src="...">`. */
export function trazosASvgDataUri(paths: readonly string[], width = 340, height = 160): string {
  const cleanPaths = paths.filter((p) => p && p.trim().length > 0);
  if (cleanPaths.length === 0) return '';
  const pathEls = cleanPaths
    .map((d) => `<path d="${d}" fill="none" stroke="#0F172A" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${pathEls}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function SignaturePadModal({ visible, title, subtitle, folderKey, onClose, onSaveSignature }: Props) {
  const { colors } = useTheme();
  const toast = useToast();
  const [paths, setPaths] = useState<string[]>([]);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const currentPathRef = useRef<string>('');

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        if (typeof locationX === 'number' && typeof locationY === 'number') {
          const p = `M ${Math.round(locationX)} ${Math.round(locationY)}`;
          currentPathRef.current = p;
          setCurrentPath(p);
        }
      },
      onPanResponderMove: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        if (typeof locationX === 'number' && typeof locationY === 'number') {
          const next = `${currentPathRef.current} L ${Math.round(locationX)} ${Math.round(locationY)}`;
          currentPathRef.current = next;
          setCurrentPath(next);
        }
      },
      onPanResponderRelease: () => {
        if (currentPathRef.current) {
          const finished = currentPathRef.current;
          setPaths((prev) => [...prev, finished]);
          currentPathRef.current = '';
          setCurrentPath('');
        }
      },
    })
  ).current;

  const limpiar = () => {
    currentPathRef.current = '';
    setCurrentPath('');
    setPaths([]);
  };

  const guardarTrazo = () => {
    const todos = currentPath ? [...paths, currentPath] : paths;
    if (todos.length === 0) {
      toast.error('Traza la firma en el recuadro blanco o usa Cámara / Galería.');
      return;
    }
    const uri = trazosASvgDataUri(todos, 340, 160);
    onSaveSignature(uri);
    limpiar();
    onClose();
  };

  const usarCamara = async () => {
    if (uploading) return;
    setUploading(true);
    const r = await takePhotoAndUpload('firmas-actas', folderKey);
    setUploading(false);
    if (!r.ok || !r.url) {
      if (r.error) toast.error(r.error);
      return;
    }
    onSaveSignature(r.url);
    limpiar();
    onClose();
  };

  const usarGaleria = async () => {
    if (uploading) return;
    setUploading(true);
    const r = await pickPhotoAndUpload('firmas-actas', folderKey);
    setUploading(false);
    if (!r.ok || !r.url) {
      if (r.error) toast.error(r.error);
      return;
    }
    onSaveSignature(r.url);
    limpiar();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: spacing.md }}>
        <View style={{ width: '100%', maxWidth: 420, backgroundColor: colors.background, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg }}>
          <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16 }}>✍️ {title}</Text>
          {subtitle ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{subtitle}</Text> : null}
          <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 4, marginBottom: spacing.sm }}>
            Firma con el dedo o el ratón dentro del recuadro blanco, o sube una foto de la firma con Cámara / Galería:
          </Text>

          <View
            {...panResponder.panHandlers}
            style={{
              width: '100%',
              height: 165,
              backgroundColor: '#FFFFFF',
              borderWidth: 2,
              borderColor: colors.brand,
              borderRadius: radius.md,
              overflow: 'hidden',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Svg width="100%" height="100%" viewBox="0 0 340 160">
              {paths.map((d, i) => (
                <Path
                  key={i}
                  d={d}
                  fill="none"
                  stroke="#0F172A"
                  strokeWidth={2.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {currentPath ? (
                <Path
                  d={currentPath}
                  fill="none"
                  stroke="#0F172A"
                  strokeWidth={2.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : null}
            </Svg>
            {paths.length === 0 && !currentPath ? (
              <Text style={{ position: 'absolute', color: '#94A3B8', fontSize: 13, fontWeight: '700', pointerEvents: 'none' as any }}>
                ✍️ Firma aquí
              </Text>
            ) : null}
            <View style={{ position: 'absolute', bottom: 26, left: 24, right: 24, height: 1, backgroundColor: '#CBD5E1', pointerEvents: 'none' as any }} />
          </View>

          <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
            <TouchableOpacity
              onPress={limpiar}
              style={{ flex: 1, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center' }}
            >
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>🧹 Limpiar trazo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={usarCamara}
              disabled={uploading}
              style={{ flex: 1, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, alignItems: 'center', opacity: uploading ? 0.6 : 1 }}
            >
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>📷 Cámara</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={usarGaleria}
              disabled={uploading}
              style={{ flex: 1, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, alignItems: 'center', opacity: uploading ? 0.6 : 1 }}
            >
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>🖼️ Galería</Text>
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <TouchableOpacity
              onPress={onClose}
              style={{ flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}
            >
              <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={guardarTrazo}
              disabled={uploading}
              style={{ flex: 2, paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.brand, alignItems: 'center', opacity: uploading ? 0.6 : 1 }}
            >
              <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>✓ Usar esta firma</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
