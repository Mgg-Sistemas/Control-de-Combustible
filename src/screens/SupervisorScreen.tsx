import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, ActivityIndicator, Image, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { Screen, Card, SectionTitle, Loading, EmptyState, Badge, SkeletonList } from '../components/ui';
import { useConfirm } from '../components/ConfirmProvider';
import { BiometricToggle } from '../components/BiometricToggle';
import { ConfigBanner } from '../components/ConfigBanner';
import { useAuth } from '../context/AuthContext';
import { supabase, selectAllRows } from '../lib/supabase';
import { norm, cmpText } from '../lib/text';
import { motivoParada } from '../lib/paradaMotivo';
import EdificioPicker from '../components/EdificioPicker';
import { addEdificio } from '../lib/edificios';
import { sectorOf, sectorLabel } from '../lib/mapZones';
import { Machinery, SupervisorVisit, VisitStatus, Employee, Attendance } from '../types/database';
import { getCurrentCoords, warmLocation } from '../lib/location';
import { captureAndUploadPhoto } from '../lib/photo';
import { saveVisit, myVisitsToday, haversineM, VISIT_NEAR_M } from '../lib/supervisorVisits';
import QrScanner from '../components/QrScanner';
import HistoricoJornadasScreen from './HistoricoJornadasScreen';
import { SurtidoGasoilModal } from '../components/SurtidoGasoil';
import { parseMachineId, parseEmployeeId } from './ScanQrScreen';
import { startJornada, isOperatorCargo, shiftOf, shiftFromKey, caracasParts } from '../lib/jornada';
import { caracasBusinessToday, nightGraceRoundDate, inNightGraceWindow, businessRoundDateOf } from '../lib/caracasDay';
import { VISIT_STATUS_META } from '../lib/statusMeta';
import { getMachineRound, upsertMachineRound, lastHorometroFinal } from '../lib/machineRounds';
import { listInspectorAssignments, assignInspector, unassignInspector, Shift, shiftIcon, shiftLabel, PLACEHOLDER_INSPECTOR_ID, inspectorSiempreActivo } from '../lib/machineInspectors';
import { logAudit } from '../lib/audit';
import { notifyAdmins } from '../lib/notify';
import { logTruckYardIfTruck } from '../lib/truckYard';
import { markAttendance, pairMarks, fmtHora, nextKind, shiftOfTs, SHIFT_LABEL } from '../lib/attendance';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { ChangePasswordButton } from '../components/ChangePasswordButton';
import { isOnline, isNetworkErrorMsg, enqueueAveria, enqueueParada, enqueueVolverOperativa, subscribeQueue, flushQueue, onConnectivityChange } from '../lib/offlineQueue';
import { generateMyShiftReceipt } from '../lib/inspectorReport';
import InspectorHeaderBar from '../components/redesign/InspectorHeaderBar';
import InspectorHeroCard from '../components/redesign/InspectorHeroCard';
import InspectorKpiGrid from '../components/redesign/InspectorKpiGrid';
import InspectorSearchBar from '../components/redesign/InspectorSearchBar';
import CoordinadorInspectoresView from '../components/CoordinadorInspectoresView';

