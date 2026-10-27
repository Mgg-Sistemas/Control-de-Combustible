// 🏭 CENTRO DE OPERACIONES — 📄 REPORTES (24-oct-2026).
//
// Los cuatro papeles del sitio con todas sus opciones (diseño, sección 9):
//   · 📄 Reporte completo (PD5b, el primero): todo el 📅 Parte diario del período por
//     JORNADAS enteras (7am a 7am). Con él no se muestran la hora de corte, el buscador,
//     los filtros, el orden ni el resumen editable (no aplican); sí las secciones, los
//     logos y los textos. Sus datos (`cargarDatosReporteCompleto`) se cargan SOLO con él
//     elegido, con su propia guarda de respuestas viejas. 🚜 Su sección Maquinaria lee
//     inspección AL EMITIR (`leerInspeccionAlEmitir` con `cargarEstadoInspeccion`; solo si la
//     sección se ve y hay vinculadas): si falla o no responde, el PDF sale IGUAL con su aviso.
//     La hoja abierta lee una vez por carga, para mostrar lo mismo que dirá el papel;
//   · 📊 Consolidado (papel A), 🚛 Corte por unidad (papel B: una o varias
//     unidades, UNA HOJA CADA UNA) y 📋 Listado detallado;
//   · rango con pastillas o desde–hasta, y HORA DE CORTE opcional (00:00–23:59);
//     la fecha es la de JORNADA (7am a 7am): un corte de madrugada —y uno a las 07:00
//     en punto, que cierra la jornada (R33)— es del día siguiente, y así lo dicen el
//     papel y el aviso de la pantalla (lo arma `momentoDelCorte`);
//   · filtros (los de 📋 Registros) y buscador;
//   · «¿Qué se oculta?»: un interruptor por sección y por columna de ESE papel;
//   · logos del membrete y textos (título, subtítulo, presentación,
//     consideraciones, emisión) precargados de los ajustes del sitio, con
//     «💾 Guardar como texto fijo» (solo Full);
//   · el resumen ejecutivo editable (EditorResumen), orden y agrupación;
//   · la vista previa con el AVISO DE LO APAGADO, que es SOLO DE LA PANTALLA;
//   · «📄 PDF» con pdfDocument + exportPdf y el nombre de `nombreArchivoCop` (las hojas
//     del corte por su parámetro de unidades; cada hoja desde la 2.ª con título y emisión).
//
// ⭐ RÁPIDA AL TECLEAR (auditoría del lote 4, A2 = B4): la pantalla arma el MODELO sin el
//    HTML (`conCuerpo: false`) y solo con lo que lo mueve (`claveDelModelo`); el papel
//    completo se arma al tocar 📄 PDF —con lo de ese instante, nunca un valor diferido— y,
//    con la hoja abierta en web, 400 ms después de la última tecla.
//
// ⭐ LAS CUENTAS NO VIVEN ACÁ: `armarPapelCop` (centroOperacionesReportes.ts) arma
//    la regla de pertenencia UNA vez con la lista base del período y le pasa el
//    MISMO `op` al modelo y al papel. Esta pestaña solo elige y pinta.
// ⭐ LO OCULTO NO DEJA RASTRO Y LAS OPCIONES NO SE IMPRIMEN: van al nombre del
//    archivo y al aviso de esta pantalla.
// ⭐ NO ESCRIBE NADA salvo los textos fijos (`guardarAjuste`, Full), que son del SITIO:
//    lo guardado desde un papel se pone al día en todos (`rebasarTextosFijos`). Las
//    opciones de cada papel se recuerdan EN EL EQUIPO (`cop_opciones_<papel>`, en
//    try/catch: un navegador que no deja guardar no rompe nada), con el sitio adentro:
//    la forma del resumen solo vuelve en ese sitio, y las notas nunca. Al cambiar el
//    rango, las unidades del corte o los filtros, los valores escritos a mano del
//    resumen se limpian (`edicionAlCambiarDeDia`, `edicionesAlCambiar`).
//    Lo vigila scripts/test-centro-operaciones-reportes.mjs.
//
// Sin tiempo real: carga al entrar, al cambiar el rango y con 🔄.
import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Card } from '../ui';
import { Plegable } from '../Plegable';
import { DateField } from '../DateField';
import { Toggle } from '../CubicajeTab';
import { useToast } from '../ToastProvider';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { levelMeets, PermLevel } from '../../lib/permissions';
import { caracasBusinessToday } from '../../lib/caracasDay';
import { exportPdf, nowStamp, pdfDocument } from '../../lib/pdf';
import { aplicarEdicionResumen, edicionAlCambiarDeDia } from '../../lib/frentesReporte';
import type { EdicionResumen } from '../../lib/frentesReporte';
import type { EstadoMov, FiltrosCop, Movimiento, Sitio, TipoMov, Unidad } from '../../lib/centroOperaciones';
import { COLUMNAS_COP, CSS_COP, SECCIONES_COP, nombreArchivoCop, periodoCop, textosDe, tituloCop } from '../../lib/centroOperacionesPapel';
import type { OpcionesPapelCop, PapelCop, TextosCop } from '../../lib/centroOperacionesPapel';
import { ESTADOS_MOV, TIPOS_MOV, opcionesTexto, opcionesUnidad, rangoRapido } from '../../lib/centroOperacionesCarga';
import type { RangoRapido } from '../../lib/centroOperacionesCarga';
import {
  PAPELES_COP,
  alternarColumna,
  alternarSeccion,
  apagadoEnPalabras,
  armarPapelCop,
  avisoCorte,
  cambiosTextosFijos,
  claveDelModelo,
  edicionesAlCambiar,
  filtrosDelPapel,
  firmaFiltros,
  memoriaLeida,
  memoriaParaGuardar,
  opcionesIniciales,
  opDelCuerpo,
  opcionesUnidadCorte,
  ordenActua,
  rebasarTextosFijos,
  seccionesEnPantalla,
  validarRango,
} from '../../lib/centroOperacionesReportes';
import type { DatosDelCompleto, EntradaPapelCop, PapelArmadoCop } from '../../lib/centroOperacionesReportes';
import { cargarAjustes, cargarDatosReporteCompleto, cargarEstadoInspeccion, cargarMovimientos, cargarUnidades, guardarAjuste } from '../../lib/centroOperacionesDb';
// 🚜 M5: la lectura de inspección al emitir (nunca bloquea el papel); el lector es el de la capa de datos.
import { leerInspeccionAlEmitir } from '../../lib/centroOperacionesReporteCompleto';
import type { LecturaInspeccion } from '../../lib/centroOperacionesReporteCompleto';
import { EditorResumen } from './EditorResumen';

type Props = { sitio: Sitio; nivel: PermLevel };

const PAPELES: PapelCop[] = ['completo', 'consolidado', 'corte', 'listado'];

