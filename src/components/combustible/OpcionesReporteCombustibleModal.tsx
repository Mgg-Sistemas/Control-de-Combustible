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
import {
  LOGOS_COMBUSTIBLE_CATALOGO,
  LOGOS_COMBUSTIBLE_DEFECTO,
  LogoCombustibleKey,
  LogosReporteCombustible,
  OpcionReporte,
  OpcionesActivas,
  diaAnterior,
  esFechaValida,
  mezclarLogosCombustible,
  mezclarOpciones,
} from '../../lib/combustibleReportes';
import SelectorMultiple from './SelectorMultiple';
import { OpcionSeleccion } from '../../lib/combustibleEquipos';

type Props = {
  visible: boolean;
  titulo: string;
  opciones: OpcionReporte[];
  /** Clave de almacenamiento (se le agrega el id de la persona). */
  storageKey: string;
  usuarioId?: string | null;
  onClose: () => void;
  /** 02-nov-2026: elegir uno o varios equipos / tanques (vacío = todos). */
  seleccion?: { titulo: string; todosTexto: string; opciones: OpcionSeleccion[] } | null;
  desdeInicial?: string;
  hastaInicial?: string;
  ocultarFechas?: boolean;
  onGenerar: (p: {
    desde: string;
    hasta: string;
    opciones: OpcionesActivas;
    seleccion: string[];
    logos: LogosReporteCombustible;
  }) => Promise<void> | void;
};

export default function OpcionesReporteCombustibleModal({
  visible,
  titulo,
  opciones,
  storageKey,
  usuarioId,
  onClose,
  onGenerar,
  seleccion,
  desdeInicial,
  hastaInicial,
  ocultarFechas,
}: Props) {
  const { colors } = useTheme();
  const hoy = caracasParts(new Date()).iso;
  const [desde, setDesde] = useState(desdeInicial || hoy);
  const [hasta, setHasta] = useState(hastaInicial || desdeInicial || hoy);
  const [rango, setRango] = useState(Boolean(desdeInicial && hastaInicial && desdeInicial !== hastaInicial));
  const [activas, setActivas] = useState<OpcionesActivas>(() => mezclarOpciones(opciones, null));
  const [logos, setLogos] = useState<LogosReporteCombustible>(() => ({ ...LOGOS_COMBUSTIBLE_DEFECTO }));
  const [generando, setGenerando] = useState(false);
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const clave = `${storageKey}:${usuarioId || 'anon'}`;
  const claveLogos = `${storageKey}:logos:${usuarioId || 'anon'}`;

  useEffect(() => {
    if (!visible) return;
    setError(null);
    if (desdeInicial) {
      setDesde(desdeInicial);
      const h = hastaInicial || desdeInicial;
      setHasta(h);
      setRango(desdeInicial !== h);
    }
    let vivo = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(clave);
        if (vivo) setActivas(mezclarOpciones(opciones, raw ? JSON.parse(raw) : null));
      } catch {
        if (vivo) setActivas(mezclarOpciones(opciones, null));
      }
      try {
        const rawL = await AsyncStorage.getItem(claveLogos);
        if (vivo) setLogos(mezclarLogosCombustible(rawL ? JSON.parse(rawL) : null));
      } catch {
        if (vivo) setLogos({ ...LOGOS_COMBUSTIBLE_DEFECTO });
      }
    })();
    return () => { vivo = false; };
  }, [visible, clave, claveLogos, opciones, desdeInicial, hastaInicial]);

  const cambiar = (k: string, v: boolean) => {
    const sig = { ...activas, [k]: v };
    setActivas(sig);
    try { AsyncStorage.setItem(clave, JSON.stringify(sig)).catch(() => {}); } catch { /* sin almacenamiento: solo esta vez */ }
  };

  const aplicarOpcionesLote = (todas?: boolean) => {
    const sig: OpcionesActivas = {};
    for (const o of opciones) sig[o.key] = typeof todas === 'boolean' ? todas : o.defecto;
    setActivas(sig);
    try { AsyncStorage.setItem(clave, JSON.stringify(sig)).catch(() => {}); } catch { /* ignore */ }
  };

  const cambiarLogo = (k: LogoCombustibleKey) => {
    const sig: LogosReporteCombustible = { ...logos, [k]: !logos[k] };
    setLogos(sig);
    try { AsyncStorage.setItem(claveLogos, JSON.stringify(sig)).catch(() => {}); } catch { /* ignore */ }
  };

  const aplicarLogosLote = (modo: 'todos' | 'defecto' | 'ninguno') => {
    const sig: LogosReporteCombustible =
      modo === 'todos'
        ? { bcv: true, sos: true, golden: true, renace: true, jhenzaen: true }
        : modo === 'ninguno'
        ? { bcv: false, sos: false, golden: false, renace: false, jhenzaen: false }
        : { ...LOGOS_COMBUSTIBLE_DEFECTO };
    setLogos(sig);
    try { AsyncStorage.setItem(claveLogos, JSON.stringify(sig)).catch(() => {}); } catch { /* ignore */ }
  };

  const generar = async () => {
    const d = ocultarFechas ? hoy : desde.trim();
    const h = ocultarFechas ? hoy : rango ? hasta.trim() : d;
    if (!ocultarFechas && (!esFechaValida(d) || !esFechaValida(h))) { setError('Escribe la fecha como AAAA-MM-DD.'); return; }
    const [a, b] = d <= h ? [d, h] : [h, d];
    setError(null);
    setGenerando(true);
    try {
      await onGenerar({ desde: a, hasta: b, opciones: activas, seleccion: elegidos, logos });
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
            {!ocultarFechas ? (
              <>
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
              </>
            ) : null}
            {seleccion ? (
              <SelectorMultiple titulo={seleccion.titulo} todosTexto={seleccion.todosTexto} opciones={seleccion.opciones} seleccion={elegidos} onChange={setElegidos} />
            ) : null}

            {/* 🏷️ Selector de Logos del membrete */}
            <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, gap: spacing.xs }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>🏷️ Logos del membrete (colocar u ocultar)</Text>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  <Pressable onPress={() => aplicarLogosLote('todos')} style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
                    <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>✓ Todos</Text>
                  </Pressable>
                  <Pressable onPress={() => aplicarLogosLote('defecto')} style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
                    <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>↺ Por defecto</Text>
                  </Pressable>
                  <Pressable onPress={() => aplicarLogosLote('ninguno')} style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
                    <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>🚫 Sin logos</Text>
                  </Pressable>
                </View>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {LOGOS_COMBUSTIBLE_CATALOGO.map((item) => {
                  const on = !!logos[item.key];
                  return (
                    <Pressable key={item.key} onPress={() => cambiarLogo(item.key)} style={chip(on)}>
                      <Text style={chipTxt(on)}>{on ? '✓ ' : ''}{item.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: spacing.xs }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>Qué sale en el reporte</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <Pressable onPress={() => aplicarOpcionesLote(true)} style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}>
                  <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>✓ Marcar todo</Text>
                </Pressable>
                <Pressable onPress={() => aplicarOpcionesLote(undefined)} style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt }}>
                  <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>↺ Por defecto</Text>
                </Pressable>
              </View>
            </View>
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
