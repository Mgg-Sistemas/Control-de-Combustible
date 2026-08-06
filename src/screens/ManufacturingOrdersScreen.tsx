// Módulo de Fabricación (MRP) — Fase 3: Órdenes de fabricación (MO). Nace de
// un producto terminado + su receta (BoM) y ruta ACTIVAS; calcula un snapshot
// de los componentes requeridos, permite pedir los faltantes a Inventario
// (reutilizando el flujo de requerimientos ya existente), generar las órdenes
// de trabajo (una por paso de la ruta) y, al cerrar, registrar en Inventario
// el consumo de insumos y la entrada del producto terminado. Reutiliza el
// mismo permiso de módulo que ManguerasScreen ('mangueras' = "Fabricación"):
// no se crea una clave de permiso nueva.
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { DateField } from '../components/DateField';
import { useTable } from '../hooks/useTable';
import { supabase } from '../lib/supabase';
import { norm, cmpText, onlyDecimal } from '../lib/text';
import { useAuth } from '../context/AuthContext';
import { levelMeets } from '../lib/permissions';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../components/ConfirmProvider';
import {
  InventoryItem,
  InventoryLevel,
  BomVersion,
  ProductionRoute,
  WorkCenter,
  ManufacturingOrder,
  ManufacturingOrderStatus,
  ManufacturingOrderComponentSnapshot,
  WorkOrder,
  RequirementLine,
} from '../types/database';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

function parseNum(t: string): number {
  const n = Number(String(t ?? '').replace(',', '.').replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : 0;
}
const qtyFmt = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString();
const nowISO = () => new Date().toISOString();
const fmtFecha = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(iso);
};

// Correlativo "MO-####" — mismo patrón que `nextReqCode` de InventarioScreen
// (RequerimientoTab), por si algún día se necesita mostrar un candidato antes
// de guardar. No se usa para el insert de manufacturing_orders (ver `crear`):
// el código se deja fuera del payload y lo asigna la BD (default/trigger).
function nextReqCode(codes: (string | null | undefined)[], bump = 0): string {
  let max = 0;
  codes.forEach((c) => { const m = String(c ?? '').match(/(\d+)\s*$/); if (m) { const n = parseInt(m[1], 10); if (n > max) max = n; } });
  return 'REQ-' + String(max + 1 + bump).padStart(4, '0');
}

// FIX 6: "Solicitar faltantes" y "Cerrar orden" se habilitan en la UI con
// moduleLevel('mangueras'), pero escriben en inventory_requirements/
// inventory_movements, cuya RLS exige can_write_module('inventario') (ver
// fabricacion_ordenes.sql / schema.sql). Si un usuario tiene Fabricación pero
// no Inventario, la escritura falla por RLS (código Postgres 42501) y hoy se
// mostraba el error crudo de Postgres. Se traduce ese caso puntual a un
// mensaje claro; cualquier otro error se muestra tal cual llega.
function friendlyInventoryError(error: { message: string; code?: string } | null | undefined): string {
  if (!error) return 'Ocurrió un error inesperado.';
  const code = (error as any).code;
  const msg = error.message || '';
  if (code === '42501' || /row-level security|permission denied|policy/i.test(msg)) {
    return 'Tu permiso de Fabricación no incluye escritura en Inventario — pide también ese permiso a un administrador.';
  }
  return msg;
}

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

const STATUS_INFO: Record<ManufacturingOrderStatus, { label: string; tone: Tone }> = {
  planificada: { label: '🟡 Planificada', tone: 'warning' },
  reservada: { label: '🔵 Reservada', tone: 'info' },
  en_proceso: { label: '🟢 En proceso', tone: 'success' },
  pausada: { label: '⏸️ Pausada', tone: 'warning' },
  completada: { label: '✅ Completada', tone: 'success' },
  cerrada: { label: '🔒 Cerrada', tone: 'info' },
  cancelada: { label: '⛔ Cancelada', tone: 'danger' },
};

// Disponibilidad de un renglón de componente contra lo requerido por la MO
// (NO es lo mismo que `dispoOf` de InventarioScreen, que compara contra el
// stock MÍNIMO del producto: aquí se compara contra lo que la orden necesita).
function lineDispo(stock: number, qtyRequired: number): { label: string; tone: Tone; ok: boolean } {
  if (stock <= 0) return { label: '🔴 Sin stock', tone: 'danger', ok: false };
  if (stock < qtyRequired) return { label: '🟡 Insuficiente', tone: 'warning', ok: false };
  return { label: '🟢 Disponible', tone: 'success', ok: true };
}

