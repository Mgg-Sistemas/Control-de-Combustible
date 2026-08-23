// VIAJES DE CAMIONES: bitácora de viajes de los camiones de volteo (filas de
// `machinery` con "Camion Volteo Toronto"/"Chuto con Volqueta"), registrada en
// campo por los LISTEROS. Pantalla dual, igual criterio que otras pantallas del
// sistema (p. ej. `ManguerasScreen`): el NIVEL de permiso del módulo decide qué
// se ve —
//   · escritura (o superior): vista del LISTERO — buscar camión, registrar un
//     viaje (con hora capturada en el teléfono, funciona offline) y ver/editar
//     (solo la HORA, solo dentro de su jornada actual) sus propios viajes de hoy.
//   · full: ADEMÁS (full incluye escritura) el panel de la JEFA/ADMIN — resumen
//     por camión/listero, alerta de camiones sin viaje reciente, lista completa
//     filtrable con edición/borrado, configuración de metas y umbral de alerta,
//     y exportar el reporte del rango filtrado.
// Pedido del cliente 12-ago-2026.
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, Modal, StyleSheet } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, Badge } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, AppColors } from '../theme';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { useConfirm } from '../components/ConfirmProvider';
import { useToast } from '../components/ToastProvider';
import { supabase, selectAllRows } from '../lib/supabase';
import { levelMeets } from '../lib/permissions';
import { norm, cmpText } from '../lib/text';
import { caracasParts } from '../lib/jornada';
import { caracasNowShift, caracasBusinessToday, jornadaWindowISO, jornadaDeFecha } from '../lib/caracasDay';
import { isVolteoVolqueta } from '../lib/equipos';
import {
  fetchAveriaCat,
  fetchJornadaCat,
  fetchInspByShift,
  makeLiveStatusOf,
  AveriaEntry,
  JornadaEntry,
  InspByShiftEntry,
} from '../lib/machineLiveStatus';
import { pdfDocument, exportPdf } from '../lib/pdf';
import { resumirViajes, SIN_EMPRESA, claveCamion, type EjeResumen } from '../lib/viajesResumen';
import { pasaFiltros, opcionesDeEje, marcadosFueraDelRango, etiquetaRangoViajes, type ClavesViaje, type SeleccionFiltros, type EjeFiltro } from '../lib/viajesFiltros';
import { turnoDeViaje, desacuerdoDeTurno, turnoLabel, turnoLabelConHorario, leyendaTurnos, TURNO_NOMBRE, contarTurnos, resumenTurno, perfilDeTurno, PERFIL_CORTO } from '../lib/viajesTurno';
import { isOnline, onConnectivityChange } from '../lib/offlineQueue';
import {
  CamionViajeRow,
  registrarViaje,
  listMisViajesHoy,
  listTodosLosViajes,
  editarHoraViaje,
  borrarViaje,
  getMetasPorCamion,
  setMetaCamion,
  getAlertaHoras,
  setAlertaHoras,
  resolveChoferActual,
} from '../lib/camionViajes';
import { QueuedViaje, QuarantinedViaje, subscribeViajesQueue, subscribeViajesQuarantine, enqueueViaje, flushViajesQueue, retryQuarantinedViajes, nuevoClientActionId, falloDeGuardadoLocal } from '../lib/viajesOfflineQueue';
import { accionTrasFalloConSenal, motivoLegible } from '../lib/colaOfflinePolicy';

