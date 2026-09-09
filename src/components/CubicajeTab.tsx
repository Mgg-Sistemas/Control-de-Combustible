// SUB-PESTAÑA «CUBICAJE Y REPORTE VOLUMÉTRICO» (09-sep-2026).
//
// Vive dentro del panel de la jefa de «Ruta de viajes de camiones». Mide la
// tolva de cada volqueta, guarda los m³ que cargó cada camión día por día, y
// deja buscar ese histórico por día, por mes o por camión.
//
// ⚠️ EL CATÁLOGO DE VEHÍCULOS SE LEE Y NADA MÁS. Acá no hay un solo insert,
//    update ni delete contra `machinery`. Lo que se escribe son DOS TABLAS
//    NUEVAS (`camion_cubicaje` y `camion_cubicaje_carga`), creadas por
//    `03_cubicaje_camiones.sql`, que está fuera del repositorio porque es
//    público.
//
// ⚠️ Y TIENE QUE FUNCIONAR ANTES DE QUE ESE SQL SE CORRA. Si las tablas no
//    existen, todo sigue como al principio: las medidas se guardan en este
//    dispositivo y la pantalla lo AVISA. Nunca se queda en blanco.
//
// Las volquetas medidas A MANO se quedan siempre en el dispositivo, incluso con
// el SQL corrido: la tabla se indexa por el camión del catálogo, y una unidad
// que no está en el catálogo no tiene con qué indexarse. Es la misma regla del
// camión «fuera de catálogo» del registro de viajes.
//
// La matemática vive en src/lib/cubicaje.ts y el PDF en
// src/lib/reporteVolumetrico.ts, los dos puros y con pruebas propias.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Card, SectionTitle, Loading } from './ui';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useToast } from './ToastProvider';
import { useConfirm } from './ConfirmProvider';
import { exportPdf } from '../lib/pdf';
import {
  Medida, ModoVolumen, MODOS, OpcionesReporte, OPCIONES_POR_DEFECTO, VolumenDetalle,
  volumenDe, kpis, clasificar, etiquetaClase, CLASES, esUnidadOculta, num, m3Texto, dimsTexto,
  filasParaGuardar, claveCarga, CargaMin, CargaHist, EjeHistorico, EJES_HISTORICO,
  agruparHistorico, totalCargas, segmentoDe, fechaCorta,
} from '../lib/cubicaje';
import {
  listarMedidas, guardarMedida, borrarMedida, listarCargas, guardarCargas, borrarCargas,
  AVISO_SIN_SQL, type CargaGuardada,
} from '../lib/cubicajeDatos';
import { reporteVolumetricoHtml, type UnidadReporte } from '../lib/reporteVolumetrico';
import { isVolteoVolqueta } from '../lib/equipos';
import { medidaConocida } from '../lib/medidasFlota';
import { RENACE_LOGO_DATA_URI } from '../lib/logoRenaceData';
import { GOLDEN_TOUCH_LOGO_DATA_URI } from '../lib/logoGoldenTouchData';

const CLAVE_MEDIDAS = 'cubicaje.medidas.v1';

export type CamionCubicaje = {
  id: string;
  code: string;
  plate: string | null;
  serial: string | null;
  marca: string | null;
  modelo: string | null;
  companyName: string;
  /** Operativa y sin estar en espera de instrucciones. Una unidad retirada o
   *  parada no describe la capacidad con la que se cuenta hoy. */
  activo: boolean;
};

export type RangoCubicaje = { desde: string; hasta: string; etiqueta: string };

export type CubicajeState = {
  medidas: Medida[];
  porTruck: Map<string, Medida>;
  cargando: boolean;
  /** Falta correr el SQL: se trabaja en modo dispositivo y se dice. */
  sinTabla: boolean;
  guardar: (m: Medida) => Promise<void>;
  borrar: (m: Medida) => Promise<void>;
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
  /** Lo ya guardado en la base para el rango que se está viendo. */
  cargas: CargaGuardada[];
  guardadas: Map<string, CargaMin>;
  recargarCargas: (desde: string, hasta: string) => Promise<void>;
  uid: string | null;
};

/**
 * Todo el estado del cubicaje, en un solo objeto.
 *
 * Va en un hook —y no dentro del componente— porque el REPORTE de la otra
 * sub-pestaña lo necesita igual. Con el estado adentro, cambiar de pestaña
 * desmontaría el componente y se perdería justo antes de exportar.
 */