const CARACAS_TZ = 'America/Caracas';
// Umbral mínimo defensivo (MISMO criterio que `MIN_WORKED_HOURS` en
// `inspectorDaySets.ts` y que la copia ya alineada en `SupervisionScreen.tsx`):
// un round con `round_date` mal calculado por cruce de medianoche del turno
// NOCHE (BUG 10-ago-2026, ver `businessRoundDateOf` en `caracasDay.ts`) puede
// dejar un residuo mínimo de horas (~0.02h) pegado al round de HOY. Sin este
// umbral, `hoursMine`/`hoursEn` (y por lo tanto `segmentoDe`/`segmentoConTurno`)
// contaban ese residuo como "finalizó la jornada" y el círculo del teléfono
// mostraba 🏁 Finalizada en un turno que en realidad todavía no había
// arrancado — mientras la PC (ya con este mismo umbral) mostraba correctamente
// "pendiente". 0.05h (3 min) está muy por debajo de cualquier jornada real.
const MIN_WORKED_HOURS = 0.05;
/** Día ISO (AAAA-MM-DD) de hoy en horario de Caracas. */
function caracasToday(): string {
  const p: any = new Intl.DateTimeFormat('en-CA', { timeZone: CARACAS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((a: any, x) => { a[x.type] = x.value; return a; }, {});
  return `${p.year}-${p.month}-${p.day}`;
}
function caracasClock(iso: string): string {
  return new Intl.DateTimeFormat('es-VE', { timeZone: CARACAS_TZ, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso));
}
/** Hora ACTUAL del sistema (Caracas) como "HH:MM" (24h) — es el default REAL al
 *  iniciar una jornada (la hora en que de verdad se está iniciando), en vez de un
 *  7:00am/7:00pm fijo. El inspector puede corregirla si hace falta. */
function nowHHMM(): string {
  const p: any = new Intl.DateTimeFormat('en-GB', { timeZone: CARACAS_TZ, hour12: false, hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date()).reduce((a: any, x) => { a[x.type] = x.value; return a; }, {});
  return `${p.hour}:${p.minute}`;
}
/** Retraso legible a partir de minutos: "45 min", "1 h", "1 h 30 min". */
function retrasoLabel(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60), r = m % 60;
  if (h <= 0) return `${r} min`;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}
/** Tiempo transcurrido "Xh YYm" entre el inicio (ISO) y ahora (ms). */
function elapsedLabel(startISO: string, nowMs: number): string {
  const ms = Math.max(0, nowMs - new Date(startISO).getTime());
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

type Mach = Machinery & { companyName?: string; latitude?: number | null; longitude?: number | null };

// Estado de visita (trabajando/parada/no está): antes duplicado aquí con hex
// propio, ahora tomado de src/lib/statusMeta.ts (mismo mapa que usa SupervisionScreen).
const STATUS_OPTS: { key: VisitStatus; label: string; icon: string; color: string }[] =
  (Object.keys(VISIT_STATUS_META) as VisitStatus[]).map((key) => ({ key, ...VISIT_STATUS_META[key] }));
const statusLabel = (s: VisitStatus) => VISIT_STATUS_META[s]?.label ?? s;
// Tono del Badge para el estatus del empleado (activo/inactivo/suspendido),
// usado en la ficha de asistencia.
const empStatusTone = (s: string): 'success' | 'warning' | 'danger' | 'muted' =>
  s === 'activo' ? 'success' : s === 'suspendido' ? 'warning' : s === 'inactivo' ? 'danger' : 'muted';

// Materiales de la avería de maquinaria (igual que la vista del operador). Cae en
// el módulo de Mantenimiento de Maquinaria (tabla maintenance_requests).
const AV_MATERIALS: { key: string; label: string; icon: string }[] = [
  { key: 'caucho', label: 'Caucho', icon: '🛞' },
  { key: 'aceite', label: 'Aceite', icon: '🛢️' },
  { key: 'filtro', label: 'Filtro', icon: '🧴' },
  { key: 'repuesto', label: 'Repuesto', icon: '🔩' },
];
const avNumOrNull = (s: string) => { const n = Number((s || '').replace(',', '.')); return isFinite(n) && s.trim() !== '' ? n : null; };
// Igual que arriba + "Otro" (falla libre): se usa en el camino "PARADA · por avería"
// para describir fallas que no calzan en los materiales predeterminados.
const PARADA_AV_MATERIALS: { key: string; label: string; icon: string }[] = [
  ...AV_MATERIALS,
  { key: 'otro', label: 'Otro', icon: '✏️' },
];
const matLabelOf = (key: string) => PARADA_AV_MATERIALS.find((m) => m.key === key)?.label ?? key;
// Edificio/sector legible a partir de coordenadas (o la referencia escrita a mano si no cae en zona).
const edificioTextOf = (lat: number, lng: number, referencia?: string): string => {
  const s = sectorLabel(sectorOf(lat, lng));
  return s && s !== 'Sin zona' ? s : ((referencia || '').trim() || 'Sin zona');
};

/**
 * Vista del SUPERVISOR: sale a revisar máquinas. Por cada una hace un check-in
 * ("Revisé la máquina") con hora + GPS + estado (trabajando/parada/no está).
 * Ese check-in VALIDA la jornada: sin visita, la máquina-día queda sin validar
 * (el operador no cobra). Ve sus máquinas asignadas (🪖) y puede escanear el QR.
 */
export default function SupervisorScreen({ initialMachineId, onConsumed, onSistema }: { initialMachineId?: string; onConsumed?: () => void; onSistema?: () => void } = {}) {
  const { colors } = useTheme();
  const confirm = useConfirm();
  const { session, signOut, role, canSee, appRole } = useAuth();
  const uid = session?.user?.id ?? '';
  const today = caracasToday();
  // AYER (Caracas): una jornada de NOCHE cruza la medianoche (round_date = ayer). Sin
  // esto, al pasar las 12 la vista solo miraba "hoy" y la jornada de noche desaparecía
  // (parecía cerrada a medianoche). Se usa para rescatar la noche de ayer aún abierta.
  const yesterday = useMemo(() => { const d = new Date(`${today}T12:00:00-04:00`); d.setUTCDate(d.getUTCDate() - 1); return caracasParts(d).iso; }, [today]);
  // Límite para "rescatar" jornadas abiertas de días anteriores (ver reloadEstados):
  // cubre el caso de que auto_close_jornadas() falle varios días seguidos sin dejar
  // rondas huérfanas invisibles para siempre en el teléfono.
  const rescueCutoff = useMemo(() => { const d = new Date(`${today}T12:00:00-04:00`); d.setUTCDate(d.getUTCDate() - 7); return caracasParts(d).iso; }, [today]);
  const consumedRef = useRef(false);
  // Solo los usuarios con permiso del módulo 'asistencia' pueden marcar la
  // asistencia del personal desde esta vista (botón + modal más abajo).
  const canAsistencia = canSee('asistencia');

  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(true);
  const [machines, setMachines] = useState<Mach[]>([]);
  const [mineIds, setMineIds] = useState<Set<string>>(new Set());
  const [visits, setVisits] = useState<Record<string, SupervisorVisit>>({});
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  // Filtro por segmento (chips) para la vista admin "Ver todas".
  const [segFilter, setSegFilter] = useState<'all' | 'pendiente' | 'iniciada' | 'cerrada' | 'parada' | 'averia'>('all');
  // Lista de "Todas las máquinas" (vista admin) COLAPSADA por defecto: no se
  // pintan las filas hasta que el usuario la despliega, para no volcar de una
  // vez las ~200 máquinas. Ya combinada con los chips de segmento de arriba.
  const [allListOpen, setAllListOpen] = useState(false);
  // "Mis máquinas" (vista del inspector) agrupadas por ESTADO, cada grupo COLAPSABLE
  // (cerrado por defecto) y con su propio buscador.
  const [grpOpen, setGrpOpen] = useState<Record<string, boolean>>({});
  const [grpQuery, setGrpQuery] = useState<Record<string, string>>({});
  // ── COORDINADOR DE INSPECTORES: conmutador de la pantalla entre "🚜 Máquinas" (la
  //    vista de siempre, con SUS máquinas) e "👥 Inspectores" (operar por cada
  //    inspector). Buscador + acordeón por inspector propios de esa sub-vista.
  const [coordTab, setCoordTab] = useState<'maquinas' | 'inspectores'>('maquinas');
  const [coordQuery, setCoordQuery] = useState('');
  const [coordExpanded, setCoordExpanded] = useState<Set<string>>(new Set());
  const [scanOpen, setScanOpen] = useState(false);
  // ── CHECK MÁQUINA: asignar/desasignar máquinas al inspector logueado. Cada
  //    inspector solo ve las que tiene asignadas (se casa persona ↔ máquina).
  const [checkOpen, setCheckOpen] = useState(false);
  const [checkQuery, setCheckQuery] = useState('');
  const [assignBusy, setAssignBusy] = useState<string | null>(null); // clave máquina+turno que se está asignando
  // Asignaciones por máquina: quién es el inspector de DÍA y de NOCHE.
  type SlotInfo = { id: string | null; name: string };
  const [assignMap, setAssignMap] = useState<Record<string, { day?: SlotInfo; night?: SlotInfo }>>({});
  // SOLO ADMINISTRADORES pueden asignar máquinas a los inspectores (CHECK MÁQUINA).
  // Se basa en el ROL REAL, no en el prop onSistema: así el admin también asigna
  // cuando entró por el QR de una máquina (donde no se inyecta onSistema), y ningún
  // otro rol puede asignar nunca. onSistema queda solo para el botón "SISTEMA".
  const isAdmin = role === 'admin'; // puede ver todas las máquinas y asignarlas
  // COORDINADOR DE INSPECTORES (rol fijo): además de sus propias máquinas, opera por
  // cualquier inspector (iniciar jornada / avería / parada / ubicación) desde la
  // sub-vista "👥 Inspectores". Es como un inspector con superpoderes: puede tocar
  // máquina de otro y cualquier turno. La atribución sigue siendo del inspector dueño
  // de la máquina (así se le "marca" a él); queda traza de que lo registró el coordinador.
  const esCoordInsp = role === 'coordinador_inspectores';
  // Coordinador de inspectores por ROL fijo O por PERMISO de módulo (sin contar admin).
  // Se usa para la TRAZA "registrado por coordinador" y, vía puedeCoordinar, para
  // desbloquear las acciones sobre máquina ajena (antes solo el rol las desbloqueaba,
  // así que un coordinador-por-permiso veía la vista pero al tocar una máquina le
  // salía 🔒 y "no hacía nada").
  const esCoordinador = esCoordInsp || canSee('coordinador_inspectores');
  // COORDINAR INSPECTORES (CHECK máquina, pendientes por asignar, asignar/reasignar
  // inspector, ver "Todas las máquinas"): el admin SIEMPRE puede (isAdmin va en el OR,
  // no se le quita nada) y, ADEMÁS, cualquiera con el módulo 'coordinador_inspectores'
  // (permiso nuevo, por defecto 'none') también puede. Es ADITIVO: no toca ninguna otra
  // acción del inspector normal (marcar máquina parada, iniciar/finalizar jornada, etc.).
  // Incluye a TODOS los coordinadores: el de inspectores (rol fijo o permiso), el de
  // PATIO y el de QR. Antes estos dos últimos podían iniciar jornadas de cualquier
  // máquina pero NO reasignar inspectores (CHECK MÁQUINA) — pedido del cliente: los
  // coordinadores pueden REASIGNAR las máquinas.
  const puedeCoordinar = isAdmin || esCoordInsp || canSee('coordinador_inspectores')
    || role === 'coordinador_patio' || appRole?.panel_type === 'coordinador_qr';
  // ADMIN/COORDINADOR EN EL TELÉFONO: arranca viendo TODAS las máquinas (con buscador),
  // no la lista vacía "Mis máquinas". Se activa UNA sola vez al detectarse el permiso
  // (puede llegar async); luego puede tocar "Solo las mías" sin que se vuelva a forzar.
  const showAllInit = useRef(false);
  useEffect(() => {
    if (puedeCoordinar && !showAllInit.current) { showAllInit.current = true; setShowAll(true); }
  }, [puedeCoordinar]);
  // SOLO ADMIN: asigna máquinas a un INSPECTOR (no a sí mismo). Lista de inspectores
  // y el inspector elegido en el modal del CHECK.
  const [inspectors, setInspectors] = useState<{ id: string; name: string; role: string | null }[]>([]);
  const [checkInspector, setCheckInspector] = useState<{ id: string; name: string } | null>(null);
  const [inspQuery, setInspQuery] = useState('');
  // CHECK máquina: pestaña Asignar vs Resumen (colapsado por inspector + pendientes).
  const [checkMode, setCheckMode] = useState<'assign' | 'resumen'>('assign');
  // Selección MÚLTIPLE para asignar/reasignar por LOTE (paso 2). Filtro "solo pendientes".
  const [selIds, setSelIds] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  // ── "↪ Reasignar a…": mover una o varias máquinas a OTRO inspector destino (elegido
  //    en línea, sin volver al paso 1) y luego DÍA / NOCHE / AMBOS. Disponible en la
  //    barra de lote y por máquina. `reassign` = ids a mover; `reassignTo` = destino.
  const [reassign, setReassign] = useState<{ ids: string[] } | null>(null);
  const [reassignTo, setReassignTo] = useState<{ id: string; name: string } | null>(null);
  const [reassignQuery, setReassignQuery] = useState('');
  const [reassignBusy, setReassignBusy] = useState(false);
  type CheckFilterMode = 'mine' | 'pending' | 'all';
  const [checkFilter, setCheckFilter] = useState<CheckFilterMode>('mine');
  // Acordeón del Resumen: inspectores/pendientes expandidos (por id o 'pend').
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // CHECK · modo "🕓 Pendientes por asignar": máquinas que quedaron sin inspector en
  // algún turno (p. ej. al borrar un inspector, sus máquinas caen aquí). Buscable.
  const [pendOpen, setPendOpen] = useState(false);
  const [pendQuery, setPendQuery] = useState('');
  // CHECK · "Pendientes por asignar" → asignación POR LOTES: máquinas marcadas con
  // checkbox + selector de inspector/turno que las asigna todas de una vez (llama a
  // assignInspector en bucle, una vez por máquina seleccionada).
  const [pendSelected, setPendSelected] = useState<Set<string>>(new Set());
  const [pendBatchOpen, setPendBatchOpen] = useState(false);
  const [pendBatchShift, setPendBatchShift] = useState<Shift>('day');
  const [pendBatchQuery, setPendBatchQuery] = useState('');
  const [pendBatchBusy, setPendBatchBusy] = useState(false);
  // Asignar/reasignar inspector DESDE una máquina (lista "Todas las máquinas", solo
  // admin/coordinador). No hay que elegir inspector primero: se abre la máquina y se le
  // pone el inspector de día/noche. Sincroniza en vivo (machine_inspectors + realtime).
  const [assignFor, setAssignFor] = useState<Mach | null>(null);
  const [pickShift, setPickShift] = useState<Shift | null>(null); // turno que se está eligiendo
  const [assignForQuery, setAssignForQuery] = useState('');
  // Estado de la jornada por máquina (para el círculo 🟢/🟡/🔴):
  //   round del día (jornada abierta / horas) + máquinas con avería PARADA pendiente.
  // Jornada por máquina, SEPARADA por turno: `open`/`worked` = global (compatibilidad
  // con visibleParaInspector). `openDay/openNight` y `dayWorked/nightWorked` = por turno
  // → así "iniciada/trabajando" NO se refleja del inspector de día al de noche (ni viceversa).
  const [roundsById, setRoundsById] = useState<Record<string, { open: boolean; worked: number; openDay: boolean; openNight: boolean; dayWorked: number; nightWorked: number; openStartDay: number; openStartNight: number }>>({});
  // Paradas VIGENTES (crudas) con su TURNO (día/noche, por hora Caracas de la marca).
  // La parada es POR TURNO: la que marca el inspector de DÍA no le aplica al de NOCHE.
  const [paradaRawList, setParadaRawList] = useState<{ id: string; shift: 'day' | 'night'; motivo: string; arrastrada: boolean; createdMs: number }[]>([]);
  // TAREA 1: máquinas con una AVERÍA REAL pendiente hoy (material distinto de
  // 'MÁQUINA PARADA'), para distinguir "Parada" (marcarParadaNoTrabajo) de "Por
  // avería" (marcarParadaAveria / registrarAveria) en los chips de segmento.
  const [averiaPendienteIds, setAveriaPendienteIds] = useState<Set<string>>(new Set());
  // Averías marcadas HOY (no arrastradas): GANAN sobre "trabajando". Las arrastradas
  // (en averiaPendienteIds) pierden si la máquina trabaja hoy — igual que las paradas.
  const [averiaHoyIds, setAveriaHoyIds] = useState<Set<string>>(new Set());
  // Averías VIGENTES (crudas) con su TURNO (por hora Caracas de la marca) — misma regla
  // POR TURNO que las paradas: la avería que marca el de DÍA no le aplica al de NOCHE.
  const [averiaRawList, setAveriaRawList] = useState<{ id: string; shift: 'day' | 'night'; arrastrada: boolean; createdMs: number }[]>([]);
  const [gasoilId, setGasoilId] = useState<string | null>(null); // surtir gasoil a la máquina del check-in
  const [notice, setNotice] = useState<string | null>(null);
  // ── Cola offline: acciones guardadas en el teléfono porque no había señal, a
  //    la espera de subirse. `pendingSync` es solo para la insignia/aviso; el
  //    flush real vive en src/lib/offlineQueue.ts (persistido en AsyncStorage,
  //    sobrevive a cerrar la app). Se reintenta solo al volver la conexión y,
  //    por si acaso, con un ping periódico (algunos navegadores no disparan
  //    'online' de forma confiable en datos móviles).
  const [pendingSync, setPendingSync] = useState(0);
  useEffect(() => {
    const unsub = subscribeQueue((items) => setPendingSync(items.length));
    const tryFlush = () => { flushQueue().catch(() => {}); };
    tryFlush();
    const unsubConn = onConnectivityChange((online) => { if (online) tryFlush(); });
    const poll = setInterval(tryFlush, 30000);
    return () => { unsub(); unsubConn(); clearInterval(poll); };
  }, []);
  // Rediseño de header/hero/KPIs/buscador — antes era una PREVIEW detrás de
  // ?ui=v2 en la URL (así nunca se veía en el teléfono real, solo en web con
  // ese parámetro). Ya validado, pasa a ser lo que ve todo el mundo. La rama
  // vieja (más abajo, `!uiV2`) se deja intacta como respaldo por ahora — se
  // puede quitar en una limpieza aparte una vez confirmado en producción.
  const [uiV2] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  // Buscador único de "Mis máquinas" (preview v2): al escribir, filtra las 4
  // categorías a la vez (antes cada una tenía su propio buscador) y las abre
  // si hay coincidencias — no toca `grupos` ni `renderMachine`, solo reusa
  // `grpQuery`/`grpOpen` que ya existían por categoría.
  const [mineQuery, setMineQuery] = useState('');
  const onMineQueryChange = (t: string) => {
    setMineQuery(t);
    setGrpQuery({ iniciadas: t, pendientes: t, paradas: t, averiadas: t });
    if (t.trim()) setGrpOpen({ iniciadas: true, pendientes: true, paradas: true, averiadas: true });
  };

  // ── ASISTENCIA DEL PERSONAL (solo usuarios con permiso 'asistencia') ────────
  // Modal en esta misma pantalla: escanea el carnet o busca al empleado, y marca
  // ENTRADA/SALIDA inteligente (según su última marca de hoy). No hay reporte aquí.
  type AsisEmp = Pick<Employee, 'id' | 'first_name' | 'last_name' | 'cedula' | 'cargo' | 'company_id' | 'photo_url' | 'status'>;
  const ASIS_COLS = 'id, first_name, last_name, cedula, cargo, company_id, photo_url, status';
  const asisFullName = (e?: AsisEmp | null) => (e ? `${e.first_name} ${e.last_name}`.trim() : '');
  const [asisOpen, setAsisOpen] = useState(false);
  const [asisScan, setAsisScan] = useState(false);
  const [asisEmp, setAsisEmp] = useState<AsisEmp | null>(null);
  const [asisToday, setAsisToday] = useState<Attendance[]>([]); // marcas de HOY del empleado elegido
  const [asisBusy, setAsisBusy] = useState(false);
  const [asisQuery, setAsisQuery] = useState('');
  const [asisResults, setAsisResults] = useState<AsisEmp[]>([]);
  const [asisNotice, setAsisNotice] = useState<string | null>(null);

  // ── Check-in ──────────────────────────────────────────────────────────────
  const [ci, setCi] = useState<Mach | null>(null);
  const [ciStatus, setCiStatus] = useState<VisitStatus>('trabajando');
  const [ciNote, setCiNote] = useState('');
  const [ciMotivo, setCiMotivo] = useState(''); // motivo de la avería cuando la máquina está PARADA
  const [ciSaving, setCiSaving] = useState(false);
  // ── Jornada por TIEMPO (INICIAR → FINALIZAR). El inicio se guarda en la BD
  //    (machine_rounds.jornada_start_at) para que sobreviva aunque se cierre la
  //    pantalla. Al finalizar, las horas = (fin − inicio) van a Control (día/noche).
  const [jornadaStart, setJornadaStart] = useState<string | null>(null);
  const [jornadaShift, setJornadaShift] = useState<'day' | 'night'>('day');
  const [showHist, setShowHist] = useState(false); // modal Histórico por inspector (tlf)
  const [jornadaBusy, setJornadaBusy] = useState(false);
  const [finConfirm, setFinConfirm] = useState(false); // aviso de confirmación antes de finalizar
  // Horas ya registradas hoy en el round de la máquina abierta (para saber si el
  // turno del inspector ya se cumplió hoy → no puede reiniciarlo el mismo día).
  const [curRoundHours, setCurRoundHours] = useState<{ day: number; night: number }>({ day: 0, night: 0 });
  // round_date real de `curRoundHours` (hoy, o ayer si se rescató la jornada de noche que
  // cruza medianoche) — lo necesita `marcarParadaNoTrabajo` para corregir horas ya
  // cerradas cuando el inspector dice que la máquina NO trabajó (ver su comentario).
  const [curRoundDate, setCurRoundDate] = useState<string | null>(null);
  // Horómetro: al iniciar se pide el INICIAL (precargado con el último final de la
  // máquina); al finalizar se pide el FINAL (que será el inicial de la próxima jornada).
  const [horoIni, setHoroIni] = useState('');
  const [horoFin, setHoroFin] = useState('');
  // Foto del horómetro que adjunta el inspector/coordinador al INICIAR y al FINALIZAR
  // la jornada (se guarda en machine_rounds.horometro_photo → se ve en Mantenimiento
  // de Maquinaria · Horómetros). Ambas son opcionales (no bloquean la jornada).
  const [horoIniPhoto, setHoroIniPhoto] = useState<string | null>(null);
  const [horoFinPhoto, setHoroFinPhoto] = useState<string | null>(null);
  const [horoPhotoBusy, setHoroPhotoBusy] = useState<false | 'ini' | 'fin'>(false);
  // Al iniciar jornada: turno declarado y HORA de inicio (por defecto 7:00am día /
  // 7:00pm noche). Se acota contra la hora del sistema (alerta si se declara tarde).
  const [iniShift, setIniShift] = useState<'day' | 'night'>('day');
  const [iniTime, setIniTime] = useState('07:00');
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [paradaOpen, setParadaOpen] = useState(false); // desplegable del motivo de la avería (PARADA)
  // 🟡 PARADA: dos caminos seleccionables — "por avería" (crea solicitud en
  // Mantenimiento con el material) o "no trabajó" (motivo fijo + ubicación, solo
  // se refleja en Inspecciones, no toca Mantenimiento).
  const [paradaTab, setParadaTab] = useState<'averia' | 'no_trabajo'>('averia');
  const [paMaterial, setPaMaterial] = useState<string | null>(null); // material que necesita (camino "por avería")
  const [paQty, setPaQty] = useState('');
  const [paPhoto, setPaPhoto] = useState<string | null>(null);
  const [paPhotoUp, setPaPhotoUp] = useState(false);
  const [ntBusy, setNtBusy] = useState(false); // obteniendo la ubicación GPS (camino "no trabajó")
  const [ntCoords, setNtCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [ntMotivo, setNtMotivo] = useState(''); // motivo que ESCRIBE el inspector para "no trabajó" (opcional)
  const [savingMachLoc, setSavingMachLoc] = useState(false); // guardar la ubicación de la MÁQUINA desde el check-in
  const [ciRef, setCiRef] = useState(''); // referencia (edificio) de la ubicación — del catálogo
  // Avería de maquinaria (igual que el operador) → maintenance_requests.
  const [avOpen, setAvOpen] = useState(false);
  const [avMaterial, setAvMaterial] = useState<string | null>(null);
  const [avQty, setAvQty] = useState('');
  const [avNote, setAvNote] = useState('');
  const [avSaving, setAvSaving] = useState(false);
  const [avPhoto, setAvPhoto] = useState<string | null>(null);
  const [avPhotoUp, setAvPhotoUp] = useState(false);

  const subirFotoAveria = async () => {
    if (!ci) return;
    setAvPhotoUp(true);
    const r = await captureAndUploadPhoto(ci.id, 'averias');
    setAvPhotoUp(false);
    if (r.ok && r.url) setAvPhoto(r.url);
    else if (r.error) setNotice('❌ ' + r.error);
  };

  // Foto del horómetro al iniciar ('ini') o finalizar ('fin') la jornada del inspector.
  // Intenta cámara y cae a galería/archivo (captureAndUploadPhoto) → permite cargar imagen.
  const tomarFotoHoro = async (which: 'ini' | 'fin') => {
    if (!ci) return;
    setHoroPhotoBusy(which);
    const r = await captureAndUploadPhoto(ci.id, 'horometro');
    setHoroPhotoBusy(false);
    if (r.ok && r.url) (which === 'ini' ? setHoroIniPhoto : setHoroFinPhoto)(r.url);
    else if (r.error) setNotice('❌ ' + r.error);
  };
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsErr, setGpsErr] = useState<string | null>(null);

  // ── Registrar operador SIN teléfono: el supervisor escanea el carnet del
  //    operador y coteja su cédula; si coincide, inicia la jornada del operador
  //    en esta máquina (mismo flujo que si el operador escaneara con su teléfono).
  const [opScanOpen, setOpScanOpen] = useState(false);
  const [opEmp, setOpEmp] = useState<{ id: string; first: string; last: string; name: string; cargo: string | null; cedula: string } | null>(null);
  const [opConfirmCedula, setOpConfirmCedula] = useState('');
  const [opHoro, setOpHoro] = useState('');
  const [opHoroPhoto, setOpHoroPhoto] = useState<string | null>(null);
  const [opHoroUploading, setOpHoroUploading] = useState(false);
  // Turno elegido a mano (sol/luna). Arranca en el turno según la hora actual.
  const [opShift, setOpShift] = useState<'day' | 'night'>(shiftOf(caracasParts(new Date()).hour).key);
  const [opBusy, setOpBusy] = useState(false);

  useEffect(() => { warmLocation(); }, []);
  // Al abrir el check-in de una máquina, precarga su referencia actual (si tiene).
  useEffect(() => {
    const r = (ci as any)?.referencia ?? '';
    setCiRef(r);
  }, [ci?.id]);
  // Al abrir el modal, averigua si esta máquina ya tiene una jornada por tiempo ABIERTA hoy.
  useEffect(() => {
    if (!ci) { setJornadaStart(null); setParadaOpen(false); setFinConfirm(false); return; }
    setParadaOpen(false); setFinConfirm(false); setHoroFin('');
    // Limpia el formulario de PARADA (ambos caminos) al cambiar de máquina.
    setParadaTab('averia'); setCiMotivo('');
    setPaMaterial(null); setPaQty(''); setPaPhoto(null); setPaPhotoUp(false);
    setNtCoords(null); setNtBusy(false);
    // Turno por defecto según el momento; HORA de inicio = la hora REAL del sistema
    // (Caracas) al abrir — no un 7:00am/7:00pm fijo. El inspector la corrige si hace falta.
    const defShift = shiftOf(caracasParts(new Date()).hour).key;
    setIniShift(defShift);
    setIniTime(nowHHMM());
    (async () => {
      let r = await getMachineRound(ci.id, today);
      let rDate = today;
      // Si HOY no tiene jornada abierta, rescata la de NOCHE de AYER si sigue abierta
      // (cruza la medianoche). Así, tras las 12, el inspector la ve "en curso" y puede
      // finalizarla — no reaparece como "sin jornada" (falso cierre a medianoche).
      if (!(r as any)?.jornada_start_at) {
        const ry = await getMachineRound(ci.id, yesterday);
        if ((ry as any)?.jornada_start_at && (ry as any)?.jornada_shift === 'night') { r = ry; rDate = yesterday; }
      }
      setCurRoundDate(rDate);
      setCurRoundHours({ day: Number((r as any)?.day_hours) || 0, night: Number((r as any)?.night_hours) || 0 });
      const open = (r as any)?.jornada_start_at ?? null;
      setJornadaStart(open);
      setJornadaShift((((r as any)?.jornada_shift as any) ?? shiftOf(caracasParts(new Date()).hour).key));
      if (open) {
        // Jornada abierta: muestra su horómetro inicial ya guardado.
        setHoroIni((r as any)?.horometro_inicial != null ? String((r as any).horometro_inicial) : '');
      } else {
        // Cerrada: precarga el inicial con el último horómetro final de la máquina.
        const last = await lastHorometroFinal(ci.id);
        setHoroIni(last != null ? String(last) : '');
      }
    })();
  }, [ci?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Reloj que corre solo mientras hay una jornada abierta (para el tiempo transcurrido).
  useEffect(() => {
    if (!jornadaStart) return;
    setNowTick(Date.now());
    const id = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(id);
  }, [jornadaStart]);
  // El TURNO ACTUAL (nowShift) y `shiftClosed` solo CAMBIAN a las 7:00am/7:00pm (Caracas).
  // RENDIMIENTO: antes se hacía un setInterval de 30s que re-renderizaba TODA la pantalla
  // dos veces por minuto sin que nada visible cambiara. Ahora se programa UN setTimeout
  // hasta el próximo límite de turno y se reprograma al dispararse → ~2 renders al día en
  // vez de ~2880. (El reloj de tiempo transcurrido de una jornada abierta usa su propio
  // intervalo, arriba, solo mientras hay jornada en curso.)
  useEffect(() => {
    let timer: any;
    const schedule = () => {
      const p = caracasParts(new Date());
      const mins = p.hour * 60 + p.minute;                 // minutos desde 00:00 (Caracas)
      const next = mins < 7 * 60 ? 7 * 60 : mins < 19 * 60 ? 19 * 60 : 7 * 60 + 24 * 60;
      const ms = Math.max(1000, (next - mins) * 60000) + 2000; // +2s de colchón tras el límite
      timer = setTimeout(() => { setNowTick(Date.now()); schedule(); }, ms);
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);

  // Extraído de `load()` para poder recargar SOLO la lista de máquinas desde el
  // realtime de abajo (sin repetir el resto de la carga inicial en cada cambio).
  const loadMachines = async () => {
    const mach = await selectAllRows('machinery', 'id, code, tipo, serial, plate, referencia, encargado, latitude, longitude, active, operational, en_espera, company:company_id(name)');
    const list = ((mach ?? []) as any[]).map((m) => ({ ...m, companyName: m.company?.name ?? 'Sin empresa' })) as Mach[];
    list.sort((a, b) => (a.code || '').localeCompare(b.code || ''));
    setMachines(list);
  };

  const load = async () => {
    setLoading(true);
    if (!uid) { setLoading(false); return; }
    const [{ data: prof }] = await Promise.all([
      supabase.from('profiles').select('full_name').eq('id', uid).maybeSingle(),
      loadMachines(),
    ]);
    const name = (prof as any)?.full_name ?? '';
    setFullName(name);
    // Estas 3 llamadas son independientes entre sí (ninguna usa el resultado de
    // la otra) — antes iban una detrás de otra (3 idas y vueltas de red en
    // serie); en paralelo la carga inicial es notablemente más rápida.
    const [, visitsData] = await Promise.all([reloadAssigns(), myVisitsToday(uid, today), reloadEstados()]);
    setVisits(visitsData);
    // Solo quien puede COORDINAR (admin o permiso 'coordinador_inspectores') necesita
    // la lista de inspectores para asignarles máquinas. Solo se ofrecen usuarios con
    // rol INSPECTOR (interno 'supervisor') o COORDINADOR DE PATIO ('coordinador_patio');
    // nadie más se puede asignar.
    if (puedeCoordinar) {
      const { data: insp } = await supabase.from('profiles').select('id, full_name, role').in('role', ['supervisor', 'coordinador_patio']).order('full_name');
      // El inspector VIRTUAL "SOS LA GUAIRA" (cubre máquinas sin inspector humano) solo
      // lo puede asignar un ADMIN — pedido del cliente: coordinadores/analistas asignan
      // inspectores reales, pero decidir "que quede sin inspector real" es decisión del admin.
      const rows = ((insp ?? []) as any[]).filter((p) => (p.full_name || '').trim() && (isAdmin || p.id !== PLACEHOLDER_INSPECTOR_ID));
      setInspectors(rows.map((p) => ({ id: p.id as string, name: p.full_name as string, role: (p.role ?? null) as string | null })));
    }
    setLoading(false);
  };

  // Estado de la jornada por máquina para el círculo de color: rondas del día
  // (jornada abierta / horas trabajadas) + máquinas con avería PARADA pendiente.
  const reloadEstados = async () => {
    // Día de negocio: en la madrugada (12am–7am) es AYER — ahí vive la jornada de NOCHE
    // que cruza la medianoche. `today` (calendario) sería HOY y NO trae esa ronda. Traemos
    // ambas fechas para que una jornada de noche FINALIZADA de madrugada (round_date=ayer,
    // ya sin jornada_start_at) siga contando como CERRADA/finalizada y no reaparezca como
    // "pendiente por iniciar". Cuando coinciden (de día) es una sola fecha.
    const businessDay = caracasBusinessToday();
    const roundDates = businessDay === today ? [today] : [today, businessDay];
    // GRACIA DE NOCHE hasta las 8am (regla cliente): la jornada de NOCHE (7pm–7am)
    // finalizada debe seguir viéndose FINALIZADA hasta las 8am. Entre 7am y 8am,
    // caracasBusinessToday ya saltó a HOY, así que la noche recién cerrada (round_date
    // = AYER, sin jornada_start_at) dejaría de traerse y la máquina volvería a
    // "pendiente". En esa franja traemos SOLO las horas de NOCHE de ayer (no las de
    // día, para NO tocar el flujo del turno de día). A las 8am deja de traerse → pasa a
    // pendiente por iniciar, como se pidió.
    // Ventana de gracia 7–8am: fuente de verdad única en caracasDay.ts (nightGraceRoundDate).
    const nightGraceDay = nightGraceRoundDate();
    const [{ data: rs, error: rsErr }, { data: rsRescue, error: rsRescueErr }, { data: rsNight, error: rsNightErr }, { data: par, error: parErr }, { data: avPend, error: avPendErr }] = await Promise.all([
      supabase.from('machine_rounds').select('machinery_id, jornada_start_at, jornada_shift, day_hours, night_hours').in('round_date', roundDates),
      // Jornadas de DÍAS ANTERIORES aún ABIERTAS (jornada_start_at sin limpiar), de
      // CUALQUIER turno: cubre tanto la NOCHE de ayer que cruza la medianoche (sin
      // esto el círculo 🟢 se apagaba al pasar las 12) como una jornada de DÍA que
      // quedó abierta más de un día porque el cron auto_close_jornadas() no corrió
      // (caída del servidor/cron) — antes solo se rescataba 'night', así que un DÍA
      // huérfano desaparecía silenciosamente del teléfono y el inspector podía volver
      // a iniciar jornada sobre la misma máquina.
      supabase.from('machine_rounds').select('machinery_id, jornada_start_at, jornada_shift, day_hours, night_hours').gte('round_date', rescueCutoff).lt('round_date', today).not('jornada_start_at', 'is', null),
      // GRACIA 7am–8am: horas de NOCHE de ayer (jornada de noche ya finalizada) para
      // conservarlas como CERRADAS hasta las 8am. Solo night_hours (no día).
      nightGraceDay
        ? supabase.from('machine_rounds').select('machinery_id, night_hours').eq('round_date', nightGraceDay).gt('night_hours', 0)
        : Promise.resolve({ data: [] as any[], error: null as any }),
      // Paradas VIGENTES: TODAS las pendientes (status='pendiente'), SIN filtro de
      // fecha — se ARRASTRAN de un día a otro hasta que el inspector las reactive
      // (volver a OPERATIVA / iniciar jornada). Mismo criterio que la PC.
      supabase.from('maintenance_requests').select('machinery_id, notes, created_at').eq('material', 'MÁQUINA PARADA').eq('status', 'pendiente').order('created_at', { ascending: false }),
      // Averías REALES PENDIENTES (material distinto de 'MÁQUINA PARADA'), SIN filtro
      // de fecha: una avería sin resolver mantiene la máquina AVERIADA día tras día
      // (se arrastra hasta que se marque operativa), NO baja a parada/pendiente al
      // día siguiente. Mismo criterio que el resumen admin (InspectionsSummary).
      supabase.from('maintenance_requests').select('machinery_id, created_at').neq('material', 'MÁQUINA PARADA').eq('status', 'pendiente'),
    ]);
    // Si CUALQUIERA de las 5 consultas falla (red inestable, timeout — común en el
    // teléfono en campo), NO se pisa el estado ya cargado con datos vacíos: antes, un
    // error silencioso en cualquiera de ellas hacía `data` null → `(x ?? [])` los
    // trataba como "sin rondas/paradas/averías" y `setRoundsById/setParadaRawList/
    // setAveriaRawList` dejaban TODO en 0 de golpe. En la vista "👥 Inspectores" del
    // coordinador eso se veía como el total correcto (viene de `machines`+`assignMap`,
    // aparte) pero TODAS las máquinas cayendo en "⏳ Pendientes" — y de paso, cualquier
    // máquina en_espera con jornada abierta (que solo sigue visible gracias a
    // roundsById[id].open) desaparecía de la lista sin más, pareciendo "no encontrada"
    // al buscarla. Se conserva el estado anterior hasta el próximo refresco que sí
    // tenga éxito, en vez de mostrar datos engañosos.
    const estadosErr = rsErr || rsRescueErr || rsNightErr || parErr || avPendErr;
    if (estadosErr) {
      console.warn('reloadEstados: error consultando estado de máquinas, se conserva el anterior', estadosErr);
      return;
    }
    const empty = { open: false, worked: 0, openDay: false, openNight: false, dayWorked: 0, nightWorked: 0, openStartDay: 0, openStartNight: 0 };
    const rmap: Record<string, typeof empty> = {};
    ((rs ?? []) as any[]).forEach((r) => {
      // Una máquina puede tener VARIAS rondas hoy (día/noche, o correcciones). Acumula:
      // abierta = si CUALQUIER ronda está abierta; horas = el MÁXIMO. TODO separado por
      // turno (día vs noche) para que el estado de un turno no se refleje en el otro.
      const prev = rmap[r.machinery_id] ?? empty;
      const dh = Number(r.day_hours) || 0;
      const nh = Number(r.night_hours) || 0;
      const isOpen = !!r.jornada_start_at;
      // Turno de la jornada ABIERTA: si `jornada_shift` viene nulo se INFIERE por la hora
      // de inicio (Caracas 7am–7pm = día), igual que la pantalla (InspectionsSummary
      // `openShiftOf`) y el reporte por inspector. Sin esta inferencia, una jornada
      // reabierta sin turno explícito dejaba openStartDay/Night en 0 → `reactivada`
      // nunca se activaba y la máquina reactivada seguía saliendo 🔴/🟡 en el teléfono.
      const openSh = r.jornada_shift === 'night' ? 'night'
        : r.jornada_shift === 'day' ? 'day'
        : (isOpen ? (caracasParts(new Date(r.jornada_start_at)).hour >= 7 && caracasParts(new Date(r.jornada_start_at)).hour < 19 ? 'day' : 'night') : null);
      const startMs = isOpen ? new Date(r.jornada_start_at).getTime() : 0;
      rmap[r.machinery_id] = {
        open: prev.open || isOpen,
        worked: Math.max(prev.worked, dh + nh),
        openDay: prev.openDay || (isOpen && openSh === 'day'),
        openNight: prev.openNight || (isOpen && openSh === 'night'),
        dayWorked: Math.max(prev.dayWorked, dh),
        nightWorked: Math.max(prev.nightWorked, nh),
        // Hora de inicio de la jornada ABIERTA por turno (para la regla de reactivación:
        // si la jornada arrancó DESPUÉS de la avería, la máquina volvió a trabajar).
        openStartDay: Math.max(prev.openStartDay, isOpen && openSh === 'day' && !isNaN(startMs) ? startMs : 0),
        openStartNight: Math.max(prev.openStartNight, isOpen && openSh === 'night' && !isNaN(startMs) ? startMs : 0),
      };
    });
    // Cualquier jornada de un día anterior aún abierta cuenta como 🟢 trabajando,
    // respetando SU turno (día o noche) — no pisa el turno contrario.
    ((rsRescue ?? []) as any[]).forEach((r) => {
      const prev = rmap[r.machinery_id] ?? empty;
      const startMs = r.jornada_start_at ? new Date(r.jornada_start_at).getTime() : 0;
      const ms = !isNaN(startMs) ? startMs : 0;
      if (r.jornada_shift === 'day') {
        rmap[r.machinery_id] = { ...prev, open: true, openDay: true, openStartDay: Math.max(prev.openStartDay, ms) };
      } else {
        rmap[r.machinery_id] = { ...prev, open: true, openNight: true, openStartNight: Math.max(prev.openStartNight, ms) };
      }
    });
    // GRACIA 7am–8am: las horas de NOCHE de ayer conservan la máquina como CERRADA
    // (finalizada). SOLO se toca nightWorked (nunca dayWorked) para no afectar el día.
    ((rsNight ?? []) as any[]).forEach((r) => {
      const prev = rmap[r.machinery_id] ?? empty;
      rmap[r.machinery_id] = { ...prev, nightWorked: Math.max(prev.nightWorked, Number(r.night_hours) || 0) };
    });
    setRoundsById(rmap);
    // Paradas crudas con su TURNO (por hora Caracas de la marca). El filtrado por
    // turno del inspector se hace en los memos paradaIds/paradaMotivos (más abajo).
    const paradaShiftOf = (iso: string): 'day' | 'night' => { const h = caracasParts(new Date(iso)).hour; return h >= 7 && h < 19 ? 'day' : 'night'; };
    // "arrastrada" = parada marcada ANTES de hoy: aplica a TODA la máquina (ambos turnos)
    // hasta marcarla operativa. La de HOY respeta el turno (no pisa al otro inspector).
    const dayStartMs = new Date(`${today}T00:00:00-04:00`).getTime();
    setParadaRawList(((par ?? []) as any[]).map((p) => ({ id: p.machinery_id as string, shift: paradaShiftOf(p.created_at), motivo: String(p.notes ?? '').trim(), arrastrada: new Date(p.created_at).getTime() < dayStartMs, createdMs: new Date(p.created_at).getTime() })));
    // Avería PENDIENTE: todas (se arrastran) + set de las marcadas HOY (ganan sobre trabajando).
    const avAll = new Set<string>();
    const avHoy = new Set<string>();
    ((avPend ?? []) as any[]).forEach((p) => {
      const id = p.machinery_id as string;
      avAll.add(id);
      if (new Date(p.created_at).getTime() >= dayStartMs) avHoy.add(id);
    });
    setAveriaPendienteIds(avAll);
    setAveriaHoyIds(avHoy);
    // Averías crudas con su TURNO (para la regla por-turno en segmentoDe): igual que paradaRawList.
    setAveriaRawList(((avPend ?? []) as any[]).map((p) => ({ id: p.machinery_id as string, shift: paradaShiftOf(p.created_at), arrastrada: new Date(p.created_at).getTime() < dayStartMs, createdMs: new Date(p.created_at).getTime() })));
  };
  // Estado (círculo) de una máquina: 🟢 trabajando (jornada abierta) · 🟡 parada
  // (avería pendiente que SE ARRASTRA hasta reactivarla). La jornada FINALIZADA
  // vuelve a estado NORMAL (sin marca): la pantalla queda "en 0", solo quedan las
  // paradas pendientes por inspector para reactivar al día siguiente.
  const estadoDe = (id: string): { color: string; icon: string; label: string } | null => {
    // Deriva del MISMO clasificador POR-TURNO que `segmentoDe`: cada inspector ve el
    // estado de SU turno (día independiente de noche). Una parada/avería marcada de
    // NOCHE NO se le muestra al inspector de DÍA (antes el badge global sí la mostraba
    // con el motivo del otro turno → "se solapaban"). Finalizada → NORMAL (sin marca).
    const seg = segmentoDe(id);
    if (seg === 'averia') return { color: '#B91C1C', icon: '🔴', label: 'Averiada' };
    if (seg === 'parada') return { color: '#D9A200', icon: '🟡', label: 'Parada' };
    if (seg === 'iniciada' && openMine(id)) return { color: '#1E9E4A', icon: '🟢', label: 'Trabajando' };
    if (seg === 'cerrada') return { color: '#1E3A5F', icon: '🏁', label: 'Finalizada' };
    return null;
  };

  // Arma el mapa de asignaciones (quién es DÍA y NOCHE por máquina) y "mis
  // máquinas" = donde soy inspector de día o de noche. Si falta el SQL, avisa.
  const reloadAssigns = async () => {
    const { rows, missing } = await listInspectorAssignments();
    const map: Record<string, { day?: SlotInfo; night?: SlotInfo }> = {};
    rows.forEach((a) => { (map[a.machinery_id] ||= {})[a.shift] = { id: a.inspector_id, name: a.inspector_name }; });
    setAssignMap(map);
    setMineIds(new Set(Object.entries(map).filter(([, s]) => s.day?.id === uid || s.night?.id === uid).map(([mid]) => mid)));
    if (missing) setNotice('⚠️ Para asignar máquinas (CHECK) falta correr supabase/inspector_asignacion.sql en Supabase.');
  };
  // puedeCoordinar entra en las dependencias porque el permiso 'coordinador_inspectores'
  // puede llegar async (después de montar): cuando pasa a true hay que recargar la
  // lista de inspectores (antes solo dependía de [uid, role], que el admin ya cubría).
  useEffect(() => { load(); }, [uid, role, puedeCoordinar]);
  // Sincroniza en vivo: si se asignan/quitan máquinas (aquí o en otro dispositivo),
  // refresca "Mis máquinas" y el mapa de turnos al instante.
  useRealtimeRefresh(['machine_inspectors'], () => { reloadAssigns(); });
  // Círculos de estado en vivo: jornada (machine_rounds), avería/parada
  // (maintenance_requests) y visitas.
  useRealtimeRefresh(['machine_rounds', 'maintenance_requests', 'supervisor_visits'], () => { reloadEstados(); }, { debounceMs: 1000, maxWaitMs: 4000 });
  // Catálogo de máquinas en vivo: si desde la PC/otro teléfono se activa/desactiva
  // una máquina o cambia su operational/en_espera/encargado, antes solo se veía
  // al hacer pull-to-refresh — el inspector podía seguir operando sobre datos
  // desactualizados (visibleParaInspector/necesitaInspector dependen de esto).
  useRealtimeRefresh(['machinery'], () => { loadMachines(); });

  // TAREA 4 (aditivo, solo LECTURA/filtrado — no toca escrituras ni el catálogo):
  // oculta del listado operativo del inspector las máquinas INACTIVAS (active=false)
  // o EN ESPERA de recepción/traslado (en_espera=true), EXCEPTO si tienen una jornada
  // abierta AHORA MISMO (roundsById[id]?.open) — así el inspector siempre puede cerrar
  // una jornada que quedó abierta, aunque la máquina se haya inactivado después. Cuando
  // la máquina se reactive (active/en_espera vuelven a su estado normal), reaparece sola
  // en el próximo refresh/realtime (useTable/useRealtimeRefresh ya recargan `machines`).
  // CONFIRMADO por el cliente (08/08/2026): una máquina averiada/parada
  // (operational=false) pero activa y NO en espera debe seguir viéndose con su estado
  // REAL (parada/averiada) en el teléfono del inspector, en el espejo del coordinador
  // en PC y en el Resumen de Inspecciones — ya NO se oculta solo por operational=false.
  // No toca `machines` (fuente) ni el CHECK (checkList/necesitaInspector/
  // pendientesList/resumenInspectores), que siguen viendo TODO el catálogo para
  // poder asignar/reactivar máquinas inactivas.
  const visibleParaInspector = (m: Mach) => {
    // INACTIVA desde el catálogo: máquina marcada NO OPERATIVA con "⛔ Inactiva"
    // (operational=false) o desactivada (active=false). NUNCA se muestra en la lista del
    // inspector, ni siquiera con jornada abierta (pedido cliente 08/08/2026). Solo aparece
    // en el reporte por empresa y en Control. `operational` solo lo cambia ese botón del
    // admin; la avería/parada de campo NO toca operational (vive en maintenance_requests),
    // así que una máquina averiada pero OPERATIVA sí se sigue viendo con su estado.
    if (m.active === false || (m as any).operational === false) return false;
    // EN ESPERA (recepción/traslado): oculta SIEMPRE, sin excepción (pedido del cliente
    // 11-ago-2026: "esperando instrucciones" = congelada por completo). Antes tenía una
    // excepción si ya tenía una jornada abierta (para que el inspector pudiera cerrarla),
    // pero desde que `en_espera=true` cierra de inmediato cualquier jornada corriendo
    // (`freezeOpenJornadaNow`, ver ControlMaquinariaScreen/EquiposScreen), esa excepción
    // ya no puede pasar en la práctica — se retira para que no queden casos colados.
    return m.en_espera !== true;
  };
  const mine = useMemo(() => machines.filter((m) => mineIds.has(m.id) && visibleParaInspector(m)), [machines, mineIds, roundsById]);
  const matchQuery = (m: Mach, q: string) => !q
    || norm(m.code).includes(q)
    || norm(m.companyName || '').includes(q)
    || norm((m as any).serial || '').includes(q)
    || norm((m as any).plate || '').includes(q)
    || norm((m as any).encargado || '').includes(q)
    || norm((m as any).referencia || '').includes(q)
    || norm((m as any).tipo || '').includes(q);
  // mineList/searchList (con el filtro de segmento) y `grupos` se definen más abajo,
  // después de paradaIds/paradaHoyIds (los usa segmentoDe).
  // Listado del CHECK: solo máquinas ACTIVAS y OPERATIVAS (buscable) para
  // asignármelas/quitármelas. Pedido del cliente (07-ago-2026): antes mostraba
  // también las inactivas (dadas de baja en Catálogo) y las no operativas — no
  // tiene sentido asignar/quitar inspector en algo que no está trabajando o que
  // ya ni siquiera está en el catálogo activo.
  const checkList = useMemo(() => {
    const q = norm(checkQuery.trim());
    // Tampoco las EN ESPERA DE INSTRUCCIONES (pedido del cliente 11-ago-2026): están
    // congeladas, no tiene sentido asignarles inspector todavía.
    return machines.filter((m) => m.active !== false && m.operational !== false && !m.en_espera && matchQuery(m, q));
  }, [machines, checkQuery]);
  // Solo las máquinas realmente EN SERVICIO necesitan inspector — mismo criterio que
  // usa el cron assign_missing_to_placeholder() (supabase/maquinas_faltantes.sql) para
  // no auto-asignarle horas a algo que no está trabajando. CONFIRMADO por el cliente
  // (04/08/2026): una máquina averiada (operational=false) o en espera de recepción
  // (en_espera) NO debe pedir inspector — no está trabajando ahora mismo. (Nota: hubo
  // un cambio de otra sesión que revirtió esto a "TODA máquina sin inspector"; el
  // cliente confirmó de nuevo que se queda así, excluyendo averiadas/en espera.)
  const necesitaInspector = (m: Mach) => m.active !== false && m.operational !== false && !m.en_espera;
  const esVirtual = (id?: string | null) => id === PLACEHOLDER_INSPECTOR_ID;
  // 🕓 PENDIENTES POR ASIGNAR: máquinas EN SERVICIO a las que les falta inspector en
  // DÍA y/o NOCHE (quedaron sin dueño, p. ej. al borrar un inspector). Las inactivas,
  // averiadas (operational=false) o en espera de recepción NO cuentan aquí — no están
  // trabajando, así que no necesitan un inspector asignado ahora mismo.
  //
  // pendMode: 'sin_nadie' (default) = la fila NO tiene NINGÚN inspector (ni humano
  // ni el usuario de sistema MAQUINAS FALTANTES/SOS LA GUAIRA) — el caso estricto.
  // 'sin_real' AMPLÍA la búsqueda: también cuenta las que el cron ya cubrió con
  // MAQUINAS FALTANTES. CONFIRMADO por el cliente (07/08/2026): el usuario SOS LA
  // GUAIRA SÍ cuenta como inspector real (no debe salir como "pendiente"), así que
  // el default vuelve a 'sin_nadie' — 'sin_real' queda solo como filtro opcional
  // para quien quiera ubicar máquinas cubiertas solo por el sistema.
  const faltaTurno = (m: Mach) => {
    if (!necesitaInspector(m)) return { day: false, night: false };
    const s = assignMap[m.id] || {};
    return { day: !s.day?.id, night: !s.night?.id };
  };
  const [pendMode, setPendMode] = useState<'sin_nadie' | 'sin_real'>('sin_nadie');
  const faltaEncargadoReal = (m: Mach) => {
    if (!necesitaInspector(m)) return { day: false, night: false };
    const s = assignMap[m.id] || {};
    const dayFalta = !s.day?.id || (pendMode === 'sin_real' && esVirtual(s.day.id));
    const nightFalta = !s.night?.id || (pendMode === 'sin_real' && esVirtual(s.night.id));
    return { day: dayFalta, night: nightFalta };
  };
  const pendientesList = useMemo(() => {
    const q = norm(pendQuery.trim());
    return machines
      .filter((m) => { const f = faltaEncargadoReal(m); return f.day || f.night; })
      .filter((m) => matchQuery(m, q))
      .sort((a, b) => {
        const asg = (m: Mach) => { const s = assignMap[m.id] || {}; return (s.day?.id && !esVirtual(s.day.id) ? 1 : 0) + (s.night?.id && !esVirtual(s.night.id) ? 1 : 0); };
        const d = asg(a) - asg(b);                 // 0 asignaciones reales (sin nada o solo el sistema) primero
        return d !== 0 ? d : cmpText(a.code, b.code);
      });
  }, [machines, assignMap, pendQuery, pendMode]);
  const pendientesCount = useMemo(
    () => machines.reduce((n, m) => { const f = faltaEncargadoReal(m); return n + (f.day || f.night ? 1 : 0); }, 0),
    [machines, assignMap, pendMode]
  );
  // 📋 RESUMEN: máquinas agrupadas por inspector (día/noche), para la vista colapsada.
  // Un inspector puede tener la misma máquina en día y en noche (aparece en ambas).
  const resumenInspectores = useMemo(() => {
    const byId: Record<string, { id: string; name: string; day: Mach[]; night: Mach[] }> = {};
    const ensure = (id: string, name: string) => (byId[id] ||= { id, name, day: [], night: [] });
    // Antes no filtraba nada: una máquina dada de baja o averiada (sin jornada
    // abierta) seguía saliendo en el resumen de un inspector, aunque ya no
    // apareciera en NINGUNA otra lista de esta misma pantalla (mine/searchList/
    // grupos, todas usan `visibleParaInspector`) — inconsistencia dentro del
    // propio teléfono.
    machines.filter(visibleParaInspector).forEach((m) => {
      const s = assignMap[m.id] || {};
      if (s.day?.id) ensure(s.day.id, s.day.name).day.push(m);
      if (s.night?.id) ensure(s.night.id, s.night.name).night.push(m);
    });
    Object.values(byId).forEach((g) => { g.day.sort((a, b) => cmpText(a.code, b.code)); g.night.sort((a, b) => cmpText(a.code, b.code)); });
    return Object.values(byId).sort((a, b) => cmpText(a.name, b.name));
  }, [machines, assignMap, roundsById]);
  const toggleExp = (k: string) => setExpanded((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  // ── REGLA DE TURNOS DEL INSPECTOR ──────────────────────────────────────────
  // El inspector solo puede iniciar jornada de SU turno asignado (día/noche) en
  // esta máquina, y solo una por turno por día (tras finalizar, vuelve a poder
  // mañana). `myShift` = el turno donde el inspector logueado está asignado.
  const myShift = useMemo<Shift | null>(() => {
    if (!ci) return null;
    const s = assignMap[ci.id];
    const mineDay = s?.day?.id === uid;
    const mineNight = s?.night?.id === uid;
    // Si el MISMO inspector cubre AMBOS turnos de esta máquina (día y noche), su turno
    // "vigente" lo dicta la HORA actual (7am–7pm día / 7pm–7am noche), NO día-primero.
    // Antes se devolvía 'day' siempre (se chequeaba día antes que noche) → de noche el
    // inspector quedaba en turno DÍA: su jornada de día ya cerró (no podía iniciar) y
    // veía la avería/parada marcada de DÍA. Ahora de noche resuelve 'night'.
    if (mineDay && mineNight) { const h = caracasParts(new Date()).hour; return h >= 7 && h < 19 ? 'day' : 'night'; }
    if (mineDay) return 'day';
    if (mineNight) return 'night';
    return null;
  }, [ci, assignMap, uid, nowTick]);
  // ¿El turno del inspector en esta máquina YA CERRÓ hoy? Se decide por la HORA DE
  // CIERRE del turno (hora de Caracas), NO por horas>0: así puede INICIAR/REINICIAR
  // varias veces el mismo día (p.ej. tras una parada) mientras su turno siga abierto,
  // y solo se bloquea cuando el turno ya cerró (día: 19:00 · noche: 07:00, y sigue
  // cerrada hasta las 19:00). Recién mañana podrá iniciar de nuevo.
  const shiftClosed = useMemo(() => {
    if (!myShift) return false;
    const h = caracasParts(new Date()).hour;
    if (myShift === 'day') return h >= 19;               // día cierra a las 7:00pm
    return h >= 7 && h < 19;                              // noche cierra a las 7:00am (cerrada hasta las 7:00pm)
  }, [myShift, nowTick]);
  // Turno ACTUAL según la hora del sistema (Caracas): 7am–7pm = ☀️ día · 7pm–7am = 🌙
  // noche. Es el turno con el que el COORDINADOR inicia la jornada (no lo elige a mano)
  // y por el que se filtran los inspectores que se muestran en la sub-vista "👥 Inspectores".
  const nowShift = useMemo<Shift>(() => {
    const h = caracasParts(new Date()).hour;
    return h >= 7 && h < 19 ? 'day' : 'night';
  }, [nowTick]);
  // GRACIA DE NOCHE (7am–8am): una jornada de NOCHE (7pm–7am) ya finalizada sigue
  // viéndose CERRADA/finalizada hasta las 8am (regla cliente). A las 8am pasa a
  // pendiente por iniciar. Solo aplica a la noche; no toca el flujo del día.
  const nightGraceActive = useMemo(() => inNightGraceWindow(), [nowTick]);
  // CIERRE DE JORNADA: el inspector puede FINALIZAR manualmente en cualquier momento.
  // Las máquinas que queden abiertas las cierra el auto-cierre del servidor (pg_cron)
  // a las 7:00pm (día) / 7:00am (noche), hora Caracas. Ya NO hay bloqueo por hora.
  // ¿Esta máquina está asignada a OTRO inspector (no a mí)? Entonces no puedo
  // iniciarle jornada. Excepción: admin y coordinador (pueden con cualquiera).
  const maquinaDeOtro = useMemo(() => {
    if (!ci) return false;
    if (puedeCoordinar) return false;
    const s = assignMap[ci.id] || {};
    const mia = s.day?.id === uid || s.night?.id === uid;
    const deOtro = (!!s.day?.id && s.day.id !== uid) || (!!s.night?.id && s.night.id !== uid);
    return !mia && deOtro;
  }, [ci, assignMap, uid, isAdmin, role, appRole]);
  // Nombre del/los inspector(es) dueños (para el aviso).
  const duenoTxt = useMemo(() => {
    if (!ci) return '';
    const s = assignMap[ci.id] || {};
    return [s.day ? `☀️ ${s.day.name}` : null, s.night ? `🌙 ${s.night.name}` : null].filter(Boolean).join('  ·  ');
  }, [ci, assignMap]);
  // Turno GLOBAL del inspector (según TODAS sus asignaciones): un inspector de DÍA
  // solo tiene 'day'; uno de NOCHE solo 'night'. Sirve para impedir que inicie el
  // turno que no le toca AUNQUE la máquina no esté asignada a él (REMBERTO, día, no
  // puede iniciar jornadas de noche).
  const myGlobalShifts = useMemo<Set<Shift>>(() => {
    const set = new Set<Shift>();
    Object.values(assignMap).forEach((s: any) => {
      if (s?.day?.id === uid) set.add('day');
      if (s?.night?.id === uid) set.add('night');
    });
    return set;
  }, [assignMap, uid]);
  const puedeCualquierTurno = puedeCoordinar;
  // PARADAS de la máquina. SINCRONIZADO CON EL SISTEMA (admin/InspectionsSummary):
  // una parada pendiente cuenta para la máquina SIN importar el turno en que se marcó.
  // ANTES se filtraba por el turno del inspector (una parada de noche no la veía el de
  // día) → esas máquinas salían como "por iniciar" en el tlf aunque el admin las mostrara
  // como PARADAS (caso REMBERTO: 3 paradas de noche que en el tlf aparecían por iniciar).
  // Ahora teléfono y sistema coinciden: cualquier parada pendiente = 🟡 Parada.
  const paradaIds = useMemo(() => {
    const s = new Set<string>();
    paradaRawList.forEach((p) => s.add(p.id));
    return s;
  }, [paradaRawList]);
  // Paradas marcadas HOY (no arrastradas): GANAN sobre "trabajando". Las arrastradas
  // (en paradaIds) pierden si la máquina trabaja hoy. También sin filtro de turno.
  const paradaHoyIds = useMemo(() => {
    const s = new Set<string>();
    paradaRawList.forEach((p) => { if (!p.arrastrada) s.add(p.id); });
    return s;
  }, [paradaRawList]);
  // Turno del inspector LOGUEADO en esta máquina (día/noche), o null si no es suya
  // (admin/coordinador viendo todo → sin turno específico = comportamiento global).
  const shiftOfMine = (id: string): 'day' | 'night' | null => {
    const s = assignMap[id] || {};
    const mineDay = s.day?.id === uid;
    const mineNight = s.night?.id === uid;
    // Cubre AMBOS turnos → el turno vigente lo dicta la hora actual (mismo criterio que
    // `myShift`). Así de noche ve/opera el estado de NOCHE (la avería/parada de DÍA le
    // sale como pendiente), no el de día por chequear día-primero.
    if (mineDay && mineNight) return nowShift;
    if (mineDay) return 'day';
    if (mineNight) return 'night';
    return null;
  };
  const openMine = (id: string): boolean => {
    const r = roundsById[id]; if (!r) return false;
    const sh = shiftOfMine(id);
    if (sh === 'day') return r.openDay;
    if (sh === 'night') return r.openNight;
    return r.open;
  };
  // ¿MI turno tiene HORAS registradas (finalizó la jornada)? Sirve para separar
  // CERRADA (finalizó con horas, ya no abierta) de INICIADA (abierta ahora).
  const hoursMine = (id: string): boolean => {
    const r = roundsById[id]; if (!r) return false;
    const sh = shiftOfMine(id);
    if (sh === 'day') return r.dayWorked > MIN_WORKED_HOURS;
    if (sh === 'night') return r.nightWorked > MIN_WORKED_HOURS;
    return r.worked > MIN_WORKED_HOURS;
  };
  const openEn = (id: string, sh: 'day' | 'night'): boolean => {
    const r = roundsById[id]; if (!r) return false;
    return sh === 'day' ? r.openDay : r.openNight;
  };
  const hoursEn = (id: string, sh: 'day' | 'night'): boolean => {
    const r = roundsById[id]; if (!r) return false;
    return sh === 'day' ? r.dayWorked > MIN_WORKED_HOURS : r.nightWorked > MIN_WORKED_HOURS;
  };
  // ÍNDICE O(1) de averías/paradas por máquina y turno. RENDIMIENTO: antes `segmentoDe`
  // hacía hasta 4 `.some()` sobre averiaRawList/paradaRawList por CADA llamada, y se llama
  // miles de veces por render (una por máquina en varias listas/contadores) → O(n²). Aquí
  // se indexa UNA sola vez por cambio de datos: id → Set<turno> para avería/parada, HOY y
  // ANY (hoy+arrastrada), + motivo de parada por id+turno. Los clasificadores leen O(1).
  const estadoIndex = useMemo(() => {
    const avHoy = new Map<string, Set<Shift>>();
    const avAny = new Map<string, Set<Shift>>();
    const paHoy = new Map<string, Set<Shift>>();
    const paAny = new Map<string, Set<Shift>>();
    const paMot = new Map<string, Map<Shift, string>>();
    // Última marca (createdMs) por máquina+turno: para la regla de REACTIVACIÓN — si la
    // jornada de ese turno arrancó DESPUÉS de la última avería/parada, ya no aplica.
    const avMax = new Map<string, Map<Shift, number>>();
    const paMax = new Map<string, Map<Shift, number>>();
    const add = (m: Map<string, Set<Shift>>, id: string, sh: Shift) => {
      let s = m.get(id); if (!s) { s = new Set<Shift>(); m.set(id, s); } s.add(sh);
    };
    const bumpMax = (m: Map<string, Map<Shift, number>>, id: string, sh: Shift, ms: number) => {
      let mm = m.get(id); if (!mm) { mm = new Map(); m.set(id, mm); } mm.set(sh, Math.max(mm.get(sh) ?? 0, ms || 0));
    };
    averiaRawList.forEach((a) => { add(avAny, a.id, a.shift); if (!a.arrastrada) add(avHoy, a.id, a.shift); bumpMax(avMax, a.id, a.shift, a.createdMs); });
    paradaRawList.forEach((p) => {
      add(paAny, p.id, p.shift); if (!p.arrastrada) add(paHoy, p.id, p.shift);
      bumpMax(paMax, p.id, p.shift, p.createdMs);
      if (p.motivo) { let mm = paMot.get(p.id); if (!mm) { mm = new Map(); paMot.set(p.id, mm); } if (!mm.has(p.shift)) mm.set(p.shift, p.motivo); }
    });
    return { avHoy, avAny, paHoy, paAny, paMot, avMax, paMax };
  }, [averiaRawList, paradaRawList]);
  // ¿El índice tiene la marca para ese id y turno? sh=null (admin/coordinador sin turno) =
  // cualquiera de los dos turnos.
  const hasIn = (m: Map<string, Set<Shift>>, id: string, sh: Shift | null): boolean => {
    const s = m.get(id); if (!s) return false; return sh === null ? s.size > 0 : s.has(sh);
  };
  // Hora de inicio de la jornada ABIERTA de un turno (0 = no abierta). sh=null → la más
  // reciente de cualquiera de los dos turnos.
  const openStartOf = (id: string, sh: Shift | null): number => {
    const r = roundsById[id]; if (!r) return 0;
    if (sh === 'day') return r.openStartDay;
    if (sh === 'night') return r.openStartNight;
    return Math.max(r.openStartDay, r.openStartNight);
  };
  // REACTIVADA: la máquina volvió a trabajar si su jornada de ese turno arrancó DESPUÉS
  // (>=) de la última avería/parada marcada — entonces esa avería/parada YA NO cuenta
  // (fix 08/08/2026: "averiada + en curso" era imposible). Igual criterio en el panel
  // de Inspecciones (PC) y en el reporte por inspector.
  const reactivada = (maxMap: Map<string, Map<Shift, number>>, id: string, sh: Shift | null): boolean => {
    const start = openStartOf(id, sh); if (!start) return false;
    const mm = maxMap.get(id); if (!mm) return false;
    const t = sh === null ? Math.max(0, ...mm.values()) : (mm.get(sh) ?? 0);
    return t > 0 && start >= t;
  };
  // Igual que `reactivada`, pero comparando contra la jornada abierta de CUALQUIER
  // turno (no solo `sh`) — para `segmentoConTurno` (vista del COORDINADOR por
  // turno), no para `segmentoDe` (la regla por-turno de `segmentoDe`, confirmada
  // 06-ago-2026 para el inspector viendo SU propio turno, se deja intacta arriba).
  // BUG (11-ago-2026): el coordinador viendo la pestaña "🌙 Noche" seguía mostrando
  // 🔴/🟡 en máquinas cuya avería/parada era de la madrugada pero que YA reabrieron
  // jornada de DÍA — mismo síntoma que ya se corrigió en inspectorDaySets.ts
  // (Coordinador de Operadores/Inspecciones) y en Catálogo/Inicio; acá faltaba.
  const reactivadaCrossTurno = (maxMap: Map<string, Map<Shift, number>>, id: string, sh: Shift): boolean => {
    const start = openStartOf(id, null); if (!start) return false;
    const mm = maxMap.get(id); if (!mm) return false;
    const t = mm.get(sh) ?? 0;
    return t > 0 && start >= t;
  };
  // Segmento de estatus de una máquina. REGLA POR-TURNO (confirmada 06-ago-2026): la
  // avería/parada pertenece al turno de la HORA en que se marcó; el OTRO turno la ve como
  // pendiente. Cada inspector ve SUS estados de SU turno, día independiente de noche.
  // Prioridad: avería HOY (de mi turno) > parada HOY (de mi turno) > jornada abierta/horas
  // > avería arrastrada (mi turno) > parada arrastrada (mi turno) > pendiente.
  // REGLA "SIEMPRE ACTIVO" (SOS LA GUAIRA): sus máquinas nunca salen avería/parada —
  // caen a iniciada/cerrada/pendiente según su jornada (se ignora el ticket).
  const siempreActivoSet = useMemo(() => {
    const s = new Set<string>();
    Object.entries(assignMap).forEach(([mid, slots]: [string, any]) => {
      if (inspectorSiempreActivo(slots?.day?.name) || inspectorSiempreActivo(slots?.night?.name)) s.add(mid);
    });
    return s;
  }, [assignMap]);
  const segmentoDe = (id: string): 'averia' | 'parada' | 'iniciada' | 'cerrada' | 'pendiente' => {
    const sh = shiftOfMine(id);                         // turno del inspector en esta máquina
    // SOS LA GUAIRA "siempre activo": nunca quedan en PENDIENTE ("siempre trabajando").
    // Aunque no haya jornada aún, cuentan como iniciada (coincide con inspectorDaySets).
    if (siempreActivoSet.has(id)) return openMine(id) ? 'iniciada' : hoursMine(id) ? 'cerrada' : 'iniciada';
    // Si la jornada se reinició DESPUÉS de la avería/parada, esa marca ya no cuenta
    // (la máquina volvió a trabajar) — así no queda "averiada" tras reiniciar jornada.
    const avOff = reactivada(estadoIndex.avMax, id, sh);
    const paOff = reactivada(estadoIndex.paMax, id, sh);
    if (!avOff && hasIn(estadoIndex.avHoy, id, sh)) return 'averia';   // 1) marcado HOY en mi turno gana
    if (!paOff && hasIn(estadoIndex.paHoy, id, sh)) return 'parada';
    if (openMine(id)) return 'iniciada';                      // 2) jornada ABIERTA ahora mismo
    if (hoursMine(id)) return 'cerrada';                      // 3) finalizó con horas (ya no abierta)
    if (!avOff && hasIn(estadoIndex.avAny, id, sh)) return 'averia';   // 4) arrastrada de mi turno
    if (!paOff && hasIn(estadoIndex.paAny, id, sh)) return 'parada';
    // 5) GRACIA 7am–8am: una jornada de NOCHE ya finalizada (con horas de noche, no
    // abierta) sigue como CERRADA hasta las 8am — no reaparece "pendiente" al entrar el
    // día. A las 8am (nightGraceActive=false) cae a pendiente por iniciar, como se pidió.
    if (nightGraceActive && hoursEn(id, 'night') && !openEn(id, 'night')) return 'cerrada';
    return 'pendiente';
  };
  // Igual que segmentoDe pero para un TURNO EXPLÍCITO (vista del coordinador por el
  // turno actual): día independiente de noche, misma prioridad.
  const segmentoConTurno = (id: string, sh: 'day' | 'night'): 'averia' | 'parada' | 'iniciada' | 'cerrada' | 'pendiente' => {
    if (siempreActivoSet.has(id)) return openEn(id, sh) ? 'iniciada' : hoursEn(id, sh) ? 'cerrada' : 'iniciada';
    const avOff = reactivadaCrossTurno(estadoIndex.avMax, id, sh);
    const paOff = reactivadaCrossTurno(estadoIndex.paMax, id, sh);
    if (!avOff && hasIn(estadoIndex.avHoy, id, sh)) return 'averia';
    if (!paOff && hasIn(estadoIndex.paHoy, id, sh)) return 'parada';
    if (openEn(id, sh)) return 'iniciada';
    if (hoursEn(id, sh)) return 'cerrada';
    if (!avOff && hasIn(estadoIndex.avAny, id, sh)) return 'averia';
    if (!paOff && hasIn(estadoIndex.paAny, id, sh)) return 'parada';
    return 'pendiente';
  };
  // Motivo de la PARADA de MI turno (día indep. de noche): el inspector de día NO ve
  // el motivo que dejó el de noche. null/coordinador (sin turno) → primer motivo.
  const paradaMotivoDe = (id: string): string => {
    const sh = shiftOfMine(id);
    const mm = estadoIndex.paMot.get(id); if (!mm) return '';
    let raw = '';
    if (sh === null) { for (const v of mm.values()) if (v) { raw = v; break; } }
    else raw = mm.get(sh) || '';
    return raw ? motivoParada(raw) : ''; // "NO TRABAJÓ · motivo" (sin Edificio/Ubicación) — igual que Inspecciones
  };
  // Buscador sobre MIS máquinas asignadas (nombre/serial/placa/empresa/encargado/
  // edificio) + chip de segmento activo. `mine` ya excluye inactivas (TAREA 4).
  const mineList = useMemo(() => {
    const q = norm(query.trim());
    return mine.filter((m) => matchQuery(m, q) && (segFilter === 'all' || segmentoDe(m.id) === segFilter));
  }, [mine, query, segFilter, averiaPendienteIds, averiaHoyIds, paradaHoyIds, paradaIds, roundsById, averiaRawList, paradaRawList, assignMap, uid]);
  // "Todas las máquinas" (admin/coordinador, vista operativa): mismo buscador +
  // chip de segmento, EXCLUYE inactivas salvo jornada abierta (TAREA 4). No es el
  // CHECK (checkList), que sigue mostrando el catálogo completo.
  const searchList = useMemo(() => {
    const q = norm(query.trim());
    return machines.filter((m) => matchQuery(m, q) && visibleParaInspector(m) && (segFilter === 'all' || segmentoDe(m.id) === segFilter));
  }, [machines, query, segFilter, averiaPendienteIds, averiaHoyIds, paradaHoyIds, paradaIds, roundsById, averiaRawList, paradaRawList, assignMap, uid]);
  // Contadores de los chips: sobre la base ya filtrada por texto/inactivas que se
  // está mostrando (mis máquinas, o "todas" si el admin/coordinador las activó).
  const segCountsBase = useMemo(() => {
    const q = norm(query.trim());
    const base = (puedeCoordinar && showAll ? machines.filter(visibleParaInspector) : mine).filter((m) => matchQuery(m, q));
    const counts = { all: base.length, pendiente: 0, iniciada: 0, cerrada: 0, parada: 0, averia: 0 };
    base.forEach((m) => { counts[segmentoDe(m.id)]++; });
    return counts;
  }, [machines, mine, query, showAll, puedeCoordinar, averiaPendienteIds, averiaHoyIds, paradaHoyIds, paradaIds, roundsById, averiaRawList, paradaRawList, assignMap, uid]);
  // Grupos colapsables de la vista del INSPECTOR (mis máquinas), por estado, usando el
  // MISMO segmentoDe: 🟢 iniciadas · ⏳ pendientes · 🟡 paradas (incl. arrastradas) · 🔴 averiadas.
  const grupos = useMemo(() => {
    const g: Record<'iniciadas' | 'cerradas' | 'pendientes' | 'paradas' | 'averiadas', Mach[]> = { iniciadas: [], cerradas: [], pendientes: [], paradas: [], averiadas: [] };
    mine.forEach((m) => {
      const seg = segmentoDe(m.id);
      g[seg === 'averia' ? 'averiadas' : seg === 'parada' ? 'paradas' : seg === 'iniciada' ? 'iniciadas' : seg === 'cerrada' ? 'cerradas' : 'pendientes'].push(m);
    });
    return g;
  }, [mine, averiaPendienteIds, averiaHoyIds, paradaHoyIds, paradaIds, roundsById, averiaRawList, paradaRawList, assignMap, uid]);
  // 👥 VISTA POR INSPECTOR (coordinador): cada inspector real con SUS máquinas
  // repartidas por estado (iniciadas / pendientes / paradas / averiadas), usando el
  // MISMO segmentoDe del resto de la pantalla. El inspector de sistema "MAQUINAS
  // FALTANTES" (placeholder) no cuenta. Sirve para que el coordinador vea a cada
  // inspector "como una vista de inspector" y opere sus máquinas.
  type InspBuckets = { iniciadas: Mach[]; cerradas: Mach[]; pendientes: Mach[]; paradas: Mach[]; averiadas: Mach[] };
  const inspectoresView = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; ids: Set<string> }>();
    const ensure = (id: string, name: string) => {
      let g = byId.get(id);
      if (!g) { g = { id, name, ids: new Set<string>() }; byId.set(id, g); }
      return g;
    };
    // Solo el turno ACTUAL: de día se muestran los inspectores (y máquinas) del turno
    // ☀️ día; de noche, los del 🌙 noche. Así el coordinador ve/opera lo que toca ahora.
    machines.forEach((m) => {
      const s = assignMap[m.id] || {};
      const slot = s[nowShift];
      if (slot?.id && !esVirtual(slot.id)) ensure(slot.id, slot.name).ids.add(m.id);
    });
    const machById = new Map(machines.map((m) => [m.id, m] as const));
    const rows = Array.from(byId.values()).map((g) => {
      const buckets: InspBuckets = { iniciadas: [], cerradas: [], pendientes: [], paradas: [], averiadas: [] };
      g.ids.forEach((id) => {
        const m = machById.get(id);
        if (!m || !visibleParaInspector(m)) return;
        const seg = segmentoConTurno(id, nowShift);
        buckets[seg === 'averia' ? 'averiadas' : seg === 'parada' ? 'paradas' : seg === 'iniciada' ? 'iniciadas' : seg === 'cerrada' ? 'cerradas' : 'pendientes'].push(m);
      });
      (Object.keys(buckets) as (keyof InspBuckets)[]).forEach((k) => buckets[k].sort((a, b) => cmpText(a.code, b.code)));
      const total = buckets.iniciadas.length + buckets.cerradas.length + buckets.pendientes.length + buckets.paradas.length + buckets.averiadas.length;
      return { id: g.id, name: g.name, buckets, total };
    }).filter((r) => r.total > 0).sort((a, b) => cmpText(a.name, b.name));
    return rows;
  }, [machines, assignMap, roundsById, averiaRawList, paradaRawList, nowShift]);

  // Turno FIJO para iniciar: el de ESTA máquina si está asignado; si no, su turno
  // global cuando es único. Para el COORDINADOR (que opera por otros) el turno lo DICTA
  // la hora del sistema (7am–7pm día / 7pm–7am noche): no lo elige a mano. null = puede
  // elegir (admin, o sin asignaciones).
  const fixedShift = useMemo<Shift | null>(() => {
    if (myShift) return myShift;
    if (esCoordinador) return nowShift;
    if (!puedeCualquierTurno && myGlobalShifts.size === 1) return Array.from(myGlobalShifts)[0];
    return null;
  }, [myShift, myGlobalShifts, puedeCualquierTurno, esCoordinador, nowShift]);
  // Fuerza el turno declarado al turno del inspector (no puede elegir el otro).
  useEffect(() => {
    if (fixedShift) { setIniShift(fixedShift); setIniTime(nowHHMM()); }
  }, [fixedShift, ci?.id]);

  // ✅ CHECK MÁQUINA por TURNO (SOLO ADMIN): asigna (o quita) al INSPECTOR ELEGIDO
  // como inspector de DÍA o de NOCHE de la máquina. Cada máquina → 2 inspectores.
  const assignShift = async (m: Mach, shift: Shift) => {
    const target = checkInspector;
    if (!target || assignBusy) return;
    const slot = assignMap[m.id]?.[shift];
    const same = slot?.id === target.id; // ese inspector ya tiene este turno → quitar
    setAssignBusy(m.id + shift); setNotice(null);
    const res = same ? await unassignInspector(m.id, target.id, shift) : await assignInspector(m.id, target.id, target.name, shift);
    setAssignBusy(null);
    if (res.error) {
      setNotice(res.missing
        ? '❌ Falta activar la asignación: corre supabase/inspector_turno.sql en Supabase.'
        : '❌ ' + res.error);
      return;
    }
    await reloadAssigns();
    if (!same) logAudit('CHECK', 'machinery', m.id, `${m.code} · ${shiftLabel(shift)} → ${target.name}`); // bitácora
    setNotice(same
      ? `➖ ${m.code} · ${shiftIcon(shift)} ${shiftLabel(shift)} quitado a ${target.name}.`
      : `✅ ${m.code} · ${shiftIcon(shift)} ${shiftLabel(shift)} asignada a ${target.name}.`);
  };

  // ── Asignar/reasignar/quitar por LOTE (varias máquinas seleccionadas con check)
  //    al inspector elegido, en un turno (día/noche) o ambos. 'remove' quita SOLO
  //    los turnos que hoy pertenecen a ese inspector. Reasignar es directo (upsert
  //    por máquina+turno), así que un turno ocupado por otro se sobreescribe.
  const assignBatch = async (mode: 'day' | 'night' | 'both' | 'remove') => {
    const target = checkInspector;
    if (!target || batchBusy || selIds.size === 0) return;
    setBatchBusy(true); setNotice(null);
    const ids = Array.from(selIds);
    const shifts: Shift[] = mode === 'day' ? ['day'] : mode === 'night' ? ['night'] : ['day', 'night'];
    let ok = 0, err = 0, res: { error?: string; missing?: boolean } | null = null;
    for (const id of ids) {
      for (const sh of shifts) {
        if (mode === 'remove') {
          if (assignMap[id]?.[sh]?.id !== target.id) continue; // solo lo suyo
          res = await unassignInspector(id, target.id, sh);
        } else {
          res = await assignInspector(id, target.id, target.name, sh);
        }
        if (res?.error) err++; else ok++;
      }
    }
    await reloadAssigns();
    setBatchBusy(false);
    setSelIds(new Set());
    logAudit('CHECK', 'machinery', ids[0] ?? '', `LOTE ${mode} · ${ids.length} máquina(s) → ${target.name}`);
    if (err > 0 && ok === 0) {
      setNotice(res?.missing ? '❌ Falta activar la asignación: corre supabase/inspector_turno.sql en Supabase.' : `❌ No se pudo asignar el lote (${err} error/es).`);
      return;
    }
    const que = mode === 'both' ? 'Día + Noche' : mode === 'remove' ? 'quitado' : shiftLabel(mode as Shift);
    setNotice(mode === 'remove'
      ? `➖ Quitadas ${ok} asignación(es) a ${target.name}.${err ? ` (${err} con error)` : ''}`
      : `✅ ${que} asignado a ${ids.length} máquina(s) → ${target.name}.${err ? ` (${err} con error)` : ''}`);
  };
  const toggleSel = (id: string) => setSelIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // ── 📄 REPORTE PERSONAL DE CIERRE DE JORNADA (imagen descargable) ──────────
  // Solo aparece cuando el inspector ya NO tiene NINGUNA máquina de su turno con
  // jornada abierta (todas finalizadas/paradas/averiadas/pendientes) — es decir,
  // terminó su turno. Usa `fixedShift` (turno fijo del inspector) y `openMine`
  // (jornada abierta EN MI turno para esa máquina), ya calculados arriba.
  const misMaquinasDelTurno = useMemo(
    () => (fixedShift ? mine.filter((m) => shiftOfMine(m.id) === fixedShift) : []),
    [mine, assignMap, uid, fixedShift],
  );
  const puedeDescargarCierre = useMemo(
    () => !!fixedShift && misMaquinasDelTurno.length > 0 && misMaquinasDelTurno.every((m) => !openMine(m.id)),
    [fixedShift, misMaquinasDelTurno, roundsById],
  );
  const [receiptBusy, setReceiptBusy] = useState(false);
  const descargarCierreJornada = async () => {
    if (!fixedShift || receiptBusy) return;
    setReceiptBusy(true);
    try {
      // "día de negocio" (no calendario): un cierre de turno NOCHE puede pulsarse
      // después de medianoche, cuando `today` (calendario) ya rodó — pero el round
      // real (y lo que ve computeInspectorData) sigue perteneciendo al día en que
      // arrancó. Sin esto el PDF salía vacío/con el día equivocado.
      await generateMyShiftReceipt({ date: caracasBusinessToday(), shift: fixedShift, inspectorName: fullName || 'Inspector' });
    } catch {
      setNotice('❌ No se pudo generar el PDF del reporte.');
    } finally {
      setReceiptBusy(false);
    }
  };

  // ── "↪ Reasignar a…": MUEVE las máquinas de `reassign.ids` al inspector destino
  //    `reassignTo` en el turno elegido (día/noche/ambos). Es un upsert directo por
  //    máquina+turno (sobreescribe a quien la tuviera). Sincroniza en vivo y cierra.
  const doReassign = async (mode: 'day' | 'night' | 'both') => {
    if (!reassign || !reassignTo || reassignBusy) return;
    setReassignBusy(true); setNotice(null);
    const ids = reassign.ids;
    const shifts: Shift[] = mode === 'day' ? ['day'] : mode === 'night' ? ['night'] : ['day', 'night'];
    let ok = 0, err = 0, res: { error?: string; missing?: boolean } | null = null;
    for (const id of ids) {
      for (const sh of shifts) {
        res = await assignInspector(id, reassignTo.id, reassignTo.name, sh);
        if (res?.error) err++; else ok++;
      }
    }
    await reloadAssigns();
    logAudit('CHECK', 'machinery', ids[0] ?? '', `REASIGNAR ${mode} · ${ids.length} máquina(s) → ${reassignTo.name}`);
    const que = mode === 'both' ? 'Día + Noche' : shiftLabel(mode as Shift);
    const dest = reassignTo.name;
    setReassignBusy(false); setSelIds(new Set());
    setReassign(null); setReassignTo(null); setReassignQuery('');
    if (err > 0 && ok === 0) {
      setNotice(res?.missing ? '❌ Falta activar la asignación: corre supabase/inspector_turno.sql en Supabase.' : `❌ No se pudo reasignar (${err} error/es).`);
      return;
    }
    setNotice(`↪ Reasignada(s) ${ids.length} máquina(s) · ${que} → ${dest}.${err ? ` (${err} con error)` : ''}`);
  };

  // ── Asignar/reasignar el inspector de UNA máquina en un turno, DESDE su ficha
  //    (lista "Todas las máquinas", solo admin). insp=null quita el turno.
  //    Reasignar es directo (upsert por máquina+turno). Sincroniza en vivo.
  const setInspectorFor = async (m: Mach, shift: Shift, insp: { id: string; name: string } | null) => {
    if (assignBusy) return;
    setAssignBusy(m.id + shift); setNotice(null);
    const curId = assignMap[m.id]?.[shift]?.id ?? '';
    const res = insp
      ? await assignInspector(m.id, insp.id, insp.name, shift)
      : await unassignInspector(m.id, curId, shift);
    setAssignBusy(null);
    if (res.error) { setNotice(res.missing ? '❌ Falta activar la asignación: corre supabase/inspector_turno.sql en Supabase.' : '❌ ' + res.error); return; }
    await reloadAssigns();
    if (insp) logAudit('CHECK', 'machinery', m.id, `${m.code} · ${shiftLabel(shift)} → ${insp.name}`);
    setNotice(insp
      ? `✅ ${m.code} · ${shiftIcon(shift)} ${shiftLabel(shift)} → ${insp.name}.`
      : `➖ ${m.code} · ${shiftIcon(shift)} ${shiftLabel(shift)} quitado.`);
    setPickShift(null);
  };

  // ── ASIGNACIÓN POR LOTES ("Pendientes por asignar" + checkboxes): asigna el
  //    inspector/turno elegido a TODAS las máquinas marcadas, llamando a
  //    assignInspector (misma función del flujo individual) en bucle. Muestra un
  //    resumen (OK/fallidas) al terminar. Reutiliza assignBusy=null como estado libre.
  const assignPendBatch = async (insp: { id: string; name: string }) => {
    if (pendBatchBusy || pendSelected.size === 0) return;
    setPendBatchBusy(true); setNotice(null);
    const ids = Array.from(pendSelected);
    let ok = 0, fail = 0;
    for (const mid of ids) {
      const m = machines.find((x) => x.id === mid);
      const res = await assignInspector(mid, insp.id, insp.name, pendBatchShift);
      if (res.error) { fail++; }
      else { ok++; if (m) logAudit('CHECK', 'machinery', mid, `${m.code} · ${shiftLabel(pendBatchShift)} → ${insp.name} (lote)`); }
    }
    setPendBatchBusy(false);
    await reloadAssigns();
    setPendSelected(new Set());
    setPendBatchOpen(false);
    setNotice(`✅ Asignación por lotes: ${ok} máquina(s) OK${fail > 0 ? ` · ⚠️ ${fail} fallaron` : ''} · ${shiftIcon(pendBatchShift)} ${shiftLabel(pendBatchShift)} → ${insp.name}.`);
  };

  // ¿El usuario actual puede ESCANEAR/MARCAR esta máquina? Un inspector solo puede
  // tocar máquinas asignadas a ÉL (día o noche) o SIN asignar; NO las de otro inspector.
  // Admin y coordinadores (patio / QR), cualquiera.
  const puedeMarcar = (m: Mach): boolean => {
    const puedeCualquiera = puedeCoordinar;
    if (puedeCualquiera) return true;
    const slots = assignMap[m.id] || {};
    const mia = slots.day?.id === uid || slots.night?.id === uid;
    const deOtro = (!!slots.day?.id && slots.day.id !== uid) || (!!slots.night?.id && slots.night.id !== uid);
    return mia || !deOtro; // mía (algún turno) o sin dueño → sí; de otro → no
  };
  const otroInspectorNombre = (m: Mach): string => {
    const slots = assignMap[m.id] || {};
    if (slots.day?.id && slots.day.id !== uid) return slots.day.name;
    if (slots.night?.id && slots.night.id !== uid) return slots.night.name;
    return 'OTRO inspector';
  };
  // Nº de máquinas asignadas a un inspector (cualquier turno) — para el CHECK.
  const inspCount = (id: string) => Object.values(assignMap).filter((s) => s.day?.id === id || s.night?.id === id).length;
  // Buscador de inspectores por TODAS sus características (no solo el nombre): nombre,
  // rol (supervisor/coordinador…) y nº de máquinas asignadas. Query vacía = todos.
  // Índice de BÚSQUEDA por inspector: concatena TODAS las características de sus máquinas
  // asignadas (código, empresa, serial, placa, encargado, edificio/referencia, tipo,
  // clasificación, sector, zona) para que "Buscar inspector" también encuentre por
  // cualquier dato de sus equipos, no solo por nombre/rol/conteo.
  const inspMachText = useMemo(() => {
    const acc: Record<string, string[]> = {};
    machines.forEach((m) => {
      const s = assignMap[m.id] || {};
      const ids: string[] = [];
      if (s.day?.id) ids.push(s.day.id);
      if (s.night?.id && s.night.id !== s.day?.id) ids.push(s.night.id);
      if (!ids.length) return;
      const mm = m as any;
      const txt = [m.code, m.companyName, mm.serial, mm.plate, mm.encargado, mm.referencia, mm.identifier, mm.tipo, mm.clasificacion, mm.sector, mm.zona]
        .filter(Boolean).join(' ');
      ids.forEach((id) => { (acc[id] ??= []).push(txt); });
    });
    const out: Record<string, string> = {};
    Object.keys(acc).forEach((id) => { out[id] = norm(acc[id].join(' ')); });
    return out;
  }, [machines, assignMap]);
  const matchInsp = (p: { id: string; name: string; role?: string | null }, q: string): boolean => {
    const nq = norm((q || '').trim());
    if (!nq) return true;
    if (norm(`${p.name} ${p.role || 'inspector'} ${inspCount(p.id)} maquinas`).includes(nq)) return true;
    return (inspMachText[p.id] || '').includes(nq);
  };

  const openCheckin = (m: Mach) => {
    // Bloqueo: un inspector NO puede escanear/abrir/marcar la máquina de OTRO inspector.
    if (!puedeMarcar(m)) {
      setScanOpen(false);
      setNotice(`🔒 "${m.code}" está asignada a ${otroInspectorNombre(m)}. No puedes escanearla ni marcarla (solo su inspector o un administrador).`);
      return;
    }
    // Bloqueo: "Esperando instrucciones" = congelada por completo (pedido del cliente
    // 11-ago-2026). Antes esto llegaba sin filtrar por venir de un ID directo (QR físico,
    // fila tocada desde CoordinadorInspectoresView) en vez de pasar por `visibleParaInspector`,
    // así que se podía iniciar jornada / marcar avería-parada / registrar operador en una
    // máquina que todavía no tiene decisión de Operativa o Parada. Solo se desbloquea desde
    // "✅ Máquina lista" (CoordinadorQrPanel) o el catálogo — nunca desde acá.
    if (m.en_espera) {
      setScanOpen(false);
      setNotice(`⏳ "${m.code}" está EN ESPERA DE INSTRUCCIONES. No se puede iniciar jornada, marcar avería/parada ni registrar operador hasta que se decida si queda Operativa o Parada.`);
      return;
    }
    setCi(m);
    setCiStatus('trabajando');
    setCiNote('');
    setCiMotivo('');
    setAvOpen(false); setAvMaterial(null); setAvQty(''); setAvNote('');
    setGps(null);
    setGpsErr(null);
    setScanOpen(false);
    // Limpia el registro de operador para esta máquina.
    setOpScanOpen(false);
    setOpEmp(null);
    setOpConfirmCedula('');
    setOpHoro('');
    setOpHoroPhoto(null);
    setHoroIniPhoto(null); setHoroFinPhoto(null); setHoroFin('');
    setNtMotivo('');
    // Captura el GPS del supervisor al abrir (para medir la distancia a la máquina).
    setGpsBusy(true);
    getCurrentCoords().then((r) => {
      setGpsBusy(false);
      if (r.ok && r.lat != null && r.lng != null) setGps({ lat: r.lat, lng: r.lng });
      else setGpsErr(r.error ?? 'Sin ubicación.');
    });
  };

  // Si llegó por el QR físico (?maquina=) tras iniciar sesión: abre directo el
  // check-in de esa máquina (una sola vez) y limpia el parámetro de la URL.
  useEffect(() => {
    if (consumedRef.current || !initialMachineId || machines.length === 0) return;
    consumedRef.current = true;
    const found = machines.find((m) => m.id === initialMachineId);
    if (found) {
      openCheckin(found);
      logAudit('SCAN', 'machinery', found.id, found.code); // bitácora: escaneó el QR de esta máquina
    }
    onConsumed?.();
  }, [initialMachineId, machines]); // eslint-disable-line react-hooks/exhaustive-deps

  const recapture = () => {
    setGpsBusy(true); setGpsErr(null);
    getCurrentCoords().then((r) => {
      setGpsBusy(false);
      if (r.ok && r.lat != null && r.lng != null) setGps({ lat: r.lat, lng: r.lng });
      else setGpsErr(r.error ?? 'Sin ubicación.');
    });
  };

  // Guarda TU posición actual como la UBICACIÓN de la máquina (queda en el mapa y
  // en el monitoreo con tu nombre). Estás en la máquina, así que sirve para ubicarla.
  const guardarUbicacionMaquina = async () => {
    if (!ci) return;
    setSavingMachLoc(true);
    let lat = gps?.lat ?? null, lng = gps?.lng ?? null;
    if (lat == null || lng == null) {
      const r = await getCurrentCoords();
      if (!r.ok || r.lat == null || r.lng == null) { setSavingMachLoc(false); setNotice('❌ ' + (r.error ?? 'No se pudo obtener tu ubicación.')); return; }
      lat = r.lat; lng = r.lng; setGps({ lat, lng });
    }
    const { error } = await supabase.rpc('update_machine_location', { p_id: ci.id, p_lat: lat, p_lng: lng });
    if (error) { setSavingMachLoc(false); setNotice('❌ ' + error.message); return; }
    // Guarda la REFERENCIA (edificio/parque/plaza/calle) junto con la ubicación.
    // El inspector tiene permiso de escritura sobre machinery (is_staff).
    const nuevaRef = ciRef.trim() || null;
    const { error: refErr } = await supabase.from('machinery').update({ referencia: nuevaRef }).eq('id', ci.id);
    setSavingMachLoc(false);
    if (refErr) { setNotice('❌ ' + refErr.message); return; }
    // Si la residencia/edificio escrito NO estaba en el catálogo, lo registra al
    // vuelo (idempotente) para que quede en la lista compartida la próxima vez.
    if (nuevaRef) addEdificio(nuevaRef).catch(() => {});
    setCi((c) => (c ? { ...c, latitude: lat as number, longitude: lng as number, referencia: nuevaRef } as Mach : c));
    setNotice(nuevaRef ? '✅ Ubicación y referencia guardadas.' : '✅ Ubicación de la máquina guardada.');
    load();
  };

  // Reporta una AVERÍA de la máquina (misma función que el operador): cae en el
  // módulo de Mantenimiento de Maquinaria como solicitud pendiente.
  // TRAZA DE COORDINADOR: cuando un coordinador de inspectores actúa sobre la máquina
  // de OTRO inspector, la acción cuenta para el inspector dueño (la máquina es suya),
  // pero dejamos constancia visible de quién la registró de verdad. Devuelve '' si no
  // aplica (no es coordinador, o la máquina es suya / sin dueño).
  const coordActuando = (id: string): boolean => {
    if (!esCoordinador) return false;
    const s = assignMap[id] || {};
    const mia = s.day?.id === uid || s.night?.id === uid;
    return !mia && (!!s.day?.id || !!s.night?.id);
  };
  const conTraza = (id: string, nota?: string | null): string | null => {
    const base = (nota ?? '').trim();
    const traza = coordActuando(id) ? `registrado por ${fullName || 'coordinador'} (coordinador)` : '';
    return [base, traza].filter(Boolean).join(' · ') || null;
  };

  const registrarAveria = async () => {
    if (!ci || !avMaterial) return;
    if (!avNote.trim()) { setNotice('⚠️ Describe la falla — la nota es obligatoria.'); return; }
    setAvSaving(true);
    const payload = {
      machinery_id: ci.id,
      material: avMaterial,
      quantity: avNumOrNull(avQty),
      notes: conTraza(ci.id, avNote),
      status: 'pendiente',
      requested_by: uid || null,
      photo_url: avPhoto,
    };
    // Sin señal: guarda la avería en el teléfono y avisa — se sube sola al reconectar.
    if (!isOnline()) {
      await enqueueAveria(payload, `${ci.code} · avería ${matLabelOf(avMaterial)}`);
      setAvSaving(false);
      setAvMaterial(null); setAvQty(''); setAvNote(''); setAvPhoto(null); setAvOpen(false);
      setNotice('📶 Sin conexión: avería guardada en el teléfono, se subirá sola cuando haya señal.');
      return;
    }
    const { error } = await supabase.from('maintenance_requests').insert(payload);
    if (error) {
      if (isNetworkErrorMsg(error.message)) {
        await enqueueAveria(payload, `${ci.code} · avería ${matLabelOf(avMaterial)}`);
        setAvSaving(false);
        setAvMaterial(null); setAvQty(''); setAvNote(''); setAvPhoto(null); setAvOpen(false);
        setNotice('📶 Sin conexión: avería guardada en el teléfono, se subirá sola cuando haya señal.');
        return;
      }
      setAvSaving(false); setNotice('❌ ' + error.message); return;
    }
    setAvSaving(false);
    setAvMaterial(null); setAvQty(''); setAvNote(''); setAvPhoto(null); setAvOpen(false);
    setNotice('✅ Avería registrada. Va al módulo de Mantenimiento de Maquinaria.');
  };

  // Distancia del supervisor a la máquina (si ambos tienen coordenadas).
  const dist = useMemo(() => {
    if (!ci || !gps || ci.latitude == null || ci.longitude == null) return null;
    return haversineM(gps.lat, gps.lng, Number(ci.latitude), Number(ci.longitude));
  }, [ci, gps]);
  const near = dist == null ? null : dist <= VISIT_NEAR_M;

  // Guarda la visita (check-in) con un estado dado → aparece en el módulo de
  // INSPECCIONES y valida la jornada del día. Devuelve la fila o null.
  const registrarVisita = async (status: VisitStatus) => {
    if (!ci) return null;
    const { data, error } = await saveVisit({
      machineryId: ci.id,
      supervisorId: uid || null,
      supervisorName: fullName || 'Inspector',
      visitDate: today,
      status,
      lat: gps?.lat ?? null,
      lng: gps?.lng ?? null,
      note: conTraza(ci.id, ciNote) ?? '',
      machineLat: ci.latitude ?? null,
      machineLng: ci.longitude ?? null,
    });
    if (error || !data) { setNotice('❌ ' + (error ?? 'No se pudo guardar la visita.')); return null; }
    setVisits((prev) => ({ ...prev, [ci.id]: data }));
    return data;
  };

  // ▶️ INICIAR JORNADA: guarda la hora de inicio (en la BD) y marca la máquina
  // como "trabajando" en Inspecciones. El botón pasa a "Finalizar jornada".
  const iniciarJornada = async () => {
    if (!ci || jornadaBusy) return;
    // INICIAR/FINALIZAR JORNADA no se difieren offline (a propósito, ver
    // src/lib/offlineQueue.ts): calculan retraso/alertas contra el estado real
    // del servidor y validan el horómetro — mejor pedir señal que arriesgar un
    // cálculo de horas equivocado.
    if (!isOnline()) { setNotice('📶 Sin conexión: para iniciar jornada hace falta señal (valida datos contra el servidor). El check-in de parada/avería sí funciona sin conexión.'); return; }
    // Regla: NO puedes iniciar la jornada de una máquina asignada a OTRO inspector.
    // Excepción: admin y coordinador (pueden iniciar cualquier máquina).
    const puedeCualquiera = puedeCoordinar;
    if (!puedeCualquiera) {
      const slots = assignMap[ci.id] || {};
      const mia = slots.day?.id === uid || slots.night?.id === uid;
      const deOtro = (!!slots.day?.id && slots.day.id !== uid) || (!!slots.night?.id && slots.night.id !== uid);
      if (!mia && deOtro) { setNotice('❌ Esta máquina está asignada a OTRO inspector. No puedes iniciar su jornada.'); return; }
    }
    // Regla de turnos: un inspector solo inicia jornadas de SU turno (día o noche).
    // Vale aunque la máquina NO esté asignada a él: su turno sale de sus asignaciones
    // globales. Un inspector de día NO puede iniciar jornadas de noche (ni al revés).
    if (!puedeCualquiera) {
      const allowed = myShift ? new Set<Shift>([myShift]) : myGlobalShifts;
      if (allowed.size > 0 && !allowed.has(iniShift)) {
        const lbl = Array.from(allowed).map((s) => shiftFromKey(s).label).join(' / ');
        setNotice(`❌ Solo puedes iniciar jornada de ${lbl}. Un inspector de día no puede iniciar jornadas de noche (ni al revés).`);
        return;
      }
    }
    if (shiftClosed && !jornadaStart) { setNotice(`❌ La jornada de ${shiftFromKey(myShift as any).label} de hoy ya cerró. Podrás iniciar otra mañana.`); return; }
    // Horómetro al iniciar: ya NO es obligatorio (puede ir vacío). Si lo escriben, debe
    // ser un número válido (≥0); si lo dejan en blanco, la jornada inicia igual.
    const hiRaw = (horoIni || '').replace(',', '.').trim();
    const hiHas = hiRaw !== '';
    const hi = Number(hiRaw);
    if (hiHas && (!isFinite(hi) || hi < 0)) { setNotice('❌ El horómetro no puede ser negativo.'); return; }
    // Hora de inicio DECLARADA (HH:MM). Caracas es UTC-4 fijo (sin horario de verano).
    const m = /^(\d{1,2}):(\d{2})$/.exec((iniTime || '').trim());
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) { setNotice('❌ Hora de inicio inválida (usa HH:MM, ej. 07:00).'); return; }
    const hh = m[1].padStart(2, '0'), mm = m[2];
    const sh = iniShift;
    const now = new Date();
    const nowParts = caracasParts(now);
    // Instante declarado del inicio (hoy, a la hora escrita).
    const declaredIso = `${today}T${hh}:${mm}:00-04:00`;
    // Límite para declarar SIN alerta: 9:30am (día) / 9:30pm (noche). Si el turno de
    // noche ya pasó la medianoche (hora < 6), el límite fue el día anterior.
    let limitDay = today;
    if (sh === 'night' && nowParts.hour < 6) {
      const d = new Date(`${today}T12:00:00-04:00`); d.setUTCDate(d.getUTCDate() - 1);
      limitDay = caracasParts(d).iso;
    }
    const limitIso = sh === 'night' ? `${limitDay}T21:30:00-04:00` : `${limitDay}T09:30:00-04:00`;
    const retrasoMin = Math.round((now.getTime() - new Date(limitIso).getTime()) / 60000);
    // round_date de NEGOCIO del inicio: una jornada de NOCHE iniciada (o reanudada
    // tras una parada) YA pasada la medianoche (ej. 00:13am) sigue perteneciendo a
    // la noche que arrancó AYER a las 7pm — usar `today` (calendario) aquí creaba un
    // round "fantasma" del día de HOY con horas de noche residuales que después
    // contaminaban la clasificación del turno noche de HOY (BUG real 10-ago-2026:
    // máquinas mostradas "Cerradas" horas ANTES de que el turno noche empezara).
    const roundDate = businessRoundDateOf(new Date(declaredIso), sh);

    setJornadaBusy(true); setNotice(null);
    const vis = await registrarVisita('trabajando');
    if (!vis) { setJornadaBusy(false); return; }
    const res = await upsertMachineRound(ci.id, roundDate, { jornada_start_at: declaredIso, jornada_shift: sh, ...(hiHas ? { horometro_inicial: hi } : {}), ...(horoIniPhoto ? { horometro_photo: horoIniPhoto } : {}) }, uid || null);
    setJornadaBusy(false);
    if (res.error) { setNotice('❌ ' + res.error); return; }
    setJornadaShift(sh);
    setJornadaStart(declaredIso);
    // REACTIVACIÓN: iniciar la jornada implica que la máquina VUELVE a trabajar, pero
    // eso es SOLO una reclasificación en memoria (ver `reactivada()`/`segmentoDe`, que
    // comparan jornada_start_at contra la avería/parada por TURNO) — NO se toca el
    // status real del ticket en `maintenance_requests`, que sigue "pendiente" en la BD
    // y visible en Mantenimiento de Maquinaria hasta que se resuelva de verdad (regla
    // confirmada 08-ago-2026). Antes este bloque marcaba TODO ticket pendiente de la
    // máquina como "realizado" sin filtrar por turno, cerrando también los del OTRO
    // turno (p.ej. el inspector de día cerraba la avería real marcada de noche). Si se
    // necesita cerrar un ticket de verdad, es la acción explícita "Volver a OPERATIVA"
    // (`volverOperativa`), no el simple inicio de jornada.
    // HORÓMETRO (solo mantenimiento · NO toca pagos): refleja el horómetro inicial como
    // horómetro VIVO de la máquina, y —la PRIMERA vez— fija la base de mantenimiento en
    // ese inicial para empezar a contar desde 0 (horas acum. = last_horometro − base,
    // regla 200/220/250 de Mantenimiento de Maquinaria). Best-effort: no bloquea nada.
    if (hiHas) {
      supabase.from('machinery').update({ last_horometro: hi }).eq('id', ci.id).then(() => {}, () => {});
      supabase.from('machinery').update({ horometro_base: hi }).eq('id', ci.id).is('horometro_base', null).then(() => {}, () => {});
    }
    // ¿La máquina venía AVERIADA? Si estuvo PARADA hoy (pendiente o reactivada hoy),
    // el inicio tardío es NORMAL (arrancó tarde porque estaba parada) → NO es tardanza
    // y NO genera alerta. Se detecta por la parada vigente o una avería resuelta hoy.
    let veniaAveriada = paradaIds.has(ci.id);
    if (!veniaAveriada) {
      try {
        const { data: av } = await supabase
          .from('maintenance_requests')
          .select('id')
          .eq('machinery_id', ci.id)
          .eq('material', 'MÁQUINA PARADA')
          .or(`status.eq.pendiente,resolved_at.gte.${today}T00:00:00-04:00`)
          .limit(1);
        veniaAveriada = (av?.length ?? 0) > 0;
      } catch {}
    }
    // Retraso que SÍ cuenta como alerta: 0 si venía averiada.
    const alertaRetraso = veniaAveriada ? 0 : retrasoMin;
    // Guarda el desfase (minutos) para que Inspecciones muestre "inició tarde".
    // Best-effort: si la columna jornada_late_min no existe aún, se ignora el error.
    supabase.from('machine_rounds').update({ jornada_late_min: alertaRetraso > 0 ? alertaRetraso : null }).eq('machinery_id', ci.id).eq('round_date', roundDate).then(() => {}, () => {});
    logAudit('JORNADA_INICIO', 'machinery', ci.id, `${ci.code} · inicio ${hh}:${mm} ${sh === 'night' ? '🌙' : '☀️'}${retrasoMin > 0 ? (veniaAveriada ? ' · inicio tardío por avería (sin alerta)' : ` · declarada ${retrasoLabel(retrasoMin)} tarde`) : ''}`); // bitácora
    // Camión: al INICIAR la jornada, se registra su SALIDA del patio.
    logTruckYardIfTruck(ci.id, ci.code, 'salida', uid || null, fullName || null);

    // ⏰ Alerta a los ADMIN si la jornada se declaró TARDE (después del límite) y NO
    // venía de una avería/parada (en ese caso el inicio tardío es esperado).
    if (alertaRetraso > 0) {
      const turnoTxt = sh === 'night' ? 'noche (límite 9:30pm)' : 'día (límite 9:30am)';
      notifyAdmins(
        'jornada_tarde',
        `Jornada declarada ${retrasoLabel(alertaRetraso)} tarde`,
        `🚜 ${ci.code}${ci.companyName ? ` · ${ci.companyName}` : ''} · inicio declarado ${hh}:${mm} (${turnoTxt}) · registrada por ${fullName || 'inspector'} a las ${caracasClock(now.toISOString())}.`,
        { machinery_id: ci.id, code: ci.code, retraso_min: alertaRetraso, shift: sh, declared_at: declaredIso }
      );
    }
    reloadEstados();
    setNotice(`🟢 Jornada iniciada en ${ci.code} · ${shiftFromKey(sh).label} · inicio ${hh}:${mm}.${alertaRetraso > 0 ? ` ⏰ Se avisó a admin: declarada ${retrasoLabel(alertaRetraso)} tarde.` : veniaAveriada && retrasoMin > 0 ? ' (inicio tardío por avería — sin alerta).' : ''} Aparece en Inspecciones.`);
  };

  // 🏁 FINALIZAR JORNADA: horas = (fin − inicio); se SUMAN al turno (día/noche)
  // en Control de maquinaria. Cierra la jornada (borra la hora de inicio).
  const finalizarJornada = async () => {
    if (!ci || !jornadaStart || jornadaBusy) return;
    if (!isOnline()) { setNotice('📶 Sin conexión: para finalizar jornada hace falta señal (suma horas contra el estado del servidor).'); return; }
    // El inspector puede FINALIZAR su jornada en cualquier momento (cierre manual
    // anticipado). Si no la cierra, el auto-cierre del servidor la cierra sola a las
    // 7:00pm (día) / 7:00am (noche). Antes había un bloqueo por hora que impedía
    // finalizar antes: se quitó a pedido (CESAR/REMBERTO no podían cerrar).
    // El horómetro final es OPCIONAL y NUNCA debe impedir finalizar la jornada: las
    // horas se cuentan por TIEMPO (inicio → fin), no por horómetro. Si lo ponen y es
    // un número válido (≥0) se guarda; si lo dejan vacío, igual se finaliza. Antes un
    // horómetro vacío o menor al inicial hacía un early-return y la jornada quedaba
    // "en curso" para siempre (los inspectores "finalizaban" pero no se reflejaba).
    const hfRaw = (horoFin || '').replace(',', '.').trim();
    const hfNum = hfRaw === '' ? NaN : Number(hfRaw);
    const hfValid = isFinite(hfNum) && hfNum >= 0;
    // El horómetro final NUNCA puede ser menor al inicial (si no, ese valor se
    // arrastraría como horómetro inicial erróneo de la próxima jornada). Solo se
    // valida si SÍ escribieron un horómetro final (vacío sigue siendo opcional y
    // no bloquea el cierre — ver nota arriba).
    if (hfValid) {
      const hi = Number((horoIni || '').replace(',', '.'));
      if (isFinite(hi) && hfNum < hi) { setNotice(`❌ El horómetro final (${hfNum}) no puede ser menor al inicial (${hi}).`); return; }
    }
    setJornadaBusy(true); setNotice(null);
    const ms = Date.now() - new Date(jornadaStart).getTime();
    const horas = Math.max(0, Math.round((ms / 3600000) * 100) / 100);
    // La jornada se cierra contra el round_date en que se INICIÓ (no el de "hoy"):
    // una jornada de noche que arranca 22:00 y termina 01:00 sigue perteneciendo al
    // round del día en que empezó (mismo criterio que el auto-cierre del servidor,
    // ver supabase/auto_close_jornadas.sql). Usar "today" aquí cerraba el round del
    // día EQUIVOCADO y dejaba el round original "en curso" para siempre.
    // `businessRoundDateOf` (no `caracasParts` a secas) porque `jornadaStart` puede
    // ser un inicio de NOCHE declarado él mismo ya pasada la medianoche (ej. 00:13am):
    // su fecha de calendario es HOY, pero de negocio pertenece a la noche de AYER —
    // mismo bucket que `iniciarJornada` usó para crear el round (ver su comentario).
    const roundDate = businessRoundDateOf(new Date(jornadaStart), jornadaShift);
    const prev = await getMachineRound(ci.id, roundDate);
    const key = jornadaShift === 'night' ? 'night_hours' : 'day_hours';
    const base = Number((prev as any)?.[key] ?? 0);
    const res = await upsertMachineRound(ci.id, roundDate, { [key]: Math.round((base + horas) * 100) / 100, ...(hfValid ? { horometro_final: hfNum } : {}), ...(horoFinPhoto ? { horometro_photo: horoFinPhoto } : {}), jornada_start_at: null }, uid || null);
    setJornadaBusy(false);
    if (res.error) { setNotice('❌ ' + res.error); return; }
    // HORÓMETRO (solo mantenimiento · NO toca pagos): si se registró horómetro final,
    // pasa a ser el horómetro VIVO de la máquina. Así las horas acumuladas de
    // mantenimiento (last_horometro − horometro_base = final − inicial) crecen y
    // disparan las alertas 200/220/250 en Mantenimiento de Maquinaria / Supervisión.
    // Best-effort: no bloquea el cierre de la jornada.
    if (hfValid) supabase.from('machinery').update({ last_horometro: hfNum }).eq('id', ci.id).then(() => {}, () => {});
    setJornadaStart(null);
    setFinConfirm(false);
    setHoroFin(''); setHoroFinPhoto(null);
    logAudit('JORNADA_FIN', 'machinery', ci.id, `${ci.code} · ${horas.toFixed(2)} h`); // bitácora
    // Camión: al FINALIZAR la jornada, se registra su ENTRADA al patio.
    logTruckYardIfTruck(ci.id, ci.code, 'entrada', uid || null, fullName || null);
    // 📋 Log auditable del tramo trabajado (best-effort: no debe bloquear ni
    // romper el cierre de jornada si falla).
    supabase.from('machine_work_segments').insert({
      machinery_id: ci.id, round_date: roundDate, shift: jornadaShift,
      started_at: jornadaStart, ended_at: new Date().toISOString(), hours: horas,
      source: 'manual_finish', recorded_by: uid || null,
    }).then(() => {}, () => {});
    reloadEstados();
    // TAREA 2: además del total de ESTA sesión, muestra el acumulado del turno en
    // el día (horas ya registradas antes de abrir esta sesión + lo recién cerrado).
    const totalAcumuladoTurno = Math.round((curRoundHours[jornadaShift] + horas) * 100) / 100;
    setNotice(`🏁 Jornada finalizada · ${horas.toFixed(2)} h → Control de maquinaria (turno ${jornadaShift === 'night' ? 'noche' : 'día'}). Acumulado del turno: ${totalAcumuladoTurno.toFixed(2)} h.`);
  };

  // Sube una foto de referencia para la avería del camino "PARADA · por avería".
  const subirFotoParadaAveria = async () => {
    if (!ci) return;
    setPaPhotoUp(true);
    const r = await captureAndUploadPhoto(ci.id, 'averias');
    setPaPhotoUp(false);
    if (r.ok && r.url) setPaPhoto(r.url);
    else if (r.error) setNotice('❌ ' + r.error);
  };

  // Ubicación GPS del inspector para el camino "PARADA · no trabajó" (dirección aproximada).
  // `silent`: no avisa si falla (uso automático al abrir la pestaña). La
  // ubicación es OPCIONAL en "no trabajó" — se intenta capturar sola en cuanto
  // se abre esa pestaña, sin obligar al inspector a tocar nada ni bloquear la
  // confirmación si no hay señal GPS o el usuario nunca dio permiso.
  const capturarUbicacionNoTrabajo = async (silent = false) => {
    setNtBusy(true);
    const r = await getCurrentCoords();
    setNtBusy(false);
    if (!r.ok || r.lat == null || r.lng == null) { if (!silent) setNotice('❌ ' + (r.error ?? 'No se pudo obtener tu ubicación.')); return; }
    setNtCoords({ lat: r.lat, lng: r.lng });
  };
  // Al abrir "Parada / No trabajó" intenta la ubicación sola, en segundo plano
  // (best-effort): si el inspector confirma antes de que termine o falla, no
  // pasa nada — la ubicación queda fuera de la nota, nunca bloquea el paso.
  useEffect(() => {
    if (paradaOpen && paradaTab === 'no_trabajo' && !ntCoords && !ntBusy) {
      capturarUbicacionNoTrabajo(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paradaOpen, paradaTab]);

  // 🟡 PARADA (base común a los 2 caminos): registra la visita "parada" en
  // INSPECCIONES y, si hay una jornada ABIERTA, primero BANCA las horas ya
  // trabajadas para que NO se pierdan (ej.: inició 7am, parada 9am → se guardan
  // esas 2h). Luego, al reiniciar y finalizar, se suma sobre lo bancado.
  const registrarParadaBase = async (source: 'parada_averia' | 'parada_no_trabajo'): Promise<boolean> => {
    if (!ci) return false;
    const vis = await registrarVisita('parada');
    if (!vis) return false;
    if (jornadaStart) {
      const horas = Math.max(0, Math.round(((Date.now() - new Date(jornadaStart).getTime()) / 3600000) * 100) / 100);
      // El bancado se hace contra el round_date en que se INICIÓ la jornada (no el
      // "hoy" de calendario): mismo criterio que finalizarJornada (ver su comentario)
      // para que una parada marcada después de medianoche, en una jornada de noche
      // que sigue abierta, no cree un round huérfano en el día equivocado.
      const roundDate = businessRoundDateOf(new Date(jornadaStart), jornadaShift);
      const prevRound = await getMachineRound(ci.id, roundDate);
      const key = jornadaShift === 'night' ? 'night_hours' : 'day_hours';
      const base = Number((prevRound as any)?.[key] ?? 0);
      const total = Math.round((base + horas) * 100) / 100;
      const res = await upsertMachineRound(ci.id, roundDate, { [key]: total, jornada_start_at: null }, uid || null);
      // Si el bancado de horas falla, NO seguimos como si hubiera ido bien: se
      // devuelve false para que marcarParadaAveria/marcarParadaNoTrabajo encolen
      // la operación completa (mismo camino que usan para el resto de fallos de
      // red), evitando perder las horas trabajadas y dejar jornada_start_at
      // huérfano en la BD (ver iniciarJornada/finalizarJornada: mismo chequeo).
      if (res.error) return false;
      // 📋 Log auditable del tramo trabajado (best-effort: no debe bloquear ni
      // romper el registro de la parada si falla).
      supabase.from('machine_work_segments').insert({
        machinery_id: ci.id, round_date: roundDate, shift: jornadaShift,
        started_at: jornadaStart, ended_at: new Date().toISOString(), hours: horas,
        source, recorded_by: uid || null,
      }).then(() => {}, () => {});
      setJornadaStart(null);
      setCurRoundHours((h) => ({ ...h, [jornadaShift === 'night' ? 'night' : 'day']: total }));
    }
    return true;
  };

  // 🟡 PARADA · POR AVERÍA: crea la solicitud en Mantenimiento de Maquinaria con
  // el material real (caucho/aceite/filtro/repuesto/otro, igual patrón que el QR
  // del operador) y, además, deja la máquina marcada PARADA (amarillo) en
  // Inspecciones (vía un registro paralelo "MÁQUINA PARADA", igual que antes).
  const marcarParadaAveria = async () => {
    if (!ci || ciSaving) return;
    if (!paMaterial) { setNotice('⚠️ Elige el material que necesita la máquina.'); return; }
    if (!ciMotivo.trim()) { setNotice('⚠️ Describe el motivo de la falla — es obligatorio.'); return; }
    setCiSaving(true); setNotice(null);
    // Sin señal: encola la visita "parada" + el bancado de horas (si había jornada
    // abierta) + las 2 solicitudes de Mantenimiento, tal cual — se reproducen en el
    // mismo orden al reconectar (ver replayOne en offlineQueue.ts).
    const encolar = async () => {
      // roundDate: día en que ARRANCÓ la jornada abierta (no "hoy"), mismo criterio
      // que registrarParadaBase/finalizarJornada — evita un round huérfano si la
      // parada se encola después de medianoche con una jornada de noche abierta.
      const hourBanking = jornadaStart
        ? { machineryId: ci.id, roundDate: businessRoundDateOf(new Date(jornadaStart), jornadaShift), shiftKey: (jornadaShift === 'night' ? 'night_hours' : 'day_hours') as 'day_hours' | 'night_hours', horas: Math.max(0, Math.round(((Date.now() - new Date(jornadaStart).getTime()) / 3600000) * 100) / 100) }
        : null;
      await enqueueParada({
        visita: { machineryId: ci.id, supervisorId: uid || null, supervisorName: fullName || 'Inspector', visitDate: today, status: 'parada', lat: gps?.lat ?? null, lng: gps?.lng ?? null, note: ciNote, machineLat: ci.latitude ?? null, machineLng: ci.longitude ?? null },
        maintenance: [
          { machinery_id: ci.id, material: paMaterial, quantity: paMaterial === 'otro' ? null : avNumOrNull(paQty), notes: ciMotivo.trim() || null, status: 'pendiente', requested_by: uid || null, photo_url: paPhoto },
          { machinery_id: ci.id, material: 'MÁQUINA PARADA', notes: ciMotivo.trim() || null, status: 'pendiente', requested_by: uid || null, photo_url: null },
        ],
        hourBanking,
        auditDetail: `${ci.code} · avería: ${matLabelOf(paMaterial)}${ciMotivo.trim() ? ` · ${ciMotivo.trim()}` : ''}`,
        machineryId: ci.id,
        machineCode: ci.code,
      }, `${ci.code} · PARADA (avería: ${matLabelOf(paMaterial)})`);
      if (jornadaStart) setJornadaStart(null);
      setCiSaving(false);
      setNotice(`📶 Sin conexión: ${ci.code} guardada como PARADA en el teléfono, se subirá sola cuando haya señal.`);
      setCiMotivo(''); setParadaOpen(false); setPaMaterial(null); setPaQty(''); setPaPhoto(null);
      setCi(null);
    };
    if (!isOnline()) { await encolar(); return; }
    const ok = await registrarParadaBase('parada_averia');
    // `isOnline()` casi siempre es `true` en el teléfono (sin NetInfo instalado, ver
    // offlineQueue.ts) — si `registrarParadaBase` falló igual (típicamente por falta
    // real de señal, ya que ahí solo hay llamadas de red), antes se perdía la parada
    // en silencio. Ahora se encola en vez de simplemente abandonar.
    if (!ok) { await encolar(); return; }
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from('maintenance_requests').insert({
        machinery_id: ci.id, material: paMaterial, quantity: paMaterial === 'otro' ? null : avNumOrNull(paQty),
        notes: ciMotivo.trim() || null, status: 'pendiente', requested_by: uid || null, photo_url: paPhoto,
      }),
      // Registro paralelo: es lo que hace que Inspecciones/Control sigan mostrando
      // la máquina como PARADA hasta que se pulse "Volver a OPERATIVA".
      supabase.from('maintenance_requests').insert({
        machinery_id: ci.id, material: 'MÁQUINA PARADA', notes: ciMotivo.trim() || null, status: 'pendiente', requested_by: uid || null,
      }),
    ]);
    setCiSaving(false);
    logAudit('PARADA', 'machinery', ci.id, `${ci.code} · avería: ${matLabelOf(paMaterial)}${ciMotivo.trim() ? ` · ${ciMotivo.trim()}` : ''}`); // bitácora
    reloadEstados();
    setNotice(`🟡 ${ci.code} marcada PARADA${(e1 || e2) ? ' · ⚠️ no se pudo registrar todo' : ' · 🔧 avería registrada (Mantenimiento)'}. Aparece en Inspecciones.`);
    setCiMotivo(''); setParadaOpen(false); setPaMaterial(null); setPaQty(''); setPaPhoto(null);
    setCi(null);
  };

  // 🟡 PARADA · NO TRABAJÓ: motivo fijo "NO TRABAJÓ LA MÁQUINA" + ubicación GPS y
  // dirección (edificio/referencia/sector) guardada en `notes`. NO crea ni afecta
  // nada en Mantenimiento de Maquinaria: solo se refleja en Inspecciones/Control.
  // La ubicación GPS es OPCIONAL aquí (se intenta sola en segundo plano al abrir
  // la pestaña, ver el useEffect de arriba): si no hay señal o el navegador
  // nunca dio permiso, igual se puede confirmar — la nota queda sin ubicación
  // en vez de bloquear al inspector.
  const marcarParadaNoTrabajo = async () => {
    if (!ci || ciSaving) return;
    if (!ntMotivo.trim()) { setNotice('⚠️ Escribe el motivo por el que no trabajó — es obligatorio.'); return; }
    setCiSaving(true); setNotice(null);
    const encolar = async () => {
      const edifRef = ((ci as any)?.referencia ?? '').trim();
      const edificio = ntCoords ? edificioTextOf(ntCoords.lat, ntCoords.lng, edifRef) : (edifRef || 'Sin ubicación');
      // "NO TRABAJÓ" es el texto FIJO; si el inspector escribió un motivo, va al lado.
      const motivoNT = ntMotivo.trim() ? `NO TRABAJÓ · ${ntMotivo.trim()}` : 'NO TRABAJÓ';
      const notas = `${motivoNT} · Edificio: ${edificio}${ntCoords ? ` · Ubicación: ${ntCoords.lat}, ${ntCoords.lng}` : ' · Ubicación: no disponible'}`;
      // roundDate: día en que ARRANCÓ la jornada abierta (no "hoy"), mismo criterio
      // que registrarParadaBase/finalizarJornada — evita un round huérfano si la
      // parada se encola después de medianoche con una jornada de noche abierta.
      const hourBanking = jornadaStart
        ? { machineryId: ci.id, roundDate: businessRoundDateOf(new Date(jornadaStart), jornadaShift), shiftKey: (jornadaShift === 'night' ? 'night_hours' : 'day_hours') as 'day_hours' | 'night_hours', horas: Math.max(0, Math.round(((Date.now() - new Date(jornadaStart).getTime()) / 3600000) * 100) / 100) }
        : null;
      await enqueueParada({
        visita: { machineryId: ci.id, supervisorId: uid || null, supervisorName: fullName || 'Inspector', visitDate: today, status: 'parada', lat: gps?.lat ?? null, lng: gps?.lng ?? null, note: ciNote, machineLat: ci.latitude ?? null, machineLng: ci.longitude ?? null },
        maintenance: [
          { machinery_id: ci.id, material: 'MÁQUINA PARADA', notes: notas, status: 'pendiente', requested_by: uid || null, photo_url: null },
        ],
        hourBanking,
        auditDetail: `${ci.code} · no trabajó · ${edificio}`,
        machineryId: ci.id,
        machineCode: ci.code,
      }, `${ci.code} · PARADA (no trabajó)`);
      if (jornadaStart) setJornadaStart(null);
      setCiSaving(false);
      setNotice(`📶 Sin conexión: ${ci.code} guardada como PARADA en el teléfono, se subirá sola cuando haya señal.`);
      setNtCoords(null); setNtMotivo(''); setParadaOpen(false);
      setCi(null);
    };
    if (!isOnline()) { await encolar(); return; }
    const ok = await registrarParadaBase('parada_no_trabajo');
    // Ver comentario equivalente en marcarParadaAveria: fallo de red mid-flujo
    // ahora se encola en vez de perderse.
    if (!ok) { await encolar(); return; }
    // CORRECCIÓN DE HORAS: si la jornada YA estaba cerrada (nada abierto ahora —
    // `registrarParadaBase` solo banca horas de una jornada EN CURSO), pero el inspector
    // afirma que la máquina NO trabajó, las horas que ya tenía acreditadas ese turno
    // (de un "Finalizar jornada" o de un cierre automático) quedarían de más. Se
    // corrigen a 0, con un tramo NEGATIVO auditable que registra la reversión — antes
    // no había forma de corregir esto desde el teléfono, solo un admin a mano en
    // Control de Maquinaria (caso real 10-ago-2026: 20 máquinas con horas acreditadas
    // que los inspectores corrigieron al día siguiente sin que nada cambiara).
    if (!jornadaStart && curRoundDate) {
      const shiftKey = jornadaShift === 'night' ? 'night_hours' : 'day_hours';
      const prevHoras = curRoundHours[jornadaShift === 'night' ? 'night' : 'day'];
      if (prevHoras > 0) {
        const resCorr = await upsertMachineRound(ci.id, curRoundDate, { [shiftKey]: 0 }, uid || null);
        if (!resCorr.error) {
          supabase.from('machine_work_segments').insert({
            machinery_id: ci.id, round_date: curRoundDate, shift: jornadaShift,
            started_at: new Date().toISOString(), ended_at: new Date().toISOString(), hours: -prevHoras,
            source: 'no_trabajo_correction', recorded_by: uid || null,
            notes: `Corrección: ${prevHoras}h ya acreditadas se anulan porque el inspector marcó NO TRABAJÓ`,
          }).then(() => {}, () => {});
          setCurRoundHours((h) => ({ ...h, [jornadaShift === 'night' ? 'night' : 'day']: 0 }));
        }
      }
    }
    const edifRef = ((ci as any)?.referencia ?? '').trim();
    const edificio = ntCoords ? edificioTextOf(ntCoords.lat, ntCoords.lng, edifRef) : (edifRef || 'Sin ubicación');
    // "NO TRABAJÓ" es el texto FIJO; si el inspector escribió un motivo, va al lado.
    const motivoNT = ntMotivo.trim() ? `NO TRABAJÓ · ${ntMotivo.trim()}` : 'NO TRABAJÓ';
    const notas = `${motivoNT} · Edificio: ${edificio}${ntCoords ? ` · Ubicación: ${ntCoords.lat}, ${ntCoords.lng}` : ' · Ubicación: no disponible'}`;
    const { error } = await supabase.from('maintenance_requests').insert({
      machinery_id: ci.id, material: 'MÁQUINA PARADA', notes: notas, status: 'pendiente', requested_by: uid || null,
    });
    setCiSaving(false);
    logAudit('PARADA', 'machinery', ci.id, `${ci.code} · no trabajó · ${edificio}`); // bitácora
    reloadEstados();
    setNotice(`🟡 ${ci.code} marcada PARADA · NO TRABAJÓ LA MÁQUINA${error ? ' · ⚠️ no se pudo guardar todo' : ''}. Aparece en Inspecciones.`);
    setNtCoords(null); setNtMotivo(''); setParadaOpen(false);
    setCi(null);
  };

  // 🟢 VOLVER A OPERATIVA: revierte una máquina PARADA. Registra una visita
  // "trabajando" (Inspecciones) y RESUELVE tanto la "MÁQUINA PARADA" pendiente
  // como cualquier avería REAL pendiente de esa máquina (Mantenimiento), con lo
  // que Control deja de mostrar "MÁQUINA PARADA" NI avería.
  //
  // ⚠️ Antes solo se resolvía 'MÁQUINA PARADA': una avería real (material
  // distinto, ej. "VÁLVULA") quedaba 'pendiente' PARA SIEMPRE aunque la máquina
  // ya estuviera arreglada y trabajando con normalidad — nada más en la app la
  // cerraba. Como avería pendiente ya NO decae con el tiempo (se arrastra
  // adrede, ver el fix de hoy en InspectionsSummary/SupervisorScreen), esa
  // avería vieja dejaba la máquina marcada 🔴 AVERIADA de forma permanente en
  // "POR INSPECTOR" y en el propio teléfono, sin ninguna forma de quitarla
  // salvo entrar a mano al módulo de Mantenimiento — causa real del reporte
  // de Remberto Rojas (06/08/2026): máquinas ya operativas hace tiempo que
  // seguían contando como averiadas por una avería vieja jamás cerrada aquí.
  const volverOperativa = async () => {
    if (!ci || ciSaving) return;
    setCiSaving(true); setNotice(null);
    const encolar = async () => {
      await enqueueVolverOperativa({
        visita: { machineryId: ci.id, supervisorId: uid || null, supervisorName: fullName || 'Inspector', visitDate: today, status: 'trabajando', lat: gps?.lat ?? null, lng: gps?.lng ?? null, note: ciNote, machineLat: ci.latitude ?? null, machineLng: ci.longitude ?? null },
        machineryId: ci.id,
        machineCode: ci.code,
        resolvedBy: uid || null,
      }, `${ci.code} · vuelve a OPERATIVA`);
      setCiSaving(false);
      setNotice(`📶 Sin conexión: ${ci.code} guardada como OPERATIVA en el teléfono, se subirá sola cuando haya señal.`);
    };
    if (!isOnline()) { await encolar(); return; }
    const vis = await registrarVisita('trabajando');
    const { error: upErr } = await supabase
      .from('maintenance_requests')
      .update({ status: 'realizado', resolved_by: uid || null, resolved_at: new Date().toISOString() })
      .eq('machinery_id', ci.id).eq('material', 'MÁQUINA PARADA').eq('status', 'pendiente');
    const { error: upErr2 } = await supabase
      .from('maintenance_requests')
      .update({ status: 'realizado', resolved_by: uid || null, resolved_at: new Date().toISOString() })
      .eq('machinery_id', ci.id).neq('material', 'MÁQUINA PARADA').eq('status', 'pendiente');
    // Las 3 escrituras fallaron: caso real de sin-señal (antes solo mostraba "❌ No se
    // pudo poner operativa" y se perdía). Si solo falló ALGUNA, se deja el aviso
    // parcial de abajo — reintentar completo por señal intermitente arriesgaría
    // duplicar la resolución de la avería/parada que sí se cerró.
    if (!vis && upErr && upErr2) { await encolar(); return; }
    setCiSaving(false);
    logAudit('JORNADA_INICIO', 'machinery', ci.id, `${ci.code} · vuelve a OPERATIVA`);
    await reloadEstados();
    setNotice(`🟢 ${ci.code} de nuevo OPERATIVA${upErr || upErr2 ? ' · ⚠️ una avería no se pudo cerrar' : ' · avería(s) cerrada(s) en Mantenimiento'}.`);
  };

  // Escanea el carnet del operador (QR ?empleado=<id>): valida que exista, que su
  // cargo pueda operar y que tenga cédula en nómina. Luego se coteja la cédula.
  const onOperatorCarnet = async (text: string) => {
    setOpScanOpen(false);
    const id = parseEmployeeId(text);
    if (!id) { setNotice('❌ Ese QR no es un carnet de empleado.'); return; }
    const { data } = await supabase.from('employees').select('id, first_name, last_name, cargo, cedula').eq('id', id).maybeSingle();
    const emp = data as any;
    if (!emp) { setOpEmp(null); setNotice('❌ Ese carnet no corresponde a un empleado registrado.'); return; }
    const nombre = `${emp.first_name || ''} ${emp.last_name || ''}`.trim();
    if (!isOperatorCargo(emp.cargo)) { setOpEmp(null); setNotice(`❌ ${nombre}${emp.cargo ? ` (${emp.cargo})` : ''} no es OPERADOR, CHOFER, SERVICIOS GENERALES ni OBRERO. No puede iniciar jornada.`); return; }
    if (!(emp.cedula || '').trim()) { setOpEmp(null); setNotice(`❌ ${nombre} no tiene CÉDULA en nómina. Pídele al administrador que la agregue.`); return; }
    setOpEmp({ id: emp.id, first: (emp.first_name || '').trim(), last: (emp.last_name || '').trim(), name: nombre, cargo: emp.cargo ?? null, cedula: String(emp.cedula).trim() });
    setOpConfirmCedula('');
    setOpShift(shiftOf(caracasParts(new Date()).hour).key); // sugiere el turno según la hora; el inspector puede cambiarlo
    setOpHoro(''); setOpHoroPhoto(null);
    setNotice(`📇 Carnet de ${nombre} leído. Coteja su cédula e ingresa el horómetro para iniciar la jornada.`);
  };

  // Coteja la cédula (debe coincidir con el carnet) e inicia la jornada del operador
  // en la máquina del check-in, con la ubicación del supervisor como punto de inicio.
  const confirmOperatorJornada = async () => {
    if (!ci || !opEmp || opBusy) return;
    const digits = (s: string) => (s || '').replace(/\D/g, '');
    if (digits(opConfirmCedula).length < 6) { setNotice('❌ Escribe la cédula del operador para cotejar.'); return; }
    if (digits(opConfirmCedula) !== digits(opEmp.cedula)) { setNotice('❌ La cédula no coincide con el carnet escaneado.'); return; }
    const hi = Number((opHoro || '').replace(',', '.'));
    if (!isFinite(hi) || hi < 0) { setNotice('❌ Ingresa el horómetro inicial de la máquina.'); return; }
    setOpBusy(true); setNotice(null);
    const res = await startJornada({
      machineId: ci.id, companyName: ci.companyName ?? null,
      first: opEmp.first, last: opEmp.last, cedula: opEmp.cedula, horometroInicial: hi,
      horometroPhoto: opHoroPhoto, shift: opShift,
      createdBy: uid || null, recordedBy: uid || null, startCoords: gps,
    });
    setOpBusy(false);
    if (!res.ok) { setNotice('❌ ' + res.error); return; }
    setNotice(`✅ Jornada iniciada para ${opEmp.name} en ${ci.code} · ${res.shift.label} · Horómetro ${hi}. (Registrada por el supervisor.)`);
    setOpEmp(null); setOpConfirmCedula(''); setOpHoro(''); setOpHoroPhoto(null);
  };

  // Foto del horómetro (cámara → sube y guarda la URL) para el inicio de jornada.
  const tomarFotoHoroSup = async () => {
    if (!ci) return;
    setOpHoroUploading(true);
    const r = await captureAndUploadPhoto(ci.id, 'horometro');
    setOpHoroUploading(false);
    if (!r.ok) { if (r.error) setNotice('⚠️ ' + r.error); return; }
    setOpHoroPhoto(r.url ?? null);
  };

  // ── ASISTENCIA: cargar marcas de HOY del empleado (para el botón inteligente) ──
  const asisLoadToday = async (employeeId: string) => {
    const { data } = await supabase
      .from('attendance')
      .select('id, employee_id, ts, work_date, kind, recorded_by, created_at')
      .eq('employee_id', employeeId)
      .eq('work_date', today)
      .order('ts', { ascending: true });
    setAsisToday((data ?? []) as Attendance[]);
  };
  // Elige un empleado (por escaneo o búsqueda) y carga sus marcas de hoy.
  const asisPick = async (employeeId: string) => {
    setAsisQuery(''); setAsisResults([]);
    const { data, error } = await supabase.from('employees').select(ASIS_COLS).eq('id', employeeId).maybeSingle();
    if (error || !data) { setAsisNotice('❌ No se encontró ese empleado. Verifica el carnet.'); return; }
    setAsisEmp(data as AsisEmp);
    setAsisNotice(null);
    await asisLoadToday(employeeId);
  };
  const asisOnScanned = (text: string) => {
    setAsisScan(false);
    const id = parseEmployeeId(text);
    if (!id) { setAsisNotice('❌ Ese QR no es un carnet de empleado válido.'); return; }
    asisPick(id);
  };
  // Búsqueda por nombre/cédula (debounce simple) mientras el modal esté abierto.
  useEffect(() => {
    if (!asisOpen) return;
    const term = norm(asisQuery.trim());
    if (term.length < 2) { setAsisResults([]); return; }
    let alive = true;
    const t = setTimeout(async () => {
      const { data } = await supabase.from('employees').select(ASIS_COLS)
        .or(`first_name.ilike.*${asisQuery.trim()}*,last_name.ilike.*${asisQuery.trim()}*,cedula.ilike.*${asisQuery.trim()}*`)
        .order('first_name').limit(20);
      if (alive) setAsisResults((data ?? []) as AsisEmp[]);
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [asisQuery, asisOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const asisLastKind = asisToday.length ? asisToday[asisToday.length - 1].kind : null;
  const asisWillMark = nextKind(asisLastKind);
  // Marca ENTRADA/SALIDA (decide sola). Si toca SALIDA se pide confirmación para
  // evitar registrar una salida por un doble escaneo del mismo carnet.
  const asisMarcar = async () => {
    if (!asisEmp) return;
    if (asisWillMark === 'salida') {
      const lastIn = [...asisToday].reverse().find((m) => m.kind === 'entrada');
      const minsSince = lastIn ? Math.round((Date.now() - new Date(lastIn.ts).getTime()) / 60000) : null;
      const dobleEscaneo = minsSince !== null && minsSince < 2;
      const ok = await confirm({
        title: dobleEscaneo ? '¿Doble escaneo?' : '¿Registrar SALIDA?',
        message: dobleEscaneo
          ? `La ENTRADA de ${asisFullName(asisEmp)} fue hace ${minsSince! < 1 ? 'menos de 1 minuto' : `${minsSince} min`}. Parece un doble escaneo del carnet, no una salida real. ¿Registrar la SALIDA de todas formas?`
          : `¿Seguro que quieres registrar la SALIDA de ${asisFullName(asisEmp)}?` + (lastIn ? `\n\nSu última ENTRADA fue a las ${fmtHora(lastIn.ts)} (${SHIFT_LABEL[shiftOfTs(lastIn.ts)]}).` : ''),
        cancelText: dobleEscaneo ? 'No, fue doble escaneo' : 'Cancelar',
        confirmText: 'Sí, registrar salida',
        danger: true,
      });
      if (!ok) return;
    }
    setAsisBusy(true);
    const r = await markAttendance(asisEmp.id, uid || null);
    setAsisBusy(false);
    if (!r.ok) { setAsisNotice('❌ ' + r.error); return; }
    await asisLoadToday(asisEmp.id);
    setAsisNotice(`${r.kind === 'entrada' ? '➡️ ENTRADA' : '⬅️ SALIDA'} de ${asisFullName(asisEmp)} registrada a las ${fmtHora(r.ts)} (${SHIFT_LABEL[shiftOfTs(r.ts)]}).`);
  };
  const asisTotal = useMemo(() => pairMarks(asisToday), [asisToday]);

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  if (loading) return <Screen><ConfigBanner /><SkeletonList /></Screen>;

  // ¿La referencia es un edificio legible? (descarta coordenadas / solo números).
  const edificioDe = (m: Mach): string | null => {
    const t = ((m as any).referencia ?? '').trim();
    return t && !/^[\d.,\s-]+$/.test(t) ? t : null;
  };
  const renderMachine = (m: Mach) => {
    const v = visits[m.id];
    const est = estadoDe(m.id); // 🟢 trabajando / 🟡 parada / 🔴 finalizada
    const edif = edificioDe(m);
    return (
      <TouchableOpacity
        key={m.id}
        onPress={() => openCheckin(m)}
        style={{ padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: est ? est.color : (v ? colors.success : colors.border), backgroundColor: colors.surface, marginBottom: spacing.xs }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            {/* Círculo de estado de la jornada */}
            <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: est ? est.color : colors.border }} />
            <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '800', flex: 1 }}>{m.code}</Text>
          </View>
          {v ? (
            <Text style={{ color: colors.success, fontSize: 12, fontWeight: '800' }}>✓ {caracasClock(v.visited_at)}</Text>
          ) : segmentoDe(m.id) === 'averia' ? (
            // Averiada: arrastra su estado (avería pendiente), no "pendiente por revisar".
            <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '800' }}>🔴 Averiada</Text>
          ) : segmentoDe(m.id) === 'parada' ? (
            // Parada (hoy o arrastrada del día anterior): se muestra parada, no "pendiente".
            <Text style={{ color: colors.warning, fontSize: 12, fontWeight: '800' }}>🟡 Parada</Text>
          ) : (
            <Text style={{ color: colors.warning, fontSize: 12, fontWeight: '800' }}>⏳ Pendiente</Text>
          )}
        </View>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{(m.tipo || 'Sin tipo')} · {m.companyName}</Text>
        {/* Referencia / edificio de la máquina + serial y placa (ambos, no solo uno). */}
        <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
          📍 {edif || 'Sin edificio/referencia'}
          {(m as any).serial ? ` · Serial: ${(m as any).serial}` : ''}
          {(m as any).plate ? ` · Placa: ${(m as any).plate}` : ''}
        </Text>
        {/* Encargado de la máquina (del catálogo: machinery.encargado). */}
        {m.encargado ? <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>👤 Encargado: {m.encargado}</Text> : null}
        {/* Estado de la jornada (con su color) */}
        {est ? <Text style={{ color: est.color, fontSize: 12, fontWeight: '800', marginTop: 2 }}>{est.icon} {est.label}{est.label === 'Parada' && paradaMotivoDe(m.id) ? ` · ${paradaMotivoDe(m.id)}` : ''}</Text> : null}
        {/* Inspectores asignados (día / noche) */}
        {(() => {
          const s = assignMap[m.id] || {};
          const parts = [s.day ? `☀️ ${s.day.name}` : null, s.night ? `🌙 ${s.night.name}` : null].filter(Boolean).join('  ·  ');
          return parts ? <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700', marginTop: 2 }}>{parts}</Text> : null;
        })()}
        {/* Admin o coordinador de inspectores: asignar/reasignar el inspector de esta máquina (día/noche). */}
        {puedeCoordinar ? (
          <TouchableOpacity
            onPress={() => { setAssignFor(m); setPickShift(null); setAssignForQuery(''); }}
            style={{ alignSelf: 'flex-start', marginTop: spacing.xs, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 }}
          >
            <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12 }}>👮 Asignar / reasignar inspector</Text>
          </TouchableOpacity>
        ) : null}
      </TouchableOpacity>
    );
  };

  // TAREA 1: chips de filtro por segmento, arriba de la lista de máquinas (mismo
  // estilo de chip-pill ya usado en este archivo, ej. filtro de pendMode/checkFilter).
  const SEG_CHIPS: { key: 'all' | 'pendiente' | 'iniciada' | 'cerrada' | 'parada' | 'averia'; label: string }[] = [
    { key: 'all', label: 'Todas' },
    { key: 'pendiente', label: '⏳ Pendientes por iniciar' },
    { key: 'iniciada', label: '🟢 Iniciadas' },
    { key: 'cerrada', label: '🏁 Cerradas / finalizadas' },
    { key: 'parada', label: '🟡 Paradas' },
    { key: 'averia', label: '🔧 Por avería' },
  ];
  const renderSegChips = () => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.xs, marginBottom: spacing.xs }}>
      {SEG_CHIPS.map((c) => {
        const on = segFilter === c.key;
        return (
          <TouchableOpacity
            key={c.key}
            onPress={() => setSegFilter(c.key)}
            style={{ paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt }}
          >
            <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{c.label} ({segCountsBase[c.key]})</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const revisadas = Object.keys(visits).length;

  return (
    <Screen onRefresh={load} refreshing={loading}>
      <ConfigBanner />
      {pendingSync > 0 ? (
        <View style={{ backgroundColor: '#FEF3C7', borderRadius: radius.md, borderWidth: 1, borderColor: '#F59E0B', padding: spacing.sm, marginBottom: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 16 }}>📶</Text>
          <Text style={{ color: '#92400E', fontSize: 12.5, fontWeight: '700', flex: 1 }}>
            {pendingSync} {pendingSync === 1 ? 'acción guardada' : 'acciones guardadas'} en el teléfono sin subir. Se suben solas al recuperar señal.
          </Text>
        </View>
      ) : null}
      {uiV2 ? (
        <>
          {/* El círculo del avatar (menú) SOLO cuando hay algo exclusivo que mostrar: el
              botón "Sistema" (para quien entra al panel con onSistema). El resto de
              funciones (actualizar app, cambiar contraseña, tema…) ya viven en la tuerca
              ⚙️ del encabezado global, así que para el inspector normal NO se muestra el
              círculo (era redundante). */}
          <InspectorHeaderBar
            name={fullName || 'Mi ronda'}
            subtitle="Inspector"
            onMenuPress={onSistema ? () => setMenuOpen(true) : undefined}
          />
          <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
            <Pressable onPress={() => setMenuOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', paddingTop: 56, paddingRight: spacing.md, alignItems: 'flex-end' }}>
              <Pressable onPress={() => {}} style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, minWidth: 230, overflow: 'hidden' }}>
                <TouchableOpacity onPress={() => { setMenuOpen(false); if (!loading) { setLoading(true); load(); } }} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md }}>
                  <Text style={{ fontSize: 16 }}>🔄</Text>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{loading ? 'Actualizando…' : 'Actualizar'}</Text>
                </TouchableOpacity>
                {/* "Actualizar app" ya NO va aquí: vive en la tuerca ⚙️ del encabezado
                    global (disponible en todas las pantallas). Aquí solo queda lo propio
                    del panel de inspector. */}
                {onSistema ? (
                  <TouchableOpacity onPress={() => { setMenuOpen(false); onSistema(); }} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }}>
                    <Text style={{ fontSize: 16 }}>🗂️</Text>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Sistema</Text>
                  </TouchableOpacity>
                ) : null}
                {/* Sin "Cerrar sesión" aquí a propósito: el header nativo de arriba
                    (mismo en toda la app) ya lo tiene — repetirlo era redundante. */}
                <View style={{ borderTopWidth: 1, borderTopColor: colors.border, padding: spacing.md }}>
                  <ChangePasswordButton variant="row" />
                </View>
              </Pressable>
            </Pressable>
          </Modal>

          <View style={{ marginTop: spacing.sm }}>
            <InspectorHeroCard
              onScanPress={() => setScanOpen(true)}
              secondaryActions={[
                ...(canAsistencia ? [{ key: 'asistencia', label: 'MARCAR ASISTENCIA', icon: '🕒', color: '#0EA5E9', onPress: () => { setAsisOpen(true); setAsisEmp(null); setAsisToday([]); setAsisQuery(''); setAsisResults([]); setAsisNotice(null); } }] : []),
              ]}
            />
            {/* ✅ CHECK MÁQUINA: AFUERA del hero card (pedido del cliente) — botón propio,
                bien visible en la pantalla de inspectores (en PC se acota el ancho). */}
            {puedeCoordinar ? (
              <>
                <TouchableOpacity
                  onPress={() => { setCheckQuery(''); setInspQuery(''); setCheckInspector(null); setPendSelected(new Set()); setCheckOpen(true); }}
                  activeOpacity={0.85}
                  style={[{ marginTop: spacing.sm, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.xs, borderWidth: 2, borderColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md },
                    Platform.OS === 'web' ? { maxWidth: 360, width: '100%', alignSelf: 'center' } : null]}
                >
                  <Text style={{ fontSize: 20 }}>✅</Text>
                  <Text style={{ color: colors.primary, fontWeight: '900', fontSize: 16, letterSpacing: 0.5 }}>CHECK MÁQUINA</Text>
                </TouchableOpacity>
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs, textAlign: 'center' }}>
                  Asigna y REASIGNA las máquinas a cada inspector (día / noche).
                </Text>
              </>
            ) : (
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs, textAlign: 'center' }}>
                Toca una máquina de la lista o escanea su QR para marcarla.
              </Text>
            )}
          </View>
        </>
      ) : (
        <>
          <View>
            {/* Fila 1: nombre del inspector + Salir (el nombre se recorta, no se apila). */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Inspector</Text>
                <Text numberOfLines={1} style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>{fullName || 'Mi ronda'}</Text>
              </View>
              <TouchableOpacity onPress={signOut} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Salir</Text>
              </TouchableOpacity>
            </View>
            {/* Fila 2: acciones (se acomodan en varias líneas si no caben). */}
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
              {/* 🔄 ACTUALIZAR: recarga manual desde el teléfono. En web (navegador móvil)
                  el "jalar para refrescar" del Screen no funciona; este botón sí recarga
                  máquinas, asignaciones, jornadas, paradas y averías (llama a `load`). */}
              <TouchableOpacity
                onPress={() => { if (!loading) { setLoading(true); load(); } }}
                disabled={loading}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, opacity: loading ? 0.6 : 1 }}
              >
                <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12 }}>{loading ? '⏳ Actualizando…' : '🔄 Actualizar'}</Text>
              </TouchableOpacity>
              {/* "Actualizar app" ya NO va aquí: vive en la tuerca ⚙️ del encabezado global. */}
              {/* Solo ADMIN (en teléfono) y, por excepción puntual, Jesús Lozada: ir a la app completa (SISTEMA). */}
              {onSistema ? (
                <TouchableOpacity onPress={onSistema} style={{ backgroundColor: '#0F172A', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>🗂️ SISTEMA</Text>
                </TouchableOpacity>
              ) : null}
              <ChangePasswordButton />
            </View>
          </View>

          <Card>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>🪖 Mi ronda de hoy</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
              Revisadas hoy: <Text style={{ color: colors.success, fontWeight: '800' }}>{revisadas}</Text>
              {mine.length > 0 ? <> · Mis máquinas: <Text style={{ color: colors.text, fontWeight: '800' }}>{mine.length}</Text></> : null}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
              Toca una máquina o escanea su QR para marcarla. Si no la marcas, esa jornada queda sin validar.
            </Text>
            {/* Botón GRANDE y cuadrado para escanear (pensado para el teléfono). */}
            <TouchableOpacity
              onPress={() => setScanOpen(true)}
              activeOpacity={0.85}
              style={{ marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.lg, aspectRatio: 1.35, maxHeight: 220, width: '100%', alignSelf: 'center', alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontSize: 64 }}>📷</Text>
              <Text style={{ color: colors.primaryContrast, fontWeight: '900', fontSize: 20, marginTop: spacing.sm, letterSpacing: 0.5 }}>ESCANEAR QR</Text>
              <Text style={{ color: colors.primaryContrast, fontSize: 12, opacity: 0.9, marginTop: 2 }}>Apunta al código de la máquina</Text>
            </TouchableOpacity>
            {/* MARCAR ASISTENCIA DEL PERSONAL: solo los usuarios con permiso del
                módulo 'asistencia' pueden verlo. Abre un modal para escanear/buscar
                al empleado y marcar su ENTRADA/SALIDA. */}
            {canAsistencia ? (
              <TouchableOpacity
                onPress={() => { setAsisOpen(true); setAsisEmp(null); setAsisToday([]); setAsisQuery(''); setAsisResults([]); setAsisNotice(null); }}
                activeOpacity={0.85}
                style={{ marginTop: spacing.sm, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.xs, borderWidth: 2, borderColor: '#0EA5E9', borderRadius: radius.md, paddingVertical: spacing.md }}
              >
                <Text style={{ fontSize: 20 }}>🕒</Text>
                <Text style={{ color: '#0EA5E9', fontWeight: '900', fontSize: 16, letterSpacing: 0.5 }}>MARCAR ASISTENCIA DEL PERSONAL</Text>
              </TouchableOpacity>
            ) : null}
            {/* CHECK MÁQUINA (admin o coordinador de inspectores): asignar máquinas a los inspectores. */}
            {puedeCoordinar ? (
              <>
                <TouchableOpacity
                  onPress={() => { setCheckQuery(''); setInspQuery(''); setCheckInspector(null); setPendSelected(new Set()); setCheckOpen(true); }}
                  activeOpacity={0.85}
                  style={{ marginTop: spacing.sm, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.xs, borderWidth: 2, borderColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md }}
                >
                  <Text style={{ fontSize: 20 }}>✅</Text>
                  <Text style={{ color: colors.primary, fontWeight: '900', fontSize: 16, letterSpacing: 0.5 }}>CHECK MÁQUINA</Text>
                </TouchableOpacity>
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4, textAlign: 'center' }}>
                  Asigna las máquinas a cada inspector (día / noche). Solo el administrador o el coordinador de inspectores puede asignar.
                </Text>
              </>
            ) : (
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm, textAlign: 'center' }}>
                Aquí ves las máquinas que el administrador te asignó. Tócalas para hacer el check-in.
              </Text>
            )}
          </Card>
        </>
      )}

      {/* 📄 Cierre de jornada: PDF descargable con el resumen de MIS máquinas de
          este turno, para tener respaldo propio (misma data que el reporte que
          imprime el jefe). Solo sale cuando ya no queda ninguna en curso. */}
      {puedeDescargarCierre ? (
        <TouchableOpacity onPress={descargarCierreJornada} disabled={receiptBusy} activeOpacity={0.85} style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.xs, backgroundColor: '#1E3A5F', borderRadius: radius.md, paddingVertical: spacing.sm, marginBottom: spacing.sm, opacity: receiptBusy ? 0.6 : 1 }}>
          <Text style={{ fontSize: 16 }}>📄</Text>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>{receiptBusy ? 'Generando…' : 'Descargar mi reporte de cierre (PDF)'}</Text>
        </TouchableOpacity>
      ) : null}

      {/* 📚 HISTÓRICO por inspector (jornadas finalizadas) — también desde el teléfono. */}
      <TouchableOpacity onPress={() => setShowHist(true)} activeOpacity={0.85} style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.xs, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, marginBottom: spacing.sm }}>
        <Text style={{ fontSize: 16 }}>📚</Text>
        <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 14 }}>Histórico por inspector</Text>
      </TouchableOpacity>
      <Modal visible={showHist} animationType="slide" onRequestClose={() => setShowHist(false)}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <TouchableOpacity onPress={() => setShowHist(false)} style={{ alignSelf: 'flex-end', paddingHorizontal: spacing.md, paddingTop: spacing.md }}>
            <Text style={{ color: colors.primary, fontWeight: '900', fontSize: 16 }}>✕ Cerrar</Text>
          </TouchableOpacity>
          <HistoricoJornadasScreen />
        </View>
      </Modal>

      {notice ? (
        <Card><Text style={{ color: notice.startsWith('❌') ? colors.danger : colors.success, fontWeight: '700' }}>{notice}</Text></Card>
      ) : null}

      {/* CONMUTADOR del coordinador: "🚜 Máquinas" (su ronda de siempre, con
          buscador de MÁQUINAS) vs "👥 Inspectores" (buscador de PERSONAS,
          operar por cada inspector). Solo lo ve el coordinador/admin.
          Antes no quedaba claro que cada pestaña tiene su PROPIO buscador
          (uno indexa datos de la máquina, el otro nombre del inspector) —
          queja real: "no hay buscador... si necesito buscar las personas"
          cuando en realidad estaba en la otra pestaña (11-ago-2026). */}
      {puedeCoordinar ? (
        <View style={{ marginBottom: spacing.sm }}>
          <View style={{ flexDirection: 'row', gap: spacing.xs }}>
            {([['maquinas', '🚜 Buscar máquina'], ['inspectores', '👥 Buscar inspector']] as const).map(([k, label]) => {
              const on = coordTab === k;
              return (
                <TouchableOpacity key={k} onPress={() => setCoordTab(k)} style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1.5, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface }}>
                  <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={{ color: colors.muted, fontSize: 10.5, marginTop: 4, textAlign: 'center' }}>
            {coordTab === 'maquinas' ? 'Busca por nombre, serial o placa de la máquina.' : 'Busca por nombre del inspector.'}
          </Text>
        </View>
      ) : null}

      {uiV2 && coordTab === 'maquinas' ? (
        <View style={{ marginBottom: spacing.sm }}>
          <InspectorSearchBar
            value={showAll ? query : mineQuery}
            onChange={showAll ? setQuery : onMineQueryChange}
            placeholder="🔎 Buscar máquina: nombre, serial, placa, empresa…"
            segments={puedeCoordinar ? [{ key: 'mine', label: '👤 Solo las mías' }, { key: 'all', label: '🚜 Todas las máquinas' }] : undefined}
            segmentValue={showAll ? 'all' : 'mine'}
            onSegmentChange={(k) => setShowAll(k === 'all')}
          />
          {!showAll ? (
            <View style={{ marginTop: spacing.sm }}>
              <InspectorKpiGrid
                items={[
                  { key: 'iniciadas', label: 'Iniciadas', value: grupos.iniciadas.length, tone: 'success', icon: '🟢' },
                  { key: 'cerradas', label: 'Cerradas', value: grupos.cerradas.length, tone: 'brand', icon: '🏁' },
                  { key: 'pendientes', label: 'Pendientes', value: grupos.pendientes.length, tone: 'accent', icon: '⏳' },
                  { key: 'paradas', label: 'Paradas', value: grupos.paradas.length, tone: 'warning', icon: '🟡' },
                  { key: 'averiadas', label: 'Averiadas', value: grupos.averiadas.length, tone: 'danger', icon: '🔴' },
                ]}
                activeKey={Object.entries(grpOpen).find(([, v]) => v)?.[0] ?? null}
                onSelect={(key) => {
                  const wasOpen = !!grpOpen[key];
                  setGrpOpen({ iniciadas: false, cerradas: false, pendientes: false, paradas: false, averiadas: false, [key]: !wasOpen });
                }}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {coordTab === 'inspectores' ? (
        // 👥 Sub-vista del coordinador: cada inspector con sus máquinas por estado.
        // Tocar una máquina abre el MISMO check-in (openCheckin) → operar por el inspector.
        <CoordinadorInspectoresView
          rows={inspectoresView}
          shiftLabel={nowShift === 'day' ? '☀️ Día (7am–7pm)' : '🌙 Noche (7pm–7am)'}
          query={coordQuery}
          onQueryChange={setCoordQuery}
          expanded={coordExpanded}
          onToggle={(id) => setCoordExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; })}
          onTapMachine={(m) => openCheckin(m as Mach)}
        />
      ) : puedeCoordinar && showAll ? (
        // Admin o coordinador de inspectores: ver TODAS las máquinas. El inspector normal no ve esto.
        <>
          {!uiV2 ? (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <SectionTitle>Todas las máquinas</SectionTitle>
                <TouchableOpacity onPress={() => setShowAll(false)}><Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>Solo las mías</Text></TouchableOpacity>
              </View>
              <TextInput value={query} onChangeText={setQuery} placeholder="🔎 Buscar: nombre, serial, placa, empresa, encargado, edificio…" placeholderTextColor={colors.muted} style={input} />
              {renderSegChips()}
            </>
          ) : (
            <>
              <SectionTitle>Todas las máquinas</SectionTitle>
              {/* Chips de filtro por estado — antes solo se pintaban en la rama vieja
                  (!uiV2), que quedó inalcanzable al fijar uiV2=true: el coordinador
                  entraba por defecto a "Todas las máquinas" sin ninguna forma de
                  filtrar por avería/parada/pendiente, solo texto libre sobre ~200
                  equipos. */}
              {renderSegChips()}
            </>
          )}
          {/* Lista COLAPSABLE: no se pinta nada hasta que se despliega, y respeta el
              buscador + chip de segmento de arriba (searchList ya viene filtrado). */}
          <TouchableOpacity
            onPress={() => setAllListOpen((v) => !v)}
            activeOpacity={0.7}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, padding: spacing.md }}
          >
            <Text style={{ flex: 1, color: colors.text, fontWeight: '900', fontSize: 14 }}>
              {allListOpen ? 'Ocultar resultados' : 'Ver resultados'}
            </Text>
            <View style={{ minWidth: 30, alignItems: 'center', backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 2 }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13, fontVariant: ['tabular-nums'] as any }}>{searchList.length}</Text>
            </View>
            <Text style={{ color: colors.muted, fontSize: 16, fontWeight: '900' }}>{allListOpen ? '▾' : '▸'}</Text>
          </TouchableOpacity>
          {allListOpen ? (
            <View style={{ marginTop: spacing.xs }}>
              {searchList.slice(0, 100).map(renderMachine)}
              {searchList.length === 0 ? <EmptyState title="Sin resultados" subtitle="Prueba con otro nombre, empresa o cambia el filtro." /> : null}
            </View>
          ) : null}
        </>
      ) : (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <SectionTitle>Mis máquinas asignadas</SectionTitle>
            {puedeCoordinar && !uiV2 ? <TouchableOpacity onPress={() => setShowAll(true)}><Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>Ver todas</Text></TouchableOpacity> : null}
          </View>
          {mine.length > 0 ? (
            <View style={{ marginTop: spacing.xs, gap: spacing.xs }}>
              {/* 4 grupos por ESTADO, COLAPSADOS por defecto, con contador y buscador propio. */}
              {([
                { key: 'iniciadas', label: 'Iniciadas', icon: '🟢', color: colors.success, desc: 'Jornada abierta ahora mismo' },
                { key: 'cerradas', label: 'Cerradas / finalizadas', icon: '🏁', color: colors.brandText, desc: 'Jornada finalizada hoy (con horas)' },
                { key: 'pendientes', label: 'Pendientes por iniciar', icon: '⏳', color: colors.brandText, desc: 'Aún sin iniciar la jornada de hoy' },
                { key: 'paradas', label: 'Paradas / no trabajó', icon: '🟡', color: colors.warning, desc: 'Paradas (arrastran el estado del día anterior)' },
                { key: 'averiadas', label: 'Averiadas', icon: '🔴', color: colors.danger, desc: 'Con avería pendiente por resolver' },
              ] as const).map(({ key, label, icon, color, desc }) => {
                const all = grupos[key];
                const open = !!grpOpen[key];
                const q = norm((grpQuery[key] || '').trim());
                const shown = q ? all.filter((m) => matchQuery(m, q)) : all;
                const n = all.length;
                return (
                  <View key={key} style={{ borderWidth: 1, borderColor: open ? color : colors.border, borderRadius: radius.md, backgroundColor: 'transparent', overflow: 'hidden' }}>
                    {/* MISMA fila del MENÚ (ver MoreScreen): ícono + título + subtítulo + CANTIDAD + chevron. Al tocar despliega la lista de ese estado. */}
                    <TouchableOpacity onPress={() => setGrpOpen((s) => ({ ...s, [key]: !open }))} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 13, paddingLeft: spacing.md, paddingRight: spacing.md }}>
                      <Text style={{ fontSize: 24, width: 30, textAlign: 'center' }}>{icon}</Text>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '700', fontSize: 15.5 }}>{label}</Text>
                        <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11.5, marginTop: 1 }}>{n} {n === 1 ? 'máquina' : 'máquinas'} · {desc}</Text>
                      </View>
                      <Text style={{ color, fontWeight: '900', fontSize: 16, fontVariant: ['tabular-nums'] as any, minWidth: 20, textAlign: 'right' }}>{n}</Text>
                      <Text style={{ color: colors.muted, fontSize: 20 }}>{open ? '⌄' : '›'}</Text>
                    </TouchableOpacity>
                    {open ? (
                      <View style={{ paddingHorizontal: spacing.sm, paddingBottom: spacing.sm }}>
                        {all.length > 0 ? (
                          <TextInput value={grpQuery[key] || ''} onChangeText={(t) => setGrpQuery((s) => ({ ...s, [key]: t }))} placeholder="🔎 Filtrar: nombre, serial, placa, empresa, encargado, edificio…" placeholderTextColor={colors.muted} style={input} />
                        ) : null}
                        <View style={{ marginTop: spacing.xs }}>
                          {shown.map(renderMachine)}
                          {all.length === 0 ? <EmptyState title="Sin máquinas" subtitle={`No tienes máquinas ${label.toLowerCase()}.`} /> : shown.length === 0 ? <EmptyState title="Sin resultados" subtitle="Ninguna coincide con el filtro." /> : null}
                        </View>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : (
            <EmptyState title="Aún no tienes máquinas asignadas" subtitle="Toca ✅ CHECK MÁQUINA para asignarte las que inspeccionas." />
          )}
        </>
      )}

      {/* Seguridad: iniciar sesión con huella (disponible para todos los usuarios). */}
      <SectionTitle>Seguridad</SectionTitle>
      <BiometricToggle />

      {/* Escáner de QR → abre el check-in de esa máquina. */}
      <Modal visible={scanOpen} animationType="slide" onRequestClose={() => setScanOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <QrScanner
            onClose={() => setScanOpen(false)}
            onDetected={(text) => {
              const id = parseMachineId(text);
              const found = id ? machines.find((m) => m.id === id) : null;
              if (found) openCheckin(found);
              else { setScanOpen(false); setNotice('❌ El QR no corresponde a una máquina registrada.'); }
            }}
          />
        </View>
      </Modal>

      {/* ✅ CHECK MÁQUINA (SOLO ADMIN): 1) elegir inspector · 2) asignarle máquinas por turno. */}
      <Modal visible={checkOpen} animationType="slide" onRequestClose={() => setCheckOpen(false)}>
        <Screen>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18 }}>✅ CHECK máquina</Text>
              <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>
                {checkInspector ? <>Inspector: <Text style={{ color: colors.primary, fontWeight: '800' }}>{checkInspector.name}</Text></> : 'Elige el inspector'}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setCheckOpen(false)} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Listo</Text>
            </TouchableOpacity>
          </View>

          {/* Pestañas: 👮 Asignar (elegir inspector → asignar, incluye por lotes) vs
              📋 Resumen (colapsado por inspector + faltan por asignar). Ocultas en la
              subvista de pendientes. */}
          {!pendOpen ? (
            <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
              {(['assign', 'resumen'] as const).map((mk) => {
                const on = checkMode === mk;
                return (
                  <TouchableOpacity key={mk} onPress={() => setCheckMode(mk)} style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1.5, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface }}>
                    <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{mk === 'assign' ? '👮 Asignar' : '📋 Resumen'}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          {checkMode === 'resumen' && !pendOpen ? (
            // ── 📋 RESUMEN: colapsado por inspector + grupo "faltan por asignar" ──
            <>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Máquinas asignadas por inspector (toca para desplegar) y las que faltan por asignar.</Text>
              <ScrollView style={{ marginTop: spacing.xs }} keyboardShouldPersistTaps="handled">
                {resumenInspectores.map((g) => {
                  const open = expanded.has(g.id);
                  return (
                    <View key={g.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, marginBottom: spacing.xs, overflow: 'hidden' }}>
                      <TouchableOpacity onPress={() => toggleExp(g.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md }}>
                        <Text style={{ fontSize: 18 }}>👮</Text>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '800' }}>{g.name}</Text>
                          <Text style={{ color: colors.muted, fontSize: 11 }}>☀️ {g.day.length} día · 🌙 {g.night.length} noche</Text>
                        </View>
                        <Text style={{ color: colors.primary, fontWeight: '900' }}>{open ? '▲' : '▼'}</Text>
                      </TouchableOpacity>
                      {open ? (
                        <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md }}>
                          {(['day', 'night'] as const).map((sh) => (
                            g[sh].length > 0 ? (
                              <View key={sh} style={{ marginTop: spacing.xs }}>
                                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>{sh === 'day' ? '☀️ Día' : '🌙 Noche'} ({g[sh].length})</Text>
                                {g[sh].map((m) => (
                                  <Text key={m.id} numberOfLines={1} style={{ color: colors.muted, fontSize: 12, paddingLeft: spacing.sm }}>• {m.code}{m.tipo ? ` (🏷️ ${m.tipo})` : ''} · {m.companyName}</Text>
                                ))}
                              </View>
                            ) : null
                          ))}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
                {resumenInspectores.length === 0 ? <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>Aún no hay máquinas asignadas.</Text> : null}
                {/* Faltan por asignar */}
                <View style={{ borderWidth: 1.5, borderColor: colors.warning, borderRadius: radius.md, backgroundColor: colors.surface, marginTop: spacing.sm, overflow: 'hidden' }}>
                  <TouchableOpacity onPress={() => toggleExp('pend')} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md }}>
                    <Text style={{ fontSize: 18 }}>🕓</Text>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '900' }}>Faltan por asignar</Text>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>{pendientesCount} máquina(s) sin inspector en algún turno</Text>
                    </View>
                    <Text style={{ color: colors.warning, fontWeight: '900' }}>{expanded.has('pend') ? '▲' : String(pendientesCount)}</Text>
                  </TouchableOpacity>
                  {expanded.has('pend') ? (
                    <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md }}>
                      {pendientesList.map((m) => {
                        const f = faltaEncargadoReal(m);
                        return (
                          <Text key={m.id} numberOfLines={1} style={{ color: colors.muted, fontSize: 12, paddingVertical: 1 }}>
                            • {m.code}{m.tipo ? ` (🏷️ ${m.tipo})` : ''} · {m.companyName} — {f.day && f.night ? 'falta día+noche' : f.day ? 'falta día' : 'falta noche'}
                          </Text>
                        );
                      })}
                      {pendientesList.length === 0 ? <Text style={{ color: colors.success, fontSize: 12 }}>Todo asignado 🎉</Text> : null}
                    </View>
                  ) : null}
                </View>
                <View style={{ height: spacing.xl }} />
              </ScrollView>
            </>
          ) : !checkInspector && pendOpen && pendBatchOpen ? (
            // ── ASIGNACIÓN POR LOTES: elegir a qué inspector/turno van las N máquinas
            //    marcadas con checkbox en "Pendientes por asignar". ──────────────────
            <>
              <TouchableOpacity onPress={() => setPendBatchOpen(false)} style={{ alignSelf: 'flex-start', marginBottom: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>‹ Volver a la lista</Text>
              </TouchableOpacity>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15 }}>📋 Asignar {pendSelected.size} máquina(s) por lotes</Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Elige el turno y luego el inspector — se les asigna a TODAS las seleccionadas de una vez.</Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
                {(['day', 'night'] as Shift[]).map((s) => (
                  <TouchableOpacity key={s} onPress={() => setPendBatchShift(s)} style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1.5, borderColor: pendBatchShift === s ? colors.primary : colors.border, backgroundColor: pendBatchShift === s ? colors.primary : colors.surface }}>
                    <Text style={{ color: pendBatchShift === s ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{shiftIcon(s)} {shiftLabel(s)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput value={pendBatchQuery} onChangeText={setPendBatchQuery} placeholder="🔎 Buscar inspector (nombre, rol, o cualquier dato de sus máquinas)…" placeholderTextColor={colors.muted} style={input} />
              <ScrollView style={{ marginTop: spacing.xs }} keyboardShouldPersistTaps="handled">
                {inspectors.filter((p) => matchInsp(p, pendBatchQuery)).map((p) => (
                  <TouchableOpacity key={p.id} disabled={pendBatchBusy} onPress={() => assignPendBatch({ id: p.id, name: p.name })} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: spacing.xs, opacity: pendBatchBusy ? 0.6 : 1 }}>
                    <Text style={{ fontSize: 20 }}>👮</Text>
                    <Text style={{ flex: 1, color: colors.text, fontWeight: '800' }}>{p.name}</Text>
                    <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 18 }}>›</Text>
                  </TouchableOpacity>
                ))}
                {pendBatchBusy ? <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: spacing.sm }}>Asignando…</Text> : null}
                <View style={{ height: spacing.xl }} />
              </ScrollView>
            </>
          ) : !checkInspector && pendOpen ? (
            // ── PENDIENTES POR ASIGNAR: máquinas sin inspector en día y/o noche ──
            <>
              <TouchableOpacity onPress={() => { setPendOpen(false); setPendQuery(''); setPendSelected(new Set()); }} style={{ alignSelf: 'flex-start', marginBottom: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>‹ Volver a inspectores</Text>
              </TouchableOpacity>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15 }}>🕓 Pendientes por asignar <Text style={{ color: colors.warning }}>({pendientesCount})</Text></Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
                {pendMode === 'sin_real'
                  ? 'Máquinas sin un inspector REAL: incluye las que no tienen a nadie y las que solo tiene el usuario de sistema 🤖 MAQUINAS FALTANTES (acumulan horas automáticas, pero nadie real las está inspeccionando).'
                  : 'Máquinas sin NINGÚN inspector, ni siquiera el del sistema (p. ej. quedaron sin dueño al borrar un inspector).'}
                {' '}Toca <Text style={{ fontWeight: '800', color: colors.primary }}>👮 Asignar inspector</Text> para reasignarlas de una en una, o marca varias con el check ☑ para asignarlas por lotes.
              </Text>
              {/* Filtro: estrictamente sin nadie, o ampliado a lo que solo cubre el sistema
                  (MAQUINAS FALTANTES) — este último reproduce el reporte externo de "pendientes". */}
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.xs }}>
                {([['Sin encargado real', 'sin_real'], ['Sin nadie (estricto)', 'sin_nadie']] as const).map(([lbl, v]) => {
                  const on = pendMode === v;
                  return (
                    <TouchableOpacity key={v} onPress={() => setPendMode(v)} style={{ flex: 1, alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface }}>
                      <Text numberOfLines={1} style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{lbl}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs }}>
                <TouchableOpacity
                  onPress={() => setPendSelected((prev) => (prev.size === pendientesList.length ? new Set() : new Set(pendientesList.map((m) => m.id))))}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}
                >
                  <Text style={{ fontSize: 14 }}>{pendSelected.size > 0 && pendSelected.size === pendientesList.length ? '☑' : '☐'}</Text>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Seleccionar todas</Text>
                </TouchableOpacity>
                {pendSelected.size > 0 ? (
                  <TouchableOpacity onPress={() => setPendBatchOpen(true)} style={{ flex: 1, alignItems: 'center', backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 6 }}>
                    <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 12 }}>📋 Asignar {pendSelected.size} seleccionada(s)…</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <TextInput value={pendQuery} onChangeText={setPendQuery} placeholder="🔎 Buscar: nombre, serial, placa, empresa, encargado…" placeholderTextColor={colors.muted} style={input} />
              <ScrollView style={{ marginTop: spacing.xs }} keyboardShouldPersistTaps="handled">
                {pendientesList.slice(0, 200).map((m) => {
                  const f = faltaEncargadoReal(m);
                  const slots = assignMap[m.id] || {};
                  const edif = edificioDe(m);
                  const checked = pendSelected.has(m.id);
                  // Etiqueta por turno: sin nadie (rojo/warning) vs cubierta solo por el
                  // sistema 🤖 (naranja/primary, distinto de "ya tiene encargado real").
                  const turnoLabel = (sh: 'day' | 'night', falta: boolean) => {
                    const icon = sh === 'day' ? '☀️' : '🌙';
                    const slot = sh === 'day' ? slots.day : slots.night;
                    if (!slot?.id) return { text: `${icon} falta ${sh === 'day' ? 'día' : 'noche'}`, color: colors.warning };
                    if (esVirtual(slot.id)) return { text: `${icon} 🤖 sin encargado real`, color: colors.primary };
                    return { text: `${icon} ${slot.name}`, color: colors.success };
                  };
                  const dl = turnoLabel('day', f.day);
                  const nl = turnoLabel('night', f.night);
                  return (
                    <View key={m.id} style={{ padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.surface, marginBottom: spacing.xs, flexDirection: 'row', gap: spacing.sm }}>
                      <TouchableOpacity
                        onPress={() => setPendSelected((prev) => { const n = new Set(prev); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })}
                        style={{ paddingTop: 2 }}
                      >
                        <Text style={{ fontSize: 18 }}>{checked ? '☑' : '☐'}</Text>
                      </TouchableOpacity>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '800' }}>🕓 {m.code}</Text>
                        <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>{(m.tipo || 'Sin tipo')} · {m.companyName} · {((m as any).plate || (m as any).serial || '—')}</Text>
                        <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11 }}>📍 {edif || 'Sin edificio/referencia'}</Text>
                        {m.encargado ? <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs }}>👤 Encargado: {m.encargado}</Text> : <View style={{ marginBottom: spacing.xs }} />}
                        <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs, flexWrap: 'wrap' }}>
                          <Text style={{ fontSize: 11, fontWeight: '800', color: dl.color }}>{dl.text}</Text>
                          <Text style={{ fontSize: 11, fontWeight: '800', color: nl.color }}>{nl.text}</Text>
                        </View>
                        <TouchableOpacity onPress={() => { setAssignFor(m); setPickShift(f.day ? 'day' : 'night'); setAssignForQuery(''); }} style={{ alignSelf: 'flex-start', borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                          <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 13 }}>👮 Asignar inspector</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
                {pendientesList.length === 0 ? <EmptyState title="Nada pendiente 🎉" subtitle="Todas las máquinas tienen inspector de día y de noche." /> : null}
                <View style={{ height: spacing.xl }} />
              </ScrollView>
            </>
          ) : !checkInspector ? (
            // ── PASO 1: elegir a qué inspector se le asignarán máquinas ──────────
            <>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Selecciona el inspector al que le vas a asignar máquinas.</Text>
              {/* Acceso directo a las máquinas que quedaron sin inspector. */}
              <TouchableOpacity onPress={() => { setPendOpen(true); setPendQuery(''); }} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.warning, backgroundColor: colors.surface, marginBottom: spacing.sm }}>
                <Text style={{ fontSize: 20 }}>🕓</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '900' }}>Pendientes por asignar</Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>{pendientesCount > 0 ? `${pendientesCount} máquina(s) sin inspector en algún turno` : 'Todo asignado'}</Text>
                </View>
                <Text style={{ color: colors.warning, fontWeight: '900', fontSize: 16 }}>{pendientesCount > 0 ? pendientesCount : '✓'}</Text>
              </TouchableOpacity>
              <TextInput value={inspQuery} onChangeText={setInspQuery} placeholder="🔎 Buscar inspector (nombre, rol, o cualquier dato de sus máquinas)…" placeholderTextColor={colors.muted} style={input} />
              <ScrollView style={{ marginTop: spacing.xs }} keyboardShouldPersistTaps="handled">
                {inspectors.filter((p) => matchInsp(p, inspQuery)).map((p) => {
                  const count = Object.values(assignMap).filter((s) => s.day?.id === p.id || s.night?.id === p.id).length;
                  return (
                    <TouchableOpacity key={p.id} onPress={() => { setCheckInspector({ id: p.id, name: p.name }); setCheckQuery(''); setCheckFilter('mine'); }} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: spacing.xs }}>
                      <Text style={{ fontSize: 20 }}>👮</Text>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '800' }}>{p.name}</Text>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>{p.role || 'inspector'}{count > 0 ? ` · ${count} máquina(s)` : ''}</Text>
                      </View>
                      <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 18 }}>›</Text>
                    </TouchableOpacity>
                  );
                })}
                {inspectors.length === 0 ? <EmptyState title="Sin inspectores" subtitle="No hay usuarios (no-admin) para asignar." /> : null}
                <View style={{ height: spacing.xl }} />
              </ScrollView>
            </>
          ) : (
            // ── PASO 2: asignar máquinas al inspector — con SELECCIÓN MÚLTIPLE (lote) ──
            (() => {
              const filtered = checkList.filter((m) => {
                if (checkFilter === 'pending') { const f = faltaTurno(m); return f.day || f.night; }
                if (checkFilter === 'mine') { const s = assignMap[m.id] || {}; return s.day?.id === checkInspector.id || s.night?.id === checkInspector.id; }
                return true; // 'all'
              });
              const shown = filtered.slice(0, 300);
              const allSel = shown.length > 0 && shown.every((m) => selIds.has(m.id));
              return (
                <>
                  <TouchableOpacity onPress={() => { setCheckInspector(null); setInspQuery(''); setSelIds(new Set()); setCheckFilter('mine'); }} style={{ alignSelf: 'flex-start', marginBottom: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                    <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>‹ Cambiar inspector</Text>
                  </TouchableOpacity>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
                    Marca varias con ☑️ y asígnalas por LOTE a <Text style={{ fontWeight: '800', color: colors.text }}>{checkInspector.name}</Text>, o toca ☀️/🌙 en una para asignar/quitar directo. Reasignar es directo (si la tiene otro, se la pasas al elegido).
                  </Text>
                  {/* Filtro Suyas / Todas / Solo pendientes */}
                  <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.xs }}>
                    {([['👤 Suyas', 'mine'], ['Todas', 'all'], ['Pendientes', 'pending']] as const).map(([lbl, v]) => {
                      const on = checkFilter === v;
                      return (
                        <TouchableOpacity key={lbl} onPress={() => setCheckFilter(v)} style={{ flex: 1, alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface }}>
                          <Text numberOfLines={1} style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{lbl}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <TextInput value={checkQuery} onChangeText={setCheckQuery} placeholder="🔎 Buscar: nombre, serial, placa, empresa, encargado…" placeholderTextColor={colors.muted} style={input} />
                  {/* Seleccionar todas (las filtradas) + contador */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs }}>
                    <TouchableOpacity onPress={() => setSelIds(allSel ? new Set() : new Set(shown.map((m) => m.id)))} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={{ width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: allSel ? colors.primary : colors.border, backgroundColor: allSel ? colors.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                        {allSel ? <Text style={{ color: colors.primaryContrast, fontWeight: '900', fontSize: 12 }}>✓</Text> : null}
                      </View>
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Seleccionar todas ({shown.length})</Text>
                    </TouchableOpacity>
                    {selIds.size > 0 ? <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12 }}>{selIds.size} seleccionada(s)</Text> : null}
                  </View>
                  {/* Barra de acciones por LOTE (solo con selección) */}
                  {selIds.size > 0 ? (
                    <>
                      <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>Asignar a <Text style={{ fontWeight: '800', color: colors.text }}>{checkInspector.name}</Text>:</Text>
                      <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4, flexWrap: 'wrap' }}>
                        {([['☀️ Día', 'day'], ['🌙 Noche', 'night'], ['☀️🌙 Ambos', 'both'], ['✖ Quitar', 'remove']] as const).map(([lbl, mode]) => (
                          <TouchableOpacity key={mode} disabled={batchBusy} onPress={() => assignBatch(mode)} style={{ flexGrow: 1, alignItems: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1.5, borderColor: mode === 'remove' ? colors.danger : colors.primary, backgroundColor: mode === 'remove' ? colors.surface : colors.primary, opacity: batchBusy ? 0.6 : 1 }}>
                            <Text style={{ color: mode === 'remove' ? colors.danger : colors.primaryContrast, fontWeight: '800', fontSize: 12 }}>{batchBusy ? '⏳' : lbl}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      {/* Mover el lote a OTRO inspector (destino elegido en línea → Día/Noche/Ambos). */}
                      <TouchableOpacity onPress={() => { setReassign({ ids: Array.from(selIds) }); setReassignTo(null); setReassignQuery(''); }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: spacing.xs, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.accent, backgroundColor: colors.accentSoftBg }}>
                        <Text style={{ color: colors.accentSoftText, fontWeight: '900', fontSize: 12 }}>↪ Reasignar {selIds.size} a otro inspector…</Text>
                      </TouchableOpacity>
                    </>
                  ) : null}
                  <ScrollView style={{ marginTop: spacing.xs }} keyboardShouldPersistTaps="handled">
                    {shown.map((m) => {
                      const slots = assignMap[m.id] || {};
                      const on = slots.day?.id === checkInspector.id || slots.night?.id === checkInspector.id;
                      const sel = selIds.has(m.id);
                      const edif = edificioDe(m);
                      const shiftBtn = (shift: Shift) => {
                        const slot = slots[shift];
                        const mineHere = slot?.id === checkInspector.id;
                        const taken = !!slot && !mineHere;
                        const busy = assignBusy === m.id + shift;
                        return (
                          <TouchableOpacity
                            key={shift}
                            onPress={() => assignShift(m, shift)}
                            disabled={busy}
                            style={{ flex: 1, borderRadius: radius.md, borderWidth: 1.5, borderStyle: slot ? 'solid' : 'dashed', borderColor: mineHere ? colors.success : taken ? colors.warning : colors.border, backgroundColor: mineHere ? colors.successSoftBg : colors.surface, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, alignItems: 'center', opacity: busy ? 0.6 : 1 }}
                          >
                            <Text style={{ fontSize: 13, fontWeight: '800', color: mineHere ? colors.successSoftText : colors.text }}>
                              {busy ? '⏳ ' : ''}{shiftIcon(shift)} {shiftLabel(shift)}
                            </Text>
                            <Text numberOfLines={1} style={{ fontSize: 11, color: mineHere ? colors.success : taken ? colors.primary : colors.muted, fontWeight: '700' }}>
                              {mineHere ? '✓ Asignada (quitar)' : taken ? `↪ Reasignar (ahora: ${slot!.name})` : '＋ Asignar'}
                            </Text>
                          </TouchableOpacity>
                        );
                      };
                      return (
                        <View key={m.id} style={{ padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: sel ? colors.primary : on ? colors.success : colors.border, backgroundColor: sel ? colors.surfaceAlt : on ? colors.successSoftBg : colors.surface, marginBottom: spacing.xs }}>
                          <TouchableOpacity onPress={() => toggleSel(m.id)} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
                            <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary : 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                              {sel ? <Text style={{ color: colors.primaryContrast, fontWeight: '900', fontSize: 13 }}>✓</Text> : null}
                            </View>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '800' }}>{on ? '✅ ' : ''}{m.code}</Text>
                              <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>{(m.tipo || 'Sin tipo')} · {m.companyName} · {((m as any).plate || (m as any).serial || '—')}</Text>
                              <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11 }}>📍 {edif || 'Sin edificio/referencia'}</Text>
                              {m.encargado ? <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11 }}>👤 Encargado: {m.encargado}</Text> : null}
                            </View>
                          </TouchableOpacity>
                          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
                            {shiftBtn('day')}
                            {shiftBtn('night')}
                          </View>
                          {/* Reasignar ESTA máquina a otro inspector (destino en línea → Día/Noche/Ambos). */}
                          <TouchableOpacity onPress={() => { setReassign({ ids: [m.id] }); setReassignTo(null); setReassignQuery(''); }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: spacing.xs, paddingVertical: 6, borderRadius: radius.md, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accentSoftBg }}>
                            <Text style={{ color: colors.accentSoftText, fontWeight: '800', fontSize: 11 }}>↪ Reasignar a otro inspector…</Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                    {filtered.length === 0 ? (
                      <EmptyState
                        title="Sin resultados"
                        subtitle={checkFilter === 'mine' ? `${checkInspector.name} no tiene máquinas asignadas todavía. Toca "Todas" para buscar y asignarle.` : 'Prueba con otro nombre o quita el filtro.'}
                      />
                    ) : null}
                    <View style={{ height: spacing.xl }} />
                  </ScrollView>
                </>
              );
            })()
          )}
        </Screen>
      </Modal>

      {/* 👮 ASIGNAR/REASIGNAR INSPECTOR desde una máquina (SOLO ADMIN). Se elige el
          inspector de Día y de Noche; reasignar es directo. Sincroniza en vivo. */}
      <Modal visible={!!assignFor} animationType="slide" onRequestClose={() => { setAssignFor(null); setPickShift(null); }}>
        <Screen>
          {assignFor ? (() => {
            const af = assignFor;
            return (
              <>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18 }}>👮 Asignar inspector</Text>
                    <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>{af.code}{af.tipo ? ` · 🏷️ ${af.tipo}` : ''} · {af.companyName}</Text>
                  </View>
                  <TouchableOpacity onPress={() => { setAssignFor(null); setPickShift(null); }} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Listo</Text>
                  </TouchableOpacity>
                </View>
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
                  Elige el inspector de <Text style={{ fontWeight: '800', color: colors.text }}>☀️ Día</Text> y <Text style={{ fontWeight: '800', color: colors.text }}>🌙 Noche</Text>. Reasignar es directo (no hace falta quitar antes).
                </Text>
                <ScrollView keyboardShouldPersistTaps="handled">
                  {(['day', 'night'] as Shift[]).map((sh) => {
                    const cur = assignMap[af.id]?.[sh];
                    const busy = assignBusy === af.id + sh;
                    return (
                      <View key={sh} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, backgroundColor: colors.surface }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={{ color: colors.text, fontWeight: '800' }}>{shiftIcon(sh)} {shiftLabel(sh)}</Text>
                            <Text numberOfLines={1} style={{ color: cur ? colors.primary : colors.muted, fontWeight: '700', fontSize: 13, marginTop: 2 }}>
                              {busy ? '⏳ Guardando…' : cur ? cur.name : 'Sin asignar'}
                            </Text>
                          </View>
                          <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                            <TouchableOpacity onPress={() => { setPickShift(pickShift === sh ? null : sh); setAssignForQuery(''); }} disabled={busy} style={{ borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, opacity: busy ? 0.6 : 1 }}>
                              <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 13 }}>{cur ? '↪ Cambiar' : '＋ Asignar'}</Text>
                            </TouchableOpacity>
                            {cur ? (
                              <TouchableOpacity onPress={() => setInspectorFor(af, sh, null)} disabled={busy} style={{ borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, opacity: busy ? 0.6 : 1 }}>
                                <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 13 }}>Quitar</Text>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        </View>
                        {pickShift === sh ? (
                          <View style={{ marginTop: spacing.sm }}>
                            <TextInput value={assignForQuery} onChangeText={setAssignForQuery} placeholder="🔎 Buscar inspector (nombre, rol, o cualquier dato de sus máquinas)…" placeholderTextColor={colors.muted} style={input} />
                            <ScrollView style={{ maxHeight: 240, marginTop: spacing.xs }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                              {inspectors.filter((p) => matchInsp(p, assignForQuery)).map((p) => (
                                <TouchableOpacity key={p.id} onPress={() => setInspectorFor(af, sh, { id: p.id, name: p.name })} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: cur?.id === p.id ? colors.success : colors.border, backgroundColor: cur?.id === p.id ? colors.successSoftBg : colors.surface, marginBottom: spacing.xs }}>
                                  <Text style={{ fontSize: 18 }}>👮</Text>
                                  <Text numberOfLines={1} style={{ flex: 1, color: colors.text, fontWeight: '800' }}>{p.name}</Text>
                                  {cur?.id === p.id ? <Text style={{ color: colors.success, fontWeight: '800', fontSize: 12 }}>✓ actual</Text> : null}
                                </TouchableOpacity>
                              ))}
                              {inspectors.length === 0 ? <EmptyState title="Sin inspectores" subtitle="No hay inspectores/coordinadores para asignar." /> : null}
                            </ScrollView>
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                  {notice ? <Text style={{ color: notice.startsWith('❌') ? colors.danger : colors.success, fontWeight: '700', marginBottom: spacing.sm }}>{notice}</Text> : null}
                  <View style={{ height: spacing.xl }} />
                </ScrollView>
              </>
            );
          })() : null}
        </Screen>
      </Modal>

      {/* ↪ REASIGNAR a OTRO inspector (lote o individual): se elige el inspector destino
          en línea y luego el turno (Día / Noche / Ambos). Mueve la asignación directo. */}
      <Modal visible={!!reassign} transparent animationType="fade" onRequestClose={() => { setReassign(null); setReassignTo(null); }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, maxHeight: '85%', overflow: 'hidden' }}>
            <View style={{ padding: spacing.lg, paddingBottom: spacing.sm, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18 }}>↪ Reasignar a otro inspector</Text>
                <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{reassign ? `${reassign.ids.length} máquina(s)` : ''}{reassignTo ? ` → ${reassignTo.name}` : ''}</Text>
              </View>
              <TouchableOpacity onPress={() => { setReassign(null); setReassignTo(null); }} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Cerrar</Text>
              </TouchableOpacity>
            </View>
            {!reassignTo ? (
              // ── PASO A: elegir el inspector DESTINO ──────────────────────────────
              <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}>
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Elige el inspector destino:</Text>
                <TextInput value={reassignQuery} onChangeText={setReassignQuery} placeholder="🔎 Buscar inspector (nombre, rol, o cualquier dato de sus máquinas)…" placeholderTextColor={colors.muted} style={input} />
                <ScrollView style={{ maxHeight: 320, marginTop: spacing.xs }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                  {inspectors.filter((p) => matchInsp(p, reassignQuery)).map((p) => (
                    <TouchableOpacity key={p.id} onPress={() => setReassignTo({ id: p.id, name: p.name })} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: spacing.xs }}>
                      <Text style={{ fontSize: 18 }}>👮</Text>
                      <Text numberOfLines={1} style={{ flex: 1, color: colors.text, fontWeight: '800' }}>{p.name}</Text>
                      <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 18 }}>›</Text>
                    </TouchableOpacity>
                  ))}
                  {inspectors.length === 0 ? <EmptyState title="Sin inspectores" subtitle="No hay inspectores/coordinadores para asignar." /> : null}
                </ScrollView>
              </View>
            ) : (
              // ── PASO B: elegir el TURNO a mover (Día / Noche / Ambos) ────────────
              <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}>
                <TouchableOpacity onPress={() => { setReassignTo(null); setReassignQuery(''); }} style={{ alignSelf: 'flex-start', marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                  <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>‹ Cambiar inspector</Text>
                </TouchableOpacity>
                <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.sm }}>
                  Mover {reassign?.ids.length} máquina(s) a <Text style={{ fontWeight: '900', color: colors.text }}>{reassignTo.name}</Text>. ¿En qué turno?
                </Text>
                <View style={{ gap: spacing.xs }}>
                  {([['☀️ Día', 'day'], ['🌙 Noche', 'night'], ['☀️🌙 Ambos (día y noche)', 'both']] as const).map(([lbl, mode]) => (
                    <TouchableOpacity key={mode} disabled={reassignBusy} onPress={() => doReassign(mode)} style={{ alignItems: 'center', paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.accent, backgroundColor: colors.accent, opacity: reassignBusy ? 0.6 : 1 }}>
                      <Text style={{ color: colors.accentContrast, fontWeight: '900', fontSize: 14 }}>{reassignBusy ? '⏳ Moviendo…' : lbl}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm }}>Reasignar es directo: si otra persona la tenía en ese turno, se la pasas al destino.</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Surtir gasoil a la máquina del check-in */}
      <SurtidoGasoilModal machineId={gasoilId} onClose={() => setGasoilId(null)} authorName={fullName} authorId={uid || null} />

      {/* Modal de check-in: GPS + estado + nota. */}
      <Modal visible={!!ci} transparent animationType="fade" onRequestClose={() => setCi(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, maxHeight: '85%' }}>
            <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18 }}>✅ Revisé la máquina</Text>
              {ci ? (
                <View style={{ marginBottom: spacing.sm }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{ci.code}</Text>
                  {ci.tipo ? <Text style={{ color: colors.muted, fontSize: 12 }}>🏷️ Marca - Modelo: {ci.tipo}</Text> : null}
                  <Text style={{ color: colors.muted, fontSize: 12 }}>🏢 {ci.companyName}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>🔖 Serial/Placa: {((ci as any).plate || (ci as any).serial || '—')}</Text>
                  {(ci as any).encargado ? <Text style={{ color: colors.muted, fontSize: 12 }}>👤 Encargado: {(ci as any).encargado}</Text> : null}
                  {/* Inspector(es) asignado(s) día/noche: antes solo se mostraba dentro del
                      aviso "Máquina de otro inspector", que NUNCA aparece para el coordinador
                      (puedeCoordinar siempre puede operar cualquier máquina) — así, al escanear,
                      el coordinador veía la máquina pero no de qué inspector era. Ahora se
                      muestra siempre que haya alguien asignado, sin importar el rol. */}
                  {duenoTxt ? <Text style={{ color: colors.muted, fontSize: 12 }}>🪖 Inspector asignado: {duenoTxt}</Text> : null}
                </View>
              ) : null}

              {/* GPS / cercanía */}
              <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm, borderLeftWidth: 3, borderLeftColor: gpsBusy ? colors.border : near === true ? colors.success : near === false ? colors.warning : colors.border }}>
                {gpsBusy ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <ActivityIndicator color={colors.primary} /><Text style={{ color: colors.muted, fontSize: 12 }}>Obteniendo tu ubicación…</Text>
                  </View>
                ) : gps ? (
                  ci && ci.latitude != null && ci.longitude != null ? (
                    <Text style={{ color: near ? colors.success : colors.warning, fontWeight: '800', fontSize: 13 }}>
                      {near ? `📍 En sitio ✓ · a ~${dist} m de la máquina` : `📍 Estás a ~${dist} m (lejos ⚠️)`}
                    </Text>
                  ) : (
                    <Text style={{ color: colors.muted, fontSize: 12 }}>📍 Ubicación tomada. La máquina aún no tiene ubicación guardada para comparar.</Text>
                  )
                ) : (
                  <Text style={{ color: colors.danger, fontSize: 12 }}>⚠️ {gpsErr ?? 'Sin ubicación.'}</Text>
                )}
                <TouchableOpacity onPress={recapture} disabled={gpsBusy} style={{ marginTop: 6 }}>
                  <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>↻ Volver a tomar ubicación</Text>
                </TouchableOpacity>
                {/* Edificio del catálogo COMPARTIDO (public.edificios): desplegable con
                    buscar + ➕ agregar si no existe. Se guarda con la ubicación y sale
                    en el reporte "Máquinas por sector" del Mapa. Campo único EDIFICIO. */}
                <EdificioPicker value={ciRef} onChange={setCiRef} />
                {/* Guardar TU posición como la ubicación de la máquina (queda en el mapa) + el edificio. */}
                <TouchableOpacity onPress={guardarUbicacionMaquina} disabled={savingMachLoc || gpsBusy} style={{ marginTop: spacing.sm, backgroundColor: '#2563EB', borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: (savingMachLoc || gpsBusy) ? 0.6 : 1 }}>
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>
                    {savingMachLoc ? 'Guardando…' : (ci && ci.latitude != null ? '📍 Actualizar ubicación + referencia' : '📍 Guardar ubicación + referencia')}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* ── Jornada de la máquina: INICIAR → FINALIZAR (cuenta las horas) ── */}
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Jornada de la máquina</Text>
              {maquinaDeOtro ? (
                <View style={{ backgroundColor: colors.dangerSoftBg, borderWidth: 1, borderColor: colors.dangerSoftBorder, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
                  <Text style={{ color: colors.dangerSoftText, fontWeight: '800', fontSize: 13 }}>🔒 Máquina de otro inspector</Text>
                  <Text style={{ color: colors.dangerSoftText, fontSize: 12, marginTop: 2 }}>No puedes iniciar su jornada.{duenoTxt ? ` Asignada a: ${duenoTxt}.` : ''}</Text>
                </View>
              ) : ci && !jornadaStart && segmentoConTurno(ci.id, fixedShift ?? iniShift) === 'parada' ? (
                // Máquina PARADA sin jornada abierta: no se puede iniciar jornada estando
                // parada — primero hay que volver a ponerla OPERATIVA (botón de abajo).
                // POR TURNO (día indep. de noche): una parada marcada de DÍA NO bloquea al
                // inspector de NOCHE (antes usaba paradaIds, sin turno → el status de día
                // le tapaba al de noche y no podía iniciar). Ahora usa el MISMO clasificador
                // por-turno que la pantalla (segmentoConTurno) para el turno que va a iniciar.
                <View style={{ backgroundColor: colors.warningSoftBg, borderWidth: 1, borderColor: colors.warningSoftBorder, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
                  <Text style={{ color: colors.warningSoftText, fontWeight: '800', fontSize: 13 }}>🟡 Máquina parada</Text>
                  <Text style={{ color: colors.warningSoftText, fontSize: 12, marginTop: 2 }}>No puedes iniciar jornada mientras esté parada. Vuélvela a OPERATIVA primero (abajo).</Text>
                </View>
              ) : jornadaStart ? (
                <View style={{ marginBottom: spacing.sm }}>
                  <View style={{ backgroundColor: colors.successSoftBg, borderWidth: 1, borderColor: colors.successSoftBorder, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.xs }}>
                    <Text style={{ color: colors.successSoftText, fontWeight: '800', fontSize: 12 }}>
                      🟢 Jornada en curso ({jornadaShift === 'night' ? '🌙 noche' : '☀️ día'}) · desde {caracasClock(jornadaStart)}
                    </Text>
                    <Text style={{ color: colors.successSoftText, fontSize: 12, marginTop: 2 }}>⏱️ Tiempo trabajado: {elapsedLabel(jornadaStart, nowTick)}</Text>
                  </View>
                  {finConfirm ? (
                    <View style={{ backgroundColor: colors.infoSoftBg, borderWidth: 1, borderColor: colors.infoSoftBorder, borderRadius: radius.md, padding: spacing.sm }}>
                      <Text style={{ color: colors.infoSoftText, fontWeight: '800', fontSize: 13, textAlign: 'center' }}>¿Finalizar la jornada?</Text>
                      <Text style={{ color: colors.infoSoftText, fontSize: 13, marginTop: 4, textAlign: 'center' }}>
                        Total trabajado: <Text style={{ fontWeight: '900' }}>{elapsedLabel(jornadaStart, nowTick)}</Text>
                        {'  '}({((Math.max(0, nowTick - new Date(jornadaStart).getTime())) / 3600000).toFixed(2)} h)
                      </Text>
                      {/* TAREA 2: refuerza el total con el ACUMULADO del turno en el día
                          (curRoundHours = horas ya registradas ANTES de esta sesión). */}
                      <Text style={{ color: colors.infoSoftText, fontSize: 12, marginTop: 2, textAlign: 'center' }}>
                        Acumulado del turno: <Text style={{ fontWeight: '900' }}>{(curRoundHours[jornadaShift] + (Math.max(0, nowTick - new Date(jornadaStart).getTime()) / 3600000)).toFixed(2)} h</Text>
                      </Text>
                      <Text style={{ color: colors.infoSoftText, fontSize: 11, marginTop: 2, marginBottom: spacing.sm, textAlign: 'center' }}>
                        Se sumarán al turno de {jornadaShift === 'night' ? 'noche 🌙' : 'día ☀️'} en Control de maquinaria.
                      </Text>
                      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Ingresar horómetro{horoIni ? ` · inicial: ${horoIni}` : ''}</Text>
                      <TextInput value={horoFin} onChangeText={(t) => setHoroFin(t.replace(/[^0-9.,]/g, ''))} keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted} style={[input, { marginBottom: spacing.sm }]} />
                      <TouchableOpacity onPress={() => tomarFotoHoro('fin')} disabled={horoPhotoBusy === 'fin'} style={{ marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: horoFinPhoto ? colors.success : colors.border, backgroundColor: colors.surface }}>
                        <Text style={{ color: horoFinPhoto ? colors.success : colors.text, fontWeight: '700' }}>{horoPhotoBusy === 'fin' ? 'Subiendo…' : horoFinPhoto ? '✓ Foto del horómetro adjunta' : '📷 Foto del horómetro'}</Text>
                      </TouchableOpacity>
                      <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Será el inicial de la próxima jornada. Las horas de mantenimiento se cuentan final − inicial (no afecta el pago).</Text>
                      {(() => {
                        const hf = Number((horoFin || '').replace(',', '.'));
                        const hi = Number((horoIni || '').replace(',', '.'));
                        if (isFinite(hf) && isFinite(hi) && hf >= hi && horoFin) {
                          return <Text style={{ color: colors.infoSoftText, fontSize: 12, marginBottom: spacing.sm, textAlign: 'center' }}>⚙️ Por horómetro: <Text style={{ fontWeight: '900' }}>{Math.round((hf - hi) * 100) / 100} h</Text> (final − inicial)</Text>;
                        }
                        return <View style={{ marginBottom: spacing.sm }} />;
                      })()}
                      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                        <TouchableOpacity onPress={() => setFinConfirm(false)} disabled={jornadaBusy} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', backgroundColor: colors.surface }}>
                          <Text style={{ color: colors.text, fontWeight: '800' }}>Cancelar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={finalizarJornada} disabled={jornadaBusy} style={{ flex: 1, backgroundColor: '#2563EB', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: jornadaBusy ? 0.6 : 1 }}>
                          <Text style={{ color: '#fff', fontWeight: '800' }}>{jornadaBusy ? 'Guardando…' : 'Sí, finalizar'}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <TouchableOpacity onPress={() => setFinConfirm(true)} disabled={jornadaBusy} style={{ backgroundColor: '#2563EB', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: jornadaBusy ? 0.6 : 1 }}>
                      <Text style={{ color: '#fff', fontWeight: '800' }}>🏁 FINALIZAR JORNADA</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : shiftClosed ? (
                // El turno del inspector YA CERRÓ hoy (por hora): no puede iniciar/reiniciar
                // hasta mañana. (Antes de cerrar SÍ puede reiniciar para acumular horas.)
                <View style={{ backgroundColor: colors.infoSoftBg, borderWidth: 1, borderColor: colors.infoSoftBorder, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
                  <Text style={{ color: colors.infoSoftText, fontWeight: '800', fontSize: 13 }}>✅ La jornada de {shiftFromKey(myShift as any).label} de hoy ya cerró.</Text>
                  <Text style={{ color: colors.infoSoftText, fontSize: 12, marginTop: 2 }}>Podrás iniciar otra jornada de {shiftFromKey(myShift as any).label} mañana.</Text>
                </View>
              ) : (
                <View style={{ marginBottom: spacing.sm }}>
                  {/* Turno de la jornada. Si el inspector tiene turno ASIGNADO (día/noche),
                      se FIJA a su turno (no puede elegir el otro); si no está asignado, elige. */}
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Turno de la jornada</Text>
                  {fixedShift ? (
                    <View style={{ marginBottom: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>{fixedShift === 'night' ? '🌙 Noche' : '☀️ Día'} · tu turno</Text>
                      <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>Solo puedes iniciar jornada de tu turno (un inspector de día no inicia jornadas de noche).</Text>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
                      {(['day', 'night'] as const).map((s) => {
                        const on = iniShift === s;
                        return (
                          <TouchableOpacity key={s} onPress={() => { setIniShift(s); setIniTime(nowHHMM()); }} style={{ flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 2, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surface }}>
                            <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{s === 'day' ? '☀️ Día' : '🌙 Noche'}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Hora de inicio (HH:MM) · se acota contra la hora del sistema</Text>
                  <TextInput value={iniTime} onChangeText={(t) => setIniTime(t.replace(/[^0-9:]/g, '').slice(0, 5))} placeholder={iniShift === 'night' ? '19:00' : '07:00'} placeholderTextColor={colors.muted} keyboardType="numbers-and-punctuation" style={[input, { marginBottom: 4 }]} />
                  <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.sm }}>Máximo para declarar sin alerta: {iniShift === 'night' ? '9:30pm' : '9:30am'}. Si se declara tarde se avisa a los administradores.</Text>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Ingresar horómetro{horoIni ? '' : ' (se precarga con el final de la jornada anterior)'}</Text>
                  <TextInput value={horoIni} onChangeText={(t) => setHoroIni(t.replace(/[^0-9.,]/g, ''))} keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted} style={[input, { marginBottom: spacing.sm }]} />
                  <TouchableOpacity onPress={() => tomarFotoHoro('ini')} disabled={horoPhotoBusy === 'ini'} style={{ marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: horoIniPhoto ? colors.success : colors.border, backgroundColor: colors.surface }}>
                    <Text style={{ color: horoIniPhoto ? colors.success : colors.text, fontWeight: '700' }}>{horoPhotoBusy === 'ini' ? 'Subiendo…' : horoIniPhoto ? '✓ Foto del horómetro adjunta' : '📷 Foto del horómetro'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={iniciarJornada} disabled={jornadaBusy} style={{ backgroundColor: '#1E9E4A', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: jornadaBusy ? 0.6 : 1 }}>
                    <Text style={{ color: '#fff', fontWeight: '800' }}>{jornadaBusy ? 'Guardando…' : '🟢 INICIAR JORNADA'}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Si la máquina está PARADA EN ESTE TURNO, permite volver a ponerla OPERATIVA.
                  POR TURNO (día indep. de noche): una parada de DÍA NO le sale al inspector
                  de NOCHE (antes usaba paradaIds sin turno → el de noche veía la parada del
                  día y no podía ni iniciar ni "volver operativa" lo suyo). Mismo clasificador
                  por-turno que la pantalla, para el turno que va a iniciar. */}
              {ci && segmentoConTurno(ci.id, fixedShift ?? iniShift) === 'parada' ? (
                <View style={{ backgroundColor: colors.warningSoftBg, borderWidth: 1, borderColor: colors.warningSoftBorder, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
                  <Text style={{ color: colors.warningSoftText, fontWeight: '800', fontSize: 12 }}>🟡 Esta máquina está marcada PARADA.</Text>
                  {paradaMotivoDe(ci.id) ? <Text style={{ color: colors.warningSoftText, fontSize: 12, marginTop: 2 }}>🔧 Motivo: {paradaMotivoDe(ci.id)}</Text> : null}
                  <TouchableOpacity onPress={volverOperativa} disabled={ciSaving} style={{ marginTop: spacing.xs, backgroundColor: '#1E9E4A', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: ciSaving ? 0.6 : 1 }}>
                    <Text style={{ color: '#fff', fontWeight: '800' }}>{ciSaving ? 'Guardando…' : '🟢 Volver a OPERATIVA'}</Text>
                  </TouchableOpacity>
                  <Text style={{ color: colors.warningSoftText, fontSize: 11, marginTop: 4 }}>Cierra la avería en Mantenimiento y la máquina deja de aparecer como parada en Control.</Text>
                </View>
              ) : null}

              {/* PARADA → 2 caminos: "por avería" (Mantenimiento + Inspecciones) o
                  "no trabajó" (motivo fijo + ubicación, solo Inspecciones). */}
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginBottom: 4 }}>⛔ Detener la máquina</Text>
              <TouchableOpacity onPress={() => setParadaOpen((v) => !v)} disabled={ciSaving} style={{ backgroundColor: paradaOpen ? '#D9A200' : colors.surface, borderWidth: 2, borderColor: '#D9A200', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginBottom: spacing.sm }}>
                <Text style={{ color: paradaOpen ? '#fff' : '#8A6A00', fontWeight: '800' }}>🟡 PARADA (marcar máquina parada)</Text>
              </TouchableOpacity>
              {paradaOpen ? (
                <View style={{ backgroundColor: colors.warningSoftBg, borderWidth: 1, borderColor: colors.warningSoftBorder, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
                  <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
                    {(['averia', 'no_trabajo'] as const).map((t) => {
                      const on = paradaTab === t;
                      return (
                        <TouchableOpacity key={t} onPress={() => setParadaTab(t)} style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: on ? '#8A6A00' : colors.warningSoftBorder, backgroundColor: on ? '#8A6A00' : 'transparent' }}>
                          <Text style={{ color: on ? '#fff' : colors.warningSoftText, fontWeight: '800', fontSize: 12 }}>{t === 'averia' ? '🔧 Por avería' : '📍 Parada / No trabajó'}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  {/* TAREA 3: aclara qué hace cada pestaña (ambas dejan la máquina PARADA,
                      lo que cambia es si hay o no una falla mecánica de por medio). */}
                  <Text style={{ color: '#7A4A0B', fontSize: 11, marginBottom: spacing.sm, fontStyle: 'italic' }}>
                    {paradaTab === 'averia'
                      ? 'La máquina queda PARADA y se reporta la falla a Mantenimiento.'
                      : 'La máquina queda PARADA sin que sea una falla mecánica (clima, sin combustible, sin operador, etc.).'}
                  </Text>

                  {paradaTab === 'averia' ? (
                    <>
                      <Text style={{ color: '#7A4A0B', fontWeight: '800', fontSize: 12, marginBottom: 4 }}>¿Qué material necesita?</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
                        {PARADA_AV_MATERIALS.map((mt) => {
                          const on = paMaterial === mt.key;
                          return (
                            <TouchableOpacity key={mt.key} onPress={() => setPaMaterial(mt.key)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: on ? '#8A6A00' : colors.surface, borderWidth: 1, borderColor: on ? '#8A6A00' : colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                              <Text>{mt.icon}</Text>
                              <Text style={{ color: on ? '#fff' : colors.text, fontWeight: '700', fontSize: 12 }}>{mt.label}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      <Text style={{ color: '#7A4A0B', fontWeight: '800', fontSize: 12, marginBottom: 4 }}>Texto de la falla (obligatorio)</Text>
                      <TextInput value={ciMotivo} onChangeText={setCiMotivo} placeholder="Ej: falla hidráulica, sin arranque, cauchos…" placeholderTextColor={colors.muted} style={input} />
                      {paMaterial && paMaterial !== 'otro' ? (
                        <>
                          <Text style={{ color: '#7A4A0B', fontSize: 12, marginTop: spacing.xs }}>Cantidad (opcional)</Text>
                          <TextInput value={paQty} onChangeText={(t) => setPaQty(t.replace(/[^0-9.,]/g, ''))} keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted} style={input} />
                        </>
                      ) : null}
                      {paMaterial ? (
                        <TouchableOpacity onPress={subirFotoParadaAveria} disabled={paPhotoUp} style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: paPhoto ? colors.success : colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
                          <Text style={{ color: paPhoto ? colors.success : '#7A4A0B', fontWeight: '700', fontSize: 12 }}>{paPhotoUp ? 'Subiendo…' : paPhoto ? '✓ Foto de referencia adjunta' : '📷 Foto de referencia (opcional)'}</Text>
                        </TouchableOpacity>
                      ) : null}
                      <Text style={{ color: '#7A4A0B', fontSize: 11, marginTop: 4 }}>Crea la solicitud en Mantenimiento con el material y sigue marcándose PARADA en Inspecciones (Control saldrá “MÁQUINA PARADA”).</Text>
                      <TouchableOpacity onPress={marcarParadaAveria} disabled={ciSaving || !paMaterial || !ciMotivo.trim()} style={{ marginTop: spacing.sm, backgroundColor: '#D9A200', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: (ciSaving || !paMaterial || !ciMotivo.trim()) ? 0.6 : 1 }}>
                        <Text style={{ color: '#fff', fontWeight: '800' }}>{ciSaving ? 'Guardando…' : '🟡 Confirmar PARADA + avería'}</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      <Text style={{ color: '#7A4A0B', fontWeight: '800', fontSize: 12 }}>🟡 NO TRABAJÓ</Text>
                      <Text style={{ color: '#7A4A0B', fontSize: 11, marginTop: 2, marginBottom: 4 }}>El texto "NO TRABAJÓ" queda fijo. Escribe el motivo (obligatorio, aparece al lado).</Text>
                      <TextInput value={ntMotivo} onChangeText={setNtMotivo} placeholder="Motivo (ej: sin combustible, sin operador, lluvia, sin frente…)" placeholderTextColor={colors.muted} style={{ ...input, marginBottom: spacing.sm }} />
                      <Text style={{ color: '#7A4A0B', fontSize: 11, marginBottom: spacing.sm }}>Intentamos ubicarte solos para dejar constancia de dónde estaba. Solo se refleja en Inspecciones — no crea nada en Mantenimiento.</Text>
                      <TouchableOpacity onPress={() => capturarUbicacionNoTrabajo(false)} disabled={ntBusy} style={{ borderWidth: 1, borderColor: ntCoords ? colors.success : colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center', marginBottom: spacing.sm }}>
                        <Text style={{ color: ntCoords ? colors.success : '#7A4A0B', fontWeight: '700', fontSize: 12 }}>{ntBusy ? 'Ubicándote…' : ntCoords ? `✓ Ubicación capturada (${ntCoords.lat.toFixed(5)}, ${ntCoords.lng.toFixed(5)})` : '📍 Sin ubicación aún · toca para reintentar'}</Text>
                      </TouchableOpacity>
                      {ntCoords ? <Text style={{ color: '#7A4A0B', fontSize: 12, marginBottom: 4 }}>🏢 Edificio: <Text style={{ fontWeight: '700' }}>{edificioTextOf(ntCoords.lat, ntCoords.lng, (ci as any)?.referencia ?? '')}</Text></Text> : null}
                      <TouchableOpacity onPress={marcarParadaNoTrabajo} disabled={ciSaving || !ntMotivo.trim()} style={{ marginTop: spacing.sm, backgroundColor: '#D9A200', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: (ciSaving || !ntMotivo.trim()) ? 0.6 : 1 }}>
                        <Text style={{ color: '#fff', fontWeight: '800' }}>{ciSaving ? 'Guardando…' : '🟡 Confirmar PARADA (no trabajó)'}</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              ) : null}

              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Nota (opcional)</Text>
              <TextInput value={ciNote} onChangeText={setCiNote} placeholder="Observación…" placeholderTextColor={colors.muted} style={input} />

              {/* ── Registrar operador SIN teléfono: escanear su carnet + cotejar cédula
                     → inicia su jornada en esta máquina. Es opcional (independiente
                     de marcar la máquina como revisada). ───────────────────────── */}
              <View style={{ marginTop: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>👷 Iniciar jornada del operador</Text>
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
                  Si el operador no tiene teléfono: escanea su carnet y coteja su cédula para arrancar su jornada en esta máquina.
                </Text>
                <TouchableOpacity onPress={() => { setNotice(null); setOpScanOpen(true); }} style={{ marginTop: spacing.sm, backgroundColor: '#0EA5E9', borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontWeight: '800' }}>📷 {opEmp ? 'Volver a escanear carnet' : 'Escanear carnet del operador'}</Text>
                </TouchableOpacity>

                {opEmp ? (
                  <View style={{ marginTop: spacing.sm }}>
                    <View style={{ backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm, borderLeftWidth: 3, borderLeftColor: colors.success }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>📇 {opEmp.name}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>{opEmp.cargo || 'Sin cargo'}</Text>
                    </View>

                    {/* Turno de la jornada: sol (día) / luna (noche) */}
                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Turno de la jornada</Text>
                    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                      {([['day', '☀️', 'Día', '#EA6A1F'], ['night', '🌙', 'Noche', '#3B5BA5']] as const).map(([key, icon, label, tint]) => {
                        const on = opShift === key;
                        return (
                          <TouchableOpacity
                            key={key}
                            onPress={() => setOpShift(key)}
                            style={{ flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 2, borderColor: on ? tint : colors.border, backgroundColor: on ? tint + '22' : colors.surface, alignItems: 'center' }}
                          >
                            <Text style={{ fontSize: 26 }}>{icon}</Text>
                            <Text style={{ color: on ? tint : colors.text, fontWeight: '800', fontSize: 13, marginTop: 2 }}>{label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Coteja la cédula del operador</Text>
                    <TextInput value={opConfirmCedula} onChangeText={(t) => setOpConfirmCedula(t.replace(/\D/g, ''))} keyboardType="number-pad" inputMode="numeric" placeholder="Cédula del operador" placeholderTextColor={colors.muted} style={input} />
                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Horómetro inicial</Text>
                    <TextInput value={opHoro} onChangeText={(t) => setOpHoro(t.replace(/[^0-9.,]/g, ''))} keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted} style={input} />
                    <TouchableOpacity onPress={tomarFotoHoroSup} disabled={opHoroUploading} style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: opHoroPhoto ? colors.success : colors.border, backgroundColor: colors.surface }}>
                      <Text style={{ color: opHoroPhoto ? colors.success : colors.text, fontWeight: '700' }}>{opHoroUploading ? 'Subiendo…' : opHoroPhoto ? '✓ Foto del horómetro adjunta' : '📷 Foto del horómetro'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={confirmOperatorJornada} disabled={opBusy} style={{ marginTop: spacing.md, backgroundColor: '#1E9E4A', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: opBusy ? 0.6 : 1 }}>
                      <Text style={{ color: '#fff', fontWeight: '800' }}>{opBusy ? 'Guardando…' : '🟢 Iniciar jornada del operador'}</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>

              {/* ── Avería de maquinaria (misma función que el operador) → Mantenimiento ── */}
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: spacing.md, marginBottom: 4 }}>📋 Reportar sin detener la máquina</Text>
              <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm, borderWidth: 1, borderColor: colors.border }}>
                <TouchableOpacity onPress={() => setAvOpen((v) => !v)} activeOpacity={0.8} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>🛠️ Avería de maquinaria</Text>
                  <Text style={{ color: colors.primary, fontWeight: '800' }}>{avOpen ? '▲' : '▼'}</Text>
                </TouchableOpacity>
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
                  Reporta una falla a Mantenimiento SIN marcar la máquina como parada (la máquina sigue en su estado actual). Para detenerla, usa 🟡 PARADA más arriba.
                </Text>
                {avOpen ? (
                  <View style={{ marginTop: spacing.sm }}>
                    <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs }}>Toca el material que se necesita cambiar. Va al módulo de Mantenimiento de Maquinaria.</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                      {AV_MATERIALS.map((mt) => {
                        const on = avMaterial === mt.key;
                        return (
                          <TouchableOpacity key={mt.key} onPress={() => setAvMaterial(mt.key)} style={{ width: '47%', alignItems: 'center', paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 2, borderColor: on ? '#2563EB' : colors.border, backgroundColor: on ? '#2563EB' : colors.surface }}>
                            <Text style={{ fontSize: 28 }}>{mt.icon}</Text>
                            <Text style={{ color: on ? '#fff' : colors.text, fontWeight: '800', marginTop: 2, fontSize: 13 }}>{mt.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    {avMaterial ? (
                      <View style={{ marginTop: spacing.sm }}>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>Cantidad a cambiar</Text>
                        <TextInput value={avQty} onChangeText={(t) => setAvQty(t.replace(/[^0-9.,]/g, ''))} keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted} style={input} />
                        <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>Nota (obligatoria)</Text>
                        <TextInput value={avNote} onChangeText={setAvNote} placeholder="Detalle de la falla…" placeholderTextColor={colors.muted} style={input} />
                        <TouchableOpacity onPress={subirFotoAveria} disabled={avPhotoUp} style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: avPhoto ? colors.success : colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
                          <Text style={{ color: avPhoto ? colors.success : colors.text, fontWeight: '700', fontSize: 13 }}>{avPhotoUp ? 'Subiendo…' : avPhoto ? '✓ Foto de referencia adjunta' : '📷 Foto de referencia (opcional)'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={registrarAveria} disabled={avSaving || !avNote.trim()} style={{ marginTop: spacing.sm, backgroundColor: '#2563EB', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: (avSaving || !avNote.trim()) ? 0.6 : 1 }}>
                          <Text style={{ color: '#fff', fontWeight: '800' }}>{avSaving ? 'Guardando…' : '🛠️ Registrar avería'}</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>

              {/* ── Surtir gasoil (horómetro + litros, surtido vs consumido) ── */}
              {ci ? (
                <TouchableOpacity onPress={() => setGasoilId(ci.id)} style={{ marginTop: spacing.md, backgroundColor: '#15803D', borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontWeight: '800' }}>⛽ Surtir gasoil</Text>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity onPress={() => setCi(null)} style={{ marginTop: spacing.md, padding: spacing.sm, alignItems: 'center' }}>
                <Text style={{ color: colors.muted, fontWeight: '700' }}>Cerrar</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Escáner del carnet del operador (QR ?empleado=<id>) → coteja e inicia jornada. */}
      <Modal visible={opScanOpen} animationType="slide" onRequestClose={() => setOpScanOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <QrScanner onClose={() => setOpScanOpen(false)} onDetected={onOperatorCarnet} />
        </View>
      </Modal>

      {/* 🕒 MARCAR ASISTENCIA DEL PERSONAL (solo permiso 'asistencia'): escanear/
          buscar al empleado y marcar ENTRADA/SALIDA inteligente. */}
      <Modal visible={asisOpen} animationType="slide" onRequestClose={() => setAsisOpen(false)}>
        <Screen>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18 }}>🕒 Asistencia del personal</Text>
              <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>Escanea el carnet o busca por nombre/cédula.</Text>
            </View>
            <TouchableOpacity onPress={() => setAsisOpen(false)} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>Listo</Text>
            </TouchableOpacity>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled">
            {/* Escanear carnet */}
            <TouchableOpacity onPress={() => { setAsisNotice(null); setAsisScan(true); }} style={{ backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm }}>
              <Text style={{ fontSize: 20 }}>📷</Text>
              <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 15 }}>Escanear carnet</Text>
            </TouchableOpacity>

            {/* Búsqueda por nombre/cédula */}
            <TextInput value={asisQuery} onChangeText={setAsisQuery} placeholder="🔎 …o busca por nombre o cédula" placeholderTextColor={colors.muted} style={{ ...input, marginTop: spacing.sm }} />
            {asisResults.length ? (
              <Card>
                {asisResults.map((r) => (
                  <TouchableOpacity key={r.id} onPress={() => asisPick(r.id)} style={{ paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>{asisFullName(r)}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{[r.cargo, r.cedula ? `C.I. ${r.cedula}` : ''].filter(Boolean).join(' · ')}</Text>
                  </TouchableOpacity>
                ))}
              </Card>
            ) : null}

            {asisNotice ? (
              <Card><Text style={{ color: asisNotice.startsWith('❌') ? colors.danger : colors.success, fontWeight: '700' }}>{asisNotice}</Text></Card>
            ) : null}

            {/* Empleado elegido + marca inteligente */}
            {asisEmp ? (
              <Card>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                  {asisEmp.photo_url ? (
                    <Image source={{ uri: asisEmp.photo_url }} style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: colors.surfaceAlt }} />
                  ) : (
                    <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 24 }}>🪪</Text>
                    </View>
                  )}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>{asisFullName(asisEmp)}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{asisEmp.cargo || 'Sin cargo'}</Text>
                    {asisEmp.cedula ? <Text style={{ color: colors.muted, fontSize: 12 }}>C.I. {asisEmp.cedula}</Text> : null}
                    {asisEmp.status ? <View style={{ marginTop: 4 }}><Badge label={asisEmp.status} tone={empStatusTone(asisEmp.status)} /></View> : null}
                  </View>
                  <TouchableOpacity onPress={() => { setAsisEmp(null); setAsisToday([]); }} style={{ padding: spacing.xs }}>
                    <Text style={{ color: colors.muted, fontWeight: '800', fontSize: 16 }}>✕</Text>
                  </TouchableOpacity>
                </View>

                {/* Estado de hoy */}
                <View style={{ marginTop: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm }}>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    Hoy: {asisToday.length ? `${asisToday.length} marca(s)${asisTotal.open ? ' · jornada abierta' : ''}` : 'sin marcas todavía'}
                  </Text>
                  {asisToday.map((m) => (
                    <Text key={m.id} style={{ color: m.kind === 'entrada' ? colors.success : colors.danger, fontSize: 13, fontWeight: '700', marginTop: 2 }}>
                      {m.kind === 'entrada' ? '➡️ Entrada' : '⬅️ Salida'} · {fmtHora(m.ts)} · {SHIFT_LABEL[shiftOfTs(m.ts)]}
                    </Text>
                  ))}
                </View>

                <TouchableOpacity onPress={asisMarcar} disabled={asisBusy} style={{ marginTop: spacing.sm, backgroundColor: asisWillMark === 'entrada' ? colors.success : colors.danger, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: asisBusy ? 0.7 : 1 }}>
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>
                    {asisBusy ? 'Guardando…' : asisWillMark === 'entrada' ? '➡️ Marcar ENTRADA' : '⬅️ Marcar SALIDA'}
                  </Text>
                </TouchableOpacity>
              </Card>
            ) : null}
            <View style={{ height: spacing.xl }} />
          </ScrollView>
        </Screen>
      </Modal>

      {/* Escáner del carnet para la asistencia (QR ?empleado=<id>). */}
      <Modal visible={asisScan} animationType="slide" onRequestClose={() => setAsisScan(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <QrScanner onClose={() => setAsisScan(false)} onDetected={asisOnScanned} />
        </View>
      </Modal>
    </Screen>
  );
}
