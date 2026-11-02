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
import { Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { DateField } from './DateField';
import { Toggle } from './CubicajeTab';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { spacing, radius } from '../theme';
import { selectAllRows } from '../lib/supabase';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { caracasToday } from '../lib/caracasDay';
import { norm } from '../lib/text';
import { loadFuelByMachine } from '../lib/fuelPerMachine';
import { cargarDatosUbicaciones } from '../lib/ubicacionesReporteDb';
import { armarUbicaciones, cardinalPorMaquina } from '../lib/ubicacionesReporte';
import {
  ESTADO_CONTEO_INFO, estadoConteoDe, fetchAveriaCat, fetchInspByShift, fetchJornadaCat, makeLiveStatusOf, type AveriaEntry,
} from '../lib/machineLiveStatus';
import {
  CSS_REPORTE_PERSONALIZADO, ESTADOS_PERSONALIZADO, FilaPersonalizada, OpcionesPersonalizado,
  OPCIONES_PERSONALIZADO_INICIAL, PASTILLAS_PERSONALIZADO, RegistroHistorialPersonalizado,
  alternarPersonalizado, cuerpoReportePersonalizado, dmyPersonalizado, emitidaTexto, filaVacia,
  ocultosPersonalizadoEnPalabras, sufijoArchivoPersonalizado,
  empresasCatalogoPersonalizado, categoriasCatalogoPersonalizado, estadosCatalogoPersonalizado, filtrarCatalogoPersonalizado,
  aplicarDatosDelRango, cardinalTexto, litrosTexto, rangoOrdenado, totalLitrosPersonalizado, usaRangoPersonalizado,
  crearRegistroHistorialPersonalizado, etiquetaEquipoHistorial, filtrarHistorialPersonalizado,
} from '../lib/reporteMaquinariaPersonalizado';
import {
  cargarHistorialReportePersonalizado,
  guardarEnHistorialReportePersonalizado,
  limpiarTodoHistorialPersonalizado,
  quitarRegistroHistorialPersonalizado,
  registrarReimpresionHistorialPersonalizado,
  renombrarHistorialReportePersonalizado,
} from '../lib/reportePersonalizadoStorage';

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
  const { width } = useWindowDimensions();
  const esMovil = width < 720;

  let usuarioActual = 'Usuario';
  try {
    const auth = useAuth();
    if (auth?.fullName) usuarioActual = auth.fullName;
    else if (auth?.session?.user?.email) usuarioActual = auth.session.user.email.split('@')[0];
  } catch {
    // Si se monta fuera de AuthProvider en pruebas, usa respaldo neutro
  }

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
  const [fuente, setFuente] = useState<'todos' | 'maq' | 'veh'>('maq');
  const [empresasSel, setEmpresasSel] = useState<string[]>([]);
  const [categoriasSel, setCategoriasSel] = useState<string[]>([]);
  const [estadosSel, setEstadosSel] = useState<string[]>([]);
  const [empresaBusca, setEmpresaBusca] = useState('');
  const [categoriaBusca, setCategoriaBusca] = useState('');
  const [mostrarTodasPastillas, setMostrarTodasPastillas] = useState(false);
  const [manuales, setManuales] = useState(0);
  const [confirmaVaciar, setConfirmaVaciar] = useState(false);
  const [descargando, setDescargando] = useState(false);

  // 🕒 Histórico de reportes personalizados sacados (guardar, reimprimir, reusar y borrar):
  const [historial, setHistorial] = useState<RegistroHistorialPersonalizado[]>([]);
  const [historicoAbierto, setHistoricoAbierto] = useState(false);
  const [etiquetaHistorico, setEtiquetaHistorico] = useState('');
  const [buscaHistorico, setBuscaHistorico] = useState('');
  const [expandidosEquiposIds, setExpandidosEquiposIds] = useState<string[]>([]);
  const [renombrandoId, setRenombrandoId] = useState<string | null>(null);
  const [textoRenombrar, setTextoRenombrar] = useState('');
  const [confirmaBorrarId, setConfirmaBorrarId] = useState<string | null>(null);
  const [confirmaLimpiarHistorico, setConfirmaLimpiarHistorico] = useState(false);
  const [confirmaReusarId, setConfirmaReusarId] = useState<string | null>(null);
  const [avisoHistorico, setAvisoHistorico] = useState<string | null>(null);
  const [reusadoDesde, setReusadoDesde] = useState<{ id: string; etiqueta: string; cuando: string } | null>(null);
  const [reimprimiendoId, setReimprimiendoId] = useState<string | null>(null);

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
      const [maqs, averias, averiaCatVivo, jornadaCat, inspByShift, vehs] = await Promise.all([
        selectAllRows(
          'machinery',
          'id, code, marca, modelo, clasificacion, serial, plate, zona, location, encargado, operational, en_espera, active, transferida, weight_ton, length_m, width_m, height_m, last_horometro, company:company_id(name)',
        ).catch(() =>
          selectAllRows(
            'machinery',
            'id, code, marca, modelo, clasificacion, serial, plate, zona, location, encargado, operational, en_espera, active, weight_ton, length_m, width_m, height_m, last_horometro, company:company_id(name)',
          ),
        ),
        // Respaldo de averías pendientes si falla fetchAveriaCat:
        selectAllRows('maintenance_requests', 'machinery_id, material', (q: any) => q.eq('status', 'pendiente')).catch(() => [] as any[]),
        // ⭐ Misma fuente en vivo que el Catálogo (EquiposScreen) y Conteo de equipos:
        fetchAveriaCat().catch(() => null),
        fetchJornadaCat().catch(() => ({} as Awaited<ReturnType<typeof fetchJornadaCat>>)),
        fetchInspByShift().catch(() => ({} as Awaited<ReturnType<typeof fetchInspByShift>>)),
        // 🚗 Vehículos (09-oct-2026, a pedido): entran al taller igual que las
        //    máquinas. Algunas columnas de su ficha llegaron por SQL opcional,
        //    así que si el select completo falla se cae a lo básico, y si ni
        //    eso se puede leer, el taller sigue solo con la maquinaria.
        selectAllRows('vehicles', 'id, plate, name, brand, model, vehicle_type, clasificacion, serial, encargado, en_espera, active, company:company_id(name)')
          .catch(() => selectAllRows('vehicles', 'id, plate, brand, model, vehicle_type, active').catch(() => [] as any[])),
      ]);
      // Respaldo si fetchAveriaCat no estuvo disponible:
      const averiaCatRespaldo: Record<string, AveriaEntry> = {};
      (averias as any[]).forEach((a) => {
        const id = String(a.machinery_id ?? '');
        if (!id) return;
        const tipo: 'averia' | 'parada' = limpio(a.material) === 'MÁQUINA PARADA' ? 'parada' : 'averia';
        const prev = averiaCatRespaldo[id];
        if (!prev || (prev.tipo === 'parada' && tipo === 'averia')) {
          averiaCatRespaldo[id] = { tipo, motivo: null, createdMs: 0 };
        }
      });
      const listaMaqs = (maqs as any[]) ?? [];
      const retiredIds = new Set<string>(listaMaqs.filter((m) => m.operational === false).map((m) => String(m.id)));
      const statusOf = makeLiveStatusOf({
        jornadaCat,
        averiaCat: averiaCatVivo ?? averiaCatRespaldo,
        inspByShift,
        retiredIds,
        nowTick: Date.now(),
      });
      // ⭐ El MISMO clasificador de los 6 cubos excluyentes del Catálogo (estadoConteoDe):
      //    retirada / transferida (operational=false) > esperando (en_espera)
      //    > averiada / parada (vigente en vivo, respetando reactivación por jornada nueva)
      //    > operativa.
      const estadoRealDe = (m: any): string => {
        const est = estadoConteoDe(m, statusOf(String(m.id)).estado);
        if (est === 'transferida') return 'Transferido a otros';
        return ESTADO_CONTEO_INFO[est].label;
      };
      const filasMaq = (listaMaqs.map((m) => ({
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
        estado: estadoRealDe(m),
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

  const categoriasDisponibles = useMemo(
    () => categoriasCatalogoPersonalizado(catalogo, fuente, empresasSel),
    [catalogo, fuente, empresasSel],
  );
  const categoriasVisibles = useMemo(() => {
    const qCat = norm(categoriaBusca);
    if (!qCat) return categoriasDisponibles;
    return categoriasDisponibles.filter((c) => norm(c.nombre).includes(qCat));
  }, [categoriasDisponibles, categoriaBusca]);

  const estadosDisponibles = useMemo(
    () => estadosCatalogoPersonalizado(catalogo, fuente, empresasSel, categoriasSel),
    [catalogo, fuente, empresasSel, categoriasSel],
  );

  const coincidentes = useMemo(
    () => filtrarCatalogoPersonalizado({ catalogo, fuente, empresasSel, categoriasSel, estadosSel, busca }),
    [catalogo, fuente, empresasSel, categoriasSel, estadosSel, busca],
  );

  const toggleEmpresaFiltro = (nombre: string) =>
    setEmpresasSel((prev) => (prev.includes(nombre) ? prev.filter((x) => x !== nombre) : [...prev, nombre]));

  const toggleCategoriaFiltro = (nombre: string) =>
    setCategoriasSel((prev) => (prev.includes(nombre) ? prev.filter((x) => x !== nombre) : [...prev, nombre]));

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

  useEffect(() => {
    cargarHistorialReportePersonalizado()
      .then((lista) => setHistorial(lista))
      .catch(() => {});
  }, []);

  const mostrarAvisoTemporal = (msg: string) => {
    setAvisoHistorico(msg);
    setTimeout(() => {
      setAvisoHistorico((actual) => (actual === msg ? null : actual));
    }, 5000);
  };

  const guardarActualEnHistorico = async (origen: 'impresion' | 'manual', nombreArchivoForzado?: string) => {
    if (filas.length === 0) return;
    const nombreArch = nombreArchivoForzado || `Reporte personalizado ${sufijoArchivoPersonalizado(fechaEmision, opciones)}`.replace(/\//g, '-');
    const reg = crearRegistroHistorialPersonalizado({
      creadoPorNombre: usuarioActual,
      origen,
      etiqueta: limpio(etiquetaHistorico),
      nombreArchivo: nombreArch,
      titulo: limpio(titulo) || 'Reporte de maquinaria',
      subtitulo: limpio(subtitulo),
      subtituloPapel,
      nota,
      fechaEmision,
      emitida: emitidaTexto(fechaEmision) || undefined,
      conRango,
      desde: rango.desde,
      hasta: rango.hasta,
      opciones,
      logos,
      marcaTexto,
      filas,
      filtros: {
        fuente,
        empresasSel,
        categoriasSel,
        estadosSel,
        busca,
      },
      editadosManual: Array.from(editados.current),
      manuales,
    });
    const lista = await guardarEnHistorialReportePersonalizado(reg);
    setHistorial(lista);
    if (origen === 'manual') {
      mostrarAvisoTemporal('💾 Reporte guardado en el histórico. Puedes reimprimirlo como estaba o reusarlo y modificarlo cuando quieras.');
    }
  };

  const descargarPdf = async () => {
    setDescargando(true);
    try {
      const nombreArchivo = `Reporte personalizado ${sufijoArchivoPersonalizado(fechaEmision, opciones)}`.replace(/\//g, '-');
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
      await guardarActualEnHistorico('impresion', nombreArchivo);
      await exportPdf(html, nombreArchivo);
    } finally {
      setDescargando(false);
    }
  };

  // 🖨️ Opción A: Reimprimir tal cual estaba cuando se sacó (snapshot congelado).
  const reimprimirDelHistorico = async (item: RegistroHistorialPersonalizado) => {
    setReimprimiendoId(item.id);
    try {
      const html = pdfDocument({
        title: limpio(item.titulo) || 'Reporte de maquinaria',
        subtitle: item.subtituloPapel || limpio(item.subtitulo),
        extraCss: CSS_REPORTE_PERSONALIZADO,
        logos: item.logos,
        marcaTexto: item.marcaTexto,
        emitida: item.emitida || emitidaTexto(item.fechaEmision) || undefined,
        body: cuerpoReportePersonalizado({ filas: item.filas, opciones: item.opciones, nota: item.nota }),
      });
      const nombreArch = (item.nombreArchivo || `Reporte personalizado ${sufijoArchivoPersonalizado(item.fechaEmision, item.opciones)}`).replace(/\//g, '-');
      await exportPdf(html, nombreArch);
      const lista = await registrarReimpresionHistorialPersonalizado(item.id);
      setHistorial(lista);
      mostrarAvisoTemporal(`🖨️ Reimpreso como estaba: «${item.etiqueta || item.resumen.etiquetaAuto}».`);
    } finally {
      setReimprimiendoId(null);
    }
  };

  // ✏️ Opción B: Reusar y modificar (carga las filas, opciones, fechas y filtros en el taller).
  const reusarDelHistorico = (item: RegistroHistorialPersonalizado) => {
    if (filas.length > 0 && confirmaReusarId !== item.id) {
      setConfirmaReusarId(item.id);
      setTimeout(() => {
        setConfirmaReusarId((actual) => (actual === item.id ? null : actual));
      }, 3500);
      return;
    }
    setConfirmaReusarId(null);
    editados.current = new Set(item.editadosManual || []);
    setFilas((item.filas || []).map((f) => ({ ...f })));
    setTitulo(item.titulo || 'Reporte de maquinaria');
    setSubtitulo(item.subtitulo || 'Reporte personalizado');
    setNota(item.nota || '');
    setFechaEmision(item.fechaEmision || caracasToday());
    setConRango(Boolean(item.conRango));
    setDesde(item.desde || caracasToday());
    setHasta(item.hasta || caracasToday());
    setOpciones({ ...OPCIONES_PERSONALIZADO_INICIAL, ...(item.opciones || {}) });
    setLogos({ ...LOGOS_POR_DEFECTO, ...(item.logos || {}) });
    setMarcaTexto(item.marcaTexto !== false);
    setManuales(item.manuales || 0);
    setEtiquetaHistorico(item.etiqueta || '');
    if (item.filtros) {
      setFuente(item.filtros.fuente || 'todos');
      setEmpresasSel([...(item.filtros.empresasSel || [])]);
      setCategoriasSel([...(item.filtros.categoriasSel || [])]);
      setEstadosSel([...(item.filtros.estadosSel || [])]);
      setBusca(item.filtros.busca || '');
    }
    const etiq = item.etiqueta || item.resumen?.etiquetaAuto || item.titulo;
    setReusadoDesde({ id: item.id, etiqueta: etiq, cuando: item.cuandoTexto });
    setHistoricoAbierto(false);
    mostrarAvisoTemporal(`✏️ Cargado en el taller («${etiq}»): modifica lo que necesites y descarga el nuevo PDF.`);
  };

  // 🔄 Refrescar estados y datos de las filas cargadas contra el catálogo vivo de hoy
  const refrescarFilasConCatalogoHoy = () => {
    if (catalogo.length === 0 || filas.length === 0) return;
    const porId = new Map(catalogo.map((m) => [m.id, m]));
    setFilas((prev) =>
      prev.map((f) => {
        const vivo = porId.get(f.id);
        if (!vivo) return f;
        return aplicarDatosDelRango(
          {
            ...f,
            estado: vivo.estado,
            empresa: vivo.empresa || f.empresa,
            zona: vivo.zona || f.zona,
            encargado: vivo.encargado || f.encargado,
            horometro: vivo.horometro || f.horometro,
            plate: vivo.plate || f.plate,
            serial: vivo.serial || f.serial,
          },
          datosRango,
          editados.current,
        );
      }),
    );
    mostrarAvisoTemporal('🔄 Se actualizaron los estados, horómetros y ubicaciones de las filas con el catálogo de hoy.');
  };

  // 🗑️ Opción C: Borrar un reporte individual o limpiar todo el histórico
  const borrarItemHistorico = async (id: string) => {
    if (confirmaBorrarId !== id) {
      setConfirmaBorrarId(id);
      setTimeout(() => {
        setConfirmaBorrarId((actual) => (actual === id ? null : actual));
      }, 3500);
      return;
    }
    setConfirmaBorrarId(null);
    const lista = await quitarRegistroHistorialPersonalizado(id);
    setHistorial(lista);
    mostrarAvisoTemporal('🗑️ Reporte eliminado del histórico.');
  };

  const limpiarTodoElHistorico = async () => {
    if (!confirmaLimpiarHistorico) {
      setConfirmaLimpiarHistorico(true);
      setTimeout(() => setConfirmaLimpiarHistorico(false), 3500);
      return;
    }
    setConfirmaLimpiarHistorico(false);
    const lista = await limpiarTodoHistorialPersonalizado();
    setHistorial(lista);
    mostrarAvisoTemporal('🧹 Se vació todo el histórico de reportes personalizados.');
  };

  const guardarRenombradoHistorico = async (id: string) => {
    const lista = await renombrarHistorialReportePersonalizado(id, textoRenombrar);
    setHistorial(lista);
    setRenombrandoId(null);
    setTextoRenombrar('');
    mostrarAvisoTemporal('🏷️ Etiqueta del reporte actualizada en el histórico.');
  };

  const toggleExpandirEquipos = (id: string) => {
    setExpandidosEquiposIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const historialFiltrado = useMemo(
    () => filtrarHistorialPersonalizado(historial, buscaHistorico),
    [historial, buscaHistorico],
  );

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

      {/* 🕒 HISTÓRICO DE REPORTES SACADOS (guardar, repetir/reimprimir como estaba, reusar/modificar y borrar) */}
      <View
        style={{
          borderWidth: 1,
          borderColor: historicoAbierto ? colors.brand : colors.border,
          borderRadius: radius.md,
          padding: spacing.sm,
          marginTop: spacing.xs,
          marginBottom: spacing.xs,
          backgroundColor: colors.surfaceAlt,
        }}
      >
        <View
          style={{
            flexDirection: esMovil ? 'column' : 'row',
            alignItems: esMovil ? 'stretch' : 'center',
            justifyContent: 'space-between',
            gap: spacing.xs,
          }}
        >
          <TouchableOpacity
            onPress={() => setHistoricoAbierto((v) => !v)}
            style={{ flex: 1 }}
          >
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13 }}>
              🕒 Histórico de reportes sacados ({historial.length}) {historicoAbierto ? '▲' : '▼'}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
              {historial.length === 0
                ? 'Cada reporte que descargues en PDF (o guardes aquí) queda registrado para reimprimirlo como estaba o reusarlo y modificarlo.'
                : `Último: ${historial[0].cuandoTexto} · «${historial[0].etiqueta || historial[0].resumen.etiquetaAuto}» (${historial[0].resumen.totalEquipos} eq.) — toca para ${historicoAbierto ? 'ocultar' : 'ver todo el histórico'}.`}
            </Text>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' }}>
            {filas.length > 0 ? (
              <TouchableOpacity
                onPress={() => { void guardarActualEnHistorico('manual'); }}
                style={{
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 7,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: colors.brand,
                  backgroundColor: colors.surface,
                }}
              >
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>
                  💾 Guardar actual en histórico
                </Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={() => setHistoricoAbierto((v) => !v)}
              style={{
                paddingHorizontal: spacing.sm,
                paddingVertical: 7,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: historicoAbierto ? colors.brand : colors.border,
                backgroundColor: historicoAbierto ? colors.brand : colors.surface,
              }}
            >
              <Text style={{ color: historicoAbierto ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 12 }}>
                {historicoAbierto ? '▲ Ocultar histórico' : `▼ Ver histórico (${historial.length})`}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {avisoHistorico ? (
          <View
            style={{
              marginTop: spacing.xs,
              paddingHorizontal: spacing.sm,
              paddingVertical: 6,
              borderRadius: radius.sm,
              borderWidth: 1,
              borderColor: colors.brand,
              backgroundColor: colors.surface,
            }}
          >
            <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>{avisoHistorico}</Text>
          </View>
        ) : null}

        {historicoAbierto ? (
          <View style={{ marginTop: spacing.sm }}>
            {historial.length === 0 ? (
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                Aún no hay reportes guardados en el histórico. Arma un reporte abajo y pulsa «📄 Descargar el reporte (PDF)» o «💾 Guardar actual en histórico».
              </Text>
            ) : (
              <View>
                <View
                  style={{
                    flexDirection: esMovil ? 'column' : 'row',
                    alignItems: esMovil ? 'stretch' : 'center',
                    gap: spacing.xs,
                    marginBottom: spacing.xs,
                  }}
                >
                  <TextInput
                    value={buscaHistorico}
                    onChangeText={setBuscaHistorico}
                    placeholder="🔎 Buscar en el histórico por nombre, fecha, empresa, categoría, código o placa…"
                    placeholderTextColor={colors.muted}
                    style={{
                      flex: 1,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.sm,
                      paddingHorizontal: 8,
                      paddingVertical: 6,
                      color: colors.text,
                      fontSize: 12,
                      backgroundColor: colors.surface,
                    }}
                  />
                  {historial.length > 0 ? (
                    <TouchableOpacity
                      onPress={() => { void limpiarTodoElHistorico(); }}
                      style={{
                        paddingHorizontal: spacing.sm,
                        paddingVertical: 6,
                        borderRadius: radius.pill,
                        borderWidth: 1,
                        borderColor: colors.danger,
                        backgroundColor: confirmaLimpiarHistorico ? colors.danger : colors.surface,
                        alignSelf: esMovil ? 'flex-start' : 'center',
                      }}
                    >
                      <Text
                        style={{
                          color: confirmaLimpiarHistorico ? colors.brandContrast : colors.danger,
                          fontWeight: '800',
                          fontSize: 11,
                        }}
                      >
                        {confirmaLimpiarHistorico
                          ? `⚠️ ¿Borrar los ${historial.length} reportes? Toca otra vez`
                          : `🧹 Limpiar histórico (${historial.length})`}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                {historialFiltrado.length === 0 ? (
                  <Text style={{ color: colors.muted, fontSize: 12, marginVertical: spacing.xs }}>
                    Ningún reporte del histórico coincide con «{buscaHistorico}».
                  </Text>
                ) : null}

                {historialFiltrado.map((item, idx) => {
                  const expandido = expandidosEquiposIds.includes(item.id);
                  const renombrando = renombrandoId === item.id;
                  const pidiendoBorrar = confirmaBorrarId === item.id;
                  const pidiendoReusar = confirmaReusarId === item.id;
                  const etiquetaVisible = item.etiqueta || item.resumen?.etiquetaAuto || item.titulo;

                  return (
                    <View
                      key={item.id}
                      style={{
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: radius.md,
                        padding: spacing.sm,
                        marginTop: spacing.xs,
                        backgroundColor: colors.surface,
                      }}
                    >
                      {/* Encabezado de la tarjeta del histórico */}
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: 6,
                        }}
                      >
                        <View style={{ flex: 1, minWidth: 200 }}>
                          <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13 }}>
                            {idx + 1}. 📌 {etiquetaVisible}
                          </Text>
                          <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
                            📄 {item.titulo} · {item.subtituloPapel}
                          </Text>
                          <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
                            🕒 Sacado: {item.cuandoTexto} · 👤 Por: {item.creadoPorNombre || 'Usuario'} · 📅 Emitida: {dmyPersonalizado(item.fechaEmision) || item.fechaEmision}
                            {item.vecesReimpreso > 0 ? ` · 🔁 Reimpreso ×${item.vecesReimpreso}` : ''}
                          </Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => {
                            if (renombrando) {
                              setRenombrandoId(null);
                              setTextoRenombrar('');
                            } else {
                              setRenombrandoId(item.id);
                              setTextoRenombrar(item.etiqueta || '');
                            }
                          }}
                          style={{
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            borderRadius: radius.pill,
                            borderWidth: 1,
                            borderColor: colors.border,
                            backgroundColor: colors.surfaceAlt,
                          }}
                        >
                          <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '700' }}>
                            {renombrando ? '✕ Cancelar' : '🏷️ Nombrar'}
                          </Text>
                        </TouchableOpacity>
                      </View>

                      {/* Editor en línea para ponerle o cambiarle etiqueta al reporte */}
                      {renombrando ? (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs, alignItems: 'center' }}>
                          <TextInput
                            value={textoRenombrar}
                            onChangeText={setTextoRenombrar}
                            placeholder="Escribe un nombre para identificar este reporte (ej. Cierre semanal Savanna)…"
                            placeholderTextColor={colors.muted}
                            style={{
                              flex: 1,
                              minWidth: 180,
                              borderWidth: 1,
                              borderColor: colors.brand,
                              borderRadius: radius.sm,
                              paddingHorizontal: 8,
                              paddingVertical: 5,
                              color: colors.text,
                              fontSize: 12,
                              backgroundColor: colors.surfaceAlt,
                            }}
                          />
                          <TouchableOpacity
                            onPress={() => { void guardarRenombradoHistorico(item.id); }}
                            style={{
                              paddingHorizontal: spacing.sm,
                              paddingVertical: 6,
                              borderRadius: radius.sm,
                              backgroundColor: colors.brand,
                            }}
                          >
                            <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>Guardar nombre</Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}

                      {/* Chips de qué contenía este reporte ("cuál fue que saqué") */}
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.xs }}>
                        <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}>
                          <Text style={{ color: colors.text, fontSize: 11, fontWeight: '800' }}>
                            🚜 {item.resumen.totalEquipos} equipo(s) ({item.resumen.porEstadoTexto})
                          </Text>
                        </View>
                        <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}>
                          <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>
                            📅 {item.resumen.rangoTexto}
                          </Text>
                        </View>
                        {item.resumen.empresasTexto && item.resumen.empresasTexto !== 'Todas las empresas' ? (
                          <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}>
                            <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>
                              🏢 {item.resumen.empresasTexto}
                            </Text>
                          </View>
                        ) : null}
                        {item.resumen.categoriasTexto && item.resumen.categoriasTexto !== 'Todas las categorías' ? (
                          <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}>
                            <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>
                              🔶 {item.resumen.categoriasTexto}
                            </Text>
                          </View>
                        ) : null}
                        {!item.opciones.sinConsumo ? (
                          <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}>
                            <Text style={{ color: colors.text, fontSize: 11, fontWeight: '800' }}>
                              ⛽ Combustible: {item.resumen.totalLitrosTexto || '0 L'}
                            </Text>
                          </View>
                        ) : null}
                        {!item.opciones.sinCardinal ? (
                          <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}>
                            <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>
                              🧭 Este / Oeste incluido
                            </Text>
                          </View>
                        ) : null}
                        {!item.opciones.sinPorEmpresa ? (
                          <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}>
                            <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>
                              📊 Cuadro por empresa
                            </Text>
                          </View>
                        ) : null}
                      </View>

                      {/* Vista previa de las máquinas con Código + Placa (desplegable para ver todas) */}
                      <View style={{ marginTop: 6 }}>
                        <TouchableOpacity onPress={() => toggleExpandirEquipos(item.id)}>
                          <Text style={{ color: colors.muted, fontSize: 11 }}>
                            <Text style={{ fontWeight: '800', color: colors.text }}>Equipos en este reporte: </Text>
                            {item.resumen.previewEquipos}{' '}
                            <Text style={{ color: colors.brandText, fontWeight: '800' }}>
                              {expandido ? '[▲ Ocultar lista]' : `[▼ Ver los ${item.filas.length} equipos]`}
                            </Text>
                          </Text>
                        </TouchableOpacity>
                        {expandido ? (
                          <View
                            style={{
                              marginTop: 6,
                              padding: spacing.xs,
                              borderRadius: radius.sm,
                              backgroundColor: colors.surfaceAlt,
                              borderWidth: 1,
                              borderColor: colors.border,
                            }}
                          >
                            {item.filas.map((f, fIdx) => (
                              <Text key={`${item.id}-${f.id}-${fIdx}`} style={{ color: colors.text, fontSize: 11, marginBottom: 2 }}>
                                {fIdx + 1}. {etiquetaEquipoHistorial(f)}
                                {f.clasificacion ? ` · ${f.clasificacion}` : ''}
                                {f.empresa ? ` · ${f.empresa}` : ''}
                                {f.estado ? ` [${f.estado}]` : ''}
                                {!item.opciones.sinConsumo && f.litros ? ` · ⛽ ${f.litros} L` : ''}
                                {!item.opciones.sinCardinal && f.cardinal ? ` · 🧭 ${f.cardinal}` : ''}
                              </Text>
                            ))}
                          </View>
                        ) : null}
                      </View>

                      {/* Barra de 3 botones de acción responsivos (Móvil y PC): Reimprimir como estaba, Reusar y modificar, Borrar */}
                      <View
                        style={{
                          flexDirection: esMovil ? 'column' : 'row',
                          flexWrap: 'wrap',
                          gap: spacing.xs,
                          marginTop: spacing.sm,
                        }}
                      >
                        <TouchableOpacity
                          disabled={reimprimiendoId === item.id}
                          onPress={() => { void reimprimirDelHistorico(item); }}
                          style={{
                            flexGrow: esMovil ? 0 : 1,
                            paddingHorizontal: spacing.sm,
                            paddingVertical: 8,
                            borderRadius: radius.sm,
                            backgroundColor: colors.brand,
                            alignItems: 'center',
                          }}
                        >
                          <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>
                            {reimprimiendoId === item.id ? '🖨️ Armando PDF…' : '🖨️ Reimprimir como estaba'}
                          </Text>
                        </TouchableOpacity>

                        <View style={{ flexDirection: 'row', flexGrow: 1, gap: spacing.xs }}>
                          <TouchableOpacity
                            onPress={() => reusarDelHistorico(item)}
                            style={{
                              flex: 2,
                              paddingHorizontal: spacing.sm,
                              paddingVertical: 8,
                              borderRadius: radius.sm,
                              borderWidth: 1,
                              borderColor: colors.brand,
                              backgroundColor: pidiendoReusar ? colors.brand : colors.surfaceAlt,
                              alignItems: 'center',
                            }}
                          >
                            <Text
                              style={{
                                color: pidiendoReusar ? colors.brandContrast : colors.brandText,
                                fontWeight: '800',
                                fontSize: 12,
                              }}
                            >
                              {pidiendoReusar
                                ? `⚠️ ¿Reemplazar las ${filas.length} actuales? Toca otra vez`
                                : '✏️ Reusar y modificar'}
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            onPress={() => { void borrarItemHistorico(item.id); }}
                            style={{
                              flex: 1,
                              paddingHorizontal: spacing.sm,
                              paddingVertical: 8,
                              borderRadius: radius.sm,
                              borderWidth: 1,
                              borderColor: colors.danger,
                              backgroundColor: pidiendoBorrar ? colors.danger : colors.surfaceAlt,
                              alignItems: 'center',
                            }}
                          >
                            <Text
                              style={{
                                color: pidiendoBorrar ? colors.brandContrast : colors.danger,
                                fontWeight: '800',
                                fontSize: 12,
                              }}
                            >
                              {pidiendoBorrar ? '⚠️ ¿Seguro? Toca' : '🗑️ Borrar'}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        ) : null}
      </View>

      {/* Banner activo cuando el usuario cargó un reporte del histórico para reusarlo y modificarlo */}
      {reusadoDesde ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: colors.brand,
            borderRadius: radius.md,
            padding: spacing.sm,
            marginBottom: spacing.xs,
            backgroundColor: colors.surfaceAlt,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
            <View style={{ flex: 1, minWidth: 200 }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 12 }}>
                ✏️ Reusando reporte del histórico: «{reusadoDesde.etiqueta}» (sacado el {reusadoDesde.cuando})
              </Text>
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
                Puedes agregar o quitar máquinas, cambiar fechas o editar cualquier celda. Si quieres traer los estados actuales de hoy conservando esta misma lista de máquinas, toca el botón de al lado.
              </Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' }}>
              <TouchableOpacity
                onPress={refrescarFilasConCatalogoHoy}
                style={{
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 6,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: colors.brand,
                  backgroundColor: colors.surface,
                }}
              >
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 11 }}>
                  🔄 Actualizar estados con el catálogo de hoy
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setReusadoDesde(null)}>
                <Text style={{ color: colors.muted, fontWeight: '800', fontSize: 11 }}>✕ Cerrar aviso</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}

      {rotulo('📝 ENCABEZADO DEL PAPEL (todo editable)')}
      <View style={{ marginBottom: spacing.xs }}>
        <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '700' }}>
          🏷️ Nombre o etiqueta para identificar este reporte en el histórico (opcional; si lo dejas vacío se resume solo)
        </Text>
        <TextInput
          value={etiquetaHistorico}
          onChangeText={setEtiquetaHistorico}
          placeholder="Ej.: Cierre viernes Savanna / Excavadoras operativas…"
          placeholderTextColor={colors.muted}
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.sm,
            paddingHorizontal: 8,
            paddingVertical: 6,
            color: colors.text,
            fontSize: 12,
            backgroundColor: colors.surface,
          }}
        />
      </View>
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

      {/* 🔶 Filtro por una o varias Categorías de la maquinaria */}
      {categoriasDisponibles.length > 0 ? (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.xs, backgroundColor: colors.surfaceAlt }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
            <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800' }}>
              🔶 Filtrar por categoría de la maquinaria ({categoriasSel.length === 0 ? `Todas · ${categoriasDisponibles.length}` : `${categoriasSel.length} seleccionada(s)`})
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {categoriasSel.length < categoriasDisponibles.length ? (
                <TouchableOpacity onPress={() => setCategoriasSel(categoriasDisponibles.map((c) => c.nombre))}>
                  <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '800' }}>☑ Marcar todas</Text>
                </TouchableOpacity>
              ) : null}
              {categoriasSel.length > 0 ? (
                <TouchableOpacity onPress={() => setCategoriasSel([])}>
                  <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '800' }}>✕ Limpiar categorías ({categoriasSel.length})</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
          {categoriasDisponibles.length > 4 ? (
            <TextInput
              value={categoriaBusca}
              onChangeText={setCategoriaBusca}
              placeholder="🔎 Buscar categoría (ej. Remoción y excavación, Transporte de escombros…)"
              placeholderTextColor={colors.muted}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4, color: colors.text, fontSize: 12, backgroundColor: colors.surface, marginBottom: 6 }}
            />
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {pastilla('cat-todas', `🔶 Todas (${categoriasDisponibles.reduce((acc, c) => acc + c.count, 0)})`, categoriasSel.length === 0, () => setCategoriasSel([]))}
            {categoriasVisibles.map((cat) => {
              const activa = categoriasSel.includes(cat.nombre);
              return pastilla(
                `cat-${cat.nombre}`,
                `${activa ? '✓ ' : ''}${cat.nombre} · ${cat.count}`,
                activa,
                () => toggleCategoriaFiltro(cat.nombre),
              );
            })}
          </View>
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
            {categoriasSel.length === 0
              ? 'Toca una o varias categorías para ver y seleccionar solo esas máquinas (ej. Remoción y excavación, Transporte de escombros, Manejo de carga…).'
              : `Mostrando categoría(s): ${categoriasSel.join(' · ')}. Puedes seleccionarlas todas en bloque o escoger una por una abajo.`}
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

      <TextInput value={busca} onChangeText={setBusca} placeholder="🔎 Buscar por código, placa, serial, marca, categoría o empresa…" placeholderTextColor={colors.muted}
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
          const catTxt = m.clasificacion ? ` · ${m.clasificacion}` : '';
          const empTxt = m.empresa ? ` · ${m.empresa}` : '';
          const estTxt = m.estado && m.estado !== 'Operativa' ? ` [${m.estado}]` : '';
          return pastilla(
            m.id,
            `${enPapel.has(m.id) ? '✓ ' : ''}${esVehiculo(m.id) ? '🚗 ' : ''}${baseCode}${placaTxt}${catTxt}${empTxt}${estTxt}`,
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

      <View style={{ flexDirection: esMovil ? 'column' : 'row', gap: spacing.xs, marginTop: spacing.sm }}>
        <TouchableOpacity
          disabled={descargando || cargando || cargandoLitros || cargandoCardinal || filas.length === 0}
          onPress={descargarPdf}
          style={{ flex: esMovil ? 0 : 2, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', backgroundColor: descargando || cargando || cargandoLitros || cargandoCardinal || filas.length === 0 ? colors.border : colors.brand }}>
          <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{descargando ? 'Armando el papel…' : cargandoLitros || cargandoCardinal ? 'Leyendo los datos del rango…' : '📄 Descargar el reporte (PDF)'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          disabled={cargando || cargandoLitros || cargandoCardinal || filas.length === 0}
          onPress={() => { void guardarActualEnHistorico('manual'); }}
          style={{
            flex: esMovil ? 0 : 1,
            borderRadius: radius.md,
            paddingVertical: spacing.md,
            paddingHorizontal: spacing.sm,
            alignItems: 'center',
            borderWidth: 1,
            borderColor: filas.length === 0 ? colors.border : colors.brand,
            backgroundColor: colors.surface,
          }}>
          <Text style={{ color: filas.length === 0 ? colors.muted : colors.brandText, fontWeight: '800' }}>
            💾 Guardar en el histórico
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
