// Módulo de Fabricación (MRP) — Fase 3: Órdenes de trabajo. Vista de GESTIÓN
// (oficina/escritorio) sobre las work_orders que ya crea ManufacturingOrdersScreen
// al iniciar la producción de una orden de manufactura (esta pantalla NO crea
// MOs ni WOs desde cero): asigna operador, monitorea el estado de cada paso,
// registra avance de cantidad, reporta fallas y resuelve el punto de control
// de calidad cuando el paso lo requiere. Reutiliza el mismo permiso de módulo
// que el resto de Fabricación ('mangueras' = "Fabricación"). La vista táctil
// de piso de planta (kiosco/QR) es una pantalla aparte, de una fase futura.
import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { useTable } from '../hooks/useTable';
import { supabase } from '../lib/supabase';
import { norm, cmpText, onlyDecimal } from '../lib/text';
import { useAuth } from '../context/AuthContext';
import { levelMeets } from '../lib/permissions';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../components/ConfirmProvider';
import { WorkOrder, WorkOrderStatus, WorkOrderQcResult, WoTimeLog } from '../types/database';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

type MoRow = { id: string; code: string; product_item_id: string | null; status: string };
type ProductRow = { id: string; name: string };
type WcRow = { id: string; code: string; name: string };
type ProfileRow = { id: string; full_name: string | null; cedula: string | null };
type Option = { label: string; value: string };

type Tone = 'info' | 'warning' | 'danger' | 'success';
function toneSoft(colors: any, tone: Tone) {
  switch (tone) {
    case 'success': return { bg: colors.successSoftBg, border: colors.successSoftBorder, text: colors.successSoftText };
    case 'warning': return { bg: colors.warningSoftBg, border: colors.warningSoftBorder, text: colors.warningSoftText };
    case 'danger': return { bg: colors.dangerSoftBg, border: colors.dangerSoftBorder, text: colors.dangerSoftText };
    default: return { bg: colors.infoSoftBg, border: colors.infoSoftBorder, text: colors.infoSoftText };
  }
}
function Pill({ label, tone, colors }: { label: string; tone: Tone; colors: any }) {
  const t = toneSoft(colors, tone);
  return (
    <View style={{ backgroundColor: t.bg, borderWidth: 1, borderColor: t.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color: t.text, fontSize: 12, fontWeight: '800' }}>{label}</Text>
    </View>
  );
}

const STATUS_INFO: Record<WorkOrderStatus, { label: string; tone: Tone }> = {
  pendiente: { label: '⏳ Pendiente', tone: 'warning' },
  en_proceso: { label: '🔧 En proceso', tone: 'info' },
  pausada: { label: '⏸️ Pausada', tone: 'warning' },
  completada: { label: '✅ Completada', tone: 'success' },
  cancelada: { label: '❌ Cancelada', tone: 'danger' },
};
const QC_INFO: Record<WorkOrderQcResult, { icon: string; label: string; tone: Tone }> = {
  pendiente: { icon: '⏳', label: '⏳ QC pendiente', tone: 'warning' },
  aprobado: { icon: '✅', label: '✅ QC aprobado', tone: 'success' },
  rechazado: { icon: '❌', label: '❌ QC rechazado', tone: 'danger' },
};
const STATUS_FILTERS: { key: '' | WorkOrderStatus; label: string }[] = [
  { key: '', label: 'Todas' },
  { key: 'pendiente', label: '⏳ Pendiente' },
  { key: 'en_proceso', label: '🔧 En proceso' },
  { key: 'pausada', label: '⏸️ Pausada' },
  { key: 'completada', label: '✅ Completada' },
  { key: 'cancelada', label: '❌ Cancelada' },
];
const EVENT_INFO: Record<string, { icon: string; label: string }> = {
  inicio: { icon: '▶️', label: 'Inicio' },
  pausa: { icon: '⏸️', label: 'Pausa' },
  reanudacion: { icon: '⏯️', label: 'Reanudación' },
  fin: { icon: '🏁', label: 'Finalizada' },
  falla: { icon: '⚠️', label: 'Falla' },
};

