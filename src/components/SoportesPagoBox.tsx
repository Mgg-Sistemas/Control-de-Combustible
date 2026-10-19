// 📎 LOS SOPORTES DEL PAGO DE UNA PERSONA (19-oct-2026, a pedido: «poder
// subirle una imagen de factura o algo así a cada persona, sin dañar ni nada»).
//
// Es la cajita que se abre con el botón «📎 Soportes» en la tarjeta de cada
// persona del período (PagoPersonalScreen). Solo ENSEÑA y SUBE archivos: los
// montos no se tocan desde aquí y el candado del período no aplica — el
// comprobante llega DESPUÉS de pagar (ver src/lib/nominaSoportes.ts).
//
// 📷 CÁMARA Y 🖼️ GALERÍA/ARCHIVO, los dos siempre (regla de la casa 27-sep).
// El de archivo acepta imagen Y PDF (una factura suele ser PDF).
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Image, Linking } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from './ToastProvider';
import { takePhotoAndUpload, pickAndUploadDocFile } from '../lib/photo';
import { agregarSoporte, borrarSoporte, etiquetaSoporte, type SoportePago } from '../lib/nominaSoportes';

type Props = {
  itemId: string;
  periodId: string;
  soportes: SoportePago[];
  /** Subir: escritura en nómina (adjuntar evidencia no mueve montos). */
  puedeSubir: boolean;
  /** Borrar: SOLO nómina full — es evidencia de un pago, no un borrador. */
  puedeBorrar: boolean;
  uid: string | null;
  userName: string | null;
  /** Recarga los soportes del período después de subir o borrar. */
  onCambio: () => void;
};

export function SoportesPagoBox({ itemId, periodId, soportes, puedeSubir, puedeBorrar, uid, userName, onCambio }: Props) {
  const { colors } = useTheme();
  const toast = useToast();
  const [subiendo, setSubiendo] = useState(false);
  const [borrando, setBorrando] = useState<string | null>(null); // id en confirmación

  const guardar = async (r: { ok: boolean; url?: string; error?: string; kind?: 'image' | 'pdf'; name?: string }) => {
    if (!r.ok || !r.url) {
      if (r.error) toast.error(r.error); // sin error = canceló, y cancelar no regaña
      return;
    }
    const { error } = await agregarSoporte({
      itemId, periodId, url: r.url, kind: r.kind ?? 'image', name: r.name ?? null, uid, userName,
    });
    if (error) { toast.error(error); return; }
    toast.success('Soporte guardado.');
    onCambio();
  };

  const subirCamara = async () => {
    if (subiendo) return;
    setSubiendo(true);
    // takePhotoAndUpload arma la ruta <primer arg>/<segundo>/<fecha>.jpg, así
    // que pasándole la carpeta primero todo queda junto en nomina-soportes/.
    await guardar(await takePhotoAndUpload('nomina-soportes', itemId));
    setSubiendo(false);
  };

  const subirArchivo = async () => {
    if (subiendo) return;
    setSubiendo(true);
    await guardar(await pickAndUploadDocFile('nomina-soportes', itemId));
    setSubiendo(false);
  };

  const borrar = async (id: string) => {
    const { error } = await borrarSoporte(id);
    setBorrando(null);
    if (error) { toast.error(error); return; }
    toast.success('Soporte eliminado.');
    onCambio();
  };

  return (
    <View style={{ marginTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs }}>
      {soportes.length === 0 ? (
        <Text style={{ color: colors.muted, fontSize: 11.5 }}>Sin soportes todavía (facturas, comprobantes…).</Text>
      ) : soportes.map((s) => (
        <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 3 }}>
          {/* Tocar el soporte lo abre (la imagen o el PDF, en el navegador). */}
          <TouchableOpacity
            onPress={() => Linking.openURL(s.url).catch(() => toast.error('No se pudo abrir el archivo.'))}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 }}
          >
            {s.kind === 'image' ? (
              <Image source={{ uri: s.url }} style={{ width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt }} />
            ) : (
              <View style={{ width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 18 }}>📄</Text>
              </View>
            )}
            <Text style={{ color: colors.text, fontSize: 11.5, flex: 1 }} numberOfLines={2}>
              {etiquetaSoporte(s)} <Text style={{ color: colors.brandText }}>· abrir ›</Text>
            </Text>
          </TouchableOpacity>
          {puedeBorrar ? (
            borrando === s.id ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <TouchableOpacity onPress={() => borrar(s.id)}>
                  <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 11 }}>🗑️ Sí, borrar</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setBorrando(null)}>
                  <Text style={{ color: colors.muted, fontWeight: '800', fontSize: 11 }}>Cancelar</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={() => setBorrando(s.id)}>
                <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>✕</Text>
              </TouchableOpacity>
            )
          ) : null}
        </View>
      ))}
      {puedeSubir ? (
        <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
          <TouchableOpacity disabled={subiendo} onPress={subirCamara}
            style={{ flex: 1, paddingVertical: 6, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, opacity: subiendo ? 0.5 : 1 }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11.5 }}>📷 Cámara</Text>
          </TouchableOpacity>
          <TouchableOpacity disabled={subiendo} onPress={subirArchivo}
            style={{ flex: 1, paddingVertical: 6, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, opacity: subiendo ? 0.5 : 1 }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11.5 }}>{subiendo ? 'Subiendo…' : '🖼️ Imagen o PDF'}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={{ color: colors.muted, fontSize: 10.5, marginTop: 2 }}>Para subir soportes hace falta escritura en Nómina.</Text>
      )}
    </View>
  );
}
