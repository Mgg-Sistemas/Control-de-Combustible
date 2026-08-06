// Módulo de Fabricación (MRP) — Fase 4: Kiosco de planta. Pantalla táctil,
// pensada para tablets de piso de planta, para que un operador trabaje una
// orden de trabajo (work_orders) SIN tener que navegar la vista de gestión de
// oficina (`WorkOrdersScreen.tsx`, que se mantiene intacta). Reutiliza las
// MISMAS acciones/columnas de esa pantalla (iniciar/pausar/reanudar/completar/
// cancelar → aquí sin cancelar, es de oficina; registrar cantidad; reportar
// falla) contra `work_orders` + `wo_time_logs`.
//
// Identificación del operador: el kiosco NO pide iniciar sesión individual por
// operador (así lo anticipa el comentario de `work_orders.operator_name` en
// supabase/fabricacion_ordenes.sql: "para operación desde kiosco sin cuenta
// individual"). Se reutiliza el mismo patrón de identificación por carnet/QR
// que ya usa `MachineQuickScreen.tsx` (puerta de identificación anónima):
// escanea el QR de su carnet (`QrScanner` + `parseEmployeeId`) o escribe su
// cédula, y se busca en RRHH con la RPC pública `employee_public_lookup`
// (misma RPC, mismo mecanismo). Si esa cédula coincide con un usuario real en
// `profiles`, se enlaza `assigned_operator_id`; si no, igual queda el
// snapshot de texto `operator_name`/`operator_cedula` (que es justo para lo
// que están esas columnas).
//
// Identidad de SESIÓN (fix de auditoría): antes solo se identificaba al
// operador al tocar INICIAR; el resto de acciones (pausar, registrar
// cantidad, reportar falla, finalizar) quedaban grabadas en `wo_time_logs`
// con la identidad de quien inició, aunque en la práctica las hiciera otra
// persona. Pedir carnet/cédula en CADA botón es demasiado disruptivo para una
// tablet compartida de taller, así que se pide UNA vez por "sesión de uso del
// kiosco" (se guarda en `sessionOperator`, se limpia al cambiar de orden/
// centro vía `resetPanels`) y esa identidad se usa para TODAS las acciones de
// esa sesión (ver `insertLog` e `requireSession` más abajo), en vez de
// arrastrar siempre la identidad grabada en el INICIO de la WO.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ActivityIndicator } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { useTable } from '../hooks/useTable';
import { supabase } from '../lib/supabase';
import { norm, cmpText, onlyDecimal, onlyDigits } from '../lib/text';
import { useAuth } from '../context/AuthContext';
import { levelMeets } from '../lib/permissions';
import { useToast } from '../components/ToastProvider';
import QrScanner from '../components/QrScanner';
import { parseEmployeeId } from './ScanQrScreen';
import { isOperatorCargo } from '../lib/jornada';
import { WorkOrder, WorkOrderStatus, WoTimeLogEvent } from '../types/database';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

type WcRow = { id: string; code: string; name: string; active: boolean };
type MoRow = { id: string; code: string; product_item_id: string | null; company_id: string | null; company?: { name: string } | null };
type ProductRow = { id: string; name: string };
type ProfileRow = { id: string; cedula: string | null };
type IdentifiedOperator = { id: string; name: string; cedula: string; cargo: string | null; companyId?: string | null; companyName?: string | null };

// Estados de WO que el kiosco todavía puede trabajar (lo ya cerrado/cancelado
// no aparece en el paso 2 — eso se gestiona desde la oficina).
const OPEN_STATUSES: WorkOrderStatus[] = ['pendiente', 'en_proceso', 'pausada'];

const FALLA_PRESETS = ['Falta de material', 'Falla mecánica', 'Falta de personal', 'Otro'];

function statusStyle(status: WorkOrderStatus, colors: any): { label: string; bg: string; fg: string } {
  switch (status) {
    case 'en_proceso': return { label: '🔧 En proceso', bg: colors.success, fg: '#fff' };
    case 'pausada': return { label: '⏸️ Pausada', bg: colors.warning, fg: '#fff' };
    case 'completada': return { label: '✅ Completada', bg: colors.success, fg: '#fff' };
    case 'cancelada': return { label: '🚫 Cancelada', bg: colors.danger, fg: '#fff' };
    default: return { label: '⏳ Pendiente', bg: colors.muted, fg: '#fff' };
  }
}

