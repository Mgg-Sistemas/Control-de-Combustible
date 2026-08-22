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
import React, { useEffect, useMemo, useState } from 'react';
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
import { supabase } from '../lib/supabase';
import { levelMeets } from '../lib/permissions';
import { norm, cmpText } from '../lib/text';
import { caracasParts } from '../lib/jornada';
import { caracasToday, caracasNowShift, caracasBusinessToday } from '../lib/caracasDay';
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
import { QueuedViaje, QuarantinedViaje, subscribeViajesQueue, subscribeViajesQuarantine, enqueueViaje, flushViajesQueue, retryQuarantinedViajes } from '../lib/viajesOfflineQueue';

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
    const [{ data, error }, aCat, jCat, iShift] = await Promise.all([
      supabase
        .from('machinery')
        .select('id, code, plate, serial, clasificacion, marca, modelo, company_id, operational, en_espera, company:company_id(name)')
        .eq('active', true)
        .order('code'),
      fetchAveriaCat(),
      fetchJornadaCat(),
      fetchInspByShift(),
    ]);
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
    setCatalogoTrucks(catalogo);
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
  const [misViajesLoading, setMisViajesLoading] = useState(true);
  const loadMisViajes = async () => {
    if (!uid) return;
    setMisViajesLoading(true);
    const today = caracasToday();
    const { rows, missing } = await listMisViajesHoy(uid, `${today}T00:00:00-04:00`, `${today}T23:59:59-04:00`);
    setMisViajesLoading(false);
    setMisViajesMissing(missing);
    setMisViajes(rows);
  };

  // ── Cola offline: mismo tratamiento visual (insignia ámbar) que la del
  //    Inspector en SupervisorScreen — reintenta sola al recuperar señal. ──
  const [queuedItems, setQueuedItems] = useState<QueuedViaje[]>([]);
  // APARTADOS: los que fallaron por algo que no se arregla solo. Van aparte para
  // que un viaje roto no siga contando como "se sube solo" cuando no es cierto.
  const [stuckItems, setStuckItems] = useState<QuarantinedViaje[]>([]);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    if (!canWrite) return;
    const unsub = subscribeViajesQueue((items) => setQueuedItems(items));
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
    if (retrying) return;
    setRetrying(true);
    try {
      const r = await retryQuarantinedViajes();
      if (r.synced > 0) loadMisViajes();
      if (r.quarantined === 0) toast.success(r.synced > 0 ? `${r.synced} viaje(s) subido(s).` : 'Listo, no quedan viajes apartados.');
      else toast.error(`Siguen sin poder subirse ${r.quarantined} viaje(s). Avisa al administrador.`);
    } catch {
      toast.error('No se pudo reintentar. Revisa la conexión.');
    } finally {
      setRetrying(false);
    }
  };

  const misViajesDisplay: DisplayViaje[] = useMemo(() => {
    const queuedRows: DisplayViaje[] = queuedItems.map((q) => ({
      id: `queued-${q.id}`,
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
    const stuckRows: DisplayViaje[] = stuckItems.map((q) => ({
      id: `stuck-${q.id}`,
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
  }, [queuedItems, stuckItems, misViajes]);

  const doRegistrarViaje = async () => {
    if (!selectedTruck || registering) return;
    const estadoConteo = truckEstadoConteo(selectedTruck);
    if (ESTADO_ADVERSO.includes(estadoConteo)) {
      const meta = ESTADO_CONTEO_META[estadoConteo];
      const ok = await confirm(`Este camión figura ${meta.label.toUpperCase()}, ¿de todas formas quieres registrar el viaje?`);
      if (!ok) return;
    }
    setRegistering(true);
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
    if (isOnline()) {
      const { error, missing } = await registrarViaje(payload);
      setRegistering(false);
      if (missing) { toast.error('Falta configurar la tabla de viajes en la base de datos. Avisa al administrador.'); return; }
      if (error) { toast.error(error); return; }
      toast.success(`Viaje de ${selectedTruck.code} registrado.`);
      loadMisViajes();
    } else {
      await enqueueViaje(payload);
      setRegistering(false);
      toast.info('Sin señal: el viaje quedó guardado en el teléfono y se sube solo al recuperar conexión.');
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
  const loadResumen = async () => {
    if (!canFull) return;
    const today = caracasToday();
    const { rows } = await listTodosLosViajes({ desdeISO: `${today}T00:00:00-04:00`, hastaISO: `${today}T23:59:59-04:00` });
    setResumenRows(rows);
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
    resumenRows.forEach((r) => { const k = claveCamion(r); counts.set(k, (counts.get(k) ?? 0) + 1); });
    const ids = new Set<string>([...allTrucks.map((t) => t.id), ...resumenRows.map((r) => claveCamion(r))]);
    const arr = Array.from(ids).map((id) => {
      const info = infoOf.get(id) ?? { code: '—', plate: null, serial: null };
      return { id, ...info, count: counts.get(id) ?? 0, meta: metasByTruck[id] ?? null };
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
    const hastaISO = new Date().toISOString();
    const { rows } = await listTodosLosViajes({ desdeISO, hastaISO });
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
  const [rangeFrom, setRangeFrom] = useState(caracasToday());
  const [rangeTo, setRangeTo] = useState(caracasToday());
  const [diasSel, setDiasSel] = useState<Set<string>>(new Set([caracasToday()]));
  const [diasPickOpen, setDiasPickOpen] = useState(false);
  const [filterListeroSel, setFilterListeroSel] = useState<Set<string>>(new Set());
  const [filterTruckSel, setFilterTruckSel] = useState<Set<string>>(new Set());
  // Filtro por EMPRESA y modo del reporte (pedido del cliente 20-ago-2026). La
  // empresa NO viaja en `camion_viajes`: se resuelve por el camión (`truckById`),
  // que ya trae `companyId`/`companyName` desde `machinery`.
  const [filterCompanySel, setFilterCompanySel] = useState<Set<string>>(new Set());
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
  const toggleFilterListero = (id: string) => setFilterListeroSel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleFilterTruck = (id: string) => setFilterTruckSel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleFilterCompany = (id: string) => setFilterCompanySel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleDia = (iso: string) => setDiasSel((prev) => { const n = new Set(prev); n.has(iso) ? n.delete(iso) : n.add(iso); return n; });

  const todayISO = caracasToday();
  const rangeBounds = useMemo(() => {
    if (preset === 'hoy') return { desde: todayISO, hasta: todayISO };
    if (preset === 'semana') return { desde: weekStartISO(todayISO), hasta: todayISO };
    if (preset === 'mes') return { desde: `${todayISO.slice(0, 7)}-01`, hasta: todayISO };
    if (preset === 'rango') return { desde: rangeFrom || todayISO, hasta: rangeTo || todayISO };
    const arr = Array.from(diasSel).sort();
    return arr.length ? { desde: arr[0], hasta: arr[arr.length - 1] } : { desde: todayISO, hasta: todayISO };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, rangeFrom, rangeTo, diasSel, todayISO]);
  const desdeISO = `${rangeBounds.desde}T00:00:00-04:00`;
  const hastaISO = `${rangeBounds.hasta}T23:59:59-04:00`;

  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeMissing, setRangeMissing] = useState(false);
  const loadRangeRows = async () => {
    if (!canFull) return;
    setRangeLoading(true);
    const { rows, missing } = await listTodosLosViajes({ desdeISO, hastaISO });
    setRangeLoading(false);
    setRangeMissing(missing);
    setRangeRows(rows);
  };

  useEffect(() => {
    if (canFull) loadRangeRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canFull, desdeISO, hastaISO]);

  const dateScopedRows = useMemo(() => {
    if (preset === 'dias' && diasSel.size > 0) {
      return rangeRows.filter((r) => diasSel.has(caracasParts(new Date(r.registeredAt)).iso));
    }
    return rangeRows;
  }, [rangeRows, preset, diasSel]);

  const listeroOptions = useMemo(() => {
    const m = new Map<string, { id: string; name: string; count: number }>();
    dateScopedRows.forEach((r) => {
      const e = m.get(r.listeroId) ?? { id: r.listeroId, name: r.listeroName, count: 0 };
      e.count += 1;
      m.set(r.listeroId, e);
    });
    return Array.from(m.values()).sort((a, b) => cmpText(a.name, b.name));
  }, [dateScopedRows]);
  const truckOptions = useMemo(() => {
    const m = new Map<string, { id: string; code: string; count: number }>();
    dateScopedRows.forEach((r) => {
      // Por CLAVE, no por id: los fuera de catálogo no tienen id y se fundirían
      // todos en una sola opción del filtro (ver `claveCamion`).
      const k = claveCamion(r);
      const e = m.get(k) ?? { id: k, code: r.fueraCatalogo ? `${r.machineCode} (fuera de catálogo)` : r.machineCode, count: 0 };
      e.count += 1;
      m.set(k, e);
    });
    return Array.from(m.values()).sort((a, b) => cmpText(a.code, b.code));
  }, [dateScopedRows]);

  // Empresa de un viaje: la del camión que lo hizo. Los camiones sin empresa
  // asignada caen en una sola cubeta, para que no desaparezcan del filtro.
  const companyOfRow = (r: CamionViajeRow) => {
    // Un camión fuera de catálogo no tiene ficha que consultar: no se le inventa
    // empresa, cae en la misma cubeta que los que no la tienen asignada.
    const t = r.machineryId ? truckById.get(r.machineryId) : undefined;
    return { key: t?.companyId ?? SIN_EMPRESA, name: t?.companyName || 'Sin empresa' };
  };
  const companyOptions = useMemo(() => {
    const m = new Map<string, { id: string; name: string; count: number }>();
    dateScopedRows.forEach((r) => {
      const c = companyOfRow(r);
      const e = m.get(c.key) ?? { id: c.key, name: c.name, count: 0 };
      e.count += 1;
      m.set(c.key, e);
    });
    return Array.from(m.values()).sort((a, b) => cmpText(a.name, b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateScopedRows, truckById]);

  const filteredRangeRows = useMemo(
    () =>
      dateScopedRows.filter(
        (r) =>
          (filterListeroSel.size === 0 || filterListeroSel.has(r.listeroId)) &&
          (filterTruckSel.size === 0 || filterTruckSel.has(claveCamion(r))) &&
          (filterCompanySel.size === 0 || filterCompanySel.has(companyOfRow(r).key))
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dateScopedRows, filterListeroSel, filterTruckSel, filterCompanySel, truckById]
  );

  /**
   * VIAJES GLOBALIZADOS: cuántos viajes hizo cada camión, agrupados por empresa,
   * en vez de una línea por viaje. Es lo que pide el cliente para el reporte
   * "no desglosado": camión X → N viajes; y si se filtra por empresa, salen
   * TODOS sus camiones con el total de la empresa y su desglose.
   * Respeta exactamente los mismos filtros que la lista detallada.
   * La cuenta vive en `src/lib/viajesResumen.ts` (función pura, con test propio).
   */
  const resumenViajes = useMemo(
    () => resumirViajes(filteredRangeRows, (id) => truckById.get(id), resumenEje),
    [filteredRangeRows, truckById, resumenEje]
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
      const filtros = [
        filterCompanySel.size ? `Empresas: ${companyOptions.filter((c) => filterCompanySel.has(c.id)).map((c) => c.name).join(', ')}` : null,
        filterTruckSel.size ? `Camiones: ${truckOptions.filter((t) => filterTruckSel.has(t.id)).map((t) => t.code).join(', ')}` : null,
        filterListeroSel.size ? `Listeros: ${listeroOptions.filter((l) => filterListeroSel.has(l.id)).map((l) => l.name).join(', ')}` : null,
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
      const bodyResumen = `
        <p class="tot">TOTAL GENERAL: ${resumenViajes.total} viaje(s) · ${resumenViajes.totalCamiones} camión(es) · ${resumenViajes.empresas.length} ${palabraGrupo}</p>
        ${resumenViajes.empresas.map((e) => `
          <h3>${icoGrupo} ${esc(e.name)} — ${e.total} viaje(s) · ${e.camiones.length} camión(es)</h3>
          <table>
            <thead><tr><th>Camión</th><th>Placa / Serial</th><th style="text-align:right">Viajes</th></tr></thead>
            <tbody>
              ${e.camiones.map((c) => `<tr><td>${esc(c.code)}</td><td>${esc(c.placa)}</td><td style="text-align:right"><b>${c.viajes}</b></td></tr>`).join('')}
            </tbody>
            <tfoot><tr><td colspan="2"><b>Total ${esc(e.name)}</b></td><td style="text-align:right"><b>${e.total}</b></td></tr></tfoot>
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
                  `<tr><td>${esc(fmtFecha(r.registeredAt))}</td><td>${esc(fmtHora(r.registeredAt))}</td><td>${esc(companyOfRow(r).name)}</td><td>${esc(r.machineCode)}</td><td>${esc(placaDe(r))}</td><td>${esc(r.choferName ?? '—')}</td><td>${esc(r.listeroName)}</td><td>${esc(r.shift === 'night' ? 'Noche' : r.shift === 'day' ? 'Día' : '—')}</td><td>${esc(r.estadoMaquina ?? '—')}</td></tr>`
              )
              .join('')}
          </tbody>
          <tfoot><tr><td colspan="9">Total: ${filteredRangeRows.length} viajes</td></tr></tfoot>
        </table>`;

      // El corte del rango es por DÍA DE CALENDARIO (medianoche a medianoche),
      // no por jornada. Se dice en el subtítulo a propósito: una jornada de
      // noche va de 7pm a 7am, así que sus viajes salen repartidos en dos días
      // y quien lea el reporte tiene que saberlo antes de reclamar un faltante.
      const corte = 'días completos (00:00 a 23:59), no por jornada';
      const html = pdfDocument({
        title: reporteModo === 'resumen'
          ? (porListero ? 'Viajes de camiones · resumen por listero' : 'Viajes de camiones · resumen por camión')
          : 'Viajes de camiones',
        subtitle: `${dmy(rangeBounds.desde)} al ${dmy(rangeBounds.hasta)} · ${corte}${filtros ? ` · ${filtros}` : ''}`,
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
          <Text style={{ color: '#B42318', fontSize: 11, fontStyle: 'italic' }} numberOfLines={2}>{row.stuckError}</Text>
        ) : null}
        {placaSerial ? <Text style={{ color: colors.muted, fontSize: 11.5 }}>{placaSerial}</Text> : null}
        <Text style={{ color: colors.muted, fontSize: 12 }}>
          {fmtFecha(row.registeredAt)} · {fmtHora(row.registeredAt)} · {row.shift === 'night' ? '🌙 Noche' : row.shift === 'day' ? '☀️ Día' : '—'}
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
      {queuedItems.length > 0 ? (
        <View style={{ backgroundColor: '#FEF3C7', borderRadius: radius.md, borderWidth: 1, borderColor: '#F59E0B', padding: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 16 }}>📶</Text>
          <Text style={{ color: '#92400E', fontSize: 12.5, fontWeight: '700', flex: 1 }}>
            {queuedItems.length} {queuedItems.length === 1 ? 'viaje guardado' : 'viajes guardados'} en el teléfono sin subir. Se suben solos al recuperar señal.
          </Text>
        </View>
      ) : null}

      {/* APARTADOS: no se suben solos por más que se espere — hace falta que
          alguien resuelva la causa. Aviso ROJO y separado del ámbar de arriba,
          justamente para que no se confunda con "esperando señal". */}
      {stuckItems.length > 0 ? (
        <View style={{ backgroundColor: '#FEF3F2', borderRadius: radius.md, borderWidth: 1, borderColor: '#F97066', padding: spacing.sm, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 16 }}>⚠️</Text>
            <Text style={{ color: '#B42318', fontSize: 12.5, fontWeight: '700', flex: 1 }}>
              {stuckItems.length} {stuckItems.length === 1 ? 'viaje no pudo subirse' : 'viajes no pudieron subirse'}. NO se pierden, pero tampoco se suben solos: avisa al administrador.
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
        <SectionTitle>Mis viajes de hoy</SectionTitle>
        {misViajesLoading ? (
          <Loading />
        ) : misViajesMissing ? (
          <Text style={{ color: colors.muted }}>Aún no se configuró esta función en la base de datos. Avisa al administrador.</Text>
        ) : misViajesDisplay.length === 0 ? (
          <Text style={{ color: colors.muted }}>Todavía no registras viajes hoy.</Text>
        ) : (
          <ScrollView style={{ maxHeight: 360 }} nestedScrollEnabled>
            {misViajesDisplay.map((row) => renderRow(row, { canEdit: !row.queued && isEditableByListero(row), canDelete: false }))}
          </ScrollView>
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
                    </View>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>{r.meta != null ? `${r.count}/${r.meta}` : `${r.count}`}</Text>
                  </View>
                ))}
              </ScrollView>
            )}
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: spacing.xs, fontWeight: '800' }}>POR LISTERO</Text>
            {resumenPorListero.length === 0 ? (
              <Text style={{ color: colors.muted }}>Sin viajes registrados hoy.</Text>
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
              <Text style={{ color: colors.success, fontWeight: '700' }}>✅ Todos los camiones tienen viajes recientes.</Text>
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

            {listeroOptions.length > 1 ? (
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
                        onPress={() => toggleFilterListero(o.id)}
                        style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface, paddingHorizontal: spacing.sm, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                      >
                        <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>👤 {o.name}</Text>
                        <Text style={{ color: on ? colors.brandContrast : colors.muted, fontSize: 11 }}>({o.count})</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {companyOptions.length > 1 ? (
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
                        onPress={() => toggleFilterCompany(o.id)}
                        style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface, paddingHorizontal: spacing.sm, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                      >
                        <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>🏢 {o.name}</Text>
                        <Text style={{ color: on ? colors.brandContrast : colors.muted, fontSize: 11 }}>({o.count})</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {truckOptions.length > 1 ? (
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
                        onPress={() => toggleFilterTruck(o.id)}
                        style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface, paddingHorizontal: spacing.sm, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                      >
                        <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>🚜 {o.code}</Text>
                        <Text style={{ color: on ? colors.brandContrast : colors.muted, fontSize: 11 }}>({o.count})</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {(filterListeroSel.size > 0 || filterTruckSel.size > 0 || filterCompanySel.size > 0) ? (
              <TouchableOpacity onPress={() => { setFilterListeroSel(new Set()); setFilterTruckSel(new Set()); setFilterCompanySel(new Set()); }} style={{ marginTop: spacing.xs, alignSelf: 'flex-start' }}>
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
              {rangeLoading ? (
                <Loading />
              ) : rangeMissing ? (
                <Text style={{ color: colors.muted }}>Aún no se configuró esta función en la base de datos.</Text>
              ) : filteredRangeRows.length === 0 ? (
                <Text style={{ color: colors.muted }}>Sin viajes en el rango seleccionado.</Text>
              ) : reporteModo === 'resumen' ? (
                // Lo mismo que va a salir en el PDF, en pantalla: total general,
                // total por empresa y el desglose de sus camiones.
                <ScrollView style={{ maxHeight: 420 }} nestedScrollEnabled>
                  <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 15, marginBottom: spacing.xs }}>
                    TOTAL: {resumenViajes.total} viaje(s) · {resumenViajes.totalCamiones} camión(es)
                  </Text>
                  {resumenViajes.empresas.map((e) => (
                    <View key={e.key} style={{ marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, flex: 1 }} numberOfLines={2}>{porListero ? '👤' : '🏢'} {e.name}</Text>
                        <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 13 }}>{e.total} viaje(s)</Text>
                      </View>
                      {e.camiones.map((c, i) => (
                        <View key={`${e.key}-${i}`} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3, paddingLeft: spacing.sm }}>
                          <Text style={{ color: colors.muted, fontSize: 12, flex: 1 }} numberOfLines={1}>🚜 {c.code} · {c.placa}</Text>
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