export function useCubicaje(uid: string | null, flota: CamionCubicaje[] = []): CubicajeState {
  const [deLaBase, setDeLaBase] = useState<Medida[]>([]);
  const [locales, setLocales] = useState<Medida[]>([]);
  const [cargando, setCargando] = useState(true);
  const [sinTabla, setSinTabla] = useState(false);
  const [modo, setModo] = useState<ModoVolumen>('tolva');
  const [totalGlobal, setTotalGlobal] = useState('');
  const [manual, setManualMap] = useState<Record<string, string>>({});
  const [op, setOpMap] = useState<OpcionesReporte>(OPCIONES_POR_DEFECTO);
  const [mostrarOcultas, setMostrarOcultas] = useState(false);
  const [cargas, setCargas] = useState<CargaGuardada[]>([]);
  const [leidoLocal, setLeidoLocal] = useState(false);

  // Las medidas del DISPOSITIVO. Siempre se leen: guardan las unidades medidas
  // a mano (que no tienen ficha) y son el respaldo si falta correr el SQL.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(CLAVE_MEDIDAS);
        if (raw) {
          const v = JSON.parse(raw);
          if (Array.isArray(v)) setLocales(v.filter((x) => x && typeof x.id === 'string'));
        }
      } catch {}
      // La bandera se levanta pase lo que pase: si se quedara abajo tras un
      // error de lectura, el efecto de guardar no correría nunca y lo medido
      // después se perdería al recargar, en silencio.
      setLeidoLocal(true);
    })();
  }, []);

  useEffect(() => {
    if (!leidoLocal) return;
    AsyncStorage.setItem(CLAVE_MEDIDAS, JSON.stringify(locales)).catch(() => {});
  }, [locales, leidoLocal]);

  const recargarMedidas = useCallback(async () => {
    setCargando(true);
    const { rows, missing } = await listarMedidas();
    setSinTabla(missing);
    setDeLaBase(missing ? [] : rows.map((r) => ({
      id: r.machinery_id,
      truckId: r.machinery_id,
      ident: r.ident,
      marca: r.marca ?? '',
      modelo: r.modelo ?? '',
      alto: Number(r.alto), largo: Number(r.largo), ancho: Number(r.ancho),
    })));
    setCargando(false);
  }, []);

  useEffect(() => { recargarMedidas(); }, [recargarMedidas]);

  const recargarCargas = useCallback(async (desde: string, hasta: string) => {
    if (!desde || !hasta || desde > hasta) { setCargas([]); return; }
    const { rows } = await listarCargas({ desde, hasta });
    setCargas(rows);
  }, []);

  /**
   * ⚠️ Con el SQL corrido, una medida de un camión DEL CATÁLOGO va a la base y
   *    NO al dispositivo. Si fuera a los dos, al corregirla en otra computadora
   *    la copia vieja de este navegador seguiría apareciendo y ganándole.
   */
  const guardar = useCallback(async (m: Medida) => {
    if (m.truckId && !sinTabla) {
      const r = await guardarMedida({
        machinery_id: m.truckId, ident: m.ident, marca: m.marca, modelo: m.modelo,
        alto: m.alto, largo: m.largo, ancho: m.ancho,
      }, uid);
      if (r.missing) setSinTabla(true);
      if (!r.error) { await recargarMedidas(); return; }
      if (!r.missing) throw new Error(r.error);
    }
    setLocales((prev) => {
      const i = prev.findIndex((x) => x.id === m.id);
      if (i >= 0) { const n = prev.slice(); n[i] = m; return n; }
      return [...prev, m];
    });
  }, [sinTabla, uid, recargarMedidas]);

  const borrar = useCallback(async (m: Medida) => {
    if (m.truckId && !sinTabla) {
      const r = await borrarMedida(m.truckId);
      if (!r.error) { await recargarMedidas(); return; }
      if (!r.missing) throw new Error(r.error);
    }
    setLocales((prev) => prev.filter((x) => x.id !== m.id));
  }, [sinTabla, recargarMedidas]);

  const setManual = useCallback((k: string, v: string) => setManualMap((p) => ({ ...p, [k]: v })), []);
  const setOp = useCallback((k: keyof OpcionesReporte, v: boolean) => setOpMap((p) => ({ ...p, [k]: v })), []);

  /**
   * TRES FUENTES, EN ESTE ORDEN: la base, el dispositivo y la hoja.
   *
   * ⭐ La de la BASE gana siempre: es la compartida, y tener dos verdades del
   *    mismo camión es peor que no tener ninguna.
   *
   * ⭐ La HOJA (`medidasFlota`) es el último recurso, y entra el 09-sep-2026 a
   *    pedido del cliente: «los que ya cargaste, que se vean reflejados en el
   *    apartado nuevo». Son las once unidades de la hoja de cubicaje que entregó.
   *    Se reconocen por el TEXTO del equipo, así que se marcan como
   *    `deLaHoja: true` — en pantalla se ven distintas, y quien las confirme
   *    tocando «Guardar medida» las convierte en medidas de verdad.
   *
   * ⚠️ La misma precedencia que usa el conteo de Reportes. Si acá fuera otra,
   *    los dos papeles dirían cosas distintas del mismo camión.
   */
  const medidas = useMemo(() => {
    const ids = new Set(deLaBase.map((m) => m.truckId));
    const conLocal = [...deLaBase, ...locales.filter((m) => !m.truckId || !ids.has(m.truckId))];
    const yaTiene = new Set(conLocal.map((m) => m.truckId).filter(Boolean) as string[]);
    const deLaHoja: Medida[] = [];
    for (const t of flota) {
      if (yaTiene.has(t.id)) continue;
      const h = medidaConocida(t.code, t.marca, t.modelo);
      if (!h) continue;
      deLaHoja.push({
        id: t.id, truckId: t.id, ident: h.nombre,
        marca: t.marca ?? '', modelo: t.modelo ?? '',
        alto: h.alto, largo: h.largo, ancho: h.ancho, deLaHoja: true,
      });
    }
    return [...conLocal, ...deLaHoja];
  }, [deLaBase, locales, flota]);

  const porTruck = useMemo(() => {
    const m = new Map<string, Medida>();
    for (const x of medidas) if (x.truckId) m.set(x.truckId, x);
    return m;
  }, [medidas]);

  const guardadas = useMemo(() => {
    const m = new Map<string, CargaMin>();
    for (const c of cargas) m.set(claveCarga(c.machinery_id, String(c.jornada).slice(0, 10)), { m3: Number(c.m3), viajes: Number(c.viajes) });
    return m;
  }, [cargas]);

  return {
    medidas, porTruck, cargando, sinTabla, guardar, borrar,
    modo, setModo, totalGlobal, setTotalGlobal, manual, setManual, op, setOp,
    mostrarOcultas, setMostrarOcultas, cargas, guardadas, recargarCargas, uid,
  };
}

