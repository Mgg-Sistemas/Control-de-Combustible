// 📲 Mensaje / PDF de pago (02-nov-2026). Una cuenta por pagar o varias marcadas:
// vista previa del texto, interruptores de lo que sale (recordados por persona en
// este equipo) y tres salidas: copiar, WhatsApp y PDF. Lo apagado no sale.
//
// ⚠️ Se monta AL FINAL de la pantalla, con zIndex 9999 (en web gana el último montado).
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, Switch, Text, TouchableOpacity, View, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { exportPdf } from '../lib/pdf';
import {
  DatosMensajeCuenta, OpcionesMensajeCuenta, OPCIONES_MENSAJE_DEFECTO, normalizarOpcionesMensaje,
  construirMensajeCuentas, mensajeCuentasHtml, urlWhatsappMensaje,
} from '../lib/cuentaMensaje';

const ETIQUETAS: { k: keyof OpcionesMensajeCuenta; t: string; soloPdf?: boolean }[] = [
  { k: 'nota', t: 'Nota del requerimiento' },
  { k: 'personas', t: 'Solicita / analista / autorizó' },
  { k: 'condiciones', t: 'Condiciones de pago' },
  { k: 'bs', t: 'Monto en Bs' },
  { k: 'banco', t: 'Datos bancarios del proveedor' },
  { k: 'empresa', t: 'Empresa que paga' },
  { k: 'logoBcv', t: 'Logo BCV', soloPdf: true },
  { k: 'logoSos', t: 'Logo SOS', soloPdf: true },
  { k: 'logoGolden', t: 'Logo Golden Touch', soloPdf: true },
  { k: 'logoRenace', t: 'Logo Renace', soloPdf: true },
  { k: 'logoJhenzaen', t: 'Logo Jhenzaen', soloPdf: true },
  { k: 'marcaTexto', t: 'Línea de la empresa en el membrete', soloPdf: true },
];

export function MensajeCuentaModal({ visible, datos, usuarioId, onClose, copiar }: {
  visible: boolean;
  datos: DatosMensajeCuenta[];
  usuarioId?: string | null;
  onClose: () => void;
  copiar: (texto: string, msg?: string) => void | Promise<void>;
}) {
  const { colors } = useTheme();
  const [op, setOp] = useState<OpcionesMensajeCuenta>(OPCIONES_MENSAJE_DEFECTO);
  const [verOpciones, setVerOpciones] = useState(false);
  const [generando, setGenerando] = useState(false);
  const clave = `cxp_mensaje_opciones:${usuarioId || 'anon'}`;

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(clave);
        if (vivo && raw) setOp(normalizarOpcionesMensaje(JSON.parse(raw)));
      } catch { /* sin opciones guardadas: las de fábrica */ }
    })();
    return () => { vivo = false; };
  }, [clave]);

  const cambiar = (k: keyof OpcionesMensajeCuenta, v: boolean) => {
    const sig = { ...op, [k]: v };
    setOp(sig);
    try { AsyncStorage.setItem(clave, JSON.stringify(sig)).catch(() => {}); } catch { /* solo esta vez */ }
  };

  const texto = useMemo(() => construirMensajeCuentas(datos, op), [datos, op]);

  const abrirWhatsapp = async () => {
    const url = urlWhatsappMensaje(texto);
    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(url, '_blank');
      else await Linking.openURL(url);
    } catch { /* sin WhatsApp: queda el botón de copiar */ }
  };

  const pdf = async () => {
    setGenerando(true);
    try {
      const nombre = datos.length === 1 ? `Pago ${datos[0].orden} - ${datos[0].proveedor}` : `Pagos pendientes (${datos.length})`;
      await exportPdf(mensajeCuentasHtml(datos, op), nombre);
    } finally {
      setGenerando(false);
    }
  };

  const boton = (label: string, onPress: () => void, fondo: string, color: string) => (
    <TouchableOpacity onPress={onPress} disabled={generando}
      style={{ flexGrow: 1, flexBasis: 110, backgroundColor: fondo, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: generando ? 0.6 : 1 }}>
      <Text style={{ color, fontWeight: '900', fontSize: 13 }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: spacing.md, zIndex: 9999 }}>
        <View style={{ width: '100%', maxWidth: 560, maxHeight: '92%', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, zIndex: 9999 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16, flexShrink: 1 }}>
              📲 {datos.length > 1 ? `Mensaje de ${datos.length} pagos` : 'Mensaje de pago'}
            </Text>
            <TouchableOpacity onPress={onClose}><Text style={{ color: colors.muted, fontWeight: '900', fontSize: 18 }}>✕</Text></TouchableOpacity>
          </View>

          <TouchableOpacity onPress={() => setVerOpciones((v) => !v)} style={{ marginTop: spacing.xs }}>
            <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>{verOpciones ? '▴ Ocultar opciones' : '⚙️ Opciones (qué sale)'}</Text>
          </TouchableOpacity>
          {verOpciones ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, marginTop: spacing.xs }}>
              {ETIQUETAS.map((e) => (
                <View key={e.k} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexBasis: 230, flexGrow: 1, paddingVertical: 2 }}>
                  <Switch value={!!op[e.k]} onValueChange={(v) => cambiar(e.k, v)} />
                  <Text style={{ color: colors.text, fontSize: 12, flexShrink: 1 }}>{e.t}{e.soloPdf ? ' (PDF)' : ''}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <ScrollView style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceAlt }}
            contentContainerStyle={{ padding: spacing.sm }}>
            <Text selectable style={{ color: colors.text, fontSize: 12.5, lineHeight: 18 }}>{texto}</Text>
          </ScrollView>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
            {boton('📋 Copiar', () => copiar(texto, '📋 Mensaje copiado.'), colors.surfaceAlt, colors.text)}
            {boton('🟢 WhatsApp', abrirWhatsapp, '#16A34A', '#fff')}
            {boton(generando ? 'Generando…' : '📄 PDF', pdf, colors.brand, colors.brandContrast)}
          </View>
        </View>
      </View>
    </Modal>
  );
}
