import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Image } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, Badge } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import QrScanner from '../components/QrScanner';
import { parseMachineId } from './ScanQrScreen';
import { captureAndUploadPhoto } from '../lib/photo';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { supabase, selectAllRows } from '../lib/supabase';
import { norm, onlyDecimal, cmpText } from '../lib/text';
import { sectorOf, sectorLabel } from '../lib/mapZones';
import { horometroAlertaDe, horasAcumuladas, HOROMETRO_UMBRAL_ALTA, NIVEL_RANK, HorometroAlerta } from '../lib/horometroAlertas';
import { listInspectorAssignments } from '../lib/machineInspectors';
import { caracasParts } from '../lib/jornada';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { useToast } from '../components/ToastProvider';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const MAT_ICON: Record<string, string> = { caucho: '🛞', aceite: '🛢️', filtro: '🧴', repuesto: '🔩', otro: '✏️' };
const matLabel = (m: string) => (m ? m.charAt(0).toUpperCase() + m.slice(1) : '—');
// Materiales de avería para reportar al escanear (incluye "Otro" = falla libre).
const AV_MATERIALS: { key: string; label: string; icon: string }[] = [
  { key: 'caucho', label: 'Caucho', icon: '🛞' },
  { key: 'aceite', label: 'Aceite', icon: '🛢️' },
  { key: 'filtro', label: 'Filtro', icon: '🧴' },
  { key: 'repuesto', label: 'Repuesto', icon: '🔩' },
  { key: 'otro', label: 'Otro', icon: '✏️' },
];
const numOrNull = (s: string) => { const n = Number((s || '').replace(',', '.')); return isFinite(n) && s.trim() !== '' ? n : null; };
const todayISO = () => caracasParts(new Date()).iso;
const fmtDMY = (iso?: string | null) => { if (!iso) return '—'; const [y, m, d] = String(iso).split('T')[0].split('-'); return y && m && d ? `${d}/${m}/${y}` : String(iso); };
function fmtDT(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => `${n}`.padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
// Coordenadas legibles (o null si la máquina no tiene GPS).
const coordText = (lat?: number | null, lng?: number | null): string | null =>
  (lat != null && lng != null && isFinite(lat) && isFinite(lng)) ? `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}` : null;
// Edificio / sector: por la ubicación GPS; si no cae en zona, usa la referencia.
const edificioText = (lat?: number | null, lng?: number | null, referencia?: string | null): string => {
  const s = sectorLabel(sectorOf(lat, lng));
  return s && s !== 'Sin zona' ? s : ((referencia || '').trim() || 'Sin zona');
};

type Req = { id: string; machinery_id: string; material: string; quantity: number | null; notes: string | null; status: string; created_at: string; resolved_at: string | null; resolvedByName: string | null; code: string; tipo: string | null; company: string; photo_url: string | null; photos: string[] | null; plate: string | null; serial: string | null; last_horometro: number | null; operational: boolean; referencia: string | null; sector: string | null; parroquia: string | null; latitude: number | null; longitude: number | null; requested_by: string | null; requestedByName: string | null };
type Rep = { id: string; machinery_id: string; tipo: string; out_at: string; estimated_days: number | null; estimated_note: string | null; work_done: string | null; back_at: string | null; status: string; created_at: string; code: string; machineTipo: string | null; company: string; createdByName: string | null; closedByName: string | null };
type Mach = { id: string; code: string; tipo: string | null; clasificacion: string | null; plate: string | null; serial: string | null; company: string; encargado: string | null; referencia: string | null; latitude: number | null; longitude: number | null; operational: boolean; last_horometro: number | null; horometro_base: number | null; horometro_maint_pending: boolean };
// Lectura de horómetro + foto que ingresa el inspector/operador al iniciar/finalizar la jornada
// (machine_rounds). Se muestra en la pestaña Horómetros junto a las horas acumuladas.
type HoroRound = { reading: number | null; at: string | null; operator: string | null; inicial: number | null; final: number | null; photo: string | null };

type Tab = 'averias' | 'reparacion' | 'historial' | 'horometros' | 'reporte';

// ── LAS DOS SECCIONES ────────────────────────────────────────────────────────
// El taller se ve en dos apartados separados, porque son dos trabajos distintos
// que antes vivían mezclados en una sola pantalla de 5 pestañas:
//
//   🧰 MANTENIMIENTO → lo PROGRAMADO. Lo manda el horómetro (cada 250 h toca
//      servicio). Nadie reporta nada: el reloj de la máquina avisa solo.
//   🔧 SERVICIO      → lo que se DAÑÓ. Lo manda una avería que alguien reportó
//      (operador por QR, inspector desde el teléfono, coordinador escaneando).
//
// La frontera es `machinery_repairs.tipo`, que ya existía en la base de datos:
// 'preventivo' es de Mantenimiento y 'correctivo' es de Servicio. Por eso la
// sección FIJA el tipo al enviar una máquina al taller (antes era un selector
// dentro del formulario): si se pudiera escoger, un expediente abierto desde
// Servicio se mudaría solo a Mantenimiento y el usuario no lo encontraría más.
//
// Las dos secciones son EL MISMO componente con distinto `seccion`: mismas
// consultas, mismas tablas, mismos guardados. No se tocó nada de la base de
// datos, así que la app móvil (que escribe en maintenance_requests y lee
// machinery.operational) sigue funcionando exactamente igual que antes.
export type Seccion = 'mantenimiento' | 'servicio';

// Una reparación pertenece a Mantenimiento solo si es preventiva. Las viejas sin
// tipo caen en Servicio, que es el comportamiento histórico (el formulario
// siempre venía con 'correctivo' preseleccionado).
const esPreventiva = (r: Rep) => r.tipo === 'preventivo';

const usd = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * TALLER DE MAQUINARIA — pantalla compartida por las dos secciones.
 *
 * 🧰 MANTENIMIENTO (preventivo, por horómetro):
 *  - Horómetros: horas acumuladas y cuánto falta para el próximo servicio.
 *  - Alertas de máquinas próximas a mantenimiento (200 h / 220 h / 250 h).
 *  - Enviar a mantenimiento y registrar el retorno operativo.
 *  - Historial de mantenimientos preventivos.
 *
 * 🔧 SERVICIO (correctivo, por avería):
 *  - Averías por empresa → máquina (lo que reporta el operador por QR).
 *  - Aviso de paradas viejas sin resolver.
 *  - Enviar una máquina a reparación (salida, tiempo estimado) → queda No operativa.
 *  - Registrar el retorno operativo (qué se le cambió + fecha) → vuelve a Operativa.
 *  - Historial de reparaciones y reporte de averías/gasto por empresa.
 */
export function TallerMaquinariaScreen({ seccion }: { seccion: Seccion }) {
  const esServicio = seccion === 'servicio';
  const { colors } = useTheme();
  const { canSee, session } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const uid = session?.user?.id ?? null;

  const [reqs, setReqs] = useState<Req[]>([]);
  const [repairs, setRepairs] = useState<Rep[]>([]);
  const [machines, setMachines] = useState<Mach[]>([]);
  const [loading, setLoading] = useState(true);
  // Pestaña de entrada de cada sección: Servicio abre en lo que hay que atender
  // (las averías); Mantenimiento abre en el horómetro, que es lo que manda ahí.
  const [tab, setTab] = useState<Tab>(esServicio ? 'averias' : 'horometros');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  // Enviar al taller. El TIPO ya no se escoge: lo fija la sección (Mantenimiento
  // manda preventivos, Servicio manda correctivos), porque es justo el campo que
  // decide en cuál de las dos secciones queda el expediente.
  const [repFor, setRepFor] = useState<Mach | null>(null);
  const rTipo: 'preventivo' | 'correctivo' = esServicio ? 'correctivo' : 'preventivo';
  const [rOut, setROut] = useState(todayISO());
  const [rDays, setRDays] = useState('');
  const [rNote, setRNote] = useState('');
  const [rWork, setRWork] = useState('');

  // Registrar retorno operativo
  const [retFor, setRetFor] = useState<Rep | null>(null);
  const [retBack, setRetBack] = useState(todayISO());
  const [retWork, setRetWork] = useState('');

  // Selector de máquina (para enviar cualquiera a reparación)
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQ, setPickerQ] = useState('');

  // Detalle de una avería (datos de la máquina + la falla + foto de referencia)
  const [detailReq, setDetailReq] = useState<Req | null>(null);

  // Escanear una máquina para REPORTAR una avería (desde la vista de admin).
  const [scanOpen, setScanOpen] = useState(false);
  const [avMachine, setAvMachine] = useState<{ id: string; code: string; plate: string | null; tipo: string | null } | null>(null);
  const [avMaterial, setAvMaterial] = useState<string | null>(null);
  const [avQty, setAvQty] = useState('');
  const [avNote, setAvNote] = useState('');
  const [avPhoto, setAvPhoto] = useState<string | null>(null);
  const [avPhotoUp, setAvPhotoUp] = useState(false);
  const [avBusy, setAvBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [horoOpen, setHoroOpen] = useState(false); // banner de alertas por horómetro (colapsable)

  // ── PARADAS viejas sin resolver ("MÁQUINA PARADA" pendiente hace rato) ──────
  // El marcador "MÁQUINA PARADA" (creado por el inspector desde el teléfono) NO
  // aparece en la pestaña Averías (se excluye a propósito, ver `load()`), y solo
  // se resuelve si un inspector/coordinador abre esa máquina puntual y toca
  // "Volver a OPERATIVA". Nadie lo ve venir si nadie la busca — así se quedó
  // bloqueada la Luminaria de Mayker sin que nadie se diera cuenta. Este banner
  // la hace VISIBLE proactivamente, igual que la alerta de horómetro de abajo.
  const [paradasViejas, setParadasViejas] = useState<{ id: string; machinery_id: string; code: string; company: string; created_at: string; notes: string | null }[]>([]);
  const [paradasOpen, setParadasOpen] = useState(false);
  const [resolvingParada, setResolvingParada] = useState<string | null>(null);
  const PARADA_STALE_HOURS = 4;

  // Grupos de empresa colapsados en la pestaña Averías (empresa → abierto/cerrado).
  const [avOpen, setAvOpen] = useState<Record<string, boolean>>({});

  // ── Reporte / Dashboard de averías ──────────────────────────────────────────
  const [gastoByMachine, setGastoByMachine] = useState<Record<string, number>>({});
  // Inspecciones por máquina (para cruzar inspección ↔ avería en el detalle).
  const [inspByMachine, setInspByMachine] = useState<Record<string, any[]>>({});
  const [reportLoaded, setReportLoaded] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [repGroupBy, setRepGroupBy] = useState<'equipo' | 'empresa' | 'tipo'>('equipo');
  const [repClasFilter, setRepClasFilter] = useState<string>('__all__'); // filtro por clasificación (tipo de maquinaria)
  const [repCaseFilter, setRepCaseFilter] = useState<'all' | 'con' | 'sin_insp' | 'sin_averia'>('all'); // avería+insp / avería sin insp / insp sin avería
  const [repDetailId, setRepDetailId] = useState<string | null>(null);   // máquina cuyo detalle se ve

  // ── Pestaña Horómetros: última lectura + foto que ingresó el inspector/operador ──
  const [horoByMachine, setHoroByMachine] = useState<Record<string, HoroRound>>({});
  const [horoLoaded, setHoroLoaded] = useState(false);
  const [horoLoading, setHoroLoading] = useState(false);
  const [horoPhotoView, setHoroPhotoView] = useState<string | null>(null); // foto del horómetro ampliada
  const [horoFilter, setHoroFilter] = useState<'all' | 'proximas' | 'vencidas' | 'con' | 'sin'>('all'); // filtro por los KPIs de arriba
  // Inspector(es) ASIGNADO(s) a cada máquina (machine_inspectors), por turno, para
  // mostrarlos en la tarjeta de Horómetros ("desde acá muéstrame los inspectores").
  const [asigByMachine, setAsigByMachine] = useState<Record<string, { day?: string; night?: string }>>({});

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  const load = async () => {
    setLoading(true);
    const [{ data: mr }, { data: rp }, { data: mac }, { data: profs }, { data: par }] = await Promise.all([
      // 'MÁQUINA PARADA' es el marcador interno de "parada" (Inspecciones/Control):
      // no es un material real, así que NO debe aparecer aquí (usa el flujo "Parada
      // / No trabajó" de Inspecciones, que no genera una solicitud de Mantenimiento).
      // `resolved_at`/`resolved_by`: hacen falta para el HISTORIAL. Antes no se pedían y
      // una avería marcada como REALIZADO desaparecía de la pantalla sin dejar rastro:
      // salía de "Averías" (que solo lista pendientes) y el Historial solo mostraba
      // expedientes de taller (`machinery_repairs`), no averías resueltas.
      supabase.from('maintenance_requests').select('id, machinery_id, material, quantity, notes, status, created_at, resolved_at, resolved_by, photo_url, photos, requested_by, machinery:machinery_id(code, tipo, plate, serial, referencia, sector, parroquia, latitude, longitude, last_horometro, operational, company:company_id(name))').neq('material', 'MÁQUINA PARADA').order('created_at', { ascending: false }),
      supabase.from('machinery_repairs').select('id, machinery_id, tipo, out_at, estimated_days, estimated_note, work_done, back_at, status, created_at, created_by, closed_by, machinery:machinery_id(code, tipo, company:company_id(name))').order('created_at', { ascending: false }),
      supabase.from('machinery').select('id, code, tipo, clasificacion, plate, serial, encargado, referencia, latitude, longitude, operational, active, last_horometro, horometro_base, horometro_maint_pending, company:company_id(name)').eq('active', true).order('code'),
      supabase.from('profiles').select('id, full_name'),
      // Solo el marcador MÁQUINA PARADA pendiente, para el banner de "paradas viejas
      // sin resolver" — consulta chica y separada, no toca la lista de Averías de arriba.
      supabase.from('maintenance_requests').select('id, machinery_id, notes, created_at, machinery:machinery_id(code, company:company_id(name))').eq('material', 'MÁQUINA PARADA').eq('status', 'pendiente').order('created_at', { ascending: true }),
    ]);
    setParadasViejas((par ?? []).map((r: any) => ({ id: r.id, machinery_id: r.machinery_id, code: r.machinery?.code ?? '—', company: r.machinery?.company?.name ?? 'Sin empresa', created_at: r.created_at, notes: r.notes ?? null })));
    // Mapa uuid → nombre para resolver quién reportó cada avería (requested_by).
    const nameById = new Map<string, string>();
    (profs ?? []).forEach((p: any) => { if (p.full_name) nameById.set(p.id, p.full_name); });
    setReqs((mr ?? []).map((r: any) => ({ id: r.id, machinery_id: r.machinery_id, material: r.material, quantity: r.quantity != null ? Number(r.quantity) : null, notes: r.notes ?? null, status: r.status, created_at: r.created_at, code: r.machinery?.code ?? '—', tipo: r.machinery?.tipo ?? null, company: r.machinery?.company?.name ?? 'Sin empresa', photo_url: r.photo_url ?? null, photos: Array.isArray(r.photos) ? r.photos : null, plate: r.machinery?.plate ?? null, serial: r.machinery?.serial ?? null, last_horometro: r.machinery?.last_horometro != null ? Number(r.machinery.last_horometro) : null, operational: r.machinery?.operational !== false, referencia: r.machinery?.referencia ?? null, sector: r.machinery?.sector ?? null, parroquia: r.machinery?.parroquia ?? null, latitude: r.machinery?.latitude != null ? Number(r.machinery.latitude) : null, longitude: r.machinery?.longitude != null ? Number(r.machinery.longitude) : null, requested_by: r.requested_by ?? null, requestedByName: r.requested_by ? (nameById.get(r.requested_by) ?? null) : null, resolved_at: r.resolved_at ?? null, resolvedByName: r.resolved_by ? (nameById.get(r.resolved_by) ?? null) : null })));
    setRepairs((rp ?? []).map((r: any) => ({ id: r.id, machinery_id: r.machinery_id, tipo: r.tipo, out_at: r.out_at, estimated_days: r.estimated_days != null ? Number(r.estimated_days) : null, estimated_note: r.estimated_note ?? null, work_done: r.work_done ?? null, back_at: r.back_at ?? null, status: r.status, created_at: r.created_at, code: r.machinery?.code ?? '—', machineTipo: r.machinery?.tipo ?? null, company: r.machinery?.company?.name ?? 'Sin empresa', createdByName: r.created_by ? (nameById.get(r.created_by) ?? null) : null, closedByName: r.closed_by ? (nameById.get(r.closed_by) ?? null) : null })));
    setMachines((mac ?? []).map((m: any) => ({ id: m.id, code: m.code, tipo: m.tipo ?? null, clasificacion: m.clasificacion ?? null, plate: m.plate ?? null, serial: m.serial ?? null, company: m.company?.name ?? 'Sin empresa', encargado: m.encargado ?? null, referencia: m.referencia ?? null, latitude: m.latitude != null ? Number(m.latitude) : null, longitude: m.longitude != null ? Number(m.longitude) : null, operational: m.operational !== false, last_horometro: m.last_horometro != null ? Number(m.last_horometro) : null, horometro_base: m.horometro_base != null ? Number(m.horometro_base) : null, horometro_maint_pending: m.horometro_maint_pending === true })));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  useRealtimeRefresh(['maintenance_requests', 'machinery_repairs', 'machinery', 'profiles'], () => { load(); });

  // Gasto por equipo = materiales que SALIERON del almacén para esa máquina × su costo.
  // El equipo se toma de machinery_id del movimiento; para salidas viejas (sin ese dato)
  // se atribuye leyendo el CÓDIGO del equipo en el texto de la salida (reason).
  const loadReportData = async () => {
    setReportLoading(true);
    try {
    // PAGINADO (`selectAllRows`): PostgREST corta en ~1000 filas por consulta.
    // `inventory_movements` es de las tablas más voluminosas del sistema, así que sin
    // paginar el GASTO salía POR DEBAJO de lo real y los equipos con inspección vieja
    // se caían del reporte (bug 17-ago-2026). El resto del proyecto ya usaba este
    // helper justamente por esto; acá se había quedado con el `select` simple.
    const [mv, items, inspRaw] = await Promise.all([
      selectAllRows('inventory_movements', 'item_id, qty, unit_cost, machinery_id, reason, kind', (q) => q.in('kind', ['salida', 'consumo'])),
      selectAllRows('inventory_items', 'id, machinery_id, avg_cost'),
      selectAllRows('machine_inspections', 'id, machinery_id, inspected_at, inspector_name, condicion_general, items'),
    ]);
    // `selectAllRows` pagina por id, así que el orden del `order(...)` se pierde: se
    // reordena acá porque el reporte asume que la PRIMERA inspección de cada equipo es
    // la MÁS RECIENTE (`flaggedOf` usa `ins[0]`).
    const insp = (inspRaw ?? []).slice().sort((a: any, b: any) => String(b.inspected_at ?? '').localeCompare(String(a.inspected_at ?? '')));
    // Inspecciones agrupadas por equipo (para cruzarlas con las averías en el detalle).
    const inspMap: Record<string, any[]> = {};
    (insp ?? []).forEach((r: any) => { if (r.machinery_id) (inspMap[r.machinery_id] ??= []).push(r); });
    setInspByMachine(inspMap);
    const itemMap = new Map<string, { machinery_id: string | null; avg_cost: number }>();
    (items ?? []).forEach((it: any) => itemMap.set(it.id, { machinery_id: it.machinery_id ?? null, avg_cost: Number(it.avg_cost) || 0 }));
    // Códigos de más largo a más corto para que el match del texto sea el más específico.
    const codeList = machines.map((m) => ({ id: m.id, code: m.code })).filter((c) => c.code).sort((a, b) => b.code.length - a.code.length);
    const gasto: Record<string, number> = {};
    (mv ?? []).forEach((m: any) => {
      const it = itemMap.get(m.item_id);
      const unit = m.unit_cost != null ? Number(m.unit_cost) : (it?.avg_cost ?? 0);
      const cost = (Number(m.qty) || 0) * (Number(unit) || 0);
      let mid: string | null = m.machinery_id ?? it?.machinery_id ?? null;
      if (!mid && m.reason) { const hit = codeList.find((c) => String(m.reason).includes(` · ${c.code}`)); mid = hit?.id ?? null; }
      if (mid) gasto[mid] = (gasto[mid] ?? 0) + cost;
    });
    setGastoByMachine(gasto);
    // `setReportLoaded(true)` SOLO si la carga salió bien. Antes se marcaba siempre, así
    // que un fallo (RLS, timeout, sin red) quedaba CACHEADO como "cargado": el reporte se
    // veía en $0.00 para siempre y no se reintentaba nunca, sin avisar de nada.
    setReportLoaded(true);
    return { gasto, inspMap };
    } catch (e: any) {
      // Antes no había try/catch: si la promesa se rechazaba, nunca se llegaba a
      // `setReportLoading(false)` y el spinner giraba sin fin.
      toast.error('No se pudo cargar el reporte. Revisa la conexión e inténtalo de nuevo.');
      return null;
    } finally {
      setReportLoading(false);
    }
  };
  useEffect(() => { if (tab === 'reporte' && !reportLoaded && !loading) loadReportData(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab, loading]);
  // Solo refresca el reporte si ya se cargó (evita gastar la consulta cuando nadie visitó la pestaña).
  useRealtimeRefresh(['inventory_movements', 'inventory_items', 'machine_inspections'], () => { if (reportLoaded) loadReportData(); });

  // Última jornada con horómetro por máquina (lectura + foto + quién la registró).
  // La foto y la lectura las coloca el inspector/operador al iniciar/finalizar la jornada
  // (machine_rounds.horometro_photo / _inicial / _final). Tomamos la jornada MÁS RECIENTE
  // con datos; si esa no trae foto, completamos con la última foto disponible.
  const loadHoroData = async () => {
    setHoroLoading(true);
    const [{ data }, asig] = await Promise.all([
      supabase
        .from('machine_rounds')
        .select('machinery_id, round_date, horometro_inicial, horometro_final, horometro_photo, day_operator, night_operator')
        .or('horometro_photo.not.is.null,horometro_final.not.is.null,horometro_inicial.not.is.null')
        .order('round_date', { ascending: false })
        .limit(4000),
      listInspectorAssignments(),
    ]);
    // Inspector asignado por máquina y turno (☀️ día / 🌙 noche).
    const asigBy: Record<string, { day?: string; night?: string }> = {};
    (asig.rows ?? []).forEach((r) => {
      const g = asigBy[r.machinery_id] ?? {};
      if (r.shift === 'night') g.night = r.inspector_name; else g.day = r.inspector_name;
      asigBy[r.machinery_id] = g;
    });
    setAsigByMachine(asigBy);
    const by: Record<string, HoroRound> = {};
    (data ?? []).forEach((r: any) => {
      const id = r.machinery_id;
      if (!id) return;
      const inicial = r.horometro_inicial != null ? Number(r.horometro_inicial) : null;
      const final = r.horometro_final != null ? Number(r.horometro_final) : null;
      const reading = final ?? inicial;
      const op = r.night_operator || r.day_operator || null;
      if (!by[id]) {
        by[id] = { reading, at: r.round_date ?? null, operator: op, inicial, final, photo: r.horometro_photo ?? null };
      } else if (!by[id].photo && r.horometro_photo) {
        by[id].photo = r.horometro_photo; // conserva la lectura más reciente, completa la última foto
      }
    });
    setHoroByMachine(by);
    setHoroLoaded(true);
    setHoroLoading(false);
  };
  useEffect(() => { if (tab === 'horometros' && !horoLoaded && !loading) loadHoroData(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab, loading]);
  useRealtimeRefresh(['machine_rounds', 'machine_inspectors'], () => { if (horoLoaded) loadHoroData(); });

  // Rendimiento: índice id → máquina para evitar machines.find() dentro de bucles (O(n²) → O(n)).
  const machById = useMemo(() => new Map(machines.map((m) => [m.id, m])), [machines]);

  // Estadística por MÁQUINA: total de averías (todas), desglose por material y fechas.
  const machineStats = useMemo(() => {
    const by = new Map<string, { id: string; code: string; company: string; plate: string | null; serial: string | null; clasificacion: string | null; tipo: string | null; total: number; byMat: Record<string, number>; }>();
    reqs.forEach((r) => {
      const mac = machById.get(r.machinery_id);
      const g = by.get(r.machinery_id) ?? { id: r.machinery_id, code: r.code, company: r.company, plate: r.plate, serial: r.serial, clasificacion: mac?.clasificacion ?? null, tipo: mac?.tipo ?? r.tipo ?? null, total: 0, byMat: {} };
      g.total += 1;
      g.byMat[r.material] = (g.byMat[r.material] ?? 0) + 1;
      by.set(r.machinery_id, g);
    });
    return Array.from(by.values());
  }, [reqs, machById]);

  // Reparación ACTIVA por máquina (si existe).
  const activeRepairByMachine = useMemo(() => {
    const m = new Map<string, Rep>();
    repairs.forEach((r) => { if (r.status === 'en_reparacion' && !m.has(r.machinery_id)) m.set(r.machinery_id, r); });
    return m;
  }, [repairs]);

  // ── Alertas por HORÓMETRO (mantenimiento preventivo) ────────────────────────
  // Máquinas activas que acumularon 200h+ desde su último mantenimiento
  // confirmado (horometro_base). Se ordenan por severidad (ALTA primero).
  const horometroAlertas = useMemo(() => {
    return machines
      .map((m) => ({ m, alerta: horometroAlertaDe(m.last_horometro, m.horometro_base) }))
      .filter((x): x is { m: Mach; alerta: HorometroAlerta } => !!x.alerta)
      .sort((a, b) => NIVEL_RANK[a.alerta.nivel] - NIVEL_RANK[b.alerta.nivel] || b.alerta.horas - a.alerta.horas);
  }, [machines]);

  // Confirma el mantenimiento de una máquina: reinicia su "horómetro base" al
  // horómetro actual (NO toca el horómetro físico/last_horometro). Las horas
  // acumuladas vuelven a 0 y la alerta deja de generarse.
  const [confirmingHoro, setConfirmingHoro] = useState<string | null>(null);
  const confirmarMantenimientoHorometro = async (m: Mach) => {
    if (m.last_horometro == null) return;
    const ok = await confirm({
      title: 'Confirmar mantenimiento',
      message: `¿Confirmas que a "${m.code}" ya se le hizo el mantenimiento? Se reinicia el conteo de horas acumuladas (horómetro actual: ${m.last_horometro}).`,
      confirmText: 'Sí, confirmar y reiniciar', cancelText: 'Cancelar',
    });
    if (!ok) return;
    setConfirmingHoro(m.id);
    // Reparada: reinicia la base (acumulado → 0) Y limpia el arrastre "requiere
    // mantenimiento" (horometro_maint_pending). Es la ÚNICA forma de sacar una
    // máquina vencida de la lista.
    const { error } = await supabase.from('machinery').update({ horometro_base: m.last_horometro, horometro_maint_pending: false }).eq('id', m.id);
    setConfirmingHoro(null);
    if (error) return toast.error(error.message);
    setMachines((prev) => prev.map((x) => (x.id === m.id ? { ...x, horometro_base: m.last_horometro, horometro_maint_pending: false } : x)));
    setNotice(`✅ Mantenimiento confirmado en ${m.code} · horómetro reiniciado.`);
  };

  // Paradas cuyo marcador "MÁQUINA PARADA" lleva más de PARADA_STALE_HOURS sin
  // resolver (ya ordenadas por más viejas primero desde la consulta).
  const paradasStale = useMemo(() => {
    const cutMs = Date.now() - PARADA_STALE_HOURS * 3600 * 1000;
    return paradasViejas.filter((p) => new Date(p.created_at).getTime() < cutMs);
  }, [paradasViejas]);
  const horasDesde = (iso: string): number => Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);

  // Resuelve una parada vieja: mismo criterio que "🟢 Volver a OPERATIVA" del
  // inspector (SupervisorScreen) — cierra el marcador MÁQUINA PARADA Y cualquier
  // avería real pendiente de esa máquina, para que quede igual de desbloqueada.
  // A propósito NO registra una "visita" (no hubo inspección física real).
  const resolverParadaVieja = async (p: { id: string; machinery_id: string; code: string }) => {
    const ok = await confirm({ title: 'Marcar como resuelta', message: `¿"${p.code}" ya volvió a estar operativa? Se cierra la parada y cualquier avería pendiente de esta máquina.`, confirmText: 'Sí, resolver', cancelText: 'Cancelar' });
    if (!ok) return;
    setResolvingParada(p.id);
    const nowIso = new Date().toISOString();
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from('maintenance_requests').update({ status: 'realizado', resolved_by: uid, resolved_at: nowIso }).eq('machinery_id', p.machinery_id).eq('material', 'MÁQUINA PARADA').eq('status', 'pendiente'),
      supabase.from('maintenance_requests').update({ status: 'realizado', resolved_by: uid, resolved_at: nowIso }).eq('machinery_id', p.machinery_id).neq('material', 'MÁQUINA PARADA').eq('status', 'pendiente'),
    ]);
    setResolvingParada(null);
    if (e1 || e2) return toast.error((e1?.message || e2?.message) as string);
    setNotice(`✅ ${p.code} · parada resuelta.`);
    await load();
  };

  const marcarRealizado = async (r: Req) => {
    const ok = await confirm({ title: 'Mantenimiento realizado', message: `¿Marcar como REALIZADO el ${matLabel(r.material)} de "${r.code}"?`, confirmText: 'Sí, realizado', cancelText: 'Cancelar' });
    if (!ok) return;
    setBusy(r.id);
    const { error } = await supabase.from('maintenance_requests').update({ status: 'realizado', resolved_by: uid, resolved_at: new Date().toISOString() }).eq('id', r.id);
    setBusy(null);
    if (error) return toast.error(error.message);
    setReqs((prev) => prev.map((x) => (x.id === r.id ? { ...x, status: 'realizado' } : x)));
  };

  // ── Escanear una máquina para reportar una avería ───────────────────────────
  const onScanDetected = async (text: string) => {
    setScanOpen(false);
    const id = parseMachineId(text);
    if (!id) { setNotice('❌ QR no reconocido. Escanea el QR de una máquina.'); return; }
    const { data } = await supabase.from('machinery').select('id, code, plate, tipo').eq('id', id).single();
    if (!data) { setNotice('❌ No se encontró esa máquina.'); return; }
    setAvMachine(data as any); setAvMaterial(null); setAvQty(''); setAvNote(''); setAvPhoto(null); setNotice(null);
  };
  const subirFotoAveria = async () => {
    if (!avMachine) return;
    setAvPhotoUp(true);
    const r = await captureAndUploadPhoto(avMachine.id, 'averias');
    setAvPhotoUp(false);
    if (r.ok && r.url) setAvPhoto(r.url);
    else if (r.error) setNotice('❌ ' + r.error);
  };
  const registrarAveria = async () => {
    if (!avMachine || !avMaterial) return;
    if (!avNote.trim()) { setNotice('❌ Describe la falla — la nota es obligatoria.'); return; }
    setAvBusy(true);
    const { error } = await supabase.from('maintenance_requests').insert({
      machinery_id: avMachine.id,
      material: avMaterial,
      quantity: avMaterial === 'otro' ? null : numOrNull(avQty),
      notes: avNote.trim() || null,
      status: 'pendiente',
      requested_by: uid,
      photo_url: avPhoto,
    });
    setAvBusy(false);
    if (error) { setNotice('❌ ' + error.message); return; }
    const code = avMachine.code;
    setAvMachine(null); setAvMaterial(null); setAvQty(''); setAvNote(''); setAvPhoto(null);
    setNotice(`✅ Avería registrada · ${code}.`);
    setTab('averias');
    await load();
  };

  // ── Exportar el reporte de averías a PDF (por empresa → equipo) ──────────────
  const exportReportePdf = async () => {
    if (!reportLoaded) await loadReportData();
    // UNIVERSO: equipos con avería + equipos con inspección (aunque no tengan avería).
    const statById = new Map(machineStats.map((s) => [s.id, s]));
    const universe = machineStats.map((s) => ({ ...s }));
    Object.keys(inspByMachine).forEach((id) => {
      if (statById.has(id)) return;
      const mac = machById.get(id); // rendimiento: índice en vez de machines.find()
      if (!mac) return;
      universe.push({ id, code: mac.code, company: mac.company, plate: mac.plate, serial: mac.serial, clasificacion: mac.clasificacion, tipo: mac.tipo ?? null, total: 0, byMat: {} as Record<string, number> });
    });
    const flaggedOf = (id: string) => { const ins = inspByMachine[id] ?? []; return ins.length ? (ins[0].items ?? []).filter((it: any) => it.nivel === 'warn' || it.nivel === 'bad').length : 0; };
    const casoTxt = (id: string, total: number) => (total > 0 ? ((inspByMachine[id] ?? []).length ? `🔧🔍 Avería + insp. (${flaggedOf(id)} obs.)` : '🔧 Avería sin insp.') : `🔍 Insp. sin avería (${flaggedOf(id)} obs.)`);
    // Agrupa por empresa → equipos.
    const byCompany = new Map<string, typeof universe>();
    universe.forEach((s) => { const arr = byCompany.get(s.company) ?? []; arr.push(s); byCompany.set(s.company, arr); });
    const companies = Array.from(byCompany.entries()).sort((a, b) => cmpText(a[0], b[0]));
    const mats = ['caucho', 'aceite', 'filtro', 'repuesto', 'otro'];
    const matHead = mats.map((m) => `<th>${matLabel(m)}</th>`).join('');
    let grandAv = 0, grandGasto = 0;
    const cnt = { con: 0, sin_insp: 0, sin_averia: 0 };
    const sections = companies.map(([company, list]) => {
      list.sort((a, b) => b.total - a.total);
      let cAv = 0, cGasto = 0;
      const rows = list.map((s) => {
        const g = gastoByMachine[s.id] ?? 0; cAv += s.total; cGasto += g;
        if (s.total > 0) { if ((inspByMachine[s.id] ?? []).length) cnt.con++; else cnt.sin_insp++; } else cnt.sin_averia++;
        const matCells = mats.map((m) => `<td style="text-align:center">${s.byMat[m] ?? 0}</td>`).join('');
        const ident = [s.plate, s.serial].filter(Boolean).join(' · ') || '—';
        return `<tr><td>${s.code}${s.tipo ? `<br/><span style="color:#888;font-weight:400">🏷️ ${s.tipo}</span>` : ''}</td><td style="color:#666">${ident}</td><td style="text-align:center;font-weight:700">${s.total}</td>${matCells}<td style="text-align:right;font-weight:700">${usd(g)}</td><td style="font-size:11px">${casoTxt(s.id, s.total)}</td></tr>`;
      }).join('');
      grandAv += cAv; grandGasto += cGasto;
      return `<h3 style="margin:14px 0 4px">🏢 ${company} · ${list.length} equipo(s) · ${cAv} avería(s) · ${usd(cGasto)}</h3>
        <table><thead><tr><th>Equipo</th><th>Placa / Serial</th><th>Averías</th>${matHead}<th>Gasto</th><th>Caso</th></tr></thead><tbody>${rows}</tbody></table>`;
    }).join('');
    const body = `<div style="margin-bottom:8px;font-weight:700">TOTAL: ${grandAv} avería(s) · Gasto ${usd(grandGasto)}</div>
      <div style="margin-bottom:8px;font-size:12px">🔧🔍 Avería + inspección: ${cnt.con} &nbsp;·&nbsp; 🔧 Avería sin inspección: ${cnt.sin_insp} &nbsp;·&nbsp; 🔍 Inspección sin avería: ${cnt.sin_averia}</div>${sections}
      <p style="color:#888;font-size:11px;margin-top:10px">El gasto corresponde a los materiales que salieron del almacén para cada equipo (cantidad × costo). La columna Caso cruza las averías con la última inspección del equipo.</p>`;
    const html = pdfDocument({ title: 'Reporte de averías + inspección', subtitle: `${universe.length} equipo(s)`, body });
    await exportPdf(html, 'Reporte de averias e inspeccion');
  };

  // ── Enviar al taller (reparación en Servicio · mantenimiento en Mantenimiento) ─
  const openRepair = (m: Mach) => {
    setRepFor(m); setROut(todayISO()); setRDays(''); setRNote(''); setRWork('');
    setPickerOpen(false);
  };
  const enviarReparacion = async () => {
    if (!repFor) return;
    if (!rNote.trim()) return toast.error(esServicio ? 'Indica el motivo de la avería — es obligatorio.' : 'Indica el motivo del mantenimiento — es obligatorio.');
    setBusy('rep');
    const target = repFor;
    const nota = rNote.trim();
    const payload = {
      machinery_id: target.id, tipo: rTipo, out_at: rOut,
      estimated_days: rDays.trim() ? Number(rDays.replace(',', '.')) : null,
      estimated_note: nota, work_done: rWork.trim() || null,
      status: 'en_reparacion', created_by: uid,
    };
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from('machinery_repairs').insert(payload),
      supabase.from('machinery').update({ operational: false }).eq('id', target.id),
    ]);
    // Además del expediente de reparación, deja el marcador "MÁQUINA PARADA" (igual
    // que el inspector desde el teléfono): sin esto, la máquina queda "No operativa
    // en todo el sistema" (ver aviso del modal) pero NO se refleja en Inspecciones,
    // que solo lee maintenance_requests. Si YA había un marcador pendiente (p. ej. el
    // inspector ya la había marcado parada y ESTA reparación viene de esa avería), se
    // ACTUALIZA su motivo en vez de insertar otro — un segundo marcador duplicaría las
    // horas paradas contadas en porEmpresaReport.
    const { data: updRows, error: eUpd } = await supabase.from('maintenance_requests')
      .update({ notes: nota })
      .eq('machinery_id', target.id).eq('material', 'MÁQUINA PARADA').eq('status', 'pendiente')
      .select('id');
    const e3 = eUpd || (!updRows?.length
      ? (await supabase.from('maintenance_requests').insert({
          machinery_id: target.id, material: 'MÁQUINA PARADA', notes: nota, status: 'pendiente', requested_by: uid || null,
        })).error
      : null);
    setBusy(null);
    // No aborta el cierre/recarga en error parcial: machinery_repairs/machinery ya
    // pudieron haberse guardado — reintentar con el modal abierto duplicaría el expediente.
    if (e1 || e2 || e3) toast.error((e1?.message || e2?.message || e3?.message) as string);
    setRepFor(null);
    await load();
    setTab('reparacion');
  };

  // ── Registrar retorno operativo ─────────────────────────────────────────────
  const openReturn = (r: Rep) => { setRetFor(r); setRetBack(todayISO()); setRetWork(r.work_done ?? ''); };
  const registrarRetorno = async () => {
    if (!retFor) return;
    if (!retWork.trim()) return toast.error('Indica qué se le cambió / reparó a la máquina.');
    setBusy('ret');
    const nowIso = new Date().toISOString();
    // Cierra también, en maintenance_requests, el marcador "MÁQUINA PARADA" que
    // enviarReparacion/marcarAveriada dejan en Inspecciones Y cualquier avería real
    // pendiente de esta máquina (mismo criterio de "cierre doble" que resolverParadaVieja
    // y volverOperativa) — si no, la avería que originó el envío a reparación se quedaría
    // pendiente para siempre en Mantenimiento aunque la máquina ya volvió operativa.
    const [{ error: e1 }, { error: e2 }, { error: e3 }, { error: e4 }] = await Promise.all([
      supabase.from('machinery_repairs').update({ status: 'operativa', back_at: retBack, work_done: retWork.trim(), closed_by: uid }).eq('id', retFor.id),
      supabase.from('machinery').update({ operational: true, en_espera: false }).eq('id', retFor.machinery_id),
      supabase.from('maintenance_requests').update({ status: 'realizado', resolved_by: uid, resolved_at: nowIso }).eq('machinery_id', retFor.machinery_id).eq('material', 'MÁQUINA PARADA').eq('status', 'pendiente'),
      supabase.from('maintenance_requests').update({ status: 'realizado', resolved_by: uid, resolved_at: nowIso }).eq('machinery_id', retFor.machinery_id).neq('material', 'MÁQUINA PARADA').eq('status', 'pendiente'),
    ]);
    setBusy(null);
    if (e1 || e2 || e3 || e4) return toast.error((e1?.message || e2?.message || e3?.message || e4?.message) as string);
    setRetFor(null);
    await load();
  };

  // ── Agrupaciones por pestaña ────────────────────────────────────────────────
  const nq = norm(query.trim());
  // Busca por CUALQUIER campo relevante de la fila (máquina, empresa, placa, serial,
  // material, nota, quién reportó, tipo de reparación, qué se hizo…), no solo código/empresa.
  const matchesQ = (...fields: (string | number | null | undefined)[]) =>
    !nq || fields.some((f) => f != null && String(f).trim() !== '' && norm(String(f)).includes(nq));

  // AVERÍAS pendientes por empresa → máquina.
  const averiaGroups = useMemo(() => {
    const shown = reqs.filter((r) => r.status === 'pendiente' && matchesQ(
      r.code, r.company, r.tipo, matLabel(r.material), r.notes, r.plate, r.serial,
      r.requestedByName, r.sector, r.parroquia, r.referencia,
    ));
    const byCompany = new Map<string, Map<string, Req[]>>();
    shown.forEach((r) => {
      const comp = byCompany.get(r.company) ?? new Map<string, Req[]>();
      const arr = comp.get(r.code) ?? []; arr.push(r); comp.set(r.code, arr); byCompany.set(r.company, comp);
    });
    return Array.from(byCompany.entries()).map(([company, mm]) => ({ company, machines: Array.from(mm.entries()).map(([code, items]) => ({ code, items, machinery_id: items[0].machinery_id, tipo: items[0]?.tipo ?? null })).sort((a, b) => cmpText(a.code, b.code)) }))
      .sort((a, b) => cmpText(a.company, b.company));
  }, [reqs, nq]);

  // HORÓMETROS: todas las máquinas activas con sus horas acumuladas y lo que falta
  // para el mantenimiento (objetivo = HOROMETRO_UMBRAL_ALTA). Buscable por TODAS las
  // características (máquina, serial, placa, empresa, encargado, ubicación/referencia, tipo).
  const horometroList = useMemo(() => {
    const arr = machines.map((m) => {
      const acum = horasAcumuladas(m.last_horometro, m.horometro_base);
      const alerta = horometroAlertaDe(m.last_horometro, m.horometro_base);
      const restante = acum != null ? Math.round((HOROMETRO_UMBRAL_ALTA - acum) * 100) / 100 : null;
      // VENCIDA pegajosa (arrastre): llegó a ≥250 h acumuladas O quedó marcada como
      // "requiere mantenimiento" (horometro_maint_pending). Se mantiene hasta que
      // confirmen el mantenimiento (reparada + reiniciar horómetro).
      const venc = (acum != null && acum >= HOROMETRO_UMBRAL_ALTA) || !!m.horometro_maint_pending;
      return { m, acum, alerta, restante, venc, horo: horoByMachine[m.id] ?? null };
    });
    const filtered = !nq ? arr : arr.filter(({ m }) => {
      const asig = asigByMachine[m.id];
      return [m.code, m.serial, m.plate, m.company, m.encargado, m.referencia, m.tipo, m.clasificacion, asig?.day, asig?.night].some((f) => f && norm(String(f)).includes(nq));
    });
    // Más cerca del mantenimiento primero; empate → A→Z natural por código.
    return filtered.sort((a, b) => (b.acum ?? -1) - (a.acum ?? -1) || cmpText(a.m.code, b.m.code));
  }, [machines, horoByMachine, asigByMachine, nq]);

  const matchesRep = (r: Rep) => matchesQ(r.code, r.company, r.machineTipo, r.tipo, r.estimated_note, r.work_done, r.createdByName, r.closedByName);
  // Expedientes de taller que le tocan a ESTA sección: los preventivos son de
  // Mantenimiento y los correctivos de Servicio. Ojo: `activeRepairByMachine`
  // (el aviso "ya está en el taller" que sale en la tarjeta de una avería) se
  // queda mirando TODAS las reparaciones a propósito — si la máquina está en
  // mantenimiento preventivo, quien mira la avería en Servicio también tiene
  // que enterarse, o la mandaría al taller dos veces.
  const repsSeccion = useMemo(() => repairs.filter((r) => esPreventiva(r) !== esServicio), [repairs, esServicio]);
  const enReparacion = useMemo(() => repsSeccion.filter((r) => r.status === 'en_reparacion' && matchesRep(r)), [repsSeccion, nq]);
  const historial = useMemo(() => repsSeccion.filter((r) => r.status === 'operativa' && matchesRep(r)), [repsSeccion, nq]);
  // AVERÍAS RESUELTAS — solo en Servicio (Mantenimiento no tiene pestaña de averías).
  // Sin esto, marcar una avería como REALIZADO la hacía desaparecer del módulo por
  // completo: salía de "Averías" (que solo lista pendientes) y el Historial únicamente
  // mostraba expedientes de taller cerrados. El dato nunca se perdió en la base, pero no
  // había forma de verlo. Queja del cliente (17-ago-2026): "marqué una como realizado y
  // no me quedó ningún registro en el historial".
  const averiasResueltas = useMemo(
    () => (!esServicio ? [] : reqs
      .filter((r) => r.status === 'realizado' && matchesQ(r.code, r.company, r.tipo, matLabel(r.material), r.notes, r.plate, r.serial, r.requestedByName, r.resolvedByName))
      .sort((a, b) => String(b.resolved_at ?? b.created_at).localeCompare(String(a.resolved_at ?? a.created_at)))),
    [reqs, nq, esServicio],
  );

  const pendientes = reqs.filter((r) => r.status === 'pendiente').length;
  const enRepCount = repsSeccion.filter((r) => r.status === 'en_reparacion').length;

  // Título de la sección (encabezado, pantalla "Sin acceso" y menús).
  const titulo = esServicio ? '🔧 Servicio de Maquinaria' : '🧰 Mantenimiento de Maquinaria';

  // Cada sección tiene su propio módulo de permisos. 'servicio' hereda de
  // 'mantenimiento' mientras un admin no le ponga nivel propio (MODULE_HEREDA_DE),
  // así que quien entraba antes sigue entrando a las dos.
  if (!canSee(esServicio ? 'servicio' : 'mantenimiento')) {
    return (<Screen><SectionTitle>{titulo}</SectionTitle><EmptyState title="Sin acceso" subtitle="No tienes permiso para ver este módulo." /></Screen>);
  }

  const TIPO_BADGE = (t: string) => (t === 'preventivo' ? { label: '🧰 Preventivo', tone: 'muted' as const } : { label: '🔧 Correctivo', tone: 'warning' as const });

  const pickerList = machines.filter((m) => { const q = norm(pickerQ.trim()); return !q || norm(m.code).includes(q) || norm(m.company).includes(q); });

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>{titulo}</SectionTitle>
      <Text style={{ color: colors.muted, fontSize: 12, marginTop: -spacing.xs, marginBottom: spacing.sm }}>
        {esServicio
          ? 'Lo que se dañó: averías reportadas, taller y gasto. El mantenimiento programado está en su propia sección.'
          : 'Lo programado por horómetro: cada máquina y cuánto le falta para su próximo servicio. Las averías están en Servicio.'}
      </Text>

      {/* Pestañas — scroll horizontal (no flex:1): encogerlas a la fuerza hace que el
          texto se salga del botón en pantallas angostas (el bug clásico de flexbox: un
          TouchableOpacity con flex:1 no se encoge por debajo del ancho de su propio
          texto salvo que además tenga minWidth:0). Aquí cada pestaña conserva su ancho
          natural y legible, y la fila entera se desliza si no cabe. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }} contentContainerStyle={{ flexDirection: 'row', gap: spacing.xs }}>
        {((esServicio
          ? [['averias', `⏳ Averías (${pendientes})`], ['reparacion', `🔧 En reparación (${enRepCount})`], ['historial', '✓ Historial'], ['reporte', '📊 Reporte']]
          : [['horometros', '⏱️ Horómetros'], ['reparacion', `🧰 En mantenimiento (${enRepCount})`], ['historial', '✓ Historial']]
        ) as [Tab, string][]).map(([k, label]) => {
          const on = tab === k;
          return (
            <TouchableOpacity key={k} onPress={() => setTab(k)} style={{ paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}>
              <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 12 }} numberOfLines={1}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {notice ? (
        <TouchableOpacity onPress={() => setNotice(null)} style={{ marginBottom: spacing.sm }}>
          <View style={{ backgroundColor: colors.surfaceAlt, borderLeftWidth: 4, borderLeftColor: notice.startsWith('✅') ? colors.success : colors.danger, borderRadius: radius.md, padding: spacing.md }}>
            <Text style={{ color: colors.text, fontSize: 13 }}>{notice}</Text>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>Toca para cerrar</Text>
          </View>
        </TouchableOpacity>
      ) : null}

      {/* ── PARADAS viejas: "MÁQUINA PARADA" pendiente hace más de 4h sin que nadie la
          resuelva. Va solo en SERVICIO: una parada es una máquina caída, no un
          mantenimiento programado. ── */}
      {esServicio && paradasStale.length > 0 ? (
        <TouchableOpacity activeOpacity={0.8} onPress={() => setParadasOpen((v) => !v)} style={{ marginBottom: spacing.sm }}>
          <View style={{ backgroundColor: colors.dangerSoftBg, borderLeftWidth: 4, borderLeftColor: colors.danger, borderRadius: radius.md, padding: spacing.md }}>
            <Text style={{ color: colors.dangerSoftText, fontWeight: '800', fontSize: 13 }}>🔴 {paradasStale.length} máquina(s) parada(s) hace más de {PARADA_STALE_HOURS}h sin resolver {paradasOpen ? '▾' : '▸'}</Text>
            {paradasOpen ? paradasStale.map((p) => (
              <View key={p.id} style={{ marginTop: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>🚜 {p.code}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>🏢 {p.company}</Text>
                {p.notes ? <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={2}>📝 {p.notes}</Text> : null}
                <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12, marginTop: 2 }}>Parada hace {horasDesde(p.created_at)} h · desde {fmtDT(p.created_at)}</Text>
                <TouchableOpacity onPress={() => resolverParadaVieja(p)} disabled={resolvingParada === p.id} style={{ marginTop: spacing.xs, backgroundColor: colors.success, borderRadius: radius.md, paddingVertical: spacing.xs, alignItems: 'center', opacity: resolvingParada === p.id ? 0.6 : 1 }}>
                  <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>{resolvingParada === p.id ? 'Guardando…' : '✓ Ya está operativa (resolver)'}</Text>
                </TouchableOpacity>
              </View>
            )) : null}
          </View>
        </TouchableOpacity>
      ) : null}

      {/* ── Alertas por HORÓMETRO: máquinas próximas a mantenimiento (200h/220h/250h).
          Va solo en MANTENIMIENTO: es exactamente el trabajo de esa sección. ── */}
      {!esServicio && horometroAlertas.length > 0 ? (
        <TouchableOpacity activeOpacity={0.8} onPress={() => setHoroOpen((v) => !v)} style={{ marginBottom: spacing.sm }}>
          <View style={{ backgroundColor: colors.surfaceAlt, borderLeftWidth: 4, borderLeftColor: horometroAlertas[0].alerta.color, borderRadius: radius.md, padding: spacing.md }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>⏱️ {horometroAlertas.length} máquina(s) próxima(s) a mantenimiento {horoOpen ? '▾' : '▸'}</Text>
            {horoOpen ? horometroAlertas.map(({ m, alerta }) => (
              <View key={m.id} style={{ marginTop: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>🚜 {m.code}{m.serial ? ` · #️⃣ ${m.serial}` : ''}</Text>
                {m.tipo ? <Text style={{ color: colors.muted, fontSize: 12 }}>🏷️ {m.tipo}</Text> : null}
                <Text style={{ color: colors.muted, fontSize: 12 }}>🏢 {m.company}</Text>
                <Text style={{ color: alerta.color, fontWeight: '800', fontSize: 12, marginTop: 2 }}>Próxima a mantenimiento · {alerta.label} · {alerta.horas} h acumuladas</Text>
                <TouchableOpacity onPress={() => confirmarMantenimientoHorometro(m)} disabled={confirmingHoro === m.id} style={{ marginTop: spacing.xs, backgroundColor: colors.success, borderRadius: radius.md, paddingVertical: spacing.xs, alignItems: 'center', opacity: confirmingHoro === m.id ? 0.6 : 1 }}>
                  <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>{confirmingHoro === m.id ? 'Guardando…' : '✓ Confirmar mantenimiento y reiniciar horómetro'}</Text>
                </TouchableOpacity>
              </View>
            )) : null}
          </View>
        </TouchableOpacity>
      ) : null}

      {/* Acciones de la sección. Reportar una avería solo tiene sentido en Servicio;
          en Mantenimiento el único envío al taller es el preventivo. */}
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
        {esServicio ? (
          <TouchableOpacity onPress={() => setScanOpen(true)} style={{ flex: 1, minWidth: 0, backgroundColor: colors.brand, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
            <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 13, textAlign: 'center' }}>📷 Escanear · reportar avería</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity onPress={() => { setPickerQ(''); setPickerOpen(true); }} style={{ flex: 1, minWidth: 0, backgroundColor: colors.accent, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}>
          <Text style={{ color: colors.accentContrast, fontWeight: '800', fontSize: 13, textAlign: 'center' }}>{esServicio ? '🔧 Enviar a reparación' : '🧰 Enviar a mantenimiento'}</Text>
        </TouchableOpacity>
      </View>

      <TextInput value={query} onChangeText={setQuery} placeholder={tab === 'horometros' ? '🔎 Máquina, serial, placa, empresa, encargado, inspector, ubicación…' : '🔎 Máquina, empresa, placa, serial, material, nota, quién reportó…'} placeholderTextColor={colors.muted} style={{ ...input, marginBottom: spacing.sm }} />

      {loading ? (
        <Loading />
      ) : tab === 'averias' ? (
        averiaGroups.length === 0 ? (
          <EmptyState title="Sin averías pendientes" subtitle="Cuando un operador reporte una avería, aparecerá aquí por máquina." />
        ) : (
          averiaGroups.map((g) => {
            // Colapsable: cerrada por defecto; al buscar (nq) se abren todas para no ocultar resultados.
            const open = !!avOpen[g.company] || !!nq;
            const totalAverias = g.machines.reduce((s, mm) => s + mm.items.length, 0);
            return (
            <View key={g.company}>
              <TouchableOpacity activeOpacity={0.7} onPress={() => setAvOpen((p) => ({ ...p, [g.company]: !open }))}>
                <Card style={{ backgroundColor: colors.surfaceAlt, marginTop: spacing.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <Text style={{ color: colors.warning, fontSize: 16 }}>{open ? '▾' : '▸'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>🏢 {g.company}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>🚜 {g.machines.length} máquina(s) · 🛠️ {totalAverias} avería(s)</Text>
                    </View>
                  </View>
                </Card>
              </TouchableOpacity>
              {open ? g.machines.map((mm) => {
                const rep = activeRepairByMachine.get(mm.machinery_id);
                const mac = machById.get(mm.machinery_id) ?? { id: mm.machinery_id, code: mm.code, tipo: mm.tipo, clasificacion: null, plate: null, serial: null, company: g.company, encargado: null, referencia: null, latitude: null, longitude: null, operational: true, last_horometro: null, horometro_base: null, horometro_maint_pending: false };
                return (
                  <Card key={mm.code}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{mm.code}{mm.tipo ? <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '400' }}>  ·  {mm.tipo}</Text> : null}</Text>
                    {(() => {
                      // Datos de la máquina (comunes a todas sus averías): placa/serial, ubicación, referencia, edificio.
                      const mi = mm.items[0];
                      const ident = [mi.plate, mi.serial].filter(Boolean).join(' · ');
                      const coords = coordText(mi.latitude, mi.longitude);
                      const edif = edificioText(mi.latitude, mi.longitude, mi.referencia);
                      return (
                        <View style={{ marginTop: 2, gap: 1 }}>
                          <Text style={{ color: colors.muted, fontSize: 12 }}>🔖 Placa / Serial: <Text style={{ color: colors.text, fontWeight: '600' }}>{ident || '—'}</Text></Text>
                          <Text style={{ color: colors.muted, fontSize: 12 }}>📍 Ubicación: <Text style={{ color: colors.text, fontWeight: '600' }}>{coords || '—'}</Text></Text>
                          {mi.referencia ? <Text style={{ color: colors.muted, fontSize: 12 }}>🧭 Referencia: <Text style={{ color: colors.text, fontWeight: '600' }}>{mi.referencia}</Text></Text> : null}
                          <Text style={{ color: colors.muted, fontSize: 12 }}>🏢 Edificio / sector: <Text style={{ color: colors.text, fontWeight: '600' }}>{edif}</Text></Text>
                        </View>
                      );
                    })()}
                    {mm.items.map((r) => (
                      <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
                        <Text style={{ fontSize: 24 }}>{MAT_ICON[r.material] ?? '🔧'}</Text>
                        <TouchableOpacity activeOpacity={0.7} onPress={() => setDetailReq(r)} style={{ flex: 1 }}>
                          <Text style={{ color: colors.text, fontWeight: '700' }}>{matLabel(r.material)}{r.quantity != null ? ` · ${r.quantity.toLocaleString()}` : ''}{r.photo_url ? '  📷' : ''}</Text>
                          {r.notes ? <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>{r.notes}</Text> : null}
                          <Text style={{ color: colors.muted, fontSize: 12 }}>👮 Reportó: <Text style={{ color: colors.text, fontWeight: '600' }}>{r.requestedByName || '—'}</Text></Text>
                          <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '700' }}>{fmtDT(r.created_at)} · ver detalle ›</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => marcarRealizado(r)} disabled={busy === r.id} style={{ backgroundColor: colors.success, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}>
                          <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>{busy === r.id ? '…' : '✓ Realizado'}</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                    {rep ? (
                      <View style={{ marginTop: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm, borderLeftWidth: 3, borderLeftColor: colors.warning }}>
                        <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 12 }}>🔧 En reparación desde {fmtDMY(rep.out_at)}{rep.estimated_days != null ? ` · estimado ${rep.estimated_days} día(s)` : ''}</Text>
                        {rep.createdByName ? <Text style={{ color: colors.muted, fontSize: 11 }}>👮 Enviada por {rep.createdByName}</Text> : null}
                        <TouchableOpacity onPress={() => openReturn(rep)} style={{ marginTop: spacing.xs, backgroundColor: colors.success, borderRadius: radius.md, paddingVertical: spacing.xs, alignItems: 'center' }}>
                          <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>✓ Registrar retorno operativo</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity onPress={() => openRepair(mac)} style={{ marginTop: spacing.sm, backgroundColor: colors.accentSoftBg, borderWidth: 1, borderColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                        <Text style={{ color: colors.accentSoftText, fontWeight: '800', fontSize: 12 }}>🔧 Enviar a reparación</Text>
                      </TouchableOpacity>
                    )}
                  </Card>
                );
              }) : null}
            </View>
            );
          })
        )
      ) : tab === 'reparacion' ? (
        enReparacion.length === 0 ? (
          <EmptyState title={esServicio ? 'Ninguna máquina en reparación' : 'Ninguna máquina en mantenimiento'} subtitle={esServicio ? 'Usa “🔧 Enviar a reparación” para registrar una salida al taller.' : 'Usa “🧰 Enviar a mantenimiento” cuando le toque el servicio programado a una máquina.'} />
        ) : (
          enReparacion.map((r) => (
            <Card key={r.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>{r.code}</Text>
                <Badge {...TIPO_BADGE(r.tipo)} />
              </View>
              {r.machineTipo ? <Text style={{ color: colors.muted, fontSize: 12 }}>🏷️ {r.machineTipo}</Text> : null}
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>🏢 {r.company}</Text>
              <Text style={{ color: colors.warning, fontSize: 13, fontWeight: '700', marginTop: spacing.xs }}>{esServicio ? '🔧 Salió a reparación' : '🧰 Entró a mantenimiento'}: {fmtDMY(r.out_at)}{r.estimated_days != null ? ` · estimado ${r.estimated_days} día(s)` : ''}</Text>
              {r.createdByName ? <Text style={{ color: colors.muted, fontSize: 11.5 }}>👮 Enviada por {r.createdByName}</Text> : null}
              {r.estimated_note ? <Text style={{ color: colors.muted, fontSize: 12 }}>🔧 Motivo: {r.estimated_note}</Text> : null}
              {r.work_done ? <Text style={{ color: colors.muted, fontSize: 12 }}>🔩 {r.work_done}</Text> : null}
              <TouchableOpacity onPress={() => openReturn(r)} style={{ marginTop: spacing.sm, backgroundColor: colors.success, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>✓ Registrar retorno operativo</Text>
              </TouchableOpacity>
            </Card>
          ))
        )
      ) : tab === 'historial' ? (
        historial.length === 0 && averiasResueltas.length === 0 ? (
          <EmptyState title={esServicio ? 'Sin reparaciones cerradas' : 'Sin mantenimientos cerrados'} subtitle={esServicio ? 'Las reparaciones terminadas y las averías marcadas como realizadas aparecerán aquí.' : 'Los mantenimientos preventivos terminados aparecerán aquí.'} />
        ) : (
        <>
          {/* AVERÍAS RESUELTAS (solo Servicio): las que se marcaron "realizado" sin pasar
              por el taller. Antes no se veían en ninguna parte — ver `averiasResueltas`. */}
          {averiasResueltas.length > 0 ? (
            <>
              <Text style={{ color: colors.muted, fontWeight: '800', fontSize: 12, marginBottom: spacing.xs }}>
                ✅ AVERÍAS RESUELTAS ({averiasResueltas.length})
              </Text>
              {averiasResueltas.map((r) => (
                <Card key={`req-${r.id}`}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>{r.code}</Text>
                    <Badge label={`🔧 ${matLabel(r.material)}`} tone="muted" />
                  </View>
                  {r.tipo ? <Text style={{ color: colors.muted, fontSize: 12 }}>🏷️ {r.tipo}</Text> : null}
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>🏢 {r.company}</Text>
                  {r.notes ? <Text style={{ color: colors.text, fontSize: 13, marginTop: spacing.xs }}>📝 {r.notes}</Text> : null}
                  <Text style={{ color: colors.text, fontSize: 13, marginTop: spacing.xs }}>
                    📅 {fmtDMY(r.created_at)} → {fmtDMY(r.resolved_at)} <Text style={{ color: colors.success, fontWeight: '700' }}>· Resuelta</Text>
                  </Text>
                  {r.requestedByName ? <Text style={{ color: colors.muted, fontSize: 11.5 }}>👮 Reportada por {r.requestedByName}</Text> : null}
                  {r.resolvedByName ? <Text style={{ color: colors.success, fontSize: 11.5, fontWeight: '700' }}>✅ Resuelta por {r.resolvedByName}</Text> : null}
                </Card>
              ))}
            </>
          ) : null}
          {historial.length > 0 && averiasResueltas.length > 0 ? (
            <Text style={{ color: colors.muted, fontWeight: '800', fontSize: 12, marginTop: spacing.sm, marginBottom: spacing.xs }}>
              🧰 PASARON POR EL TALLER ({historial.length})
            </Text>
          ) : null}
          {historial.map((r) => (
            <Card key={r.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>{r.code}</Text>
                <Badge {...TIPO_BADGE(r.tipo)} />
              </View>
              {r.machineTipo ? <Text style={{ color: colors.muted, fontSize: 12 }}>🏷️ {r.machineTipo}</Text> : null}
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>🏢 {r.company}</Text>
              <Text style={{ color: colors.text, fontSize: 13, marginTop: spacing.xs }}>📅 {fmtDMY(r.out_at)} → {fmtDMY(r.back_at)} <Text style={{ color: colors.success, fontWeight: '700' }}>· Operativa</Text></Text>
              {r.createdByName ? <Text style={{ color: colors.muted, fontSize: 11.5 }}>👮 Enviada por {r.createdByName}</Text> : null}
              {r.closedByName ? <Text style={{ color: colors.success, fontSize: 11.5, fontWeight: '700' }}>✅ Reactivada por {r.closedByName}</Text> : null}
              {r.work_done ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>🔩 Se cambió: {r.work_done}</Text> : null}
            </Card>
          ))}
        </>
        )
      ) : tab === 'horometros' ? (
        // ── ⏱️ HORÓMETROS: horas acumuladas + lo que falta para el mantenimiento ──
        (() => {
          const total = horometroList.length;
          const conAlerta = horometroList.filter((x) => !!x.alerta).length;
          const vencidas = horometroList.filter((x) => x.venc).length;
          // Con horómetro = ya tiene lectura registrada; Sin marcar = todavía no le marcan el horómetro.
          const conHorometro = horometroList.filter((x) => x.m.last_horometro != null).length;
          const sinMarcar = horometroList.filter((x) => x.m.last_horometro == null).length;
          type HF = 'all' | 'proximas' | 'vencidas' | 'con' | 'sin';
          // Los KPIs de arriba son botones: filtran la lista (toca de nuevo el activo para quitar el filtro).
          const shown = horometroList.filter((x) =>
            horoFilter === 'proximas' ? !!x.alerta
            : horoFilter === 'vencidas' ? x.venc
            : horoFilter === 'con' ? (x.m.last_horometro != null)
            : horoFilter === 'sin' ? (x.m.last_horometro == null)
            : true);
          const toggle = (f: HF) => setHoroFilter((cur) => (cur === f ? 'all' : f));
          const kpi = (f: HF, label: string, value: number, valueColor: string) => {
            const on = horoFilter === f || (f === 'all' && horoFilter === 'all');
            return (
              <TouchableOpacity onPress={() => toggle(f)} style={{ paddingBottom: 3, borderBottomWidth: 2, borderBottomColor: on ? colors.accent : 'transparent' }}>
                <Text style={{ color: colors.brandContrast, opacity: on ? 1 : 0.8, fontSize: 11 }}>{label}</Text>
                <Text style={{ color: valueColor, fontWeight: '900', fontSize: 22, fontVariant: ['tabular-nums'] as any }}>{value}</Text>
              </TouchableOpacity>
            );
          };
          return (
            <View>
              <Card style={{ backgroundColor: colors.brand }}>
                <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 15 }}>⏱️ Horómetros · mantenimiento preventivo</Text>
                <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: spacing.xs, flexWrap: 'wrap' }}>
                  {kpi('all', 'Máquinas', total, colors.brandContrast)}
                  {kpi('con', 'Con horómetro', conHorometro, colors.brandContrast)}
                  {kpi('sin', 'Sin marcar', sinMarcar, sinMarcar > 0 ? colors.accent : colors.brandContrast)}
                  {kpi('proximas', 'Próximas (≥200 h)', conAlerta, colors.accent)}
                  {kpi('vencidas', `Vencidas (≥${HOROMETRO_UMBRAL_ALTA} h)`, vencidas, colors.brandContrast)}
                </View>
                <Text style={{ color: colors.brandContrast, opacity: 0.7, fontSize: 10, marginTop: 4 }}>Toca un total para filtrar la lista. Objetivo de mantenimiento: {HOROMETRO_UMBRAL_ALTA} h acumuladas. Una vez vencida, la máquina se MANTIENE en la lista hasta que confirmes el mantenimiento (reparada + reiniciar horómetro). La lectura y la foto vienen de la última jornada registrada por el inspector/operador.</Text>
              </Card>

              {horoFilter !== 'all' ? (
                <TouchableOpacity onPress={() => setHoroFilter('all')} style={{ marginTop: spacing.sm, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>{(horoFilter === 'proximas' ? '⏱️ Próximas a mantenimiento' : horoFilter === 'vencidas' ? '🔴 Vencidas' : horoFilter === 'con' ? '✅ Con horómetro' : '⚠️ Sin marcar horómetro')} · {shown.length}  ✕ Quitar filtro</Text>
                </TouchableOpacity>
              ) : null}

              {horoLoading ? <View style={{ paddingVertical: spacing.md }}><Loading /></View> : null}
              {shown.length === 0 ? <EmptyState title="Sin resultados" subtitle={horoFilter === 'all' ? 'No hay máquinas para esta búsqueda.' : 'Ninguna máquina en este filtro.'} /> : null}

              {shown.map(({ m, acum, alerta, restante, venc, horo }) => {
                const pct = acum != null ? Math.min(1, acum / HOROMETRO_UMBRAL_ALTA) : 0;
                const vencido = venc;
                const barColor = alerta?.color ?? (vencido ? colors.danger : colors.success);
                const coords = coordText(m.latitude, m.longitude);
                const edif = edificioText(m.latitude, m.longitude, m.referencia);
                const ident = [m.plate, m.serial].filter(Boolean).join(' · ');
                const photo = horo?.photo ?? null;
                // Inspector(es) asignado(s): ☀️ día / 🌙 noche (mismo si cubre ambos turnos).
                const asig = asigByMachine[m.id];
                const inspTxt = asig
                  ? (asig.day && asig.night
                      ? (asig.day === asig.night ? `${asig.day} (☀️🌙)` : `☀️ ${asig.day} · 🌙 ${asig.night}`)
                      : asig.day ? `☀️ ${asig.day}` : asig.night ? `🌙 ${asig.night}` : '—')
                  : '—';
                return (
                  <Card key={m.id}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>🚜 {m.code}{m.tipo ? <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '400' }}>  ·  {m.tipo}</Text> : null}</Text>
                    <View style={{ marginTop: 3, gap: 1 }}>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>🏢 Empresa: <Text style={{ color: colors.text, fontWeight: '600' }}>{m.company}</Text></Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>👤 Encargado: <Text style={{ color: colors.text, fontWeight: '600' }}>{m.encargado || '—'}</Text></Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>👮 Inspector: <Text style={{ color: colors.text, fontWeight: '600' }}>{inspTxt}</Text></Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>🔖 Placa / Serial: <Text style={{ color: colors.text, fontWeight: '600' }}>{ident || '—'}</Text></Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>📍 Ubicación: <Text style={{ color: colors.text, fontWeight: '600' }}>{coords || '—'}</Text></Text>
                      {m.referencia ? <Text style={{ color: colors.muted, fontSize: 12 }}>🧭 Ref / Edificio: <Text style={{ color: colors.text, fontWeight: '600' }}>{m.referencia}</Text></Text> : null}
                      <Text style={{ color: colors.muted, fontSize: 12 }}>🏢 Edificio / sector: <Text style={{ color: colors.text, fontWeight: '600' }}>{edif}</Text></Text>
                    </View>

                    {/* Horas acumuladas + lo que falta para el mantenimiento */}
                    <View style={{ marginTop: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <View><Text style={{ color: colors.muted, fontSize: 11 }}>⏱️ Horómetro actual</Text><Text style={{ color: colors.text, fontWeight: '900', fontSize: 16, fontVariant: ['tabular-nums'] as any }}>{m.last_horometro != null ? m.last_horometro : '—'}</Text></View>
                        <View style={{ alignItems: 'center' }}><Text style={{ color: colors.muted, fontSize: 11 }}>📊 Acumuladas</Text><Text style={{ color: barColor, fontWeight: '900', fontSize: 16, fontVariant: ['tabular-nums'] as any }}>{acum != null ? `${acum} h` : '—'}</Text></View>
                        <View style={{ alignItems: 'flex-end' }}><Text style={{ color: colors.muted, fontSize: 11 }}>🎯 Falta</Text><Text style={{ color: vencido ? colors.danger : colors.text, fontWeight: '900', fontSize: 16, fontVariant: ['tabular-nums'] as any }}>{restante == null ? '—' : (restante > 0 ? `${restante} h` : 'Vencido')}</Text></View>
                      </View>
                      <View style={{ height: 8, backgroundColor: colors.border, borderRadius: 4, marginTop: spacing.xs, overflow: 'hidden' }}>
                        <View style={{ width: `${pct * 100}%`, height: 8, backgroundColor: barColor, borderRadius: 4 }} />
                      </View>
                      {alerta ? (
                        <Text style={{ color: alerta.color, fontWeight: '800', fontSize: 12, marginTop: 4 }}>{alerta.label} · próxima a mantenimiento</Text>
                      ) : vencido ? (
                        <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12, marginTop: 4 }}>🔴 Mantenimiento vencido</Text>
                      ) : m.last_horometro == null ? (
                        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>Sin lectura de horómetro registrada aún.</Text>
                      ) : null}
                    </View>

                    {/* Foto del horómetro (del inspector) + datos que ingresó */}
                    <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, alignItems: 'center' }}>
                      {photo ? (
                        <TouchableOpacity onPress={() => setHoroPhotoView(photo)}>
                          <Image source={{ uri: photo }} style={{ width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceAlt }} resizeMode="cover" />
                        </TouchableOpacity>
                      ) : (
                        <View style={{ width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 22 }}>📷</Text></View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>📷 Foto del horómetro (inspector){photo ? ' · toca para ampliar' : ' · sin foto'}</Text>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>📅 Última jornada: <Text style={{ color: colors.text, fontWeight: '600' }}>{horo?.at ? fmtDMY(horo.at) : '—'}</Text></Text>
                        {horo?.operator ? <Text style={{ color: colors.muted, fontSize: 12 }}>👷 Registró: <Text style={{ color: colors.text, fontWeight: '600' }}>{horo.operator}</Text></Text> : null}
                        {horo && (horo.inicial != null || horo.final != null) ? <Text style={{ color: colors.muted, fontSize: 12 }}>🕒 Lectura: <Text style={{ color: colors.text, fontWeight: '600' }}>{horo.inicial ?? '—'} → {horo.final ?? '—'}</Text></Text> : null}
                      </View>
                    </View>

                    <TouchableOpacity onPress={() => confirmarMantenimientoHorometro(m)} disabled={confirmingHoro === m.id || m.last_horometro == null} style={{ marginTop: spacing.sm, backgroundColor: colors.success, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: (confirmingHoro === m.id || m.last_horometro == null) ? 0.5 : 1 }}>
                      <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>{confirmingHoro === m.id ? 'Guardando…' : '✓ Confirmar mantenimiento · reiniciar horómetro'}</Text>
                    </TouchableOpacity>
                  </Card>
                );
              })}
              <View style={{ height: spacing.lg }} />
            </View>
          );
        })()
      ) : (
        // ── 📊 REPORTE / DASHBOARD ────────────────────────────────────────────
        (() => {
          // UNIVERSO = equipos con avería (machineStats) + equipos con inspección (aunque no
          // tengan avería). Así se cubren los 3 casos: avería+inspección, avería sin inspección,
          // e inspección sin avería.
          const statById = new Map(machineStats.map((s) => [s.id, s]));
          const universe = machineStats.map((s) => ({ ...s }));
          Object.keys(inspByMachine).forEach((id) => {
            if (statById.has(id)) return;
            const mac = machById.get(id); // rendimiento: índice en vez de machines.find()
            if (!mac) return; // inspección de un equipo ya inactivo/borrado
            universe.push({ id, code: mac.code, company: mac.company, plate: mac.plate, serial: mac.serial, clasificacion: mac.clasificacion, tipo: mac.tipo ?? null, total: 0, byMat: {} });
          });
          if (universe.length === 0) return <EmptyState title="Sin averías ni inspecciones" subtitle="Cuando se reporten averías o inspecciones podrás ver aquí el reporte y el dashboard." />;
          const gastoOf = (id: string) => gastoByMachine[id] ?? 0;
          const flaggedOf = (id: string) => { const ins = inspByMachine[id] ?? []; return ins.length ? (ins[0].items ?? []).filter((it: any) => it.nivel === 'warn' || it.nivel === 'bad').length : 0; };
          const hasInsp = (id: string) => (inspByMachine[id] ?? []).length > 0;
          // Caso de cada equipo.
          const casoOf = (id: string, total: number): 'con' | 'sin_insp' | 'sin_averia' => (total > 0 ? (hasInsp(id) ? 'con' : 'sin_insp') : 'sin_averia');
          const CASO_BADGE: Record<string, { label: string; color: string }> = {
            con: { label: '🔧🔍 Avería + inspección', color: colors.warning },
            sin_insp: { label: '🔧 Avería sin inspección', color: colors.danger },
            sin_averia: { label: '🔍 Inspección sin avería', color: colors.brandText },
          };
          // Conteo por caso (sobre el universo filtrado por clasificación).
          const clasValues = Array.from(new Set(universe.map((s) => s.clasificacion || 'Sin clasificación'))).sort(cmpText);
          // BUSCADOR: esta pestaña era la ÚNICA que no aplicaba el filtro de la caja de
          // búsqueda, aunque la caja se dibuja igual arriba y su placeholder promete
          // buscar por máquina/empresa/placa/serial. El usuario escribía y la lista no
          // se movía — "el buscador no funciona" (17-ago-2026). Se filtra el universo
          // ANTES de agrupar, para que los totales y el ranking cuadren con lo buscado.
          const byQuery = universe.filter((s) => matchesQ(s.code, s.company, s.plate, s.serial, s.clasificacion, s.tipo));
          const byClas = byQuery.filter((s) => repClasFilter === '__all__' || (s.clasificacion || 'Sin clasificación') === repClasFilter);
          const casoCount = { con: 0, sin_insp: 0, sin_averia: 0 };
          byClas.forEach((s) => { casoCount[casoOf(s.id, s.total)]++; });
          // Aplica también el filtro por caso.
          const statsF = byClas.filter((s) => repCaseFilter === 'all' || casoOf(s.id, s.total) === repCaseFilter);
          // Filas según el agrupador.
          type Row = { key: string; title: string; sub: string; total: number; gasto: number; caso?: 'con' | 'sin_insp' | 'sin_averia'; onPress?: () => void };
          let rows: Row[] = [];
          if (repGroupBy === 'equipo') {
            rows = statsF.map((s) => {
              const flagged = flaggedOf(s.id);
              const inspHint = hasInsp(s.id) ? ` · 🔍 ${flagged} obs.` : '';
              const ident = [s.plate, s.serial].filter(Boolean).join(' · ');
              return { key: s.id, title: s.code, sub: `${s.tipo ? `🏷️ ${s.tipo} · ` : ''}🏢 ${s.company}${ident ? ` · ${ident}` : ''}${inspHint}`, total: s.total, gasto: gastoOf(s.id), caso: casoOf(s.id, s.total), onPress: () => setRepDetailId(s.id) };
            });
          } else {
            const agg = new Map<string, { total: number; gasto: number; machs: Set<string> }>();
            statsF.forEach((s) => {
              const k = repGroupBy === 'empresa' ? s.company : (s.clasificacion || 'Sin clasificación');
              const g = agg.get(k) ?? { total: 0, gasto: 0, machs: new Set<string>() };
              g.total += s.total; g.gasto += gastoOf(s.id); g.machs.add(s.id); agg.set(k, g);
            });
            rows = Array.from(agg.entries()).map(([k, g]) => ({ key: k, title: k, sub: `🚜 ${g.machs.size} equipo(s)`, total: g.total, gasto: g.gasto }));
          }
          rows.sort((a, b) => b.total - a.total || b.gasto - a.gasto);
          const maxTotal = rows.reduce((m, r) => Math.max(m, r.total), 0) || 1;
          const grandAverias = rows.reduce((s, r) => s + r.total, 0);
          const grandGasto = rows.reduce((s, r) => s + r.gasto, 0);
          return (
            <View>
              {/* Totales */}
              <Card style={{ backgroundColor: colors.brand }}>
                <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 15 }}>📊 Reporte de averías + inspección</Text>
                <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs }}>
                  <View><Text style={{ color: colors.brandContrast, opacity: 0.8, fontSize: 11 }}>Total averías</Text><Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 22, fontVariant: ['tabular-nums'] as any }}>{grandAverias}</Text></View>
                  <View><Text style={{ color: colors.brandContrast, opacity: 0.8, fontSize: 11 }}>Gasto total</Text><Text style={{ color: colors.accent, fontWeight: '900', fontSize: 22, fontVariant: ['tabular-nums'] as any }}>{usd(grandGasto)}</Text></View>
                </View>
                <Text style={{ color: colors.brandContrast, opacity: 0.7, fontSize: 10, marginTop: 4 }}>El gasto = materiales que salieron del almacén para cada equipo × su costo.</Text>
              </Card>

              {/* Filtro por CASO (los 3 estados) con su conteo */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.sm }}>
                <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                  {([['all', `Todos (${byClas.length})`, colors.brand], ['con', `🔧🔍 Avería + insp. (${casoCount.con})`, colors.warning], ['sin_insp', `🔧 Avería sin insp. (${casoCount.sin_insp})`, colors.danger], ['sin_averia', `🔍 Insp. sin avería (${casoCount.sin_averia})`, colors.infoSoftBorder]] as const).map(([k, label, col]) => {
                    const on = repCaseFilter === k;
                    return (
                      <TouchableOpacity key={k} onPress={() => setRepCaseFilter(k)} style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? col : colors.border, backgroundColor: on ? col : colors.surfaceAlt }}>
                        <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>

              {/* Agrupador */}
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm }}>
                {([['equipo', '🚜 Equipo'], ['empresa', '🏢 Empresa'], ['tipo', '🏷️ Tipo']] as const).map(([k, label]) => {
                  const on = repGroupBy === k;
                  return (
                    <TouchableOpacity key={k} onPress={() => setRepGroupBy(k)} style={{ flex: 1, minWidth: 0, paddingVertical: spacing.xs, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}>
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 12 }} numberOfLines={1}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Filtro por tipo de maquinaria (clasificación) */}
              {clasValues.length > 1 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.sm }}>
                  <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                    {['__all__', ...clasValues].map((c) => {
                      const on = repClasFilter === c;
                      return (
                        <TouchableOpacity key={c} onPress={() => setRepClasFilter(c)} style={{ paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt }}>
                          <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{c === '__all__' ? 'Todos' : c}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </ScrollView>
              ) : null}

              {/* Exportar PDF */}
              <TouchableOpacity onPress={() => exportReportePdf()} style={{ marginTop: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>📄 Exportar reporte (PDF)</Text>
              </TouchableOpacity>

              {reportLoading ? <View style={{ paddingVertical: spacing.md }}><Loading /></View> : null}

              {/* Gráfico de barras: quién genera más averías */}
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.md, marginBottom: spacing.xs }}>Ranking por nº de averías{repGroupBy === 'equipo' ? ' · toca un equipo para ver el detalle' : ''}:</Text>
              {rows.length === 0 ? (
                <EmptyState title="Sin equipos en este filtro" subtitle="Prueba con otro caso o quita el filtro por tipo." />
              ) : null}
              {rows.map((r, i) => {
                const pct = Math.max(0.06, r.total / maxTotal);
                const badge = r.caso ? CASO_BADGE[r.caso] : null;
                const barColor = r.caso === 'sin_averia' ? colors.infoSoftBorder : colors.warning;
                return (
                  <TouchableOpacity key={r.key} activeOpacity={r.onPress ? 0.7 : 1} onPress={r.onPress} style={{ marginBottom: spacing.sm }}>
                    <Card>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>{i + 1}. {r.title}{r.onPress ? '  ›' : ''}</Text>
                          <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>{r.sub}</Text>
                          {badge ? <Text style={{ color: badge.color, fontSize: 11, fontWeight: '800', marginTop: 2 }}>{badge.label}</Text> : null}
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={{ color: colors.warning, fontWeight: '900', fontSize: 16, fontVariant: ['tabular-nums'] as any }}>{r.total}</Text>
                          <Text style={{ color: colors.success, fontWeight: '700', fontSize: 12, fontVariant: ['tabular-nums'] as any }}>{usd(r.gasto)}</Text>
                        </View>
                      </View>
                      <View style={{ height: 8, backgroundColor: colors.surfaceAlt, borderRadius: 4, marginTop: spacing.xs, overflow: 'hidden' }}>
                        <View style={{ width: `${pct * 100}%`, height: 8, backgroundColor: barColor, borderRadius: 4 }} />
                      </View>
                    </Card>
                  </TouchableOpacity>
                );
              })}
              <View style={{ height: spacing.lg }} />
            </View>
          );
        })()
      )}

      {/* Modal: selector de máquina para enviar al taller */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '85%' }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17, marginBottom: spacing.sm }}>{esServicio ? 'Elige la máquina a reparar' : 'Elige la máquina a la que le toca mantenimiento'}</Text>
            <TextInput value={pickerQ} onChangeText={setPickerQ} placeholder="🔎 Buscar máquina o empresa…" placeholderTextColor={colors.muted} style={{ ...input, marginBottom: spacing.sm }} />
            <ScrollView>
              {pickerList.map((m) => {
                const inRep = activeRepairByMachine.has(m.id);
                return (
                  <TouchableOpacity key={m.id} onPress={() => !inRep && openRepair(m)} disabled={inRep} style={{ padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.xs, backgroundColor: colors.surface, opacity: inRep ? 0.5 : 1 }}>
                    {/* "en el taller" a secas: el bloqueo mira las reparaciones de LAS DOS
                        secciones, así que la máquina puede estar en un preventivo aunque
                        estemos en Servicio (o al revés). Decir "en reparación" aquí sería
                        mentira la mitad de las veces. */}
                    <Text style={{ color: colors.text, fontWeight: '800' }}>{m.code}{inRep ? '  · ya está en el taller' : ''}</Text>
                    {m.tipo ? <Text style={{ color: colors.muted, fontSize: 12 }}>🏷️ {m.tipo}</Text> : null}
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{m.company}{m.operational ? '' : ' · No operativa'}</Text>
                  </TouchableOpacity>
                );
              })}
              {pickerList.length === 0 ? <EmptyState title="Sin resultados" subtitle="Prueba con otro nombre." /> : null}
            </ScrollView>
            <TouchableOpacity onPress={() => setPickerOpen(false)} style={{ marginTop: spacing.sm, padding: spacing.md, alignItems: 'center' }}>
              <Text style={{ color: colors.muted, fontWeight: '700' }}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal: enviar a reparación */}
      <Modal visible={!!repFor} transparent animationType="slide" onRequestClose={() => setRepFor(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '90%' }}>
            {repFor ? (
              <ScrollView>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>{esServicio ? '🔧 Enviar a reparación' : '🧰 Enviar a mantenimiento'}</Text>
                <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.sm }}>{repFor.code}{repFor.tipo ? ` · 🏷️ ${repFor.tipo}` : ''} · {repFor.company}</Text>

                {/* El tipo ya NO se escoge aquí: lo fija la sección. Si se pudiera
                    cambiar, el expediente se mudaría a la otra sección al guardarlo
                    y quien lo abrió no volvería a encontrarlo. */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs }}>
                  <Badge {...TIPO_BADGE(rTipo)} />
                  <Text style={{ color: colors.muted, fontSize: 11, flex: 1 }} numberOfLines={2}>
                    {esServicio ? 'Se registra como reparación correctiva (quedará en Servicio).' : 'Se registra como mantenimiento preventivo (quedará en Mantenimiento).'}
                  </Text>
                </View>

                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>{esServicio ? 'Fecha de salida a reparación' : 'Fecha de entrada a mantenimiento'}</Text>
                <DateField value={rOut} onChange={setROut} />

                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>{esServicio ? 'Motivo de la avería (obligatorio)' : 'Motivo del mantenimiento (obligatorio)'}</Text>
                <TextInput value={rNote} onChangeText={setRNote} placeholder={esServicio ? 'Ej. falla hidráulica, sin arranque, espera de repuesto…' : 'Ej. servicio de 250 h, cambio de aceite y filtros…'} placeholderTextColor={colors.muted} style={input} />

                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>¿Por cuánto tiempo? (días estimados, opcional)</Text>
                <TextInput value={rDays} onChangeText={(t) => setRDays(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" placeholder="Ej. 5" placeholderTextColor={colors.muted} style={input} />

                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>¿Qué se le va a cambiar? (opcional, se puede llenar al volver)</Text>
                <TextInput value={rWork} onChangeText={setRWork} placeholder="Ej. cambio de bomba hidráulica…" placeholderTextColor={colors.muted} multiline style={{ ...input, minHeight: 60 }} />

                <Text style={{ color: colors.warning, fontSize: 11, marginTop: spacing.sm }}>⚠️ Al enviar, la máquina queda marcada como “No operativa” en todo el sistema.</Text>

                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                  <TouchableOpacity onPress={() => setRepFor(null)} style={{ flex: 1, minWidth: 0, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={enviarReparacion} disabled={busy === 'rep' || !rNote.trim()} style={{ flex: 2, minWidth: 0, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.accent, opacity: (busy === 'rep' || !rNote.trim()) ? 0.7 : 1 }}>
                    <Text style={{ color: colors.accentContrast, fontWeight: '800', textAlign: 'center' }} numberOfLines={1} adjustsFontSizeToFit>{busy === 'rep' ? 'Guardando…' : (esServicio ? '🔧 Enviar a reparación' : '🧰 Enviar a mantenimiento')}</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ height: spacing.lg }} />
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Modal: detalle de la avería (datos de la máquina + la falla + foto) */}
      <Modal visible={!!detailReq} transparent animationType="slide" onRequestClose={() => setDetailReq(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '90%' }}>
            {detailReq ? (
              <ScrollView>
                <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18 }}>{MAT_ICON[detailReq.material] ?? '🔧'} {detailReq.code}</Text>
                <Text style={{ color: detailReq.operational ? colors.success : colors.danger, fontWeight: '700', fontSize: 12, marginTop: 2 }}>{detailReq.operational ? '● Operativa' : '● No operativa'}</Text>

                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, marginTop: spacing.md, marginBottom: spacing.xs }}>🚜 Datos de la máquina</Text>
                <View style={{ backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, gap: 3 }}>
                  <Text style={{ color: colors.muted, fontSize: 13 }}>🏢 Empresa: <Text style={{ color: colors.text, fontWeight: '700' }}>{detailReq.company}</Text></Text>
                  {detailReq.tipo ? <Text style={{ color: colors.muted, fontSize: 13 }}>🔧 Marca - Modelo: <Text style={{ color: colors.text, fontWeight: '700' }}>{detailReq.tipo}</Text></Text> : null}
                  {detailReq.plate ? <Text style={{ color: colors.muted, fontSize: 13 }}>🔖 Placa: <Text style={{ color: colors.text, fontWeight: '700' }}>{detailReq.plate}</Text></Text> : null}
                  {detailReq.serial ? <Text style={{ color: colors.muted, fontSize: 13 }}>#️⃣ Serial: <Text style={{ color: colors.text, fontWeight: '700' }}>{detailReq.serial}</Text></Text> : null}
                  <Text style={{ color: colors.muted, fontSize: 13 }}>📍 Ubicación: <Text style={{ color: colors.text, fontWeight: '700' }}>{coordText(detailReq.latitude, detailReq.longitude) || '—'}</Text></Text>
                  {detailReq.referencia ? <Text style={{ color: colors.muted, fontSize: 13 }}>🧭 Referencia: <Text style={{ color: colors.text, fontWeight: '700' }}>{detailReq.referencia}</Text></Text> : null}
                  <Text style={{ color: colors.muted, fontSize: 13 }}>🏢 Edificio / sector: <Text style={{ color: colors.text, fontWeight: '700' }}>{edificioText(detailReq.latitude, detailReq.longitude, detailReq.referencia)}</Text></Text>
                  {detailReq.last_horometro != null ? <Text style={{ color: colors.muted, fontSize: 13 }}>⏱️ Último horómetro: <Text style={{ color: colors.text, fontWeight: '700' }}>{detailReq.last_horometro}</Text></Text> : null}
                </View>

                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, marginTop: spacing.md, marginBottom: spacing.xs }}>🛠️ La falla</Text>
                <View style={{ backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, gap: 3 }}>
                  <Text style={{ color: colors.muted, fontSize: 13 }}>Necesita: <Text style={{ color: colors.text, fontWeight: '700' }}>{matLabel(detailReq.material)}{detailReq.quantity != null ? ` · ${detailReq.quantity.toLocaleString()}` : ''}</Text></Text>
                  {detailReq.notes ? <Text style={{ color: colors.muted, fontSize: 13 }}>Nota: <Text style={{ color: colors.text }}>{detailReq.notes}</Text></Text> : null}
                  <Text style={{ color: colors.muted, fontSize: 13 }}>👮 Reportó: <Text style={{ color: colors.text, fontWeight: '700' }}>{detailReq.requestedByName || '—'}</Text></Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>Reportada: {fmtDT(detailReq.created_at)}</Text>
                </View>

                {(() => {
                  // Galería: usa `photos` (varias) si existe; si no, cae a la única `photo_url`.
                  const gal = (detailReq.photos && detailReq.photos.length ? detailReq.photos : (detailReq.photo_url ? [detailReq.photo_url] : []));
                  return (
                    <>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, marginTop: spacing.md, marginBottom: spacing.xs }}>📷 Foto(s) de referencia{gal.length > 1 ? ` · ${gal.length}` : ''}</Text>
                      {gal.length ? gal.map((uri, i) => (
                        <Image key={`${uri}-${i}`} source={{ uri }} style={{ width: '100%', height: 240, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, marginBottom: spacing.sm }} resizeMode="cover" />
                      )) : (
                        <Text style={{ color: colors.muted, fontSize: 12 }}>Sin foto de referencia.</Text>
                      )}
                    </>
                  );
                })()}

                <TouchableOpacity onPress={() => setDetailReq(null)} style={{ marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
                </TouchableOpacity>
                <View style={{ height: spacing.lg }} />
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Modal: registrar retorno operativo */}
      <Modal visible={!!retFor} transparent animationType="slide" onRequestClose={() => setRetFor(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '90%' }}>
            {retFor ? (
              <ScrollView>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>✓ Retorno operativo</Text>
                <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.sm }}>{retFor.code}{retFor.machineTipo ? ` · 🏷️ ${retFor.machineTipo}` : ''} · salió el {fmtDMY(retFor.out_at)}</Text>

                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>¿Cuándo volvió operativa?</Text>
                <DateField value={retBack} onChange={setRetBack} />

                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>¿Qué se le cambió / reparó?</Text>
                <TextInput value={retWork} onChangeText={setRetWork} placeholder="Ej. se cambió la bomba hidráulica y filtros…" placeholderTextColor={colors.muted} multiline style={{ ...input, minHeight: 70 }} />

                <Text style={{ color: colors.success, fontSize: 11, marginTop: spacing.sm }}>✓ Al registrar, la máquina vuelve a “Operativa” en todo el sistema.</Text>

                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                  <TouchableOpacity onPress={() => setRetFor(null)} style={{ flex: 1, minWidth: 0, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={registrarRetorno} disabled={busy === 'ret'} style={{ flex: 2, minWidth: 0, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.success, opacity: busy === 'ret' ? 0.7 : 1 }}>
                    <Text style={{ color: colors.brandContrast, fontWeight: '800', textAlign: 'center' }} numberOfLines={1} adjustsFontSizeToFit>{busy === 'ret' ? 'Guardando…' : '✓ Marcar operativa'}</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ height: spacing.lg }} />
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Escáner de máquina para reportar una avería */}
      <Modal visible={scanOpen} animationType="slide" onRequestClose={() => setScanOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <QrScanner onClose={() => setScanOpen(false)} onDetected={onScanDetected} />
        </View>
      </Modal>

      {/* Formulario de AVERÍA (máquina escaneada) */}
      <Modal visible={!!avMachine} transparent animationType="fade" onRequestClose={() => setAvMachine(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, maxHeight: '90%' }}>
            {avMachine ? (
              <ScrollView>
                <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18, textAlign: 'center' }}>🛠️ Avería · {avMachine.code}</Text>
                {avMachine.tipo ? <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: 2 }}>🏷️ {avMachine.tipo}</Text> : null}
                {avMachine.plate ? <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: 2 }}>Placa: {avMachine.plate}</Text> : null}
                <Text style={{ color: colors.muted, fontSize: 13, marginTop: spacing.md, marginBottom: 4 }}>¿Qué necesita?</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                  {AV_MATERIALS.map((mt) => {
                    const on = avMaterial === mt.key;
                    return (
                      <TouchableOpacity key={mt.key} onPress={() => setAvMaterial(mt.key)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: on ? colors.brand : colors.surfaceAlt, borderWidth: 1, borderColor: on ? colors.brand : colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                        <Text>{mt.icon}</Text>
                        <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 13 }}>{mt.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {avMaterial === 'otro' ? (
                  <>
                    <Text style={{ color: colors.muted, fontSize: 13, marginTop: spacing.md, marginBottom: 4 }}>¿Qué falla presenta? (describe la avería)</Text>
                    <TextInput value={avNote} onChangeText={setAvNote} placeholder="Ej. no arranca, fuga de aceite…" placeholderTextColor={colors.muted} multiline style={{ ...input, minHeight: 64 }} />
                  </>
                ) : avMaterial ? (
                  <>
                    <Text style={{ color: colors.muted, fontSize: 13, marginTop: spacing.md, marginBottom: 4 }}>Cantidad (opcional)</Text>
                    <TextInput value={avQty} onChangeText={(t) => setAvQty(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" placeholder="Ej: 2" placeholderTextColor={colors.muted} style={input} />
                    <Text style={{ color: colors.muted, fontSize: 13, marginTop: spacing.md, marginBottom: 4 }}>Nota (obligatoria)</Text>
                    <TextInput value={avNote} onChangeText={setAvNote} placeholder="Detalle de la falla" placeholderTextColor={colors.muted} multiline style={{ ...input, minHeight: 60 }} />
                  </>
                ) : null}

                {avMaterial ? (
                  <TouchableOpacity onPress={subirFotoAveria} disabled={avPhotoUp} style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: avPhoto ? colors.success : colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
                    <Text style={{ color: avPhoto ? colors.success : colors.text, fontWeight: '700' }}>{avPhotoUp ? 'Subiendo…' : avPhoto ? '✓ Foto de referencia adjunta' : '📷 Foto de referencia (opcional)'}</Text>
                  </TouchableOpacity>
                ) : null}

                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                  <TouchableOpacity onPress={() => setAvMachine(null)} style={{ flex: 1, minWidth: 0, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={registrarAveria} disabled={avBusy || !avMaterial || !avNote.trim()} style={{ flex: 2, minWidth: 0, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.accent, opacity: (avBusy || !avMaterial || !avNote.trim()) ? 0.5 : 1 }}>
                    <Text style={{ color: colors.accentContrast, fontWeight: '900' }} numberOfLines={1} adjustsFontSizeToFit>{avBusy ? 'Guardando…' : 'Registrar avería'}</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ height: spacing.md }} />
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Modal: DETALLE de averías de un equipo (desde el dashboard) */}
      <Modal visible={!!repDetailId} transparent animationType="fade" onRequestClose={() => setRepDetailId(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, maxHeight: '90%' }}>
            {repDetailId ? (() => {
              // El equipo puede venir de las averías o SOLO de inspección (sin avería).
              const sStat = machineStats.find((x) => x.id === repDetailId);
              const mac = machById.get(repDetailId); // rendimiento: índice en vez de machines.find()
              const s = sStat ?? (mac ? { id: mac.id, code: mac.code, company: mac.company, plate: mac.plate, serial: mac.serial, clasificacion: mac.clasificacion, tipo: mac.tipo ?? null, total: 0, byMat: {} as Record<string, number> } : null);
              if (!s) return null;
              const list = reqs.filter((r) => r.machinery_id === repDetailId).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
              const gasto = gastoByMachine[repDetailId] ?? 0;
              const ident = [s.plate, s.serial].filter(Boolean).join(' · ');
              const matEntries = Object.entries(s.byMat).sort((a, b) => b[1] - a[1]);
              return (
                <ScrollView>
                  <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18 }}>🚜 {s.code}</Text>
                  <View style={{ backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, marginTop: spacing.sm, gap: 3 }}>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>🏢 Empresa: <Text style={{ color: colors.text, fontWeight: '700' }}>{s.company}</Text></Text>
                    {s.tipo ? <Text style={{ color: colors.muted, fontSize: 13 }}>🏷️ Marca - Modelo: <Text style={{ color: colors.text, fontWeight: '700' }}>{s.tipo}</Text></Text> : null}
                    {s.clasificacion ? <Text style={{ color: colors.muted, fontSize: 13 }}>🗂️ Tipo: <Text style={{ color: colors.text, fontWeight: '700' }}>{s.clasificacion}</Text></Text> : null}
                    {ident ? <Text style={{ color: colors.muted, fontSize: 13 }}>🔖 Placa / Serial: <Text style={{ color: colors.text, fontWeight: '700' }}>{ident}</Text></Text> : null}
                  </View>

                  <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
                    <View style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>Total averías</Text>
                      <Text style={{ color: colors.warning, fontWeight: '900', fontSize: 20, fontVariant: ['tabular-nums'] as any }}>{s.total}</Text>
                    </View>
                    <View style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>Gasto generado</Text>
                      <Text style={{ color: colors.success, fontWeight: '900', fontSize: 20, fontVariant: ['tabular-nums'] as any }}>{usd(gasto)}</Text>
                    </View>
                  </View>

                  {matEntries.length ? (
                    <>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, marginTop: spacing.md, marginBottom: spacing.xs }}>Desglose por tipo</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                        {matEntries.map(([mat, n]) => (
                          <View key={mat} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                            <Text>{MAT_ICON[mat] ?? '🔧'}</Text>
                            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{matLabel(mat)}: {n}</Text>
                          </View>
                        ))}
                      </View>
                    </>
                  ) : null}

                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, marginTop: spacing.md, marginBottom: spacing.xs }}>Averías (con fecha)</Text>
                  {list.length === 0 ? (
                    <Text style={{ color: colors.muted, fontSize: 12 }}>Sin averías reportadas. Este equipo solo tiene inspección. 🔍</Text>
                  ) : null}
                  {list.map((r) => (
                    <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border }}>
                      <Text style={{ fontSize: 20 }}>{MAT_ICON[r.material] ?? '🔧'}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{matLabel(r.material)}{r.quantity != null ? ` · ${r.quantity.toLocaleString()}` : ''}{r.status === 'realizado' ? '  ✓' : ''}</Text>
                        {r.notes ? <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>{r.notes}</Text> : null}
                        <Text style={{ color: colors.muted, fontSize: 11 }}>{fmtDT(r.created_at)}</Text>
                      </View>
                    </View>
                  ))}

                  {/* Cruce con INSPECCIÓN DE MAQUINARIA: qué observó la última inspección del equipo. */}
                  {(() => {
                    const insps = inspByMachine[repDetailId] ?? [];
                    return (
                      <>
                        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, marginTop: spacing.md, marginBottom: spacing.xs }}>🔍 Inspección de maquinaria{insps.length ? ` (${insps.length})` : ''}</Text>
                        {insps.length === 0 ? (
                          <Text style={{ color: colors.muted, fontSize: 12 }}>Sin inspecciones registradas para este equipo.</Text>
                        ) : (() => {
                          const last = insps[0];
                          const flagged = (last.items ?? []).filter((it: any) => it.nivel === 'warn' || it.nivel === 'bad');
                          return (
                            <View style={{ backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, gap: 3 }}>
                              <Text style={{ color: colors.muted, fontSize: 13 }}>📅 Última: <Text style={{ color: colors.text, fontWeight: '700' }}>{fmtDMY(last.inspected_at)}</Text>{last.inspector_name ? <Text style={{ color: colors.text }}>  ·  🪖 {last.inspector_name}</Text> : null}</Text>
                              {last.condicion_general ? <Text style={{ color: colors.muted, fontSize: 13 }}>Condición general: <Text style={{ color: colors.text, fontWeight: '700' }}>{last.condicion_general}</Text></Text> : null}
                              {flagged.length ? (
                                <View style={{ marginTop: 2 }}>
                                  <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 12 }}>⚠️ Puntos observados en la inspección ({flagged.length}):</Text>
                                  {flagged.map((it: any, i: number) => (
                                    <Text key={i} style={{ color: colors.text, fontSize: 12, marginTop: 1 }}>{it.nivel === 'bad' ? '🔴' : '🟠'} {it.descripcion}{it.estado ? <Text style={{ color: colors.muted }}> · {it.estado}</Text> : null}</Text>
                                  ))}
                                </View>
                              ) : (
                                <Text style={{ color: colors.success, fontSize: 12, fontWeight: '700', marginTop: 2 }}>✓ Sin puntos observados en la última inspección.</Text>
                              )}
                            </View>
                          );
                        })()}
                      </>
                    );
                  })()}

                  <TouchableOpacity onPress={() => setRepDetailId(null)} style={{ marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
                  </TouchableOpacity>
                  <View style={{ height: spacing.md }} />
                </ScrollView>
              );
            })() : null}
          </View>
        </View>
      </Modal>
      {/* Modal: foto del horómetro ampliada (la que colocó el inspector/operador) */}
      <Modal visible={!!horoPhotoView} transparent animationType="fade" onRequestClose={() => setHoroPhotoView(null)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setHoroPhotoView(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', padding: spacing.lg }}>
          {horoPhotoView ? <Image source={{ uri: horoPhotoView }} style={{ width: '100%', height: '80%' }} resizeMode="contain" /> : null}
          <Text style={{ color: '#fff', textAlign: 'center', marginTop: spacing.md, fontWeight: '700' }}>Toca para cerrar</Text>
        </TouchableOpacity>
      </Modal>
    </Screen>
  );
}

/** 🧰 MANTENIMIENTO — sección de lo PROGRAMADO (horómetros y preventivos). */
export default function MantenimientoMaquinariaScreen() {
  return <TallerMaquinariaScreen seccion="mantenimiento" />;
}
