// 🖨️ OPCIONES DEL PAPEL DE LA VENTA (01-nov-2026) — se eligen antes de imprimir.
//
// Sale de 💰 Ventas y de 🧰 Ventas de servicio: UN solo componente, para que las
// dos pestañas impriman igual. Lo que se elige se recuerda POR PERSONA en este
// equipo (AsyncStorage, envuelto en try/catch: si falla, se imprime con lo de
// fábrica). Regla de la casa: lo que se oculta NO se anuncia en el papel.
//
// ⚠️ COMPONENTE DE NIVEL DE MÓDULO, y el modal con zIndex 9999 (en web gana el
//    último montado).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import {
  VENTA_DOC_OPCIONES_DEFAULT, VENTA_LOGOS, VentaDocOpciones, VentaLogoKey, opcionesVentaDoc,
} from '../lib/ventaDocumento';

const claveDe = (usuarioId?: string | null) => `ventaDocOpciones:${usuarioId || 'anon'}`;

type Pendiente = { hayServicio: boolean; imprimir: (op: VentaDocOpciones) => void | Promise<void> };

/**
 * `pedir({ hayServicio, imprimir })` abre las opciones; al tocar «Imprimir» se
 * guardan y se llama `imprimir(op)`. Devuelve también el `modal` a montar.
 */
export function useVentaDocOpciones(usuarioId?: string | null) {
  const [op, setOp] = useState<VentaDocOpciones>(VENTA_DOC_OPCIONES_DEFAULT);
  const [pend, setPend] = useState<Pendiente | null>(null);
  const cargado = useRef(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(claveDe(usuarioId));
        if (vivo && raw) setOp(opcionesVentaDoc(JSON.parse(raw)));
      } catch {}
      cargado.current = true;
    })();
    return () => { vivo = false; };
  }, [usuarioId]);

  const pedir = useCallback((p: Pendiente) => setPend(p), []);

  const confirmar = async () => {
    const p = pend;
    setPend(null);
    try { await AsyncStorage.setItem(claveDe(usuarioId), JSON.stringify(op)); } catch {}
    if (p) await p.imprimir(op);
  };

  const modal = (
    <VentaDocOpcionesModal
      visible={!!pend}
      hayServicio={!!pend?.hayServicio}
      op={op}
      onCambio={setOp}
      onCerrar={() => setPend(null)}
      onImprimir={confirmar}
    />
  );
  return { pedir, modal };
}

type Props = {
  visible: boolean;
  hayServicio: boolean;
  op: VentaDocOpciones;
  onCambio: (op: VentaDocOpciones) => void;
  onCerrar: () => void;
  onImprimir: () => void;
};

export function VentaDocOpcionesModal({ visible, hayServicio, op, onCambio, onCerrar, onImprimir }: Props) {
  const { colors } = useTheme();
  const set = (patch: Partial<VentaDocOpciones>) => onCambio({ ...op, ...patch });

  const fila = (label: string, sub: string, value: boolean, onValue: (v: boolean) => void) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{label}</Text>
        <Text style={{ color: colors.muted, fontSize: 11 }}>{sub}</Text>
      </View>
      <Switch value={value} onValueChange={onValue} />
    </View>
  );

  const pastillas = (titulo: string, valor: VentaLogoKey, onValor: (k: VentaLogoKey) => void) => (
    <View style={{ marginTop: spacing.sm }}>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>{titulo}</Text>
      {/* flexWrap: en el teléfono las pastillas bajan de línea. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {VENTA_LOGOS.map((l) => {
          const on = valor === l.key;
          return (
            <TouchableOpacity
              key={l.key} onPress={() => onValor(l.key)}
              style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingVertical: 6, paddingHorizontal: spacing.md }}
            >
              <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 11 }}>{l.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCerrar}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: spacing.md, zIndex: 9999 }}>
        <View style={{ width: '100%', maxWidth: 520, maxHeight: '90%', backgroundColor: colors.surface, borderRadius: radius.lg ?? radius.md, padding: spacing.md, zIndex: 9999 }}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16, marginBottom: spacing.xs }}>🖨️ Opciones del documento</Text>

            {hayServicio ? (
              <>
                {fila('Ocultar montos de los servicios', 'Sin precio ni total en los servicios; sin subtotal, total ni equivalente en Bs.',
                  op.ocultarMontosServicio, (v) => set({ ocultarMontosServicio: v }))}
                {fila('Ocultar el identificador de servicio', 'Sin la etiqueta «Servicio» ni la unidad «SERV».',
                  op.ocultarIdServicio, (v) => set({ ocultarIdServicio: v }))}
              </>
            ) : null}

            {pastillas('Logo de arriba a la izquierda', op.logo, (k) => set({ logo: k }))}
            {pastillas('Segundo logo (junto al número)', op.logo2, (k) => set({ logo2: k }))}
          </ScrollView>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
            <TouchableOpacity onPress={onCerrar} style={{ flexGrow: 1, minWidth: 120, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onImprimir} style={{ flexGrow: 1, minWidth: 120, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
              <Text style={{ color: colors.accentContrast, fontWeight: '900' }}>🖨️ Imprimir</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