const fmtFechaHora = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`;
};

/** Selector buscable de operador (tabla `profiles`), mismo patrón visual que el
 *  buscador de máquina/producto de ManguerasScreen/RoutesScreen. */
function OperatorPicker({
  options,
  value,
  onChange,
}: {
  options: Option[];
  value: string;
  onChange: (v: string) => void;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const selected = options.find((o) => o.value === value);
  const query = norm(q.trim());
  const filtered = query ? options.filter((o) => norm(o.label).includes(query)) : options;
  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  return (
    <View>
      <TouchableOpacity
        onPress={() => setOpen((o) => !o)}
        activeOpacity={0.8}
        style={[input, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
      >
        <Text style={{ color: selected ? colors.text : colors.muted, fontSize: 14, flex: 1 }} numberOfLines={1}>
          {selected ? selected.label : 'Sin asignar — toca para elegir…'}
        </Text>
        <Text style={{ color: colors.primary, fontWeight: '800', marginLeft: spacing.sm }}>{open ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {open ? (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderTopWidth: 0, borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md, maxHeight: 240, overflow: 'hidden' }}>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="🔎 Buscar por nombre o cédula…"
            placeholderTextColor={colors.muted}
            style={{ padding: spacing.sm, color: colors.text, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}
          />
          <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {value ? (
              <TouchableOpacity
                onPress={() => { onChange(''); setOpen(false); setQ(''); }}
                style={{ paddingVertical: 10, paddingHorizontal: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }}
              >
                <Text style={{ color: colors.danger, fontSize: 13, fontWeight: '700' }}>✕ Quitar asignación</Text>
              </TouchableOpacity>
            ) : null}
            {filtered.length === 0 ? (
              <Text style={{ color: colors.muted, padding: spacing.md, fontSize: 13 }}>Sin resultados.</Text>
            ) : (
              filtered.map((o) => {
                const active = o.value === value;
                return (
                  <TouchableOpacity
                    key={o.value}
                    onPress={() => { onChange(o.value); setOpen(false); setQ(''); }}
                    style={{ paddingVertical: 10, paddingHorizontal: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: active ? colors.primary : 'transparent' }}
                  >
                    <Text style={{ color: active ? colors.primaryContrast : colors.text, fontSize: 14, fontWeight: active ? '800' : '500' }}>{o.label}</Text>
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

export default function WorkOrdersScreen() {
  const { colors } = useTheme();
  const { moduleLevel, session, fullName } = useAuth();
  const level = moduleLevel('mangueras');
  const toast = useToast();
  const confirm = useConfirm();

  if (level === 'none') {
    return (
      <Screen>
        <SectionTitle>Órdenes de trabajo</SectionTitle>
        <EmptyState title="Sin acceso" subtitle="No tienes permiso para ver este módulo. Pídeselo a un administrador." />
      </Screen>
    );
  }
  const canWrite = levelMeets(level, 'escritura');

  const { data: workOrders, loading, refetch } = useTable<WorkOrder>('work_orders', { orderBy: 'created_at', ascending: false, realtimeFrom: ['work_orders'] });
  const { data: logs, refetch: refetchLogs } = useTable<WoTimeLog>('wo_time_logs', { orderBy: 'created_at', ascending: false, realtimeFrom: ['wo_time_logs'] });
  const { data: mos } = useTable<MoRow>('manufacturing_orders', { select: 'id, code, product_item_id, status', orderBy: 'code' });
  const { data: products } = useTable<ProductRow>('inventory_items', { select: 'id, name' });
  const { data: workCenters } = useTable<WcRow>('work_centers', { select: 'id, code, name', orderBy: 'code' });
  const { data: profiles } = useTable<ProfileRow>('profiles', { select: 'id, full_name, cedula', orderBy: 'full_name' });

  const myId = session?.user?.id ?? null;
  const myName = fullName || 'Usuario';
  const myCedula = useMemo(() => (myId ? profiles.find((p) => p.id === myId)?.cedula ?? null : null), [profiles, myId]);

  const productMap = useMemo(() => {
    const m: Record<string, string> = {};
    products.forEach((p) => { m[p.id] = p.name; });
    return m;
  }, [products]);
  const moMap = useMemo(() => {
    const m: Record<string, { code: string; product: string }> = {};
    mos.forEach((mo) => { m[mo.id] = { code: mo.code, product: mo.product_item_id ? productMap[mo.product_item_id] ?? '' : '' }; });
    return m;
  }, [mos, productMap]);
  const wcMap = useMemo(() => {
    const m: Record<string, { code: string; name: string }> = {};
    workCenters.forEach((w) => { m[w.id] = { code: w.code, name: w.name }; });
    return m;
  }, [workCenters]);
  const profilesMap = useMemo(() => {
    const m: Record<string, { full_name: string | null; cedula: string | null }> = {};
    profiles.forEach((p) => { m[p.id] = { full_name: p.full_name, cedula: p.cedula }; });
    return m;
  }, [profiles]);
  const operatorOptions: Option[] = useMemo(
    () => profiles
      .slice()
      .sort((a, b) => cmpText(a.full_name || '', b.full_name || ''))
      .map((p) => ({ label: `${p.full_name || 'Usuario'}${p.cedula ? ` · CI ${p.cedula}` : ''}`, value: p.id })),
    [profiles]
  );

  // ── Filtros ─────────────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | WorkOrderStatus>('');
  const q = norm(query.trim());
  const shown = useMemo(() => {
    return workOrders
      .filter((w) => !statusFilter || w.status === statusFilter)
      .filter((w) => {
        if (!q) return true;
        const mo = moMap[w.mo_id];
        return norm(`${w.name} ${mo?.code ?? ''} ${mo?.product ?? ''}`).includes(q);
      });
  }, [workOrders, q, statusFilter, moMap]);

  // ── Detalle (panel de gestión de una WO) ───────────────────────────────
  const [openWoId, setOpenWoId] = useState('');
  const openWo = workOrders.find((w) => w.id === openWoId) || null;
  const woLogs = useMemo(() => logs.filter((l) => l.wo_id === openWoId).slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1)), [logs, openWoId]);

  const openDetail = (w: WorkOrder) => { if (!canWrite) return; setOpenWoId(w.id); };
  const closeDetail = () => {
    setOpenWoId('');
    setQtyInput(''); setScrapInput(''); setFallaOpen(false); setFallaNote(''); setRejectOpen(false); setRejectReason('');
  };

  const insertLog = async (payload: { event?: string | null; qty_delta?: number | null; note?: string | null }) => {
    if (!openWo) return;
    await supabase.from('wo_time_logs').insert({
      wo_id: openWo.id,
      event: payload.event ?? null,
      qty_delta: payload.qty_delta ?? null,
      note: payload.note ?? null,
      created_by: myId,
      operator_name: myName,
      operator_cedula: myCedula,
    });
  };

  // ── Asignar operador ────────────────────────────────────────────────────
  const [busyAssign, setBusyAssign] = useState(false);
  const asignarOperador = async (profileId: string) => {
    if (!openWo) return;
    setBusyAssign(true);
    const p = profileId ? profilesMap[profileId] : null;
    const { error } = await supabase.from('work_orders').update({
      assigned_operator_id: profileId || null,
      operator_name: p?.full_name ?? null,
      operator_cedula: p?.cedula ?? null,
    }).eq('id', openWo.id);
    setBusyAssign(false);
    if (error) { toast.error(error.message); return; }
    toast.success(profileId ? 'Operador asignado.' : 'Asignación quitada.');
    refetch();
  };

  // ── Transiciones de estado ──────────────────────────────────────────────
  const [busyStatus, setBusyStatus] = useState<string | null>(null);

  const iniciar = async () => {
    if (!openWo) return;
    setBusyStatus('iniciar');
    const { error } = await supabase.from('work_orders').update({
      status: 'en_proceso',
      started_at: openWo.started_at ?? new Date().toISOString(),
    }).eq('id', openWo.id);
    if (!error) await insertLog({ event: 'inicio' });
    setBusyStatus(null);
    if (error) { toast.error(error.message); return; }
    toast.success('Orden de trabajo iniciada.');
    refetch(); refetchLogs();
  };

  const pausar = async () => {
    if (!openWo) return;
    setBusyStatus('pausar');
    const { error } = await supabase.from('work_orders').update({ status: 'pausada' }).eq('id', openWo.id);
    if (!error) await insertLog({ event: 'pausa' });
    setBusyStatus(null);
    if (error) { toast.error(error.message); return; }
    toast.success('Orden pausada.');
    refetch(); refetchLogs();
  };

  // Guard síncrono (además de `busyStatus`, que solo bloquea el botón cuando
  // React ya volvió a renderizar): evita que un doble clic muy rápido en
  // "Reanudar" —antes de que se refleje el primer `refetch()`— dispare dos
  // inserciones de log 'reanudacion' y sume dos veces el intervalo pausado.
  const reanudarBusyRef = useRef(false);
  const reanudar = async () => {
    if (!openWo || reanudarBusyRef.current) return;
    reanudarBusyRef.current = true;
    setBusyStatus('reanudar');
    // Minutos pausados: tiempo desde la última 'pausa' registrada hasta ahora,
    // sumado a lo ya acumulado (no se lleva un cronómetro exacto, es suficiente).
    const ultimaPausa = woLogs.find((l) => l.event === 'pausa');
    const addMin = ultimaPausa ? Math.max(0, Math.round((Date.now() - new Date(ultimaPausa.created_at).getTime()) / 60000)) : 0;
    const nuevoPausedMinutes = (openWo.paused_minutes || 0) + addMin;
    const { error } = await supabase.from('work_orders').update({ status: 'en_proceso', paused_minutes: nuevoPausedMinutes }).eq('id', openWo.id);
    if (!error) await insertLog({ event: 'reanudacion' });
    setBusyStatus(null);
    reanudarBusyRef.current = false;
    if (error) { toast.error(error.message); return; }
    toast.success('Orden reanudada.');
    refetch(); refetchLogs();
  };

  const QC_PENDIENTE_MSG = 'Este paso requiere aprobación de calidad — apruébalo o recházalo antes de completar.';
  const completar = async () => {
    if (!openWo) return;
    // Chequeo del lado del cliente: evita el viaje a la base para el caso
    // esperado y muestra un mensaje humano en vez del error crudo del trigger.
    if (openWo.is_quality_checkpoint && openWo.qc_result === 'pendiente') {
      toast.error(QC_PENDIENTE_MSG);
      return;
    }
    setBusyStatus('completar');
    const { error } = await supabase.from('work_orders').update({ status: 'completada', ended_at: new Date().toISOString() }).eq('id', openWo.id);
    if (!error) await insertLog({ event: 'fin' });
    setBusyStatus(null);
    if (error) {
      // Respaldo por si el chequeo de arriba quedó desactualizado: el candado
      // real vive en el trigger `check_wo_quality_gate()` (ver
      // supabase/fabricacion_calidad_oee.sql), cuyo mensaje reconocible se
      // traduce aquí en vez de mostrar el texto técnico del error.
      if (/requiere aprobaci[oó]n de calidad/i.test(error.message)) {
        toast.error(QC_PENDIENTE_MSG);
      } else {
        toast.error(error.message);
      }
      return;
    }
    toast.success('Orden completada.');
    refetch(); refetchLogs();
  };

  const cancelar = async () => {
    if (!openWo) return;
    const ok = await confirm({ message: `¿Cancelar la orden de trabajo "${openWo.name}"? Esta acción no se puede deshacer.`, danger: true });
    if (!ok) return;
    setBusyStatus('cancelar');
    const { error } = await supabase.from('work_orders').update({ status: 'cancelada' }).eq('id', openWo.id);
    if (!error) await insertLog({ event: 'cancelada', note: 'Orden de trabajo cancelada.' });
    setBusyStatus(null);
    if (error) { toast.error(error.message); return; }
    toast.success('Orden cancelada.');
    refetch(); refetchLogs();
  };

  // ── Registrar cantidad ──────────────────────────────────────────────────
  const [qtyInput, setQtyInput] = useState('');
  const [busyQty, setBusyQty] = useState(false);
  const registrarCantidad = async () => {
    if (!openWo) return;
    const delta = Number(String(qtyInput).replace(',', '.')) || 0;
    if (delta <= 0) { toast.error('Ingresa una cantidad mayor a 0.'); return; }
    const nuevo = Math.min(openWo.qty_planned, (openWo.qty_completed || 0) + delta);
    const aplicado = nuevo - (openWo.qty_completed || 0);
    if (aplicado <= 0) { toast.error('Ya se alcanzó la cantidad planificada.'); return; }
    setBusyQty(true);
    const { error } = await supabase.from('work_orders').update({ qty_completed: nuevo }).eq('id', openWo.id);
    if (!error) await insertLog({ event: 'cantidad', qty_delta: aplicado, note: `Avance registrado: +${aplicado}` });
    setBusyQty(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Cantidad registrada.');
    setQtyInput('');
    refetch(); refetchLogs();
  };

  // ── Registrar scrap/merma ───────────────────────────────────────────────
  // `qty_scrap` ya existe en el esquema (fabricacion_ordenes.sql) y lo usa
  // ManufacturingReportsScreen para el % de calidad del OEE, pero hasta ahora
  // nada en esta pantalla lo cargaba — el KPI de calidad siempre daba 100%.
  const [scrapInput, setScrapInput] = useState('');
  const [busyScrap, setBusyScrap] = useState(false);
  const registrarScrap = async () => {
    if (!openWo) return;
    const delta = Number(String(scrapInput).replace(',', '.')) || 0;
    if (delta <= 0) { toast.error('Ingresa una cantidad de scrap mayor a 0.'); return; }
    setBusyScrap(true);
    const nuevo = (openWo.qty_scrap || 0) + delta;
    const { error } = await supabase.from('work_orders').update({ qty_scrap: nuevo }).eq('id', openWo.id);
    // No se usa qty_delta aquí (esa columna representa cantidad PRODUCIDA):
    // el monto queda en la nota para no confundirlo en la bitácora con avance real.
    if (!error) await insertLog({ event: 'cantidad', note: `♻️ Scrap/merma registrado: +${delta}` });
    setBusyScrap(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Scrap registrado.');
    setScrapInput('');
    refetch(); refetchLogs();
  };

  // ── Reportar falla ──────────────────────────────────────────────────────
  const [fallaOpen, setFallaOpen] = useState(false);
  const [fallaNote, setFallaNote] = useState('');
  const [busyFalla, setBusyFalla] = useState(false);
  const reportarFalla = async () => {
    if (!openWo) return;
    if (!fallaNote.trim()) { toast.error('Describe la falla.'); return; }
    setBusyFalla(true);
    const { error } = await supabase.from('work_orders').update({ status: 'pausada', stop_reason: fallaNote.trim() }).eq('id', openWo.id);
    if (!error) {
      // Se insertan DOS eventos: 'falla' (motivo, para auditoría) y 'pausa'
      // (el mismo tipo de evento que `reanudar()` busca como cierre del tramo
      // detenido y que la vista `wo_oee` usa para calcular pausada_seconds —
      // sin esto, el tiempo detenido por avería nunca se restaba del tiempo
      // "trabajado" y las horas de OEE quedaban infladas).
      await insertLog({ event: 'falla', note: fallaNote.trim() });
      await insertLog({ event: 'pausa', note: 'Pausa automática por falla reportada.' });
    }
    setBusyFalla(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Falla reportada. Orden pausada.');
    setFallaOpen(false); setFallaNote('');
    refetch(); refetchLogs();
  };

  // ── Control de calidad ──────────────────────────────────────────────────
  const [busyQc, setBusyQc] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const aprobarQc = async () => {
    if (!openWo) return;
    setBusyQc(true);
    const { error } = await supabase.from('work_orders').update({ qc_result: 'aprobado' }).eq('id', openWo.id);
    setBusyQc(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Control de calidad aprobado.');
    refetch();
  };
  const rechazarQc = async () => {
    if (!openWo) return;
    if (!rejectReason.trim()) { toast.error('Indica el motivo del rechazo.'); return; }
    setBusyQc(true);
    const { error } = await supabase.from('work_orders').update({
      qc_result: 'rechazado',
      qc_data: { ...(openWo.qc_data || {}), rejected_reason: rejectReason.trim() },
    }).eq('id', openWo.id);
    setBusyQc(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Control de calidad rechazado.');
    setRejectOpen(false); setRejectReason('');
    refetch();
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  const Btn = ({ label, onPress, color, disabled }: { label: string; onPress: () => void; color: string; disabled?: boolean }) => (
    <TouchableOpacity onPress={onPress} disabled={disabled} style={{ flexGrow: 1, flexBasis: 130, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: color, opacity: disabled ? 0.6 : 1 }}>
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{label}</Text>
    </TouchableOpacity>
  );

  if (loading && workOrders.length === 0) {
    return <Screen><Loading /></Screen>;
  }

  return (
    <Screen>
      <SectionTitle>🛠️ Órdenes de trabajo</SectionTitle>

      {workOrders.length === 0 ? (
        <EmptyState title="Sin órdenes de trabajo" subtitle="Todavía no se han creado órdenes de trabajo. Se generan al iniciar la producción de una orden de manufactura." />
      ) : (
        <>
          <TextInput value={query} onChangeText={setQuery} placeholder="🔎 Buscar por paso o código/producto de la MO…" placeholderTextColor={colors.muted} style={{ ...input, marginBottom: spacing.sm }} />

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm }}>
            {STATUS_FILTERS.map((f) => {
              const on = statusFilter === f.key;
              return (
                <TouchableOpacity key={f.key || 'all'} onPress={() => setStatusFilter(f.key)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
                  <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{f.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {shown.length === 0 ? (
            <EmptyState title="Sin resultados" subtitle="Prueba con otra búsqueda o quita algún filtro." />
          ) : (
            shown.map((w) => {
              const mo = moMap[w.mo_id];
              const wc = w.work_center_id ? wcMap[w.work_center_id] : undefined;
              const info = STATUS_INFO[w.status] ?? STATUS_INFO.pendiente;
              const qc = QC_INFO[w.qc_result] ?? QC_INFO.pendiente;
              const RowWrapper = canWrite ? TouchableOpacity : View;
              return (
                <RowWrapper key={w.id} {...(canWrite ? { onPress: () => openDetail(w), activeOpacity: 0.75 } : {})}>
                  <Card>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.xs }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>
                          {mo ? `${mo.code}${mo.product ? ` · ${mo.product}` : ''}` : '—'}
                        </Text>
                        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>
                          {w.wo_no}. {w.name}{w.is_quality_checkpoint ? ' 🔍' : ''}
                        </Text>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>🏭 {wc ? `${wc.code} · ${wc.name}` : 'Sin centro de trabajo'}</Text>
                      </View>
                      <View style={{ gap: 4, alignItems: 'flex-end' }}>
                        <Pill label={info.label} tone={info.tone} colors={colors} />
                        {w.is_quality_checkpoint ? <Pill label={qc.label} tone={qc.tone} colors={colors} /> : null}
                      </View>
                    </View>

                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.xs }}>
                      <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 12 }}>
                        📦 {w.qty_completed ?? 0}/{w.qty_planned ?? 0}
                      </Text>
                      {w.operator_name ? <Text style={{ color: colors.muted, fontSize: 12 }}>👷 {w.operator_name}</Text> : null}
                    </View>
                  </Card>
                </RowWrapper>
              );
            })
          )}
        </>
      )}

      {/* Panel de gestión de la orden de trabajo abierta */}
      <Modal visible={!!openWo} animationType="slide" onRequestClose={closeDetail}>
        <Screen>
          {openWo ? (
            <>
              <TouchableOpacity onPress={closeDetail}>
                <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 13, marginBottom: spacing.xs }}>← Cerrar</Text>
              </TouchableOpacity>

              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.xs }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>
                      {moMap[openWo.mo_id] ? `${moMap[openWo.mo_id].code}${moMap[openWo.mo_id].product ? ` · ${moMap[openWo.mo_id].product}` : ''}` : '—'}
                    </Text>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>{openWo.wo_no}. {openWo.name}</Text>
                    {openWo.description ? <Text style={{ color: colors.text, fontSize: 13 }}>{openWo.description}</Text> : null}
                  </View>
                  <Pill label={(STATUS_INFO[openWo.status] ?? STATUS_INFO.pendiente).label} tone={(STATUS_INFO[openWo.status] ?? STATUS_INFO.pendiente).tone} colors={colors} />
                </View>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  🏭 {openWo.work_center_id ? (wcMap[openWo.work_center_id] ? `${wcMap[openWo.work_center_id].code} · ${wcMap[openWo.work_center_id].name}` : '—') : 'Sin centro de trabajo'}
                  {'  ·  '}📦 {openWo.qty_completed ?? 0}/{openWo.qty_planned ?? 0}
                  {openWo.qty_scrap ? `  ·  ♻️ Scrap: ${openWo.qty_scrap}` : ''}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 11 }}>
                  Inicio {fmtFechaHora(openWo.started_at)} · Fin {fmtFechaHora(openWo.ended_at)} · Pausado {openWo.paused_minutes ?? 0} min
                </Text>
                {openWo.stop_reason ? <Text style={{ color: colors.danger, fontSize: 12 }}>⚠️ {openWo.stop_reason}</Text> : null}
              </Card>

              {canWrite ? (
                <Card>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>👷 Asignar operador</Text>
                  <OperatorPicker options={operatorOptions} value={openWo.assigned_operator_id ?? ''} onChange={asignarOperador} />
                  {busyAssign ? <Text style={{ color: colors.muted, fontSize: 11 }}>Guardando…</Text> : null}
                </Card>
              ) : openWo.operator_name ? (
                <Card>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>👷 Operador asignado</Text>
                  <Text style={{ color: colors.text, fontSize: 13 }}>{openWo.operator_name}</Text>
                </Card>
              ) : null}

              {openWo.is_quality_checkpoint ? (
                <Card>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>🔍 Control de calidad</Text>
                  <Pill label={(QC_INFO[openWo.qc_result] ?? QC_INFO.pendiente).label} tone={(QC_INFO[openWo.qc_result] ?? QC_INFO.pendiente).tone} colors={colors} />
                  {openWo.qc_data?.rejected_reason ? (
                    <Text style={{ color: colors.danger, fontSize: 12 }}>Motivo del rechazo: {openWo.qc_data.rejected_reason}</Text>
                  ) : null}
                  {canWrite && openWo.qc_result === 'pendiente' ? (
                    <>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
                        <Btn label="✅ Aprobar" color="#059669" disabled={busyQc} onPress={aprobarQc} />
                        <Btn label="❌ Rechazar" color="#B91C1C" disabled={busyQc} onPress={() => setRejectOpen((v) => !v)} />
                      </View>
                      {rejectOpen ? (
                        <View style={{ marginTop: spacing.xs, gap: spacing.xs }}>
                          <TextInput value={rejectReason} onChangeText={setRejectReason} placeholder="Motivo del rechazo…" placeholderTextColor={colors.muted} style={input} />
                          <Btn label="Confirmar rechazo" color="#B91C1C" disabled={busyQc} onPress={rechazarQc} />
                        </View>
                      ) : null}
                    </>
                  ) : null}
                </Card>
              ) : null}

              {canWrite ? (
                <Card>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>⚙️ Estado</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                    {openWo.status === 'pendiente' ? (
                      <Btn label="▶️ Iniciar" color="#2563EB" disabled={busyStatus === 'iniciar'} onPress={iniciar} />
                    ) : null}
                    {openWo.status === 'en_proceso' ? (
                      <>
                        <Btn label="⏸️ Pausar" color="#D97706" disabled={busyStatus === 'pausar'} onPress={pausar} />
                        <Btn label="✅ Completar" color="#059669" disabled={busyStatus === 'completar'} onPress={completar} />
                        <Btn label="⚠️ Reportar falla" color="#B91C1C" disabled={busyFalla} onPress={() => setFallaOpen((v) => !v)} />
                      </>
                    ) : null}
                    {openWo.status === 'pausada' ? (
                      <Btn label="▶️ Reanudar" color="#2563EB" disabled={busyStatus === 'reanudar'} onPress={reanudar} />
                    ) : null}
                    {(openWo.status === 'pendiente' || openWo.status === 'en_proceso' || openWo.status === 'pausada') ? (
                      <Btn label="🚫 Cancelar" color="#64748B" disabled={busyStatus === 'cancelar'} onPress={cancelar} />
                    ) : null}
                  </View>
                  {openWo.is_quality_checkpoint && openWo.qc_result === 'pendiente' && openWo.status === 'en_proceso' ? (
                    <Text style={{ color: colors.muted, fontSize: 11 }}>Debes aprobar o rechazar el control de calidad para poder completar esta orden.</Text>
                  ) : null}

                  {fallaOpen ? (
                    <View style={{ marginTop: spacing.xs, gap: spacing.xs }}>
                      <TextInput value={fallaNote} onChangeText={setFallaNote} placeholder="Describe la falla…" placeholderTextColor={colors.muted} style={input} />
                      <Btn label="Reportar y pausar" color="#B91C1C" disabled={busyFalla} onPress={reportarFalla} />
                    </View>
                  ) : null}

                  {(openWo.status === 'en_proceso' || openWo.status === 'pausada') ? (
                    <View style={{ marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.xs }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>📦 Registrar cantidad</Text>
                      <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }}>
                        <TextInput
                          value={qtyInput}
                          onChangeText={(t) => setQtyInput(onlyDecimal(t))}
                          placeholder="0"
                          placeholderTextColor={colors.muted}
                          keyboardType="numeric"
                          inputMode="numeric"
                          style={[input, { flex: 1 }]}
                        />
                        <TouchableOpacity onPress={registrarCantidad} disabled={busyQty} style={{ backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, opacity: busyQty ? 0.6 : 1 }}>
                          <Text style={{ color: colors.primaryContrast, fontWeight: '700', fontSize: 13 }}>Registrar</Text>
                        </TouchableOpacity>
                      </View>

                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, marginTop: spacing.xs }}>♻️ Registrar scrap/merma (opcional)</Text>
                      <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }}>
                        <TextInput
                          value={scrapInput}
                          onChangeText={(t) => setScrapInput(onlyDecimal(t))}
                          placeholder="0"
                          placeholderTextColor={colors.muted}
                          keyboardType="numeric"
                          inputMode="numeric"
                          style={[input, { flex: 1 }]}
                        />
                        <TouchableOpacity onPress={registrarScrap} disabled={busyScrap} style={{ backgroundColor: '#B91C1C', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, opacity: busyScrap ? 0.6 : 1 }}>
                          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Registrar</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : null}
                </Card>
              ) : null}

              <SectionTitle>🕒 Bitácora</SectionTitle>
              {woLogs.length === 0 ? (
                <EmptyState title="Sin movimientos" subtitle="Esta orden todavía no tiene eventos registrados." />
              ) : (
                woLogs.map((l) => {
                  const ev = l.event ? (EVENT_INFO[l.event] ?? { icon: '📝', label: l.event }) : { icon: '📝', label: 'Avance' };
                  return (
                    <Card key={l.id}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.xs }}>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{ev.icon} {ev.label}{l.qty_delta ? ` (+${l.qty_delta})` : ''}</Text>
                        <Text style={{ color: colors.muted, fontSize: 11 }}>{fmtFechaHora(l.created_at)}</Text>
                      </View>
                      {l.note ? <Text style={{ color: colors.text, fontSize: 12 }}>{l.note}</Text> : null}
                      <Text style={{ color: colors.muted, fontSize: 11 }}>{l.operator_name || 'Usuario'}</Text>
                    </Card>
                  );
                })
              )}

              <View style={{ height: spacing.lg }} />
            </>
          ) : null}
        </Screen>
      </Modal>

      <View style={{ height: spacing.lg }} />
    </Screen>
  );
}
