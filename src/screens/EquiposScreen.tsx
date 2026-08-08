import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Image, Modal, TextInput, ScrollView, Platform } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { useToast } from '../components/ToastProvider';
import { RecordForm, Field } from '../components/RecordForm';
import { DateField } from '../components/DateField';
import { useTable } from '../hooks/useTable';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { supabase, selectAllRows } from '../lib/supabase';
import { captureLocation, warmLocation } from '../lib/location';
import { pickAndUploadPhoto } from '../lib/photo';
import { elapsedSince } from '../lib/time';
import { formatUTM } from '../lib/utm';
import { norm, onlyDecimal, cmpText } from '../lib/text';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { sectorOf, sectorMacro } from '../lib/mapZones';
import { workedFromShifts } from './ControlMaquinariaScreen';
import { machineQrUrl, qrSvg } from '../lib/qr';
import QrImage from '../components/QrImage';
import { GuardButton } from '../components/GuardButton';
import { fetchActiveGuards } from '../lib/guards';
import { latestInspectorByMachine, InspectorInfo } from '../lib/supervisorVisits';
import { listInspectorAssignments } from '../lib/machineInspectors';
import { caracasParts } from '../lib/jornada';
import { generalCompanies } from '../lib/companies';
import { edificioCanonico } from '../lib/edificios';
import MachineQuickScreen from './MachineQuickScreen';
import { useAuth } from '../context/AuthContext';
import { Machinery, Vehicle, Company, MachineGuard } from '../types/database';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

/** Fecha ISO "AAAA-MM-DD" → "DD/MM/AAAA" (para los PDF). */
function fmtDMY(iso: string): string {
  const [y, m, d] = (iso || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : (iso || '');
}

type FuelRow = { date: string; liters: number; tank: string; km?: number | null; gasto?: number | null };

type Kind = 'vehiculo' | 'maquinaria';

const KINDS: { value: Kind; label: string; icon: string }[] = [
  { value: 'vehiculo', label: 'Vehículo', icon: '🚗' },
  { value: 'maquinaria', label: 'Maquinaria', icon: '🚜' },
];

const VEHICLE_FIELDS: Field[] = [
  { key: 'plate', label: 'Placa', type: 'text', required: true },
  { key: 'brand', label: 'Marca', type: 'text' },
  { key: 'model', label: 'Modelo', type: 'text' },
  { key: 'vehicle_type', label: 'Tipo', type: 'text' },
  { key: 'tank_capacity_l', label: 'Capacidad tanque (L)', type: 'number' },
  { key: 'expected_kml', label: 'Rendimiento (km/L)', type: 'number' },
];

/** Tipo canónico: MAYÚSCULA, sin espacios extra y sin la "S" final, para que
 *  "Retroexcavadora", "retroexcavadoras", "RETROEXCAVADORAS" sean el MISMO tipo
 *  (el usuario puede escribir con o sin S). Vacío si no hay tipo. */
export const canonTipo = (t?: string | null): string => {
  if (!t || !t.trim()) return '';
  const up = t.trim().toUpperCase().replace(/\s+/g, ' ');
  // Quita la "S" del plural (RETROEXCAVADORAS→RETROEXCAVADORA), pero NO en palabras
  // que terminan en "US" (AUTOBUS, OMNIBUS) donde la S es parte del singular.
  return up.endsWith('US') ? up : up.replace(/S$/, '');
};

/** Dimensión por la que se puede agrupar/filtrar la maquinaria: Modelo o Clasificación.
 *  El "Modelo" se guarda en la columna `tipo` (histórica) y la "Clasificación" en `clasificacion`. */
export type GroupDim = 'modelo' | 'clasificacion';
export const DIM_LABEL: Record<GroupDim, string> = { modelo: 'Modelo', clasificacion: 'Clasificación' };
export const dimRaw = (m: Machinery, dim: GroupDim): string | null | undefined => (dim === 'modelo' ? m.tipo : m.clasificacion);
/** Valor canónico de la dimensión (MAYÚS, sin plural) para agrupar sin duplicar. */
export const canonDim = (m: Machinery, dim: GroupDim): string => canonTipo(dimRaw(m, dim));

/** Miniatura del catálogo. En WEB usa <img loading="lazy" decoding="async"> para
 *  que las fotos fuera de pantalla NO se descarguen hasta hacer scroll (el catálogo
 *  con ~200 equipos cargaba todas las imágenes de golpe y se ponía lento). */
function Thumb({ uri, size, radius: r }: { uri: string; size: number; radius: number }) {
  if (Platform.OS === 'web') {
    return React.createElement('img', {
      src: uri,
      loading: 'lazy',
      decoding: 'async',
      width: size,
      height: size,
      style: { width: size, height: size, borderRadius: r, objectFit: 'cover', display: 'block' },
    });
  }
  return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: r }} />;
}

/** Foto AMPLIADA (visor). Se ajusta al ancho conservando proporción (sin recortar). */
function BigPhoto({ uri }: { uri: string }) {
  if (Platform.OS === 'web') {
    return React.createElement('img', {
      src: uri,
      style: { width: '100%', maxHeight: '58vh', objectFit: 'contain', borderRadius: 10, display: 'block' },
    });
  }
  return <Image source={{ uri }} style={{ width: '100%', height: 320, borderRadius: 10 }} resizeMode="contain" />;
}

const MACHINERY_FIELDS: Field[] = [
  { key: 'code', label: 'Código / Nombre', type: 'text', required: true },
  { key: 'tipo', label: 'Modelo (CAT 320, Komatsu PC200...)', type: 'text' },
  { key: 'clasificacion', label: 'Clasificación (elige una o escribe nueva)', type: 'suggest', table: 'machinery', column: 'clasificacion' },
  { key: 'referencia', label: 'Referencia / Ubicación (edificio)', type: 'text' },
  { key: 'parroquia', label: 'Parroquia', type: 'suggest', table: 'machinery', column: 'parroquia' },
  { key: 'sector', label: 'Sector', type: 'suggest', table: 'machinery', column: 'sector' },
  { key: 'identifier', label: 'Identificador', type: 'text' },
  { key: 'plate', label: 'Placa', type: 'text' },
  { key: 'serial', label: 'Serial', type: 'text' },
  { key: 'company_id', label: 'Empresa supervisora', type: 'lookup', table: 'companies', labelCol: 'name', createColumn: 'name', filter: { hidden: false } },
  { key: 'grupo', label: 'Grupo', type: 'text' },
  { key: 'encargado', label: 'Encargado', type: 'text' },
  { key: 'zona', label: 'A disposición de (Gobernación, FANB, CVM… o vacío si es propia)', type: 'suggest', table: 'machinery', column: 'zona' },
  { key: 'expected_lph', label: 'Rendimiento (L/h)', type: 'number' },
  { key: 'daily_consumption_l', label: 'Consumo diario (L) — tope surtido 2×', type: 'number' },
  { key: 'con_tapa', label: '¿Tiene tapa?', type: 'switch' },
  { key: 'tapa_doble', label: '¿Doble tapa? (si no, es sencilla)', type: 'switch', showIf: (v) => v.con_tapa === 'true' },
];
// Texto legible del estado de tapa de una máquina.
export function tapaLabelOf(m: { con_tapa?: boolean | null; tapa_doble?: boolean | null }): string {
  if (!m.con_tapa) return 'Sin tapa';
  return m.tapa_doble ? 'Doble tapa' : 'Tapa sencilla';
}
// Campos de VIAJES: disponibles para TODAS las máquinas. El nº de viajes × precio
// por viaje se suma al subtotal del informe por jornada de la empresa de la máquina,
// y queda vinculado a la máquina para su próximo viaje.
const VIAJES_FIELDS: Field[] = [
  { key: 'viajes', label: '🚚 Viajes realizados', type: 'number' },
  { key: 'precio_viaje', label: '🚚 Precio por viaje ($)', type: 'number' },
];

