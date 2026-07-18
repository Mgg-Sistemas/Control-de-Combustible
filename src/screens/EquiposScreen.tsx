import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Image, Modal, TextInput, ScrollView, Alert, Platform } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { RecordForm, Field } from '../components/RecordForm';
import { DateField } from '../components/DateField';
import { useTable } from '../hooks/useTable';
import { supabase, selectAllRows } from '../lib/supabase';
import { captureLocation, warmLocation } from '../lib/location';
import { pickAndUploadPhoto } from '../lib/photo';
import { elapsedSince } from '../lib/time';
import { formatUTM } from '../lib/utm';
import { norm, onlyDecimal } from '../lib/text';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { workedFromShifts } from './ControlMaquinariaScreen';
import { machineQrUrl, qrSvg } from '../lib/qr';
import QrImage from '../components/QrImage';
import { GuardButton } from '../components/GuardButton';
import { fetchActiveGuards } from '../lib/guards';
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

const MACHINERY_FIELDS: Field[] = [
  { key: 'code', label: 'Código / Nombre', type: 'text', required: true },
  { key: 'tipo', label: 'Modelo (CAT 320, Komatsu PC200...)', type: 'text' },
  { key: 'clasificacion', label: 'Clasificación (elige una o escribe nueva)', type: 'suggest', table: 'machinery', column: 'clasificacion' },
  { key: 'referencia', label: 'Referencia / Ubicación', type: 'text' },
  { key: 'identifier', label: 'Identificador', type: 'text' },
  { key: 'plate', label: 'Placa', type: 'text' },
  { key: 'serial', label: 'Serial', type: 'text' },
  { key: 'company_id', label: 'Empresa supervisora', type: 'lookup', table: 'companies', labelCol: 'name', createColumn: 'name', filter: { hidden: false } },
  { key: 'grupo', label: 'Grupo', type: 'text' },
  { key: 'encargado', label: 'Encargado', type: 'text' },
  { key: 'zona', label: 'A disposición de (Gobernación, FANB, CVM… o vacío si es propia)', type: 'suggest', table: 'machinery', column: 'zona' },
  { key: 'expected_lph', label: 'Rendimiento (L/h)', type: 'number' },
  { key: 'daily_consumption_l', label: 'Consumo diario (L) — tope surtido 2×', type: 'number' },
];
// Campos de VIAJES: disponibles para TODAS las máquinas. El nº de viajes × precio
// por viaje se suma al subtotal del informe por jornada de la empresa de la máquina,
// y queda vinculado a la máquina para su próximo viaje.
const VIAJES_FIELDS: Field[] = [
  { key: 'viajes', label: '🚚 Viajes realizados', type: 'number' },
  { key: 'precio_viaje', label: '🚚 Precio por viaje ($)', type: 'number' },
];