// ── Piezas de pantalla ──────────────────────────────────────────────────────

/** Interruptor de un toque. Sin `Switch` de react-native a propósito: en web se
 *  pinta distinto en cada navegador y esta pantalla se usa en los dos. */
export function Toggle({ on, label, onPress, ayuda }: { on: boolean; label: string; onPress: () => void; ayuda?: string }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 5 }}>
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
  cub, trucks, viajesPorCamion, viajesPorDia, rango, volumen,
}: {
  cub: CubicajeState;
  trucks: CamionCubicaje[];
  /** Viajes de cada camión en el rango filtrado arriba. */
  viajesPorCamion: Map<string, number>;
  /** Los mismos viajes, abiertos por jornada: camión → jornada → cuántos. */
  viajesPorDia: Map<string, Map<string, number>>;
  rango: RangoCubicaje;
  /** Lo que va a salir impreso, ya con lo guardado mandando sobre lo calculado. */
  volumen: Map<string, VolumenDetalle>;
}) {
  const { colors } = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const [sel, setSel] = useState<string>('');
  const [busca, setBusca] = useState('');
  const [ident, setIdent] = useState('');
  const [marca, setMarca] = useState('');
  const [modelo, setModelo] = useState('');
  const [alto, setAlto] = useState('');
  const [largo, setLargo] = useState('');
  const [ancho, setAncho] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [eje, setEje] = useState<EjeHistorico>('dia');
  const [buscaHist, setBuscaHist] = useState('');
  const [segmentado, setSegmentado] = useState(true);
  const [soloCamiones, setSoloCamiones] = useState(true);

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, fontSize: 13 } as const;

  // Cada vez que cambia el rango de arriba, se relee el histórico de ese rango.
  useEffect(() => { cub.recargarCargas(rango.desde, rango.hasta); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rango.desde, rango.hasta]);

  /**
   * QUÉ UNIDADES ENTRAN EN EL CUBICAJE.
   *
   * ⚠️ `trucks` es el CATÁLOGO ENTERO de maquinaria — excavadoras, grúas,
   *    cargadores —, no solo camiones. Se recibe así a propósito (ver la nota
   *    de `catalogoTrucks` en ViajesCamionesScreen: hay camiones reales cuyo
   *    código no dice "volteo" ni "volqueta", y sin el catálogo completo no hay
   *    forma de encontrarlos). Pero el cubicaje es de TOLVAS: ofrecer una
   *    excavadora para medirle el alto, largo y ancho no significa nada, y el
   *    reporte que se entrega es de camiones.
   *
   *    Por eso se filtra por defecto, con la MISMA regla que arma la lista del
   *    listero (`isVolteoVolqueta`, por el texto del código), y se deja el
   *    interruptor para apagarlo: sin él, un camión mal codificado no se podría
   *    medir nunca.
   */
  const visibles = useMemo(
    () => trucks.filter((t) =>
      (cub.mostrarOcultas || !esUnidadOculta(t.code, t.marca, t.modelo, t.plate, t.companyName))
      && (!soloCamiones || isVolteoVolqueta(t.code || ''))),
    [trucks, cub.mostrarOcultas, soloCamiones]
  );
  const ocultas = trucks.filter((t) => esUnidadOculta(t.code, t.marca, t.modelo, t.plate, t.companyName)).length;
  const noCamiones = trucks.filter((t) => !isVolteoVolqueta(t.code || '')).length;
  const nombreOculta = useMemo(
    () => trucks.filter((t) => esUnidadOculta(t.code, t.marca, t.modelo, t.plate, t.companyName)).map((t) => t.code),
    [trucks]
  );

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
    // ⚠️ Una medida DE LA HOJA no es una fila guardada: no hay nada que
    //    «actualizar». Se precarga para poder confirmarla o corregirla, pero al
    //    guardar se crea la fila de verdad.
    setEditId(ya && !ya.deLaHoja ? ya.id : null);
    // Identificador, marca y modelo salen del catálogo: se leen, no se escriben.
    setIdent(ya?.ident || `${t.code}${t.plate ? ` · ${t.plate}` : ''}`);
    setMarca(ya?.marca || t.marca || '');
    setModelo(ya?.modelo || t.modelo || '');
    setAlto(ya ? String(ya.alto) : '');
    setLargo(ya ? String(ya.largo) : '');
    setAncho(ya ? String(ya.ancho) : '');
  };

  /**
   * EDITAR UNA MEDIDA DESDE LA LISTA (09-sep-2026).
   *
   * ⚠️ La lista «Unidades medidas» solo tenía papelera: para corregir un
   *    número había que volver al buscador de arriba y encontrar el camión otra
   *    vez, y con treinta camiones que se llaman igual eso es rendirse. Se veía
   *    como que el apartado «no deja editar», que es exactamente lo que reportó
   *    el cliente.
   *
   * Precarga el formulario de arriba con lo que ya tiene. Guardar sobrescribe.
   */
  const editar = (m: Medida) => {
    setSel(m.truckId ?? MANUAL);
    // Una medida DE LA HOJA no es una fila guardada: no hay nada que actualizar.
    // Se precarga para confirmarla o corregirla, y al guardar se crea la fila.
    setEditId(m.deLaHoja ? null : m.id);
    setIdent(m.ident);
    setMarca(m.marca);
    setModelo(m.modelo);
    setAlto(String(m.alto));
    setLargo(String(m.largo));
    setAncho(String(m.ancho));
  };

  const limpiar = () => {
    setSel(''); setEditId(null);
    setIdent(''); setMarca(''); setModelo(''); setAlto(''); setLargo(''); setAncho('');
  };

  const m3Vivo = volumenDe({ alto: num(alto), largo: num(largo), ancho: num(ancho) });
  const puedeGuardar = !!sel && m3Vivo > 0 && (sel !== MANUAL || ident.trim().length > 0) && !ocupado;

  const guardar = async () => {
    if (!puedeGuardar) return;
    setOcupado(true);
    try {
      await cub.guardar({
        id: editId ?? (sel === MANUAL ? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : sel),
        truckId: sel === MANUAL ? null : sel,
        ident: ident.trim() || 'Sin identificar',
        marca: marca.trim(),
        modelo: modelo.trim(),
        alto: num(alto), largo: num(largo), ancho: num(ancho),
      });
      toast.success(cub.sinTabla ? 'Medida guardada en este dispositivo.' : 'Medida guardada.');
      limpiar();
    } catch (e: any) {
      toast.error(`No se pudo guardar: ${String(e?.message ?? e)}`);
    } finally {
      setOcupado(false);
    }
  };

  const idsVisibles = useMemo(() => new Set(visibles.map((t) => t.id)), [visibles]);
  const medidasVistas = useMemo(
    () => cub.medidas.filter((m) => !m.truckId || idsVisibles.has(m.truckId)),
    [cub.medidas, idsVisibles]
  );
  const k = useMemo(() => kpis(medidasVistas.map(volumenDe)), [medidasVistas]);

  /**
   * A quién se le puede escribir un total a mano: a TODO camión con viajes en
   * el rango, medido o no. Si la lista saliera solo de lo medido, para anotarle
   * 40 m³ a un camión habría que inventarle antes unas medidas de tolva que
   * nadie tomó, y esas medidas falsas se quedarían en los indicadores.
   */
  const asignables = useMemo(() => visibles
    .filter((t) => (viajesPorCamion.get(t.id) ?? 0) > 0)
    .map((t) => ({
      id: t.id,
      nombre: cub.porTruck.get(t.id)?.ident || `${t.code}${t.plate ? ` · ${t.plate}` : ''}`,
      viajes: viajesPorCamion.get(t.id) ?? 0,
      medido: cub.porTruck.has(t.id),
    }))
    .sort((a, b) => b.viajes - a.viajes),
    [visibles, viajesPorCamion, cub.porTruck]);

  const totalViajes = asignables.reduce((a, b) => a + b.viajes, 0);

  // ── GUARDAR EL CÁLCULO DEL RANGO ─────────────────────────────────────────
  const porViaje = useMemo(() => {
    const m = new Map<string, number>();
    volumen.forEach((v, id) => m.set(id, v.porViaje));
    return m;
  }, [volumen]);

  const paraGuardar = useMemo(() => filasParaGuardar(porViaje, viajesPorDia), [porViaje, viajesPorDia]);
  const conVolumen = paraGuardar.filter((f) => f.m3 > 0).length;

  const nombreDe = (id: string) => {
    const t = trucks.find((x) => x.id === id);
    return cub.porTruck.get(id)?.ident || (t ? `${t.code}${t.plate ? ` · ${t.plate}` : ''}` : id);
  };

  const guardarRango = async () => {
    if (cub.sinTabla) { toast.error(AVISO_SIN_SQL); return; }
    if (!conVolumen) { toast.error('No hay ningún volumen que guardar en este rango. Mide las tolvas o escribe los totales.'); return; }
    const ok = await confirm({
      title: 'Guardar el cubicaje del rango',
      message: `Se guardan ${conVolumen} día(s) de camión con su volumen, en ${rango.etiqueta}. `
        + 'Si ya había algo guardado para esos mismos días, SE REEMPLAZA. Lo guardado es lo que sale en los reportes de aquí en adelante.',
      confirmText: 'Guardar',
    });
    if (!ok) return;
    setOcupado(true);
    const r = await guardarCargas(paraGuardar.filter((f) => f.m3 > 0).map((f) => ({
      machinery_id: f.machinery_id,
      machine_code: nombreDe(f.machinery_id),
      jornada: f.jornada,
      m3: f.m3,
      viajes: f.viajes,
      modo: cub.modo,
    })), cub.uid);
    setOcupado(false);
    if (r.error) { toast.error(`Se guardaron ${r.guardadas} y falló el resto: ${r.error}`); }
    else toast.success(`Guardado: ${r.guardadas} día(s) de camión.`);
    await cub.recargarCargas(rango.desde, rango.hasta);
  };

  // ── EL HISTÓRICO ─────────────────────────────────────────────────────────
  const histFilas = useMemo<CargaHist[]>(() => {
    const q = buscaHist.trim().toLowerCase();
    return cub.cargas
      .map((c) => ({
        machinery_id: c.machinery_id,
        machine_code: c.machine_code,
        jornada: String(c.jornada).slice(0, 10),
        m3: Number(c.m3) || 0,
        viajes: Number(c.viajes) || 0,
      }))
      .filter((c) => !q || c.machine_code.toLowerCase().includes(q));
  }, [cub.cargas, buscaHist]);

  const grupos = useMemo(() => agruparHistorico(histFilas, eje), [histFilas, eje]);
  const totalHist = useMemo(() => totalCargas(histFilas), [histFilas]);

  /**
   * Borrar la MEDIDA de una tolva.
   *
   * ⚠️ Pide confirmación, y no es trámite: desde que la medida vive en la base
   *    la ve toda la empresa, así que un toque en la papelera se la quitaba a
   *    todo el mundo sin preguntar. Además se avisa de la consecuencia real:
   *    los días YA GUARDADOS no cambian (lo guardado manda), pero el cálculo
   *    al vuelo de ese camión se va a cero hasta que se vuelva a medir.
   */
  const borrarMedidaDe = async (m: Medida) => {
    const guardadosDeEse = m.truckId
      ? cub.cargas.filter((c) => c.machinery_id === m.truckId).length
      : 0;
    const ok = await confirm({
      title: 'Borrar la medida de la tolva',
      message: `${m.ident}. ${m.truckId && !cub.sinTabla
        ? 'La medida es compartida: se le quita a todo el mundo. '
        : 'Está guardada solo en este dispositivo. '}`
        + (guardadosDeEse > 0
          ? `Los ${guardadosDeEse} día(s) que ya tiene GUARDADOS en el histórico NO cambian. `
          : '')
        + 'Lo que sí cambia es el cálculo automático por tolva: ese camión queda en 0 m³ hasta que se vuelva a medir.',
      confirmText: 'Borrar la medida',
      danger: true,
    });
    if (!ok) return;
    try {
      await cub.borrar(m);
      toast.success('Medida borrada.');
    } catch (e: any) {
      toast.error(String(e?.message ?? e));
    }
  };

  const borrarDia = async (machinery_id: string, jornada: string) => {
    const fila = cub.cargas.find((c) => c.machinery_id === machinery_id && String(c.jornada).slice(0, 10) === jornada);
    if (!fila) return;
    const ok = await confirm({
      title: 'Borrar el volumen de ese día',
      message: `${nombreDe(machinery_id)} · ${fechaCorta(jornada)}. Vuelve a calcularse solo, con el modo que tengas puesto.`,
      confirmText: 'Borrar',
      danger: true,
    });
    if (!ok) return;
    const r = await borrarCargas([fila.id]);
    if (r.error) { toast.error(r.error); return; }
    toast.success('Borrado.');
    await cub.recargarCargas(rango.desde, rango.hasta);
  };

  // ── EL REPORTE VOLUMÉTRICO ───────────────────────────────────────────────
  const exportarReporte = async () => {
    if (!medidasVistas.length) { toast.error('No hay ninguna unidad medida. Mide al menos una tolva.'); return; }
    setOcupado(true);
    try {
      /**
       * ⚠️ SOLO LAS ACTIVAS (pedido del cliente, 09-sep-2026).
       *
       * Una unidad retirada o en espera de instrucciones no describe la
       * capacidad con la que se cuenta HOY: inflaba el total y el promedio de
       * un documento que se entrega para planificar acarreo.
       *
       * Las medidas a mano (sin ficha en el catálogo) entran igual: no tienen
       * estado que consultar, y quien las midió fue justamente para contarlas.
       */
      const activoPorId = new Map(trucks.map((t) => [t.id, t.activo]));
      const unidades: UnidadReporte[] = medidasVistas
        .filter((m) => !m.truckId || activoPorId.get(m.truckId) !== false)
        .map((m) => ({
          ident: m.ident,
          marca: m.marca, modelo: m.modelo,
          alto: m.alto, largo: m.largo, ancho: m.ancho,
          m3: volumenDe(m),
          segmento: segmentoDe(m.ident, m.marca, m.modelo),
        }))
        .filter((u) => u.m3 > 0);
      const fuera = medidasVistas.filter((m) => m.truckId && activoPorId.get(m.truckId) === false).length;
      const html = reporteVolumetricoHtml({
        fechaEmision: new Date().toLocaleDateString('es-VE'),
        configuracion: `Solo unidades activas${segmentado ? ' · Segmentada por Tipo de Equipo' : ''}`
          + `${ocultas > 0 && !cub.mostrarOcultas ? ' · Sin Carbozulia' : ''}`
          + `${fuera > 0 ? ` · ${fuera} inactiva(s) fuera` : ''}`,
        unidades,
        segmentado,
        excluidas: cub.mostrarOcultas ? [] : nombreOculta,
        cargas: histFilas.length ? { eje, grupos, total: totalHist, rango: rango.etiqueta } : null,
        logos: { renace: RENACE_LOGO_DATA_URI, goldenTouch: GOLDEN_TOUCH_LOGO_DATA_URI },
      });
      await exportPdf(html, `Analisis volumetrico de flota ${rango.desde}`);
    } catch (e: any) {
      toast.error(`No se pudo generar el reporte: ${String(e?.message ?? e)}`);
    } finally {
      setOcupado(false);
    }
  };

  if (cub.cargando) return <Card><Loading /></Card>;

  return (
    <>
      {cub.sinTabla ? (
        <Card>
          <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 12 }}>⏳ Falta correr el SQL</Text>
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>{AVISO_SIN_SQL}</Text>
        </Card>
      ) : null}

      <Card>
        <SectionTitle>📐 Medir una volqueta</SectionTitle>
        <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.sm }}>
          {cub.sinTabla
            ? 'Por ahora las medidas se guardan en este dispositivo y no las ve otra persona.'
            : 'Las medidas quedan guardadas para todos. Este apartado lee el catálogo de vehículos y nunca lo modifica.'}
        </Text>

        <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>¿QUÉ UNIDAD?</Text>
        <Toggle
          on={soloCamiones}
          onPress={() => setSoloCamiones(!soloCamiones)}
          label={soloCamiones ? `Solo camiones · ${noCamiones} equipo(s) fuera` : 'Mostrando TODO el catálogo de maquinaria'}
          ayuda={soloCamiones
            ? 'Volteos, volquetas y Toronto. El cubicaje es de tolvas: a una excavadora no se le mide una.'
            : 'Apágalo solo para encontrar un camión cuyo código no diga volteo ni volqueta.'}
        />
        <TextInput value={busca} onChangeText={setBusca} placeholder="Buscar por código, placa, marca…" placeholderTextColor={colors.muted} style={[input, { marginTop: 4 }]} />
        <TouchableOpacity
          onPress={() => elegir(null)}
          style={{ marginTop: spacing.xs, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: sel === MANUAL ? colors.brand : colors.border, backgroundColor: sel === MANUAL ? colors.brand : colors.surface, padding: spacing.sm }}
        >
          <Text style={{ color: sel === MANUAL ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 12 }}>➕ Medir nueva volqueta (manual)</Text>
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
          {opciones.length === 0 ? <Text style={{ color: colors.muted, fontSize: 12, padding: spacing.sm }}>Ningún camión con esa búsqueda.</Text> : null}
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
            {editId || (sel !== MANUAL && cub.porTruck.has(sel)) ? (
              <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '800', marginBottom: spacing.xs }}>
                ✏️ Corrigiendo: {ident || 'esta unidad'}
              </Text>
            ) : null}
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>IDENTIFICADOR {sel === MANUAL ? '*' : ''}</Text>
            <TextInput value={ident} onChangeText={setIdent} placeholder="Volteo Toronto Iveco Trakker" placeholderTextColor={colors.muted} style={[input, { marginTop: 4 }]} />

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>MARCA</Text>
                <TextInput value={marca} onChangeText={setMarca} placeholder="Iveco" placeholderTextColor={colors.muted} style={[input, { marginTop: 4 }]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>MODELO</Text>
                <TextInput value={modelo} onChangeText={setModelo} placeholder="Trakker" placeholderTextColor={colors.muted} style={[input, { marginTop: 4 }]} />
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
              {([['Alto (m)', alto, setAlto], ['Largo (m)', largo, setLargo], ['Ancho (m)', ancho, setAncho]] as const).map(([lab, val, set]) => (
                <View key={lab} style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>{lab}</Text>
                  <TextInput value={val} onChangeText={set as (v: string) => void} keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor={colors.muted} style={[input, { marginTop: 4, textAlign: 'center' }]} />
                </View>
              ))}
            </View>

            {/* El resultado se calcula mientras se escribe: si sale un número
                que no tiene sentido, se ve ANTES de guardarlo. */}
            <View style={{ marginTop: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: m3Vivo > 0 ? colors.brand : colors.border, padding: spacing.sm, alignItems: 'center' }}>
              <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 22 }}>{m3Vivo > 0 ? m3Vivo.toFixed(2) : '—'} m³</Text>
              <Text style={{ color: colors.muted, fontSize: 11 }}>{m3Vivo > 0 ? etiquetaClase(m3Vivo) : 'Escribe alto, largo y ancho'}</Text>
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <TouchableOpacity onPress={limpiar} style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={guardar} disabled={!puedeGuardar} style={{ flex: 2, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.brand, opacity: puedeGuardar ? 1 : 0.5 }}>
                <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 13 }}>
                  {sel !== MANUAL && cub.porTruck.get(sel)?.deLaHoja ? '✅ Confirmar esta medida' : editId ? '💾 Actualizar medida' : '💾 Guardar medida'}
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
                <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: sel && sel === (m.truckId ?? MANUAL) ? colors.surface : 'transparent' }}>
                  {/* Toda la fila abre el formulario de arriba con esta medida
                      cargada. Antes solo estaba la papelera y no había forma de
                      corregir un número sin volver a buscar el camión. */}
                  <TouchableOpacity onPress={() => editar(m)} style={{ flex: 1 }} activeOpacity={0.7}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }} numberOfLines={1}>
                      {m.truckId ? '🚛' : '✍️'} {m.ident}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 10 }} numberOfLines={1}>
                      {[m.marca, m.modelo].filter(Boolean).join(' ') || 'Sin marca ni modelo'} · {dimsTexto(m)} m · {etiquetaClase(v)}
                      {m.deLaHoja ? ' · ⚠️ de la hoja, sin confirmar' : ''}
                      {m.truckId ? ` · ${viajes} viaje(s) en el rango` : ' · medida a mano, solo en este dispositivo'}
                    </Text>
                    <Text style={{ color: colors.brandText, fontSize: 10, fontWeight: '700' }}>✏️ Toca para corregirla</Text>
                  </TouchableOpacity>
                  <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 13 }}>{m3Texto(v)}</Text>
                  <TouchableOpacity onPress={() => editar(m)} style={{ padding: 4 }}>
                    <Text style={{ fontSize: 14 }}>✏️</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => borrarMedidaDe(m)} style={{ padding: 4 }}>
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
          Se aplica al <Text style={{ fontWeight: '800' }}>mismo rango</Text> que tengas en «Lista completa de viajes»
          ({rango.etiqueta}). Ahí hay {totalViajes} viaje(s) de unidades del catálogo.
        </Text>
        {MODOS.map((m) => {
          const on = cub.modo === m.key;
          return (
            <TouchableOpacity key={m.key} onPress={() => cub.setModo(m.key)} style={{ borderRadius: radius.md, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.surface : 'transparent', padding: spacing.sm, marginBottom: spacing.xs }}>
              <Text style={{ color: on ? colors.brandText : colors.text, fontWeight: '800', fontSize: 12 }}>{m.label}</Text>
              <Text style={{ color: colors.muted, fontSize: 10, marginTop: 2 }}>{m.ayuda}</Text>
            </TouchableOpacity>
          );
        })}

        {cub.modo === 'proporcional' ? (
          <View style={{ marginTop: spacing.xs }}>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>TOTAL DE m³ DEL RANGO</Text>
            <TextInput value={cub.totalGlobal} onChangeText={cub.setTotalGlobal} keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor={colors.muted} style={[input, { marginTop: 4 }]} />
            <Text style={{ color: colors.muted, fontSize: 10, marginTop: 4 }}>
              Se reparte entre los camiones según cuántos viajes hizo cada uno. Sin viajes en el rango, todos quedan en cero.
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
                    <Text style={{ color: colors.muted, fontSize: 10 }}>{a.viajes} viaje(s){a.medido ? '' : ' · sin medir'}</Text>
                  </View>
                  <TextInput value={cub.manual[a.id] ?? ''} onChangeText={(v) => cub.setManual(a.id, v)} keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor={colors.muted} style={[input, { width: 92, paddingVertical: 6, textAlign: 'center' }]} />
                </View>
              ))}
              {asignables.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 12 }}>Ningún camión tiene viajes en el rango que hay puesto arriba.</Text>
              ) : null}
            </ScrollView>
          </View>
        ) : null}

        {/* ⭐ GUARDAR ES LO QUE HACE QUE SE PUEDA BUSCAR DESPUÉS. Sin esto, el
            número se recalcula cada vez y no hay histórico que consultar. */}
        <TouchableOpacity
          onPress={guardarRango}
          disabled={ocupado || cub.sinTabla}
          style={{ marginTop: spacing.sm, alignItems: 'center', paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.brand, opacity: ocupado || cub.sinTabla ? 0.5 : 1 }}
        >
          <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 13 }}>
            💾 Guardar el cubicaje de este rango ({conVolumen} día(s) de camión)
          </Text>
        </TouchableOpacity>
        <Text style={{ color: colors.muted, fontSize: 10, marginTop: 4 }}>
          Guardar CONGELA estos números por día. Lo guardado manda sobre el cálculo en todos los reportes, para que un
          mes viejo salga siempre igual aunque después se cambie el modo o se corrija una medida.
        </Text>
      </Card>

      <Card>
        <SectionTitle>🔎 Buscar en el histórico</SectionTitle>
        <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs }}>
          Sale de lo guardado, en {rango.etiqueta}. Para cambiar el período usa los botones de fecha de «Lista completa
          de viajes» (Hoy · Esta semana · Este mes · Rango libre · Días específicos).
        </Text>

        <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.xs }}>
          {EJES_HISTORICO.map((e) => {
            const on = eje === e.key;
            return (
              <TouchableOpacity key={e.key} onPress={() => setEje(e.key)} style={{ flex: 1, alignItems: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface, paddingVertical: 6 }}>
                <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 11 }}>{e.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TextInput value={buscaHist} onChangeText={setBuscaHist} placeholder="Filtrar por camión…" placeholderTextColor={colors.muted} style={input} />

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
          <Kpi ico="📦" titulo="VOLUMEN" valor={totalHist.m3 > 0 ? totalHist.m3.toFixed(2) : '—'} />
          <View style={{ flex: 1, minWidth: 96, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surface }}>
            <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '800' }}>🔢 VIAJES</Text>
            <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 18 }}>{totalHist.viajes}</Text>
            <Text style={{ color: colors.muted, fontSize: 10 }}>{totalHist.dias} día(s) · {totalHist.camiones} camión(es)</Text>
          </View>
        </View>

        {grupos.length === 0 ? (
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>
            {cub.sinTabla
              ? 'Todavía no hay histórico: falta correr el SQL.'
              : buscaHist.trim()
                ? 'Ningún camión guardado coincide con esa búsqueda en este período.'
                : 'No hay nada guardado en este período. Calcula arriba y toca «Guardar el cubicaje de este rango».'}
          </Text>
        ) : (
          <ScrollView style={{ maxHeight: 320, marginTop: spacing.sm }} nestedScrollEnabled>
            {grupos.map((g) => (
              <View key={g.key} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }} numberOfLines={1}>
                    {eje === 'dia' ? fechaCorta(g.label) : g.label}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 10 }}>
                    {g.viajes} viaje(s) · {eje === 'camion' ? `${g.n} día(s)` : `${g.n} camión(es)`}
                  </Text>
                </View>
                <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 13 }}>{m3Texto(g.m3)} m³</Text>
              </View>
            ))}
          </ScrollView>
        )}

        {eje === 'dia' && histFilas.length > 0 ? (
          <ScrollView style={{ maxHeight: 220, marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs }} nestedScrollEnabled>
            <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '800', marginBottom: 4 }}>DETALLE, CAMIÓN POR CAMIÓN</Text>
            {histFilas.map((c) => (
              <View key={`${c.machinery_id}-${c.jornada}`} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 5 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: 11 }} numberOfLines={1}>{c.machine_code}</Text>
                  <Text style={{ color: colors.muted, fontSize: 10 }}>{fechaCorta(c.jornada)} · {c.viajes} viaje(s)</Text>
                </View>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>{m3Texto(c.m3)}</Text>
                <TouchableOpacity onPress={() => borrarDia(c.machinery_id, c.jornada)} style={{ padding: 4 }}>
                  <Text style={{ fontSize: 13 }}>🗑️</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        ) : null}
      </Card>

      <Card>
        <SectionTitle>📄 Reporte volumétrico de flota</SectionTitle>
        <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs }}>
          El documento de análisis técnico: tarjetas de mayor, menor y promedio, las tablas con su clasificación por
          color, el análisis logístico y las recomendaciones. Si hay histórico guardado en el período, va incluido.
          Sale con el membrete del <Text style={{ fontWeight: '800' }}>Plan Venezuela Renace</Text> y el logo de Golden Touch.
          {'\n'}⚠️ Solo entran las unidades <Text style={{ fontWeight: '800' }}>activas</Text>: una retirada o en espera no
          describe la capacidad con la que se cuenta hoy.
        </Text>
        <Toggle
          on={segmentado}
          onPress={() => setSegmentado(!segmentado)}
          label={segmentado ? 'Segmentado: volteos y volquetas aparte' : 'Una sola tabla con toda la flota'}
          ayuda="Un volteo rígido anda por 14-17 m³ y un chuto pasa de 21: mezclarlos hace que el promedio no describa a ninguno de los dos."
        />
        <TouchableOpacity
          onPress={exportarReporte}
          disabled={ocupado}
          style={{ marginTop: spacing.sm, alignItems: 'center', paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.brand, opacity: ocupado ? 0.6 : 1 }}
        >
          <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 13 }}>
            {ocupado ? 'Generando…' : '📄 Generar reporte volumétrico'}
          </Text>
        </TouchableOpacity>
      </Card>
    </>
  );
}

/** El panel de interruptores del reporte de VIAJES. Vive junto al botón de
 *  exportar de la otra sub-pestaña porque es ahí donde se usa: configurar en un
 *  sitio y exportar en otro es como se quedan encendidos los filtros. */
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
  const cambiadas = (Object.keys(OPCIONES_POR_DEFECTO) as (keyof OpcionesReporte)[])
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
          🖨️ Qué sale en el reporte{cambiadas > 0 ? ` · ${cambiadas} cambio(s)` : ''}
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
      {aviso ? <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 11, marginTop: spacing.xs }}>{aviso}</Text> : null}
    </View>
  );
}