export default function ManufacturingOrdersScreen() {
  const { colors } = useTheme();
  const { moduleLevel, session } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const level = moduleLevel('mangueras');
  const uid = session?.user?.id ?? null;

  if (level === 'none') {
    return (
      <Screen>
        <SectionTitle>Órdenes de fabricación</SectionTitle>
        <EmptyState title="Sin acceso" subtitle="No tienes permiso para ver este módulo. Pídeselo a un administrador." />
      </Screen>
    );
  }
  const canWrite = levelMeets(level, 'escritura');

  const { data: mos, loading: loadingMos, refetch: refetchMos } = useTable<ManufacturingOrder>('manufacturing_orders', { orderBy: 'created_at', ascending: false });
  const { data: items, loading: loadingItems } = useTable<InventoryItem>('inventory_items', { orderBy: 'name' });
  // Existencias EN VIVO (derivadas de inventory_movements) para calcular la
  // disponibilidad de cada componente — misma vista que usa InventarioScreen.
  const { data: levels } = useTable<InventoryLevel>('inventory_levels', { orderBy: 'name', realtimeFrom: ['inventory_movements', 'inventory_items'] });
  const { data: bomVersions } = useTable<BomVersion>('bom_versions', { orderBy: 'created_at', ascending: false });
  const { data: routes } = useTable<ProductionRoute>('production_routes', { orderBy: 'created_at', ascending: false });
  const { data: workCenters } = useTable<WorkCenter>('work_centers', { select: 'id, code, name', orderBy: 'code' });
  const { data: workOrders, refetch: refetchWos } = useTable<WorkOrder>('work_orders', { orderBy: 'wo_no' });

  const itemsById = useMemo(() => {
    const m: Record<string, InventoryItem> = {};
    items.forEach((i) => { m[i.id] = i; });
    return m;
  }, [items]);
  const stockById = useMemo(() => {
    const m: Record<string, number> = {};
    levels.forEach((l) => { m[l.id] = Number(l.stock) || 0; });
    return m;
  }, [levels]);
  const workCenterMap = useMemo(() => {
    const m: Record<string, { code: string; name: string }> = {};
    workCenters.forEach((w) => { m[w.id] = { code: w.code, name: w.name }; });
    return m;
  }, [workCenters]);
  const productItems = useMemo(
    () => items.filter((i) => i.item_kind === 'producto_terminado').slice().sort((a, b) => cmpText(a.name, b.name)),
    [items]
  );

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  const Btn = ({ label, onPress, color, disabled }: { label: string; onPress: () => void; color: string; disabled?: boolean }) => (
    <TouchableOpacity onPress={onPress} disabled={disabled} style={{ flexGrow: 1, flexBasis: 140, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: color, opacity: disabled ? 0.55 : 1 }}>
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{label}</Text>
    </TouchableOpacity>
  );

  // ── Búsqueda / lista ────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const q = norm(query.trim());
  const shown = useMemo(() => {
    return mos.filter((m) => {
      const productName = itemsById[m.product_item_id]?.name ?? '';
      return !q || norm(`${m.code} ${productName}`).includes(q);
    });
  }, [mos, q, itemsById]);

  // ── Crear orden ─────────────────────────────────────────────────────────
  const [creating, setCreating] = useState(false);
  const [productId, setProductId] = useState('');
  const [productOpen, setProductOpen] = useState(false);
  const [productQuery, setProductQuery] = useState('');
  const [qtyPlanned, setQtyPlanned] = useState('');
  const [plannedStart, setPlannedStart] = useState('');
  const [plannedEnd, setPlannedEnd] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const product = productId ? itemsById[productId] : undefined;
  const productOptions = useMemo(() => {
    const qq = norm(productQuery);
    const list = qq ? productItems.filter((p) => norm(`${p.name} ${p.sku ?? ''}`).includes(qq)) : productItems;
    return list.slice(0, 30);
  }, [productItems, productQuery]);
  const activeBom = useMemo(
    () => (productId ? bomVersions.find((v) => v.product_item_id === productId && v.status === 'activa') : undefined),
    [bomVersions, productId]
  );
  const activeRoute = useMemo(
    () => (productId ? routes.find((r) => r.product_item_id === productId && r.status === 'activa') : undefined),
    [routes, productId]
  );

  const resetCreateForm = () => {
    setProductId(''); setProductQuery(''); setProductOpen(false);
    setQtyPlanned(''); setPlannedStart(''); setPlannedEnd(''); setNote('');
  };
  const openCreate = () => { resetCreateForm(); setCreating(true); };
  const closeCreate = () => { setCreating(false); resetCreateForm(); };

  const crear = async () => {
    if (!productId) return toast.error('Selecciona el producto terminado a fabricar.');
    const qty = parseNum(qtyPlanned);
    if (qty <= 0) return toast.error('La cantidad a planificar debe ser mayor que cero.');
    setSaving(true);
    const componentsSnapshot: ManufacturingOrderComponentSnapshot[] = (activeBom?.components ?? []).map((c) => {
      const waste = Number(c.waste_pct) || 0;
      const qtyRequired = Math.round((Number(c.qty_per_output) || 0) * qty * (1 + waste / 100) * 10000) / 10000;
      return { component_item_id: c.component_item_id, name: itemsById[c.component_item_id]?.name ?? c.component_item_id, qty_required: qtyRequired, unit: c.unit ?? null, waste_pct: waste };
    });
    // El código (MO-####) NO se envía: se deja que la BD lo asigne (default/trigger
    // en fabricacion_ordenes.sql), igual que bom_versions/production_routes no
    // reciben un id armado a mano. Se lee de vuelta con `.select().single()`.
    const { data, error } = await supabase
      .from('manufacturing_orders')
      .insert({
        product_item_id: productId,
        bom_version_id: activeBom?.id ?? null,
        route_id: activeRoute?.id ?? null,
        demand_trigger: 'manual',
        qty_planned: qty,
        qty_produced: 0,
        uom: activeBom?.output_unit ?? product?.unit ?? null,
        status: 'planificada',
        components_snapshot: componentsSnapshot,
        planned_start: plannedStart || null,
        planned_end: plannedEnd || null,
        note: note.trim() || null,
        created_by: uid,
      })
      .select()
      .single();
    setSaving(false);
    if (error || !data) {
      toast.error(error?.message || 'No se pudo crear la orden.');
      return;
    }
    toast.success(`Orden ${(data as any).code ?? ''} creada.`);
    await refetchMos();
    closeCreate();
    setOpenMoId((data as any).id);
  };

  // ── Detalle de una orden ───────────────────────────────────────────────
  const [openMoId, setOpenMoId] = useState('');
  const openMo = mos.find((m) => m.id === openMoId) || null;
  const openMoProduct = openMo ? itemsById[openMo.product_item_id] : undefined;
  const openMoWos = useMemo(
    () => workOrders.filter((w) => w.mo_id === openMoId).slice().sort((a, b) => a.wo_no - b.wo_no),
    [workOrders, openMoId]
  );
  const availability = useMemo(() => {
    if (!openMo) return [];
    return (openMo.components_snapshot ?? []).map((line) => {
      const stock = stockById[line.component_item_id] ?? 0;
      return { line, stock, dispo: lineDispo(stock, line.qty_required) };
    });
  }, [openMo, stockById]);
  const availableCount = availability.filter((a) => a.dispo.ok).length;
  const hasShortage = availability.some((a) => !a.dispo.ok);

  // FIX 8: % de avance agregado, calculado en vivo desde la suma de
  // `qty_completed` de las WOs de la orden contra `qty_planned` — misma
  // cuenta que hace `cerrarOrden` (FIX 1) para decidir `producedQty`, pero
  // aquí es solo informativa: se apoya en `openMoWos` (ya suscrito a
  // realtime de work_orders vía useTable) en vez de un select en vivo aparte.
  const progress = useMemo(() => {
    if (!openMo) return null;
    const planned = Number(openMo.qty_planned) || 0;
    if (planned <= 0) return null;
    const completed = openMoWos.reduce((sum, w) => sum + (Number(w.qty_completed) || 0), 0);
    const pct = Math.max(0, Math.min(100, Math.round((completed / planned) * 1000) / 10));
    return { completed, planned, pct };
  }, [openMo, openMoWos]);

  const [busyAction, setBusyAction] = useState<string | null>(null);

  // "Solicitar faltantes": inserta UN requerimiento en inventory_requirements
  // (mismo flujo/tabla de RequerimientoTab en InventarioScreen), pre-cargado
  // con los renglones cortos, trazable a esta MO.
  const solicitarFaltantes = async () => {
    if (!openMo) return;
    const faltantes = availability.filter((a) => !a.dispo.ok);
    if (faltantes.length === 0) return;
    setBusyAction('faltantes');
    // FIX 9: evita duplicar el requerimiento si ya se generó uno desde esta
    // misma MO y todavía no se recibió (no hay columna de referencia a la MO
    // en inventory_requirements, así que se busca por el mismo título que se
    // arma más abajo: `Faltantes de la orden ${code}`).
    const reqTitle = `Faltantes de la orden ${openMo.code}`;
    const { data: existentes } = await supabase
      .from('inventory_requirements')
      .select('id, status')
      .eq('title', reqTitle)
      .neq('status', 'recibido');
    if (existentes && existentes.length > 0) {
      const seguir = await confirm({
        title: 'Requerimiento ya generado',
        message: `Ya existe un requerimiento de faltantes para la orden ${openMo.code} que todavía no se ha recibido. ¿Generar otro de todas formas?`,
        confirmText: 'Sí, generar otro',
        cancelText: 'Cancelar',
      });
      if (!seguir) { setBusyAction(null); return; }
    }
    const reqItems: RequirementLine[] = faltantes.map((a) => ({
      product_id: a.line.component_item_id,
      name: a.line.name,
      unit: a.line.unit,
      qty: Math.round((a.line.qty_required - a.stock) * 10000) / 10000,
      est_price: 0,
      currency: 'USD',
      note: `Faltante de la orden ${openMo.code}`,
    }));
    let reqName: string | null = null;
    if (uid) {
      const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', uid).maybeSingle();
      reqName = (prof as any)?.full_name ?? null;
    }
    // Mismo patrón de reintento que RequerimientoTab: se lee el máximo código
    // actual, se intenta insertar y, si choca con el índice único, se reintenta
    // con el siguiente número (nunca se reinicia a 0001 si la lectura falla).
    let saved = false;
    let code = '';
    for (let intento = 0; intento < 6 && !saved; intento++) {
      const { data: codeRows, error: readErr } = await supabase.from('inventory_requirements').select('code');
      if (readErr || !codeRows) {
        setBusyAction(null);
        toast.error('No se pudo leer el número de requerimiento. Revisa tu conexión e inténtalo de nuevo.');
        return;
      }
      code = nextReqCode(codeRows.map((r: any) => r.code), intento);
      const { error } = await supabase.from('inventory_requirements').insert({
        code,
        title: reqTitle,
        note: `Generado automáticamente desde la orden de fabricación ${openMo.code}.`,
        company_id: openMo.company_id ?? null,
        status: 'pendiente',
        items: reqItems,
        requested_by: uid,
        requested_by_name: reqName,
      });
      if (!error) { saved = true; break; }
      if (/duplicate key|already exists|unique|_code_key|23505/i.test(error.message)) continue;
      setBusyAction(null);
      toast.error(friendlyInventoryError(error)); // FIX 6
      return;
    }
    setBusyAction(null);
    if (!saved) { toast.error('No se pudo asignar un número único al requerimiento. Inténtalo de nuevo.'); return; }
    toast.success(`Requerimiento ${code} enviado con los faltantes de ${openMo.code}.`);
  };

  // "Iniciar producción": pasa la MO a en_proceso y genera una WO por cada
  // paso de su ruta activa.
  const iniciarProduccion = async () => {
    if (!openMo || !openMo.route_id) return;
    const route = routes.find((r) => r.id === openMo.route_id);
    if (!route || route.steps.length === 0) { toast.error('La ruta de esta orden no tiene pasos.'); return; }
    setBusyAction('iniciar');
    const rows = route.steps.map((s) => ({
      mo_id: openMo.id,
      wo_no: s.step_no,
      work_center_id: s.work_center_id,
      step_no: s.step_no,
      name: s.name,
      description: s.description ?? null,
      qty_planned: openMo.qty_planned,
      is_quality_checkpoint: !!s.is_quality_checkpoint,
    }));
    const { error: woErr } = await supabase.from('work_orders').insert(rows);
    if (woErr) { setBusyAction(null); toast.error('No se pudieron crear las órdenes de trabajo: ' + woErr.message); return; }
    const { error } = await supabase.from('manufacturing_orders').update({ status: 'en_proceso', started_at: nowISO() }).eq('id', openMo.id);
    setBusyAction(null);
    if (error) { toast.error(error.message); return; }
    toast.success('Producción iniciada. Se generaron las órdenes de trabajo.');
    refetchMos();
    refetchWos();
  };

  // "Cerrar orden": registra el consumo de cada componente y la entrada del
  // producto terminado en Inventario (inventory_movements), y cierra la MO.
  const cerrarOrden = async () => {
    if (!openMo) return;
    if (busyAction) return; // FIX 3 (capa UI): candado de doble clic — el candado real vive en la BD (ver fabricacion_fix_ordenes.sql).
    // Deshabilita el botón DE INMEDIATO (antes de cualquier `await`), incluso
    // antes de mostrar el diálogo de confirmación: evita que un segundo clic
    // humano dispare dos cierres casi simultáneos mientras el primero sigue
    // en curso. Se resetea a null en cada `return` temprano de abajo.
    setBusyAction('cerrar');

    // FIX 1: `openMo.qty_produced` casi nunca refleja el avance real (las WOs
    // se completan en WorkOrdersScreen y ese campo de la MO no se
    // re-sincroniza solo), así que este cierre terminaba SIEMPRE cayendo en
    // `qty_planned` (la cantidad PLANIFICADA, no la producida de verdad). Se
    // relee EN VIVO (select directo, sin confiar en el estado ya cargado en
    // pantalla ni en `openMo.qty_produced`) sumando `qty_completed` de TODAS
    // las WOs de esta MO, y ESE total real es el que se usa como `producedQty`.
    const { data: liveWos, error: woReadErr } = await supabase
      .from('work_orders')
      .select('qty_completed')
      .eq('mo_id', openMo.id);
    if (woReadErr) {
      setBusyAction(null);
      toast.error('No se pudo verificar el avance real de las órdenes de trabajo: ' + woReadErr.message);
      return;
    }
    const producedQty = Math.round(
      (liveWos ?? []).reduce((sum, w: any) => sum + (Number(w.qty_completed) || 0), 0) * 10000
    ) / 10000;
    const planned = Number(openMo.qty_planned) || 0;

    const ok = await confirm({
      title: 'Cerrar orden',
      message: '¿Cerrar esta orden? Esto registrará el consumo de insumos y la entrada del producto terminado en Inventario — no se puede deshacer.',
      confirmText: 'Sí, cerrar',
      cancelText: 'Cancelar',
      danger: true,
    });
    if (!ok) { setBusyAction(null); return; }

    // Si lo realmente producido es 0 o queda muy por debajo de lo
    // planificado, no se bloquea (puede ser legítimo cerrar con lo que se
    // logró) pero tampoco se cierra en silencio con el número equivocado:
    // se pide una confirmación explícita con las dos cifras.
    if (producedQty <= 0 || producedQty < planned - 0.0001) {
      const okIncompleta = await confirm({
        title: 'Producción incompleta',
        message: `Solo se registraron ${qtyFmt(producedQty)} de ${qtyFmt(planned)} ${openMo.uom || ''} planificadas. ¿Cerrar la orden igual con esta cantidad?`,
        confirmText: 'Sí, cerrar igual',
        cancelText: 'Cancelar',
        danger: true,
      });
      if (!okIncompleta) { setBusyAction(null); return; }
    }

    // FIX 2: el PMP del producto terminado nunca se recalculaba porque
    // `unitCost` salía de `openMo.real_cost`, que en el momento del cierre
    // todavía vale 0 (se carga DESPUÉS, desde Reportes de Fabricación) — con
    // `unit_cost: null` el trigger de recálculo de PMP (`inv_recalc_avg` en
    // schema.sql) nunca se dispara para esta entrada. Mientras no exista
    // `real_cost`, se usa una ESTIMACIÓN: costo de los insumos realmente
    // consumidos (`components_snapshot` × `avg_cost` actual de cada insumo en
    // Inventario, el mismo dato que ya se usa para el semáforo de
    // disponibilidad de esta pantalla) entre la cantidad producida.
    // PENDIENTE (fuera de alcance aquí, requeriría tocar
    // ManufacturingReportsScreen.tsx): cuando más tarde se cargue el costo
    // REAL en Reportes, ese flujo debería reajustar este movimiento de
    // inventario (o insertar un ajuste de PMP) para que el estimado de acá
    // no quede pisando al costo real para siempre.
    let unitCost: number | null = null;
    if (Number(openMo.real_cost) > 0 && producedQty > 0) {
      unitCost = Math.round((Number(openMo.real_cost) / producedQty) * 10000) / 10000;
    } else if (producedQty > 0) {
      const estimatedComponentsCost = (openMo.components_snapshot ?? []).reduce((sum, line) => {
        const avgCost = Number(itemsById[line.component_item_id]?.avg_cost) || 0;
        return sum + avgCost * (Number(line.qty_required) || 0);
      }, 0);
      if (estimatedComponentsCost > 0) {
        unitCost = Math.round((estimatedComponentsCost / producedQty) * 10000) / 10000;
      }
    }

    const movRows = [
      ...(openMo.components_snapshot ?? []).map((line) => ({
        item_id: line.component_item_id,
        kind: 'consumo' as const,
        qty: line.qty_required,
        unit_cost: null,
        mo_id: openMo.id,
        company_id: openMo.company_id ?? null,
        note: 'Consumo MO ' + openMo.code,
        created_by: uid,
      })),
      {
        item_id: openMo.product_item_id,
        kind: 'entrada' as const,
        qty: producedQty,
        unit_cost: unitCost,
        mo_id: openMo.id,
        company_id: openMo.company_id ?? null,
        note: 'Producción MO ' + openMo.code,
        created_by: uid,
      },
    ];
    const { error: mErr } = await supabase.from('inventory_movements').insert(movRows);
    if (mErr) { setBusyAction(null); toast.error('No se pudo registrar el movimiento de inventario: ' + friendlyInventoryError(mErr)); return; } // FIX 6
    const { error } = await supabase.from('manufacturing_orders').update({
      status: 'cerrada', closed_at: nowISO(), closed_by: uid, finished_at: openMo.finished_at ?? nowISO(), qty_produced: producedQty,
    }).eq('id', openMo.id);
    setBusyAction(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`Orden ${openMo.code} cerrada.`);
    refetchMos();
  };

  // FIX 7: no existía forma de cancelar una MO. Solo cambia el status de la
  // MO — si ya generó WOs, estas quedan tal cual (no se cancelan en cascada;
  // eso vive en WorkOrdersScreen.tsx, de otro agente), pero se avisa en la
  // confirmación para que el usuario sepa que no debe seguir dándoles avance.
  const cancelarOrden = async () => {
    if (!openMo) return;
    if (busyAction) return;
    const tieneWos = openMoWos.length > 0;
    const ok = await confirm({
      title: 'Cancelar orden',
      message: tieneWos
        ? `¿Cancelar la orden ${openMo.code}? Ya tiene órdenes de trabajo generadas: seguirán existiendo, pero no se les debe dar más avance. Esta acción no se puede deshacer.`
        : `¿Cancelar la orden ${openMo.code}? Esta acción no se puede deshacer.`,
      confirmText: 'Sí, cancelar',
      cancelText: 'Volver',
      danger: true,
    });
    if (!ok) return;
    setBusyAction('cancelar');
    const { error } = await supabase.from('manufacturing_orders').update({ status: 'cancelada' }).eq('id', openMo.id);
    setBusyAction(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`Orden ${openMo.code} cancelada.`);
    refetchMos();
  };

  if ((loadingMos && mos.length === 0) || (loadingItems && items.length === 0)) {
    return <Screen><Loading /></Screen>;
  }

  // ── Detalle ─────────────────────────────────────────────────────────────
  if (openMo) {
    const st = STATUS_INFO[openMo.status] ?? STATUS_INFO.planificada;
    const canStart = canWrite && (openMo.status === 'planificada' || openMo.status === 'reservada') && !!openMo.route_id;
    const canClose = canWrite && (openMo.status === 'en_proceso' || openMo.status === 'completada');
    // FIX 7: se puede cancelar en cualquier estado que no sea ya terminal.
    const canCancel = canWrite && openMo.status !== 'cerrada' && openMo.status !== 'cancelada';
    return (
      <Screen>
        <TouchableOpacity onPress={() => setOpenMoId('')}>
          <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 13 }}>← Volver a las órdenes</Text>
        </TouchableOpacity>

        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.xs }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>{openMo.code}</Text>
              <Text style={{ color: colors.muted, fontSize: 13 }}>{openMoProduct?.name ?? '—'}</Text>
            </View>
            <Pill label={st.label} tone={st.tone} colors={colors} />
          </View>
          <Text style={{ color: colors.text, fontSize: 13 }}>
            Planificado: <Text style={{ fontWeight: '800' }}>{qtyFmt(openMo.qty_planned)} {openMo.uom || ''}</Text>
            {'  ·  '}Producido: <Text style={{ fontWeight: '800' }}>{qtyFmt(openMo.qty_produced)} {openMo.uom || ''}</Text>
          </Text>
          {progress ? (
            // FIX 8: % de avance agregado (vivo, desde las WOs de la orden).
            <View style={{ marginTop: 4 }}>
              <View style={{ height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, overflow: 'hidden' }}>
                <View style={{ height: '100%', width: `${progress.pct}%`, backgroundColor: progress.pct >= 100 ? colors.success : colors.brandText, borderRadius: radius.pill }} />
              </View>
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
                Avance de las órdenes de trabajo: {progress.pct}% ({qtyFmt(progress.completed)}/{qtyFmt(progress.planned)} {openMo.uom || ''})
              </Text>
            </View>
          ) : null}
          {(openMo.planned_start || openMo.planned_end) ? (
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              📅 {openMo.planned_start ? fmtFecha(openMo.planned_start) : '—'} → {openMo.planned_end ? fmtFecha(openMo.planned_end) : '—'}
            </Text>
          ) : null}
          {!openMo.route_id ? (
            <Text style={{ color: colors.warningSoftText, fontSize: 12 }}>⚠️ Esta orden no tiene ruta asignada: no se pueden generar órdenes de trabajo.</Text>
          ) : null}
          {!openMo.bom_version_id ? (
            <Text style={{ color: colors.warningSoftText, fontSize: 12 }}>⚠️ Esta orden no tiene receta asignada: no hay componentes en el snapshot.</Text>
          ) : null}
          {openMo.note ? <Text style={{ color: colors.text, fontSize: 13 }}>📝 {openMo.note}</Text> : null}
        </Card>

        <SectionTitle>Disponibilidad de componentes</SectionTitle>
        {availability.length === 0 ? (
          <EmptyState title="Sin componentes" subtitle="Esta orden no tiene un snapshot de componentes (no había receta activa al crearla)." />
        ) : (
          <>
            <Card>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>
                {availableCount} de {availability.length} componentes disponibles
              </Text>
            </Card>
            {availability.map(({ line, stock, dispo }, i) => (
              <Card key={i}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.xs }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }}>{line.name}</Text>
                  <Pill label={dispo.label} tone={dispo.tone} colors={colors} />
                </View>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  Requerido: {qtyFmt(line.qty_required)} {line.unit || ''} · Disponible: {qtyFmt(stock)} {line.unit || ''}
                </Text>
              </Card>
            ))}
          </>
        )}

        {canWrite ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
            {hasShortage ? (
              <Btn label="📤 Solicitar faltantes" color="#D97706" disabled={busyAction === 'faltantes'} onPress={solicitarFaltantes} />
            ) : null}
            {openMo.status === 'planificada' || openMo.status === 'reservada' ? (
              <Btn
                label={openMo.route_id ? '▶️ Iniciar producción' : '▶️ Iniciar producción (requiere ruta)'}
                color="#059669"
                disabled={!canStart || busyAction === 'iniciar'}
                onPress={iniciarProduccion}
              />
            ) : null}
            {openMo.status === 'en_proceso' || openMo.status === 'completada' ? (
              <Btn label="🔒 Cerrar orden" color="#B91C1C" disabled={!canClose || busyAction === 'cerrar'} onPress={cerrarOrden} />
            ) : null}
            {canCancel ? (
              <Btn label="❌ Cancelar orden" color="#6B7280" disabled={busyAction === 'cancelar'} onPress={cancelarOrden} />
            ) : null}
          </View>
        ) : null}

        <SectionTitle>Órdenes de trabajo</SectionTitle>
        {openMoWos.length === 0 ? (
          <EmptyState title="Sin órdenes de trabajo" subtitle={openMo.route_id ? 'Se generarán al iniciar la producción.' : 'Esta orden no tiene ruta asignada.'} />
        ) : (
          openMoWos.map((w) => {
            const wc = w.work_center_id ? workCenterMap[w.work_center_id] : undefined;
            return (
              <TouchableOpacity key={w.id} activeOpacity={0.75} onPress={() => toast.info("Gestiona las órdenes de trabajo desde 'Órdenes de trabajo'.")}>
                <Card>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.xs }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, flex: 1 }}>{w.wo_no}. {w.name}</Text>
                    <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>{w.status}</Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    🏭 {wc ? `${wc.code} · ${wc.name}` : '—'} · {qtyFmt(w.qty_completed)}/{qtyFmt(w.qty_planned)}
                  </Text>
                </Card>
              </TouchableOpacity>
            );
          })
        )}

        <View style={{ height: spacing.lg }} />
      </Screen>
    );
  }

  // ── Lista ───────────────────────────────────────────────────────────────
  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>🏭 Órdenes de fabricación</SectionTitle>
        {canWrite && !creating ? (
          <TouchableOpacity onPress={openCreate} style={{ backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>+ Nueva orden</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {creating ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>Nueva orden de fabricación</Text>

          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>Producto terminado *</Text>
          <TouchableOpacity onPress={() => setProductOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}>
            <Text style={{ color: product ? colors.text : colors.muted, fontWeight: product ? '700' : '400', fontSize: 13, flex: 1 }} numberOfLines={1}>
              {product ? product.name : 'Seleccionar producto…'}
            </Text>
            <Text style={{ color: colors.brandText, fontWeight: '800' }}>{productOpen ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          {productOpen ? (
            <View style={{ marginTop: spacing.xs }}>
              <TextInput value={productQuery} onChangeText={setProductQuery} placeholder="🔎 Buscar por nombre o SKU…" placeholderTextColor={colors.muted} style={input} />
              <View style={{ maxHeight: 220, marginTop: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' }}>
                {productOptions.length === 0 ? (
                  <Text style={{ color: colors.muted, fontSize: 12, padding: spacing.sm }}>
                    {productItems.length === 0 ? 'Sin productos terminados registrados en el inventario.' : 'Sin resultados.'}
                  </Text>
                ) : (
                  <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                    {productOptions.map((p) => (
                      <TouchableOpacity key={p.id} onPress={() => { setProductId(p.id); setProductOpen(false); setProductQuery(''); }} style={{ paddingVertical: 8, paddingHorizontal: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }}>
                        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{p.name}</Text>
                        {p.sku ? <Text style={{ color: colors.muted, fontSize: 11 }}>SKU {p.sku}</Text> : null}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              </View>
            </View>
          ) : null}

          {productId ? (
            (!activeBom || !activeRoute) ? (
              <Text style={{ color: colors.warningSoftText, fontSize: 12, marginTop: spacing.xs }}>
                ⚠️ Este producto no tiene {!activeBom && !activeRoute ? 'receta ni ruta activas' : !activeBom ? 'receta activa' : 'ruta activa'}. Puedes crear la orden igual, pero {!activeBom ? 'no tendrá componentes calculados' : ''}{!activeBom && !activeRoute ? ' ni' : ''}{!activeRoute ? ' no se podrán generar órdenes de trabajo' : ''}.
              </Text>
            ) : (
              <Text style={{ color: colors.successSoftText, fontSize: 12, marginTop: spacing.xs }}>
                ✅ Receta v{activeBom.version_no} y ruta "{activeRoute.name}" activas — se usarán para esta orden.
              </Text>
            )
          ) : null}

          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Cantidad a planificar *</Text>
          <TextInput value={qtyPlanned} onChangeText={(t) => setQtyPlanned(onlyDecimal(t))} keyboardType="numeric" inputMode="decimal" placeholder="0" placeholderTextColor={colors.muted} style={input} />

          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Fecha planificada de inicio (opcional)</Text>
          <DateField value={plannedStart} onChange={setPlannedStart} placeholder="Seleccionar fecha" />

          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Fecha planificada de fin (opcional)</Text>
          <DateField value={plannedEnd} onChange={setPlannedEnd} placeholder="Seleccionar fecha" minISO={plannedStart || undefined} />

          <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Nota (opcional)</Text>
          <TextInput value={note} onChangeText={setNote} placeholder="Observación…" placeholderTextColor={colors.muted} style={input} />

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <TouchableOpacity onPress={closeCreate} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={crear} disabled={saving} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }}>
              <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{saving ? 'Creando…' : 'Crear orden'}</Text>
            </TouchableOpacity>
          </View>
        </Card>
      ) : null}

      <TextInput value={query} onChangeText={setQuery} placeholder="🔎 Buscar por código o producto…" placeholderTextColor={colors.muted} style={{ ...input, marginTop: spacing.sm, marginBottom: spacing.sm }} />

      {mos.length === 0 ? (
        <EmptyState title="Sin órdenes" subtitle="Aún no se ha creado ninguna orden de fabricación." />
      ) : shown.length === 0 ? (
        <EmptyState title="Sin resultados" subtitle="Prueba con otra búsqueda." />
      ) : (
        shown.map((m) => {
          const st = STATUS_INFO[m.status] ?? STATUS_INFO.planificada;
          const prod = itemsById[m.product_item_id];
          return (
            <TouchableOpacity key={m.id} onPress={() => setOpenMoId(m.id)} activeOpacity={0.75}>
              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.xs }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{m.code}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{prod?.name ?? '—'}</Text>
                  </View>
                  <Pill label={st.label} tone={st.tone} colors={colors} />
                </View>
                <Text style={{ color: colors.text, fontSize: 12 }}>
                  {qtyFmt(m.qty_planned)} {m.uom || ''} planificado · {qtyFmt(m.qty_produced)} {m.uom || ''} producido
                </Text>
                {(m.planned_start || m.planned_end) ? (
                  <Text style={{ color: colors.muted, fontSize: 11 }}>
                    📅 {m.planned_start ? fmtFecha(m.planned_start) : '—'} → {m.planned_end ? fmtFecha(m.planned_end) : '—'}
                  </Text>
                ) : null}
              </Card>
            </TouchableOpacity>
          );
        })
      )}

      <View style={{ height: spacing.lg }} />
    </Screen>
  );
}