export default function EquiposScreen({ navigation, route }: any) {
  const { colors } = useTheme();
  const [kind, setKind] = useState<Kind>('vehiculo');

  const vehicles = useTable<Vehicle>('vehicles', { orderBy: 'plate', ascending: true });
  const machinery = useTable<Machinery>('machinery', { orderBy: 'code', ascending: true });
  const companies = useTable<Company>('companies');
  const [query, setQuery] = useState('');
  const [companyFilter, setCompanyFilter] = useState<string>('__all__'); // '__all__' | '__none__' | company id
  const [companyPickerOpen, setCompanyPickerOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>('__all__'); // '__all__' | valor | '__none__'
  const [catDim, setCatDim] = useState<GroupDim>('clasificacion'); // agrupar el catálogo por Clasificación (por defecto; Modelo genera demasiados chips)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({}); // empresa → desplegada

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
  useEffect(() => {
    const ids = machinery.data.map((m) => m.id);
    if (ids.length === 0) { setGuards({}); return; }
    fetchActiveGuards(ids).then(setGuards).catch(() => {});
  }, [machinery.data]);
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
  const machineryList = machinery.data.filter(
    (m) => matchCompany(m) && matchType(m) && matchQ([m.code, m.description, m.plate, m.serial, m.identifier, m.grupo, m.encargado, m.tipo, m.clasificacion, companyName(m.company_id)])
  );
  // Opciones del filtro por la dimensión activa (Modelo/Clasificación), con conteo.
  const typeOptions = useMemo(() => {
    const c = new Map<string, number>();
    machinery.data.filter(matchCompany).forEach((m) => {
      const t = canonDim(m, catDim) || '__none__';
      c.set(t, (c.get(t) ?? 0) + 1);
    });
    const entries = Array.from(c.entries()).sort((a, b) =>
      a[0] === '__none__' ? 1 : b[0] === '__none__' ? -1 : a[0].localeCompare(b[0])
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

  // Reportes de maquinaria (por empresa o general) con vista previa.
  const [reportOpen, setReportOpen] = useState(false);
  const [reportWithPrices, setReportWithPrices] = useState(true); // con $ / sin $
  const [reportCompany, setReportCompany] = useState<string>('__all__'); // '__all__' | '__none__' | company id
  const [reportDim] = useState<GroupDim>('clasificacion'); // el reporte se agrupa siempre por Clasificación
  const [reportTypes, setReportTypes] = useState<Set<string>>(new Set()); // valores seleccionados (vacío = todos)
  const toggleReportType = (t: string) =>
    setReportTypes((prev) => {
      const n = new Set(prev);
      n.has(t) ? n.delete(t) : n.add(t);
      return n;
    });

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
  const photo = (m: Machinery) => run(m.id + '-photo', () => pickAndUploadPhoto(m.id));
  const toggleOp = (m: Machinery) =>
    run(m.id + '-op', async () => {
      const { error } = await supabase.from('machinery').update({ operational: !m.operational }).eq('id', m.id);
      return { ok: !error, error: error?.message };
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
  useEffect(() => {
    supabase.from('tanks').select('id, name, fuel').order('name').then(({ data }) => {
      setTanks((data ?? []) as { id: string; name: string; fuel: string }[]);
    });
  }, []);

  // Fecha de hoy en ISO (para el valor por defecto del calendario).
  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
  };

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
    if (!isFinite(liters) || liters <= 0) return Alert.alert('Aviso', 'Ingresa los litros surtidos (mayor a 0).');
    if (!regTank) return Alert.alert('Aviso', 'Selecciona el tanque de origen.');
    if (!regDate) return Alert.alert('Aviso', 'Selecciona la fecha.');
    // Tope: no se puede solicitar más de 2× el consumo diario de la máquina.
    const diario = fuelFor.daily_consumption_l != null ? Number(fuelFor.daily_consumption_l) : null;
    if (diario != null && diario > 0 && liters > diario * 2) {
      return Alert.alert('Límite de surtido', `Esta máquina consume ${diario.toLocaleString()} L/día. No se puede surtir más de ${(diario * 2).toLocaleString()} L (2× el consumo diario).`);
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
    if (error) return Alert.alert('Aviso', error.message);
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
    if (error) return Alert.alert('Aviso', error.message);
    setQrFor({ ...(qrFor as any), qr_blocked: next });
    machinery.refetch();
    Alert.alert('QR ' + (next ? 'bloqueado' : 'desbloqueado'), next
      ? 'Al escanear este QR ahora solo se muestra el logo. Nadie podrá registrar con él.'
      : 'El QR vuelve a funcionar normalmente.');
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
        <div class="sub">🏢 ${qrFor.company_id ? (companyName(qrFor.company_id) || 'Sin empresa') : 'Sin empresa'}</div>
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
    const ofKind = machinery.data;
    const countFor = (id: string) => ofKind.filter((m) => m.company_id === id).length;
    return [
      { label: 'Todas las empresas', value: '__all__', count: ofKind.length },
      ...companies.data
        .filter((c) => !(c as any).hidden) // ocultar empresas marcadas como ocultas (p. ej. HBS)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ label: c.name, value: c.id, count: countFor(c.id) })),
      { label: 'Sin empresa', value: '__none__', count: ofKind.filter((m) => !m.company_id).length },
    ];
  }, [companies.data, machinery.data]);
  const companyFilterLabel = companyOptions.find((o) => o.value === companyFilter)?.label ?? 'Todas las empresas';

  // Agrupar la maquinaria por empresa (para el catálogo en acordeón).
  // Catálogo agrupado por EMPRESA (acordeón).
  const machineryByCompany = useMemo(() => {
    const m = new Map<string, { key: string; name: string; items: Machinery[] }>();
    machineryList.forEach((it) => {
      const k = it.company_id ?? '__none__';
      const name = it.company_id ? companyName(it.company_id) || 'Empresa' : 'Sin empresa';
      const g = m.get(k) ?? { key: k, name, items: [] };
      g.items.push(it);
      m.set(k, g);
    });
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [machineryList, companyName]);

  // Grupos para el REPORTE (por EMPRESA) según el alcance elegido.
  const groupsForScope = (scope: string) => {
    const srcAll =
      scope === '__all__'
        ? machinery.data
        : scope === '__none__'
        ? machinery.data.filter((m) => !m.company_id)
        : machinery.data.filter((m) => m.company_id === scope);
    // Filtro por valores seleccionados de la dimensión activa (vacío = todos).
    const sinLabel = `Sin ${DIM_LABEL[reportDim].toLowerCase()}`;
    const src = reportTypes.size === 0
      ? srcAll
      : srcAll.filter((m) => reportTypes.has(canonDim(m, reportDim) || sinLabel));
    const m = new Map<string, { key: string; name: string; items: Machinery[] }>();
    src.forEach((it) => {
      const k = it.company_id ?? '__none__';
      const name = it.company_id ? companyName(it.company_id) || 'Empresa' : 'Sin empresa';
      const g = m.get(k) ?? { key: k, name, items: [] };
      g.items.push(it);
      m.set(k, g);
    });
    const groups = Array.from(m.values());
    // Alfabético por nombre de máquina (antes por identificador), acentos/mayúsculas indiferentes.
    groups.forEach((g) =>
      g.items.sort((a, b) =>
        a.code.localeCompare(b.code, 'es', { sensitivity: 'base' }) ||
        String(a.serial ?? '').localeCompare(String(b.serial ?? ''), 'es', { sensitivity: 'base' })
      )
    );
    return groups.sort((a, b) =>
      a.name === 'Sin empresa' ? 1 : b.name === 'Sin empresa' ? -1 : a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
    );
  };
  const reportGroups = useMemo(() => groupsForScope(reportCompany), [reportCompany, reportTypes, reportDim, machinery.data, companyName]);
  // Valores disponibles de la dimensión activa en el alcance elegido (con conteo), para el checklist.
  const reportTypeOptions = useMemo(() => {
    const srcAll =
      reportCompany === '__all__'
        ? machinery.data
        : reportCompany === '__none__'
        ? machinery.data.filter((m) => !m.company_id)
        : machinery.data.filter((m) => m.company_id === reportCompany);
    const sinLabel = `Sin ${DIM_LABEL[reportDim].toLowerCase()}`;
    const c = new Map<string, number>();
    srcAll.forEach((m) => {
      const t = canonDim(m, reportDim) || sinLabel;
      c.set(t, (c.get(t) ?? 0) + 1);
    });
    return Array.from(c.entries())
      .map(([tipo, count]) => ({ tipo, count }))
      .sort((a, b) => (a.tipo === sinLabel ? 1 : b.tipo === sinLabel ? -1 : a.tipo.localeCompare(b.tipo)));
  }, [reportCompany, reportDim, machinery.data]);
  // Subgrupos por la dimensión activa dentro de un conjunto, con "Sin …" al final.
  const tiposOf = (items: Machinery[]): [string, Machinery[]][] => {
    const sinLabel = `Sin ${DIM_LABEL[reportDim].toLowerCase()}`;
    const c = new Map<string, Machinery[]>();
    items.forEach((it) => {
      const t = canonDim(it, reportDim) || sinLabel;
      if (!c.has(t)) c.set(t, []);
      c.get(t)!.push(it);
    });
    return Array.from(c.entries()).sort((a, b) =>
      a[0] === sinLabel ? 1 : b[0] === sinLabel ? -1 : a[0].localeCompare(b[0])
    );
  };
  const reportTotal = reportGroups.reduce((s, g) => s + g.items.length, 0);
  const titleForScope = (scope: string) =>
    scope === '__all__' ? 'Reporte general de maquinaria' : `Reporte de maquinaria — ${companyName(scope) || 'Sin empresa'}`;
  const reportTitle = titleForScope(reportCompany);

  const buildReportHtml = (scope: string, withPrices: boolean = true) => {
    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const groups = groupsForScope(scope);
    const total = groups.reduce((s, g) => s + g.items.length, 0);
    let item = 0; // contador continuo de ítems (1..N) en todo el reporte
    let grandHours = 0;
    let grandAmount = 0;
    const workedOf = (m: Machinery) => hoursByMachine[m.id] ?? 0;
    const amountOf = (m: Machinery) => (workedOf(m) / 12) * (m.price_per_hour != null ? Number(m.price_per_hour) : 0);
    const sections = groups
      .map((g) => {
        let gHours = 0;
        let gAmount = 0;
        const tipoBlocks = tiposOf(g.items)
          .map(([tipo, items]) => {
            let tHours = 0;
            let tAmount = 0;
            const rows = items
              .map((m) => {
                item += 1;
                const worked = workedOf(m);
                const amount = amountOf(m);
                tHours += worked; tAmount += amount;
                const gd = guards[m.id];
                const guardTxt = gd ? `${gd.rank ? gd.rank + ' ' : ''}${gd.guard_name}` : '—';
                return `<tr>
                  <td style="text-align:center;font-weight:700">${item}</td>
                  <td>${esc(m.identifier || '—')}</td>
                  <td>${esc(m.code)}</td>
                  <td>${esc(m.plate || '—')}</td>
                  <td>${esc(m.serial || '—')}</td>
                  <td>${esc((m as any).referencia || '—')}</td>
                  <td>${esc(m.encargado || '—')}</td>
                  <td>🪖 ${esc(guardTxt)}</td>
                  <td>${esc(m.grupo || '—')}</td>
                  <td style="color:${m.en_espera ? '#B45309' : m.operational ? '#15803D' : '#B91C1C'}">${m.en_espera ? 'En espera' : m.operational ? 'Operativa' : 'No operativa'}</td>
                  <td style="text-align:center;font-weight:700">${worked} h</td>
                  ${withPrices ? `<td style="text-align:right;font-weight:700">${amount ? '$' + money(amount) : '—'}</td>` : ''}
                </tr>`;
              })
              .join('');
            gHours += tHours; gAmount += tAmount;
            return `<h3 class="tipo">${esc(tipo.toUpperCase())} — TOTAL ${items.length}</h3>
              <table><thead><tr><th>Ítem</th><th>ID</th><th>Máquina</th><th>Placa</th><th>Serial</th><th>Referencia</th><th>Encargado</th><th>Guardia</th><th>Grupo</th><th>Estado</th><th>Horas ≤05/07</th>${withPrices ? '<th>Total $</th>' : ''}</tr></thead>
              <tbody>${rows}</tbody>
              <tfoot><tr><td colspan="10" style="text-align:right;font-weight:800">Subtotal ${esc(tipo.toUpperCase())}</td><td style="text-align:center;font-weight:800">${tHours} h</td>${withPrices ? `<td style="text-align:right;font-weight:800">$${money(tAmount)}</td>` : ''}</tr></tfoot></table>`;
          })
          .join('');
        grandHours += gHours; grandAmount += gAmount;
        return `<h2>🏢 ${esc(g.name.toUpperCase())} <span style="color:#666;font-weight:400">(${g.items.length} máquina${g.items.length === 1 ? '' : 's'})</span></h2>
          ${tipoBlocks}
          <div class="subtotal">Total ${esc(g.name)}: ${g.items.length} máquina(s) · ${gHours} h${withPrices ? ` · $${money(gAmount)}` : ''}</div>`;
      })
      .join('');
    const tipoFilterNote = ` · Agrupado por ${DIM_LABEL[reportDim]}` + (reportTypes.size > 0 ? ` (${Array.from(reportTypes).join(', ')})` : '');
    return pdfDocument({
      title: titleForScope(scope),
      subtitle: `Total de máquinas: ${total}${tipoFilterNote}`,
      extraCss: `
        .muted{color:#666;font-size:12px}
        table{width:100%;border-collapse:collapse;margin-top:2px;font-size:11px}
        th,td{border:1px solid #ccc;padding:5px 7px;text-align:left}
        th{background:#1E3A5F;color:#fff}
        h2{font-size:15px;color:#1E3A5F;margin:18px 0 4px;text-transform:uppercase}
        .tipo{font-size:13px;font-weight:800;text-transform:uppercase;color:#1E3A5F;margin:12px 0 2px}
        .subtotal{margin:6px 0 2px;text-align:right;font-weight:700;color:#1E3A5F}
        .grand{margin-top:16px;padding:10px 14px;background:#1E3A5F;color:#fff;font-weight:800;font-size:14px;border-radius:6px;text-align:right}`,
      body:
        (sections || '<p class="muted">Sin maquinaria para este filtro.</p>') +
        `<div class="grand">Total de máquinas: ${total} · Horas trabajadas (≤ 05/07/2026): ${grandHours} h${withPrices ? ` · Total a pagar: $${money(grandAmount)}` : ''}</div>
         <p class="muted" style="margin-top:6px">Horas = (día + noche) − parada + extras, acumuladas hasta el 05/07/2026${withPrices ? ' · Total $ = horas trabajadas × precio por hora (precio jornada ÷ 12).' : '.'}</p>`,
    });
  };
  const downloadReportPdf = async (scope: string = reportCompany, withPrices: boolean = true) => {
    await exportPdf(buildReportHtml(scope, withPrices), `Catálogo - Reporte${withPrices ? '' : ' (sin $)'}`);
  };

  const renderMachineCard = (m: Machinery) => {
    const saved = justSaved === m.id;
    return (
    <Card key={m.id} style={saved ? { borderColor: colors.success, borderWidth: 2 } : undefined}>
      <TouchableOpacity onPress={() => { setKind('maquinaria'); openEdit(m); }} activeOpacity={0.7}>
        {saved ? (
          <View style={{ alignSelf: 'flex-start', backgroundColor: colors.success, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, marginBottom: spacing.xs }}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 11 }}>✓ Cambios guardados</Text>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          {m.photo_url ? (
            <Thumb uri={m.photo_url} size={64} radius={radius.md} />
          ) : (
            <View style={{ width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 28 }}>🚜</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '700', color: colors.text, fontSize: 17 }}>{m.code}</Text>
              <Text style={{ color: m.en_espera ? colors.warning : m.operational ? colors.success : colors.danger, fontWeight: '700', fontSize: 13 }}>
                {m.en_espera ? '🕓 En espera' : m.operational ? '● Operativa' : '● No operativa'}
              </Text>
            </View>
            {m.identifier ? <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>🆔 {m.identifier}</Text> : null}
            {m.tipo ? <Text style={{ color: colors.muted, fontSize: 12 }}>🏷️ Modelo: {m.tipo}</Text> : null}
            {m.clasificacion ? <Text style={{ color: colors.muted, fontSize: 12 }}>🗃️ Clasificación: {m.clasificacion}</Text> : null}
            {m.encargado ? <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>👤 Encargado: {m.encargado}</Text> : null}
            {m.grupo ? <Text style={{ color: colors.muted, fontSize: 12 }}>🗂️ Grupo: {m.grupo}</Text> : null}
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
        <TouchableOpacity onPress={() => setJornadaFor(m)} style={{ marginTop: spacing.sm, backgroundColor: '#1E9E4A', borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>🕒 Iniciar jornada</Text>
        </TouchableOpacity>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
        <BigBtn label={busy === m.id + '-loc' ? 'Ubicando…' : '📍 ACTUALIZAR UBICACIÓN'} onPress={() => locate(m)} color="#2563EB" disabled={busy === m.id + '-loc'} />
        {m.latitude != null ? (
          <BigBtn label="🗺️ Ver en mapa" onPress={() => navigation?.navigate('Map', { focus: { id: m.id, code: m.code } })} color="#0D9488" />
        ) : null}
        <BigBtn label={busy === m.id + '-photo' ? 'Subiendo…' : '📷 Foto'} onPress={() => photo(m)} color={colors.primary} textColor={colors.primaryContrast} disabled={busy === m.id + '-photo'} />
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
      <SectionTitle>Catálogo maquinaria/vehículos</SectionTitle>

      {notice ? (
        <TouchableOpacity onPress={() => setNotice(null)}>
          <View style={{ backgroundColor: colors.surfaceAlt, borderLeftWidth: 4, borderLeftColor: colors.primary, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm }}>
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
            <Text style={{ fontSize: 22, fontWeight: '800', color: colors.success }}>{machinery.loading ? '…' : activeMachines.length}</Text>
          </Card>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.7} style={{ flex: 1 }} onPress={() => setDetailStatus('inactive')}>
          <Card style={{ borderLeftWidth: 4, borderLeftColor: colors.danger }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Maquinaria inactiva</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>›</Text>
            </View>
            <Text style={{ fontSize: 22, fontWeight: '800', color: colors.danger }}>{machinery.loading ? '…' : inactiveMachines.length}</Text>
          </Card>
        </TouchableOpacity>
      </View>

      {/* Alta unificada: + Agregar (elige vehículo o maquinaria) y Lote */}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <TouchableOpacity
          style={{ flex: 2, backgroundColor: colors.primary, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center' }}
          onPress={() => setKindChooser('add')}
        >
          <Text style={{ color: colors.primaryContrast, fontWeight: '700', fontSize: 15 }}>
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
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: active ? colors.primary : colors.surfaceAlt, borderWidth: 1, borderColor: active ? colors.primary : colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}
              >
                <Text style={{ color: active ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{label}</Text>
                <Text style={{ color: active ? colors.primaryContrast : colors.muted, fontSize: 12 }}>({count})</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {firstLoad ? (
        <Loading />
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
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: open ? colors.primary : colors.surfaceAlt, borderWidth: 1, borderColor: open ? colors.primary : colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 }}>
                    <Text style={{ color: open ? colors.primaryContrast : colors.muted, fontSize: 16 }}>{open ? '▾' : '▸'}</Text>
                    <Text style={{ color: open ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>🏢 {g.name}</Text>
                  </View>
                  <View style={{ backgroundColor: open ? colors.primaryContrast : colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
                    <Text style={{ color: open ? colors.primary : colors.primaryContrast, fontWeight: '800', fontSize: 13 }}>{g.items.length}</Text>
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
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: open ? colors.primary : colors.surfaceAlt, borderWidth: 1, borderColor: open ? colors.primary : colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 }}>
                      <Text style={{ color: open ? colors.primaryContrast : colors.muted, fontSize: 16 }}>{open ? '▾' : '▸'}</Text>
                      <Text style={{ color: open ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>🚗 Vehículos</Text>
                    </View>
                    <View style={{ backgroundColor: open ? colors.primaryContrast : colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
                      <Text style={{ color: open ? colors.primary : colors.primaryContrast, fontWeight: '800', fontSize: 13 }}>{vehicleList.length}</Text>
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
            {qrFor?.company_id ? (
              <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '700' }}>🏢 {companyName(qrFor.company_id) || 'Sin empresa'}</Text>
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
              style={{ alignSelf: 'stretch', marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: (qrFor as any)?.qr_blocked === true ? '#1E9E4A' : '#D22B2B', opacity: qrBlockBusy ? 0.7 : 1 }}
            >
              <Text style={{ color: '#fff', fontWeight: '800' }}>
                {qrBlockBusy ? 'Guardando…' : (qrFor as any)?.qr_blocked === true ? '✅ Desbloquear QR' : '🚫 Bloquear QR (mostrar solo el logo)'}
              </Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, alignSelf: 'stretch' }}>
              <TouchableOpacity onPress={() => setQrFor(null)} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={printQr} disabled={!qrStr} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary }}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>🖨️ Imprimir</Text>
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
              <View style={{ backgroundColor: '#FEE2E2', borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.sm }}>
                <Text style={{ color: '#B91C1C', fontSize: 13, fontWeight: '600' }}>Error: {batchError}</Text>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setBatchOpen(false)}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary }} onPress={saveBatch} disabled={batchBusy}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>{batchBusy ? 'Guardando…' : 'Guardar lote'}</Text>
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
                    <Text style={{ color: active ? colors.primary : colors.text, fontWeight: active ? '800' : '500', flex: 1 }}>{o.label}</Text>
                    <View style={{ backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, minWidth: 26, alignItems: 'center' }}>
                      <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 12 }}>{o.count}</Text>
                    </View>
                    {active ? <Text style={{ color: colors.primary, fontWeight: '800' }}>✓</Text> : null}
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
                <Text style={{ color: colors.primary, fontSize: 20, fontWeight: '800' }}>←</Text>
                <Text style={{ color: colors.primary, fontWeight: '700' }}>Volver</Text>
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
                      <Text style={{ color: colors.success, fontWeight: '800', fontSize: 18 }}>{fuelSurtido.toLocaleString()} L</Text>
                    </View>
                    <View style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>Consumo estimado</Text>
                      <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 18 }}>{fuelConsumed != null ? `${fuelConsumed.toLocaleString()} L` : '—'}</Text>
                    </View>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
                    Consumo estimado = {fuelWorked.toLocaleString()} h trabajadas × {fuelFor.expected_lph != null ? `${Number(fuelFor.expected_lph).toLocaleString()} L/h` : 'sin rendimiento (defínelo al editar la máquina)'}
                  </Text>

                  {/* Consumo REAL por horómetro: litros ÷ horas operadas. */}
                  <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.sm, borderLeftWidth: 3, borderLeftColor: colors.primary }}>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>Consumo por horómetro (real)</Text>
                    <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 18 }}>{fuelPerHour != null ? `${fuelPerHour.toLocaleString()} L/h` : '—'}</Text>
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
                  <TouchableOpacity style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary }} onPress={downloadFuelPdf}>
                    <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>⬇️ Descargar PDF</Text>
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
                            style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt }}>
                            <Text style={{ color: on ? colors.primaryContrast : colors.text, fontSize: 13 }}>{tk.name}</Text>
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
            <Text style={{ color: colors.primary, fontSize: 20, fontWeight: '800' }}>←</Text>
            <Text style={{ color: colors.primary, fontWeight: '700' }}>Volver</Text>
          </TouchableOpacity>
          <SectionTitle>
            {detailTitle}{'  '}({detailList.length})
          </SectionTitle>
          {detailList.length === 0 ? (
            <EmptyState title="Sin máquinas" subtitle={detailStatus === 'active' ? 'No hay maquinaria operativa.' : detailStatus === 'espera' ? 'No hay maquinaria en espera.' : 'No hay maquinaria inactiva.'} />
          ) : (
            <ScrollView>
              {detailList
                .slice()
                .sort((a, b) => a.code.localeCompare(b.code))
                .map((m) => (
                  <Card key={m.id}>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => { setDetailStatus(null); setKind('maquinaria'); openEdit(m); }}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16, flex: 1 }}>{m.code}</Text>
                        <Text style={{ color: m.en_espera ? colors.warning : m.operational ? colors.success : colors.danger, fontWeight: '700', fontSize: 13 }}>
                          {m.en_espera ? '🕓 En espera' : m.operational ? '● Operativa' : '● No operativa'}
                        </Text>
                      </View>
                      {m.identifier ? <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>🆔 {m.identifier}</Text> : null}
                      {m.company_id ? <Text style={{ color: colors.muted, fontSize: 12 }}>🏢 {companyName(m.company_id)}</Text> : null}
                      {m.encargado ? <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>👤 Encargado: {m.encargado}</Text> : null}
                      {m.plate ? <Text style={{ color: colors.muted, fontSize: 12 }}>Placa: {m.plate}</Text> : null}
                    </TouchableOpacity>
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
            <Text style={{ color: colors.primary, fontSize: 20, fontWeight: '800' }}>←</Text>
            <Text style={{ color: colors.primary, fontWeight: '700' }}>Volver</Text>
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
                    onPress={() => { setReportCompany(o.value); downloadReportPdf(o.value, reportWithPrices); }}
                    style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                  >
                    <Text style={{ color: active ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{o.label}</Text>
                    <Text style={{ color: active ? colors.primaryContrast : colors.muted, fontSize: 12 }}>({o.count})</Text>
                  </TouchableOpacity>
                );
              })}
          </View>

          {/* El reporte se agrupa siempre por Clasificación. */}
          {/* Checklist de clasificaciones (multi-selección). Vacío = todos. */}
          {reportTypeOptions.length > 0 ? (
            <View style={{ marginBottom: spacing.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Filtrar por {DIM_LABEL[reportDim].toLowerCase()} (marca varios)</Text>
                {reportTypes.size > 0 ? (
                  <TouchableOpacity onPress={() => setReportTypes(new Set())}>
                    <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>Limpiar ({reportTypes.size})</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {reportTypeOptions.map((o) => {
                  const on = reportTypes.has(o.tipo);
                  return (
                    <TouchableOpacity
                      key={o.tipo}
                      onPress={() => toggleReportType(o.tipo)}
                      style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                    >
                      <Text style={{ color: on ? colors.primaryContrast : colors.muted, fontSize: 13, fontWeight: '800' }}>{on ? '☑' : '☐'}</Text>
                      <Text style={{ color: on ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{o.tipo}</Text>
                      <Text style={{ color: on ? colors.primaryContrast : colors.muted, fontSize: 12 }}>({o.count})</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ) : null}

          {/* Con precios ($) / sin precios */}
          <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
            <TouchableOpacity
              onPress={() => setReportWithPrices(true)}
              style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: reportWithPrices ? colors.primary : colors.border, backgroundColor: reportWithPrices ? colors.primary : colors.surfaceAlt }}
            >
              <Text style={{ color: reportWithPrices ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 }}>💲 Con precios</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setReportWithPrices(false)}
              style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: !reportWithPrices ? colors.primary : colors.border, backgroundColor: !reportWithPrices ? colors.primary : colors.surfaceAlt }}
            >
              <Text style={{ color: !reportWithPrices ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 }}>Sin precios</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={{ padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary, opacity: reportTotal === 0 ? 0.5 : 1, marginBottom: spacing.sm }}
            onPress={() => downloadReportPdf(reportCompany, reportWithPrices)}
            disabled={reportTotal === 0}
          >
            <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>⬇️ Descargar PDF {reportWithPrices ? '(con $)' : '(sin $)'}</Text>
          </TouchableOpacity>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>{reportTitle}</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>{reportTotal} máquina(s)</Text>
          </View>

          <ScrollView style={{ flex: 1 }}>
            {reportTotal === 0 ? (
              <EmptyState title="Sin maquinaria" subtitle="No hay máquinas para este alcance." />
            ) : (
              (() => {
                let item = 0; // contador continuo (1..N) para el ítem
                return (
                  <>
                    {reportGroups.map((g) => (
                      <View key={g.key} style={{ marginBottom: spacing.sm }}>
                        <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 15, marginBottom: 4, textTransform: 'uppercase' }}>
                          🏢 {g.name} ({g.items.length} máquina{g.items.length === 1 ? '' : 's'})
                        </Text>
                        {tiposOf(g.items).map(([tipo, items]) => (
                          <View key={tipo} style={{ marginBottom: spacing.xs }}>
                            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, textTransform: 'uppercase', backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 3 }}>
                              {tipo.toUpperCase()} — TOTAL {items.length}
                            </Text>
                            {items.map((m) => {
                              item += 1;
                              const n = item;
                              return (
                                <View key={m.id} style={{ borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 5, paddingLeft: spacing.sm }}>
                                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14, flex: 1 }}>
                                      <Text style={{ color: colors.muted }}>{n}. </Text>
                                      {m.identifier ? `${m.identifier} · ` : ''}{m.code}
                                    </Text>
                                    <Text style={{ color: m.en_espera ? colors.warning : m.operational ? colors.success : colors.danger, fontWeight: '700', fontSize: 12 }}>
                                      {m.en_espera ? 'En espera' : m.operational ? 'Operativa' : 'No operativa'}
                                    </Text>
                                  </View>
                                  <Text style={{ color: colors.muted, fontSize: 11 }}>
                                    {[m.plate && `Placa: ${m.plate}`, m.serial && `Serial: ${m.serial}`, (m as any).referencia && `📍 ${(m as any).referencia}`, m.encargado && `👤 ${m.encargado}`, m.grupo && `🗂️ ${m.grupo}`].filter(Boolean).join('  ·  ') || '—'}
                                  </Text>
                                </View>
                              );
                            })}
                          </View>
                        ))}
                      </View>
                    ))}
                    <View style={{ marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md }}>
                      <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 14, textAlign: 'right' }}>
                        Total de máquinas: {reportTotal}
                      </Text>
                    </View>
                  </>
                );
              })()
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
