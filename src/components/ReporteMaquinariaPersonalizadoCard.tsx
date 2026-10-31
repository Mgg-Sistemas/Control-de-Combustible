// 🛠️ REPORTE PERSONALIZADO DE MAQUINARIA — pestaña de Reportes (09-oct-2026).
//
// Pedido del cliente: «un reporte independiente, que reciba información pero no
// envíe; que yo le pueda cargar o quitar máquinas, colocar o quitar nombres de
// empresas, cambiar estados y la fecha en que lo saco… todo modificable, sin que
// me dañe nada en el sistema».
//
// Cómo cumple eso:
// - SOLO LEE. Al abrirse baja el catálogo (machinery), y las averías pendientes
//   para sugerir el estado real. No hay ni un insert/update/delete/rpc en este
//   archivo; un candado de la suite lo vigila.
// - Todo lo demás es estado LOCAL de la tarjeta: lo que se escribe, agrega,
//   quita o reordena vive aquí y muere al salir de la pantalla. El catálogo
//   original no se toca.
// - La fecha de emisión del papel es elegible (interruptor `emitida` de
//   pdfDocument); el título, el subtítulo, la nota, las columnas y los logos
//   también.
//
// ⛽🧭 Rango, combustible y Este/Oeste (30-oct-2026): con el rango de fechas, la
// tarjeta TRAE (solo lectura) los litros despachados a cada máquina — la misma
// `loadFuelByMachine` de Control de Maquinaria y Supervisión — y su Este/Oeste
// con la regla del reporte 📍 Ubicaciones. Las dos columnas nacen apagadas, se
// ponen y se quitan con sus pastillas, y lo corregido a mano no se pisa.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { DateField } from './DateField';
import { Toggle } from './CubicajeTab';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { selectAllRows } from '../lib/supabase';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { caracasToday } from '../lib/caracasDay';
import { norm } from '../lib/text';
import { loadFuelByMachine } from '../lib/fuelPerMachine';
import { cargarDatosUbicaciones } from '../lib/ubicacionesReporteDb';
import { armarUbicaciones, cardinalPorMaquina } from '../lib/ubicacionesReporte';
import {
  CSS_REPORTE_PERSONALIZADO, ESTADOS_PERSONALIZADO, FilaPersonalizada, OpcionesPersonalizado,
  OPCIONES_PERSONALIZADO_INICIAL, PASTILLAS_PERSONALIZADO,
  alternarPersonalizado, cuerpoReportePersonalizado, dmyPersonalizado, emitidaTexto, filaVacia,
  ocultosPersonalizadoEnPalabras, sufijoArchivoPersonalizado,
  empresasCatalogoPersonalizado, estadosCatalogoPersonalizado, filtrarCatalogoPersonalizado,
  aplicarDatosDelRango, cardinalTexto, litrosTexto, rangoOrdenado, totalLitrosPersonalizado, usaRangoPersonalizado,
} from '../lib/reporteMaquinariaPersonalizado';

