// SUB-PESTAÑA «CUBICAJE Y REPORTE VOLUMÉTRICO» (09-sep-2026).
//
// Vive dentro del panel de la jefa de «Ruta de viajes de camiones». Mide la
// tolva de cada volqueta, saca los indicadores de la flota y decide cuántos m³
// se le cargan a los viajes de un día o de un rango.
//
// ⚠️ NO ESCRIBE NADA EN LA BASE. El catálogo (`machinery`) se lee y punto: acá
//    no hay un solo insert, update ni delete contra él. Las medidas se guardan
//    en ESTE teléfono (AsyncStorage), igual que el umbral de alerta de otras
//    pantallas. Consecuencia que hay que decir en voz alta: lo que mida una
//    persona NO lo ve otra, y si se limpian los datos del navegador se pierden.
//    Es el precio de no tocar el backend, y fue el pedido.
//
// La matemática y las reglas están en src/lib/cubicaje.ts (puro, con pruebas en
// scripts/test-cubicaje.mjs). Acá solo hay pantalla.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Card, SectionTitle } from './ui';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import {
  Medida, ModoVolumen, MODOS, OpcionesReporte, OPCIONES_POR_DEFECTO,
  volumenDe, kpis, clasificar, etiquetaClase, CLASES, esUnidadOculta, num, m3Texto, dimsTexto,
} from '../lib/cubicaje';

const CLAVE_MEDIDAS = 'cubicaje.medidas.v1';

/** Lo mínimo que necesita el cubicaje de un camión del catálogo. Se pide así, y
 *  no el tipo entero de la pantalla, para que este componente no dependa de
 *  cómo esté armada `ViajesCamionesScreen`. */
export type CamionCubicaje = {
  id: string;
  code: string;
  plate: string | null;
  serial: string | null;
  marca: string | null;
  modelo: string | null;
  companyName: string;
};

export type CubicajeState = {
  medidas: Medida[];
  porTruck: Map<string, Medida>;
  guardar: (m: Medida) => void;
  borrar: (id: string) => void;
  modo: ModoVolumen;
  setModo: (m: ModoVolumen) => void;
  totalGlobal: string;
  setTotalGlobal: (v: string) => void;
  manual: Record<string, string>;
  setManual: (k: string, v: string) => void;
  op: OpcionesReporte;
  setOp: (k: keyof OpcionesReporte, v: boolean) => void;
  mostrarOcultas: boolean;
  setMostrarOcultas: (v: boolean) => void;
};

/**
 * Todo el estado del cubicaje, en un solo objeto.
 *
 * Va en un hook —y no dentro del componente— porque el REPORTE lo necesita
 * también, y vive en otra sub-pestaña. Con el estado adentro, cambiar de
 * pestaña desmontaría el componente y se perderían las medidas justo antes de
 * exportar.
 */
export function useCubicaje(): CubicajeState {
  const [medidas, setMedidas] = useState<Medida[]>([]);
  const [modo, setModo] = useState<ModoVolumen>('tolva');
  const [totalGlobal, setTotalGlobal] = useState('');
  const [manual, setManualMap] = useState<Record<string, string>>({});
  const [op, setOpMap] = useState<OpcionesReporte>(OPCIONES_POR_DEFECTO);
  const [mostrarOcultas, setMostrarOcultas] = useState(false);
  const [cargado, setCargado] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(CLAVE_MEDIDAS);
        if (raw) {
          const v = JSON.parse(raw);
          if (Array.isArray(v)) setMedidas(v.filter((x) => x && typeof x.id === 'string'));
        }
      } catch {}
      // ⚠️ La bandera se levanta pase lo que pase. Si se quedara abajo tras un
      //    error de lectura, el efecto de guardar no correría nunca y las
      //    medidas nuevas se perderían al recargar, en silencio.
      setCargado(true);
    })();
  }, []);

  // Solo DESPUÉS de haber leído: si no, el primer render (con la lista vacía)
  // pisaría en el disco las medidas que ya había.
  useEffect(() => {
    if (!cargado) return;
    AsyncStorage.setItem(CLAVE_MEDIDAS, JSON.stringify(medidas)).catch(() => {});
  }, [medidas, cargado]);

  const guardar = useCallback((m: Medida) => {
    setMedidas((prev) => {
      const i = prev.findIndex((x) => x.id === m.id);
      if (i >= 0) { const n = prev.slice(); n[i] = m; return n; }
      return [...prev, m];
    });
  }, []);

  const borrar = useCallback((id: string) => setMedidas((prev) => prev.filter((x) => x.id !== id)), []);
  const setManual = useCallback((k: string, v: string) => setManualMap((p) => ({ ...p, [k]: v })), []);
  const setOp = useCallback((k: keyof OpcionesReporte, v: boolean) => setOpMap((p) => ({ ...p, [k]: v })), []);

  // Una sola medida por camión del catálogo: la última que se guardó manda.
  const porTruck = useMemo(() => {
    const m = new Map<string, Medida>();
    for (const x of medidas) if (x.truckId) m.set(x.truckId, x);
    return m;
  }, [medidas]);

  return { medidas, porTruck, guardar, borrar, modo, setModo, totalGlobal, setTotalGlobal,
    manual, setManual, op, setOp, mostrarOcultas, setMostrarOcultas };
}

