// 01-nov-2026 — Editar la foto (y la nota, cuando exista la columna) de un consumo
// o de un ingreso de combustible ya registrado. Solo lo abre quien tiene 'full'.
// Foto: cámara Y galería (regla de la casa), dos botones lado a lado.
import React, { useEffect, useState } from 'react';
import { View, Text, Image, Modal, Pressable, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { takePhotoAndUpload, pickPhotoFromGalleryAndUpload } from '../../lib/photo';
import {
  TablaCombustible,
  fotosActivas,
  notasActivas,
  guardarFotosNotaCombustible,
} from '../../lib/combustibleEdicion';

export default function EditarFotosCombustibleModal({
  visible,
  tabla,
  registro,
  carpetaId,
  onClose,
  onSaved,
}: {
  visible: boolean;
  tabla: TablaCombustible;
  registro: { id: string; photos?: string[] | null; notes?: string | null } | null;
  /** Primer segmento de la ruta en el bucket (máquina/vehículo o 'combustible-general'). */
  carpetaId?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { colors } = useTheme();
  const [fotos, setFotos] = useState<string[]>([]);
  const [nota, setNota] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !registro) return;
    setFotos(((registro.photos ?? []) as string[]).filter(Boolean));
    setNota(String(registro.notes ?? ''));
    setMsg(null);
  }, [visible, registro?.id]);

  const conFotos = fotosActivas(tabla);
  const conNota = notasActivas(tabla);
  const carpeta = carpetaId || 'combustible-general';

  const subir = async (origen: 'camara' | 'galeria') => {

    setBusy(true);
    const r = origen === 'camara'
      ? await takePhotoAndUpload(carpeta, 'combustible')
      : await pickPhotoFromGalleryAndUpload(carpeta, 'combustible');
    setBusy(false);
    if (r.ok && typeof r.url === 'string') { const url = r.url; setFotos((p) => [...p, url]); }
    else if (r.error) setMsg(`❌ ${r.error}`);
  };

  const guardar = async () => {
    if (!registro) return;
    setBusy(true);
    const r = await guardarFotosNotaCombustible(tabla, registro.id, fotos, nota);
    setBusy(false);
    if (!r.ok) { setMsg(`❌ ${r.error}`); return; }
    onSaved();
    onClose();
  };

  const btn = { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt } as const;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: spacing.md, zIndex: 9999 }}>
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, maxHeight: '90%', width: '100%', maxWidth: 520, alignSelf: 'center' }}>
          <ScrollView>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16, marginBottom: spacing.sm }}>
              {tabla === 'dispatches' ? 'Editar foto del consumo' : 'Editar foto del ingreso'}
            </Text>
            {conFotos ? (
              <>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                  {fotos.map((uri, i) => (
                    <View key={`${uri}-${i}`}>
                      <Image source={{ uri }} style={{ width: 80, height: 80, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }} resizeMode="cover" />
                      <Pressable onPress={() => setFotos(fotos.filter((_, k) => k !== i))} style={{ position: 'absolute', top: 2, right: 2, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 10, paddingHorizontal: 6 }}>
                        <Text style={{ color: '#fff', fontWeight: '800' }}>×</Text>
                      </Pressable>
                    </View>
                  ))}
                  {fotos.length === 0 ? <Text style={{ color: colors.muted }}>Sin fotos.</Text> : null}
                </View>
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                  <Pressable disabled={busy} onPress={() => subir('camara')} style={btn}><Text style={{ color: colors.text, fontWeight: '700' }}>📷 Cámara</Text></Pressable>
                  <Pressable disabled={busy} onPress={() => subir('galeria')} style={btn}><Text style={{ color: colors.text, fontWeight: '700' }}>🖼️ Galería</Text></Pressable>
                </View>
              </>
            ) : (
              <Text style={{ color: colors.muted }}>Las fotos de ingresos se encienden cuando la base tenga su columna.</Text>
            )}
            {conNota ? (
              <View style={{ marginTop: spacing.md }}>
                <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 4 }}>Nota / observación (opcional)</Text>
                <TextInput
                  value={nota}
                  onChangeText={setNota}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  placeholder="Ej. surtido con bomba manual"
                  placeholderTextColor={colors.muted}
                  style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, minHeight: 70 }}
                />
              </View>
            ) : null}
            {msg ? <Text style={{ color: colors.danger ?? '#c00', marginTop: spacing.sm }}>{msg}</Text> : null}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md }}>
              <Pressable onPress={onClose} style={btn}><Text style={{ color: colors.text }}>Cancelar</Text></Pressable>
              <Pressable disabled={busy} onPress={guardar} style={[btn, { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                {busy ? <ActivityIndicator color={colors.primaryContrast} /> : <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>Guardar</Text>}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