export default function EquiposScreen({ navigation, route }: any) {
  const { colors } = useTheme();
  const toast = useToast();
  const [kind, setKind] = useState<Kind>('vehiculo');

  const vehicles = useTable<Vehicle>('vehicles', { orderBy: 'plate', ascending: true });
  const machinery = useTable<Machinery>('machinery', { orderBy: 'code', ascending: true });
  const companies = useTable<Company>('companies');
  const [query, setQuery] = useState('');
  const [companyFilter, setCompanyFilter] = useState<string>('__all__'); // '__all__' | '__none__' | company id
  const [companyPickerOpen, setCompanyPickerOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>('__all__'); // '__all__' | valor | '__none__'
  const [tapaFilter, setTapaFilter] = useState<'__all__' | 'sencilla' | 'doble' | 'sin'>('__all__'); // filtro por tapa (sencilla / doble / sin)
  const [catDim, setCatDim] = useState<GroupDim>('clasificacion'); // agrupar el catálogo por Clasificación (por defecto; Modelo genera demasiados chips)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({}); // empresa → desplegada (catálogo)
  const [detailExpanded, setDetailExpanded] = useState<Record<string, boolean>>({}); // empresa → desplegada (detalle activa/inactiva/espera)

  // Traza de combustible por máquina
  const [fuelFor, setFuelFor] = useState<Machinery | null>(null);
  const [fuelLoading, setFuelLoading] = useState(false);
  const [fuelTrace, setFuelTrace] = useState<FuelRow[]>([]);
  const [fuelSurtido, setFuelSurtido] = useState(0);
  const [fuelWorked, setFuelWorked] = useState(0);
  // Registrar un surtido (despacho) a la máquina desde su vista de combustible.
  const [regOpen, setRegOpen] = useState(false);
  const [regDate, setRegDate] = useState('');
  const [regLiters, setRegLiters] = useState('');
  const [regTank, setRegTank] = useState('');
  const [regOperator, setRegOperator] = useState('');
  const [regKmIda, setRegKmIda] = useState('');
  const [regKmVuelta, setRegKmVuelta] = useState('');
  const [regFuelStart, setRegFuelStart] = useState('');
  const [regFuelEnd, setRegFuelEnd] = useState('');
  const [regSaving, setRegSaving] = useState(false);
  const [tanks, setTanks] = useState<{ id: string; name: string; fuel: string }[]>([]);
  // QR de la máquina
  const [qrFor, setQrFor] = useState<Machinery | null>(null);
  const [qrStr, setQrStr] = useState<string>('');
  const [qrBlockBusy, setQrBlockBusy] = useState(false);
  // Guardia / militar encargado actual por máquina (historial acumulable).
  const { session, role } = useAuth();
  // SOLO los SUPERVISORES pueden iniciar jornada desde el catálogo (sin escanear el QR).
  const isSupervisor = role === 'supervisor';
  const [jornadaFor, setJornadaFor] = useState<Machinery | null>(null);
  const [guards, setGuards] = useState<Record<string, MachineGuard>>({});
  const [inspectors, setInspectors] = useState<Record<string, InspectorInfo>>({}); // inspector del último check-in por máquina
  // Operadores que ha tenido cada máquina (desplegable en la ficha). Una máquina puede tener varios.
  type OpItem = { key: string; name: string; cedula: string; last: string; days: number };
  const [opsOpen, setOpsOpen] = useState<Record<string, boolean>>({}); // machineId → desplegado
  const [opsByMachine, setOpsByMachine] = useState<Record<string, OpItem[] | 'loading'>>({});
  const toggleOps = async (machineId: string) => {
    const willOpen = !opsOpen[machineId];
    setOpsOpen((p) => ({ ...p, [machineId]: willOpen }));
    if (willOpen && opsByMachine[machineId] === undefined) {
      setOpsByMachine((p) => ({ ...p, [machineId]: 'loading' }));
      const { data } = await supabase
        .from('operator_assignments')
        .select('first_name, last_name, cedula, work_date')
        .eq('machinery_id', machineId)
        .order('work_date', { ascending: false });
      // Agrupar por cédula: un operador aparece una vez, con su última fecha y nº de jornadas.
      const byCed = new Map<string, OpItem>();
      (data ?? []).forEach((r: any) => {
        const key = String(r.cedula ?? `${r.first_name} ${r.last_name}`).trim();
        const g = byCed.get(key) ?? { key, name: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || '—', cedula: r.cedula ?? '', last: r.work_date, days: 0 };
        g.days += 1;
        if (r.work_date > g.last) g.last = r.work_date;
        byCed.set(key, g);
      });
      const list = Array.from(byCed.values()).sort((a, b) => (a.last < b.last ? 1 : -1));
      setOpsByMachine((p) => ({ ...p, [machineId]: list }));
    }
  };
  const companyName = useMemo(() => {
    const m = new Map(companies.data.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? m.get(id) ?? '' : '');
  }, [companies.data]);

  // Pre-calienta el GPS al entrar para que "Marcar ubicación" sea instantáneo.
  useEffect(() => { warmLocation(); }, []);

  // Carga el guardia/militar actual de cada máquina para mostrarlo en la ficha.
  const loadGuards = () => {
    const ids = machinery.data.map((m) => m.id);
    if (ids.length === 0) { setGuards({}); return; }
    fetchActiveGuards(ids).then(setGuards).catch(() => {});
  };
  useEffect(() => { loadGuards(); }, [machinery.data]);

  // Inspector "asignado" = quien hizo el último check-in en cada máquina.
  const loadInspectors = () => { latestInspectorByMachine().then(setInspectors).catch(() => {}); };
  useEffect(() => { loadInspectors(); }, [machinery.data]);

  // Inspector ASIGNADO (CHECK MÁQUINA) por TURNO, día y noche por separado — para el
  // reporte de conteo de equipos (a diferencia de `inspectors`, que es solo el último
  // check-in sin distinguir turno). Se recarga junto con el catálogo.
  const [inspByShift, setInspByShift] = useState<Record<string, { day: string | null; night: string | null }>>({});
  const loadInspByShift = () => {
    listInspectorAssignments().then(({ rows }) => {
      const m: Record<string, { day: string | null; night: string | null }> = {};
      rows.forEach((r) => {
        const e = m[r.machinery_id] ?? { day: null, night: null };
        if (r.shift === 'night') e.night = r.inspector_name; else e.day = r.inspector_name;
        m[r.machinery_id] = e;
      });
      setInspByShift(m);
    }).catch(() => {});
  };
  useEffect(() => { loadInspByShift(); }, [machinery.data]);

  // Avería/parada reportada por un inspector (Mantenimiento de Maquinaria) — el Catálogo
  // no la mostraba: `operational` solo lo cambia el admin a mano con "⛔ Inactiva", así
  // que una máquina averiada en el teléfono del inspector seguía viéndose "● Operativa"
  // aquí. Se lee de maintenance_requests (mismo criterio que SupervisorScreen/Inspecciones,
  // NO se toca `operational`) y se refresca en vivo.
  // `createdMs` = instante en que se marcó la avería/parada (para la regla de reactivación:
  // si la jornada abierta arrancó DESPUÉS de la marca, la máquina volvió a trabajar).
  const [averiaCat, setAveriaCat] = useState<Record<string, { tipo: 'averia' | 'parada'; motivo: string | null; createdMs: number }>>({});
  const loadAveriaCat = () => {
    Promise.all([
      supabase.from('maintenance_requests').select('machinery_id, material, notes, created_at').neq('material', 'MÁQUINA PARADA').eq('status', 'pendiente'),
      supabase.from('maintenance_requests').select('machinery_id, notes, created_at').eq('material', 'MÁQUINA PARADA').eq('status', 'pendiente'),
    ]).then(([averias, paradas]) => {
      const m: Record<string, { tipo: 'averia' | 'parada'; motivo: string | null; createdMs: number }> = {};
      const ms = (iso: any) => (iso ? new Date(iso).getTime() : 0);
      (paradas.data ?? []).forEach((r: any) => { m[r.machinery_id] = { tipo: 'parada', motivo: r.notes, createdMs: ms(r.created_at) }; });
      // Avería real tiene prioridad sobre el marcador genérico "MÁQUINA PARADA" (mismo orden que en SupervisorScreen).
      (averias.data ?? []).forEach((r: any) => { m[r.machinery_id] = { tipo: 'averia', motivo: r.notes || r.material, createdMs: ms(r.created_at) }; });
      setAveriaCat(m);
    }).catch(() => {});
  };
  useEffect(() => { loadAveriaCat(); }, [machinery.data]);

  // Estatus EN VIVO por jornada (machine_rounds): horas trabajadas hoy + jornada abierta.
  // Se lee la ronda de HOY (día de negocio Caracas) y la de ANOCHE si es una jornada de
  // NOCHE aún abierta (round_date = ayer). Por máquina: dayH/nightH ya trabajadas y el
  // instante de inicio (ms) de la jornada abierta, separado por turno.
  const [jornadaCat, setJornadaCat] = useState<Record<string, { dayH: number; nightH: number; openStartDay: number | null; openStartNight: number | null }>>({});
  const loadJornadaCat = () => {
    const now = new Date();
    const today = caracasParts(now).iso;
    const yesterday = caracasParts(new Date(now.getTime() - 86400000)).iso;
    Promise.all([
      supabase.from('machine_rounds').select('machinery_id, day_hours, night_hours, jornada_start_at, jornada_shift').eq('round_date', today),
      supabase.from('machine_rounds').select('machinery_id, night_hours, jornada_start_at, jornada_shift').eq('round_date', yesterday).eq('jornada_shift', 'night').not('jornada_start_at', 'is', null),
    ]).then(([todayRes, nightRes]) => {
      const m: Record<string, { dayH: number; nightH: number; openStartDay: number | null; openStartNight: number | null }> = {};
      const ensure = (id: string) => (m[id] ??= { dayH: 0, nightH: 0, openStartDay: null, openStartNight: null });
      // Turno del inicio: el declarado; si falta, se infiere por la hora Caracas (07–18:59 = día).
      const inferShift = (iso: string, shift: 'day' | 'night' | null): 'day' | 'night' => {
        if (shift) return shift;
        const h = caracasParts(new Date(iso)).hour;
        return h >= 7 && h < 19 ? 'day' : 'night';
      };
      (todayRes.data ?? []).forEach((r: any) => {
        const e = ensure(r.machinery_id);
        e.dayH = Math.max(e.dayH, Number(r.day_hours) || 0);
        e.nightH = Math.max(e.nightH, Number(r.night_hours) || 0);
        if (r.jornada_start_at) {
          const t = new Date(r.jornada_start_at).getTime();
          if (inferShift(r.jornada_start_at, r.jornada_shift) === 'day') e.openStartDay = e.openStartDay == null ? t : Math.min(e.openStartDay, t);
          else e.openStartNight = e.openStartNight == null ? t : Math.min(e.openStartNight, t);
        }
      });
      // Jornada de NOCHE de anoche aún abierta → cuenta como noche de hoy.
      (nightRes.data ?? []).forEach((r: any) => {
        const e = ensure(r.machinery_id);
        e.nightH = Math.max(e.nightH, Number(r.night_hours) || 0);
        if (r.jornada_start_at) {
          const t = new Date(r.jornada_start_at).getTime();
          e.openStartNight = e.openStartNight == null ? t : Math.min(e.openStartNight, t);
        }
      });
      setJornadaCat(m);
    }).catch(() => {});
  };
  useEffect(() => { loadJornadaCat(); }, [machinery.data]);

  // "Tick" en vivo: cada 60s re-renderiza para que las horas en curso crezcan solas.
  const [nowTick, setNowTick] = useState<number>(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);
  // machinery/vehicles/companies ya se refrescan solos (useTable se suscribe a su propia
  // tabla). Estas fuentes auxiliares (custodia, inspector del check-in, asignación por
  // turno y avería/parada) viven en OTRAS tablas y no se refrescaban si otro dispositivo las cambiaba.
  useRealtimeRefresh(['machine_guards'], loadGuards);
  useRealtimeRefresh(['supervisor_visits', 'machine_inspectors'], () => { loadInspectors(); loadInspByShift(); });
  useRealtimeRefresh(['maintenance_requests'], loadAveriaCat);
  useRealtimeRefresh(['machine_rounds'], loadJornadaCat);
  const refreshGuard = async (machineId: string) => {
    const map = await fetchActiveGuards([machineId]);
    setGuards((p) => {
      const next = { ...p };
      if (map[machineId]) next[machineId] = map[machineId]; else delete next[machineId];
      return next;
    });
  };

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchText, setBatchText] = useState('');
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isVehicle = kind === 'vehiculo';
  const matchCompany = (m: Machinery) =>
    companyFilter === '__all__'
      ? true
      : companyFilter === '__none__'
      ? !m.company_id
      : m.company_id === companyFilter;
  const matchType = (m: Machinery) => {
    if (typeFilter === '__all__') return true;
    const t = canonDim(m, catDim);
    return typeFilter === '__none__' ? !t : t === typeFilter;
  };
  const q = norm(query.trim());
  const matchQ = (hay: any[]) => !q || hay.filter(Boolean).some((v: any) => norm(v).includes(q));
  // Catálogo unificado: maquinaria (agrupada por empresa) + vehículos.
  // Las máquinas INACTIVAS (No operativa) NO se muestran en el catálogo: solo
  // aparecen en la sección "⛔ Maquinaria inactiva". Al reactivarlas (Operativa)
  // vuelven al catálogo automáticamente. Sus horas pasadas no se tocan.
  // La TAPA solo aplica a los equipos de TRANSPORTE DE ESCOMBROS (volteos/volquetas/
  // toronto/batea) — mismo criterio que los reportes (ESCOMBRO_RE por nombre/tipo/
  // clasificación). El filtro por tapa se limita a ese conjunto (pedido del cliente).
  const esEscombro = (m: Machinery) =>
    /VOLQUETA|VOLTEO|TORONTO|ESCOMBRO|BATEA/.test(`${m.code ?? ''} ${(m as any).tipo ?? ''} ${(m as any).clasificacion ?? ''}`.toUpperCase());
  // Filtro por tapa: sencilla (con tapa, no doble) · doble (con tapa doble) · sin tapa.
  // Al activar cualquier filtro de tapa, se muestran SOLO equipos de transporte de escombros.
  const matchTapa = (m: Machinery) =>
    tapaFilter === '__all__' ? true
    : !esEscombro(m) ? false
    : tapaFilter === 'sin' ? !m.con_tapa
    : tapaFilter === 'doble' ? (!!m.con_tapa && !!m.tapa_doble)
    : (!!m.con_tapa && !m.tapa_doble); // 'sencilla'
  const machineryList = machinery.data.filter(
    (m) => m.operational !== false && matchCompany(m) && matchType(m) && matchTapa(m) && matchQ([m.code, m.description, m.plate, m.serial, m.identifier, m.grupo, m.encargado, m.tipo, m.clasificacion, companyName(m.company_id), tapaLabelOf(m)])
  );
  // Opciones del filtro por la dimensión activa (Modelo/Clasificación), con conteo.
  const typeOptions = useMemo(() => {
    const c = new Map<string, number>();
    machinery.data.filter((m) => m.operational !== false && matchCompany(m)).forEach((m) => {
      const t = canonDim(m, catDim) || '__none__';
      c.set(t, (c.get(t) ?? 0) + 1);
    });
    const entries = Array.from(c.entries()).sort((a, b) =>
      a[0] === '__none__' ? 1 : b[0] === '__none__' ? -1 : cmpText(a[0], b[0])
    );
    return entries;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machinery.data, companyFilter, catDim]);
  const vehicleList = vehicles.data.filter((v) => matchQ([v.plate, v.brand, v.model, v.vehicle_type]));
  const totalResults = machineryList.length + vehicleList.length;
  const loading = machinery.loading || vehicles.loading;
  const refetchAll = () => { machinery.refetch(); vehicles.refetch(); };
  // Solo la PRIMERA carga muestra el spinner; los refrescos mantienen la lista (no salta al inicio).
  const firstLoad = loading && machinery.data.length === 0 && vehicles.data.length === 0;
  // Marca con ✓ la máquina recién guardada, sin mover el scroll.
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const savedTimer = useRef<any>(null);
  const handleSaved = (savedId?: string) => {
    refetchAll();
    if (!savedId) return;
    setJustSaved(savedId);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setJustSaved(null), 3500);
  };

  // Conteo de maquinaria por estado operativo (para las tarjetas superiores).
  const activeMachines = machinery.data.filter((m) => m.operational);
  const inactiveMachines = machinery.data.filter((m) => !m.operational);
  // "En espera": operativa pero pendiente de recepción (mismo criterio que el dashboard).
  const esperaMachines = machinery.data.filter((m) => m.operational !== false && m.en_espera);

  // Selector de tipo (se muestra al pulsar "+ Agregar" o "Lote") y detalle activas/inactivas.
  const [kindChooser, setKindChooser] = useState<null | 'add' | 'batch'>(null);
  const [detailStatus, setDetailStatus] = useState<null | 'active' | 'inactive' | 'espera'>(null);
  const [detailQuery, setDetailQuery] = useState(''); // buscador del detalle (por todas las características)
  useEffect(() => { setDetailQuery(''); }, [detailStatus]); // limpia el buscador al abrir/cerrar el detalle

  // Al llegar desde el Dashboard con ?status, abre el detalle de ese estado (maquinaria).
  useEffect(() => {
    const s = route?.params?.status;
    if (!s) return;
    setKind('maquinaria');
    setDetailStatus(s === 'espera' ? 'espera' : s === 'inactive' ? 'inactive' : 'active');
    navigation.setParams?.({ status: undefined }); // evita reabrir al volver
  }, [route?.params?.status]);

  // Al llegar desde el Dashboard con ?q (serial/código), filtra a ESA máquina.
  useEffect(() => {
    const term = route?.params?.q;
    if (!term) return;
    setKind('maquinaria');
    setQuery(String(term));
    navigation.setParams?.({ q: undefined });
  }, [route?.params?.q]);
  const detailList = detailStatus === 'active' ? activeMachines : detailStatus === 'inactive' ? inactiveMachines : detailStatus === 'espera' ? esperaMachines : [];
  const detailTitle = detailStatus === 'inactive' ? '⛔ Maquinaria inactiva' : detailStatus === 'espera' ? '🕓 Maquinaria en espera' : '✅ Maquinaria activa';
  // Buscador del detalle: filtra por TODAS las características (código, placa, serial,
  // identificador, grupo, encargado, tipo, clasificación, parroquia, sector, edificio/
  // referencia y nombre de empresa). Vacío = toda la lista.
  const detailNq = norm(detailQuery.trim());
  const detailFiltered = detailNq
    ? detailList.filter((m) => [m.code, (m as any).description, m.plate, m.serial, m.identifier, (m as any).grupo, m.encargado, m.tipo, m.clasificacion, (m as any).machinery_type, (m as any).parroquia, (m as any).sector, (m as any).referencia, companyName(m.company_id)]
        .filter(Boolean).some((v: any) => norm(v).includes(detailNq)))
    : detailList;

  // Reporte de CONTEO de equipos (por empresa o general) con vista previa. Solo conteo
  // + detalle: agrupa por TIPO de equipo (= código, lo que se lee "CAMION VOLTEO
  // TORONTO") y bajo cada tipo lista los equipos por empresa. Sin horas ni precios.
  const [reportOpen, setReportOpen] = useState(false);
  const [reportCompany, setReportCompany] = useState<string>('__all__'); // '__all__' | '__none__' | company id
  // Filtro por TIPO (código, unificado por texto normalizado). Vacío = todos.
  const [reportTypes, setReportTypes] = useState<Set<string>>(new Set());
  const [reportTypeQ, setReportTypeQ] = useState(''); // buscador del filtro de tipos
  const [reportFilterOpen, setReportFilterOpen] = useState(false); // lista desplegable del filtro
  const toggleReportType = (t: string) =>
    setReportTypes((prev) => {
      const n = new Set(prev);
      n.has(t) ? n.delete(t) : n.add(t);
      return n;
    });
  // "Equipo" que sale en el detalle del reporte: el CÓDIGO de la máquina (ej. "CAMION
  // VOLTEO TORONTO"). No se usa para filtrar (ver clasificación más abajo).
  const repTipoKey = (m: Machinery) => norm(m.code || '').replace(/\s+/g, ' ').trim();
  const repTipoLabel = (m: Machinery) => (String(m.code || '').replace(/\s+/g, ' ').trim().toUpperCase() || 'SIN TIPO');
  // FILTRO del reporte por CLASIFICACIÓN (m.clasificacion: Excavadora, Volteo, Retro,
  // remoción/excavación…), no por código — así se puede pedir "solo equipos de
  // remoción y/o excavación" sin tener que marcar cada código uno por uno.
  const repClasifKey = (m: Machinery) => norm((m as any).clasificacion || '').trim();
  const repClasifLabel = (m: Machinery) => (String((m as any).clasificacion || '').trim().toUpperCase() || 'SIN CLASIFICACIÓN');
  const scopedMachines = (scope: string) =>
    scope === '__all__'
      ? machinery.data
      : scope === '__none__'
      ? machinery.data.filter((m) => !m.company_id)
      : machinery.data.filter((m) => m.company_id === scope);

  // Horas trabajadas por máquina HASTA el 05/07/2026 (para el reporte de maquinaria).
  // Se carga una vez; horas = (día + noche) − parada + extras, dedupe por máquina+día.
  const CUTOFF_HORAS = '2026-07-05';
  const [hoursByMachine, setHoursByMachine] = useState<Record<string, number>>({});
  useEffect(() => {
    let alive = true;
    (async () => {
      // Paginado: con >1000 rondas la consulta se truncaba y faltaban horas.
      const data = await selectAllRows('machine_rounds', 'machinery_id, round_date, day_hours, night_hours, hours_stopped, overtime_hours', (q) => q.lte('round_date', CUTOFF_HORAS));
      if (!alive) return;
      const byMD = new Map<string, any>();
      (data ?? []).forEach((r: any) => byMD.set(`${r.machinery_id}|${r.round_date}`, r));
      const acc: Record<string, number> = {};
      byMD.forEach((r) => {
        const w = workedFromShifts(Number(r.day_hours ?? 0), Number(r.night_hours ?? 0), Number(r.hours_stopped ?? 0), Number(r.overtime_hours ?? 0));
        if (w > 0) acc[r.machinery_id] = (acc[r.machinery_id] ?? 0) + w;
      });
      setHoursByMachine(acc);
    })();
    return () => {
      alive = false;
    };
  }, []);
  // Formato de dinero: 2 decimales, redondeo estándar.
  const money = (n: number) => (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const openEdit = (item: any) => {
    setEditing(item);
    setFormOpen(true);
  };

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(key);
    let res: { ok: boolean; error?: string } = { ok: false };
    try {
      res = await fn();
    } catch (e: any) {
      res = { ok: false, error: e?.message ?? 'Ocurrió un error inesperado.' };
    } finally {
      setBusy(null); // pase lo que pase, se quita el "Ubicando…" (nunca se cuelga)
    }
    if (!res.ok && res.error) setNotice('⚠️ ' + res.error);
    if (res.ok) machinery.refetch();
  };
  const locate = (m: Machinery) => run(m.id + '-loc', () => captureLocation(m.id));
  const photo = (m: Machinery) => run(m.id + '-photo', () => pickAndUploadPhoto(m.id, 'photo_url'));
  const photoSerial = (m: Machinery) => run(m.id + '-photoser', () => pickAndUploadPhoto(m.id, 'photo_serial_url'));
  // Visor de fotos (máquina + serial/placa). Guardamos SOLO el id y releemos de la
  // lista para que, tras subir/cambiar una foto, el visor muestre la versión nueva.
  const [viewerId, setViewerId] = useState<string | null>(null);
  const viewer = viewerId ? (machinery.data.find((x) => x.id === viewerId) ?? null) : null;
  const toggleOp = (m: Machinery) =>
    run(m.id + '-op', async () => {
      const activando = !m.operational; // pasa a OPERATIVA (true)
      // Guardamos la FECHA del cambio: al inactivar → inactivated_at; al reactivar →
      // reactivated_at (y limpiamos inactivated_at para no confundir). Se muestra en el
      // catálogo, en el listado de inactivas y en los reportes.
      const nowIso = new Date().toISOString();
      const stamp = activando ? { reactivated_at: nowIso } : { inactivated_at: nowIso, reactivated_at: null };
      const { error } = await supabase.from('machinery').update({ operational: !m.operational, ...stamp }).eq('id', m.id);
      if (error) return { ok: false, error: error.message };
      // Al ACTIVAR (volver operativa) se limpia la etiqueta de avería/parada: se resuelven
      // las maintenance_requests pendientes de la máquina (mismo criterio que
      // `volverOperativa`/`iniciarJornada` en el teléfono). Best-effort: no debe tumbar el
      // toggle si falla; el realtime lo refresca. Al DESACTIVAR no se toca (queda inactiva).
      if (activando) {
        try {
          await supabase
            .from('maintenance_requests')
            .update({ status: 'realizado', resolved_at: new Date().toISOString() })
            .eq('machinery_id', m.id)
            .eq('status', 'pendiente');
        } catch { /* el refetch/realtime posterior reintenta */ }
      }
      return { ok: true };
    });
  // 3er estado: "En espera por recepción" (independiente de Operativa / No operativa).
  const toggleEspera = (m: Machinery) =>
    run(m.id + '-esp', async () => {
      const { error } = await supabase.from('machinery').update({ en_espera: !m.en_espera }).eq('id', m.id);
      return { ok: !error, error: error?.message };
    });

  // ── Traza de combustible (surtido) por máquina ───────────────────────────────
  const fuelConsumed = fuelFor?.expected_lph != null ? fuelWorked * Number(fuelFor.expected_lph) : null;
  // Consumo REAL por horómetro = litros ingresados ÷ horas operadas (horas por horómetro).
  const fuelPerHour = fuelWorked > 0 ? Math.round((fuelSurtido / fuelWorked) * 100) / 100 : null;
  const fuelLast = fuelTrace[0]?.date ?? null;

  // Tanques disponibles (para el selector al registrar un surtido).
  const loadTanks = () => {
    supabase.from('tanks').select('id, name, fuel').order('name').then(({ data }) => {
      setTanks((data ?? []) as { id: string; name: string; fuel: string }[]);
    });
  };
  useEffect(() => { loadTanks(); }, []);
  useRealtimeRefresh(['tanks'], loadTanks);
  // Historial de combustible (modal ⛽): si el chofer surte desde el teléfono
  // mientras este modal queda abierto en la PC, refresca la traza y el total.
  useRealtimeRefresh(['dispatches', 'machine_rounds'], () => { if (fuelFor) openFuel(fuelFor); });

  // Fecha de hoy en Caracas (para el valor por defecto del calendario), independiente
  // de la zona horaria del dispositivo.
  const todayISO = () => caracasParts(new Date()).iso;

  const abrirRegistro = () => {
    setRegDate(todayISO());
    setRegLiters('');
    setRegTank(tanks[0]?.id ?? '');
    setRegOperator('');
    setRegKmIda('');
    setRegKmVuelta('');
    setRegFuelStart('');
    setRegFuelEnd('');
    setRegOpen(true);
  };

  const num = (s: string) => { const n = Number((s || '').replace(',', '.')); return isFinite(n) ? n : null; };

  // Inserta un despacho de combustible a la máquina actual y refresca la traza.
  const registrarSurtido = async () => {
    if (!fuelFor) return;
    const liters = Number((regLiters || '').replace(',', '.'));
    if (!isFinite(liters) || liters <= 0) return toast.error('Ingresa los litros surtidos (mayor a 0).');
    if (!regTank) return toast.error('Selecciona el tanque de origen.');
    if (!regDate) return toast.error('Selecciona la fecha.');
    // Tope: no se puede solicitar más de 2× el consumo diario de la máquina.
    const diario = fuelFor.daily_consumption_l != null ? Number(fuelFor.daily_consumption_l) : null;
    if (diario != null && diario > 0 && liters > diario * 2) {
      return toast.error(`Esta máquina consume ${diario.toLocaleString()} L/día. No se puede surtir más de ${(diario * 2).toLocaleString()} L (2× el consumo diario).`);
    }
    setRegSaving(true);
    const { error } = await supabase.from('dispatches').insert({
      dispatch_date: regDate,
      asset_kind: 'maquinaria',
      machinery_id: fuelFor.id,
      liters,
      tank_id: regTank,
      driver_operator: regOperator.trim() || null,
      km_ida: num(regKmIda),
      km_vuelta: num(regKmVuelta),
      fuel_start: num(regFuelStart),
      fuel_end: num(regFuelEnd),
    });
    setRegSaving(false);
    if (error) return toast.error(error.message);
    setRegOpen(false);
    await openFuel(fuelFor); // recarga la traza y totales
  };

  // Abre el QR de una máquina (lo genera como SVG) y permite imprimirlo.
  const openQr = async (m: Machinery) => {
    setQrFor(m);
    setQrStr('');
    try { setQrStr(await qrSvg(machineQrUrl(m.id, m.serial), 260)); } catch {}
  };
  // Bloquear / desbloquear el QR de la máquina: si está bloqueado, al escanearlo solo
  // se muestra el logo (sin datos ni acciones). Es un bloqueo manual, independiente
  // del sello por serial.
  const toggleQrBlock = async () => {
    if (!qrFor || qrBlockBusy) return;
    const next = !((qrFor as any).qr_blocked === true);
    setQrBlockBusy(true);
    const { error } = await supabase.from('machinery').update({ qr_blocked: next }).eq('id', qrFor.id);
    setQrBlockBusy(false);
    if (error) return toast.error(error.message);
    setQrFor({ ...(qrFor as any), qr_blocked: next });
    machinery.refetch();
    toast.success(
      next
        ? 'QR bloqueado. Al escanear este QR ahora solo se muestra el logo. Nadie podrá registrar con él.'
        : 'QR desbloqueado. El QR vuelve a funcionar normalmente.'
    );
  };

  const printQr = async () => {
    if (!qrFor || !qrStr) return;
    const url = machineQrUrl(qrFor.id, qrFor.serial);
    const html = `<!doctype html><html><head><meta charset="utf-8"><title></title>
      <style>@page{margin:2cm}*{box-sizing:border-box}body{font-family:Tahoma,Geneva,Verdana,sans-serif;text-align:center;color:#111}
      .name{font-size:28px;font-weight:800;margin:6px 0 2px;color:#16324F}
      .sub{color:#555;font-size:14px;margin-bottom:16px}
      .qr{width:340px;height:340px;margin:0 auto}
      .u{color:#999;font-size:10px;margin-top:10px;word-break:break-all}
      .hint{margin-top:16px;font-size:12px;color:#333}</style></head>
      <body>
        <div class="name">${qrFor.code}</div>
        <div class="sub">${qrFor.serial ? 'Serial: ' + qrFor.serial : qrFor.plate ? 'Placa: ' + qrFor.plate : ''}</div>
        <div class="sub">${(qrFor.tipo || '')}${qrFor.referencia ? ' · ' + qrFor.referencia : ''}</div>
        <div class="qr">${qrStr}</div>
        <div class="hint">Escanea este código para registrar <b>combustible</b>, <b>ubicación</b> o <b>avería</b> de la máquina.</div>
        <div class="u">${url}</div>
      </body></html>`;
    await exportPdf(html, `Catálogo - QR ${qrFor.code}`);
  };

  const openFuel = async (m: Machinery) => {
    setFuelFor(m);
    setFuelLoading(true);
    setFuelTrace([]);
    setFuelSurtido(0);
    setFuelWorked(0);
    const [{ data: disp }, { data: rnd }] = await Promise.all([
      supabase.from('dispatches').select('dispatch_date, liters, tank:tank_id(name), km_ida, km_vuelta, fuel_start, fuel_end').eq('machinery_id', m.id).order('dispatch_date', { ascending: false }),
      supabase.from('machine_rounds').select('round_date, hours_stopped, overtime_hours, day_hours, night_hours').eq('machinery_id', m.id),
    ]);
    const trace: FuelRow[] = (disp ?? []).map((d: any) => {
      const km = (Number(d.km_ida) || 0) + (Number(d.km_vuelta) || 0);
      const gasto = (Number(d.fuel_start) || 0) - (Number(d.fuel_end) || 0);
      return { date: d.dispatch_date, liters: Number(d.liters) || 0, tank: d.tank?.name ?? '', km: km > 0 ? km : null, gasto: gasto > 0 ? gasto : null };
    });
    const surtido = trace.reduce((s, t) => s + t.liters, 0);
    // Horas trabajadas (para el consumo estimado) = por día: (turno día + noche) − parada + extras.
    const perDay = new Map<string, { stopped: number; overtime: number; day: number; night: number }>();
    (rnd ?? []).forEach((r: any) => {
      const p = perDay.get(r.round_date) ?? { stopped: 0, overtime: 0, day: 0, night: 0 };
      p.stopped = Math.max(p.stopped, Number(r.hours_stopped) || 0);
      p.overtime = Math.max(p.overtime, Number(r.overtime_hours) || 0);
      p.day = Math.max(p.day, Number(r.day_hours) || 0);
      p.night = Math.max(p.night, Number(r.night_hours) || 0);
      perDay.set(r.round_date, p);
    });
    let worked = 0;
    perDay.forEach((d) => { if (d.day + d.night > 0) worked += workedFromShifts(d.day, d.night, d.stopped, d.overtime); });
    setFuelTrace(trace);
    setFuelSurtido(surtido);
    setFuelWorked(worked);
    setFuelLoading(false);
  };

  const downloadFuelPdf = async () => {
    if (!fuelFor) return;
    const consumed = fuelConsumed;
    const rows = fuelTrace
      .map((t) => `<tr><td>${fmtDMY(t.date)}</td><td>${t.tank || '—'}</td><td style="text-align:right">${t.liters.toLocaleString()} L</td></tr>`)
      .join('');
    const html = pdfDocument({
      title: 'Traza de combustible',
      subtitle: `${fuelFor.code}${fuelFor.company_id ? ' · ' + (companyName(fuelFor.company_id) || '') : ''}`,
      extraCss: `
        .muted{color:#666;font-size:12px}
        .cards{display:flex;gap:10px;margin-top:12px}
        .c{flex:1;border:1px solid #ccc;border-radius:8px;padding:8px}
        .c .k{color:#666;font-size:11px}
        .c .v{font-weight:800;font-size:16px}
        table{width:100%;border-collapse:collapse;margin-top:14px;font-size:12px}
        th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
        th{background:#1E3A5F;color:#fff}
        h2{font-size:14px;color:#1E3A5F}`,
      body: `
      <div class="cards">
        <div class="c"><div class="k">Última vez surtida</div><div class="v">${fuelLast ?? '—'}</div></div>
        <div class="c"><div class="k">Total surtido</div><div class="v">${fuelSurtido.toLocaleString()} L</div></div>
        <div class="c"><div class="k">Consumo por horómetro</div><div class="v">${fuelPerHour != null ? fuelPerHour.toLocaleString() + ' L/h' : '—'}</div></div>
        <div class="c"><div class="k">Consumo estimado</div><div class="v">${consumed != null ? consumed.toLocaleString() + ' L' : '—'}</div></div>
      </div>
      <p class="muted" style="margin-top:6px">Consumo por horómetro (real) = ${fuelSurtido.toLocaleString()} L ÷ ${fuelWorked.toLocaleString()} h operadas${fuelFor.last_horometro != null ? ` · Último horómetro: ${fuelFor.last_horometro}` : ''}. Consumo estimado = ${fuelWorked.toLocaleString()} h × ${fuelFor.expected_lph != null ? Number(fuelFor.expected_lph).toLocaleString() + ' L/h' : 'sin rendimiento'}.</p>
      <h2>Traza de surtidos</h2>
      <table><thead><tr><th>Fecha</th><th>Tanque origen</th><th style="text-align:right">Litros</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3" style="text-align:center">Sin surtidos registrados</td></tr>'}</tbody>
      <tfoot><tr><td colspan="2" style="text-align:right"><b>Total surtido</b></td><td style="text-align:right"><b>${fuelSurtido.toLocaleString()} L</b></td></tr></tfoot></table>`,
    });
    await exportPdf(html, `Catálogo - Traza de combustible ${fuelFor.code}`);
  };

  const saveBatch = async () => {
    setBatchError(null);
    const lines = batchText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      setBatchError('Pega al menos un equipo (uno por línea).');
      return;
    }
    setBatchBusy(true);

    // La clave única es la PLACA (vehículos) o el CÓDIGO (maquinaria).
    // Se omiten duplicados dentro del lote y los que ya existen en la BD.
    const table = isVehicle ? 'vehicles' : 'machinery';
    const keyCol = isVehicle ? 'plate' : 'code';

    // 1) Construir filas a partir de cada línea (separadores: coma, tab o ;)
    type Row = { key: string; data: Record<string, any>; company?: string | null };
    const rows: Row[] = lines
      .map((l) => {
        const [a, b, c, d, e] = l.split(/[,\t;]/).map((s) => s.trim());
        if (isVehicle) {
          // placa, marca, modelo
          const plate = a;
          if (!plate) return null;
          return { key: plate.toLowerCase(), data: { plate, brand: b || null, model: c || null } };
        }
        // nombre, placa, serial, IDENTIFICADOR, EMPRESA  →  código único = "nombre placa"
        const name = a;
        if (!name) return null;
        const plate = b || null;
        const code = (plate ? `${name} ${plate}` : name).trim();
        return {
          key: code.toLowerCase(),
          data: { code, description: name, plate, serial: c || null, identifier: d || null, machinery_type: kind },
          company: e || null, // 5ª columna: empresa (se resuelve/crea abajo)
        };
      })
      .filter(Boolean) as Row[];

    // 2) Quitar duplicados dentro del mismo lote (por la clave única)
    const seen = new Set<string>();
    const uniq = rows.filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)));

    // 2.5) Resolver la EMPRESA (4ª columna) a company_id: se busca por nombre
    //      (sin distinguir mayúsculas) y si no existe, se crea automáticamente.
    if (!isVehicle) {
      const wanted = Array.from(new Set(uniq.map((r) => r.company).filter(Boolean).map((s) => (s as string).trim())));
      if (wanted.length > 0) {
        const { data: existing } = await supabase.from('companies').select('id, name');
        const byName = new Map<string, string>();
        (existing ?? []).forEach((c: any) => byName.set(String(c.name).trim().toLowerCase(), c.id));
        const missing = wanted.filter((w) => !byName.has(w.toLowerCase()));
        if (missing.length > 0) {
          const { data: created } = await supabase.from('companies').insert(missing.map((name) => ({ name }))).select('id, name');
          (created ?? []).forEach((c: any) => byName.set(String(c.name).trim().toLowerCase(), c.id));
        }
        uniq.forEach((r) => {
          if (r.company) r.data.company_id = byName.get(r.company.trim().toLowerCase()) ?? null;
        });
      }
    }

    // 3) Insertar con ON CONFLICT DO NOTHING: los que ya existen se omiten
    //    automáticamente (sin error 409). .select() devuelve solo los nuevos.
    const { data: inserted, error } = await supabase
      .from(table)
      .upsert(
        uniq.map((r) => r.data),
        { onConflict: keyCol, ignoreDuplicates: true }
      )
      .select(keyCol);
    setBatchBusy(false);
    if (error) {
      const msg = `${error.message} ${(error as any).details ?? ''}`.toLowerCase();
      if (msg.includes('uq_machinery_serial') || (msg.includes('serial') && msg.includes('duplicate'))) {
        setBatchError('YA EXISTE una máquina con uno de esos seriales. Revisa el lote y quita los repetidos.');
      } else {
        setBatchError(`${error.message}${(error as any).details ? ' — ' + (error as any).details : ''}`);
      }
      return;
    }

    const added = inserted?.length ?? 0;
    const omitted = rows.length - added;
    setBatchText('');
    setBatchOpen(false);
    setNotice(
      `✅ Lote cargado: se agregaron ${added} equipo(s).` + (omitted > 0 ? ` Omitidos por duplicado: ${omitted}.` : '')
    );
    refetchAll();
  };

  const kindMeta = KINDS.find((k) => k.value === kind)!;

  const companyOptions = useMemo(() => {
    // Solo contar las ACTIVAS (igual que la lista del catálogo, que excluye inactivas).
    const ofKind = machinery.data.filter((m) => m.operational !== false);
    const countFor = (id: string) => ofKind.filter((m) => m.company_id === id).length;
    return [
      { label: 'Todas las empresas', value: '__all__', count: ofKind.length },
      ...generalCompanies(companies.data) // sin ocultas ni "solo comidas" (p. ej. HBS, PNB Canica)
        .slice()
        .sort((a, b) => cmpText(a.name, b.name))
        .map((c) => ({ label: c.name, value: c.id, count: countFor(c.id) })),
      { label: 'Sin empresa', value: '__none__', count: ofKind.filter((m) => !m.company_id).length },
    ];
  }, [companies.data, machinery.data]);
  const companyFilterLabel = companyOptions.find((o) => o.value === companyFilter)?.label ?? 'Todas las empresas';

  // Agrupar la maquinaria por empresa (para el catálogo en acordeón).
  // Catálogo agrupado por EMPRESA (acordeón).
  // Agrupa una lista de máquinas por EMPRESA (para acordeones por empresa).
  const groupByCompany = (list: Machinery[]) => {
    const m = new Map<string, { key: string; name: string; items: Machinery[] }>();
    list.forEach((it) => {
      const k = it.company_id ?? '__none__';
      const name = it.company_id ? companyName(it.company_id) || 'Empresa' : 'Sin empresa';
      const g = m.get(k) ?? { key: k, name, items: [] };
      g.items.push(it);
      m.set(k, g);
    });
    return Array.from(m.values()).sort((a, b) => a.name === 'Sin empresa' ? 1 : b.name === 'Sin empresa' ? -1 : cmpText(a.name, b.name));
  };
  const machineryByCompany = useMemo(() => groupByCompany(machineryList), [machineryList, companyName]);

  // Datos del reporte: total GENERAL, conteo POR EMPRESA y DETALLE por empresa (cada
  // equipo con sus datos reales). Aplica el filtro de CLASIFICACIÓN tildada (vacío = todas).
  // El CONTEO cuenta SOLO equipos ACTIVOS (en ubicaciones/servicio): se excluyen los
  // INACTIVOS del catálogo (active=false / NO OPERATIVA operational=false) y los que están
  // EN ESPERA (stand by). Mismo criterio que el reporte de Conteo del módulo Reportes.
  const esActivoConteo = (m: Machinery) => m.en_espera !== true && (m as any).active !== false && m.operational !== false;
  const buildReportData = (scope: string, sel: Set<string>) => {
    const base = scopedMachines(scope).filter(esActivoConteo);
    const src = sel.size === 0 ? base : base.filter((m) => sel.has(repClasifKey(m)));
    const byCo = new Map<string, { name: string; items: Machinery[] }>();
    src.forEach((it) => {
      const name = it.company_id ? companyName(it.company_id) || 'Empresa' : 'Sin empresa';
      const g = byCo.get(name) ?? { name, items: [] };
      g.items.push(it);
      byCo.set(name, g);
    });
    const empresas = Array.from(byCo.values())
      .map((g) => ({ name: g.name, items: g.items.slice().sort((a, b) => cmpText(repTipoLabel(a), repTipoLabel(b)) || cmpText(a.serial, b.serial)) }))
      .sort((a, b) => (a.name === 'Sin empresa' ? 1 : b.name === 'Sin empresa' ? -1 : cmpText(a.name, b.name)));
    return { total: src.length, empresas };
  };
  const reportData = useMemo(() => buildReportData(reportCompany, reportTypes), [reportCompany, reportTypes, machinery.data, companyName]);
  // Opciones del checklist: CLASIFICACIONES del alcance con su cantidad (ej. Excavadora,
  // Volteo, Retro… — para poder pedir "solo remoción y/o excavación" de una vez).
  const reportTypeOptions = useMemo(() => {
    const m = new Map<string, { key: string; tipo: string; count: number }>();
    scopedMachines(reportCompany).filter(esActivoConteo).forEach((it) => {
      const k = repClasifKey(it);
      const e = m.get(k) ?? { key: k, tipo: repClasifLabel(it), count: 0 };
      e.count += 1;
      m.set(k, e);
    });
    return Array.from(m.values()).sort((a, b) => cmpText(a.tipo, b.tipo));
  }, [reportCompany, machinery.data]);
  const reportTotal = reportData.total;
  const titleForScope = (scope: string) =>
    scope === '__all__' ? 'Conteo de equipos — general' : `Conteo de equipos — ${companyName(scope) || 'Sin empresa'}`;
  const reportTitle = titleForScope(reportCompany);
  const estadoTxt = (m: Machinery) => (m.en_espera ? 'En espera' : m.operational ? 'Operativa' : 'No operativa');
  const estadoColor = (m: Machinery) => (m.en_espera ? colors.warning : m.operational ? colors.success : colors.danger);
  // Fecha (DD/MM/YYYY) de un timestamp ISO; null si no hay.
  const fmtEstadoFecha = (iso?: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  };
  // Línea con la fecha del último cambio de estado: inactivada (NO operativa) o
  // reactivada (volvió operativa). Se muestra en el catálogo, listado de inactivas y reportes.
  const EstadoFechaLine = ({ m }: { m: Machinery }) => {
    if (!m.operational) {
      const f = fmtEstadoFecha((m as any).inactivated_at);
      return f ? <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700' }}>🔴 Inactivada el {f}</Text> : null;
    }
    const f = fmtEstadoFecha((m as any).reactivated_at);
    return f ? <Text style={{ color: colors.success, fontSize: 11, fontWeight: '700' }}>🟢 Reactivada el {f}</Text> : null;
  };
  // Estatus EN VIVO de una máquina, con horas, combinando jornada (machine_rounds) y
  // avería/parada (maintenance_requests). Todo derivado; NO toca `operational`.
  //  - elapsedDia/Noche: horas transcurridas de la jornada abierta de cada turno (cap 12).
  //  - workedDia/Noche: horas ya trabajadas + en curso de cada turno (cap 12).
  //  - total: acumulado del día = día + noche (regla del cliente: de noche muestra el acumulado del día).
  //  - enCurso: lo que corre ahora mismo; trabajadas = total − enCurso (banqueado).
  //  - reactivación: si la jornada abierta arrancó en el mismo instante o DESPUÉS de la
  //    marca de avería/parada, esa marca ya NO cuenta (la máquina volvió a trabajar).
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const liveStatusOf = (id: string) => {
    const j = jornadaCat[id];
    const a = averiaCat[id];
    const dayH = j?.dayH ?? 0;
    const nightH = j?.nightH ?? 0;
    const openStartDay = j?.openStartDay ?? null;
    const openStartNight = j?.openStartNight ?? null;
    const elapsedDia = openStartDay ? Math.min(12, Math.max(0, (nowTick - openStartDay) / 3600000)) : 0;
    const elapsedNoche = openStartNight ? Math.min(12, Math.max(0, (nowTick - openStartNight) / 3600000)) : 0;
    const workedDia = Math.min(12, dayH + elapsedDia);
    const workedNoche = Math.min(12, nightH + elapsedNoche);
    const total = workedDia + workedNoche;
    const enCurso = elapsedDia + elapsedNoche;
    const trabajadas = Math.max(0, total - enCurso);
    const hasOpen = openStartDay != null || openStartNight != null;
    const openStart = Math.max(openStartDay ?? 0, openStartNight ?? 0);
    const averiaVigente = !!a && !(hasOpen && openStart >= a.createdMs);
    let estado: 'averiada' | 'parada' | 'trabajando' | 'trabajo_hoy' | 'ninguno';
    if (averiaVigente && a!.tipo === 'averia') estado = 'averiada';
    else if (averiaVigente && a!.tipo === 'parada') estado = 'parada';
    else if (hasOpen) estado = 'trabajando';
    else if (total > 0) estado = 'trabajo_hoy';
    else estado = 'ninguno';
    return { estado, total: round2(total), enCurso: round2(enCurso), trabajadas: round2(trabajadas), motivo: a?.motivo ?? null };
  };
  // Insignia de estatus EN VIVO (independiente de Operativa/No operativa) — sincronizada
  // con lo que marcó el inspector desde su teléfono y con la jornada abierta.
  const AveriaBadge = ({ id }: { id: string }) => {
    const s = liveStatusOf(id);
    if (s.estado === 'ninguno') return null;
    const h = (n: number) => n.toFixed(2);
    if (s.estado === 'averiada' || s.estado === 'parada') {
      const isAveria = s.estado === 'averiada';
      return (
        <View style={{ alignSelf: 'flex-start', marginTop: 4, backgroundColor: isAveria ? '#FEE2E2' : '#FEF3C7', borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
          <Text style={{ color: isAveria ? '#B91C1C' : '#B45309', fontWeight: '700', fontSize: 11 }} numberOfLines={2}>
            {isAveria ? '🔴 Averiada' : '🟡 Parada'}{s.motivo ? ` · ${s.motivo}` : ''} · Trabajó {h(s.trabajadas)}h · En curso 0h · Total {h(s.total)}h
          </Text>
        </View>
      );
    }
    if (s.estado === 'trabajando') {
      return (
        <View style={{ alignSelf: 'flex-start', marginTop: 4, backgroundColor: '#DCFCE7', borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
          <Text style={{ color: '#166534', fontWeight: '700', fontSize: 11 }} numberOfLines={1}>
            🟢 Trabajando · Total {h(s.total)}h · En curso {h(s.enCurso)}h
          </Text>
        </View>
      );
    }
    // trabajo_hoy: trabajó y cerró (sin jornada abierta, sin avería/parada vigente).
    return (
      <View style={{ alignSelf: 'flex-start', marginTop: 4, backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11 }} numberOfLines={1}>
          🏁 Trabajó hoy · Total {h(s.total)}h
        </Text>
      </View>
    );
  };

  // PDF: Total general → Por empresa (resumen) → Detalle por empresa (Equipo · Serial · Estado).
  // Edificio (derivado del catálogo oficial) o, si no matchea ninguno, la referencia
  // cruda tal como está escrita — "uno u otro", nunca los dos ni vacío si hay dato.
  const edificioOrRef = (m: Machinery): string => {
    const ref = (m as any).referencia as string | null;
    return edificioCanonico(ref) || (ref && ref.trim()) || '—';
  };

  const buildReportHtml = (scope: string) => {
    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const { total, empresas } = buildReportData(scope, reportTypes);
    const estColor = (m: Machinery) => (m.en_espera ? '#B45309' : m.operational ? '#15803D' : '#B91C1C');
    const resumenRows = empresas
      .map((c) => `<tr><td>${esc(c.name)}</td><td style="text-align:right;font-weight:700">${c.items.length}</td></tr>`)
      .join('');
    // Totales POR TIPO DE MAQUINARIA (arriba del reporte): cuántos equipos de cada tipo
    // y DÓNDE se ubican (🟢 Este / 🟠 Oeste, por GPS). Ej.: "PAYLOADER 7 · 3 Este · 4 Oeste".
    // A→Z natural. La zona sale del sector geográfico (sectorOf) igual que el mapa.
    const porTipo = new Map<string, { total: number; este: number; oeste: number; su: number }>();
    empresas.forEach((c) => c.items.forEach((m) => {
      const k = repTipoLabel(m);
      const e = porTipo.get(k) ?? { total: 0, este: 0, oeste: 0, su: 0 };
      e.total += 1;
      const macro = sectorMacro(sectorOf((m as any).latitude, (m as any).longitude));
      if (macro === 'OESTE') e.oeste += 1; else if (macro === 'ESTE') e.este += 1; else e.su += 1;
      porTipo.set(k, e);
    }));
    const tipoTot = { este: 0, oeste: 0, su: 0 };
    porTipo.forEach((v) => { tipoTot.este += v.este; tipoTot.oeste += v.oeste; tipoTot.su += v.su; });
    const anySU = tipoTot.su > 0;
    const clasifRows = Array.from(porTipo.entries())
      .sort((a, b) => cmpText(a[0], b[0]))
      .map(([k, v]) => `<tr><td>${esc(k)}</td><td style="text-align:right;font-weight:700">${v.total}</td><td style="text-align:right">${v.este}</td><td style="text-align:right">${v.oeste}</td>${anySU ? `<td style="text-align:right;color:#B91C1C">${v.su}</td>` : ''}</tr>`)
      .join('');
    const detalle = empresas
      .map((c) => {
        const rows = c.items
          .map((m, i) => {
            const insp = inspByShift[m.id];
            return `<tr>
              <td style="text-align:center">${i + 1}</td>
              <td>${esc(repTipoLabel(m))}</td>
              <td>${esc(repClasifLabel(m))}</td>
              <td>${esc(m.serial || '—')}</td>
              <td>${esc(m.plate || '—')}</td>
              <td>${esc((m as any).sector || '—')}</td>
              <td>${esc(edificioOrRef(m))}</td>
              <td>${esc(insp?.day || '—')}</td>
              <td>${esc(insp?.night || '—')}</td>
              <td style="color:${estColor(m)}">${esc(estadoTxt(m))}</td>
            </tr>`;
          })
          .join('');
        return `<h3 class="emp">🏢 ${esc(c.name.toUpperCase())} — ${c.items.length}</h3>
          <table><thead><tr>
            <th style="width:26px">#</th><th>Equipo</th><th>Clasificación</th><th>Serial</th><th>Placa</th>
            <th>Sector</th><th>Edificio / Referencia</th><th>Inspector ☀️ Día</th><th>Inspector 🌙 Noche</th><th>Estado</th>
          </tr></thead>
          <tbody>${rows}</tbody></table>`;
      })
      .join('');
    return pdfDocument({
      title: titleForScope(scope),
      subtitle: `Total general de equipos: ${total}${reportTypes.size > 0 ? ' · filtro de clasificación aplicado' : ''}`,
      extraCss: `
        .muted{color:#666;font-size:12px}
        table{width:100%;border-collapse:collapse;margin-top:2px;font-size:9.5px}
        th,td{border:1px solid #ccc;padding:4px 5px;text-align:left}
        th{background:#1E3A5F;color:#fff}
        h2{font-size:15px;color:#1E3A5F;margin:18px 0 6px;text-transform:uppercase;border-bottom:2px solid #E5E7EB;padding-bottom:3px}
        .emp{font-size:12.5px;font-weight:800;text-transform:uppercase;color:#1E3A5F;margin:12px 0 2px}
        .grand{margin:4px 0 8px;padding:10px 14px;background:#1E3A5F;color:#fff;font-weight:800;font-size:15px;border-radius:6px;text-align:right}`,
      body:
        `<div class="grand">Total general de equipos: ${total}</div>` +
        `<h2>Totales por tipo de maquinaria · 🟢 Este / 🟠 Oeste</h2>
         <table><thead><tr><th>Tipo de maquinaria</th><th style="text-align:right">Total</th><th style="text-align:right">🟢 Este</th><th style="text-align:right">🟠 Oeste</th>${anySU ? '<th style="text-align:right">Sin ubic.</th>' : ''}</tr></thead>
         <tbody>${clasifRows || `<tr><td colspan="${anySU ? 5 : 4}" style="text-align:center">Sin datos</td></tr>`}</tbody>
         <tfoot><tr><td style="text-align:right;font-weight:800">TOTAL</td><td style="text-align:right;font-weight:800">${total}</td><td style="text-align:right;font-weight:800">${tipoTot.este}</td><td style="text-align:right;font-weight:800">${tipoTot.oeste}</td>${anySU ? `<td style="text-align:right;font-weight:800">${tipoTot.su}</td>` : ''}</tr></tfoot></table>` +
        `<h2 style="margin-top:18px">Por empresa</h2>
         <table><thead><tr><th>Empresa</th><th style="text-align:right">Cantidad</th></tr></thead>
         <tbody>${resumenRows || '<tr><td colspan="2" style="text-align:center">Sin datos</td></tr>'}</tbody>
         <tfoot><tr><td style="text-align:right;font-weight:800">TOTAL</td><td style="text-align:right;font-weight:800">${total}</td></tr></tfoot></table>
         <h2 style="margin-top:18px">Detalle por empresa</h2>
         ${detalle || '<p class="muted">Sin equipos para este filtro.</p>'}`,
    });
  };
  const downloadReportPdf = async (scope: string = reportCompany) => {
    await exportPdf(buildReportHtml(scope), 'Catálogo - Conteo de equipos');
  };

  const renderMachineCard = (m: Machinery) => {
    const saved = justSaved === m.id;
    return (
    <Card key={m.id} style={saved ? { borderColor: colors.success, borderWidth: 2 } : undefined}>
      <TouchableOpacity onPress={() => { setKind('maquinaria'); openEdit(m); }} activeOpacity={0.7}>
        {saved ? (
          <View style={{ alignSelf: 'flex-start', backgroundColor: colors.success, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, marginBottom: spacing.xs }}>
            <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 11 }}>✓ Cambios guardados</Text>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          {/* Miniatura → abre el visor con AMBAS fotos (máquina + serial/placa). */}
          <TouchableOpacity onPress={() => setViewerId(m.id)} activeOpacity={0.7} style={{ width: 64, height: 64 }}>
            {m.photo_url ? (
              <Thumb uri={m.photo_url} size={64} radius={radius.md} />
            ) : (
              <View style={{ width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 28 }}>🚜</Text>
              </View>
            )}
            {m.photo_serial_url ? (
              <View style={{ position: 'absolute', right: -4, bottom: -4, backgroundColor: colors.brand, borderRadius: radius.pill, width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface }}>
                <Text style={{ fontSize: 11 }}>🔖</Text>
              </View>
            ) : null}
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '700', color: colors.text, fontSize: 17 }}>{m.code}</Text>
              <Text style={{ color: m.en_espera ? colors.warning : m.operational ? colors.success : colors.danger, fontWeight: '700', fontSize: 13 }}>
                {m.en_espera ? '🕓 En espera' : m.operational ? '● Operativa' : '● No operativa'}
              </Text>
            </View>
            <EstadoFechaLine m={m} />
            <AveriaBadge id={m.id} />
            {m.identifier ? <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>🆔 {m.identifier}</Text> : null}
            {m.tipo ? <Text style={{ color: colors.muted, fontSize: 12 }}>🏷️ Modelo: {m.tipo}</Text> : null}
            {m.clasificacion ? <Text style={{ color: colors.muted, fontSize: 12 }}>🗃️ Clasificación: {m.clasificacion}</Text> : null}
            {m.encargado ? <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>👤 Encargado: {m.encargado}</Text> : null}
            {(m as any).parroquia || (m as any).sector ? <Text style={{ color: colors.muted, fontSize: 12 }}>📍 {[(m as any).parroquia, (m as any).sector].filter(Boolean).join(' · ')}</Text> : null}
            {(m as any).referencia ? (
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                🏗️ {edificioCanonico((m as any).referencia) || 'Sin edificio identificado'} · Ref: {(m as any).referencia}
              </Text>
            ) : null}
            {inspectors[m.id] ? <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>🪖 Inspector: {inspectors[m.id].name} · {fmtDMY(inspectors[m.id].date)}</Text> : null}
            {m.grupo ? <Text style={{ color: colors.muted, fontSize: 12 }}>🗂️ Grupo: {m.grupo}</Text> : null}
            <Text style={{ color: colors.muted, fontSize: 12 }}>🛡️ Tapa: {tapaLabelOf(m)}</Text>
            {m.plate ? <Text style={{ color: colors.muted, fontSize: 12 }}>Placa: {m.plate}</Text> : null}
            {m.serial ? <Text style={{ color: colors.muted, fontSize: 12 }}>Serial: {m.serial}</Text> : null}
            {m.latitude != null ? (
              <Text style={{ color: colors.muted, fontSize: 12 }}>📍 UTM {formatUTM(m.latitude, m.longitude)} · {elapsedSince(m.location_at)}</Text>
            ) : (
              <Text style={{ color: colors.muted, fontSize: 12 }}>Sin ubicación</Text>
            )}
          </View>
        </View>
      </TouchableOpacity>

      {/* Guardia / militar encargado (asignable aquí y en las rondas; historial acumulable). */}
      <GuardButton machine={{ id: m.id, code: m.code }} current={guards[m.id] ?? null} onChanged={() => refreshGuard(m.id)} userId={session?.user?.id} />

      {/* Operadores asignados: una máquina puede tener varios; se despliega la lista. */}
      <TouchableOpacity
        onPress={() => toggleOps(m.id)}
        activeOpacity={0.7}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}
      >
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>👷 Operadores asignados</Text>
        <Text style={{ color: colors.muted, fontSize: 13 }}>{opsOpen[m.id] ? '▴' : '▾'}</Text>
      </TouchableOpacity>
      {opsOpen[m.id] ? (
        <View style={{ marginTop: spacing.xs, paddingLeft: spacing.sm }}>
          {opsByMachine[m.id] === 'loading' ? (
            <Text style={{ color: colors.muted, fontSize: 12 }}>Cargando…</Text>
          ) : (opsByMachine[m.id] as OpItem[])?.length ? (
            (opsByMachine[m.id] as OpItem[]).map((op) => (
              <View key={op.key} style={{ paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{op.name}</Text>
                <Text style={{ color: colors.muted, fontSize: 11 }}>
                  {op.cedula ? `C.I. ${op.cedula} · ` : ''}Última: {fmtDMY(op.last)} · {op.days} jornada{op.days === 1 ? '' : 's'}
                </Text>
              </View>
            ))
          ) : (
            <Text style={{ color: colors.muted, fontSize: 12 }}>Sin operadores registrados.</Text>
          )}
        </View>
      ) : null}

      {/* SOLO supervisores: iniciar jornada de esta máquina sin escanear el QR. */}
      {isSupervisor ? (
        <TouchableOpacity onPress={() => setJornadaFor(m)} style={{ marginTop: spacing.sm, backgroundColor: colors.success, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>🕒 Iniciar jornada</Text>
        </TouchableOpacity>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
        <BigBtn label={busy === m.id + '-loc' ? 'Ubicando…' : '📍 ACTUALIZAR UBICACIÓN'} onPress={() => locate(m)} color="#2563EB" disabled={busy === m.id + '-loc'} />
        {m.latitude != null ? (
          <BigBtn label="🗺️ Ver en mapa" onPress={() => navigation?.navigate('Map', { focus: { id: m.id, code: m.code } })} color="#0D9488" />
        ) : null}
        <BigBtn label={busy === m.id + '-photo' ? 'Subiendo…' : '📷 Foto máquina'} onPress={() => photo(m)} color={colors.brand} textColor={colors.brandContrast} disabled={busy === m.id + '-photo'} />
        <BigBtn label={busy === m.id + '-photoser' ? 'Subiendo…' : '🔖 Foto serial/placa'} onPress={() => photoSerial(m)} color={colors.brand} textColor={colors.brandContrast} disabled={busy === m.id + '-photoser'} />
        <BigBtn label="⛽ Combustible" onPress={() => openFuel(m)} color="#0EA5E9" />
        <BigBtn label="🔳 QR" onPress={() => openQr(m)} color="#111827" />
        <BigBtn label={m.operational ? '⛔ Inactiva' : '✅ Operativa'} onPress={() => toggleOp(m)} color={m.operational ? colors.danger : colors.success} disabled={busy === m.id + '-op'} />
        <BigBtn label={m.en_espera ? '📥 Quitar espera' : '🕓 En espera'} onPress={() => toggleEspera(m)} color={m.en_espera ? colors.success : colors.warning} disabled={busy === m.id + '-esp'} />
      </View>
    </Card>
    );
  };

  const BigBtn = ({ label, onPress, color, disabled, textColor = '#fff' }: any) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={{
        flexGrow: 1,
        flexBasis: 100,
        minHeight: 44,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: color,
        opacity: disabled ? 0.6 : 1,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
      }}
    >
      <Text style={{ color: textColor, fontWeight: '700', textAlign: 'center', fontSize: 13 }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Screen>
      <ConfigBanner />

      {/* Visor de fotos: MAQUINARIA + SERIAL/PLACA, ampliadas y con su etiqueta.
          Desde aquí también se puede agregar/cambiar cada una. */}
      {viewer ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setViewerId(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' }}>
            <ScrollView contentContainerStyle={{ padding: spacing.md, paddingTop: spacing.xl, paddingBottom: spacing.xl, gap: spacing.lg }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>
                  {viewer.code}{viewer.plate ? ` · Placa ${viewer.plate}` : ''}{viewer.serial ? ` · Serial ${viewer.serial}` : ''}
                </Text>
                <TouchableOpacity onPress={() => setViewerId(null)} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.15)' }}>
                  <Text style={{ color: '#fff', fontWeight: '800' }}>✕ Cerrar</Text>
                </TouchableOpacity>
              </View>
              {[
                { url: viewer.photo_url, label: 'MAQUINARIA', onSet: () => photo(viewer), bkey: '-photo' },
                { url: viewer.photo_serial_url, label: 'SERIAL / PLACA', onSet: () => photoSerial(viewer), bkey: '-photoser' },
              ].map((p) => (
                <View key={p.label} style={{ gap: spacing.xs }}>
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13, letterSpacing: 0.5 }}>{p.label}</Text>
                  {p.url ? (
                    <BigPhoto uri={p.url} />
                  ) : (
                    <View style={{ height: 160, borderRadius: radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>Sin foto todavía</Text>
                    </View>
                  )}
                  <TouchableOpacity onPress={p.onSet} disabled={busy === viewer.id + p.bkey} style={{ alignSelf: 'flex-start', backgroundColor: colors.accent, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, opacity: busy === viewer.id + p.bkey ? 0.6 : 1 }}>
                    <Text style={{ color: colors.accentContrast, fontWeight: '800', fontSize: 12 }}>{busy === viewer.id + p.bkey ? 'Subiendo…' : (p.url ? '🔄 Cambiar foto' : '📷 Agregar foto')}</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          </View>
        </Modal>
      ) : null}

      <SectionTitle>Catálogo maquinaria/vehículos</SectionTitle>

      {notice ? (
        <TouchableOpacity onPress={() => setNotice(null)}>
          <View style={{ backgroundColor: colors.surfaceAlt, borderLeftWidth: 4, borderLeftColor: colors.brand, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm }}>
            <Text style={{ color: colors.text, fontSize: 13 }}>{notice}</Text>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>Toca para cerrar</Text>
          </View>
        </TouchableOpacity>
      ) : null}

      {/* Tarjetas de estado: maquinaria activa / inactiva (clickeables → detalle) */}
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
        <TouchableOpacity activeOpacity={0.7} style={{ flex: 1 }} onPress={() => setDetailStatus('active')}>
          <Card style={{ borderLeftWidth: 4, borderLeftColor: colors.success }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Maquinaria activa</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>›</Text>
            </View>
            <Text style={{ fontSize: 22, fontWeight: '800', color: colors.success, fontVariant: ['tabular-nums'] as any }}>{machinery.loading ? '…' : activeMachines.length}</Text>
          </Card>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.7} style={{ flex: 1 }} onPress={() => setDetailStatus('inactive')}>
          <Card style={{ borderLeftWidth: 4, borderLeftColor: colors.danger }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Maquinaria inactiva</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>›</Text>
            </View>
            <Text style={{ fontSize: 22, fontWeight: '800', color: colors.danger, fontVariant: ['tabular-nums'] as any }}>{machinery.loading ? '…' : inactiveMachines.length}</Text>
          </Card>
        </TouchableOpacity>
      </View>

      {/* Alta unificada: + Agregar (elige vehículo o maquinaria) y Lote */}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <TouchableOpacity
          style={{ flex: 2, backgroundColor: colors.brand, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center' }}
          onPress={() => setKindChooser('add')}
        >
          <Text style={{ color: colors.brandContrast, fontWeight: '700', fontSize: 15 }}>
            🚗 / 🚜  + Agregar
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center' }}
          onPress={() => setKindChooser('batch')}
        >
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15 }}>📋 Lote</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
        <TouchableOpacity
          onPress={() => navigation.navigate('Map')}
          style={{ flex: 1, backgroundColor: '#2563EB', borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>🗺️  Ver mapa</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setReportOpen(true)}
          style={{ flex: 1, backgroundColor: '#0EA5E9', borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>📄  Reportes</Text>
        </TouchableOpacity>
      </View>

      <View style={{ marginTop: spacing.sm }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="🔎 Buscar por código, placa, serial, identificador o empresa…"
          placeholderTextColor={colors.muted}
          style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }}
        />
        {q ? (
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{totalResults} resultado(s)</Text>
        ) : null}
      </View>

      {/* Filtro por empresa (maquinaria) — lista desplegable */}
      <View style={{ marginTop: spacing.sm }}>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Filtrar por empresa</Text>
        <TouchableOpacity
          onPress={() => setCompanyPickerOpen(true)}
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}
        >
          <Text style={{ color: colors.text, fontWeight: '600' }}>{companyFilterLabel}</Text>
          <Text style={{ color: colors.muted, fontSize: 16 }}>▾</Text>
        </TouchableOpacity>
      </View>

      {/* Filtro por Clasificación (chips) */}
      <View style={{ marginTop: spacing.sm }}>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Filtrar por clasificación</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, paddingRight: spacing.md }}>
          {([['__all__', 'Todos'], ...typeOptions.map(([t]) => [t, t === '__none__' ? `Sin ${DIM_LABEL[catDim].toLowerCase()}` : t] as [string, string])] as [string, string][]).map(([val, label]) => {
            const active = typeFilter === val;
            const count = val === '__all__' ? typeOptions.reduce((s, [, n]) => s + n, 0) : (typeOptions.find(([t]) => t === val)?.[1] ?? 0);
            return (
              <TouchableOpacity
                key={val}
                onPress={() => setTypeFilter(val)}
                activeOpacity={0.7}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: active ? colors.brand : colors.surfaceAlt, borderWidth: 1, borderColor: active ? colors.brand : colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}
              >
                <Text style={{ color: active ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{label}</Text>
                <Text style={{ color: active ? colors.brandContrast : colors.muted, fontSize: 12 }}>({count})</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Filtro por TAPA (chips): sencilla / doble / sin tapa */}
      <View style={{ marginTop: spacing.sm }}>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Filtrar por tapa</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, paddingRight: spacing.md }}>
          {(() => {
            const base = machinery.data.filter((m) => m.operational !== false && matchCompany(m) && esEscombro(m));
            const counts = {
              __all__: base.length,
              sencilla: base.filter((m) => !!m.con_tapa && !m.tapa_doble).length,
              doble: base.filter((m) => !!m.con_tapa && !!m.tapa_doble).length,
              sin: base.filter((m) => !m.con_tapa).length,
            } as const;
            const chips: [typeof tapaFilter, string][] = [['__all__', 'Todas'], ['sencilla', '🛡️ Tapa sencilla'], ['doble', '🛡️🛡️ Doble tapa'], ['sin', 'Sin tapa']];
            return chips.map(([val, label]) => {
              const active = tapaFilter === val;
              return (
                <TouchableOpacity
                  key={val}
                  onPress={() => setTapaFilter(val)}
                  activeOpacity={0.7}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: active ? colors.brand : colors.surfaceAlt, borderWidth: 1, borderColor: active ? colors.brand : colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}
                >
                  <Text style={{ color: active ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{label}</Text>
                  <Text style={{ color: active ? colors.brandContrast : colors.muted, fontSize: 12 }}>({counts[val]})</Text>
                </TouchableOpacity>
              );
            });
          })()}
        </ScrollView>
      </View>

      {firstLoad ? (
        <Loading />
      ) : companyFilter === '__all__' && typeFilter === '__all__' && tapaFilter === '__all__' && !q ? (
        <EmptyState title="Elige una empresa o clasificación" subtitle="Selecciona una empresa en la lista desplegable 🏢 (o toca una clasificación / tapa / busca por código, placa o serial) para ver los equipos." />
      ) : totalResults === 0 ? (
        <EmptyState title={q ? 'Sin resultados' : 'Sin equipos'} subtitle={q ? 'Prueba con otra búsqueda.' : 'Agrega tu primer equipo con el botón de arriba.'} />
      ) : (
        <>
          {/* Maquinaria dividida por EMPRESA (acordeón). */}
          {machineryByCompany.map((g) => {
            // Al buscar, las empresas quedan COMPACTADAS por defecto (el usuario despliega la que
            // le interese). Solo se auto-abren si se filtró una empresa o una clasificación.
            const open = expanded[g.key] ?? (companyFilter !== '__all__' || typeFilter !== '__all__');
            return (
              <View key={g.key} style={{ marginBottom: spacing.xs }}>
                <TouchableOpacity
                  onPress={() => setExpanded((p) => ({ ...p, [g.key]: !open }))}
                  activeOpacity={0.7}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: open ? colors.brand : colors.surfaceAlt, borderWidth: 1, borderColor: open ? colors.brand : colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 }}>
                    <Text style={{ color: open ? colors.brandContrast : colors.muted, fontSize: 16 }}>{open ? '▾' : '▸'}</Text>
                    <Text style={{ color: open ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>🏢 {g.name}</Text>
                  </View>
                  <View style={{ backgroundColor: open ? colors.brandContrast : colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
                    <Text style={{ color: open ? colors.brand : colors.brandContrast, fontWeight: '800', fontSize: 13 }}>{g.items.length}</Text>
                  </View>
                </TouchableOpacity>
                {open ? <View style={{ marginTop: spacing.sm }}>{g.items.map(renderMachineCard)}</View> : null}
              </View>
            );
          })}

          {/* Vehículos (acordeón aparte, dentro del mismo catálogo). */}
          {vehicleList.length > 0 ? (
            (() => {
              const open = expanded['__vehicles__'] ?? false;
              return (
                <View style={{ marginBottom: spacing.xs }}>
                  <TouchableOpacity
                    onPress={() => setExpanded((p) => ({ ...p, __vehicles__: !open }))}
                    activeOpacity={0.7}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: open ? colors.brand : colors.surfaceAlt, borderWidth: 1, borderColor: open ? colors.brand : colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 }}>
                      <Text style={{ color: open ? colors.brandContrast : colors.muted, fontSize: 16 }}>{open ? '▾' : '▸'}</Text>
                      <Text style={{ color: open ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>🚗 Vehículos</Text>
                    </View>
                    <View style={{ backgroundColor: open ? colors.brandContrast : colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
                      <Text style={{ color: open ? colors.brand : colors.brandContrast, fontWeight: '800', fontSize: 13 }}>{vehicleList.length}</Text>
                    </View>
                  </TouchableOpacity>
                  {open ? (
                    <View style={{ marginTop: spacing.sm }}>
                      {vehicleList.map((v) => (
                        <TouchableOpacity key={v.id} onPress={() => { setKind('vehiculo'); openEdit(v); }} activeOpacity={0.7}>
                          <Card>
                            <Text style={{ fontWeight: '700', color: colors.text, fontSize: 17 }}>🚗 {v.plate}</Text>
                            {v.brand || v.model ? (
                              <Text style={{ color: colors.muted, fontSize: 13 }}>{`${v.brand ?? ''} ${v.model ?? ''}`.trim()}</Text>
                            ) : null}
                            {v.vehicle_type ? <Text style={{ color: colors.muted, fontSize: 12 }}>Tipo: {v.vehicle_type}</Text> : null}
                            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>Toca para editar</Text>
                          </Card>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })()
          ) : null}
        </>
      )}

      {/* QR de la máquina */}
      <Modal visible={!!qrFor} transparent animationType="fade" onRequestClose={() => setQrFor(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center', borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18, textAlign: 'center' }}>{qrFor?.code}</Text>
            {qrFor?.serial || qrFor?.plate ? (
              <Text style={{ color: colors.brandText, fontSize: 13, fontWeight: '700' }}>{qrFor?.serial ? `Serial: ${qrFor.serial}` : `Placa: ${qrFor.plate}`}</Text>
            ) : null}
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.md }}>Código QR de la máquina</Text>
            {qrStr ? (
              <View style={{ backgroundColor: '#fff', padding: spacing.sm, borderRadius: radius.md }}>
                <QrImage svg={qrStr} size={240} />
              </View>
            ) : (
              <Text style={{ color: colors.muted, marginVertical: spacing.lg }}>Generando…</Text>
            )}
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm, textAlign: 'center' }}>
              {(qrFor as any)?.qr_blocked === true
                ? '🚫 QR BLOQUEADO: al escanearlo solo se muestra el logo. Nadie puede registrar con él.'
                : 'Al escanearlo se abre el sistema con las acciones de esta máquina (combustible, mapa y avería).'}
            </Text>
            {/* Bloquear / desbloquear el QR de esta máquina (mostrar solo el logo). */}
            <TouchableOpacity
              onPress={toggleQrBlock}
              disabled={qrBlockBusy}
              style={{ alignSelf: 'stretch', marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: (qrFor as any)?.qr_blocked === true ? colors.success : colors.danger, opacity: qrBlockBusy ? 0.7 : 1 }}
            >
              <Text style={{ color: '#fff', fontWeight: '800' }}>
                {qrBlockBusy ? 'Guardando…' : (qrFor as any)?.qr_blocked === true ? '✅ Desbloquear QR' : '🚫 Bloquear QR (mostrar solo el logo)'}
              </Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, alignSelf: 'stretch' }}>
              <TouchableOpacity onPress={() => setQrFor(null)} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={printQr} disabled={!qrStr} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.brand }}>
                <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>🖨️ Imprimir</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Carga por lote: pegar varias líneas */}
      <Modal visible={batchOpen} animationType="slide" transparent onRequestClose={() => setBatchOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg }}>
            <Text style={{ fontWeight: '700', color: colors.text, fontSize: 18, marginBottom: spacing.xs }}>
              Cargar {kindMeta.label.toLowerCase()} por lote
            </Text>
            <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.sm }}>
              Pega una por línea. Opcional: {isVehicle ? 'placa, marca, modelo' : 'nombre, placa, serial, identificador, empresa'} separados por coma.
              {isVehicle ? '' : ' La empresa se reconoce por su nombre y, si no existe, se crea.'}
            </Text>
            <ScrollView style={{ maxHeight: 240 }}>
              <TextInput
                value={batchText}
                onChangeText={setBatchText}
                multiline
                placeholder={isVehicle ? 'ABC123\nXYZ789, Toyota, Hilux' : 'RETRO-01\nVOLVO-02, PBA123, SER-998, ID-77, Beraca'}
                placeholderTextColor={colors.muted}
                style={{ minHeight: 160, textAlignVertical: 'top', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }}
              />
            </ScrollView>
            {batchError ? (
              <View style={{ backgroundColor: colors.dangerSoftBg, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.sm }}>
                <Text style={{ color: colors.dangerSoftText, fontSize: 13, fontWeight: '600' }}>Error: {batchError}</Text>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setBatchOpen(false)}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.brand }} onPress={saveBatch} disabled={batchBusy}>
                <Text style={{ color: colors.brandContrast, fontWeight: '700' }}>{batchBusy ? 'Guardando…' : 'Guardar lote'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Lista desplegable de empresas para filtrar */}
      <Modal visible={companyPickerOpen} transparent animationType="fade" onRequestClose={() => setCompanyPickerOpen(false)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setCompanyPickerOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, maxHeight: '75%', overflow: 'hidden' }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16, padding: spacing.md }}>Filtrar por empresa</Text>
            <ScrollView>
              {companyOptions.map((o) => {
                const active = companyFilter === o.value;
                return (
                  <TouchableOpacity
                    key={o.value}
                    onPress={() => { setCompanyFilter(o.value); setCompanyPickerOpen(false); }}
                    style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: active ? colors.surfaceAlt : 'transparent', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}
                  >
                    <Text style={{ color: active ? colors.brandText : colors.text, fontWeight: active ? '800' : '500', flex: 1 }}>{o.label}</Text>
                    <View style={{ backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, minWidth: 26, alignItems: 'center' }}>
                      <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>{o.count}</Text>
                    </View>
                    {active ? <Text style={{ color: colors.brandText, fontWeight: '800' }}>✓</Text> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Traza de combustible por máquina (vista previa + PDF) */}
      <Modal visible={!!fuelFor} animationType="slide" onRequestClose={() => setFuelFor(null)}>
        <Screen>
          {fuelFor ? (
            <>
              <TouchableOpacity onPress={() => setFuelFor(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm }}>
                <Text style={{ color: colors.brandText, fontSize: 20, fontWeight: '800' }}>←</Text>
                <Text style={{ color: colors.brandText, fontWeight: '700' }}>Volver</Text>
              </TouchableOpacity>
              <SectionTitle>⛽ Combustible · {fuelFor.code}</SectionTitle>
              {fuelLoading ? (
                <Loading />
              ) : (
                <>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <View style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>Última vez surtida</Text>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{fuelLast ?? '—'}</Text>
                    </View>
                    <View style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>Total surtido</Text>
                      <Text style={{ color: colors.success, fontWeight: '800', fontSize: 18, fontVariant: ['tabular-nums'] as any }}>{fuelSurtido.toLocaleString()} L</Text>
                    </View>
                    <View style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>Consumo estimado</Text>
                      <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 18, fontVariant: ['tabular-nums'] as any }}>{fuelConsumed != null ? `${fuelConsumed.toLocaleString()} L` : '—'}</Text>
                    </View>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
                    Consumo estimado = {fuelWorked.toLocaleString()} h trabajadas × {fuelFor.expected_lph != null ? `${Number(fuelFor.expected_lph).toLocaleString()} L/h` : 'sin rendimiento (defínelo al editar la máquina)'}
                  </Text>

                  {/* Consumo REAL por horómetro: litros ÷ horas operadas. */}
                  <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.sm, borderLeftWidth: 3, borderLeftColor: colors.brand }}>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>Consumo por horómetro (real)</Text>
                    <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 18, fontVariant: ['tabular-nums'] as any }}>{fuelPerHour != null ? `${fuelPerHour.toLocaleString()} L/h` : '—'}</Text>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>
                      {fuelSurtido.toLocaleString()} L ÷ {fuelWorked.toLocaleString()} h operadas{fuelFor.last_horometro != null ? ` · Último horómetro: ${fuelFor.last_horometro}` : ''}
                    </Text>
                  </View>

                  <Text style={{ color: colors.text, fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.xs }}>Traza de surtidos</Text>
                  {fuelTrace.length === 0 ? (
                    <EmptyState title="Sin surtidos" subtitle="Cuando registres un consumo/despacho a esta máquina, aparecerá aquí." />
                  ) : (
                    fuelTrace.map((t, i) => (
                      <Card key={i}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Text style={{ color: colors.text, fontWeight: '700' }}>{t.date}</Text>
                          <Text style={{ color: colors.success, fontWeight: '800' }}>{t.liters.toLocaleString()} L</Text>
                        </View>
                        {t.tank ? <Text style={{ color: colors.muted, fontSize: 12 }}>Tanque: {t.tank}</Text> : null}
                        {t.km && t.gasto ? (
                          <Text style={{ color: colors.success, fontSize: 12, fontWeight: '700', marginTop: 2 }}>
                            Ruta: {t.km.toLocaleString()} km · {t.gasto.toLocaleString()} L · {(t.km / t.gasto).toLocaleString(undefined, { maximumFractionDigits: 2 })} km/L
                          </Text>
                        ) : null}
                      </Card>
                    ))
                  )}

                  <TouchableOpacity style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.success }} onPress={abrirRegistro}>
                    <Text style={{ color: '#fff', fontWeight: '800' }}>➕ Registrar surtido</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.brand }} onPress={downloadFuelPdf}>
                    <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>⬇️ Descargar PDF</Text>
                  </TouchableOpacity>
                </>
              )}
              <TouchableOpacity style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setFuelFor(null)}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Volver</Text>
              </TouchableOpacity>

              {/* Formulario para registrar un surtido a esta máquina */}
              <Modal visible={regOpen} transparent animationType="fade" onRequestClose={() => setRegOpen(false)}>
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
                  <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16, marginBottom: spacing.sm }}>➕ Registrar surtido · {fuelFor.code}</Text>

                    <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Fecha</Text>
                    <DateField value={regDate} onChange={setRegDate} />

                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Litros</Text>
                    <TextInput
                      value={regLiters}
                      onChangeText={(t) => setRegLiters(onlyDecimal(t))}
                      keyboardType="numeric"
                      inputMode="decimal"
                      placeholder="0"
                      placeholderTextColor={colors.muted}
                      style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, backgroundColor: colors.surface }}
                    />

                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Tanque de origen</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                      {tanks.length === 0 ? (
                        <Text style={{ color: colors.warning, fontSize: 12 }}>No hay tanques registrados.</Text>
                      ) : tanks.map((tk) => {
                        const on = regTank === tk.id;
                        return (
                          <TouchableOpacity key={tk.id} onPress={() => setRegTank(tk.id)}
                            style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt }}>
                            <Text style={{ color: on ? colors.brandContrast : colors.text, fontSize: 13 }}>{tk.name}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Conductor / Operador (opcional)</Text>
                    <TextInput
                      value={regOperator}
                      onChangeText={setRegOperator}
                      placeholder="Nombre"
                      placeholderTextColor={colors.muted}
                      autoCapitalize="words"
                      style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, backgroundColor: colors.surface }}
                    />

                    {/* Recorrido de la ruta (KM ida/vuelta) y combustible inicial/final */}
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, marginTop: spacing.md }}>Recorrido de la ruta (opcional)</Text>
                    <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 4 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>KM ida</Text>
                        <TextInput value={regKmIda} onChangeText={(t) => setRegKmIda(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted}
                          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, backgroundColor: colors.surface }} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>KM vuelta</Text>
                        <TextInput value={regKmVuelta} onChangeText={(t) => setRegKmVuelta(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted}
                          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, backgroundColor: colors.surface }} />
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Combustible inicial (L)</Text>
                        <TextInput value={regFuelStart} onChangeText={(t) => setRegFuelStart(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted}
                          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, backgroundColor: colors.surface }} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Combustible final (L)</Text>
                        <TextInput value={regFuelEnd} onChangeText={(t) => setRegFuelEnd(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted}
                          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, backgroundColor: colors.surface }} />
                      </View>
                    </View>
                    {(() => {
                      const km = (num(regKmIda) ?? 0) + (num(regKmVuelta) ?? 0);
                      const gasto = (num(regFuelStart) ?? 0) - (num(regFuelEnd) ?? 0);
                      if (km > 0 && gasto > 0) {
                        return <Text style={{ color: colors.success, fontSize: 12, fontWeight: '700', marginTop: 6 }}>Rendimiento de la ruta: {(km / gasto).toLocaleString(undefined, { maximumFractionDigits: 2 })} km/L  ·  {km.toLocaleString()} km · {gasto.toLocaleString()} L</Text>;
                      }
                      return null;
                    })()}
                    {fuelFor.daily_consumption_l != null && Number(fuelFor.daily_consumption_l) > 0 ? (
                      <Text style={{ color: colors.muted, fontSize: 11, marginTop: 6 }}>Consumo diario: {Number(fuelFor.daily_consumption_l).toLocaleString()} L · tope de surtido: {(Number(fuelFor.daily_consumption_l) * 2).toLocaleString()} L (2×)</Text>
                    ) : null}

                    <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                      <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setRegOpen(false)} disabled={regSaving}>
                        <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.success }} onPress={registrarSurtido} disabled={regSaving}>
                        <Text style={{ color: '#fff', fontWeight: '800' }}>{regSaving ? 'Guardando…' : 'Guardar surtido'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </Modal>
            </>
          ) : null}
        </Screen>
      </Modal>

      {/* Selector de tipo al agregar / cargar lote (vehículo o maquinaria) */}
      <Modal visible={!!kindChooser} transparent animationType="fade" onRequestClose={() => setKindChooser(null)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setKindChooser(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17, marginBottom: spacing.xs, textAlign: 'center' }}>
              {kindChooser === 'batch' ? '¿Qué cargas por lote?' : '¿Qué deseas agregar?'}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.md, textAlign: 'center' }}>Elige el tipo de equipo.</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {KINDS.map((k) => (
                <TouchableOpacity
                  key={k.value}
                  onPress={() => {
                    const action = kindChooser;
                    setKind(k.value);
                    setKindChooser(null);
                    if (action === 'add') { setEditing(null); setFormOpen(true); }
                    else { setBatchError(null); setBatchOpen(true); }
                  }}
                  style={{ flex: 1, minHeight: 96, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: spacing.md }}
                >
                  <Text style={{ fontSize: 34 }}>{k.icon}</Text>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 15 }}>{k.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Detalle de maquinaria activa / inactiva */}
      <Modal visible={!!detailStatus} animationType="slide" onRequestClose={() => setDetailStatus(null)}>
        <Screen>
          <TouchableOpacity onPress={() => setDetailStatus(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm }}>
            <Text style={{ color: colors.brandText, fontSize: 20, fontWeight: '800' }}>←</Text>
            <Text style={{ color: colors.brandText, fontWeight: '700' }}>Volver</Text>
          </TouchableOpacity>
          <SectionTitle>
            {detailTitle}{'  '}({detailNq ? `${detailFiltered.length}/${detailList.length}` : detailList.length})
          </SectionTitle>
          {/* Buscador por TODAS las características (código, placa, serial, encargado,
              empresa, edificio, tipo, clasificación, parroquia, sector…). */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginBottom: spacing.sm }}>
            <Text style={{ fontSize: 14 }}>🔎</Text>
            <TextInput value={detailQuery} onChangeText={setDetailQuery} placeholder="Buscar: código, placa, serial, encargado, empresa, edificio…" placeholderTextColor={colors.muted} style={{ flex: 1, color: colors.text, fontSize: 13, paddingVertical: 8 }} />
            {detailQuery ? <TouchableOpacity onPress={() => setDetailQuery('')}><Text style={{ color: colors.muted, fontWeight: '800' }}>✕</Text></TouchableOpacity> : null}
          </View>
          {detailList.length === 0 ? (
            <EmptyState title="Sin máquinas" subtitle={detailStatus === 'active' ? 'No hay maquinaria operativa.' : detailStatus === 'espera' ? 'No hay maquinaria en espera.' : 'No hay maquinaria inactiva.'} />
          ) : detailFiltered.length === 0 ? (
            <EmptyState title="Sin coincidencias" subtitle={`No hay máquinas que coincidan con "${detailQuery.trim()}".`} />
          ) : (
            <ScrollView>
              {groupByCompany(detailFiltered).map((g) => {
                // Las INACTIVAS arrancan COLAPSADAS (solo se abren si el usuario toca);
                // activas y en espera siguen abiertas por defecto. Al BUSCAR, los grupos
                // arrancan abiertos para ver los resultados, PERO si el usuario toca para
                // colapsar/expandir su elección manda (por eso el ?? va primero, no un
                // `detailNq ? true` que ignoraba el toque y no dejaba colapsar al buscar).
                const open = detailExpanded[g.key] ?? (detailNq ? true : (detailStatus !== 'inactive'));
                return (
                <View key={g.key} style={{ marginBottom: spacing.xs }}>
                  <TouchableOpacity onPress={() => setDetailExpanded((p) => ({ ...p, [g.key]: !open }))} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: open ? colors.brand : colors.surfaceAlt, borderWidth: 1, borderColor: open ? colors.brand : colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 }}>
                      <Text style={{ color: open ? colors.brandContrast : colors.muted, fontSize: 16 }}>{open ? '▾' : '▸'}</Text>
                      <Text style={{ color: open ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>🏢 {g.name}</Text>
                    </View>
                    <View style={{ backgroundColor: open ? colors.brandContrast : colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
                      <Text style={{ color: open ? colors.brand : colors.brandContrast, fontWeight: '800', fontSize: 13 }}>{g.items.length}</Text>
                    </View>
                  </TouchableOpacity>
                  {open ? (
                    <View style={{ marginTop: spacing.sm }}>
                      {g.items.slice().sort((a, b) => cmpText(a.code, b.code)).map((m) => (
                  <Card key={m.id}>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => { setDetailStatus(null); setKind('maquinaria'); openEdit(m); }}
                    >
                      <View style={{ flexDirection: 'row', gap: spacing.md }}>
                        {/* Miniatura → abre el visor con AMBAS fotos (máquina + serial/placa),
                            igual que en las máquinas activas — antes solo se veía entrando a la ficha. */}
                        <TouchableOpacity onPress={() => setViewerId(m.id)} activeOpacity={0.7} style={{ width: 64, height: 64 }}>
                          {m.photo_url ? (
                            <Thumb uri={m.photo_url} size={64} radius={radius.md} />
                          ) : (
                            <View style={{ width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                              <Text style={{ fontSize: 28 }}>🚜</Text>
                            </View>
                          )}
                          {m.photo_serial_url ? (
                            <View style={{ position: 'absolute', right: -4, bottom: -4, backgroundColor: colors.brand, borderRadius: radius.pill, width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface }}>
                              <Text style={{ fontSize: 11 }}>🔖</Text>
                            </View>
                          ) : null}
                        </TouchableOpacity>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16, flex: 1 }}>{m.code}</Text>
                            <Text style={{ color: m.en_espera ? colors.warning : m.operational ? colors.success : colors.danger, fontWeight: '700', fontSize: 13 }}>
                              {m.en_espera ? '🕓 En espera' : m.operational ? '● Operativa' : '● No operativa'}
                            </Text>
                          </View>
                          <EstadoFechaLine m={m} />
                          <AveriaBadge id={m.id} />
                          {m.identifier ? <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>🆔 {m.identifier}</Text> : null}
                          {m.company_id ? <Text style={{ color: colors.muted, fontSize: 12 }}>🏢 {companyName(m.company_id)}</Text> : null}
                          {m.encargado ? <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>👤 Encargado: {m.encargado}</Text> : null}
                          {(m as any).parroquia || (m as any).sector ? <Text style={{ color: colors.muted, fontSize: 12 }}>📍 {[(m as any).parroquia, (m as any).sector].filter(Boolean).join(' · ')}</Text> : null}
                          {(m as any).referencia ? (
                            <Text style={{ color: colors.muted, fontSize: 12 }}>
                              🏗️ {edificioCanonico((m as any).referencia) || 'Sin edificio identificado'} · Ref: {(m as any).referencia}
                            </Text>
                          ) : null}
                          {inspectors[m.id] ? <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>🪖 Inspector: {inspectors[m.id].name}</Text> : null}
                          {m.plate ? <Text style={{ color: colors.muted, fontSize: 12 }}>Placa: {m.plate}</Text> : null}
                          {m.serial ? <Text style={{ color: colors.muted, fontSize: 12 }}>Serial: {m.serial}</Text> : null}
                        </View>
                      </View>
                    </TouchableOpacity>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
                      <BigBtn label={busy === m.id + '-photo' ? 'Subiendo…' : '📷 Foto máquina'} onPress={() => photo(m)} color={colors.brand} textColor={colors.brandContrast} disabled={busy === m.id + '-photo'} />
                      <BigBtn label={busy === m.id + '-photoser' ? 'Subiendo…' : '🔖 Foto serial/placa'} onPress={() => photoSerial(m)} color={colors.brand} textColor={colors.brandContrast} disabled={busy === m.id + '-photoser'} />
                    </View>
                    {detailStatus === 'espera' ? (
                      <TouchableOpacity
                        onPress={() => toggleEspera(m)}
                        disabled={busy === m.id + '-esp'}
                        style={{ marginTop: spacing.sm, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.success, opacity: busy === m.id + '-esp' ? 0.6 : 1 }}
                      >
                        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>
                          {busy === m.id + '-esp' ? 'Guardando…' : '📥 Quitar de espera (recibir)'}
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        onPress={() => toggleOp(m)}
                        disabled={busy === m.id + '-op'}
                        style={{ marginTop: spacing.sm, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: m.operational ? colors.danger : colors.success, opacity: busy === m.id + '-op' ? 0.6 : 1 }}
                      >
                        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>
                          {busy === m.id + '-op' ? 'Guardando…' : m.operational ? '⛔ Poner No operativa' : '✅ Activar (Operativa)'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </Card>
                      ))}
                    </View>
                  ) : null}
                </View>
                );
              })}
            </ScrollView>
          )}
          <TouchableOpacity style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setDetailStatus(null)}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>Volver</Text>
          </TouchableOpacity>
        </Screen>
      </Modal>

      {/* Reportes de maquinaria (por empresa / general) con vista previa */}
      <Modal visible={reportOpen} animationType="slide" onRequestClose={() => setReportOpen(false)}>
        <Screen>
          <TouchableOpacity onPress={() => setReportOpen(false)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm }}>
            <Text style={{ color: colors.brandText, fontSize: 20, fontWeight: '800' }}>←</Text>
            <Text style={{ color: colors.brandText, fontWeight: '700' }}>Volver</Text>
          </TouchableOpacity>
          <SectionTitle>📄 Reportes de maquinaria</SectionTitle>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>Elige el alcance del reporte</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
            {companyOptions
              .map((o) => ({ ...o, label: o.value === '__all__' ? 'General (todas)' : o.label }))
              .map((o) => {
                const active = reportCompany === o.value;
                return (
                  <TouchableOpacity
                    key={o.value}
                    onPress={() => setReportCompany(o.value)}
                    style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: active ? colors.brand : colors.border, backgroundColor: active ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                  >
                    <Text style={{ color: active ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{o.label}</Text>
                    <Text style={{ color: active ? colors.brandContrast : colors.muted, fontSize: 12 }}>({o.count})</Text>
                  </TouchableOpacity>
                );
              })}
          </View>

          {/* Filtro por TIPO de equipo: LISTA DESPLEGABLE con buscador y casillas. */}
          {reportTypeOptions.length > 0 ? (
            <View style={{ marginBottom: spacing.sm }}>
              <TouchableOpacity
                onPress={() => setReportFilterOpen((v) => !v)}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}
              >
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>
                  🔎 Filtrar por clasificación{reportTypes.size > 0 ? ` (${reportTypes.size})` : ' (todas)'}
                </Text>
                <Text style={{ color: colors.brandText, fontWeight: '800' }}>{reportFilterOpen ? '▲' : '▼'}</Text>
              </TouchableOpacity>
              {reportFilterOpen ? (
                <View style={{ borderWidth: 1, borderTopWidth: 0, borderColor: colors.border, borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md, padding: spacing.sm }}>
                  <TextInput
                    value={reportTypeQ}
                    onChangeText={setReportTypeQ}
                    placeholder="🔎 Buscar clasificación (ej. excavación, remoción, volteo)…"
                    placeholderTextColor={colors.muted}
                    style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, marginBottom: spacing.xs }}
                  />
                  {reportTypes.size > 0 ? (
                    <TouchableOpacity onPress={() => setReportTypes(new Set())} style={{ alignSelf: 'flex-start', marginBottom: spacing.xs }}>
                      <Text style={{ color: colors.brandText, fontSize: 12, fontWeight: '700' }}>✕ Limpiar selección ({reportTypes.size})</Text>
                    </TouchableOpacity>
                  ) : null}
                  {(() => {
                    const nq = norm(reportTypeQ.trim());
                    const shown = nq ? reportTypeOptions.filter((o) => norm(o.tipo).includes(nq)) : reportTypeOptions;
                    if (shown.length === 0) return <Text style={{ color: colors.muted, fontSize: 13, paddingVertical: spacing.xs }}>Sin coincidencias.</Text>;
                    return (
                      <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled>
                        {shown.map((o) => {
                          const on = reportTypes.has(o.key);
                          return (
                            <TouchableOpacity
                              key={o.key}
                              onPress={() => toggleReportType(o.key)}
                              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border }}
                            >
                              <View style={{ width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                                {on ? <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 13 }}>✓</Text> : null}
                              </View>
                              <Text style={{ color: colors.text, fontSize: 13, flex: 1 }} numberOfLines={1}>{o.tipo}</Text>
                              <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '700' }}>{o.count}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    );
                  })()}
                </View>
              ) : null}
            </View>
          ) : null}

          <TouchableOpacity
            style={{ padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.brand, opacity: reportTotal === 0 ? 0.5 : 1, marginBottom: spacing.sm }}
            onPress={() => downloadReportPdf(reportCompany)}
            disabled={reportTotal === 0}
          >
            <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>⬇️ Descargar PDF (conteo)</Text>
          </TouchableOpacity>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>{reportTitle}</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>{reportTotal} equipo(s)</Text>
          </View>

          <ScrollView style={{ flex: 1 }}>
            {reportTotal === 0 ? (
              <EmptyState title="Sin equipos" subtitle="No hay equipos para este alcance/filtro." />
            ) : (
              <>
                {/* 1) Total general */}
                <View style={{ backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, marginBottom: spacing.sm }}>
                  <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 16, textAlign: 'right', fontVariant: ['tabular-nums'] as any }}>Total general de equipos: {reportTotal}</Text>
                </View>

                {/* 2) Por empresa (resumen) */}
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, marginBottom: 2 }}>Por empresa</Text>
                {reportData.empresas.map((c) => (
                  <View key={`res-${c.name}`} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                    <Text style={{ color: colors.text, fontSize: 13 }}>🏢 {c.name}</Text>
                    <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{c.items.length}</Text>
                  </View>
                ))}

                {/* 3) Detalle por empresa: datos reales de cada equipo (clasificación, serial/placa,
                     sector, edificio/referencia, inspector día/noche, estado). */}
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, marginTop: spacing.md, marginBottom: 2 }}>Detalle por empresa</Text>
                {reportData.empresas.map((c) => (
                  <View key={`det-${c.name}`} style={{ marginBottom: spacing.sm }}>
                    <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13, textTransform: 'uppercase', backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 3 }}>🏢 {c.name} — {c.items.length}</Text>
                    {c.items.map((m, i) => {
                      const insp = inspByShift[m.id];
                      return (
                        <View key={m.id} style={{ borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 5, paddingLeft: spacing.sm }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                            <Text style={{ color: colors.muted, fontSize: 11, width: 22 }}>{i + 1}.</Text>
                            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700', flex: 1 }} numberOfLines={1}>{repTipoLabel(m)}</Text>
                            <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>{m.serial || m.plate || '—'}</Text>
                            <Text style={{ color: estadoColor(m), fontSize: 11, fontWeight: '700' }}>{estadoTxt(m)}</Text>
                          </View>
                          <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2, paddingLeft: 22 + spacing.sm }} numberOfLines={2}>
                            🏷️ {repClasifLabel(m)} · 📍 {(m as any).sector || 'Sin sector'} · 🏗️ {edificioOrRef(m)}
                          </Text>
                          <Text style={{ color: colors.muted, fontSize: 11, marginTop: 1, paddingLeft: 22 + spacing.sm }} numberOfLines={1}>
                            ☀️ {insp?.day || 'Sin inspector día'} · 🌙 {insp?.night || 'Sin inspector noche'}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                ))}
              </>
            )}
          </ScrollView>

          <TouchableOpacity style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setReportOpen(false)}>
            <Text style={{ color: colors.text, fontWeight: '700' }}>Volver</Text>
          </TouchableOpacity>
        </Screen>
      </Modal>

      <RecordForm
        visible={formOpen}
        title={editing ? `Editar ${kindMeta.label.toLowerCase()}` : `Nuevo: ${kindMeta.label}`}
        table={isVehicle ? 'vehicles' : 'machinery'}
        fields={isVehicle ? VEHICLE_FIELDS : [...MACHINERY_FIELDS, ...VIAJES_FIELDS]}
        fixedValues={isVehicle ? undefined : { machinery_type: kind }}
        uniqueField={isVehicle ? undefined : [
          { key: 'serial', labelCol: 'code', labelName: 'serial' },
          { key: 'plate', labelCol: 'code', labelName: 'placa' },
        ]}
        record={editing}
        headerImageUrl={isVehicle ? undefined : editing?.photo_url}
        allowDelete
        onClose={() => setFormOpen(false)}
        onSaved={handleSaved}
      />

      {/* SOLO supervisores: vista de la máquina (iniciar jornada) sin escanear el QR. */}
      <Modal visible={!!jornadaFor} animationType="slide" onRequestClose={() => setJornadaFor(null)}>
        {jornadaFor ? (
          <MachineQuickScreen machineId={jornadaFor.id} onExit={() => setJornadaFor(null)} />
        ) : null}
      </Modal>
    </Screen>
  );
}