/** Un valor por papel. */
function porPapel<T>(f: (p: PapelCop) => T): Record<PapelCop, T> {
  return { completo: f('completo'), consolidado: f('consolidado'), corte: f('corte'), listado: f('listado') };
}

/** Dónde recuerda el equipo las opciones de cada papel. */
const claveMemoria = (papel: PapelCop): string => `cop_opciones_${papel}`;

/** La hoja real del iframe se arma esto después de la última tecla (A2 = B4). */
const ESPERA_HOJA_MS = 400;

/**
 * ⭐ EL ÚNICO pdfDocument DE LA PESTAÑA: la vista previa y el PDF salen de acá, con
 *    el membrete neutro (`marcaTexto: false`), los logos y la emisión de ESAS
 *    opciones. Título y subtítulo llegan ya escapados del armado.
 */
function htmlDelPapel(armado: PapelArmadoCop, op: OpcionesPapelCop): string {
  return pdfDocument({
    title: armado.titulo,
    subtitle: armado.subtitulo,
    body: armado.cuerpo,
    extraCss: CSS_COP,
    logos: op.logos,
    marcaTexto: false,
    emitida: armado.emitida,
  });
}

const LOGOS: { k: keyof OpcionesPapelCop['logos']; label: string }[] = [
  { k: 'golden', label: '✨ Golden Touch' },
  { k: 'bcv', label: '🏦 Banco Central de Venezuela' },
  { k: 'sos', label: '🛟 SOS La Guaira' },
  { k: 'renace', label: '🇻🇪 Plan Venezuela Renace' },
  { k: 'jhenzaen', label: '🏗️ Jhenzaen 2.012 C.A' },
];

type CampoTexto = 'transportistas' | 'origenes' | 'destinos' | 'materiales';
const CAMPOS_TEXTO: { key: CampoTexto; campo: 'transportista' | 'origen' | 'destino' | 'material'; label: string }[] = [
  { key: 'transportistas', campo: 'transportista', label: 'Transportista' },
  { key: 'origenes', campo: 'origen', label: 'Origen' },
  { key: 'destinos', campo: 'destino', label: 'Destino' },
  { key: 'materiales', campo: 'material', label: 'Material' },
];

/** Agrega o quita un valor de una lista. */
function alternar<T>(lista: T[] | undefined, v: T): T[] {
  const l = lista ?? [];
  return l.includes(v) ? l.filter((x) => x !== v) : [...l, v];
}

const fmt = (n: number): string => n.toLocaleString('es-VE', { maximumFractionDigits: 2 });

