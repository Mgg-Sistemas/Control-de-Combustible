/**
 * 02-nov-2026: modal ÚNICO de opciones para los reportes de Combustible
 * (Consumos y Entradas). Recibe la lista de interruptores de cada reporte,
 * permite elegir un día (hoy por defecto) o un rango desde–hasta, y recuerda
 * las opciones por persona (AsyncStorage, con try/catch: si falla, usa las de
 * fábrica). Lo apagado no sale en el papel.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Modal, Pressable, ScrollView, Switch, TextInput, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { caracasParts } from '../../lib/jornada';
import { OpcionReporte, OpcionesActivas, diaAnterior, esFechaValida, mezclarOpciones } from '../../lib/combustibleReportes';

type Props = {
  visible: boolean;
  titulo: string;
  opciones: OpcionReporte[];
  /** Clave de almacenamiento (se le agrega el id de la persona). */
  storageKey: string;
  usuarioId?: string | null;
  onClose: () => void;
  onGenerar: (p: { desde: string; hasta: string; opciones: OpcionesActivas }) => Promise<void> | void;
};

export default function OpcionesReporteCombustibleModal({ visible, titulo, opciones, storageKey, usuarioId, onClose, onGenerar }: Props) {
  const { colors } = useTheme();
  const hoy = caracasParts(new Date()).iso;
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [rango, setRango] = useState(false);
  const [activas, setActivas] = useState<OpcionesActivas>(() => mezclarOpciones(opciones, null));
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clave = `${storageKey}:${usuarioId || 'anon'}`;

  useEffect(() => {
    if (!visible) return;
    setError(null);
    let vivo = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(clave);
        if (vivo) setActivas(mezclarOpciones(opciones, raw ? JSON.parse(raw) : null));
      } catch {
        if (vivo) setActivas(mezclarOpciones(opciones, null));
      }
    })();
    return () => { vivo = false; };
  }, [visible, clave, opciones]);

  const cambiar = (k: string, v: boolean) => {
    const sig = { ...activas, [k]: v };
    setActivas(sig);
    try { AsyncStorage.setItem(clave, JSON.stringify(sig)).catch(() => {}); } catch { /* sin almacenamiento: solo esta vez */ }
  };

  const generar = async () => {
    const d = desde.trim();
    const h = rango ? hasta.trim() : d;
    if (!esFechaValida(d) || !esFechaValida(h)) { setError('Escribe la fecha como AAAA-MM-DD.'); return; }
    const [a, b] = d <= h ? [d, h] : [h, d];
    setError(null);
    setGenerando(true);
    try {
      await onGenerar({ desde: a, hasta: b, opciones: activas });
    } catch (e: any) {
      setError(`No se pudo generar: ${e?.message || e}`);
    } finally {
      setGenerando(false);
    }
  };

  const input = { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 7, color: colors.text, backgroundColor: colors.surfaceAlt, minWidth: 130, flexGrow: 1 } as const;
  const chip = (activo: boolean) => ({ paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: activo ? colors.brand : colors.border, backgroundColor: activo ? colors.brand : colors.surfaceAlt });
  const chipTxt = (activo: boolean) => ({ color: activo ? colors.brandContrast : colors.text, fontWeight: '700' as const, fontSize: 12 });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: spacing.md, zIndex: 9999 }}>
        <View style={{ width: '100%', maxWidth: 520, maxHeight: '92%', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md }}>
          <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 16, marginBottom: spacing.sm }}>🖨️ {titulo}</Text>
          <ScrollView contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.sm }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              <Pressable style={chip(!rango && desde === hoy)} onPress={() => { setRango(false); setDesde(hoy); setHasta(hoy); }}>
                <Text style={chipTxt(!rango && desde === hoy)}>Hoy</Text>
              </Pressable>
              <Pressable style={chip(!rango && desde === diaAnterior(hoy))} onPress={() => { setRango(false); setDesde(diaAnterior(hoy)); }}>
                <Text style={chipTxt(!rango && desde === diaAnterior(hoy))}>Ayer</Text>
              </Pressable>
              <Pressable style={chip(rango)} onPress={() => setRango(!rango)}>
                <Text style={chipTxt(rango)}>Rango desde–hasta</Text>
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' }}>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{rango ? 'Desde' : 'Día'}</Text>
              <TextInput value={desde} onChangeText={setDesde} placeholder="AAAA-MM-DD" placeholderTextColor={colors.muted} style={input} />
              {rango ? (
                <>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>Hasta</Text>
                  <TextInput value={hasta} onChangeText={setHasta} placeholder="AAAA-MM-DD" placeholderTextColor={colors.muted} style={input} />
                </>
              ) : null}
            </View>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, marginTop: spacing.xs }}>Qué sale en el reporte</Text>
            {opciones.map((o) => (
              <View key={o.key} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: 2 }}>
                <Text style={{ color: colors.text, fontSize: 13, flexShrink: 1 }}>{o.label}</Text>
                <Switch value={!!activas[o.key]} onValueChange={(v) => cambiar(o.key, v)} />
              </View>
            ))}
            {error ? <Text style={{ color: '#DC2626', fontWeight: '700', fontSize: 12 }}>{error}</Text> : null}
          </ScrollView>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm }}>
            <Pressable onPress={onClose} style={{ paddingVertical: 9, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
            </Pressable>
            <Pressable onPress={generar} disabled={generando} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.brand, opacity: generando ? 0.6 : 1 }}>
              {generando ? <ActivityIndicator size="small" color={colors.brandContrast} /> : null}
              <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{generando ? 'Generando…' : '🖨️ Generar PDF'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