// ── Piezas de pantalla ──────────────────────────────────────────────────────

/** Interruptor de un solo toque. Sin `Switch` de react-native a propósito: en
 *  web se pinta distinto en cada navegador y esta pantalla se usa en las dos. */
export function Toggle({ on, label, onPress, ayuda }: { on: boolean; label: string; onPress: () => void; ayuda?: string }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 5 }}
    >
      <View style={{ width: 38, height: 22, borderRadius: 11, padding: 2, backgroundColor: on ? colors.brand : colors.border, justifyContent: 'center' }}>
        <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', alignSelf: on ? 'flex-end' : 'flex-start' }} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>{label}</Text>
        {ayuda ? <Text style={{ color: colors.muted, fontSize: 10 }}>{ayuda}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

function Kpi({ ico, titulo, valor }: { ico: string; titulo: string; valor: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 96, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surface }}>
      <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '800' }}>{ico} {titulo}</Text>
      <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 18 }}>{valor}</Text>
      <Text style={{ color: colors.muted, fontSize: 10 }}>m³</Text>
    </View>
  );
}

const MANUAL = '__manual__';

export function CubicajeTab({
  cub, trucks, viajesPorCamion,
}: {
  cub: CubicajeState;
  trucks: CamionCubicaje[];
  /** Cuántos viajes tiene cada camión en el rango que hay filtrado arriba. */
  viajesPorCamion: Map<string, number>;
}) {
  const { colors } = useTheme();
  const [sel, setSel] = useState<string>('');
  const [busca, setBusca] = useState('');
  const [ident, setIdent] = useState('');
  const [marca, setMarca] = useState('');
  const [modelo, setModelo] = useState('');
  const [alto, setAlto] = useState('');
  const [largo, setLargo] = useState('');
  const [ancho, setAncho] = useState('');
  const [editId, setEditId] = useState<string | null>(null);

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, fontSize: 13 } as const;

  // El catálogo, con la unidad apartada fuera salvo que se pida verla.
  const visibles = useMemo(
    () => trucks.filter((t) => cub.mostrarOcultas || !esUnidadOculta(t.code, t.marca, t.modelo, t.plate, t.companyName)),
    [trucks, cub.mostrarOcultas]
  );
  const ocultas = trucks.length - visibles.length;

  const opciones = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const lista = q
      ? visibles.filter((t) => `${t.code} ${t.plate ?? ''} ${t.serial ?? ''} ${t.marca ?? ''} ${t.modelo ?? ''} ${t.companyName}`.toLowerCase().includes(q))
      : visibles;
    return lista.slice(0, 40);
  }, [visibles, busca]);

  const elegir = (t: CamionCubicaje | null) => {
    if (!t) {
      setSel(MANUAL); setEditId(null);
      setIdent(''); setMarca(''); setModelo(''); setAlto(''); setLargo(''); setAncho('');
      return;
    }
    setSel(t.id);
    const ya = cub.porTruck.get(t.id);
    setEditId(ya?.id ?? null);
    // Identificador, marca y modelo salen del catálogo: se leen, no se escriben.
    setIdent(ya?.ident || `${t.code}${t.plate ? ` · ${t.plate}` : ''}`);
    setMarca(ya?.marca || t.marca || '');
    setModelo(ya?.modelo || t.modelo || '');
    setAlto(ya ? String(ya.alto) : '');
    setLargo(ya ? String(ya.largo) : '');
    setAncho(ya ? String(ya.ancho) : '');
  };

  const m3Vivo = volumenDe({ alto: num(alto), largo: num(largo), ancho: num(ancho) });
  const puedeGuardar = !!sel && m3Vivo > 0 && (sel !== MANUAL || ident.trim().length > 0);

  const guardar = () => {
    if (!puedeGuardar) return;
    cub.guardar({
      id: editId ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      truckId: sel === MANUAL ? null : sel,
      ident: ident.trim() || 'Sin identificar',
      marca: marca.trim(),
      modelo: modelo.trim(),
      alto: num(alto), largo: num(largo), ancho: num(ancho),
    });
    setSel(''); setEditId(null);
    setIdent(''); setMarca(''); setModelo(''); setAlto(''); setLargo(''); setAncho('');
  };

  // La flota que se está viendo: las medidas de camiones visibles + las manuales.
  const idsVisibles = useMemo(() => new Set(visibles.map((t) => t.id)), [visibles]);
  const medidasVistas = useMemo(
    () => cub.medidas.filter((m) => !m.truckId || idsVisibles.has(m.truckId)),
    [cub.medidas, idsVisibles]
  );
  const k = useMemo(() => kpis(medidasVistas.map(volumenDe)), [medidasVistas]);

  /**
   * A quién se le puede escribir un total a mano.
   *
   * ⚠️ A TODO camión CON VIAJES en el rango, esté medido o no. Si la lista
   *    saliera solo de lo medido, para poder anotarle 40 m³ a un camión habría
   *    que inventarle antes unas medidas de tolva que nadie tomó — y esas
   *    medidas falsas se quedarían luego en los indicadores de la flota.
   */
  const asignables = useMemo(() => {
    const lista = visibles
      .filter((t) => (viajesPorCamion.get(t.id) ?? 0) > 0)
      .map((t) => {
        const md = cub.porTruck.get(t.id);
        return {
          id: t.id,
          nombre: md?.ident || `${t.code}${t.plate ? ` · ${t.plate}` : ''}`,
          viajes: viajesPorCamion.get(t.id) ?? 0,
          medido: !!md,
        };
      });
    return lista.sort((a, b) => b.viajes - a.viajes);
  }, [visibles, viajesPorCamion, cub.porTruck]);

  const totalViajes = useMemo(() => {
    let s = 0;
    medidasVistas.forEach((m) => { if (m.truckId) s += viajesPorCamion.get(m.truckId) ?? 0; });
    return s;
  }, [medidasVistas, viajesPorCamion]);

  return (
    <>
      <Card>
        <SectionTitle>📐 Medir una volqueta</SectionTitle>
        <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.sm }}>
          Las medidas se guardan <Text style={{ fontWeight: '800' }}>en este dispositivo</Text>. No se agregan al catálogo
          de vehículos ni las ve otra persona: este apartado lee el catálogo, nunca lo modifica.
        </Text>

        <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>¿QUÉ UNIDAD?</Text>
        <TextInput
          value={busca}
          onChangeText={setBusca}
          placeholder="Buscar por código, placa, marca…"
          placeholderTextColor={colors.muted}
          style={[input, { marginTop: 4 }]}
        />
        <TouchableOpacity
          onPress={() => elegir(null)}
          style={{ marginTop: spacing.xs, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: sel === MANUAL ? colors.brand : colors.border, backgroundColor: sel === MANUAL ? colors.brand : colors.surface, padding: spacing.sm }}
        >
          <Text style={{ color: sel === MANUAL ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 12 }}>
            ➕ Medir nueva volqueta (manual)
          </Text>
        </TouchableOpacity>

        <ScrollView style={{ maxHeight: 190, marginTop: spacing.xs }} nestedScrollEnabled>
          {opciones.map((t) => {
            const on = sel === t.id;
            const ya = cub.porTruck.get(t.id);
            const v = ya ? volumenDe(ya) : 0;
            return (
              <TouchableOpacity
                key={t.id}
                onPress={() => elegir(t)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 7, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: on ? colors.brand : 'transparent', backgroundColor: on ? colors.surface : 'transparent' }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }} numberOfLines={1}>
                    🚛 {t.code}{t.plate ? ` · ${t.plate}` : t.serial ? ` · ${t.serial}` : ''}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 10 }} numberOfLines={1}>
                    {[t.marca, t.modelo].filter(Boolean).join(' ') || 'Sin marca ni modelo en la ficha'} · {t.companyName || 'Sin empresa'}
                  </Text>
                </View>
                <Text style={{ color: v > 0 ? colors.brandText : colors.muted, fontWeight: '800', fontSize: 12 }}>
                  {v > 0 ? `${m3Texto(v)} m³` : 'sin medir'}
                </Text>
              </TouchableOpacity>
            );
          })}
          {opciones.length === 0 ? (
            <Text style={{ color: colors.muted, fontSize: 12, padding: spacing.sm }}>Ningún camión con esa búsqueda.</Text>
          ) : null}
        </ScrollView>

        {ocultas > 0 || cub.mostrarOcultas ? (
          <Toggle
            on={cub.mostrarOcultas}
            onPress={() => cub.setMostrarOcultas(!cub.mostrarOcultas)}
            label={cub.mostrarOcultas ? 'Mostrando las unidades apartadas' : `Hay ${ocultas} unidad(es) apartada(s) de este apartado`}
            ayuda="Carbozulia Sinotruk (HOWO) no entra en el cubicaje por pedido. Sus viajes se siguen registrando y contando igual en el resto del módulo."
          />
        ) : null}

        {sel ? (
          <View style={{ marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>IDENTIFICADOR {sel === MANUAL ? '*' : ''}</Text>
            <TextInput value={ident} onChangeText={setIdent} placeholder="VOLQUETA 12" placeholderTextColor={colors.muted} style={[input, { marginTop: 4 }]} />

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>MARCA</Text>
                <TextInput value={marca} onChangeText={setMarca} placeholder="Mack" placeholderTextColor={colors.muted} style={[input, { marginTop: 4 }]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>MODELO</Text>
                <TextInput value={modelo} onChangeText={setModelo} placeholder="Granite" placeholderTextColor={colors.muted} style={[input, { marginTop: 4 }]} />
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
              {([['Alto (m)', alto, setAlto], ['Largo (m)', largo, setLargo], ['Ancho (m)', ancho, setAncho]] as const).map(([lab, val, set]) => (
                <View key={lab} style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>{lab}</Text>
                  <TextInput
                    value={val}
                    onChangeText={set as (v: string) => void}
                    keyboardType="decimal-pad"
                    placeholder="0,00"
                    placeholderTextColor={colors.muted}
                    style={[input, { marginTop: 4, textAlign: 'center' }]}
                  />
                </View>
              ))}
            </View>

            {/* El resultado se calcula mientras se escribe: si sale un número que
                no tiene sentido, se ve ANTES de guardarlo. */}
            <View style={{ marginTop: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: m3Vivo > 0 ? colors.brand : colors.border, padding: spacing.sm, alignItems: 'center' }}>
              <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 22 }}>{m3Vivo > 0 ? m3Vivo.toFixed(2) : '—'} m³</Text>
              <Text style={{ color: colors.muted, fontSize: 11 }}>
                {m3Vivo > 0 ? etiquetaClase(m3Vivo) : 'Escribe alto, largo y ancho'}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <TouchableOpacity onPress={() => { setSel(''); setEditId(null); }} style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={guardar}
                disabled={!puedeGuardar}
                style={{ flex: 2, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.brand, opacity: puedeGuardar ? 1 : 0.5 }}
              >
                <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 13 }}>
                  {editId ? '💾 Actualizar medida' : '💾 Guardar medida'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </Card>

      <Card>
        <SectionTitle>📊 Capacidad de la flota medida</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          <Kpi ico="⬆️" titulo="MAYOR" valor={k.n ? k.mayor.toFixed(2) : '—'} />
          <Kpi ico="⬇️" titulo="MENOR" valor={k.n ? k.menor.toFixed(2) : '—'} />
          <Kpi ico="➗" titulo="PROMEDIO" valor={k.n ? k.promedio.toFixed(2) : '—'} />
        </View>
        <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>
          Sobre {k.n} unidad(es) medida(s). Las que no tienen medida quedan fuera del cálculo: contarlas como 0
          hundiría el promedio y diría que la flota carga menos de lo que carga.
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
          {CLASES.map((c) => {
            const n = medidasVistas.filter((m) => clasificar(volumenDe(m)) === c.key).length;
            return (
              <Text key={c.key} style={{ color: colors.muted, fontSize: 11 }}>
                {c.ico} {c.label}: <Text style={{ fontWeight: '800', color: colors.text }}>{n}</Text>
              </Text>
            );
          })}
        </View>
      </Card>

      <Card>
        <SectionTitle>📋 Unidades medidas ({medidasVistas.length})</SectionTitle>
        {medidasVistas.length === 0 ? (
          <Text style={{ color: colors.muted, fontSize: 12 }}>Todavía no hay ninguna medida. Mide una arriba.</Text>
        ) : (
          <ScrollView style={{ maxHeight: 300 }} nestedScrollEnabled>
            {medidasVistas.map((m) => {
              const v = volumenDe(m);
              const viajes = m.truckId ? viajesPorCamion.get(m.truckId) ?? 0 : 0;
              return (
                <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }} numberOfLines={1}>
                      {m.truckId ? '🚛' : '✍️'} {m.ident}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 10 }} numberOfLines={1}>
                      {[m.marca, m.modelo].filter(Boolean).join(' ') || 'Sin marca ni modelo'} · {dimsTexto(m)} m · {etiquetaClase(v)}
                      {m.truckId ? ` · ${viajes} viaje(s) en el rango` : ' · medida a mano, sin viajes'}
                    </Text>
                  </View>
                  <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 13 }}>{m3Texto(v)}</Text>
                  <TouchableOpacity onPress={() => cub.borrar(m.id)} style={{ padding: 4 }}>
                    <Text style={{ fontSize: 14 }}>🗑️</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>
        )}
      </Card>

      <Card>
        <SectionTitle>🧮 Cómo se le cargan los m³ a los viajes</SectionTitle>
        <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs }}>
          Se aplica al <Text style={{ fontWeight: '800' }}>mismo rango de fechas</Text> que tengas puesto en «Lista completa de
          viajes»: un día, varios días sueltos o un rango. Ahí hay {totalViajes} viaje(s) de unidades medidas.
        </Text>
        {MODOS.map((m) => {
          const on = cub.modo === m.key;
          return (
            <TouchableOpacity
              key={m.key}
              onPress={() => cub.setModo(m.key)}
              style={{ borderRadius: radius.md, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.surface : 'transparent', padding: spacing.sm, marginBottom: spacing.xs }}
            >
              <Text style={{ color: on ? colors.brandText : colors.text, fontWeight: '800', fontSize: 12 }}>{m.label}</Text>
              <Text style={{ color: colors.muted, fontSize: 10, marginTop: 2 }}>{m.ayuda}</Text>
            </TouchableOpacity>
          );
        })}

        {cub.modo === 'proporcional' ? (
          <View style={{ marginTop: spacing.xs }}>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>TOTAL DE m³ DEL RANGO</Text>
            <TextInput
              value={cub.totalGlobal}
              onChangeText={cub.setTotalGlobal}
              keyboardType="decimal-pad"
              placeholder="0,00"
              placeholderTextColor={colors.muted}
              style={[input, { marginTop: 4 }]}
            />
            <Text style={{ color: colors.muted, fontSize: 10, marginTop: 4 }}>
              Se reparte entre los camiones según cuántos viajes hizo cada uno en el rango. Sin viajes en el rango, todos quedan en cero.
            </Text>
          </View>
        ) : null}

        {cub.modo === 'manual' ? (
          <View style={{ marginTop: spacing.xs }}>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginBottom: 4 }}>TOTAL DEL RANGO POR CAMIÓN</Text>
            <ScrollView style={{ maxHeight: 260 }} nestedScrollEnabled>
              {asignables.map((a) => (
                <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 5 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: 12 }} numberOfLines={1}>{a.nombre}</Text>
                    <Text style={{ color: colors.muted, fontSize: 10 }}>
                      {a.viajes} viaje(s){a.medido ? '' : ' · sin medir'}
                    </Text>
                  </View>
                  <TextInput
                    value={cub.manual[a.id] ?? ''}
                    onChangeText={(v) => cub.setManual(a.id, v)}
                    keyboardType="decimal-pad"
                    placeholder="0,00"
                    placeholderTextColor={colors.muted}
                    style={[input, { width: 92, paddingVertical: 6, textAlign: 'center' }]}
                  />
                </View>
              ))}
              {asignables.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  Ningún camión tiene viajes en el rango que hay puesto en «Lista completa de viajes».
                </Text>
              ) : null}
            </ScrollView>
          </View>
        ) : null}

        <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs }}>
          Para que los m³ salgan impresos, enciende «Metros cúbicos» en <Text style={{ fontWeight: '800' }}>🖨️ Qué sale en el
          reporte</Text>, dentro de la pestaña 🚛 Viajes, y exporta desde ahí.
        </Text>
      </Card>
    </>
  );
}