export function ReportesTab({ sitio, nivel }: Props) {
  const { colors } = useTheme();
  const toast = useToast();
  const esFull = levelMeets(nivel, 'full');

  // El Reporte completo es el primero de la lista (PD5b): la pestaña abre en él.
  const [papel, setPapel] = useState<PapelCop>('completo');
  const esCompleto = papel === 'completo';

  // ── El rango: fechas de jornada y la hora de corte (texto, se valida) ──
  const [rapido, setRapido] = useState<RangoRapido | 'otro'>('hoy');
  const [fechas, setFechas] = useState(() => rangoRapido('hoy', caracasBusinessToday()));
  const [corteTxt, setCorteTxt] = useState('');
  /** El rango de los papeles con hora de corte (consolidado, corte y listado). */
  const validacion = useMemo(() => validarRango({ desde: fechas.desde, hasta: fechas.hasta, corte: corteTxt }), [fechas.desde, fechas.hasta, corteTxt]);
  /** ⭐ El del Reporte completo: JORNADAS enteras, sin la hora de corte (ni sus errores: no la usa). */
  const validacionJornadas = useMemo(() => validarRango({ desde: fechas.desde, hasta: fechas.hasta, corte: '' }), [fechas.desde, fechas.hasta]);
  const valida = esCompleto ? validacionJornadas : validacion;
  const rango = valida.rango;
  const claveRango = rango ? `${rango.desde}|${rango.hasta}` : '';

  // ── Los datos: lo cargado del período (LA base), la flota y los textos fijos ──
  const [base, setBase] = useState<Movimiento[]>([]);
  const [unidades, setUnidades] = useState<Unidad[]>([]);
  const [fijos, setFijos] = useState<TextosCop>(() => textosDe({}));
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Qué rango tiene `base` (mientras carga otro, el PDF espera). */
  const [cargadoDe, setCargadoDe] = useState('');
  /** Los fijos con los que se puso al día cada papel la última vez (el «viejo» de rebasarTextosFijos). */
  const fijosRef = useRef<TextosCop>(textosDe({}));
  /** Cada carga lleva su número: si el rango cambió mientras tanto, la respuesta vieja no pisa la nueva. */
  const pedido = useRef(0);

  // ── Los datos del 📄 Reporte completo (solo con él elegido): el Parte diario del período ──
  const [datosCompleto, setDatosCompleto] = useState<DatosDelCompleto | null>(null);
  const [cargandoCompleto, setCargandoCompleto] = useState(false);
  const [errorCompleto, setErrorCompleto] = useState<string | null>(null);
  /** Qué rango tienen `datosCompleto` (mientras carga otro, el PDF espera). */
  const [completoDe, setCompletoDe] = useState('');
  /** Su propio número de pedido: una respuesta vieja del Reporte completo no pisa la nueva. */
  const pedidoCompleto = useRef(0);

  // ── Las opciones de cada papel y su resumen editado ──
  const [opciones, setOpciones] = useState<Record<PapelCop, OpcionesPapelCop>>(() => porPapel((p) => opcionesIniciales(p, null, null)));
  const [ediciones, setEdiciones] = useState<Record<PapelCop, EdicionResumen>>(() => porPapel(() => ({})));
  const [memoriaLista, setMemoriaLista] = useState(false);

  // ── Filtros, unidades del corte y estados de los botones ──
  const [filtros, setFiltros] = useState<FiltrosCop>({});
  const [busca, setBusca] = useState('');
  const [unidadesCorte, setUnidadesCorte] = useState<string[]>([]);
  const [guardandoTextos, setGuardandoTextos] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [verPrevia, setVerPrevia] = useState(false);

  const op = opciones[papel];
  const edicion = ediciones[papel];
  const setOp = (f: (o: OpcionesPapelCop) => OpcionesPapelCop) => setOpciones((prev) => ({ ...prev, [papel]: f(prev[papel]) }));
  const setEdicion = (ed: EdicionResumen) => setEdiciones((prev) => ({ ...prev, [papel]: ed }));

  // ── Lo que recuerda el equipo (una vez al entrar). Leer puede fallar: se sigue sin memoria ──
  useEffect(() => {
    let vivo = true;
    (async () => {
      const leidas = porPapel((p) => memoriaLeida(p, null));
      for (const p of PAPELES) {
        let crudo: string | null = null;
        try { crudo = await AsyncStorage.getItem(claveMemoria(p)); } catch { crudo = null; }
        leidas[p] = memoriaLeida(p, crudo, sitio.id);
      }
      if (!vivo) return;
      // Solo lo oculto, el orden y la agrupación: los textos y logos son del sitio.
      setOpciones((prev) => porPapel((p) => ({ ...prev[p], ...leidas[p].opciones })));
      setEdiciones((prev) => porPapel((p) => ({ ...prev[p], ...leidas[p].edicion })));
      setMemoriaLista(true);
    })();
    return () => { vivo = false; };
  }, []);

  // ── Guardar en el equipo lo que se cambia (la forma, nunca las cifras a mano). Solo si
  //    lo que se guarda CAMBIÓ: teclear un título no lo cambia y no escribe en el equipo.
  const ultimaGuardada = useRef<Partial<Record<PapelCop, string>>>({});
  useEffect(() => {
    if (!memoriaLista) return;
    const crudo = memoriaParaGuardar(papel, opciones[papel], ediciones[papel], sitio.id);
    if (ultimaGuardada.current[papel] === crudo) return;
    ultimaGuardada.current[papel] = crudo;
    (async () => {
      try { await AsyncStorage.setItem(claveMemoria(papel), crudo); } catch { /* el equipo no deja guardar: valen mientras la pantalla esté abierta */ }
    })();
  }, [memoriaLista, papel, opciones, ediciones]);

  // ── ⭐ Al cambiar el rango, los valores escritos a mano del resumen se limpian:
  //    son cifras de ESE período y en otro mentirían. La forma (lo escondido, los
  //    títulos, las notas) se queda. La hora de corte es la de los papeles que la usan:
  //    pasar al Reporte completo (que no la usa) no limpia nada.
  useEffect(() => {
    setEdiciones((prev) => porPapel((p) => edicionAlCambiarDeDia(prev[p])));
  }, [fechas.desde, fechas.hasta, validacion.rango?.corteHora]);

  // ── Carga: los renglones del período, la flota y los textos fijos del sitio ──
  const recargar = useCallback(async () => {
    const yo = ++pedido.current;
    if (!rango) { setCargando(false); return; }
    const clave = `${rango.desde}|${rango.hasta}`;
    setCargando(true);
    setError(null);
    try {
      const [movs, flota, ajustes] = await Promise.all([
        cargarMovimientos(sitio.id, rango.desde, rango.hasta),
        cargarUnidades(sitio.id),
        cargarAjustes(sitio.id),
      ]);
      if (yo !== pedido.current) return; // ya se pidió otro rango
      const f = textosDe(ajustes);
      setBase(movs);
      setUnidades(flota);
      setCargadoDe(clave);
      // ⭐ Los textos y logos del sitio se ponen al día en los TRES papeles en cada carga
      //    (también con 🔄: quizá los guardó otro equipo). Lo que ella tecleó no se pisa:
      //    solo pasa al fijo nuevo lo que seguía igual al viejo (A7 = B2).
      const viejos = fijosRef.current;
      fijosRef.current = f;
      setFijos(f);
      setOpciones((prev) => porPapel((p) => rebasarTextosFijos(p, prev[p], viejos, f)));
    } catch (e: any) {
      if (yo !== pedido.current) return;
      const msg = e?.message || 'No se pudieron cargar los registros.';
      setError(msg);
      toast.error(msg);
    } finally {
      if (yo === pedido.current) setCargando(false);
    }
    // `sitio` (el objeto): la pantalla lo vuelve a crear al deslizar, y así se refresca.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitio, rango?.desde, rango?.hasta]);
  useEffect(() => { recargar(); }, [recargar]);

  // ── El 📄 Reporte completo: lo carga SOLO con él elegido (al elegirlo, al cambiar el rango
  //    o el sitio, y con 🔄). La misma guarda que la carga de arriba, con su propio número:
  //    si el rango cambió mientras tanto, la respuesta vieja no pisa la nueva.
  const recargarCompleto = useCallback(async () => {
    const yo = ++pedidoCompleto.current;
    if (!rango) { setCargandoCompleto(false); return; }
    const clave = `${rango.desde}|${rango.hasta}`;
    setCargandoCompleto(true);
    setErrorCompleto(null);
    try {
      const d = await cargarDatosReporteCompleto(sitio.id, rango.desde, rango.hasta);
      if (yo !== pedidoCompleto.current) return; // ya se pidió otro rango
      setDatosCompleto(d);
      setCompletoDe(clave);
    } catch (e: any) {
      if (yo !== pedidoCompleto.current) return;
      const msg = e?.message || 'No se pudo cargar el Reporte completo.';
      setErrorCompleto(msg);
      toast.error(msg);
    } finally {
      if (yo === pedidoCompleto.current) setCargandoCompleto(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitio, rango?.desde, rango?.hasta]);
  useEffect(() => { if (esCompleto) recargarCompleto(); }, [esCompleto, recargarCompleto]);

  /** 🔄: lo de todos los papeles y, con él elegido, el Reporte completo. */
  const actualizar = () => { recargar(); if (esCompleto) recargarCompleto(); };

  const elegirRapido = (q: RangoRapido) => { setRapido(q); setFechas(rangoRapido(q, caracasBusinessToday())); };
  const cambiarDesde = (d: string) => { setRapido('otro'); setFechas((r) => ({ desde: d, hasta: r.hasta < d ? d : r.hasta })); };
  const cambiarHasta = (h: string) => { setRapido('otro'); setFechas((r) => ({ desde: r.desde > h ? h : r.desde, hasta: h })); };

  // ── Lo que se elige: unidades del corte, filtros ──
  // «Trabajó» = tiene viajes DEL CORTE (internos o salidas) en el rango, con su hora de corte (A5).
  const opsCorte = useMemo(() => opcionesUnidadCorte(base, unidades, rango), [base, unidades, rango]);
  const hojas = useMemo(
    () => unidadesCorte.map((k) => opsCorte.find((o) => o.clave === k)).filter((o): o is NonNullable<typeof o> => !!o),
    [unidadesCorte, opsCorte],
  );
  const opsUnidad = useMemo(() => opcionesUnidad(base, unidades), [base, unidades]);
  const opsTexto = useMemo(() => {
    const r = {} as Record<CampoTexto, string[]>;
    for (const c of CAMPOS_TEXTO) r[c.key] = opcionesTexto(base, c.campo);
    return r;
  }, [base]);
  const filtrosConBusca = useMemo<FiltrosCop>(() => ({ ...filtros, texto: busca }), [filtros, busca]);
  // El buscador DIFERIDO solo para el modelo de la pantalla: React pinta la letra primero y
  // rearma después. ⚠️ El PDF nunca sale de acá: sale de `filtrosConBusca` (este instante).
  const buscaDiferida = useDeferredValue(busca);
  const filtrosModelo = useMemo<FiltrosCop>(() => ({ ...filtros, texto: buscaDiferida }), [filtros, buscaDiferida]);

  // ── ⭐ Los valores escritos a mano del resumen tampoco pasan de una unidad a otra ni
  //    sobreviven a un filtro (auditoría del lote 4, B1): son cifras de lo que se veía.
  //    Cambiar las hojas del corte limpia los del corte; cambiar los filtros o el buscador
  //    (el diferido: no por cada letra), los de los tres papeles. La forma se queda.
  const claveUnidadesEd = unidadesCorte.join('|');
  useEffect(() => {
    setEdiciones((prev) => edicionesAlCambiar(prev, 'unidades'));
  }, [claveUnidadesEd]);
  const claveFiltrosEd = firmaFiltros(filtros, buscaDiferida);
  useEffect(() => {
    setEdiciones((prev) => edicionesAlCambiar(prev, 'filtros'));
  }, [claveFiltrosEd]);
  const cuantosFiltros = (filtros.tipos?.length ?? 0) + (filtros.estados?.length ?? 0)
    + (papel === 'corte' ? 0 : filtros.unidadIds?.length ?? 0)
    + CAMPOS_TEXTO.reduce((s, c) => s + (filtros[c.key]?.length ?? 0), 0);

  // ── ⭐ El MODELO de la pantalla (lib → modelo, SIN el HTML; auditoría del lote 4, A2 = B4).
  //    Lo caro es el cuerpo HTML (el listado de un mes, más de medio segundo por tecla):
  //    acá no se arma. Y depende solo de lo que mueve el modelo (`claveDelModelo`): teclear
  //    un título, la emisión o una nota del resumen no lo rearma.
  const claveModelo = claveDelModelo(op);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const opModelo = useMemo(() => op, [papel, claveModelo]);
  // Los datos del Reporte completo para el modelo de la pantalla (los demás papeles no los usan).
  const completoModelo = useMemo(() => (esCompleto && datosCompleto ? { datos: datosCompleto, hoy: caracasBusinessToday() } : null), [esCompleto, datosCompleto]);
  const modelo = useMemo<PapelArmadoCop | null>(
    () => (rango ? armarPapelCop({ papel, sitio: sitio.nombre, base, rango, filtros: filtrosModelo, op: opModelo, edicion: null, unidadesCorte: hojas, completo: completoModelo }, { conCuerpo: false }) : null),
    [papel, sitio.nombre, base, rango, filtrosModelo, opModelo, hojas, completoModelo],
  );
  // El Reporte completo espera, además, SUS datos de ese rango (los textos y logos vienen de la carga de arriba).
  const listo = !!rango && !cargando && cargadoDe === `${rango.desde}|${rango.hasta}` && (!esCompleto || (!cargandoCompleto && completoDe === claveRango));
  const apagado = useMemo(() => apagadoEnPalabras(papel, op, filtrosConBusca, edicion), [papel, op, filtrosConBusca, edicion]);
  const nombreArchivo = rango && modelo ? nombreArchivoCop(papel, sitio.nombre, rango, op, filtrosDelPapel(papel, filtrosConBusca), modelo.nombresHojas) : '';
  const pendientesDeGuardar = useMemo(() => cambiosTextosFijos(papel, op, fijos), [papel, op, fijos]);
  // Las tarjetas (y su editor) solo si el papel las imprime: apagadas, o fuera por el filtro de tipo (B6).
  // El Reporte completo no tiene resumen editable.
  const conTarjetas = papel !== 'listado' && !esCompleto && !(opDelCuerpo(papel, op, filtrosConBusca).ocultosSecciones ?? []).includes('tarjetas');

  /** Los datos del Reporte completo para armar el papel EN EL TOQUE, con el «hoy» de ese instante
   *  y lo que leyó inspección AL EMITIR con su hora (M5; sin lectura, las vinculadas sin marca
   *  salen «Sin dato», nunca «Disponible»). */
  const datosDelCompleto = (lectura?: LecturaInspeccion | null): EntradaPapelCop['completo'] => (esCompleto && datosCompleto
    ? { datos: datosCompleto, hoy: caracasBusinessToday(), inspeccion: lectura?.inspeccion ?? null, emitidoMs: lectura?.ms ?? null }
    : null);

  // ── 🚜 M5: la hoja abierta del Reporte completo lee inspección UNA vez por carga (así la vista
  //    previa dice lo mismo que dirá el papel); el PDF vuelve a leer al tocarlo (estado al emitir). ──
  //    B14: con la sección 🚜 oculta la hoja ni espera ni avisa (lo oculto no se lee ni deja rastro, como el
  //    PDF); al volver a prenderla se lee entonces. La caché recuerda si se leyó con la sección oculta.
  const [inspHoja, setInspHoja] = useState<{ de: DatosDelCompleto; oculta: boolean; lectura: LecturaInspeccion } | null>(null);
  const maqOculta = (op.ocultosSecciones ?? []).includes('maquinaria');
  // B13: mientras el PDF lee inspección el botón lo dice; si no se pudo, el aviso queda fijo debajo (el toast
  // lo tapa la vista previa en web y la hoja de compartir en el teléfono).
  const [leyendoInspPdf, setLeyendoInspPdf] = useState(false);
  const [avisoInspPdf, setAvisoInspPdf] = useState<string | null>(null);

  /** El papel COMPLETO con lo de este instante (nunca un valor diferido) y una sola emisión. */
  const papelDeAhora = (): PapelArmadoCop | null =>
    rango ? armarPapelCop({ papel, sitio: sitio.nombre, base, rango, filtros: filtrosConBusca, op, edicion, unidadesCorte: hojas, ahora: nowStamp(), completo: datosDelCompleto(inspHoja?.lectura) }) : null;

  // ── La hoja real en el iframe (solo web, solo abierta): se arma ESPERA_HOJA_MS después
  //    de la última tecla. `useDeferredValue` no basta: armar el HTML es síncrono y trabaría igual.
  const [htmlPrevia, setHtmlPrevia] = useState('');
  const hojaPosible = verPrevia && Platform.OS === 'web' && listo && (papel !== 'corte' || hojas.length > 0);
  /** La hoja del Reporte completo espera lo leído de inspección de ESTA carga (o su error): vale la
   *  lectura que consultó, o la que no consultó porque la sección 🚜 estaba (y sigue) oculta. */
  const inspHojaVigente = !!datosCompleto && inspHoja?.de === datosCompleto && (inspHoja.lectura.consulto || inspHoja.oculta === maqOculta);
  const inspHojaLista = !esCompleto || inspHojaVigente;
  useEffect(() => {
    if (!hojaPosible || !esCompleto || !datosCompleto || inspHojaVigente) return;
    let vivo = true;
    const de = datosCompleto;
    const oculta = maqOculta;
    // UNA lectura por carga, y solo con la sección 🚜 visible (B14): con ella oculta no se consulta
    // nada, y al prenderla se lee entonces. Nunca lanza: si falla, la hoja sale con el aviso, como
    // saldría el papel.
    leerInspeccionAlEmitir({ unidades: de.unidades, ocultosSecciones: op.ocultosSecciones }, cargarEstadoInspeccion).then((lectura) => { if (vivo) setInspHoja({ de, oculta, lectura }); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hojaPosible, esCompleto, datosCompleto, inspHojaVigente, maqOculta]);
  useEffect(() => {
    if (!hojaPosible || !inspHojaLista) { setHtmlPrevia(''); return; }
    const t = setTimeout(() => { const p = papelDeAhora(); setHtmlPrevia(p ? htmlDelPapel(p, op) : ''); }, ESPERA_HOJA_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hojaPosible, inspHojaLista, papel, sitio.nombre, base, rango, filtrosConBusca, op, edicion, hojas, datosCompleto, inspHoja]);

  // ── 📄 PDF ──
  const bajarPdf = async () => {
    if (!rango) { toast.error(valida.errores[0] || 'Revisa el rango.'); return; }
    if (!listo) { toast.info('Espera a que terminen de cargar los registros del rango.'); return; }
    if (papel === 'corte' && !hojas.length) { toast.info('Elige al menos una unidad para el corte.'); return; }
    if (exportando) return;
    setExportando(true);
    setAvisoInspPdf(null);
    try {
      // 🚜 M5: el Reporte completo lee inspección AL EMITIR (solo si la sección 🚜 se ve y el
      //    sitio tiene vinculadas). ⭐ Si no se pudo, el papel sale IGUAL: aviso arriba y las
      //    vinculadas sin marca en «Sin dato» (nunca un estado supuesto). B13: el botón dice que
      //    está leyendo, y el aviso queda fijo debajo del botón además del toast.
      setLeyendoInspPdf(esCompleto);
      const lectura = esCompleto
        ? await leerInspeccionAlEmitir({ unidades: datosCompleto?.unidades ?? [], ocultosSecciones: op.ocultosSecciones }, cargarEstadoInspeccion)
        : null;
      setLeyendoInspPdf(false);
      if (lectura?.error) toast.info(`${lectura.error} El papel sale con lo marcado en el sitio.`, 6000);
      if (lectura?.error) setAvisoInspPdf(`${lectura.error} El papel salió con lo marcado en el sitio; vuelve a tocar 📄 PDF para intentarlo otra vez.`);
      // ⭐ Se arma EN EL TOQUE, completo y con lo de este instante (la última letra escrita
      //    entra), con UNA emisión: la misma en el membrete y en cada hoja del corte.
      const papelPdf = armarPapelCop({ papel, sitio: sitio.nombre, base, rango, filtros: filtrosConBusca, op, edicion, unidadesCorte: hojas, ahora: nowStamp(), completo: datosDelCompleto(lectura) });
      const html = htmlDelPapel(papelPdf, op);
      await exportPdf(html, nombreArchivoCop(papel, sitio.nombre, rango, op, filtrosDelPapel(papel, filtrosConBusca), papelPdf.nombresHojas));
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo armar el PDF.');
    } finally {
      setLeyendoInspPdf(false);
      setExportando(false);
    }
  };

  // ── 💾 Guardar como texto fijo (Full; la RLS también lo exige) ──
  const guardarTextosFijos = async () => {
    if (!levelMeets(nivel, 'full') || guardandoTextos) return;
    const cambios = cambiosTextosFijos(papel, op, fijos);
    if (!cambios.length) { toast.info('Los textos y los logos ya son los guardados.'); return; }
    setGuardandoTextos(true);
    const guardados: [string, unknown][] = [];
    try {
      for (const [clave, valor] of cambios) {
        await guardarAjuste(sitio.id, clave, valor);
        guardados.push([clave, valor]);
      }
      toast.success('Guardado como texto fijo del sitio.');
    } catch (e: any) {
      toast.error(e?.message || 'No se guardó: no tienes permiso o se perdió la conexión.');
    } finally {
      // Lo que sí se guardó pasa a ser lo fijo (aunque lo siguiente haya fallado) y, como es
      // del SITIO, se pone al día en los TRES papeles: así otro papel no lo revierte (A7 = B2).
      if (guardados.length) {
        const viejos = fijosRef.current;
        const nuevos = { ...viejos, ...Object.fromEntries(guardados) } as TextosCop;
        fijosRef.current = nuevos;
        setFijos(nuevos);
        setOpciones((prev) => porPapel((p) => rebasarTextosFijos(p, prev[p], viejos, nuevos)));
      }
      setGuardandoTextos(false);
    }
  };

  // ── Estilos ──
  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  const pastilla = (on: boolean) => ({
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1,
    borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface,
  });
  const textoPastilla = (on: boolean) => ({ color: on ? colors.brandContrast : colors.text, fontWeight: '700' as const, fontSize: 12 });
  const etiqueta = { color: colors.muted, fontSize: 11, fontWeight: '800' as const, marginTop: spacing.xs };
  const boton = (fondo: string) => ({ backgroundColor: fondo, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md });

  /** Una fila de pastillas de varios valores. Lo elegido que ya no está en el período se sigue mostrando, para poder quitarlo. */
  const filaChips = (opcionesFila: { clave: string; etiqueta: string }[], elegidos: string[] | undefined, onToggle: (clave: string) => void) => {
    const todas = [...opcionesFila];
    for (const e of elegidos ?? []) if (!todas.some((o) => o.clave === e)) todas.push({ clave: e, etiqueta: e });
    if (!todas.length) return <Text style={{ color: colors.muted, fontSize: 11 }}>Nada en este período.</Text>;
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 }}>
        {todas.map((o) => {
          const on = (elegidos ?? []).includes(o.clave);
          return (
            <TouchableOpacity key={o.clave} onPress={() => onToggle(o.clave)} style={pastilla(on)}>
              <Text style={textoPastilla(on)}>{o.etiqueta}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  /** Pastillas de una sola opción (orden, agrupación). */
  const unaDe = <T extends string>(valor: T, opcionesFila: [T, string][], onElegir: (v: T) => void) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 }}>
      {opcionesFila.map(([k, label]) => (
        <TouchableOpacity key={k} onPress={() => onElegir(k)} style={pastilla(valor === k)}>
          <Text style={textoPastilla(valor === k)}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const ayudaPapel = PAPELES_COP.find((p) => p.k === papel)?.ayuda ?? '';
  const tituloAuto = tituloCop(papel, { titulo: '' });
  const resumenVisto = modelo?.resumen ? aplicarEdicionResumen(modelo.resumen, hojas.length > 1 && papel === 'corte' ? { ...edicion, valores: {} } : edicion) : null;

  return (
    <View style={{ gap: spacing.sm }}>
      {/* ── EL PAPEL ── */}
      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {PAPELES_COP.map((p) => (
            <TouchableOpacity key={p.k} onPress={() => { setPapel(p.k); setVerPrevia(false); }} style={pastilla(papel === p.k)}>
              <Text style={textoPastilla(papel === p.k)}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>{ayudaPapel}</Text>
      </Card>

      {/* ── RANGO Y HORA DE CORTE ── */}
      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {([['hoy', 'Hoy'], ['semana', 'Esta semana'], ['mes', 'Este mes']] as [RangoRapido, string][]).map(([q, label]) => (
            <TouchableOpacity key={q} onPress={() => elegirRapido(q)} style={pastilla(rapido === q)}>
              <Text style={textoPastilla(rapido === q)}>{label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={actualizar} style={pastilla(false)}>
            <Text style={textoPastilla(false)}>🔄 Actualizar</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <View style={{ flex: 1, minWidth: 140 }}>
            <Text style={etiqueta}>DESDE</Text>
            <View style={{ marginTop: 4 }}><DateField value={fechas.desde} onChange={cambiarDesde} /></View>
          </View>
          <View style={{ flex: 1, minWidth: 140 }}>
            <Text style={etiqueta}>HASTA</Text>
            <View style={{ marginTop: 4 }}><DateField value={fechas.hasta} onChange={cambiarHasta} minISO={fechas.desde} /></View>
          </View>
          {/* El Reporte completo va por jornadas enteras: la hora de corte no aplica y no se muestra. */}
          {!esCompleto ? (
            <View style={{ flex: 1, minWidth: 120 }}>
              <Text style={etiqueta}>HORA DE CORTE (OPCIONAL)</Text>
              <TextInput
                value={corteTxt}
                onChangeText={setCorteTxt}
                placeholder="HH:MM, ej. 19:00"
                placeholderTextColor={colors.muted}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
                style={[input, { marginTop: 4 }]}
              />
            </View>
          ) : null}
        </View>
        <Text style={{ color: colors.muted, fontSize: 11 }}>
          {esCompleto
            ? 'Fechas de jornada: cada día va de 7am a 7am. El Reporte completo toma las jornadas enteras del rango.'
            : 'Fechas de jornada: cada día va de 7am a 7am. Con hora de corte, el último día se corta a esa hora (un renglón sin hora entra igual).'}
        </Text>
        {valida.errores.map((e) => (
          <Text key={e} style={{ color: colors.danger, fontSize: 12, fontWeight: '700' }}>⚠️ {e}</Text>
        ))}
        {valida.aviso ? <Text style={{ color: colors.warning, fontSize: 12, fontWeight: '700' }}>⏳ {valida.aviso}</Text> : null}
        {rango && avisoCorte(rango) ? <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>🕖 {avisoCorte(rango)}</Text> : null}
      </Card>

      {/* ── LAS UNIDADES DEL CORTE: una hoja cada una ── */}
      {papel === 'corte' ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '800' }}>🚛 Unidades del corte</Text>
          <Text style={{ color: colors.muted, fontSize: 11 }}>
            Elige una o varias: cada una sale en su hoja. «Las que trabajaron» son las que tienen viajes internos o salidas en el período; las demás (las que solo trajeron material o no trabajaron) salen con su nombre y en cero.
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 4 }}>
            <TouchableOpacity onPress={() => setUnidadesCorte(opsCorte.filter((o) => o.conRenglones).map((o) => o.clave))}>
              <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>Las que trabajaron ({opsCorte.filter((o) => o.conRenglones).length})</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setUnidadesCorte(opsCorte.map((o) => o.clave))}>
              <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>Todas ({opsCorte.length})</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setUnidadesCorte([])}>
              <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>Ninguna</Text>
            </TouchableOpacity>
          </View>
          {filaChips(
            opsCorte.map((o) => ({ clave: o.clave, etiqueta: `${o.etiqueta}${o.conRenglones ? '' : ' (sin viajes del corte)'}` })),
            hojas.map((h) => h.clave),
            (k) => setUnidadesCorte((l) => alternar(l, k)),
          )}
          <Text style={{ color: hojas.length ? colors.muted : colors.warning, fontSize: 12, marginTop: 4 }}>
            {hojas.length ? `${hojas.length} ${hojas.length === 1 ? 'hoja' : 'hojas'}` : 'Ninguna unidad elegida todavía.'}
          </Text>
        </Card>
      ) : null}

      {/* ── BUSCADOR Y FILTROS (el Reporte completo es todo el Parte diario: no filtra) ── */}
      {!esCompleto ? (
        <>
          <TextInput value={busca} onChangeText={setBusca} placeholder="🔎 Buscar unidad, placa, transportista, origen, destino, material u observación…" placeholderTextColor={colors.muted} style={input} />
          <Plegable titulo="🎛️ Filtros" resumen={cuantosFiltros ? `${cuantosFiltros} activo(s)` : 'Sin filtros'}>
            <Text style={etiqueta}>TIPO</Text>
            {filaChips(TIPOS_MOV.map((t) => ({ clave: t.key, etiqueta: `${t.ico} ${t.label}` })), filtros.tipos,
              (k) => setFiltros((f) => ({ ...f, tipos: alternar(f.tipos, k as TipoMov) })))}
            <Text style={etiqueta}>ESTADO</Text>
            {filaChips(ESTADOS_MOV.map((e) => ({ clave: e.key, etiqueta: `${e.ico} ${e.label}` })), filtros.estados,
              (k) => setFiltros((f) => ({ ...f, estados: alternar(f.estados, k as EstadoMov) })))}
            {papel !== 'corte' ? (
              <>
                <Text style={etiqueta}>UNIDAD</Text>
                {filaChips(opsUnidad, filtros.unidadIds, (k) => setFiltros((f) => ({ ...f, unidadIds: alternar(f.unidadIds, k) })))}
              </>
            ) : null}
            {CAMPOS_TEXTO.map((c) => (
              <View key={c.key}>
                <Text style={etiqueta}>{c.label.toUpperCase()}</Text>
                {filaChips(opsTexto[c.key].map((t) => ({ clave: t, etiqueta: t })), filtros[c.key],
                  (k) => setFiltros((f) => ({ ...f, [c.key]: alternar(f[c.key], k) })))}
              </View>
            ))}
            {cuantosFiltros ? (
              <TouchableOpacity onPress={() => setFiltros({})} style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}>
                <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12 }}>✕ Quitar los filtros</Text>
              </TouchableOpacity>
            ) : null}
          </Plegable>
        </>
      ) : null}

      {/* ── ¿QUÉ SE OCULTA? (y orden y agrupación) ── */}
      <Plegable titulo="🙈 ¿Qué se oculta?" resumen={(op.ocultosSecciones.length + op.ocultosColumnas.length) ? `${op.ocultosSecciones.length + op.ocultosColumnas.length} apagado(s)` : 'Todo a la vista'}>
        <Text style={{ color: colors.muted, fontSize: 10.5 }}>
          Lo apagado no sale en el papel ni deja rastro (ni su título). El nombre del archivo sí lo dice.
        </Text>
        {SECCIONES_COP[papel].length ? <Text style={etiqueta}>SECCIONES</Text> : null}
        {SECCIONES_COP[papel].map((s) => (
          <Toggle key={`s-${s.k}`} on={!op.ocultosSecciones.includes(s.k)} label={s.etiqueta} onPress={() => setOp((o) => alternarSeccion(o, s.k))} />
        ))}
        {COLUMNAS_COP[papel].length ? <Text style={etiqueta}>COLUMNAS</Text> : null}
        {COLUMNAS_COP[papel].map((c) => (
          <Toggle key={`c-${c.k}`} on={!op.ocultosColumnas.includes(c.k)} label={c.etiqueta} onPress={() => setOp((o) => alternarColumna(o, c.k))} />
        ))}
        {papel === 'corte' ? (
          <>
            <Text style={etiqueta}>DÍAS Y COLUMNAS DEL CORTE</Text>
            <Toggle
              on={op.diasSinAnotacion === 'cero'}
              label="Días sin anotación (en 0)"
              ayuda="Apagado, los días sin ningún renglón no salen (un renglón anotado en 0 sí sale)."
              onPress={() => setOp((o) => ({ ...o, diasSinAnotacion: o.diasSinAnotacion === 'cero' ? 'ocultar' : 'cero' }))}
            />
            <Toggle
              on={op.columnasPorDestino}
              label="Una columna por destino de salida"
              ayuda="Apagado, todas las salidas van en una sola columna «Salidas»."
              onPress={() => setOp((o) => ({ ...o, columnasPorDestino: !o.columnasPorDestino }))}
            />
          </>
        ) : null}
        {/* ORDEN solo donde actúa: el consolidado y el listado por unidad (A6). */}
        {ordenActua(papel, op) ? (
          <>
            <Text style={etiqueta}>ORDEN</Text>
            {unaDe(op.orden, [['cantidad', '📊 Más viajes primero'], ['az', '🔤 A→Z']], (v) => setOp((o) => ({ ...o, orden: v })))}
          </>
        ) : null}
        {papel === 'listado' ? (
          <>
            <Text style={etiqueta}>AGRUPAR POR</Text>
            {unaDe(op.agruparListado, [['dia', '📅 Día'], ['unidad', '🚛 Unidad'], ['tipo', '🔀 Tipo']], (v) => setOp((o) => ({ ...o, agruparListado: v })))}
          </>
        ) : null}
      </Plegable>

      {/* ── LOGOS DEL MEMBRETE ── */}
      <Plegable titulo="🏷️ Logos" resumen={LOGOS.filter((l) => op.logos[l.k]).map((l) => l.label.replace(/^\S+\s/, '')).join(', ') || 'Sin logos'}>
        {LOGOS.map((l) => (
          <Toggle key={l.k} on={!!op.logos[l.k]} label={l.label} onPress={() => setOp((o) => ({ ...o, logos: { ...o.logos, [l.k]: !o.logos[l.k] } }))} />
        ))}
      </Plegable>

      {/* ── TEXTOS DEL PAPEL ── */}
      <Plegable titulo="📝 Textos" resumen={pendientesDeGuardar.length ? 'Con cambios sin guardar como fijos' : 'Los fijos del sitio'}>
        <Text style={{ color: colors.muted, fontSize: 10.5 }}>
          Vienen de ⚙️ Ajustes del sitio. Lo que cambies acá vale para este papel; en blanco sale el automático.
        </Text>
        <Text style={etiqueta}>TÍTULO</Text>
        <TextInput value={op.titulo} onChangeText={(v) => setOp((o) => ({ ...o, titulo: v }))} placeholder={tituloAuto} placeholderTextColor={colors.muted} style={[input, { marginTop: 4 }]} />
        <Text style={etiqueta}>SUBTÍTULO</Text>
        <TextInput
          value={op.subtitulo}
          onChangeText={(v) => setOp((o) => ({ ...o, subtitulo: v }))}
          placeholder={rango ? `${sitio.nombre} · ${periodoCop(rango)}` : 'El sitio y el período'}
          placeholderTextColor={colors.muted}
          style={[input, { marginTop: 4 }]}
        />
        {papel === 'consolidado' ? (
          <>
            <Text style={etiqueta}>PRESENTACIÓN</Text>
            <TextInput
              value={op.presentacion}
              onChangeText={(v) => setOp((o) => ({ ...o, presentacion: v }))}
              placeholder="En blanco: un párrafo automático con el sitio y el corte."
              placeholderTextColor={colors.muted}
              multiline
              style={[input, { marginTop: 4, minHeight: 80, textAlignVertical: 'top' }]}
            />
          </>
        ) : null}
        {papel === 'corte' ? (
          <>
            <Text style={etiqueta}>CONSIDERACIONES</Text>
            <TextInput
              value={op.consideraciones}
              onChangeText={(v) => setOp((o) => ({ ...o, consideraciones: v }))}
              placeholder="En blanco no sale. Una línea en blanco separa párrafos."
              placeholderTextColor={colors.muted}
              multiline
              style={[input, { marginTop: 4, minHeight: 80, textAlignVertical: 'top' }]}
            />
          </>
        ) : null}
        <Text style={etiqueta}>FECHA DE EMISIÓN</Text>
        <TextInput value={op.emitida} onChangeText={(v) => setOp((o) => ({ ...o, emitida: v }))} placeholder="En blanco: la fecha y hora reales" placeholderTextColor={colors.muted} style={[input, { marginTop: 4 }]} />
        {esFull ? (
          <TouchableOpacity
            onPress={guardarTextosFijos}
            disabled={guardandoTextos || !pendientesDeGuardar.length}
            style={[boton(colors.primary), { alignSelf: 'flex-start', marginTop: spacing.sm, opacity: guardandoTextos || !pendientesDeGuardar.length ? 0.5 : 1 }]}
          >
            <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 13 }}>
              {guardandoTextos ? 'Guardando…' : '💾 Guardar como texto fijo'}
            </Text>
          </TouchableOpacity>
        ) : null}
        {esFull ? (
          <Text style={{ color: colors.muted, fontSize: 10.5, marginTop: 4 }}>
            {papel === 'listado' || esCompleto
              ? 'Guarda en los ajustes del sitio los logos (valen para todos los papeles del sitio); este papel no tiene título fijo. El título, el subtítulo y la emisión no se guardan.'
              : `Guarda en los ajustes del sitio el título${papel === 'consolidado' ? ', la presentación' : ', las consideraciones'} y los logos (valen para todos los papeles del sitio). El subtítulo y la emisión no se guardan.`}
          </Text>
        ) : null}
      </Plegable>

      {/* ── EL RESUMEN EJECUTIVO ── */}
      {conTarjetas ? (
        <EditorResumen resumen={modelo?.resumen ?? null} edicion={edicion} onChange={setEdicion} sinValores={papel === 'corte' && hojas.length > 1} />
      ) : null}

      {/* ── VISTA PREVIA (y el aviso de lo apagado: SOLO en pantalla) ── */}
      <Card>
        <Text style={{ color: colors.text, fontWeight: '800' }}>👁️ Vista previa</Text>
        {error ? <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>⚠️ {error}</Text> : null}
        {esCompleto && errorCompleto ? <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>⚠️ {errorCompleto}</Text> : null}
        {!rango ? (
          <Text style={{ color: colors.muted, fontSize: 12 }}>Corrige el rango para ver el papel.</Text>
        ) : !listo ? (
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            {cargando || (esCompleto && cargandoCompleto)
              ? (esCompleto ? 'Cargando el Parte diario del rango…' : 'Cargando los registros del rango…')
              : 'Sin los registros de este rango: toca 🔄 Actualizar para intentar de nuevo.'}
          </Text>
        ) : modelo ? (
          <>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700', marginTop: 4 }}>{op.titulo.trim() || tituloAuto}</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>{op.subtitulo.trim() || `${sitio.nombre} · ${periodoCop(rango)}`}</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
              {fmt(modelo.renglones)} {modelo.renglones === 1 ? 'renglón' : 'renglones'} {esCompleto ? 'del Parte diario en el período' : 'en el papel'}
              {papel === 'corte' ? ` · ${modelo.hojas} ${modelo.hojas === 1 ? 'hoja' : 'hojas'}` : ''}
              {!modelo.renglones && !esCompleto ? ' · saldrá «Sin registros en el período»' : ''}
            </Text>
            {/* El Reporte completo: sus secciones visibles, numeradas como en el papel. */}
            {esCompleto ? (
              <View style={{ marginTop: spacing.xs }}>
                <Text style={etiqueta}>SECCIONES DEL PAPEL</Text>
                {seccionesEnPantalla(modelo.completo, op).map((s) => (
                  <Text key={s.k} style={{ color: s.vacia ? colors.muted : colors.text, fontSize: 12 }}>
                    {s.vacia ? '○' : '●'} {s.n}. {s.etiqueta}{s.vacia ? ' · saldrá «Sin registros en el período»' : ''}
                  </Text>
                ))}
                {seccionesEnPantalla(modelo.completo, op).length ? null : (
                  <Text style={{ color: colors.warning, fontSize: 12 }}>Todas las secciones están apagadas: el papel saldrá solo con el membrete, el sitio y el período.</Text>
                )}
              </View>
            ) : null}
            {conTarjetas && resumenVisto?.tarjetas.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs }}>
                {resumenVisto.tarjetas.map((t) => (
                  <View key={t.k} style={{ flex: 1, minWidth: 110, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surface }}>
                    <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '800' }}>{t.titulo}</Text>
                    <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 16 }}>{t.valor}</Text>
                    {t.nota ? <Text style={{ color: colors.muted, fontSize: 10 }}>{t.nota}</Text> : null}
                  </View>
                ))}
              </View>
            ) : null}
            {papel === 'corte' && hojas.length > 1 ? (
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>Las tarjetas de arriba son de la primera hoja ({hojas[0].etiqueta}).</Text>
            ) : null}
            {(papel === 'listado' && op.agruparListado === 'unidad') && modelo.porUnidad.length ? (
              <View style={{ marginTop: spacing.xs }}>
                <Text style={etiqueta}>VIAJES POR UNIDAD (CONFIRMADOS)</Text>
                {modelo.porUnidad.slice(0, 8).map((f) => (
                  <Text key={f.clave} style={{ color: colors.text, fontSize: 12 }}>🚛 {f.clave}: {fmt(f.viajes)} viajes</Text>
                ))}
                {modelo.porUnidad.length > 8 ? <Text style={{ color: colors.muted, fontSize: 11 }}>… y {modelo.porUnidad.length - 8} más.</Text> : null}
              </View>
            ) : null}
          </>
        ) : null}

        {/* El aviso de lo apagado: en la pantalla, NUNCA en el papel. */}
        {apagado.length ? (
          <View style={{ marginTop: spacing.sm, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.warningSoftBorder, backgroundColor: colors.warningSoftBg }}>
            <Text style={{ color: colors.warningSoftText, fontWeight: '800', fontSize: 12 }}>🙈 Lo apagado no sale en el papel (ni se menciona):</Text>
            {apagado.map((a) => <Text key={a} style={{ color: colors.warningSoftText, fontSize: 12 }}>• {a}</Text>)}
          </View>
        ) : (
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>Nada apagado ni filtrado: el papel sale completo.</Text>
        )}
        {nombreArchivo ? <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>📄 Archivo: {nombreArchivo}.pdf</Text> : null}

        {Platform.OS === 'web' && listo && !!modelo && (papel !== 'corte' || hojas.length > 0) ? (
          <TouchableOpacity onPress={() => setVerPrevia((v) => !v)} style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}>
            <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12 }}>{verPrevia ? '✕ Esconder la hoja' : '👁️ Ver la hoja aquí'}</Text>
          </TouchableOpacity>
        ) : null}
        {hojaPosible && esCompleto && !inspHojaLista ? (
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>🔎 Leyendo el estado de inspección para la hoja…</Text>
        ) : null}
        {hojaPosible && esCompleto && inspHojaLista && !maqOculta && inspHoja?.lectura.error ? (
          <Text style={{ color: colors.warning, fontSize: 12, fontWeight: '700', marginTop: spacing.xs }}>
            ⚠️ {inspHoja.lectura.error} La hoja muestra lo marcado en el sitio; el PDF lo vuelve a intentar al emitir.
          </Text>
        ) : null}
        {htmlPrevia
          ? React.createElement('iframe' as any, {
            srcDoc: htmlPrevia,
            // Sin scripts y sin el origen de la app (B5): la hoja se pinta igual (CSS y
            // logos data:), y un escapado olvidado no correría con la sesión de quien mira.
            sandbox: '',
            title: 'Vista previa del papel',
            style: { width: '100%', height: 560, border: `1px solid ${colors.border}`, borderRadius: radius.md, background: '#fff', marginTop: spacing.sm },
          } as any)
          : null}
      </Card>

      {/* ── 📄 PDF ── */}
      <TouchableOpacity
        onPress={bajarPdf}
        disabled={exportando}
        style={[boton(colors.accent), { alignItems: 'center', paddingVertical: spacing.md, opacity: exportando || !listo || (papel === 'corte' && !hojas.length) ? 0.6 : 1 }]}
      >
        <Text style={{ color: colors.accentContrast, fontWeight: '900', fontSize: 15 }}>{exportando ? (leyendoInspPdf ? '🔎 Leyendo inspección…' : 'Armando el PDF…') : '📄 PDF'}</Text>
      </TouchableOpacity>
      {avisoInspPdf ? (
        <Text style={{ color: colors.warning, fontSize: 12, fontWeight: '700', marginTop: spacing.xs }}>⚠️ {avisoInspPdf}</Text>
      ) : null}
    </View>
  );
}

export default ReportesTab;