// ── Fecha/hora en Caracas (mismas utilidades locales que otras pantallas de
//    reportes, p. ej. AuditScreen/CoordinadorOperadoresScreen) ──────────────
const CARACAS_TZ = 'America/Caracas';
function fmtHora(iso: string): string {
  return new Intl.DateTimeFormat('es-VE', { timeZone: CARACAS_TZ, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso));
}
function fmtFecha(iso: string): string {
  return new Intl.DateTimeFormat('es-VE', { timeZone: CARACAS_TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
}
function dmy(iso: string): string {
  const [y, m, d] = (iso || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}
function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const nd = new Date(Date.UTC(y, m - 1, d + n));
  const p = (x: number) => `${x}`.padStart(2, '0');
  return `${nd.getUTCFullYear()}-${p(nd.getUTCMonth() + 1)}-${p(nd.getUTCDate())}`;
}
function weekStartISO(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=domingo..6=sábado
  return addDaysISO(iso, dow === 0 ? -6 : -(dow - 1));
}
const pad2 = (n: number) => `${n}`.padStart(2, '0');

/** Ventana [inicio,fin) de la jornada ACTUAL (día 07:00–19:00 · noche 19:00–07:00
 *  del día siguiente), mismo criterio 7am/7pm ya usado en toda la app (ver
 *  `caracasNowShift`/`caracasBusinessToday` en `src/lib/caracasDay.ts` y
 *  `horarioNominal` en `src/lib/jornada.ts`) — para decidir si un viaje del
 *  listero todavía se puede corregir ("editar hora") o ya quedó en el pasado. */
function currentJornadaWindow(): { startMs: number; endMs: number } {
  const bDay = caracasBusinessToday();
  const shift = caracasNowShift();
  if (shift === 'day') {
    return { startMs: new Date(`${bDay}T07:00:00-04:00`).getTime(), endMs: new Date(`${bDay}T19:00:00-04:00`).getTime() };
  }
  const nextDay = addDaysISO(bDay, 1);
  return { startMs: new Date(`${bDay}T19:00:00-04:00`).getTime(), endMs: new Date(`${nextDay}T07:00:00-04:00`).getTime() };
}

// ── Camión (fila de `machinery`, filtrada a volteos/volquetas) ─────────────
type TruckRow = {
  id: string;
  code: string;
  plate: string | null;
  serial: string | null;
  clasificacion: string | null;
  marca: string | null;
  modelo: string | null;
  companyId: string | null;
  companyName: string;
  operational: boolean;
  enEspera: boolean;
};

// Mismos 5 estados EXCLUYENTES que el selector de "máquina suelta" de
// UsersScreen (ver `EstadoConteo`/`ESTADO_CONTEO_META` ahí) — se reproducen acá
// tal cual para dar la MISMA experiencia visual en el buscador de camión.
type EstadoConteo = 'operativa' | 'averiada' | 'parada' | 'retirada' | 'espera';
const ESTADO_CONTEO_ORDER: EstadoConteo[] = ['operativa', 'averiada', 'parada', 'retirada', 'espera'];
// Estados "adversos": disparan el aviso no bloqueante al registrar un viaje Y
// se EXCLUYEN de la alerta de "camión sin viaje" (legítimamente no viajan).
// 'espera' entró el 18-ago-2026: una máquina EN ESPERA DE INSTRUCCIONES está
// congelada por completo (no se le inicia jornada ni se le surte), así que
// legítimamente no viaja — reclamarle "sin viaje reciente" a la jefa era ruido.
// En el registro sirve de red: el listero ya no puede escogerla (ver
// `trucksSeleccionables`), pero si se congela DESPUÉS de seleccionarla, pide
// confirmación en vez de registrar el viaje en silencio.
const ESTADO_ADVERSO: EstadoConteo[] = ['averiada', 'parada', 'retirada', 'espera'];

type Preset = 'hoy' | 'semana' | 'mes' | 'rango' | 'dias';

// `queued` = guardado en el teléfono, esperando señal (normal, ámbar).
// `stuck`  = APARTADO: no pudo subirse por un error que no se resuelve solo
//            (camión borrado, dato inválido). Rojo + motivo — necesita que
//            alguien actúe, ver `src/lib/colaOfflinePolicy.ts`.
type DisplayViaje = CamionViajeRow & { queued?: boolean; stuck?: boolean; stuckError?: string };

/** Id CENTINELA del camión que el listero anota a mano por no estar en el
 *  catálogo. No es un uuid ni existe en `machinery`: solo sirve para que el
 *  flujo de la pantalla sea el mismo. Al guardar se manda `machinery_id = null`. */
const FUERA_CATALOGO_ID = '__fuera_catalogo__';

export default function ViajesCamionesScreen() {
  const { colors } = useTheme();
  const { session, fullName, moduleLevel } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const uid = session?.user?.id ?? '';
  const listeroName = fullName || 'Usuario';

  const level = moduleLevel('viajes_camiones');

  const ESTADO_CONTEO_META: Record<EstadoConteo, { label: string; icon: string; color: string }> = {
    operativa: { label: 'Operativa', icon: '✅', color: colors.success },
    averiada: { label: 'Averiada', icon: '🔴', color: colors.danger },
    parada: { label: 'Parada', icon: '🟡', color: colors.warning },
    retirada: { label: 'Retirada', icon: '⬛', color: colors.muted },
    espera: { label: 'Esperando instrucciones', icon: '⏳', color: colors.warning },
  };

  const canWrite = levelMeets(level, 'escritura');
  const canFull = levelMeets(level, 'full');

  // ── Camiones + estatus EN VIVO (compartido por el buscador del listero y el
  //    panel de la jefa: alerta y resumen). Mismas queries que Catálogo, ver
  //    src/lib/machineLiveStatus.ts — no se reimplementa la clasificación. ──
  const [trucksLoading, setTrucksLoading] = useState(true);
  const [allTrucks, setAllTrucks] = useState<TruckRow[]>([]);
  // Catálogo COMPLETO (todas las máquinas activas), no solo las que el código
  // delata como camión. Sirve para que el listero pueda encontrar un camión que
  // SÍ existe en el catálogo pero no entró a su lista. Ver `loadTrucks`.
  const [catalogoTrucks, setCatalogoTrucks] = useState<TruckRow[]>([]);
  // Máquinas del catálogo que el listero SUMÓ A SU LISTA desde el buscador.
  // Solo viven en esta pantalla: no se escribe nada en `machinery`.
  const [extraTruckIds, setExtraTruckIds] = useState<Set<string>>(new Set());
  const [averiaCat, setAveriaCat] = useState<Record<string, AveriaEntry>>({});
  const [jornadaCat, setJornadaCat] = useState<Record<string, JornadaEntry>>({});
  const [inspByShift, setInspByShift] = useState<Record<string, InspByShiftEntry>>({});
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  const estadoOf = useMemo(
    () => makeLiveStatusOf({ jornadaCat, averiaCat, inspByShift, retiredIds: new Set(), nowTick }),
    [jornadaCat, averiaCat, inspByShift, nowTick]
  );
  const truckEstadoConteo = (t: TruckRow): EstadoConteo => {
    if (!t.operational) return 'retirada';
    if (t.enEspera) return 'espera';
    const live = estadoOf(t.id).estado;
    if (live === 'averiada') return 'averiada';
    if (live === 'parada') return 'parada';
    return 'operativa';
  };

  const loadTrucks = async () => {
    setTrucksLoading(true);
    // ⚠️ `selectAllRows` y no un `.select()` pelado: PostgREST corta la
    //    respuesta en su tope de filas y lo hace SIN AVISAR — no llega un error,
    //    llega una página. Un catálogo que pase ese tope dejaría camiones reales
    //    fuera de la lista del listero y fuera de la alerta de «camión sin
    //    viajes», que es justo lo contrario de lo que la alerta promete. El
    //    resto de las pantallas que leen `machinery` ya lo hacen así
    //    (ReportsScreen, InspectionsSummary, HistoricoJornadas…). El orden por
    //    código se hace acá abajo con `cmpText`, porque `selectAllRows` pagina
    //    por id y no admite un `.order()` propio.
    const [cat, aCat, jCat, iShift] = await Promise.all([
      selectAllRows('machinery', 'id, code, plate, serial, clasificacion, marca, modelo, company_id, operational, en_espera, company:company_id(name)', (q: any) => q.eq('active', true))
        .then((rows: any[]) => ({ rows, error: null as string | null }))
        .catch((e: any) => ({ rows: [] as any[], error: String(e?.message ?? e) })),
      fetchAveriaCat(),
      fetchJornadaCat(),
      fetchInspByShift(),
    ]);
    const data = cat.rows;
    const error = cat.error ? { message: cat.error } : null;
    setTrucksLoading(false);
    if (error) { toast.error(error.message); return; }
    setAveriaCat(aCat);
    setJornadaCat(jCat);
    setInspByShift(iShift);
    // ⭐ SE GUARDA EL CATÁLOGO COMPLETO, no solo lo que parece camión.
    //
    // La lista del listero se arma con `isVolteoVolqueta(code)`, o sea mirando si
    // el CÓDIGO dice "volteo", "volqueta" o "toronto". Eso deja fuera a cualquier
    // camión real cuyo código no tenga esas palabras, y el listero no tiene manera
    // de encontrarlo aunque esté cargado en el catálogo. Es la causa del pedido
    // del cliente (21-ago-2026): «si una de las máquinas que registra no la tiene
    // en la lista pero SÍ existe en el catálogo, que se agregue a la lista».
    //
    // Se conserva el catálogo entero para poder ofrecérselo en el buscador; la
    // lista de siempre NO cambia (ver `trucksSeleccionables` y `pickExtras`).
    const catalogo = ((data ?? []) as any[]).map((m) => ({
      id: m.id as string,
      code: m.code ?? '—',
      plate: m.plate ?? null,
      serial: m.serial ?? null,
      clasificacion: m.clasificacion ?? null,
      marca: m.marca ?? null,
      modelo: m.modelo ?? null,
      companyId: m.company_id ?? null,
      companyName: m.company?.name ?? 'Sin empresa',
      operational: m.operational !== false,
      enEspera: !!m.en_espera,
    })) as TruckRow[];
    setCatalogoTrucks([...catalogo].sort((a, b) => cmpText(a.code, b.code)));
    setAllTrucks(
      ((data ?? []) as any[])
        .filter((m) => isVolteoVolqueta(m.code || ''))
        .map((m) => ({
          id: m.id as string,
          code: m.code ?? '—',
          plate: m.plate ?? null,
          serial: m.serial ?? null,
          clasificacion: m.clasificacion ?? null,
          marca: m.marca ?? null,
          modelo: m.modelo ?? null,
          companyId: m.company_id ?? null,
          companyName: m.company?.name ?? 'Sin empresa',
          operational: m.operational !== false,
          enEspera: !!m.en_espera,
        }))
        .sort((a, b) => cmpText(a.code, b.code))
    );
  };
  // Muchos camiones comparten el mismo "code" (ej. "Camion Volteo Toronto"
  // repetido en casi toda la flota) — la placa/serial es lo que en la práctica
  // distingue uno de otro, así que se resuelve acá para mostrarla donde falte.
  const truckById = useMemo(() => new Map(allTrucks.map((t) => [t.id, t])), [allTrucks]);

  // ── Vista LISTERO: buscador de camión ───────────────────────────────────
  const [pickOpen, setPickOpen] = useState(false);
  const [pickQuery, setPickQuery] = useState('');
  const [pickEstadoSel, setPickEstadoSel] = useState<Set<EstadoConteo>>(new Set());
  const togglePickEstado = (e: EstadoConteo) =>
    setPickEstadoSel((prev) => { const n = new Set(prev); n.has(e) ? n.delete(e) : n.add(e); return n; });
  // Camiones que se pueden ESCOGER para registrar un viaje (pedido del cliente,
  // 18-ago-2026: "que no le salgan las retiradas a los listeros, ni las que
  // están en espera de instrucciones"). Se sacan dos grupos:
  //
  //   · RETIRADAS → `operational === false`. En este sistema RETIRADA (fuera de
  //     servicio) ES `operational = false`; `active = false` es otra cosa:
  //     ELIMINADA del catálogo, y esa la consulta ya no la trae. No hay un tercer
  //     nivel de retiro. (Antes acá había un comentario que decía lo contrario y
  //     confundía; ver `supabase/averiadas_mal_retiradas.sql` y
  //     `src/lib/auditMachineState.ts`, que son la verdad sobre estos nombres.)
  //   · EN ESPERA → `en_espera === true`. Una máquina en espera está congelada
  //     por completo: no se le inicia jornada ni se le surte. Mal podría hacer
  //     viajes, y tenerla en la lista solo se presta a registrar un viaje contra
  //     el camión equivocado.
  //
  // Se filtra acá y no en la consulta a propósito: `allTrucks` lo siguen usando
  // los paneles de la jefa (resumen, meta, alertas — todo detrás de `canFull`),
  // que sí necesitan ver la flota completa.
  //
  // A la lista de siempre se le suman las máquinas que el listero AGREGÓ desde el
  // buscador (`extraTruckIds`): existen en el catálogo pero su código no dice
  // "volteo"/"volqueta"/"toronto", así que nunca habrían entrado. Agregarlas NO
  // escribe nada en `machinery` — es una lista de esta pantalla y nada más.
  const trucksSeleccionables = useMemo(() => {
    const base = allTrucks.filter((t) => t.operational && !t.enEspera);
    if (extraTruckIds.size === 0) return base;
    const yaEstan = new Set(base.map((t) => t.id));
    const sumadas = catalogoTrucks.filter(
      (t) => extraTruckIds.has(t.id) && !yaEstan.has(t.id) && t.operational && !t.enEspera
    );
    return [...base, ...sumadas].sort((a, b) => cmpText(a.code, b.code));
  }, [allTrucks, catalogoTrucks, extraTruckIds]);
  const pickEstadoOptions = useMemo(() => {
    const counts: Record<EstadoConteo, number> = { operativa: 0, averiada: 0, parada: 0, retirada: 0, espera: 0 };
    // Cuenta sobre la MISMA lista que se va a mostrar: si contara sobre
    // `allTrucks` saldría un chip "retirada 3" que al tocarlo no muestra nada.
    trucksSeleccionables.forEach((t) => { counts[truckEstadoConteo(t)] += 1; });
    return ESTADO_CONTEO_ORDER.map((key) => ({ key, count: counts[key] })).filter((o) => o.count > 0);
  }, [trucksSeleccionables, estadoOf]);
  const nqPick = norm(pickQuery.trim());
  const pickFiltered = trucksSeleccionables.filter(
    (t) =>
      (pickEstadoSel.size === 0 || pickEstadoSel.has(truckEstadoConteo(t))) &&
      (!nqPick || [t.code, t.clasificacion, t.marca, t.modelo, t.plate, t.serial, t.companyName].some((f) => f != null && norm(String(f)).includes(nqPick)))
  );

  // ⭐ SEGUNDO GRUPO del buscador: máquinas que SÍ están en el catálogo pero NO
  // en la lista del listero (su código no dice volteo/volqueta/toronto). Solo
  // salen cuando se escribe algo — si salieran siempre, la lista se llenaría de
  // excavadoras y payloaders y el listero no encontraría sus camiones.
  //
  // Las retiradas y las que están en espera quedan fuera acá también: el pedido
  // de no mostrárselas al listero vale igual por esta vía.
  const pickExtras = useMemo(() => {
    if (!nqPick) return [] as TruckRow[];
    const yaOfrecidas = new Set(trucksSeleccionables.map((t) => t.id));
    return catalogoTrucks
      .filter(
        (t) =>
          !yaOfrecidas.has(t.id) &&
          t.operational && !t.enEspera &&
          [t.code, t.clasificacion, t.marca, t.modelo, t.plate, t.serial, t.companyName]
            .some((f) => f != null && norm(String(f)).includes(nqPick))
      )
      .sort((a, b) => cmpText(a.code, b.code))
      .slice(0, 30);
  }, [nqPick, catalogoTrucks, trucksSeleccionables]);

  const [selectedTruck, setSelectedTruck] = useState<TruckRow | null>(null);
  const [selectedShift, setSelectedShift] = useState<'day' | 'night'>('day');
  const [selectedChofer, setSelectedChofer] = useState<string | null>(null);
  const [choferLoading, setChoferLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  /** Guard del doble toque. En un ref porque el state no cambia hasta el próximo
   *  render y dos toques del mismo frame pasarían los dos. */
  const registeringRef = useRef(false);
  const retryingRef = useRef(false);

  const openPicker = () => {
    setPickQuery('');
    setPickEstadoSel(new Set());
    setPickOpen(true);
  };
  const onSelectTruck = async (t: TruckRow) => {
    setPickOpen(false);
    setSelectedTruck(t);
    setSelectedChofer(null);
    const shift = caracasNowShift();
    setSelectedShift(shift);
    // Un camión fuera de catálogo no tiene ficha ni chofer asignado que consultar:
    // `machine_operators` va contra un `machinery_id` que no existe.
    if (t.id === FUERA_CATALOGO_ID) return;
    setChoferLoading(true);
    const chofer = await resolveChoferActual(t.id, shift);
    setChoferLoading(false);
    setSelectedChofer(chofer);
  };

  // ── CAMIÓN QUE NO ESTÁ EN EL CATÁLOGO ───────────────────────────────────
  // El listero lo anota a mano y queda SOLO en la fila de este viaje. No se crea
  // nada en `machinery`, así que no aparece en Control de Maquinaria, ni en
  // Mantenimiento, ni en los reportes de flota, ni le llega a los inspectores.
  // Pedido del cliente (21-ago-2026). Ver supabase/viajes_camion_fuera_catalogo.sql.
  const [fcOpen, setFcOpen] = useState(false);
  const [fcCode, setFcCode] = useState('');
  const [fcRef, setFcRef] = useState('');
  const abrirFueraCatalogo = (semilla: string) => {
    // Lo que ya escribió en el buscador se aprovecha como nombre: si tecleó
    // "VOLTEO 88" y no salió nada, no tiene por qué escribirlo dos veces.
    setFcCode(semilla);
    setFcRef('');
    setFcOpen(true);
  };
  const confirmarFueraCatalogo = () => {
    const code = fcCode.trim().toUpperCase();
    if (!code) { toast.error('Escribe al menos cómo identificar el camión.'); return; }
    setFcOpen(false);
    // Se arma un camión "de mentira" con el id centinela para que el resto de la
    // pantalla (el resumen de arriba, el botón de registrar) funcione igual sin
    // tener que duplicar el flujo. Al guardar, `machineryId` se manda en null.
    setSelectedTruck({
      id: FUERA_CATALOGO_ID,
      code,
      plate: null, serial: null, clasificacion: null, marca: null, modelo: null,
      companyId: null, companyName: 'Fuera de catálogo',
      operational: true, enEspera: false,
    });
    setSelectedChofer(null);
    setSelectedShift(caracasNowShift());
  };

  // ── Mis viajes de hoy ────────────────────────────────────────────────────
  const [misViajes, setMisViajes] = useState<CamionViajeRow[]>([]);
  const [misViajesMissing, setMisViajesMissing] = useState(false);
  /** El último error de lectura. Se muestra en vez de mentir con "no hay viajes". */
  const [misViajesError, setMisViajesError] = useState<string | null>(null);
  const [misViajesLoading, setMisViajesLoading] = useState(true);
  const loadMisViajes = async () => {
    if (!uid) { setMisViajesLoading(false); return; }  // si no, la caja gira para siempre
    // Solo se muestra el "cargando" cuando NO hay nada que enseñar. El realtime
    // lo dispara el INSERT de CUALQUIER listero de la flota, y poner la caja en
    // blanco en cada uno hacía desaparecer la lista (y las casillas de edición,
    // si estaba corrigiendo una hora) cada pocos segundos.
    setMisViajesLoading((prev) => prev || misViajes.length === 0);
    // ⭐ La JORNADA en curso (7am→7am), NO el día de calendario. Cortar a
    //    medianoche partía la noche del listero en dos fechas y le hacía creer
    //    que le faltaban viajes. Ver `jornadaWindowISO`.
    const { desdeISO, hastaExclusivoISO } = jornadaWindowISO(caracasBusinessToday());
    const { rows, missing, error } = await listMisViajesHoy(uid, desdeISO, hastaExclusivoISO);
    setMisViajesLoading(false);
    setMisViajesMissing(missing);
    setMisViajesError(error ?? null);
    // ⚠️ Ante un error NO se vacía la lista: dejarla en blanco le decía al
    // listero «no registraste nada» y lo empujaba a registrar todo otra vez.
    if (!error) setMisViajes(rows);
  };

  // ── Cola offline: mismo tratamiento visual (insignia ámbar) que la del
  //    Inspector en SupervisorScreen — reintenta sola al recuperar señal. ──
  const [queuedItems, setQueuedItems] = useState<QueuedViaje[]>([]);
  // APARTADOS: los que fallaron por algo que no se arregla solo. Van aparte para
  // que un viaje roto no siga contando como "se sube solo" cuando no es cierto.
  const [stuckItems, setStuckItems] = useState<QuarantinedViaje[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [falloGuardado, setFalloGuardado] = useState<string | null>(null);
  useEffect(() => {
    if (!canWrite) return;
    // El aviso de "no se pudo guardar en el teléfono" tiene que quedarse EN
    // PANTALLA: un toast se va a los 3 segundos y el listero no puede saber que
    // no debe cerrar la app. Se revisa en cada cambio de la cola, que es cuando
    // puede haber fallado una escritura.
    const unsub = subscribeViajesQueue((items) => { setQueuedItems(items); setFalloGuardado(falloDeGuardadoLocal()); });
    const unsubQ = subscribeViajesQuarantine((items) => setStuckItems(items));
    const tryFlush = () => {
      flushViajesQueue()
        .then((r) => { if (r.synced > 0) loadMisViajes(); })
        .catch(() => {});
    };
    tryFlush();
    const unsubConn = onConnectivityChange((online) => { if (online) tryFlush(); });
    const poll = setInterval(tryFlush, 30000);
    return () => { unsub(); unsubQ(); unsubConn(); clearInterval(poll); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWrite, uid]);

  // Reintento manual de los apartados (una vez resuelta la causa). Conservan su
  // `client_action_id`, así que reintentar NUNCA duplica un viaje ya insertado.
  const reintentarApartados = async () => {
    // Mismo motivo que `registeringRef`: el state no cambia hasta el próximo
    // render y dos toques del mismo frame pasarían los dos.
    if (retryingRef.current) return;
    retryingRef.current = true;
    setRetrying(true);
    try {
      const r = await retryQuarantinedViajes();
      if (r.synced > 0) loadMisViajes();
      // ⚠️ `quarantined === 0` NO significa que se subieran. Si el reintento
      //    vuelve a fallar por falta de señal, el viaje regresa a la COLA sin
      //    pasar por cuarentena — y antes eso sacaba un toast verde de éxito
      //    sin haber subido nada. Lo que manda es `synced`.
      if (r.synced > 0) toast.success(`${r.synced} viaje(s) subido(s).`);
      else if (r.quarantined > 0) toast.error(`Siguen sin poder subirse ${r.quarantined} viaje(s). Avisa al administrador.`);
      else if (r.remaining > 0) toast.info(`Quedaron ${r.remaining} viaje(s) esperando señal. Se suben solos.`);
      else toast.success('Listo, no quedan viajes apartados.');
    } catch {
      toast.error('No se pudo reintentar. Revisa la conexión.');
    } finally {
      retryingRef.current = false;
      setRetrying(false);
    }
  };

  const misViajesDisplay: DisplayViaje[] = useMemo(() => {
    // ⭐ Un viaje recién subido llega por realtime ANTES de que el flush reescriba
    //    la cola (solo lo hace al final de la pasada). Sin esta lista, el mismo
    //    viaje se pintaba DOS VECES —y el contador del título mentiría—
    //    durante todos los segundos que dure la subida.
    const yaEnServidor = new Set(misViajes.map((r) => r.clientActionId).filter(Boolean) as string[]);
    // El `!q.payload.listeroId` cubre los viajes encolados por el código viejo,
    // cuando todavía se podía encolar sin sesión lista: sin eso quedaban
    // INVISIBLES en la lista aunque siguieran contando en la insignia.
    const mio = (q: { payload: { listeroId: string } }) => !uid || !q.payload.listeroId || q.payload.listeroId === uid;
    const queuedRows: DisplayViaje[] = queuedItems.filter((q) => mio(q) && !yaEnServidor.has(q.id)).map((q) => ({
      id: `queued-${q.id}`,
      clientActionId: q.id,
      machineryId: q.payload.machineryId,
      machineCode: q.payload.machineCode,
      fueraCatalogo: q.payload.fueraCatalogo === true,
      camionRef: q.payload.camionRef ?? null,
      listeroId: q.payload.listeroId,
      listeroName: q.payload.listeroName,
      choferName: q.payload.choferName,
      shift: q.payload.shift,
      estadoMaquina: q.payload.estadoMaquina,
      note: q.payload.note ?? null,
      registeredAt: q.payload.registeredAt,
      queued: true,
    }));
    // Los APARTADOS también se listan: si no aparecieran, el viaje simplemente
    // se esfumaría de la pantalla del listero y él lo daría por registrado.
    const stuckRows: DisplayViaje[] = stuckItems.filter((q) => mio(q) && !yaEnServidor.has(q.id)).map((q) => ({
      id: `stuck-${q.id}`,
      clientActionId: q.id,
      machineryId: q.payload.machineryId,
      machineCode: q.payload.machineCode,
      fueraCatalogo: q.payload.fueraCatalogo === true,
      camionRef: q.payload.camionRef ?? null,
      listeroId: q.payload.listeroId,
      listeroName: q.payload.listeroName,
      choferName: q.payload.choferName,
      shift: q.payload.shift,
      estadoMaquina: q.payload.estadoMaquina,
      note: q.payload.note ?? null,
      registeredAt: q.payload.registeredAt,
      queued: true,
      stuck: true,
      stuckError: q.error,
    }));
    const synced: DisplayViaje[] = misViajes.map((r) => ({ ...r, queued: false }));
    return [...stuckRows, ...queuedRows, ...synced].sort((a, b) => (a.registeredAt < b.registeredAt ? 1 : -1));
  }, [queuedItems, stuckItems, misViajes, uid]);

  /** Cuántos de los que se ven todavía NO están en el servidor (en cola o apartados). */
  const sinSubirEnPantalla = useMemo(() => misViajesDisplay.filter((r) => r.queued).length, [misViajesDisplay]);
  // ⚠️ Las insignias usan estos contadores, NO `queuedItems.length` crudo. Los
  //    crudos incluyen viajes que ya llegaron al servidor y todavía no salieron
  //    de la cola, así que la insignia decía «1 sin subir» mientras el título de
  //    la lista ya no lo contaba — la misma contradicción que el contador vino a
  //    eliminar.
  const pendientesVisibles = useMemo(() => misViajesDisplay.filter((r) => r.queued && !r.stuck).length, [misViajesDisplay]);
  const apartadosVisibles = useMemo(() => misViajesDisplay.filter((r) => r.stuck).length, [misViajesDisplay]);
  // Los viajes en cola NO se filtran por fecha a propósito: esconder uno de
  // anteanoche sería peor (el listero lo daría por perdido). Pero entonces el
  // rótulo "de hoy" mentiría, así que se avisa en el propio título.
  const hayDeOtrosDias = useMemo(
    () => { const hoy = caracasBusinessToday(); return misViajesDisplay.some((r) => jornadaDeFecha(new Date(r.registeredAt)) !== hoy); },
    [misViajesDisplay]);

  /**
   * Guarda el viaje en el teléfono y avisa DICIENDO LA VERDAD sobre si llegó a
   * grabarse. Antes se anunciaba «quedó guardado» sin comprobarlo: si el
   * almacenamiento fallaba, el viaje se veía en pantalla (estaba en memoria) y
   * desaparecía al cerrar la app.
   */
  const guardarEnCola = async (payload: any, clientActionId: string, msgOk: string) => {
    const { ok } = await enqueueViaje(payload, clientActionId);
    if (ok) { toast.info(msgOk); return; }
    toast.error('⚠️ El viaje se ve en pantalla pero NO se pudo guardar en el teléfono. NO cierres la aplicación hasta que suba.');
  };

  const doRegistrarViaje = async () => {
    // El guard va en un REF, no en el state: dos toques dentro del mismo frame
    // leen el mismo `registering` del cierre y los dos pasan. Y se toma ANTES
    // del `confirm`, que es donde estaba la ventana ancha de verdad — mientras
    // el modal se monta, el botón seguía habilitado.
    if (!selectedTruck || registeringRef.current) return;
    registeringRef.current = true;
    setRegistering(true);
    try {
      if (!uid) { toast.error('Tu sesión todavía no está lista. Espera unos segundos y vuelve a intentar.'); return; }
      const estadoConteo = truckEstadoConteo(selectedTruck);
      if (ESTADO_ADVERSO.includes(estadoConteo)) {
        const meta = ESTADO_CONTEO_META[estadoConteo];
        const ok = await confirm(`Este camión figura ${meta.label.toUpperCase()}, ¿de todas formas quieres registrar el viaje?`);
        if (!ok) return;
      }
      const registeredAt = new Date().toISOString(); // capturado AHORA, en el teléfono (necesario offline)
      const shift = caracasNowShift();
      const esFuera = selectedTruck.id === FUERA_CATALOGO_ID;
      let chofer = selectedChofer;
      if (!esFuera && shift !== selectedShift) chofer = await resolveChoferActual(selectedTruck.id, shift);
      const payload = {
        // ⭐ Fuera de catálogo: SIN id de máquina. Ese es todo el punto — el camión
        // existe únicamente como texto en esta fila. La BD lo exige con el CHECK
        // `cv_fuera_catalogo_coherente`.
        machineryId: esFuera ? null : selectedTruck.id,
        machineCode: selectedTruck.code,
        fueraCatalogo: esFuera,
        camionRef: esFuera ? (fcRef.trim() || null) : null,
        listeroId: uid,
        listeroName,
        choferName: chofer,
        shift,
        estadoMaquina: estadoConteo,
        note: null as string | null,
        registeredAt,
      };

      // ⭐ UNA sola clave para el intento con señal Y para todos sus reintentos
      //    desde la cola. Sin esto, encolar tras un fallo duplicaría el viaje
      //    cuando el insert sí entró y se perdió la respuesta.
      const clientActionId = nuevoClientActionId();

      if (!isOnline()) {
        await guardarEnCola(payload, clientActionId,
          'Sin señal: el viaje quedó guardado en el teléfono y se sube solo al recuperar conexión.');
        return;
      }

      const { error } = await registrarViaje({ ...payload, clientActionId });
      if (!error) {
        toast.success(`Viaje de ${selectedTruck.code} registrado.`);
        loadMisViajes();
        return;
      }

      // ⭐ DE ACÁ PARA ABAJO EL VIAJE NO SE DESCARTA NUNCA.
      //
      // El duplicado es la ÚNICA salida sin cola, y significa que el insert ya
      // entró y se perdió la respuesta: encolarlo sí lo duplicaría de verdad.
      if (accionTrasFalloConSenal(error) === 'ya_estaba') {
        toast.success(`Viaje de ${selectedTruck.code} registrado.`);
        loadMisViajes();
        return;
      }

      // Todo lo demás va a la cola, incluso un error de datos. Antes acá había
      // un `toast.error(error); return;` y el viaje se perdía para siempre: el
      // wifi del patio da señal sin internet a cada rato, y `isOnline()` es
      // optimista por diseño (en web es solo `navigator.onLine`).
      await guardarEnCola(payload, clientActionId,
        `No se pudo subir (${motivoLegible(error)}). El viaje quedó guardado en el teléfono y se reintenta solo.`);
    } finally {
      registeringRef.current = false;
      setRegistering(false);
    }
  };

  // ── Editar hora (compartido: listero sobre lo suyo dentro de su jornada;
  //    la jefa/full sobre cualquier viaje, sin esa restricción). ─────────────
  const [editing, setEditing] = useState<{ id: string; hh: string; mm: string } | null>(null);
  // Filas del rango filtrado de la jefa (declarado acá arriba para que `findRow`
  // pueda buscar en ambas listas — la carga/estado completo del panel de la
  // jefa vive más abajo, junto al resto de sus filtros).
  const [rangeRows, setRangeRows] = useState<CamionViajeRow[]>([]);
  const findRow = (id: string): CamionViajeRow | null =>
    misViajes.find((r) => r.id === id) ?? rangeRows.find((r) => r.id === id) ?? null;

  const isEditableByListero = (row: CamionViajeRow): boolean => {
    if (row.listeroId !== uid) return false;
    const { startMs, endMs } = currentJornadaWindow();
    const t = new Date(row.registeredAt).getTime();
    return t >= startMs && t < endMs;
  };

  const startEdit = (row: CamionViajeRow) => {
    const p = caracasParts(new Date(row.registeredAt));
    setEditing({ id: row.id, hh: pad2(p.hour), mm: pad2(p.minute) });
  };
  const cancelEdit = () => setEditing(null);
  const saveEdit = async () => {
    if (!editing) return;
    const row = findRow(editing.id);
    if (!row) { setEditing(null); return; }
    const hh = Math.min(23, Math.max(0, parseInt(editing.hh, 10) || 0));
    const mm = Math.min(59, Math.max(0, parseInt(editing.mm, 10) || 0));
    const dateIso = caracasParts(new Date(row.registeredAt)).iso;
    const newIso = `${dateIso}T${pad2(hh)}:${pad2(mm)}:00-04:00`;
    // ⚠️ Ahora que todo se filtra por JORNADA, cambiar la hora puede mudar el
    //    viaje de una jornada a otra (cruzar las 7am), y entonces desaparece del
    //    día que se está mirando. No se bloquea —a veces es justo lo que se
    //    quiere corregir— pero se pregunta antes.
    const jornadaAntes = jornadaDeFecha(new Date(row.registeredAt));
    const jornadaDespues = jornadaDeFecha(new Date(newIso));
    if (jornadaAntes !== jornadaDespues) {
      const ok = await confirm(`Con esa hora el viaje pasa de la jornada del ${jornadaAntes} a la del ${jornadaDespues}, así que va a salir en otro día. ¿Lo dejas así?`);
      if (!ok) return;
    }
    // ⭐ Y lo mismo al cruzar las 7pm, que NO cambia de jornada pero sí de TURNO.
    //    Corregir un viaje de 6:50pm a 7:10pm lo muda de día a noche: si la jefa
    //    tiene marcado un turno, el viaje se le desaparece de la lista al
    //    guardar y sin este aviso no habría manera de saber por qué. Es el único
    //    momento en que se puede advertir — después ya solo queda detectarlo.
    const turnoAntes = turnoDeViaje(row.registeredAt);
    const turnoDespues = turnoDeViaje(newIso);
    if (turnoAntes !== turnoDespues) {
      const ok = await confirm(`Con esa hora el viaje pasa del turno de ${TURNO_NOMBRE[turnoAntes].toLowerCase()} al de ${TURNO_NOMBRE[turnoDespues].toLowerCase()}. ¿Lo dejas así?`);
      if (!ok) return;
    }
    const { error } = await editarHoraViaje(editing.id, newIso);
    if (error) { toast.error(error); return; }
    setEditing(null);
    toast.success('Hora actualizada.');
    loadMisViajes();
    if (canFull) loadRangeRows();
  };

  const onBorrar = async (row: CamionViajeRow) => {
    const ok = await confirm({
      title: 'Borrar viaje',
      message: `¿Borrar el viaje de ${row.machineCode} de las ${fmtHora(row.registeredAt)}? Esta acción no se puede deshacer.`,
      confirmText: 'Borrar',
      danger: true,
    });
    if (!ok) return;
    const { error } = await borrarViaje(row.id);
    if (error) { toast.error(error); return; }
    toast.success('Viaje borrado.');
    loadRangeRows();
    loadResumen();
  };

  // ── Panel de la JEFA/ADMIN (nivel full) ─────────────────────────────────
  // Resumen del día.
  const [resumenRows, setResumenRows] = useState<CamionViajeRow[]>([]);
  const [metasByTruck, setMetasByTruck] = useState<Record<string, number | null>>({});
  /** Errores de lectura del panel: se muestran en vez de fingir que no hay datos. */
  const [resumenError, setResumenError] = useState<string | null>(null);
  const [alertaError, setAlertaError] = useState<string | null>(null);
  const loadResumen = async () => {
    if (!canFull) return;
    const { rows, error } = await listTodosLosViajes(jornadaWindowISO(caracasBusinessToday()));
    setResumenError(error ?? null);
    // Si falló, se conserva lo último bueno: un resumen en ceros hacía concluir
    // que los listeros no trabajaron hoy.
    if (!error) setResumenRows(rows);
  };
  useEffect(() => {
    if (!canFull || allTrucks.length === 0) return;
    getMetasPorCamion(allTrucks.map((t) => t.id)).then(setMetasByTruck);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canFull, allTrucks]);

  // El "code" de estos camiones suele repetirse (ej. "Camion Volteo Toronto" en
  // casi toda la flota) — sin placa/serial no se puede distinguir uno de otro
  // en estas listas, así que se arrastran también aquí.
  const resumenPorCamion = useMemo(() => {
    const infoOf = new Map<string, { code: string; plate: string | null; serial: string | null }>();
    allTrucks.forEach((t) => infoOf.set(t.id, { code: t.code, plate: t.plate, serial: t.serial }));
    // Se cuenta por CLAVE, no por id: los camiones fuera de catálogo no tienen id
    // y si se agruparan por `null` saldrían todos sumados como uno solo
    // (ver `claveCamion` en src/lib/viajesResumen.ts, que es la única verdad).
    resumenRows.forEach((r) => { const k = claveCamion(r); if (!infoOf.has(k)) infoOf.set(k, { code: r.machineCode, plate: r.fueraCatalogo ? 'FUERA DE CATÁLOGO' : null, serial: null }); });
    const counts = new Map<string, number>();
    // ⭐ Y en qué TURNO los hizo. Es lo que pidió la jefa: mirar la lista y ver
    //    de un vistazo cuáles camiones andan de día y cuáles de noche, sin
    //    tener que abrir el detalle viaje por viaje.
    const turnos = new Map<string, ('day' | 'night')[]>();
    resumenRows.forEach((r) => {
      const k = claveCamion(r);
      counts.set(k, (counts.get(k) ?? 0) + 1);
      const t = turnos.get(k) ?? [];
      t.push(turnoDeViaje(r.registeredAt));
      turnos.set(k, t);
    });
    const ids = new Set<string>([...allTrucks.map((t) => t.id), ...resumenRows.map((r) => claveCamion(r))]);
    const arr = Array.from(ids).map((id) => {
      const info = infoOf.get(id) ?? { code: '—', plate: null, serial: null };
      const conteo = contarTurnos(turnos.get(id) ?? []);
      return { id, ...info, count: counts.get(id) ?? 0, meta: metasByTruck[id] ?? null, conteo, perfil: perfilDeTurno(conteo) };
    });
    arr.sort((a, b) => b.count - a.count || cmpText(a.code, b.code));
    return arr;
  }, [resumenRows, allTrucks, metasByTruck]);

  const resumenPorListero = useMemo(() => {
    const m = new Map<string, { name: string; count: number }>();
    resumenRows.forEach((r) => {
      const e = m.get(r.listeroId) ?? { name: r.listeroName, count: 0 };
      e.count += 1;
      m.set(r.listeroId, e);
    });
    return Array.from(m.values()).sort((a, b) => b.count - a.count || cmpText(a.name, b.name));
  }, [resumenRows]);

  // Alerta de camiones sin viaje reciente.
  const [alertaHoras, setAlertaHorasState] = useState(6);
  const [alertaHorasInput, setAlertaHorasInput] = useState('6');
  const [lastTripByTruck, setLastTripByTruck] = useState<Record<string, string>>({});
  const loadAlertaCfg = async () => {
    if (!canFull) return;
    const h = await getAlertaHoras();
    setAlertaHorasState(h);
    setAlertaHorasInput(String(h));
  };
  const loadAlerta = async () => {
    if (!canFull) return;
    const lookbackHours = Math.max(168, alertaHoras * 3);
    const desdeISO = new Date(Date.now() - lookbackHours * 3600000).toISOString();
    // El tope es MAÑANA, no "ahora": `registered_at` lo pone el reloj del
    // TELÉFONO, y acotar con "ahora" dejaba fuera el viaje de un aparato
    // adelantado unos minutos. Pero quitarlo del todo era peor: un solo viaje
    // con fecha futura da horas NEGATIVAS y ese camión no vuelve a salir en la
    // alerta NUNCA. Un día de margen cubre el reloj corrido sin abrir esa puerta.
    const hastaExclusivoISO = new Date(Date.now() + 86400000).toISOString();
    const { rows, error } = await listTodosLosViajes({ desdeISO, hastaExclusivoISO });
    // ⚠️ Si la consulta falló, NO se pinta la alerta: con `last` vacío, TODOS
    //    los camiones dan "sin viaje reciente" y la jefa recibe una alarma falsa
    //    de flota entera parada. Mejor no decir nada que decir una barbaridad.
    setAlertaError(error ?? null);
    if (error) return;
    const last: Record<string, string> = {};
    // `rows` ya viene ordenado registered_at desc: la primera aparición de cada
    // camión es su viaje MÁS RECIENTE.
    // Los fuera de catálogo NO entran a esta alerta: es "camiones de la flota sin
    // viaje reciente", y un camión prestado que se anotó una vez no está parado,
    // simplemente ya no está. Meterlo daría una alarma que nadie puede atender.
    rows.forEach((r) => { if (r.machineryId && !last[r.machineryId]) last[r.machineryId] = r.registeredAt; });
    setLastTripByTruck(last);
  };
  const alertList = useMemo(() => {
    const now = nowTick;
    return allTrucks
      .filter((t) => !ESTADO_ADVERSO.includes(truckEstadoConteo(t)))
      .map((t) => {
        const last = lastTripByTruck[t.id] ?? null;
        const hrs = last ? (now - new Date(last).getTime()) / 3600000 : Infinity;
        return { truck: t, hrs, last };
      })
      .filter((x) => x.hrs > alertaHoras)
      .sort((a, b) => b.hrs - a.hrs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTrucks, lastTripByTruck, alertaHoras, averiaCat, jornadaCat, inspByShift, nowTick]);

  const saveAlertaHoras = async () => {
    const n = Number(alertaHorasInput.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) { toast.error('Ingresa un número de horas válido.'); return; }
    const { error } = await setAlertaHoras(n, uid);
    if (error) { toast.error(error); return; }
    setAlertaHorasState(n);
    toast.success('Umbral de alerta actualizado.');
    loadAlerta();
  };

  // Lista completa filtrable.
  const [preset, setPreset] = useState<Preset>('hoy');
  const [rangeFrom, setRangeFrom] = useState(caracasBusinessToday());
  const [rangeTo, setRangeTo] = useState(caracasBusinessToday());
  const [diasSel, setDiasSel] = useState<Set<string>>(new Set([caracasBusinessToday()]));
  const [diasPickOpen, setDiasPickOpen] = useState(false);
  // ⚠️ Map id→ETIQUETA, no Set: hace falta el nombre para poder dibujar el chip
  //    de un filtro que quedó marcado y que en el rango de HOY ya no aparece en
  //    ningún viaje. Con un Set ese chip desaparecía, la lista salía vacía y no
  //    había cómo saber qué la estaba tapando (ver src/lib/viajesFiltros.ts).
  const [filterListeroSel, setFilterListeroSel] = useState<Map<string, string>>(new Map());
  const [filterTruckSel, setFilterTruckSel] = useState<Map<string, string>>(new Map());
  // Filtro por EMPRESA y modo del reporte (pedido del cliente 20-ago-2026). La
  // empresa NO viaja en `camion_viajes`: se resuelve por el camión (`truckById`),
  // que ya trae `companyId`/`companyName` desde `machinery`.
  const [filterCompanySel, setFilterCompanySel] = useState<Map<string, string>>(new Map());
  // ⭐ TURNO (☀️ día 7am–7pm · 🌙 noche 7pm–7am). Es un filtro más del PANEL DE
  //    LA JEFA; la vista del listero no lo lleva — él ya ve el turno escrito en
  //    cada uno de sus viajes y no tiene nada que filtrar.
  const [filterTurnoSel, setFilterTurnoSel] = useState<Map<string, string>>(new Map());
  // 'detallado' = una línea por viaje (como siempre) · 'resumen' = cantidad de
  // viajes por camión, agrupada por empresa, sin desglosar viaje por viaje.
  const [reporteModo, setReporteModo] = useState<'detallado' | 'resumen'>('detallado');
  // Por cuál eje se parte el resumen (pedido del cliente 22-ago-2026: poder
  // sacarlo también por listero). Va APARTE del modo a propósito: "detallado vs
  // resumido" y "por empresa vs por listero" son dos preguntas distintas, y
  // meterlas en un solo selector de tres opciones obligaría a repetir el eje en
  // cada modo. Solo se muestra cuando el modo es 'resumen', igual que el
  // "Agrupar por" del informe por jornada en ReportsScreen.
  const [resumenEje, setResumenEje] = useState<EjeResumen>('empresa');
  const porListero = resumenEje === 'listero';
  const toggleEn = (set: React.Dispatch<React.SetStateAction<Map<string, string>>>) =>
    (id: string, label: string) => set((prev) => { const n = new Map(prev); n.has(id) ? n.delete(id) : n.set(id, label); return n; });
  const toggleFilterListero = toggleEn(setFilterListeroSel);
  const toggleFilterTruck = toggleEn(setFilterTruckSel);
  const toggleFilterCompany = toggleEn(setFilterCompanySel);
  const toggleFilterTurno = toggleEn(setFilterTurnoSel);
  const toggleDia = (iso: string) => setDiasSel((prev) => { const n = new Set(prev); n.has(iso) ? n.delete(iso) : n.add(iso); return n; });

  // ⚠️ De NEGOCIO, no de calendario: a las 3 de la mañana la jornada en curso
  //    sigue siendo la que arrancó ayer a las 7am.
  const todayISO = caracasBusinessToday();
  const rangeBounds = useMemo(() => {
    if (preset === 'hoy') return { desde: todayISO, hasta: todayISO };
    if (preset === 'semana') return { desde: weekStartISO(todayISO), hasta: todayISO };
    if (preset === 'mes') return { desde: `${todayISO.slice(0, 7)}-01`, hasta: todayISO };
    if (preset === 'rango') return { desde: rangeFrom || todayISO, hasta: rangeTo || todayISO };
    const arr = Array.from(diasSel).sort();
    return arr.length ? { desde: arr[0], hasta: arr[arr.length - 1] } : { desde: todayISO, hasta: todayISO };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, rangeFrom, rangeTo, diasSel, todayISO]);
  // ⭐ El rango son JORNADAS COMPLETAS: de las 7am del primer día a las 7am del
  //    siguiente al último. Semiabierto, para que no quede el hueco de
  //    milisegundos que dejaba un tope de 23:59:59.
  const { desdeISO, hastaExclusivoISO } = jornadaWindowISO(rangeBounds.desde, rangeBounds.hasta);
  // ⭐ Un rango AL REVÉS (DESDE después de HASTA) no falla: devuelve CERO viajes.
  //    En web el campo de fecha deja escribir cualquier valor —el min/max del
  //    navegador marca el campo como inválido pero NO impide el valor, y además
  //    se puede borrar el HASTA y elegir un DESDE futuro—, así que se llegaba
  //    acá con desde > hasta y la pantalla decía «Sin viajes en el rango
  //    seleccionado». Es mentira: el rango no existe, y con ese vacío se podía
  //    exportar un PDF que decía «Total: 0 viajes».
  const rangoInvalido = rangeBounds.desde > rangeBounds.hasta;
  // Ningún día marcado en «días específicos». Antes caía al rango de HOY por
  // defecto y mostraba la jornada de hoy sin decirlo: se leía como si esos
  // fueran los viajes de los días elegidos, sin que hubiera ninguno elegido.
  const sinDiasMarcados = preset === 'dias' && diasSel.size === 0;
  // Cómo se nombra el rango en pantalla y en el encabezado del PDF. La regla
  // (y el porqué de no decir «del 5 al 22») vive en src/lib/viajesFiltros.ts,
  // con sus casos en scripts/test-viajes-filtros.mjs.
  const etiquetaRango = useMemo(
    () => etiquetaRangoViajes(preset === 'dias', rangeBounds.desde, rangeBounds.hasta, diasSel, dmy),
    [preset, rangeBounds.desde, rangeBounds.hasta, diasSel]
  );

  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeMissing, setRangeMissing] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);
  /**
   * ⭐ A QUÉ VENTANA PERTENECEN LAS FILAS QUE HAY CARGADAS.
   *
   * Sin esto, al cambiar de rango la pantalla seguía mostrando los viajes del
   * rango ANTERIOR bajo la etiqueta y el conteo del NUEVO, y el botón de
   * exportar no tenía ninguna guarda: salía un PDF con el subtítulo de «este
   * mes» y las doce filas de hoy. Es exactamente la clase de mentira que este
   * módulo lleva dos revisiones tratando de eliminar.
   */
  const rangeKey = `${desdeISO}|${hastaExclusivoISO}`;
  const [rangeRowsKey, setRangeRowsKey] = useState('');
  const rangeDesactualizado = rangeRowsKey !== rangeKey;
  /** Contador de peticiones: si dos rangos se piden seguidos y el PRIMERO
   *  responde de último, su respuesta se descarta. Manda siempre la última. */
  const pedidoRef = useRef(0);
  const loadRangeRows = async () => {
    // Un rango al revés no se le pregunta a la base: no hay respuesta correcta
    // que dar. Sin días marcados, tampoco: el rango caería a HOY por defecto y
    // se consultaría algo que el usuario no pidió.
    if (!canFull || rangoInvalido || sinDiasMarcados) return;
    const key = rangeKey;
    const nro = ++pedidoRef.current;
    setRangeLoading((prev) => prev || rangeRows.length === 0 || rangeRowsKey !== key);
    const { rows, missing, error } = await listTodosLosViajes({ desdeISO, hastaExclusivoISO });
    if (nro !== pedidoRef.current) return;   // llegó tarde: ya hay otra petición
    setRangeLoading(false);
    setRangeMissing(missing);
    setRangeError(error ?? null);
    // ⚠️ Ante un error se conserva lo anterior: si no, la lista queda vacía Y
    //    ESE VACÍO ES EL QUE SE EXPORTA AL PDF, con "Total: 0 viajes".
    if (!error) { setRangeRows(rows); setRangeRowsKey(key); }
  };

  useEffect(() => {
    if (canFull) loadRangeRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canFull, desdeISO, hastaExclusivoISO, rangoInvalido, sinDiasMarcados]);

  const dateScopedRows = useMemo(() => {
    // Sin ningún día marcado no hay nada que mostrar. Devolver el rango entero
    // (que por defecto es HOY) haría pasar la jornada de hoy por «los días que
    // elegiste», y de ahí a un reporte con la fecha equivocada hay un paso.
    if (sinDiasMarcados || rangoInvalido || rangeDesactualizado) return [];
    if (preset === 'dias') {
      // Por JORNADA: un viaje de la madrugada pertenece a la jornada de la noche
      // anterior, así que marcar un día trae también su madrugada.
      return rangeRows.filter((r) => diasSel.has(jornadaDeFecha(new Date(r.registeredAt))));
    }
    return rangeRows;
  }, [rangeRows, preset, diasSel, sinDiasMarcados, rangoInvalido, rangeDesactualizado]);

  // Empresa de un viaje: la del camión que lo hizo. Los camiones sin empresa
  // asignada caen en una sola cubeta, para que no desaparezcan del filtro.
  const companyOfRow = (r: CamionViajeRow) => {
    // Un camión fuera de catálogo no tiene ficha que consultar: no se le inventa
    // empresa, cae en la misma cubeta que los que no la tienen asignada.
    const t = r.machineryId ? truckById.get(r.machineryId) : undefined;
    return { key: t?.companyId ?? SIN_EMPRESA, name: t?.companyName || 'Sin empresa' };
  };

  // ⭐ LOS TRES FILTROS. La cuenta de cada chip sale sobre los viajes que YA
  //    pasan los OTROS dos filtros — antes se contaba sobre el rango entero, así
  //    que con un listero marcado los chips de empresa seguían mostrando el
  //    total de TODOS los listeros y no cuadraban ni con la lista de abajo ni
  //    con el PDF. La regla, el porqué y sus casos: src/lib/viajesFiltros.ts.
  // Por CLAVE y no por id en el camión: los fuera de catálogo no tienen id y se
  // fundirían todos en una sola opción del filtro (ver `claveCamion`).
  // ⚠️ El turno se DEDUCE DE LA HORA, no se lee de la columna `shift`: esa es
  //    nullable en los viajes viejos y `editarHoraViaje` la deja
  //    desactualizada al corregir una hora que cruza las 7pm. El porqué
  //    completo está en src/lib/viajesTurno.ts.
  /**
   * El ícono con el que se dibuja cada eje. Hace falta para nombrar un filtro
   * sobrante SIN AMBIGÜEDAD: un mensaje como «(MGG, MGG)» no se puede resolver
   * cuando un listero se apellida igual que una empresa. El turno no lleva
   * ícono acá porque su etiqueta ya trae el suyo (☀️/🌙).
   */
  const ICONO_EJE: Record<EjeFiltro, string> = { listero: '👤 ', empresa: '🏢 ', camion: '🚜 ', turno: '' };

  const clavesDe = (r: CamionViajeRow): ClavesViaje => ({
    listero: r.listeroId,
    empresa: companyOfRow(r).key,
    camion: claveCamion(r),
    turno: turnoDeViaje(r.registeredAt),
  });
  const seleccion: SeleccionFiltros = useMemo(
    () => ({ listero: filterListeroSel, empresa: filterCompanySel, camion: filterTruckSel, turno: filterTurnoSel }),
    [filterListeroSel, filterCompanySel, filterTruckSel, filterTurnoSel]
  );
  const listeroOptions = useMemo(
    () => opcionesDeEje(dateScopedRows, 'listero', clavesDe, (r) => ({ id: r.listeroId, label: r.listeroName }), seleccion, cmpText),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dateScopedRows, seleccion, truckById]
  );
  const companyOptions = useMemo(
    () => opcionesDeEje(dateScopedRows, 'empresa', clavesDe, (r) => ({ id: companyOfRow(r).key, label: companyOfRow(r).name }), seleccion, cmpText),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dateScopedRows, seleccion, truckById]
  );
  const truckOptions = useMemo(
    () => opcionesDeEje(dateScopedRows, 'camion', clavesDe,
      (r) => ({ id: claveCamion(r), label: r.fueraCatalogo ? r.machineCode + ' (fuera de catálogo)' : r.machineCode }), seleccion, cmpText),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dateScopedRows, seleccion, truckById]
  );

  const turnoOptions = useMemo(
    () => opcionesDeEje(dateScopedRows, 'turno', clavesDe,
      (r) => { const t = turnoDeViaje(r.registeredAt); return { id: t, label: turnoLabel(t) }; }, seleccion, cmpText)
      // Día primero, noche después: es el orden de la jornada. Ordenar por la
      // etiqueta dejaría el orden a merced de cómo colacione el emoji.
      .sort((a, b) => (a.id === b.id ? 0 : a.id === 'day' ? -1 : 1)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dateScopedRows, seleccion, truckById]
  );

  const filteredRangeRows = useMemo(
    () => dateScopedRows.filter((r) => pasaFiltros(clavesDe(r), seleccion)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dateScopedRows, seleccion, truckById]
  );
  // Filtros marcados que no le tocan a NINGÚN viaje del rango — casi siempre uno
  // que quedó puesto de otro día. Es la explicación concreta de una lista vacía.
  // ⚠️ Solo tiene sentido señalar un filtro si HAY viajes que podría estar
  //    tapando. Con el rango vacío, todo lo marcado sale «fuera del rango» y el
  //    mensaje culpaba a un filtro inocente: el usuario lo quitaba y la lista
  //    seguía igual de vacía, porque ese día no se trabajó.
  const filtrosSobrantes = useMemo(
    () => (dateScopedRows.length === 0 ? [] : marcadosFueraDelRango(dateScopedRows, clavesDe, seleccion)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dateScopedRows, seleccion, truckById]
  );

  /**
   * VIAJES GLOBALIZADOS: cuántos viajes hizo cada camión, agrupados por empresa,
   * en vez de una línea por viaje. Es lo que pide el cliente para el reporte
   * "no desglosado": camión X → N viajes; y si se filtra por empresa, salen
   * TODOS sus camiones con el total de la empresa y su desglose.
   * Respeta exactamente los mismos filtros que la lista detallada.
   * La cuenta vive en `src/lib/viajesResumen.ts` (función pura, con test propio).
   */
  // `resumirViajes` es una función pura SIN imports (a propósito, ver su
  // cabecera), así que no puede deducir el turno sola: se lo damos ya masticado.
  const filasResumen = useMemo(
    () => filteredRangeRows.map((r) => ({ ...r, turno: turnoDeViaje(r.registeredAt) })),
    [filteredRangeRows]
  );
  const resumenViajes = useMemo(
    () => resumirViajes(filasResumen, (id) => truckById.get(id), resumenEje),
    [filasResumen, truckById, resumenEje]
  );

  // Viajes cuya columna `shift` contradice a su hora — pasa al corregir una hora
  // cruzando las 7am o las 7pm. No se corrige solo: se DICE, para que nadie
  // concluya que el reporte cambió de números por su cuenta.
  const viajesConTurnoDesacordado = useMemo(
    () => filteredRangeRows.filter((r) => desacuerdoDeTurno(r.shift, r.registeredAt)).length,
    [filteredRangeRows]
  );

  // Metas por camión (editable).
  const [metaEdits, setMetaEdits] = useState<Record<string, string>>({});
  const saveMeta = async (truckId: string) => {
    const raw = (metaEdits[truckId] ?? '').trim();
    const n = raw === '' ? null : Math.max(0, Math.round(Number(raw.replace(',', '.'))));
    if (raw !== '' && !Number.isFinite(n)) { toast.error('Meta inválida.'); return; }
    const { error } = await setMetaCamion(truckId, n);
    if (error) { toast.error(error); return; }
    setMetasByTruck((prev) => ({ ...prev, [truckId]: n }));
    toast.success('Meta actualizada.');
  };

  // Compartir / exportar el reporte del rango filtrado (mismo mecanismo PDF
  // que el resto del sistema, ver src/lib/pdf.ts + CoordinadorOperadoresScreen).
  const [shareBusy, setShareBusy] = useState(false);
  const compartirReporte = async () => {
    // ⚠️ Un reporte sacado sobre una lectura fallida sale con menos viajes de los
    //    que hay y NO lo dice. Se cobra por viaje: mejor no emitirlo.
    if (rangeError) {
      toast.error(`No se pueden exportar los viajes ahora (${motivoLegible(rangeError)}). El reporte saldría incompleto.`);
      return;
    }
    // Mismo criterio: un reporte que sale en 0 porque el filtro está mal puesto
    // parece un reporte de un día flojo. Mejor no emitirlo y decir qué corregir.
    if (rangoInvalido) {
      toast.error(`El rango está al revés: DESDE (${dmy(rangeBounds.desde)}) es posterior a HASTA (${dmy(rangeBounds.hasta)}). Corrige las fechas.`);
      return;
    }
    if (sinDiasMarcados) {
      toast.error('No hay ningún día marcado. Agrega al menos uno con «+ agregar día».');
      return;
    }
    // Las filas que hay en pantalla todavía son de otro rango: el PDF saldría
    // con el subtítulo del rango nuevo y los viajes del viejo.
    if (rangeLoading || rangeDesactualizado) {
      toast.error('Los viajes de ese rango todavía se están cargando. Espera a que termine.');
      return;
    }
    setShareBusy(true);
    try {
      const esc = (t: any) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      // Un camión fuera de catálogo no tiene ficha: se imprime la seña que anotó
      // el listero (placa dicha, empresa, "el rojo de Pérez") y se marca como tal,
      // para que quien lea el reporte NO lo confunda con un camión de la flota.
      const placaDe = (r: CamionViajeRow) => {
        if (r.fueraCatalogo) return `⚠️ FUERA DE CATÁLOGO${r.camionRef ? ` · ${r.camionRef}` : ''}`;
        const t = r.machineryId ? truckById.get(r.machineryId) : undefined;
        return t?.plate || t?.serial || '—';
      };

      // Un encabezado común que deja constancia de con qué filtros se sacó, para
      // que el reporte se pueda auditar después sin adivinar.
      // Los nombres salen de lo MARCADO, no de las opciones visibles: si un
      // filtro quedó puesto sobre algo que este rango no tiene, igual hay que
      // decirlo en el encabezado — es la explicación de por qué salió corto.
      // ⚠️ `esc()` también acá. El subtítulo se interpola CRUDO en el HTML del
      //    PDF (src/lib/pdf.ts), y estos nombres los teclea gente: el código de
      //    un camión «fuera de catálogo» lo escribe el listero a mano. Un `<`
      //    suelto rompe el documento; algo peor, lo reescribe.
      const filtros = [
        filterCompanySel.size ? `Empresas: ${esc(Array.from(filterCompanySel.values()).join(', '))}` : null,
        filterTruckSel.size ? `Camiones: ${esc(Array.from(filterTruckSel.values()).join(', '))}` : null,
        filterListeroSel.size ? `Listeros: ${esc(Array.from(filterListeroSel.values()).join(', '))}` : null,
        filterTurnoSel.size ? `Turno: ${esc(Array.from(filterTurnoSel.values()).join(', '))}` : null,
      ].filter(Boolean).join(' · ');

      // ── RESUMIDO (globalizado): total de viajes por camión, agrupado por
      //    empresa O POR LISTERO, con el total de cada grupo y el total general.
      //    Sin una línea por viaje — es justo lo contrario del detallado.
      //
      //    El HTML es UNO SOLO para los dos ejes: lo único que cambia son los
      //    rótulos. Si se partiera en dos plantillas, cualquier arreglo futuro
      //    habría que hacerlo dos veces y los totales podrían dejar de cuadrar.
      const icoGrupo = porListero ? '👤' : '🏢';
      const palabraGrupo = porListero ? 'listero(s)' : 'empresa(s)';
      // Un 0 en una columna de números se lee peor que un guion: la fila del
      // camión que solo trabaja de día queda limpia en vez de arrastrar un
      // «0» en la de noche.
      const num = (n: number) => (n > 0 ? String(n) : '—');
      const bodyResumen = `
        <p class="tot">TOTAL GENERAL: ${resumenViajes.total} viaje(s) · ${resumenViajes.totalCamiones} camión(es) · ${resumenViajes.empresas.length} ${palabraGrupo}
          <br><span style="font-weight:600">${turnoLabelConHorario('day')}: ${resumenViajes.dia} · ${turnoLabelConHorario('night')}: ${resumenViajes.noche}</span></p>
        ${resumenViajes.empresas.map((e) => `
          <h3>${icoGrupo} ${esc(e.name)} — ${e.total} viaje(s) · ${e.camiones.length} camión(es) · ${turnoLabel('day')} ${e.dia} · ${turnoLabel('night')} ${e.noche}</h3>
          <table>
            <thead><tr><th>Camión</th><th>Placa / Serial</th><th style="text-align:right">☀️ Día</th><th style="text-align:right">🌙 Noche</th><th style="text-align:right">Viajes</th></tr></thead>
            <tbody>
              ${e.camiones.map((c) => `<tr><td>${esc(c.code)}</td><td>${esc(c.placa)}</td><td style="text-align:right">${num(c.dia)}</td><td style="text-align:right">${num(c.noche)}</td><td style="text-align:right"><b>${c.viajes}</b></td></tr>`).join('')}
            </tbody>
            <tfoot><tr><td colspan="2"><b>Total ${esc(e.name)}</b></td><td style="text-align:right"><b>${num(e.dia)}</b></td><td style="text-align:right"><b>${num(e.noche)}</b></td><td style="text-align:right"><b>${e.total}</b></td></tr></tfoot>
          </table>`).join('')}`;

      // ── DETALLADO: como siempre, pero ahora CON empresa y placa en cada línea.
      const bodyDetalle = `
        <p class="tot">TOTAL: ${filteredRangeRows.length} viaje(s)</p>
        <table>
          <thead><tr><th>Fecha</th><th>Hora</th><th>Empresa</th><th>Camión</th><th>Placa / Serial</th><th>Chofer</th><th>Listero</th><th>Turno</th><th>Estado</th></tr></thead>
          <tbody>
            ${filteredRangeRows
              .map(
                (r) =>
                  `<tr><td>${esc(fmtFecha(r.registeredAt))}</td><td>${esc(fmtHora(r.registeredAt))}</td><td>${esc(companyOfRow(r).name)}</td><td>${esc(r.machineCode)}</td><td>${esc(placaDe(r))}</td><td>${esc(r.choferName ?? '—')}</td><td>${esc(r.listeroName)}</td><td>${esc(TURNO_NOMBRE[turnoDeViaje(r.registeredAt)])}</td><td>${esc(r.estadoMaquina ?? '—')}</td></tr>`
              )
              .join('')}
          </tbody>
          <tfoot><tr><td colspan="9">Total: ${filteredRangeRows.length} viajes</td></tr></tfoot>
        </table>`;

      // El corte es por JORNADA (7am→7am), que es como cuenta el negocio: turno
      // de día 7am–7pm más turno de noche 7pm–7am. Se dice en el subtítulo para
      // que nadie compare estas cifras contra un conteo hecho por calendario.
      const corte = 'por jornada (7am a 7am), no por día de calendario';
      const html = pdfDocument({
        title: reporteModo === 'resumen'
          ? (porListero ? 'Viajes de camiones · resumen por listero' : 'Viajes de camiones · resumen por camión')
          : 'Viajes de camiones',
        subtitle: `${etiquetaRango} · ${corte}${filtros ? ` · ${filtros}` : ''}`,
        extraCss: `table{width:100%;border-collapse:collapse;margin:6px 0 14px;font-size:11px}
          th,td{border:1px solid #c9d2dc;padding:5px 7px;text-align:left} th{background:#16324F;color:#fff}
          tr:nth-child(even) td{background:#f4f7fb}
          tfoot td{background:#e8eef6;font-weight:700}
          h3{margin:14px 0 4px;font-size:13px;color:#16324F;border-bottom:2px solid #16324F;padding-bottom:2px}
          .tot{margin:4px 0 10px;font-size:13px;font-weight:800;color:#16324F}`,
        body: reporteModo === 'resumen' ? bodyResumen : bodyDetalle,
      });
      // ⚠️ El nombre TIENE que decir por dónde se partió: dos PDF del mismo día
      //    con el mismo nombre se pisan uno al otro al guardarlos, y quien los
      //    reciba no sabría cuál es cuál. Mismo criterio que porEmpresaReport.
      const sufijo = reporteModo === 'resumen' ? (porListero ? 'resumen por listero ' : 'resumen por camion ') : '';
      await exportPdf(html, `Viajes de camiones ${sufijo}${todayISO}`);
    } catch (e: any) {
      // Sin este catch, un fallo de exportPdf dejaba el botón como si nada y la
      // jefa concluía que «no hizo nada», sin saber por qué.
      toast.error(`No se pudo generar el reporte: ${String(e?.message ?? e)}`);
    } finally {
      setShareBusy(false);
    }
  };

  // ── Carga inicial + tiempo real ─────────────────────────────────────────
  useEffect(() => {
    loadTrucks();
    if (canWrite) loadMisViajes();
    if (canFull) { loadAlertaCfg(); loadResumen(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWrite, canFull, uid]);
  useEffect(() => {
    if (canFull) loadAlerta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canFull, alertaHoras]);
  useRealtimeRefresh(['camion_viajes', 'machine_operators', 'machinery'], () => {
    loadTrucks();
    if (canWrite) loadMisViajes();
    if (canFull) { loadResumen(); loadAlerta(); loadRangeRows(); }
  });

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    await loadTrucks();
    if (canWrite) await loadMisViajes();
    if (canFull) { await loadResumen(); await loadAlerta(); await loadRangeRows(); }
    setRefreshing(false);
  };

  // ── Sin acceso ───────────────────────────────────────────────────────────
  if (level === 'none') {
    return (
      <Screen>
        <SectionTitle>🚛 Viajes de camiones</SectionTitle>
        <EmptyState title="Sin acceso" subtitle="No tienes permiso para ver este módulo. Pídeselo a un administrador." />
      </Screen>
    );
  }
  if (!canWrite) {
    return (
      <Screen>
        <SectionTitle>🚛 Viajes de camiones</SectionTitle>
        <EmptyState title="Solo lectura" subtitle="Tu nivel de acceso a este módulo es de solo lectura. Pídele a un administrador el nivel Escritura para poder registrar viajes." />
      </Screen>
    );
  }

  // ── Fila de viaje (reutilizada por "Mis viajes de hoy" y "Lista completa"). ─
  const renderRow = (row: DisplayViaje, opts: { canEdit: boolean; canDelete: boolean; showListero?: boolean }) => {
    const isEditing = editing?.id === row.id;
    const truck = row.machineryId ? truckById.get(row.machineryId) : undefined;
    // Del camión de fuera no hay placa ni serial que buscar: se muestra la seña
    // que escribió el listero, que es lo único que permite identificarlo.
    const placaSerial = row.fueraCatalogo
      ? (row.camionRef ? `Anotado a mano · ${row.camionRef}` : 'Anotado a mano por el listero')
      : [truck?.plate ? `Placa ${truck.plate}` : null, truck?.serial ? `Serial ${truck.serial}` : null].filter(Boolean).join(' · ');
    return (
      <View key={row.id} style={{ paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: colors.text, fontWeight: '700', flexShrink: 1 }}>
            {row.fueraCatalogo ? '🚚' : '🚜'} {row.machineCode}{opts.showListero ? ` · ${row.listeroName}` : ''}
          </Text>
          {/* La marca de "fuera de catálogo" va SIEMPRE, para el listero y para
              quien supervisa: un viaje contra un camión anotado a mano no se
              puede confundir con uno de la flota al revisar o al cobrar. */}
          {row.fueraCatalogo ? <Badge label="🚚 fuera de catálogo" tone="warning" /> : null}
          {row.stuck ? <Badge label="⚠️ no subió" tone="danger" /> : row.queued ? <Badge label="📤 pendiente" tone="warning" /> : null}
        </View>
        {row.stuck && row.stuckError ? (
          <Text style={{ color: '#B42318', fontSize: 11, fontStyle: 'italic' }}>{motivoLegible(row.stuckError)}</Text>
        ) : null}
        {placaSerial ? <Text style={{ color: colors.muted, fontSize: 11.5 }}>{placaSerial}</Text> : null}
        <Text style={{ color: colors.muted, fontSize: 12 }}>
          {fmtFecha(row.registeredAt)} · {fmtHora(row.registeredAt)} · {turnoLabel(turnoDeViaje(row.registeredAt))}
          {row.choferName ? ` · 👤 ${row.choferName}` : ''}
          {row.estadoMaquina ? ` · ${row.estadoMaquina}` : ''}
        </Text>
        {isEditing ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs }}>
            <TextInput
              value={editing.hh}
              onChangeText={(t) => setEditing((e) => (e ? { ...e, hh: t.replace(/[^0-9]/g, '').slice(0, 2) } : e))}
              keyboardType="number-pad"
              maxLength={2}
              style={[styles.timeInput]}
            />
            <Text style={{ color: colors.text, fontWeight: '800' }}>:</Text>
            <TextInput
              value={editing.mm}
              onChangeText={(t) => setEditing((e) => (e ? { ...e, mm: t.replace(/[^0-9]/g, '').slice(0, 2) } : e))}
              keyboardType="number-pad"
              maxLength={2}
              style={[styles.timeInput]}
            />
            <TouchableOpacity onPress={saveEdit} style={{ paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.primary }}>
              <Text style={{ color: colors.primaryContrast, fontWeight: '700', fontSize: 12 }}>Guardar</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={cancelEdit} style={{ paddingHorizontal: spacing.sm, paddingVertical: 6 }}>
              <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 12 }}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs }}>
            {opts.canEdit ? (
              <TouchableOpacity onPress={() => startEdit(row)}>
                <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12.5 }}>✏️ Editar hora</Text>
              </TouchableOpacity>
            ) : null}
            {opts.canDelete ? (
              <TouchableOpacity onPress={() => onBorrar(row)}>
                <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12.5 }}>🗑️ Borrar</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      </View>
    );
  };

  const PRESETS: { key: Preset; label: string }[] = [
    { key: 'hoy', label: '📅 Hoy' },
    { key: 'semana', label: '🗓️ Esta semana' },
    { key: 'mes', label: '🗓️ Este mes' },
    { key: 'rango', label: '↔️ Rango libre' },
    { key: 'dias', label: '🎯 Días específicos' },
  ];

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      <ConfigBanner />
      <SectionTitle>🚛 Viajes de camiones</SectionTitle>

      {/* ── Vista LISTERO ─────────────────────────────────────────────── */}
      {falloGuardado ? (
        <View style={{ backgroundColor: '#FEF3F2', borderRadius: radius.md, borderWidth: 1, borderColor: '#F97066', padding: spacing.sm, marginBottom: spacing.sm }}>
          <Text style={{ color: '#B42318', fontSize: 12.5, fontWeight: '800' }}>
            ⚠️ El teléfono no está pudiendo guardar los viajes en su memoria. Se ven en pantalla y se están subiendo, pero NO CIERRES LA APLICACIÓN hasta que no quede ninguno pendiente.
          </Text>
          <Text style={{ color: '#B42318', fontSize: 11, marginTop: 4 }}>{falloGuardado}</Text>
        </View>
      ) : null}

      {pendientesVisibles > 0 ? (
        <View style={{ backgroundColor: '#FEF3C7', borderRadius: radius.md, borderWidth: 1, borderColor: '#F59E0B', padding: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 16 }}>📶</Text>
          <Text style={{ color: '#92400E', fontSize: 12.5, fontWeight: '700', flex: 1 }}>
            {pendientesVisibles} {pendientesVisibles === 1 ? 'viaje guardado' : 'viajes guardados'} en el teléfono sin subir. Se suben solos al recuperar señal.
          </Text>
        </View>
      ) : null}

      {/* APARTADOS: no se suben solos por más que se espere — hace falta que
          alguien resuelva la causa. Aviso ROJO y separado del ámbar de arriba,
          justamente para que no se confunda con "esperando señal". */}
      {apartadosVisibles > 0 ? (
        <View style={{ backgroundColor: '#FEF3F2', borderRadius: radius.md, borderWidth: 1, borderColor: '#F97066', padding: spacing.sm, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 16 }}>⚠️</Text>
            <Text style={{ color: '#B42318', fontSize: 12.5, fontWeight: '700', flex: 1 }}>
              {apartadosVisibles} {apartadosVisibles === 1 ? 'viaje no pudo subirse' : 'viajes no pudieron subirse'}. NO se pierden, pero tampoco se suben solos: avisa al administrador.
            </Text>
          </View>
          <TouchableOpacity
            onPress={reintentarApartados}
            disabled={retrying}
            style={{ alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: retrying ? colors.muted : '#B42318' }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{retrying ? 'Reintentando…' : '🔄 Reintentar'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <Card>
        <SectionTitle>Registrar viaje</SectionTitle>
        <TouchableOpacity onPress={openPicker} style={styles.pickButton}>
          <Text style={{ color: selectedTruck ? colors.text : colors.muted, fontWeight: '700' }}>
            {selectedTruck ? `🚜 ${selectedTruck.code}` : '🔎 Buscar camión…'}
          </Text>
        </TouchableOpacity>

        {selectedTruck ? (
          <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
              <Text style={{ color: ESTADO_CONTEO_META[truckEstadoConteo(selectedTruck)].color, fontWeight: '700' }}>
                {ESTADO_CONTEO_META[truckEstadoConteo(selectedTruck)].icon} {ESTADO_CONTEO_META[truckEstadoConteo(selectedTruck)].label}
              </Text>
            </View>
            <Text style={{ color: colors.muted, fontSize: 13 }}>
              👤 Chofer del turno {selectedShift === 'night' ? '🌙 noche' : '☀️ día'}: {choferLoading ? 'cargando…' : (selectedChofer ?? 'sin asignar')}
            </Text>
            <TouchableOpacity
              onPress={doRegistrarViaje}
              disabled={registering}
              style={[styles.registerBtn, { opacity: registering ? 0.6 : 1 }]}
            >
              <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 15 }}>
                {registering ? 'Registrando…' : '🚛 Registrar viaje'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </Card>

      <Card>
        {/* ⭐ EL CONTADOR VA EN EL TÍTULO. La caja mostraba ~4 renglones y no
            tenía número: el listero contaba lo que veía y reclamaba viajes
            faltantes que sí estaban. Y va DESGLOSADO porque un total a secas
            mentiría al revés: haría creer que están todos en el sistema cuando
            algunos siguen en el teléfono. */}
        <SectionTitle>
          {`${hayDeOtrosDias ? 'Mis viajes' : 'Mis viajes de hoy'} · ${misViajesDisplay.length}`}
          {sinSubirEnPantalla > 0 ? ` (${sinSubirEnPantalla} sin subir)` : ''}
          {hayDeOtrosDias ? ' · incluye pendientes de días anteriores' : ''}
        </SectionTitle>
        {misViajesLoading && misViajesDisplay.length === 0 ? (
          <Loading />
        ) : misViajesMissing ? (
          <Text style={{ color: colors.muted }}>Aún no se configuró esta función en la base de datos. Avisa al administrador.</Text>
        ) : misViajesError ? (
          // NO se dice "no hay viajes": la consulta falló y sus viajes SIGUEN en
          // el sistema. Decirle que no registró nada lo empuja a registrar todo
          // otra vez, y ahí sí se duplica.
          <Text style={{ color: colors.danger, fontWeight: '700' }}>
            ⚠️ No se pudo leer la lista ({motivoLegible(misViajesError)}). Tus viajes NO se perdieron: desliza hacia abajo para reintentar.
          </Text>
        ) : misViajesDisplay.length === 0 ? (
          <Text style={{ color: colors.muted }}>Todavía no registras viajes hoy.</Text>
        ) : (
          // Sin `maxHeight` ni ScrollView anidado: el recorte no ahorraba nada
          // (React Native renderiza igual todos los hijos, solo los tapaba) y en
          // Android el scroll anidado casi no se puede accionar con el dedo.
          <View>
            {misViajesDisplay.map((row) => renderRow(row, { canEdit: !row.queued && isEditableByListero(row), canDelete: false }))}
          </View>
        )}
      </Card>

      {/* Selector de camión (mismo estilo del selector "Agregar máquina suelta" de UsersScreen). */}
      <Modal visible={pickOpen} animationType="slide" transparent onRequestClose={() => setPickOpen(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { maxHeight: '82%' }]}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17, marginBottom: spacing.xs }}>🔎 Buscar camión</Text>
            <TextInput
              value={pickQuery}
              onChangeText={setPickQuery}
              placeholder="Buscar por código, categoría, marca, modelo, placa o serial…"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            {pickEstadoOptions.length > 1 ? (
              <View style={{ marginTop: spacing.sm }}>
                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>
                  ESTADO{pickEstadoSel.size > 0 ? ` (${pickEstadoSel.size})` : ' (todos)'}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 }}>
                  <TouchableOpacity
                    onPress={() => setPickEstadoSel(new Set())}
                    style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: pickEstadoSel.size === 0 ? colors.brand : colors.border, backgroundColor: pickEstadoSel.size === 0 ? colors.brand : colors.surface, paddingHorizontal: spacing.sm, paddingVertical: 5 }}
                  >
                    <Text style={{ color: pickEstadoSel.size === 0 ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>Todos</Text>
                  </TouchableOpacity>
                  {pickEstadoOptions.map((o) => {
                    const meta = ESTADO_CONTEO_META[o.key];
                    const on = pickEstadoSel.has(o.key);
                    return (
                      <TouchableOpacity
                        key={o.key}
                        onPress={() => togglePickEstado(o.key)}
                        style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? meta.color : colors.border, backgroundColor: on ? meta.color : colors.surface, paddingHorizontal: spacing.sm, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                      >
                        <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{meta.icon} {meta.label}</Text>
                        <Text style={{ color: on ? colors.brandContrast : colors.muted, fontSize: 11 }}>({o.count})</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ) : null}
            {trucksLoading ? (
              <Loading />
            ) : (
              <ScrollView style={{ marginTop: spacing.sm }}>
                {pickFiltered.map((t) => (
                  <TouchableOpacity
                    key={t.id}
                    onPress={() => onSelectTruck(t)}
                    style={{ padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.xs, backgroundColor: colors.surface }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: colors.text, fontWeight: '700', flexShrink: 1 }}>
                        🚜 {t.code}{(t.marca || t.modelo) ? ` · ${[t.marca, t.modelo].filter(Boolean).join(' ')}` : ''}
                      </Text>
                      <Text style={{ color: ESTADO_CONTEO_META[truckEstadoConteo(t)].color, fontWeight: '700', fontSize: 12 }}>
                        {ESTADO_CONTEO_META[truckEstadoConteo(t)].icon} {ESTADO_CONTEO_META[truckEstadoConteo(t)].label}
                      </Text>
                    </View>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>
                      {[t.clasificacion, t.plate ? `Placa ${t.plate}` : null, t.serial ? `Serial ${t.serial}` : null].filter(Boolean).join(' · ') || 'Sin categoría/placa/serial'}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>🏢 {t.companyName}</Text>
                  </TouchableOpacity>
                ))}
                {pickFiltered.length === 0 && pickExtras.length === 0 ? <Text style={{ color: colors.muted, textAlign: 'center', marginVertical: spacing.md }}>Sin coincidencias.</Text> : null}

                {/* ⭐ ESTÁ EN EL CATÁLOGO PERO NO EN TU LISTA. Al tocarla se suma a
                    la lista (solo en esta pantalla: no se escribe en el catálogo). */}
                {pickExtras.length ? (
                  <View style={{ marginTop: spacing.md }}>
                    <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '800', marginBottom: spacing.xs }}>
                      No están en tu lista, pero sí en el catálogo · {pickExtras.length}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.sm }}>
                      Tócala y se agrega a tu lista para poder registrarle viajes. No cambia nada en el catálogo.
                    </Text>
                    {pickExtras.map((t) => (
                      <TouchableOpacity
                        key={'extra-' + t.id}
                        onPress={() => { setExtraTruckIds((prev) => new Set(prev).add(t.id)); onSelectTruck(t); }}
                        style={{ padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.brand, marginBottom: spacing.xs, backgroundColor: colors.surface }}
                      >
                        <Text style={{ color: colors.text, fontWeight: '700', flexShrink: 1 }}>
                          ➕ {t.code}{(t.marca || t.modelo) ? ` · ${[t.marca, t.modelo].filter(Boolean).join(' ')}` : ''}
                        </Text>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>
                          {[t.clasificacion, t.plate ? `Placa ${t.plate}` : null, t.serial ? `Serial ${t.serial}` : null].filter(Boolean).join(' · ') || 'Sin categoría/placa/serial'}
                        </Text>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>🏢 {t.companyName}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}

                {/* ⭐ NO ESTÁ EN NINGÚN LADO. Se anota a mano SOLO para este viaje:
                    no se crea nada en el catálogo ni en ningún otro módulo. */}
                <TouchableOpacity
                  onPress={() => { setPickOpen(false); abrirFueraCatalogo(pickQuery.trim()); }}
                  style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.warning, backgroundColor: colors.surface }}
                >
                  <Text style={{ color: colors.warning, fontWeight: '800' }}>🚚 El camión no está en la lista</Text>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                    Anótalo a mano para este viaje. No se guarda en el catálogo ni afecta nada más del sistema.
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            )}
            <TouchableOpacity onPress={() => setPickOpen(false)} style={{ marginTop: spacing.sm, padding: spacing.md, alignItems: 'center' }}>
              <Text style={{ color: colors.muted, fontWeight: '700' }}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Panel de la JEFA/ADMIN (nivel full) ─────────────────────────── */}
      {canFull ? (
        <>
          <SectionTitle>📊 Panel de la jefa</SectionTitle>

          <Card>
            <SectionTitle>Resumen de hoy</SectionTitle>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs, fontWeight: '800' }}>POR CAMIÓN</Text>
            {resumenPorCamion.length === 0 ? (
              <Text style={{ color: colors.muted }}>Sin camiones registrados.</Text>
            ) : (
              <ScrollView style={{ maxHeight: 280 }} nestedScrollEnabled>
                {resumenPorCamion.map((r) => (
                  <View key={r.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 }}>
                    <View style={{ flexShrink: 1 }}>
                      <Text style={{ color: colors.text }}>🚜 {r.code}</Text>
                      {(r.plate || r.serial) ? (
                        <Text style={{ color: colors.muted, fontSize: 11 }}>{[r.plate ? `Placa ${r.plate}` : null, r.serial ? `Serial ${r.serial}` : null].filter(Boolean).join(' · ')}</Text>
                      ) : null}
                      {/* ⭐ En qué turno anda ESTE camión hoy. «mixto» solo si el
                          turno menor pesa de verdad (ver `perfilDeTurno`): con un
                          viaje suelto de noche, un camión diurno sigue siendo
                          diurno, si no toda la flota saldría «mixto». */}
                      {r.count > 0 ? (
                        <Text style={{ color: colors.muted, fontSize: 11 }}>
                          {PERFIL_CORTO[r.perfil]} · {resumenTurno(r.conteo)}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>{r.meta != null ? `${r.count}/${r.meta}` : `${r.count}`}</Text>
                  </View>
                ))}
              </ScrollView>
            )}
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: spacing.xs, fontWeight: '800' }}>POR LISTERO</Text>
            {resumenPorListero.length === 0 ? (
              <Text style={{ color: resumenError ? colors.danger : colors.muted, fontWeight: resumenError ? '700' : '400' }}>{resumenError ? `⚠️ No se pudo leer el resumen (${motivoLegible(resumenError)}).` : 'Sin viajes registrados hoy.'}</Text>
            ) : (
              <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
                {resumenPorListero.map((l) => (
                  <View key={l.name} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                    <Text style={{ color: colors.text }}>👤 {l.name}</Text>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>{l.count}</Text>
                  </View>
                ))}
              </ScrollView>
            )}
          </Card>

          <Card>
            <SectionTitle>⚠️ Camiones sin viaje reciente</SectionTitle>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
              Más de {alertaHoras}h sin registrar viaje (no incluye averiados, parados ni retirados).
            </Text>
            {alertList.length === 0 ? (
              <Text style={{ color: alertaError ? colors.danger : colors.success, fontWeight: '700' }}>{alertaError ? `⚠️ No se pudo revisar la alerta (${motivoLegible(alertaError)}). No se sabe si hay camiones parados.` : '✅ Todos los camiones tienen viajes recientes.'}</Text>
            ) : (
              <ScrollView style={{ maxHeight: 280 }} nestedScrollEnabled>
                {alertList.map((x) => (
                  <View key={x.truck.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 }}>
                    <View style={{ flexShrink: 1 }}>
                      <Text style={{ color: colors.text }}>🚜 {x.truck.code}</Text>
                      {(x.truck.plate || x.truck.serial) ? (
                        <Text style={{ color: colors.muted, fontSize: 11 }}>{[x.truck.plate ? `Placa ${x.truck.plate}` : null, x.truck.serial ? `Serial ${x.truck.serial}` : null].filter(Boolean).join(' · ')}</Text>
                      ) : null}
                    </View>
                    <Text style={{ color: colors.danger, fontWeight: '700' }}>
                      {x.last ? `${Math.floor(x.hrs)}h sin viaje` : 'sin viajes registrados'}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            )}
          </Card>

          <Card>
            <SectionTitle>Lista completa de viajes</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {PRESETS.map((p) => {
                const on = preset === p.key;
                return (
                  <TouchableOpacity
                    key={p.key}
                    onPress={() => setPreset(p.key)}
                    style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface, paddingHorizontal: spacing.sm, paddingVertical: 5 }}
                  >
                    <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{p.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Qué se está mirando, dicho en una línea. Sin esto, «días
                específicos» sin ningún día marcado se veía igual que «hoy». */}
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
              📅 {etiquetaRango}{rangoInvalido || sinDiasMarcados ? '' : ` · ${filteredRangeRows.length} viaje(s) · ${resumenTurno({ dia: resumenViajes.dia, noche: resumenViajes.noche, total: resumenViajes.total })}`}
            </Text>

            {preset === 'rango' ? (
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginBottom: 4 }}>DESDE</Text>
                  <DateField value={rangeFrom} onChange={setRangeFrom} maxISO={rangeTo} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginBottom: 4 }}>HASTA</Text>
                  <DateField value={rangeTo} onChange={setRangeTo} minISO={rangeFrom} />
                </View>
              </View>
            ) : null}

            {preset === 'dias' ? (
              <View style={{ marginTop: spacing.sm }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                  {Array.from(diasSel).sort().map((d) => (
                    <TouchableOpacity
                      key={d}
                      onPress={() => toggleDia(d)}
                      style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: colors.brand, backgroundColor: colors.brand, paddingHorizontal: spacing.sm, paddingVertical: 5 }}
                    >
                      <Text style={{ color: colors.brandContrast, fontWeight: '700', fontSize: 12 }}>{dmy(d)} ✕</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    onPress={() => setDiasPickOpen((o) => !o)}
                    style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.sm, paddingVertical: 5 }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>+ agregar día</Text>
                  </TouchableOpacity>
                </View>
                {diasPickOpen ? (
                  <View style={{ marginTop: spacing.xs }}>
                    <DateField value={todayISO} onChange={(iso) => { setDiasSel((prev) => new Set(prev).add(iso)); setDiasPickOpen(false); }} />
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* ⭐ TURNO. Va primero de los cuatro filtros porque es el corte más
                grueso: día o noche parte la jornada en dos mitades, y las otras
                tres preguntas (quién, de qué empresa, cuál camión) casi siempre
                se hacen ya dentro de una de las dos. */}
            {turnoOptions.length > 0 ? (
              <View style={{ marginTop: spacing.sm }}>
                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>
                  TURNO{filterTurnoSel.size > 0 ? ` (${filterTurnoSel.size})` : ' (los dos)'}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 }}>
                  {turnoOptions.map((o) => {
                    const on = filterTurnoSel.has(o.id);
                    return (
                      <TouchableOpacity
                        key={o.id}
                        onPress={() => toggleFilterTurno(o.id, o.label)}
                        style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface, paddingHorizontal: spacing.sm, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                      >
                        <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{o.label}</Text>
                        <Text style={{ color: on ? colors.brandContrast : colors.muted, fontSize: 11 }}>({o.count})</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
                  {leyendaTurnos()}. El turno sale de la HORA del viaje, que es la misma regla con la que se corta el día.
                </Text>
                {/* Se DICE en vez de corregirlo por lo bajo: son viajes a los que
                    alguien les movió la hora cruzando las 7am o las 7pm, así que
                    lo que quedó guardado en su día ya no concuerda con su hora. */}
                {viajesConTurnoDesacordado > 0 ? (
                  <Text style={{ color: colors.warning, fontSize: 11, marginTop: 2 }}>
                    ⚠️ {viajesConTurnoDesacordado} viaje(s) tienen guardado un turno distinto al de su hora (les corrigieron la hora). Manda la hora.
                  </Text>
                ) : null}
              </View>
            ) : null}

            {listeroOptions.length > 1 || filterListeroSel.size > 0 ? (
              <View style={{ marginTop: spacing.sm }}>
                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>
                  LISTERO{filterListeroSel.size > 0 ? ` (${filterListeroSel.size})` : ' (todos)'}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 }}>
                  {listeroOptions.map((o) => {
                    const on = filterListeroSel.has(o.id);
                    return (
                      <TouchableOpacity
                        key={o.id}
                        onPress={() => toggleFilterListero(o.id, o.label)}
                        style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface, paddingHorizontal: spacing.sm, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                      >
                        <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>👤 {o.label}</Text>
                        <Text style={{ color: on ? colors.brandContrast : colors.muted, fontSize: 11 }}>({o.count})</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {companyOptions.length > 1 || filterCompanySel.size > 0 ? (
              <View style={{ marginTop: spacing.sm }}>
                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>
                  EMPRESA{filterCompanySel.size > 0 ? ` (${filterCompanySel.size})` : ' (todas)'}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 }}>
                  {companyOptions.map((o) => {
                    const on = filterCompanySel.has(o.id);
                    return (
                      <TouchableOpacity
                        key={o.id}
                        onPress={() => toggleFilterCompany(o.id, o.label)}
                        style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface, paddingHorizontal: spacing.sm, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                      >
                        <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>🏢 {o.label}</Text>
                        <Text style={{ color: on ? colors.brandContrast : colors.muted, fontSize: 11 }}>({o.count})</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {truckOptions.length > 1 || filterTruckSel.size > 0 ? (
              <View style={{ marginTop: spacing.sm }}>
                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>
                  CAMIÓN{filterTruckSel.size > 0 ? ` (${filterTruckSel.size})` : ' (todos)'}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 4 }}>
                  {truckOptions.map((o) => {
                    const on = filterTruckSel.has(o.id);
                    return (
                      <TouchableOpacity
                        key={o.id}
                        onPress={() => toggleFilterTruck(o.id, o.label)}
                        style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface, paddingHorizontal: spacing.sm, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                      >
                        <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>🚜 {o.label}</Text>
                        <Text style={{ color: on ? colors.brandContrast : colors.muted, fontSize: 11 }}>({o.count})</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {(filterListeroSel.size > 0 || filterTruckSel.size > 0 || filterCompanySel.size > 0 || filterTurnoSel.size > 0) ? (
              <TouchableOpacity onPress={() => { setFilterListeroSel(new Map()); setFilterTruckSel(new Map()); setFilterCompanySel(new Map()); setFilterTurnoSel(new Map()); }} style={{ marginTop: spacing.xs, alignSelf: 'flex-start' }}>
                <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>✕ Limpiar filtros</Text>
              </TouchableOpacity>
            ) : null}

            {/* Modo del reporte: viaje por viaje, o globalizado por camión. */}
            <View style={{ marginTop: spacing.sm }}>
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>VISTA Y REPORTE</Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4 }}>
                {([['detallado', '📋 Detallado (viaje por viaje)'], ['resumen', '📊 Resumido (viajes por camión)']] as const).map(([key, label]) => {
                  const on = reporteModo === key;
                  return (
                    <TouchableOpacity
                      key={key}
                      onPress={() => setReporteModo(key)}
                      style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface, paddingHorizontal: spacing.sm, paddingVertical: 5 }}
                    >
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Eje del resumen. Solo tiene sentido en modo resumido: el
                  detallado ya trae una columna "Listero" en cada línea. */}
              {reporteModo === 'resumen' ? (
                <View style={{ marginTop: spacing.sm }}>
                  <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>AGRUPAR POR</Text>
                  <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4 }}>
                    {([['empresa', '🏢 Empresa'], ['listero', '👤 Listero']] as const).map(([key, label]) => {
                      const on = resumenEje === key;
                      return (
                        <TouchableOpacity
                          key={key}
                          onPress={() => setResumenEje(key)}
                          style={{ flex: 1, alignItems: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface, paddingHorizontal: spacing.sm, paddingVertical: 6 }}
                        >
                          <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
                    No saca ni agrega ningún viaje: solo cambia si el reporte viene partido por empresa o por quien registró. El total general es el mismo en los dos.
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={{ marginTop: spacing.sm }}>
              {/* ⚠️ EL ORDEN DE ESTAS RAMAS IMPORTA. «Rango al revés» y «ningún día
                  marcado» van PRIMERO porque en esos dos casos no se consulta
                  nada: si el spinner fuera antes, el aviso que explica qué
                  corregir quedaría tapado por un «cargando…» que no termina. */}
              {rangoInvalido || sinDiasMarcados ? (
                <Text style={{ color: rangoInvalido ? colors.danger : colors.muted, fontWeight: '700' }}>
                  {rangoInvalido
                    ? `⚠️ El rango está al revés: DESDE (${dmy(rangeBounds.desde)}) es posterior a HASTA (${dmy(rangeBounds.hasta)}). No se consultó nada — corrige las fechas.`
                    : 'No hay ningún día marcado. Toca «+ agregar día» y elige al menos uno.'}
                </Text>
              ) : rangeLoading || rangeDesactualizado ? (
                // `rangeDesactualizado`: lo cargado es de OTRO rango. Mostrarlo
                // bajo la etiqueta del rango nuevo era una mentira exportable.
                <Loading />
              ) : rangeMissing ? (
                <Text style={{ color: colors.muted }}>Aún no se configuró esta función en la base de datos.</Text>
              ) : filteredRangeRows.length === 0 ? (
                // Una lista vacía tiene varias causas MUY distintas y hasta ahora
                // todas decían lo mismo. Cada una se nombra con lo que hay que
                // hacer para arreglarla; si no, se lee como «ese día no se trabajó».
                <Text style={{ color: rangeError ? colors.danger : colors.muted, fontWeight: rangeError || filtrosSobrantes.length > 0 ? '700' : '400' }}>
                  {rangeError
                    ? `⚠️ No se pudieron cargar los viajes (${motivoLegible(rangeError)}). NO exportes el reporte hasta resolverlo: saldría incompleto.`
                    : filtrosSobrantes.length > 0
                      ? `Sin viajes: hay filtros marcados que no aparecen en este rango (${filtrosSobrantes.map((f) => ICONO_EJE[f.eje] + f.label).join(', ')}). Toca «✕ Limpiar filtros» o desmárcalos.`
                      : seleccion.listero.size + seleccion.empresa.size + seleccion.camion.size + seleccion.turno.size > 0
                        ? 'Sin viajes con esa combinación de filtros. Cada uno por separado sí tiene viajes en este rango, pero juntos no.'
                        : 'Sin viajes en el rango seleccionado.'}
                </Text>
              ) : reporteModo === 'resumen' ? (
                // Lo mismo que va a salir en el PDF, en pantalla: total general,
                // total por empresa y el desglose de sus camiones.
                <ScrollView style={{ maxHeight: 420 }} nestedScrollEnabled>
                  <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 15, marginBottom: spacing.xs }}>
                    TOTAL: {resumenViajes.total} viaje(s) · {resumenViajes.totalCamiones} camión(es)
                  </Text>
                  {/* El desglose siempre suma el total: `turnoDeViaje` le da turno
                      a TODAS las filas (nunca devuelve null), así que acá no hay
                      caso «sin turno» que contemplar. La librería sí lo admite,
                      para quien la llame con datos de otra procedencia. */}
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
                    {resumenTurno({ dia: resumenViajes.dia, noche: resumenViajes.noche, total: resumenViajes.total })}
                  </Text>
                  {resumenViajes.empresas.map((e) => (
                    <View key={e.key} style={{ marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, flex: 1 }} numberOfLines={2}>{porListero ? '👤' : '🏢'} {e.name}</Text>
                        <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 13 }}>{e.total} viaje(s)</Text>
                      </View>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>{resumenTurno({ dia: e.dia, noche: e.noche, total: e.total })}</Text>
                      {e.camiones.map((c, i) => (
                        <View key={`${e.key}-${i}`} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3, paddingLeft: spacing.sm }}>
                          <Text style={{ color: colors.muted, fontSize: 12, flex: 1 }} numberOfLines={1}>🚜 {c.code} · {c.placa}</Text>
                          <Text style={{ color: colors.muted, fontSize: 11, marginRight: spacing.xs }}>{resumenTurno({ dia: c.dia, noche: c.noche, total: c.viajes })}</Text>
                          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>{c.viajes}</Text>
                        </View>
                      ))}
                    </View>
                  ))}
                </ScrollView>
              ) : (
                <ScrollView style={{ maxHeight: 420 }} nestedScrollEnabled>
                  {filteredRangeRows.map((row) => renderRow(row, { canEdit: true, canDelete: true, showListero: true }))}
                </ScrollView>
              )}
            </View>

            <TouchableOpacity onPress={compartirReporte} disabled={shareBusy} style={[styles.registerBtn, { marginTop: spacing.md, opacity: shareBusy ? 0.6 : 1 }]}>
              <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 14 }}>
                {shareBusy ? 'Generando…' : '📤 Compartir / exportar reporte'}
              </Text>
            </TouchableOpacity>
          </Card>

          <Card>
            <SectionTitle>Configuración</SectionTitle>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginBottom: spacing.xs }}>UMBRAL DE ALERTA (HORAS SIN VIAJE)</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <TextInput
                value={alertaHorasInput}
                onChangeText={setAlertaHorasInput}
                keyboardType="numeric"
                style={[styles.input, { flex: 1 }]}
              />
              <TouchableOpacity onPress={saveAlertaHoras} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primary }}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>Guardar</Text>
              </TouchableOpacity>
            </View>

            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.md, marginBottom: spacing.xs }}>META DE VIAJES DIARIOS POR CAMIÓN</Text>
            {allTrucks.length === 0 ? (
              <Text style={{ color: colors.muted }}>Sin camiones.</Text>
            ) : (
              <ScrollView style={{ maxHeight: 320 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                {allTrucks.map((t) => (
                  <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text }}>🚜 {t.code}</Text>
                      {(t.plate || t.serial) ? (
                        <Text style={{ color: colors.muted, fontSize: 11 }}>{[t.plate ? `Placa ${t.plate}` : null, t.serial ? `Serial ${t.serial}` : null].filter(Boolean).join(' · ')}</Text>
                      ) : null}
                    </View>
                    <TextInput
                      value={metaEdits[t.id] ?? (metasByTruck[t.id] != null ? String(metasByTruck[t.id]) : '')}
                      onChangeText={(v) => setMetaEdits((prev) => ({ ...prev, [t.id]: v }))}
                      onBlur={() => { if (metaEdits[t.id] !== undefined) saveMeta(t.id); }}
                      keyboardType="numeric"
                      placeholder="—"
                      placeholderTextColor={colors.muted}
                      style={[styles.input, { width: 70, paddingVertical: 6, textAlign: 'center' }]}
                    />
                    <TouchableOpacity onPress={() => saveMeta(t.id)}>
                      <Text style={{ fontSize: 16 }}>💾</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}
          </Card>
        </>
      ) : null}

      {/* CAMIÓN QUE NO ESTÁ EN EL CATÁLOGO — se anota a mano SOLO para este viaje.
          No crea nada en `machinery`: no aparece en Control de Maquinaria, ni en
          Mantenimiento, ni en los reportes de flota, ni le llega a los inspectores. */}
      <Modal visible={fcOpen} transparent animationType="fade" onRequestClose={() => setFcOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16 }}>🚚 Camión que no está en la lista</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4, marginBottom: spacing.md }}>
              Se guarda <Text style={{ fontWeight: '800' }}>solo para este viaje</Text>. No se agrega al catálogo ni cambia nada más del sistema.
            </Text>

            <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 2 }}>Cómo se identifica *</Text>
            <TextInput
              value={fcCode}
              onChangeText={setFcCode}
              autoCapitalize="characters"
              placeholder="VOLTEO 88, CAMIÓN DE PÉREZ…"
              placeholderTextColor={colors.muted}
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }}
            />

            <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: spacing.sm, marginBottom: 2 }}>Placa, empresa o seña (opcional)</Text>
            <TextInput
              value={fcRef}
              onChangeText={setFcRef}
              autoCapitalize="characters"
              placeholder="A12BC3D · Transporte X · el rojo"
              placeholderTextColor={colors.muted}
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }}
            />
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>
              Mientras más datos pongas, más fácil le va a ser identificarlo a quien revisa los viajes.
            </Text>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
              <TouchableOpacity onPress={() => setFcOpen(false)} style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={confirmarFueraCatalogo} style={{ flex: 2, alignItems: 'center', paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.warning }}>
                <Text style={{ color: '#fff', fontWeight: '800' }}>Usar este camión</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: spacing.lg,
    },
    input: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: spacing.md,
      color: colors.text,
    },
    pickButton: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: spacing.md,
      backgroundColor: colors.surface,
    },
    registerBtn: {
      backgroundColor: colors.primary,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    timeInput: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      color: colors.text,
      width: 44,
      textAlign: 'center',
      fontWeight: '700',
    },
  });