/** El panel de interruptores del reporte. Vive junto al botón de exportar —en la
 *  otra sub-pestaña— porque es ahí donde se usa: configurar en un sitio y
 *  exportar en otro es como se olvidan encendidos los filtros. */
export function OpcionesReporteBox({
  op, setOp, modoResumen, aviso,
}: {
  op: OpcionesReporte;
  setOp: (k: keyof OpcionesReporte, v: boolean) => void;
  modoResumen: boolean;
  aviso: string | null;
}) {
  const { colors } = useTheme();
  const [abierto, setAbierto] = useState(false);
  const encendidas = (Object.keys(OPCIONES_POR_DEFECTO) as (keyof OpcionesReporte)[])
    .filter((k) => op[k] !== OPCIONES_POR_DEFECTO[k]).length;

  const filas: { k: keyof OpcionesReporte; label: string; ayuda?: string }[] = [
    { k: 'm3', label: '📐 Metros cúbicos', ayuda: 'Columna de m³ y su sumatoria. Sale de lo que midas en 📐 Cubicaje.' },
    { k: 'viajes', label: '🔢 Conteo de viajes', ayuda: modoResumen ? 'Columnas Día, Noche y Viajes del resumido.' : 'En el detallado cada línea ES un viaje: este interruptor solo afecta al resumido.' },
    { k: 'marcaModelo', label: '🏷️ Marca y modelo' },
    { k: 'dimensiones', label: '📏 Alto, largo y ancho' },
    { k: 'clasificacion', label: '🔶 Clasificación por capacidad' },
    { k: 'placa', label: '🚗 Placa / serial' },
    { k: 'chofer', label: '👤 Chofer', ayuda: modoResumen ? 'Solo en el detallado.' : undefined },
    { k: 'listero', label: '📝 Listero', ayuda: modoResumen ? 'Solo en el detallado.' : undefined },
    { k: 'turno', label: '🌓 Turno', ayuda: modoResumen ? 'Solo en el detallado.' : undefined },
    { k: 'estado', label: '⚙️ Estado de la máquina', ayuda: modoResumen ? 'Solo en el detallado.' : undefined },
  ];

  return (
    <View style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
      <TouchableOpacity onPress={() => setAbierto((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12, flex: 1 }}>
          🖨️ Qué sale en el reporte{encendidas > 0 ? ` · ${encendidas} cambio(s)` : ''}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{abierto ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {abierto ? (
        <View style={{ marginTop: spacing.xs }}>
          {filas.map((f) => (
            <Toggle key={f.k} on={op[f.k]} label={f.label} ayuda={f.ayuda} onPress={() => setOp(f.k, !op[f.k])} />
          ))}
          <Text style={{ color: colors.muted, fontSize: 10, marginTop: 4 }}>
            Solo cambian las COLUMNAS del PDF y de la vista previa. No sacan ni agregan viajes: el total es el mismo.
          </Text>
        </View>
      ) : null}
      {aviso ? (
        <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 11, marginTop: spacing.xs }}>{aviso}</Text>
      ) : null}
    </View>
  );
}