const limpio = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const n2 = (v: unknown) => Number(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** «alto × largo × ancho m» de la ficha (las mismas columnas que Acarreo). */
const medidasFicha = (alto: unknown, largo: unknown, ancho: unknown) => {
  const v = [alto, largo, ancho].map(Number);
  return v.every((x) => Number.isFinite(x) && x > 0) ? `${n2(v[0])} × ${n2(v[1])} × ${n2(v[2])} m` : '';
};

type Logos = { bcv: boolean; sos: boolean; golden: boolean; renace: boolean; jhenzaen: boolean };
// Membrete de siempre de Reportes: BCV + SOS encendidos; los demás se piden.
const LOGOS_POR_DEFECTO: Logos = { bcv: true, sos: true, golden: false, renace: false, jhenzaen: false };
const LOGOS: { k: keyof Logos; label: string }[] = [
  { k: 'bcv', label: '🏦 Banco Central de Venezuela' },
  { k: 'sos', label: '🛟 SOS La Guaira' },
  { k: 'golden', label: '✨ Golden Touch' },
  { k: 'renace', label: '🇻🇪 Plan Venezuela Renace' },
  { k: 'jhenzaen', label: '🏗️ Jhenzaen 2.012 C.A' },
];

const MAX_PASTILLAS_CATALOGO = 40;

export function ReporteMaquinariaPersonalizadoCard() {
  const { colors } = useTheme();

  // ⚡ Carga perezosa: este componente solo se monta al elegir la pestaña
  //    «Personalizado», así que Reportes no pide nada de esto al arrancar.
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalogo, setCatalogo] = useState<FilaPersonalizada[]>([]);

  // Lo editable (TODO local; nada vuelve a la base):
  const [filas, setFilas] = useState<FilaPersonalizada[]>([]);
  const [titulo, setTitulo] = useState('Reporte de maquinaria');
  const [subtitulo, setSubtitulo] = useState('Reporte personalizado');
  const [nota, setNota] = useState('');
  const [fechaEmision, setFechaEmision] = useState(caracasToday());
  const [conRango, setConRango] = useState(false);
  const [desde, setDesde] = useState(caracasToday());
  const [hasta, setHasta] = useState(caracasToday());
  const [opciones, setOpciones] = useState<OpcionesPersonalizado>(OPCIONES_PERSONALIZADO_INICIAL);
  const [logos, setLogos] = useState<Logos>(LOGOS_POR_DEFECTO);
  const [marcaTexto, setMarcaTexto] = useState(true);
  const [busca, setBusca] = useState('');
  const [fuente, setFuente] = useState<'todos' | 'maq' | 'veh'>('todos');
  const [empresasSel, setEmpresasSel] = useState<string[]>([]);
  const [estadosSel, setEstadosSel] = useState<string[]>([]);
  const [empresaBusca, setEmpresaBusca] = useState('');
  const [mostrarTodasPastillas, setMostrarTodasPastillas] = useState(false);
  const [manuales, setManuales] = useState(0);
  const [confirmaVaciar, setConfirmaVaciar] = useState(false);
  const [descargando, setDescargando] = useState(false);

  // ⛽🧭 Lo que el sistema trae para el rango (null = no cargado / columna apagada).
  const [litrosRango, setLitrosRango] = useState<Record<string, number> | null>(null);
  const [cardinalRango, setCardinalRango] = useState<Record<string, string> | null>(null);
  const [cargandoLitros, setCargandoLitros] = useState(false);
  const [cargandoCardinal, setCargandoCardinal] = useState(false);
  const [errorRango, setErrorRango] = useState<string | null>(null);
  // Celdas corregidas a mano («id|campo»): recargar el rango no las pisa.
  const editados = useRef<Set<string>>(new Set());
  const pedidoLitros = useRef(0);
  const pedidoCardinal = useRef(0);

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    try {
      const [maqs, averias, vehs] = await Promise.all([
        selectAllRows(
          'machinery',
          'id, code, marca, modelo, clasificacion, serial, plate, zona, location, encargado, operational, en_espera, active, weight_ton, length_m, width_m, height_m, last_horometro, company:company_id(name)',
        ),
        // Las averías solo SUGIEREN el estado: si este rol no puede leerlas
        // (RLS de otro módulo), el papel sale igual, con «Operativa» de base.
        selectAllRows('maintenance_requests', 'machinery_id, material', (q: any) => q.eq('status', 'pendiente')).catch(() => [] as any[]),
        // 🚗 Vehículos (09-oct-2026, a pedido): entran al taller igual que las
        //    máquinas. Algunas columnas de su ficha llegaron por SQL opcional,
        //    así que si el select completo falla se cae a lo básico, y si ni
        //    eso se puede leer, el taller sigue solo con la maquinaria.
        selectAllRows('vehicles', 'id, plate, name, brand, model, vehicle_type, clasificacion, serial, encargado, en_espera, active, company:company_id(name)')
          .catch(() => selectAllRows('vehicles', 'id, plate, brand, model, vehicle_type, active').catch(() => [] as any[])),
      ]);
      // Avería pendiente → sugiere Parada (si fue «MÁQUINA PARADA») o Averiada.
      const averiaDe = new Map<string, string>();
      (averias as any[]).forEach((a) => {
        const prev = averiaDe.get(String(a.machinery_id));
        const esta = limpio(a.material) === 'MÁQUINA PARADA' ? 'Parada' : 'Averiada';
        if (prev !== 'Averiada') averiaDe.set(String(a.machinery_id), prev === 'Parada' && esta === 'Averiada' ? 'Averiada' : esta);
      });
      const filasMaq = (((maqs as any[]) ?? []).map((m) => ({
        id: String(m.id),
        code: limpio(m.code),
        marca: limpio(m.marca),
        modelo: limpio(m.modelo),
        clasificacion: limpio(m.clasificacion),
        serial: limpio(m.serial),
        plate: limpio(m.plate),
        empresa: limpio(m.company?.name),
        zona: limpio(m.location) || limpio(m.zona),
        encargado: limpio(m.encargado),
        // El mismo orden de prioridad del conteo de Equipos:
        estado: m.active === false ? 'Inactiva'
          : m.operational === false ? 'Retirada'
          : m.en_espera === true ? 'Esperando instrucciones'
          : averiaDe.get(String(m.id)) ?? 'Operativa',
        horometro: Number.isFinite(Number(m.last_horometro)) && Number(m.last_horometro) > 0 ? n2(m.last_horometro) : '',
        peso: Number.isFinite(Number(m.weight_ton)) && Number(m.weight_ton) > 0 ? `${n2(m.weight_ton)} t` : '',
        medidas: medidasFicha(m.height_m, m.length_m, m.width_m),
        nota: '',
        // Los pone el rango (al agregar la fila o al cambiar las fechas).
        litros: '',
        cardinal: '',
      })) as FilaPersonalizada[]).sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }));
      // El vehículo entra con el prefijo «veh-» en su clave local: así la
      // tarjeta sabe pintarle el 🚗 sin agregarle campos a la fila (que sigue
      // siendo puro texto editable, igual que la de una máquina).
      const filasVeh = ((((vehs as any[]) ?? []).map((v) => ({
        id: `veh-${String(v.id)}`,
        code: limpio(v.name) || limpio(v.plate),
        marca: limpio(v.brand),
        modelo: limpio(v.model),
        clasificacion: limpio(v.clasificacion) || limpio(v.vehicle_type),
        serial: limpio(v.serial),
        plate: limpio(v.plate),
        empresa: limpio(v.company?.name),
        zona: '',
        encargado: limpio(v.encargado),
        // Los vehículos no tienen «operational» ni averías de taller:
        estado: v.active === false ? 'Inactiva' : v.en_espera === true ? 'Esperando instrucciones' : 'Operativa',
        horometro: '',
        peso: '',
        medidas: '',
        nota: '',
        // Los despachos son de maquinaria: el vehículo no trae litros ni cardinal (se escriben a mano).
        litros: '',
        cardinal: '',
      })) as FilaPersonalizada[])).sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }));
      setCatalogo([...filasMaq, ...filasVeh]);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  // ⛽🧭 El rango manda: con alguna de las dos columnas encendida, las fechas salen
  //    en el subtítulo (unos litros sin su período no dicen nada).
  const rango = useMemo(() => rangoOrdenado(desde, hasta), [desde, hasta]);
  const usaRango = usaRangoPersonalizado(opciones);
  const rangoEnPapel = conRango || usaRango;

  // ⛽ Litros del rango: SOLO si la columna está encendida (si no, ni se pregunta).
  useEffect(() => {
    if (opciones.sinConsumo || !rango.desde) { setLitrosRango(null); return; }
    const n = ++pedidoLitros.current;
    setCargandoLitros(true); setErrorRango(null);
    loadFuelByMachine(rango.desde, rango.hasta)
      .then((agg) => {
        if (n !== pedidoLitros.current) return; // llegó tarde: ya se pidió otro rango
        const m: Record<string, number> = {};
        Object.entries(agg).forEach(([id, a]) => { m[id] = a.liters; });
        setLitrosRango(m);
      })
      .catch((e: any) => { if (n === pedidoLitros.current) { setLitrosRango(null); setErrorRango(`No se pudo leer el combustible: ${String(e?.message ?? e)}`); } })
      .finally(() => { if (n === pedidoLitros.current) setCargandoLitros(false); });
  }, [opciones.sinConsumo, rango.desde, rango.hasta]);

  // 🧭 Este/Oeste del rango: la regla del reporte 📍 Ubicaciones, sobre TODO el
  //    catálogo (así el resultado es el mismo que en ese papel).
  useEffect(() => {
    if (opciones.sinCardinal || !rango.desde) { setCardinalRango(null); return; }
    const n = ++pedidoCardinal.current;
    setCargandoCardinal(true); setErrorRango(null);
    cargarDatosUbicaciones(rango.desde, rango.hasta)
      .then((d) => {
        if (n !== pedidoCardinal.current) return;
        const filasUbic = armarUbicaciones({ ...d, desde: rango.desde, hasta: rango.hasta });
        const m: Record<string, string> = {};
        cardinalPorMaquina(d.maquinas, filasUbic).forEach((c, id) => { m[id] = cardinalTexto(c.cardinal, c.area); });
        setCardinalRango(m);
      })
      .catch((e: any) => { if (n === pedidoCardinal.current) { setCardinalRango(null); setErrorRango(`No se pudo leer la ubicación Este/Oeste: ${String(e?.message ?? e)}`); } })
      .finally(() => { if (n === pedidoCardinal.current) setCargandoCardinal(false); });
  }, [opciones.sinCardinal, rango.desde, rango.hasta]);

  // Lo que llega del rango se pone en las filas que ya están en el papel.
  const datosRango = useMemo(() => ({ litros: litrosRango, cardinal: cardinalRango }), [litrosRango, cardinalRango]);
  useEffect(() => {
    setFilas((prev) => {
      let cambio = false;
      const next = prev.map((f) => { const g = aplicarDatosDelRango(f, datosRango, editados.current); if (g !== f) cambio = true; return g; });
      return cambio ? next : prev;
    });
  }, [datosRango]);
  const totalLitros = useMemo(() => totalLitrosPersonalizado(filas), [filas]);

  const enPapel = useMemo(() => new Set(filas.map((f) => f.id)), [filas]);
  const esVehiculo = (id: string) => id.startsWith('veh-');

  const empresasDisponibles = useMemo(
    () => empresasCatalogoPersonalizado(catalogo, fuente),
    [catalogo, fuente],
  );
  const empresasVisibles = useMemo(() => {
    const qEmp = norm(empresaBusca);
    if (!qEmp) return empresasDisponibles;
    return empresasDisponibles.filter((e) => norm(e.nombre).includes(qEmp));
  }, [empresasDisponibles, empresaBusca]);

  const estadosDisponibles = useMemo(
    () => estadosCatalogoPersonalizado(catalogo, fuente, empresasSel),
    [catalogo, fuente, empresasSel],
  );

  const coincidentes = useMemo(
    () => filtrarCatalogoPersonalizado({ catalogo, fuente, empresasSel, estadosSel, busca }),
    [catalogo, fuente, empresasSel, estadosSel, busca],
  );

  const toggleEmpresaFiltro = (nombre: string) =>
    setEmpresasSel((prev) => (prev.includes(nombre) ? prev.filter((x) => x !== nombre) : [...prev, nombre]));

  const toggleEstadoFiltro = (nombre: string) =>
    setEstadosSel((prev) => (prev.includes(nombre) ? prev.filter((x) => x !== nombre) : [...prev, nombre]));

  // Quitar y reordenar: SIN tocar nada fuera de la tarjeta (es puro estado local).
  // Una fila que entra al papel llega con los datos del rango ya cargados.
  const conRangoAplicado = (m: FilaPersonalizada) => aplicarDatosDelRango({ ...m }, datosRango, editados.current);
  // Al sacar una fila se olvida lo que se le corrigió: si vuelve, vuelve limpia.
  //    (Se rehace el Set filtrado en vez de borrarle llaves: el candado de la suite
  //    no admite en esta tarjeta ni un método con nombre de escritura a la base.)
  const olvidarEditados = (ids: Iterable<string>) => {
    const fuera = new Set(ids);
    editados.current = new Set(Array.from(editados.current).filter((k) => !fuera.has(k.slice(0, k.lastIndexOf('|')))));
  };
  const agregar = (m: FilaPersonalizada) => setFilas((prev) => (prev.some((f) => f.id === m.id) ? prev : [...prev, conRangoAplicado(m)]));
  const agregarVarias = (lista: FilaPersonalizada[]) =>
    setFilas((prev) => {
      const ya = new Set(prev.map((f) => f.id));
      const nuevas = lista.filter((m) => !ya.has(m.id)).map(conRangoAplicado);
      return nuevas.length === 0 ? prev : [...prev, ...nuevas];
    });
  const quitar = (id: string) => { olvidarEditados([id]); setFilas((prev) => prev.filter((f) => f.id !== id)); };
  const quitarVarias = (lista: FilaPersonalizada[]) => {
    const idsQuitar = new Set(lista.map((m) => m.id));
    olvidarEditados(idsQuitar);
    setFilas((prev) => prev.filter((f) => !idsQuitar.has(f.id)));
  };
  const mover = (i: number, dir: -1 | 1) => setFilas((prev) => {
    const j = i + dir;
    if (j < 0 || j >= prev.length) return prev;
    const copia = [...prev];
    [copia[i], copia[j]] = [copia[j], copia[i]];
    return copia;
  });
  const editar = (id: string, campo: keyof FilaPersonalizada, valor: string) => {
    if (campo === 'litros' || campo === 'cardinal') editados.current.add(`${id}|${campo}`);
    setFilas((prev) => prev.map((f) => (f.id === id ? { ...f, [campo]: valor } : f)));
  };
  const agregarManual = () => { setManuales((n) => n + 1); setFilas((prev) => [...prev, filaVacia(`manual-${manuales + 1}`)]); };
  const vaciar = () => {
    if (!confirmaVaciar) { setConfirmaVaciar(true); setTimeout(() => setConfirmaVaciar(false), 3000); return; }
    setConfirmaVaciar(false); editados.current.clear(); setFilas([]);
  };

  const subtituloPapel = useMemo(() => {
    const partes = [rangoEnPapel ? `Del ${dmyPersonalizado(rango.desde)} al ${dmyPersonalizado(rango.hasta)}` : '', limpio(subtitulo)].filter(Boolean);
    return partes.join(' · ');
  }, [rangoEnPapel, rango.desde, rango.hasta, subtitulo]);

  const descargarPdf = async () => {
    setDescargando(true);
    try {
      const html = pdfDocument({
        title: limpio(titulo) || 'Reporte de maquinaria',
        subtitle: subtituloPapel,
        extraCss: CSS_REPORTE_PERSONALIZADO,
        logos,
        marcaTexto,
        // 📅 La fecha de emisión que eligió el usuario; si no sirve, la real.
        emitida: emitidaTexto(fechaEmision) || undefined,
        body: cuerpoReportePersonalizado({ filas, opciones, nota }),
      });
      await exportPdf(html, `Reporte personalizado ${sufijoArchivoPersonalizado(fechaEmision, opciones)}`.replace(/\//g, '-'));
    } finally {
      setDescargando(false);
    }
  };

  const pastilla = (key: string, label: string, on: boolean, onPress: () => void) => (
    <TouchableOpacity key={key} onPress={onPress}
      style={{ paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}>
      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{label}</Text>
    </TouchableOpacity>
  );
  const rotulo = (t: string) => <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.sm, marginBottom: 4 }}>{t}</Text>;
  const campo = (f: FilaPersonalizada, k: keyof FilaPersonalizada, label: string, flex = 1) => (
    <View key={String(k)} style={{ flexGrow: flex, flexBasis: '30%', minWidth: 110 }}>
      <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700' }}>{label}</Text>
      <TextInput
        value={f[k]}
        onChangeText={(v) => editar(f.id, k, v)}
        placeholder="—"
        placeholderTextColor={colors.muted}
        style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 5, color: colors.text, fontSize: 12, backgroundColor: colors.surface }}
      />
    </View>
  );

  return (
    <View>
      <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15 }}>🛠️ Reporte personalizado de maquinaria</Text>
      <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2, marginBottom: spacing.xs }}>
        {cargando ? 'Leyendo el catálogo…' : filas.length === 0 ? 'El papel está vacío: busca y agrega máquinas o vehículos abajo.' : `${filas.length} equipo(s) en el papel.`}
      </Text>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
        Taller de papel: el sistema te PRESTA los datos del catálogo (máquinas y vehículos) como punto de
        partida y de ahí todo es tuyo — agrega o quita equipos, corrige empresas, estados, fechas, lo que
        sea. Nada de lo que edites aquí se guarda ni toca el catálogo: al salir de la pantalla, el
        borrador se borra.
      </Text>
      {error ? <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>⚠️ {error}</Text> : null}

      {rotulo('📝 ENCABEZADO DEL PAPEL (todo editable)')}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        <View style={{ flexGrow: 1, flexBasis: '45%', minWidth: 160 }}>
          <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700' }}>Título</Text>
          <TextInput value={titulo} onChangeText={setTitulo} placeholder="Reporte de maquinaria" placeholderTextColor={colors.muted}
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 6, color: colors.text, fontSize: 13, backgroundColor: colors.surface }} />
        </View>
        <View style={{ flexGrow: 1, flexBasis: '45%', minWidth: 160 }}>
          <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700' }}>Subtítulo</Text>
          <TextInput value={subtitulo} onChangeText={setSubtitulo} placeholder="Reporte personalizado" placeholderTextColor={colors.muted}
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 6, color: colors.text, fontSize: 13, backgroundColor: colors.surface }} />
        </View>
      </View>
      <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700', marginTop: spacing.xs }}>Nota (sale debajo del resumen; vacía no sale)</Text>
      <TextInput value={nota} onChangeText={setNota} multiline placeholder="Ej.: Inventario levantado con el encargado de patio." placeholderTextColor={colors.muted}
        style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 6, color: colors.text, fontSize: 12, backgroundColor: colors.surface, minHeight: 40 }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs, alignItems: 'flex-end' }}>
        <View>
          <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700' }}>Fecha de emisión (la línea «Emitida» del papel)</Text>
          <DateField value={fechaEmision} onChange={setFechaEmision} />
        </View>
      </View>
      {rotulo('📅 RANGO DE FECHAS Y DATOS DEL RANGO')}
      {/* ⛽🧭 Atajos: las mismas llaves que las pastillas de «¿Qué se oculta?». */}
      <Toggle on={!opciones.sinConsumo} label="⛽ Traer el consumo de combustible del rango (litros por máquina)"
        onPress={() => setOpciones((o) => alternarPersonalizado(o, 'sinConsumo'))} />
      <Toggle on={!opciones.sinCardinal} label="🧭 Traer la ubicación Este / Oeste del rango"
        onPress={() => setOpciones((o) => alternarPersonalizado(o, 'sinCardinal'))} />
      {usaRango ? (
        <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
          El rango sale en el subtítulo del papel: los litros y la ubicación son de esas fechas.
        </Text>
      ) : (
        <Toggle on={conRango} label={conRango ? 'Con rango de fechas en el subtítulo' : 'Sin rango de fechas (solo el subtítulo)'} onPress={() => setConRango((v) => !v)} />
      )}
      {rangoEnPapel ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <View><Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700' }}>Desde</Text><DateField value={desde} onChange={setDesde} /></View>
          <View><Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700' }}>Hasta</Text><DateField value={hasta} onChange={setHasta} /></View>
        </View>
      ) : null}
      {usaRango ? (
        <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
          {cargandoLitros || cargandoCardinal
            ? 'Leyendo los datos del rango…'
            : [
                !opciones.sinConsumo && litrosRango ? `⛽ ${litrosTexto(totalLitros) || '0'} L en las ${filas.length} fila(s) del papel (despachos por fecha del surtido, ambos días incluidos).` : '',
                !opciones.sinCardinal && cardinalRango ? '🧭 Este / Oeste: la última ubicación de la máquina en el rango (la regla del reporte 📍 Ubicaciones); sin actividad en el rango, la de su ficha.' : '',
              ].filter(Boolean).join(' ')}
        </Text>
      ) : null}
      {errorRango ? <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>⚠️ {errorRango}</Text> : null}

      {rotulo('🚜 AGREGAR MÁQUINAS Y VEHÍCULOS DEL CATÁLOGO (toca para meter o sacar)')}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs }}>
        {pastilla('f-todos', 'Todos', fuente === 'todos', () => setFuente('todos'))}
        {pastilla('f-maq', '🚜 Máquinas', fuente === 'maq', () => setFuente('maq'))}
        {pastilla('f-veh', '🚗 Vehículos', fuente === 'veh', () => setFuente('veh'))}
      </View>

      {/* 🏢 Filtro por una o varias Empresas */}
      {empresasDisponibles.length > 0 ? (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.xs, backgroundColor: colors.surfaceAlt }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
            <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800' }}>
              🏢 Filtrar por empresa ({empresasSel.length === 0 ? `Todas · ${empresasDisponibles.length}` : `${empresasSel.length} seleccionada(s)`})
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {empresasSel.length < empresasDisponibles.length ? (
                <TouchableOpacity onPress={() => setEmpresasSel(empresasDisponibles.map((e) => e.nombre))}>
                  <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '800' }}>☑ Marcar todas</Text>
                </TouchableOpacity>
              ) : null}
              {empresasSel.length > 0 ? (
                <TouchableOpacity onPress={() => setEmpresasSel([])}>
                  <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '800' }}>✕ Limpiar empresas ({empresasSel.length})</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
          {empresasDisponibles.length > 6 ? (
            <TextInput
              value={empresaBusca}
              onChangeText={setEmpresaBusca}
              placeholder="🔎 Buscar empresa…"
              placeholderTextColor={colors.muted}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4, color: colors.text, fontSize: 12, backgroundColor: colors.surface, marginBottom: 6 }}
            />
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {pastilla('emp-todas', `🏢 Todas (${catalogo.filter((m) => fuente === 'todos' || (fuente === 'veh') === esVehiculo(m.id)).length})`, empresasSel.length === 0, () => setEmpresasSel([]))}
            {empresasVisibles.map((emp) => {
              const activa = empresasSel.includes(emp.nombre);
              return pastilla(
                `emp-${emp.nombre}`,
                `${activa ? '✓ ' : ''}${emp.nombre} · ${emp.count}`,
                activa,
                () => toggleEmpresaFiltro(emp.nombre),
              );
            })}
          </View>
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
            {empresasSel.length === 0
              ? 'Toca una o varias empresas para ver y seleccionar solo sus máquinas.'
              : `Mostrando máquinas de: ${empresasSel.join(' · ')}. Puedes seleccionarlas todas o escoger una por una abajo.`}
          </Text>
        </View>
      ) : null}

      {/* 🚦 Filtro por Estado Actual de las máquinas */}
      <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.xs, backgroundColor: colors.surfaceAlt }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800' }}>
            🚦 Filtrar por estado actual ({estadosSel.length === 0 ? 'Todos los estados' : `${estadosSel.length} estado(s)`})
          </Text>
          {estadosSel.length > 0 ? (
            <TouchableOpacity onPress={() => setEstadosSel([])}>
              <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '800' }}>✕ Limpiar estados ({estadosSel.length})</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {pastilla('est-todos', 'Todos los estados', estadosSel.length === 0, () => setEstadosSel([]))}
          {estadosDisponibles.map((est) => {
            const activo = estadosSel.includes(est.nombre);
            return pastilla(
              `est-${est.nombre}`,
              `${activo ? '✓ ' : ''}${est.nombre} · ${est.count}`,
              activo,
              () => toggleEstadoFiltro(est.nombre),
            );
          })}
        </View>
      </View>

      <TextInput value={busca} onChangeText={setBusca} placeholder="🔎 Buscar por código, placa, serial, marca o empresa…" placeholderTextColor={colors.muted}
        style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 6, color: colors.text, fontSize: 13, backgroundColor: colors.surface }} />

      {/* Botones rápidos para seleccionar o des-seleccionar en bloque las máquinas filtradas */}
      {(() => {
        const seleccionadasDeFiltro = coincidentes.filter((m) => enPapel.has(m.id)).length;
        const faltanPorSeleccionar = coincidentes.length - seleccionadasDeFiltro;
        return (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs, alignItems: 'center' }}>
            {pastilla(
              'todas',
              `➕ Seleccionar las ${coincidentes.length} filtradas${faltanPorSeleccionar > 0 && seleccionadasDeFiltro > 0 ? ` (+${faltanPorSeleccionar})` : ''}`,
              false,
              () => agregarVarias(coincidentes),
            )}
            {seleccionadasDeFiltro > 0
              ? pastilla(
                  'quitar-filtradas',
                  `➖ Des-seleccionar las ${seleccionadasDeFiltro} filtradas en el papel`,
                  false,
                  () => quitarVarias(coincidentes),
                )
              : null}
            {pastilla('manual', '➕ Agregar fila manual (en blanco)', false, agregarManual)}
            {filas.length > 0 ? pastilla('vaciar', confirmaVaciar ? '⚠️ ¿Seguro? Toca otra vez' : '🧹 Vaciar todo el papel', confirmaVaciar, vaciar) : null}
          </View>
        );
      })()}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
        {(mostrarTodasPastillas ? coincidentes : coincidentes.slice(0, MAX_PASTILLAS_CATALOGO)).map((m) => {
          const baseCode = m.code || m.plate || m.serial || '—';
          const placaTxt = m.plate && m.plate !== baseCode ? ` · Placa: ${m.plate}` : (!m.plate ? ' · S/P' : '');
          const empTxt = m.empresa ? ` · ${m.empresa}` : '';
          const estTxt = m.estado && m.estado !== 'Operativa' ? ` [${m.estado}]` : '';
          return pastilla(
            m.id,
            `${enPapel.has(m.id) ? '✓ ' : ''}${esVehiculo(m.id) ? '🚗 ' : ''}${baseCode}${placaTxt}${empTxt}${estTxt}`,
            enPapel.has(m.id),
            () => (enPapel.has(m.id) ? quitar(m.id) : agregar(m)),
          );
        })}
      </View>
      {coincidentes.length > MAX_PASTILLAS_CATALOGO ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4, flexWrap: 'wrap' }}>
          <Text style={{ color: colors.muted, fontSize: 11 }}>
            {mostrarTodasPastillas
              ? `Mostrando las ${coincidentes.length} máquinas filtradas.`
              : `Mostrando ${MAX_PASTILLAS_CATALOGO} de ${coincidentes.length} máquinas filtradas.`}
          </Text>
          <TouchableOpacity onPress={() => setMostrarTodasPastillas((v) => !v)}>
            <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '800' }}>
              {mostrarTodasPastillas ? '▲ Mostrar menos' : `▼ Ver las ${coincidentes.length} máquinas`}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {filas.length > 0 ? rotulo(`✏️ LAS ${filas.length} FILA(S) DEL PAPEL (toca cualquier celda y corrígela)`) : null}
      {filas.map((f, i) => (
        <View key={f.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.xs, backgroundColor: colors.surfaceAlt }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13 }}>
              {i + 1}. {esVehiculo(f.id) ? '🚗 ' : ''}{f.code || '(sin código)'} · Placa: {f.plate || 'S/P'}{f.empresa ? ` · ${f.empresa}` : ''}
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              {pastilla(`up${f.id}`, '↑', false, () => mover(i, -1))}
              {pastilla(`dn${f.id}`, '↓', false, () => mover(i, 1))}
              {pastilla(`rm${f.id}`, '✕ Quitar', false, () => quitar(f.id))}
            </View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
            {campo(f, 'code', 'Código')}
            {campo(f, 'marca', 'Marca')}
            {campo(f, 'modelo', 'Modelo')}
            {campo(f, 'clasificacion', 'Clasificación')}
            {campo(f, 'serial', 'Serial')}
            {campo(f, 'plate', 'Placa')}
            {campo(f, 'empresa', 'Empresa')}
            {campo(f, 'zona', 'Zona / ubicación')}
            {!opciones.sinCardinal ? campo(f, 'cardinal', '🧭 Este / Oeste') : null}
            {!opciones.sinConsumo ? campo(f, 'litros', '⛽ Combustible (L)') : null}
            {campo(f, 'encargado', 'Encargado')}
            {campo(f, 'horometro', 'Horómetro')}
            {campo(f, 'peso', 'Peso')}
            {campo(f, 'medidas', 'Medidas')}
            {campo(f, 'nota', 'Nota de la fila', 2)}
          </View>
          <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700', marginTop: spacing.xs }}>Estado (toca uno o escribe el tuyo)</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 2 }}>
            {ESTADOS_PERSONALIZADO.map((e) => pastilla(`${f.id}-${e}`, e, f.estado === e, () => editar(f.id, 'estado', e)))}
          </View>
          <TextInput value={f.estado} onChangeText={(v) => editar(f.id, 'estado', v)} placeholder="Estado libre…" placeholderTextColor={colors.muted}
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 5, color: colors.text, fontSize: 12, backgroundColor: colors.surface, marginTop: 4 }} />
        </View>
      ))}

      {rotulo('🖨️ ¿QUÉ SE OCULTA EN EL PAPEL?')}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {PASTILLAS_PERSONALIZADO.map((p) => pastilla('p' + p.key, p.chip, opciones[p.key], () => setOpciones((o) => alternarPersonalizado(o, p.key))))}
      </View>
      <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
        Encendida = NO sale (encargado, horómetro, peso, medidas, notas, consumo de combustible, Este / Oeste y el cuadro por empresa nacen ocultos: tócalos para INCLUIRLOS). {ocultosPersonalizadoEnPalabras(opciones)}
      </Text>

      {rotulo('🏷️ QUÉ LOGOS LLEVA EL MEMBRETE')}
      {LOGOS.map((l) => (
        <Toggle key={l.k} on={logos[l.k]} label={l.label} onPress={() => setLogos((p) => ({ ...p, [l.k]: !p[l.k] }))} />
      ))}
      <Toggle on={marcaTexto} label="Marca en texto «BCV / SOS La Guaira» (línea y pie)" onPress={() => setMarcaTexto((v) => !v)} />

      <TouchableOpacity
        disabled={descargando || cargando || cargandoLitros || cargandoCardinal || filas.length === 0}
        onPress={descargarPdf}
        style={{ marginTop: spacing.sm, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', backgroundColor: descargando || cargando || cargandoLitros || cargandoCardinal || filas.length === 0 ? colors.border : colors.brand }}>
        <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{descargando ? 'Armando el papel…' : cargandoLitros || cargandoCardinal ? 'Leyendo los datos del rango…' : '📄 Descargar el reporte (PDF)'}</Text>
      </TouchableOpacity>
    </View>
  );
}