/** Botón grande de kiosco: icono + etiqueta, alto mínimo 56px, fuente 32px+. */
function BigButton({
  label, sub, bg, fg, onPress, disabled,
}: { label: string; sub?: string; bg: string; fg: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      style={{ backgroundColor: bg, borderRadius: radius.lg, minHeight: 72, paddingVertical: spacing.lg, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md, opacity: disabled ? 0.55 : 1 }}
    >
      <Text style={{ color: fg, fontWeight: '900', fontSize: 24, textAlign: 'center', letterSpacing: 0.3 }}>{label}</Text>
      {sub ? <Text style={{ color: fg, opacity: 0.9, fontSize: 13, marginTop: 6, textAlign: 'center' }}>{sub}</Text> : null}
    </TouchableOpacity>
  );
}

export default function PlantaKioskScreen() {
  const { colors } = useTheme();
  const { moduleLevel, session } = useAuth();
  const level = moduleLevel('fabricacion_planta');
  const toast = useToast();
  const myId = session?.user?.id ?? null;

  if (level === 'none') {
    return (
      <Screen>
        <SectionTitle>🏭 Kiosco de planta</SectionTitle>
        <EmptyState title="Sin acceso" subtitle="No tienes permiso para ver este módulo. Pídeselo a un administrador." />
      </Screen>
    );
  }
  const canWrite = levelMeets(level, 'escritura');

  const { data: workCenters, loading: loadingWc } = useTable<WcRow>('work_centers', { select: 'id,code,name,active', orderBy: 'code' });
  const { data: workOrders, loading: loadingWo, refetch } = useTable<WorkOrder>('work_orders', { orderBy: 'wo_no', realtimeFrom: ['work_orders'] });
  const { data: mos } = useTable<MoRow>('manufacturing_orders', { select: 'id, code, product_item_id, company_id, company:company_id(name)' });
  const { data: products } = useTable<ProductRow>('inventory_items', { select: 'id, name' });
  const { data: profiles } = useTable<ProfileRow>('profiles', { select: 'id, cedula' });

  const productMap = useMemo(() => {
    const m: Record<string, string> = {};
    products.forEach((p) => { m[p.id] = p.name; });
    return m;
  }, [products]);
  const moMap = useMemo(() => {
    // companyId/companyName: usados por el FIX 2 (validación de empresa del
    // operador vs. empresa de la orden, misma comparación que MachineQuickScreen
    // hace contra `machinery.company_id`, aquí contra `manufacturing_orders.company_id`
    // — `work_centers` no tiene columna de empresa propia).
    const m: Record<string, { code: string; product: string; companyId: string | null; companyName: string | null }> = {};
    mos.forEach((mo) => {
      m[mo.id] = {
        code: mo.code,
        product: mo.product_item_id ? productMap[mo.product_item_id] ?? '' : '',
        companyId: mo.company_id ?? null,
        companyName: mo.company?.name ?? null,
      };
    });
    return m;
  }, [mos, productMap]);
  const profilesByCedula = useMemo(() => {
    const m: Record<string, string> = {};
    profiles.forEach((p) => { if (p.cedula) m[onlyDigits(p.cedula)] = p.id; });
    return m;
  }, [profiles]);

  const activeWcs = useMemo(
    () => workCenters.filter((w) => w.active).slice().sort((a, b) => cmpText(a.code, b.code)),
    [workCenters]
  );

  // ── Paso 1: centro de trabajo ────────────────────────────────────────────
  const [step, setStep] = useState<'centro' | 'orden' | 'accion'>('centro');
  const [wcQuery, setWcQuery] = useState('');
  const [selectedWcId, setSelectedWcId] = useState('');
  const selectedWc = activeWcs.find((w) => w.id === selectedWcId) || null;
  const qWc = norm(wcQuery.trim());
  const shownWcs = useMemo(
    () => activeWcs.filter((w) => !qWc || norm(`${w.code} ${w.name}`).includes(qWc)),
    [activeWcs, qWc]
  );

  const pickWc = (w: WcRow) => { setSelectedWcId(w.id); setStep('orden'); };

  // ── Paso 2: orden de trabajo ─────────────────────────────────────────────
  const [selectedWoId, setSelectedWoId] = useState('');
  const selectedWo = workOrders.find((w) => w.id === selectedWoId) || null;
  const woList = useMemo(
    () => workOrders
      .filter((w) => w.work_center_id === selectedWcId && OPEN_STATUSES.includes(w.status))
      .slice()
      .sort((a, b) => a.wo_no - b.wo_no),
    [workOrders, selectedWcId]
  );

  const pickWo = (w: WorkOrder) => { setSelectedWoId(w.id); setStep('accion'); resetPanels(); };
  const backToOrden = () => { setStep('orden'); resetPanels(); };
  const backToCentro = () => { setStep('centro'); setSelectedWcId(''); setSelectedWoId(''); resetPanels(); };

  function resetPanels() {
    setIdentOpen(false); setIdentScanOpen(false); setIdentCedula(''); setIdentEmp(null);
    setIdentMode('inicio'); setIdentPendingAction(null); setSessionOperator(null);
    setQtyOpen(false); setQtyInput('');
    setFallaOpen(false); setFallaPreset(null); setFallaNote('');
  }

  const insertLog = async (event: WoTimeLogEvent, extra?: { qty_delta?: number; note?: string; operator_name?: string | null; operator_cedula?: string | null }) => {
    if (!selectedWo) return;
    await supabase.from('wo_time_logs').insert({
      wo_id: selectedWo.id,
      event,
      qty_delta: extra?.qty_delta ?? null,
      note: extra?.note ?? null,
      created_by: myId,
      // FIX 1: prioriza la identidad explícita (`extra`, usada por confirmarInicio),
      // luego la identidad de SESIÓN del kiosco (quien se identificó para pausar/
      // registrar/reportar falla/finalizar en esta sesión), y solo como último
      // recurso el snapshot que quedó grabado en la WO al iniciarla — así la
      // bitácora no queda siempre firmada por quien hizo el INICIAR.
      operator_name: extra?.operator_name ?? sessionOperator?.name ?? selectedWo.operator_name ?? null,
      operator_cedula: extra?.operator_cedula ?? sessionOperator?.cedula ?? selectedWo.operator_cedula ?? null,
    });
  };

  // ── Identificación del operador (puerta previa a INICIAR, y puerta de
  //    SESIÓN reutilizada por el resto de acciones — ver `requireSession`) ──
  const [identOpen, setIdentOpen] = useState(false);
  const [identScanOpen, setIdentScanOpen] = useState(false);
  const [identCedula, setIdentCedula] = useState('');
  const [identEmp, setIdentEmp] = useState<IdentifiedOperator | null>(null);
  const [identSearching, setIdentSearching] = useState(false);
  const [identBusy, setIdentBusy] = useState(false);
  // 'inicio': la puerta de identificación arranca la WO (confirmarInicio).
  // 'sesion': la puerta solo identifica a quien va a operar el kiosco ahora
  //           (pausar/registrar/reportar falla/finalizar/reanudar) — no toca started_at.
  const [identMode, setIdentMode] = useState<'inicio' | 'sesion'>('inicio');
  const [identPendingAction, setIdentPendingAction] = useState<(() => void) | null>(null);
  const [sessionOperator, setSessionOperator] = useState<IdentifiedOperator | null>(null);

  useEffect(() => {
    if (!identOpen) return;
    const ci = identCedula.trim();
    if (ci.length < 6) { setIdentEmp(null); setIdentSearching(false); return; }
    let cancel = false;
    setIdentSearching(true);
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('employee_public_lookup', { p_cedula: ci });
      if (cancel) return;
      const emp = (data && (data as any)[0]) as any;
      if (emp) {
        setIdentEmp({ id: emp.id, name: `${emp.first_name || ''} ${emp.last_name || ''}`.trim(), cedula: String(emp.cedula || ci).trim(), cargo: emp.cargo ?? null, companyId: emp.company_id ?? null, companyName: emp.company_name ?? null });
      } else {
        setIdentEmp(null);
      }
      setIdentSearching(false);
    }, 450);
    return () => { cancel = true; clearTimeout(t); };
  }, [identCedula, identOpen]);

  const onIdentScanned = async (text: string) => {
    setIdentScanOpen(false);
    const id = parseEmployeeId(text);
    if (!id) { toast.error('Ese QR no es un carnet de empleado.'); return; }
    const { data } = await supabase.rpc('employee_public_lookup', { p_id: id });
    const emp = (data as any)?.[0] ?? null;
    if (!emp) { toast.error('Ese carnet no corresponde a un empleado registrado.'); return; }
    const nombre = `${emp.first_name || ''} ${emp.last_name || ''}`.trim();
    setIdentEmp({ id: emp.id, name: nombre, cedula: String(emp.cedula || '').trim(), cargo: emp.cargo ?? null, companyId: emp.company_id ?? null, companyName: emp.company_name ?? null });
    setIdentCedula(String(emp.cedula || '').trim());
    toast.success(`Identificado: ${nombre}`);
  };

  // FIX 6: ninguna transición de work_orders validaba el estado esperado antes
  // de escribir, así que dos tablets tocando la misma WO al mismo tiempo podían
  // pisarse el avance (lost update). `updateWoGuarded` agrega `.eq('status',
  // expected)` a cada UPDATE y pide las filas afectadas con `.select('id')`: si
  // el UPDATE no tocó ninguna fila es porque el estado YA cambió (otra tablet
  // se adelantó), y en ese caso se avisa y se refresca en vez de asumir éxito.
  const updateWoGuarded = async (expectedStatus: WorkOrderStatus, patch: Record<string, any>) => {
    if (!selectedWo) return { ok: false as const };
    const { data, error } = await supabase
      .from('work_orders')
      .update(patch)
      .eq('id', selectedWo.id)
      .eq('status', expectedStatus)
      .select('id');
    if (error) return { ok: false as const, error };
    if (!data || data.length === 0) {
      toast.error('Esta orden cambió de estado, actualizando…');
      refetch();
      return { ok: false as const, stale: true as const };
    }
    return { ok: true as const };
  };

  const confirmarInicio = async () => {
    if (!selectedWo || !identEmp) return;
    // FIX 2: mismas dos validaciones que MachineQuickScreen.tsx (~líneas 365-400)
    // antes de dejar operar: cargo autorizado en nómina, y que la empresa del
    // empleado coincida con la de la orden (aquí, `manufacturing_orders.company_id`
    // — el equivalente de `machinery.company_id` allá, porque `work_centers` no
    // tiene columna de empresa propia).
    if (!isOperatorCargo(identEmp.cargo)) {
      toast.error(`${identEmp.name}${identEmp.cargo ? ` (${identEmp.cargo})` : ''} no es OPERADOR, CHOFER, SERVICIOS GENERALES ni OBRERO. No puede iniciar esta orden.`);
      return;
    }
    const moInfo = moMap[selectedWo.mo_id];
    if (moInfo?.companyId && identEmp.companyId && identEmp.companyId !== moInfo.companyId) {
      toast.error(`⛔ ${identEmp.name} es de ${identEmp.companyName ?? 'otra empresa'}. Esta orden es de ${moInfo.companyName ?? 'otra empresa'}. Solo puede iniciar órdenes de su empresa.`);
      return;
    }
    setIdentBusy(true);
    const profileId = profilesByCedula[onlyDigits(identEmp.cedula)] ?? null;
    const r = await updateWoGuarded('pendiente', {
      status: 'en_proceso',
      started_at: selectedWo.started_at ?? new Date().toISOString(),
      assigned_operator_id: profileId,
      operator_name: identEmp.name,
      operator_cedula: identEmp.cedula,
    });
    if (r.ok) {
      await insertLog('inicio', { operator_name: identEmp.name, operator_cedula: identEmp.cedula });
      setSessionOperator(identEmp); // FIX 1: ya identificado — sirve de identidad de sesión para el resto de acciones.
    }
    setIdentBusy(false);
    if (!r.ok) { if ('error' in r && r.error) toast.error(r.error.message); return; }
    toast.success('Orden de trabajo iniciada.');
    setIdentOpen(false); setIdentEmp(null); setIdentCedula('');
    refetch();
  };

  // Confirma la puerta de identificación: en modo 'inicio' arranca la WO; en
  // modo 'sesion' solo fija `sessionOperator` y dispara la acción pendiente
  // (la que el operador quería hacer cuando `requireSession` abrió la puerta).
  const confirmarIdent = async () => {
    if (!identEmp) return;
    if (identMode === 'inicio') { await confirmarInicio(); return; }
    setSessionOperator(identEmp);
    setIdentOpen(false); setIdentEmp(null); setIdentCedula('');
    const action = identPendingAction;
    setIdentPendingAction(null);
    if (action) action();
  };

  // FIX 1: puerta de SESIÓN — si ya hay alguien identificado en esta sesión de
  // uso del kiosco, ejecuta la acción directo; si no, pide carnet/cédula una
  // sola vez y la deja en cola para ejecutarla al confirmar.
  const requireSession = (action: () => void) => {
    if (sessionOperator) { action(); return; }
    setIdentMode('sesion');
    setIdentPendingAction(() => action);
    setIdentEmp(null); setIdentCedula('');
    setIdentOpen(true);
  };

  // ── Transiciones de estado ───────────────────────────────────────────────
  const [busy, setBusy] = useState<string | null>(null);

  const pausar = async () => {
    if (!selectedWo) return;
    setBusy('pausar');
    const r = await updateWoGuarded('en_proceso', { status: 'pausada' });
    if (r.ok) await insertLog('pausa');
    setBusy(null);
    if (!r.ok) { if ('error' in r && r.error) toast.error(r.error.message); return; }
    toast.success('Orden pausada.');
    refetch();
  };

  const reanudar = async () => {
    if (!selectedWo) return;
    setBusy('reanudar');
    // Igual criterio que WorkOrdersScreen: minutos desde la última 'pausa' hasta ahora.
    const { data: lastPausa } = await supabase
      .from('wo_time_logs').select('created_at')
      .eq('wo_id', selectedWo.id).eq('event', 'pausa')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    const addMin = lastPausa ? Math.max(0, Math.round((Date.now() - new Date((lastPausa as any).created_at).getTime()) / 60000)) : 0;
    const nuevoPausedMinutes = (selectedWo.paused_minutes || 0) + addMin;
    const r = await updateWoGuarded('pausada', { status: 'en_proceso', paused_minutes: nuevoPausedMinutes });
    if (r.ok) await insertLog('reanudacion');
    setBusy(null);
    if (!r.ok) { if ('error' in r && r.error) toast.error(r.error.message); return; }
    toast.success('Orden reanudada.');
    refetch();
  };

  const finalizar = async () => {
    if (!selectedWo) return;
    if (selectedWo.is_quality_checkpoint && selectedWo.qc_result === 'pendiente') {
      toast.error('Este paso requiere aprobación de calidad antes de finalizar.');
      return;
    }
    setBusy('completar');
    const r = await updateWoGuarded('en_proceso', { status: 'completada', ended_at: new Date().toISOString() });
    if (r.ok) await insertLog('fin');
    setBusy(null);
    if (!r.ok) { if ('error' in r && r.error) toast.error(r.error.message); return; }
    toast.success('Orden completada.');
    refetch();
  };

  // ── Registrar cantidad ──────────────────────────────────────────────────
  const [qtyOpen, setQtyOpen] = useState(false);
  const [qtyInput, setQtyInput] = useState('');
  const [busyQty, setBusyQty] = useState(false);
  const registrarCantidad = async () => {
    if (!selectedWo) return;
    const delta = Number(String(qtyInput).replace(',', '.')) || 0;
    if (delta <= 0) { toast.error('Ingresa una cantidad mayor a 0.'); return; }
    const nuevo = Math.min(selectedWo.qty_planned, (selectedWo.qty_completed || 0) + delta);
    const aplicado = nuevo - (selectedWo.qty_completed || 0);
    if (aplicado <= 0) { toast.error('Ya se alcanzó la cantidad planificada.'); return; }
    setBusyQty(true);
    const r = await updateWoGuarded('en_proceso', { qty_completed: nuevo });
    if (r.ok) await insertLog('cantidad', { qty_delta: aplicado, note: `Avance registrado: +${aplicado}` });
    setBusyQty(false);
    if (!r.ok) { if ('error' in r && r.error) toast.error(r.error.message); return; }
    toast.success('Cantidad registrada.');
    setQtyInput(''); setQtyOpen(false);
    refetch();
  };

  // ── Reportar falla / parada ─────────────────────────────────────────────
  const [fallaOpen, setFallaOpen] = useState(false);
  const [fallaPreset, setFallaPreset] = useState<string | null>(null);
  const [fallaNote, setFallaNote] = useState('');
  const [busyFalla, setBusyFalla] = useState(false);
  const reportarFalla = async () => {
    if (!selectedWo) return;
    const reason = fallaPreset === 'Otro' ? fallaNote.trim() : (fallaPreset || '');
    if (!reason) { toast.error('Selecciona o describe la falla.'); return; }
    setBusyFalla(true);
    // Reportar falla puede llegar desde 'en_proceso' o desde 'pausada' (ya
    // parada por otro motivo): el estado esperado es el que tiene la WO ahora.
    const r = await updateWoGuarded(selectedWo.status, { status: 'pausada', stop_reason: reason });
    if (r.ok) {
      // FIX 3: reanudar() (arriba) busca el último evento 'pausa' en wo_time_logs
      // para calcular los minutos pausados. Si solo se registrara 'falla', una WO
      // pausada por avería NO se contaría en ese cálculo (mismo bug corregido en
      // WorkOrdersScreen.tsx) — por eso se deja también un log 'pausa' equivalente.
      await insertLog('falla', { note: reason });
      await insertLog('pausa', { note: reason });
      // FIX 4: además de pausar la WO, deja la solicitud abierta en Mantenimiento
      // (antes `maintenance_requests.work_center_id`, agregado en
      // fabricacion_calidad_oee.sql, no tenía ningún consumidor en la UI). Mismo
      // patrón/columnas que usa MantenimientoMaquinariaScreen.tsx al reportar una
      // avería de máquina: material/notes/status/requested_by.
      await supabase.from('maintenance_requests').insert({
        work_center_id: selectedWo.work_center_id,
        material: reason,
        notes: `WO ${selectedWo.wo_no}. ${selectedWo.name}${selectedWc ? ` · Centro: ${selectedWc.code} · ${selectedWc.name}` : ''}`,
        status: 'pendiente',
        requested_by: myId,
      });
    }
    setBusyFalla(false);
    if (!r.ok) { if ('error' in r && r.error) toast.error(r.error.message); return; }
    toast.success('Falla reportada. Orden pausada.');
    setFallaOpen(false); setFallaPreset(null); setFallaNote('');
    refetch();
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.text, fontSize: 18 } as const;

  if ((loadingWc && workCenters.length === 0) || (loadingWo && workOrders.length === 0 && step !== 'centro')) {
    return <Screen><Loading /></Screen>;
  }

  // ── Paso 1: selección de centro de trabajo ───────────────────────────────
  if (step === 'centro') {
    return (
      <Screen>
        <SectionTitle>🏭 Kiosco de planta</SectionTitle>
        <Text style={{ color: colors.muted, fontSize: 15, marginBottom: spacing.sm }}>Toca tu centro de trabajo para empezar.</Text>
        <TextInput
          value={wcQuery}
          onChangeText={setWcQuery}
          placeholder="🔎 Buscar centro de trabajo…"
          placeholderTextColor={colors.muted}
          style={{ ...input, marginBottom: spacing.md }}
        />
        {loadingWc ? <Loading /> : shownWcs.length === 0 ? (
          <EmptyState title="Sin centros de trabajo" subtitle="No hay centros de trabajo activos configurados." />
        ) : (
          shownWcs.map((w) => (
            <TouchableOpacity key={w.id} onPress={() => pickWc(w)} activeOpacity={0.8}>
              <Card style={{ minHeight: 72, justifyContent: 'center' }}>
                <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 13 }}>{w.code}</Text>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 20 }}>{w.name}</Text>
              </Card>
            </TouchableOpacity>
          ))
        )}
        <View style={{ height: spacing.lg }} />
      </Screen>
    );
  }

  // ── Paso 2: selección de orden de trabajo ────────────────────────────────
  if (step === 'orden') {
    return (
      <Screen>
        <TouchableOpacity onPress={backToCentro}>
          <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 13, marginBottom: spacing.xs }}>← Cambiar centro de trabajo</Text>
        </TouchableOpacity>
        <SectionTitle>🛠️ {selectedWc ? `${selectedWc.code} · ${selectedWc.name}` : 'Órdenes de trabajo'}</SectionTitle>
        <Text style={{ color: colors.muted, fontSize: 15, marginBottom: spacing.sm }}>Toca la orden de trabajo con la que vas a trabajar.</Text>

        {woList.length === 0 ? (
          <EmptyState title="Sin órdenes pendientes" subtitle="Este centro de trabajo no tiene órdenes de trabajo pendientes, en proceso o pausadas." />
        ) : (
          woList.map((w) => {
            const mo = moMap[w.mo_id];
            const st = statusStyle(w.status, colors);
            return (
              <TouchableOpacity key={w.id} onPress={() => pickWo(w)} activeOpacity={0.8}>
                <Card style={{ minHeight: 88 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.xs }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>
                        {mo ? `${mo.code}${mo.product ? ` · ${mo.product}` : ''}` : '—'}
                      </Text>
                      <Text style={{ color: colors.text, fontWeight: '900', fontSize: 19 }}>{w.wo_no}. {w.name}{w.is_quality_checkpoint ? ' 🔍' : ''}</Text>
                    </View>
                    <View style={{ backgroundColor: st.bg, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 }}>
                      <Text style={{ color: st.fg, fontWeight: '900', fontSize: 13 }}>{st.label}</Text>
                    </View>
                  </View>
                  <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 15 }}>📦 {w.qty_completed ?? 0} / {w.qty_planned ?? 0}</Text>
                </Card>
              </TouchableOpacity>
            );
          })
        )}
        <View style={{ height: spacing.lg }} />
      </Screen>
    );
  }

  // ── Paso 3: pantalla de acción de la WO ──────────────────────────────────
  if (!selectedWo) {
    // La WO pudo haberse cerrado desde oficina mientras el kiosco estaba abierto.
    return (
      <Screen>
        <EmptyState title="Orden no disponible" subtitle="Esta orden de trabajo ya no está disponible. Vuelve a elegir una orden." />
        <TouchableOpacity onPress={backToOrden}>
          <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 13, marginTop: spacing.md, textAlign: 'center' }}>← Cambiar orden de trabajo</Text>
        </TouchableOpacity>
      </Screen>
    );
  }

  const mo = moMap[selectedWo.mo_id];
  const st = statusStyle(selectedWo.status, colors);
  const pct = selectedWo.qty_planned > 0 ? Math.min(100, Math.round(((selectedWo.qty_completed || 0) / selectedWo.qty_planned) * 100)) : 0;
  const qcBlocked = selectedWo.is_quality_checkpoint && selectedWo.qc_result === 'pendiente';

  return (
    <Screen>
      <Card>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{mo ? `${mo.code}${mo.product ? ` · ${mo.product}` : ''}` : '—'}</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.xs }}>
          <Text style={{ color: colors.text, fontWeight: '900', fontSize: 22, flex: 1 }}>{selectedWo.wo_no}. {selectedWo.name}</Text>
          <View style={{ backgroundColor: st.bg, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 }}>
            <Text style={{ color: st.fg, fontWeight: '900', fontSize: 14 }}>{st.label}</Text>
          </View>
        </View>
        {selectedWo.operator_name ? <Text style={{ color: colors.muted, fontSize: 13 }}>👷 {selectedWo.operator_name}</Text> : null}
        <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 16 }}>📦 {selectedWo.qty_completed ?? 0} / {selectedWo.qty_planned ?? 0}</Text>
        <View style={{ height: 10, borderRadius: 5, backgroundColor: colors.surfaceAlt, overflow: 'hidden' }}>
          <View style={{ height: 10, width: `${pct}%`, backgroundColor: colors.brand }} />
        </View>
        {selectedWo.stop_reason ? <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 13 }}>⚠️ {selectedWo.stop_reason}</Text> : null}
        {selectedWo.is_quality_checkpoint ? (
          <Text style={{ color: qcBlocked ? colors.warning : colors.success, fontWeight: '700', fontSize: 13 }}>
            🔍 Control de calidad: {qcBlocked ? 'pendiente de aprobación' : selectedWo.qc_result}
          </Text>
        ) : null}
      </Card>

      {!canWrite ? (
        <Card>
          <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center' }}>Tienes acceso de solo lectura a este módulo. No puedes registrar acciones aquí.</Text>
        </Card>
      ) : (
        <View style={{ marginTop: spacing.sm }}>
          {selectedWo.status === 'pendiente' ? (
            <BigButton label="▶️ INICIAR" sub="Identifica al operador para empezar" bg={colors.success} fg="#fff" onPress={() => { setIdentMode('inicio'); setIdentPendingAction(null); setIdentOpen(true); setIdentEmp(null); setIdentCedula(''); }} />
          ) : null}

          {selectedWo.status === 'en_proceso' ? (
            <>
              <BigButton label="⏸️ PAUSAR" bg={colors.warning} fg="#fff" disabled={busy === 'pausar'} onPress={() => requireSession(pausar)} />
              <BigButton label="🔢 REGISTRAR CANTIDAD" bg={colors.brand} fg={colors.brandContrast} onPress={() => requireSession(() => setQtyOpen(true))} />
              {qcBlocked ? (
                <Card style={{ backgroundColor: colors.warningSoftBg, borderColor: colors.warningSoftBorder }}>
                  <Text style={{ color: colors.warningSoftText, fontWeight: '800', fontSize: 16, textAlign: 'center' }}>⏳ Este paso requiere aprobación de calidad antes de finalizar</Text>
                  <Text style={{ color: colors.warningSoftText, fontSize: 12, textAlign: 'center' }}>Pide a un supervisor que apruebe o rechace la calidad desde oficina.</Text>
                </Card>
              ) : (
                <BigButton label="✅ FINALIZAR" bg={colors.success} fg="#fff" disabled={busy === 'completar'} onPress={() => requireSession(finalizar)} />
              )}
            </>
          ) : null}

          {selectedWo.status === 'pausada' ? (
            <BigButton label="▶️ REANUDAR" bg={colors.success} fg="#fff" disabled={busy === 'reanudar'} onPress={() => requireSession(reanudar)} />
          ) : null}

          {selectedWo.status !== 'completada' && selectedWo.status !== 'cancelada' ? (
            <BigButton label="⚠️ REPORTAR FALLA / PARADA" bg={colors.danger} fg="#fff" onPress={() => requireSession(() => setFallaOpen(true))} />
          ) : null}
          {sessionOperator ? (
            <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: spacing.xs }}>👤 Sesión: {sessionOperator.name}</Text>
          ) : null}
        </View>
      )}

      <TouchableOpacity onPress={backToOrden} style={{ marginTop: spacing.md, alignItems: 'center' }}>
        <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 13 }}>← Cambiar orden de trabajo</Text>
      </TouchableOpacity>
      <View style={{ height: spacing.lg }} />

      {/* ── Identificación del operador (puerta previa a INICIAR) ────────── */}
      <Modal visible={identOpen} animationType="slide" onRequestClose={() => { setIdentOpen(false); setIdentPendingAction(null); }}>
        <Screen>
          <SectionTitle>{identMode === 'inicio' ? '👷 ¿Quién va a iniciar esta orden?' : '👷 ¿Quién está operando ahora?'}</SectionTitle>
          <Text style={{ color: colors.muted, fontSize: 14, marginBottom: spacing.sm }}>Escanea tu carnet o ingresa tu cédula.</Text>

          <BigButton label="📷 ESCANEAR CARNET" bg="#0EA5E9" fg="#fff" onPress={() => setIdentScanOpen(true)} />

          <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 4 }}>o escribe tu cédula</Text>
          <TextInput
            value={identCedula}
            onChangeText={(t) => setIdentCedula(onlyDigits(t))}
            placeholder="Tu número de cédula"
            placeholderTextColor={colors.muted}
            keyboardType="number-pad"
            inputMode="numeric"
            style={{ ...input, fontSize: 22, textAlign: 'center' }}
          />

          {identSearching ? (
            <Text style={{ color: colors.muted, fontSize: 13, marginTop: spacing.sm }}>Buscando…</Text>
          ) : identEmp ? (
            <Card style={{ marginTop: spacing.sm, borderLeftWidth: 4, borderLeftColor: colors.success }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18 }}>✅ {identEmp.name}</Text>
              <Text style={{ color: colors.muted, fontSize: 13 }}>{identEmp.cargo || 'Sin cargo'} · CI {identEmp.cedula}</Text>
            </Card>
          ) : identCedula.trim().length >= 6 ? (
            <Text style={{ color: colors.danger, fontSize: 13, marginTop: spacing.sm }}>No se encontró un empleado con esa cédula.</Text>
          ) : null}

          <View style={{ marginTop: spacing.lg }}>
            <BigButton label={identMode === 'inicio' ? '✅ CONFIRMAR E INICIAR' : '✅ CONFIRMAR IDENTIDAD'} bg={colors.success} fg="#fff" disabled={!identEmp || identBusy} onPress={confirmarIdent} />
            <TouchableOpacity onPress={() => { setIdentOpen(false); setIdentPendingAction(null); }} style={{ alignItems: 'center', paddingVertical: spacing.sm }}>
              <Text style={{ color: colors.muted, fontWeight: '700' }}>Cancelar</Text>
            </TouchableOpacity>
          </View>

          <Modal visible={identScanOpen} animationType="slide" onRequestClose={() => setIdentScanOpen(false)}>
            <View style={{ flex: 1, backgroundColor: '#000' }}>
              <QrScanner onClose={() => setIdentScanOpen(false)} onDetected={onIdentScanned} />
            </View>
          </Modal>
        </Screen>
      </Modal>

      {/* ── Registrar cantidad ────────────────────────────────────────────── */}
      <Modal visible={qtyOpen} transparent animationType="fade" onRequestClose={() => setQtyOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
          <Card>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18, textAlign: 'center' }}>🔢 Registrar cantidad</Text>
            <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center', marginBottom: spacing.sm }}>
              Ya completado: {selectedWo.qty_completed ?? 0} / {selectedWo.qty_planned ?? 0}
            </Text>
            <TextInput
              value={qtyInput}
              onChangeText={(t) => setQtyInput(onlyDecimal(t))}
              placeholder="0"
              placeholderTextColor={colors.muted}
              keyboardType="numeric"
              inputMode="decimal"
              autoFocus
              style={{ ...input, fontSize: 36, textAlign: 'center', fontWeight: '900' }}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <TouchableOpacity onPress={() => setQtyOpen(false)} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={registrarCantidad} disabled={busyQty} style={{ flex: 2, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.brand, opacity: busyQty ? 0.6 : 1 }}>
                {busyQty ? <ActivityIndicator color={colors.brandContrast} /> : <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 16 }}>Confirmar</Text>}
              </TouchableOpacity>
            </View>
          </Card>
        </View>
      </Modal>

      {/* ── Reportar falla / parada ──────────────────────────────────────── */}
      <Modal visible={fallaOpen} transparent animationType="fade" onRequestClose={() => setFallaOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
          <Card>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18, textAlign: 'center' }}>⚠️ Reportar falla / parada</Text>
            <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center', marginBottom: spacing.sm }}>La orden quedará pausada.</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' }}>
              {FALLA_PRESETS.map((p) => {
                const on = fallaPreset === p;
                return (
                  <TouchableOpacity key={p} onPress={() => setFallaPreset(p)} style={{ borderRadius: radius.md, borderWidth: 2, borderColor: on ? colors.danger : colors.border, backgroundColor: on ? colors.danger : colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.md, minWidth: '45%', alignItems: 'center' }}>
                    <Text style={{ color: on ? '#fff' : colors.text, fontWeight: '800', fontSize: 15, textAlign: 'center' }}>{p}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {fallaPreset === 'Otro' ? (
              <TextInput
                value={fallaNote}
                onChangeText={setFallaNote}
                placeholder="Describe la falla…"
                placeholderTextColor={colors.muted}
                multiline
                style={{ ...input, minHeight: 72, marginTop: spacing.md }}
              />
            ) : null}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <TouchableOpacity onPress={() => { setFallaOpen(false); setFallaPreset(null); setFallaNote(''); }} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={reportarFalla} disabled={busyFalla || !fallaPreset} style={{ flex: 2, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.danger, opacity: busyFalla || !fallaPreset ? 0.6 : 1 }}>
                {busyFalla ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>Reportar y pausar</Text>}
              </TouchableOpacity>
            </View>
          </Card>
        </View>
      </Modal>
    </Screen>
  );
}
