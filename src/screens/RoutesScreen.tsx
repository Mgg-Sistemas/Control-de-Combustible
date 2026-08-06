// Módulo de Fabricación (MRP) — Fase 2: Rutas de producción. Administra la
// secuencia de pasos (por centro de trabajo) que sigue la materia prima hasta
// convertirse en un producto terminado, incluyendo puntos de control de
// calidad opcionales por paso (foto / medición / aprobación). Reutiliza el
// mismo permiso de módulo que "Fabricación" (mangueras): no se crea una clave
// de permiso nueva. Los pasos viven en la columna jsonb `steps` de
// `production_routes` (no son filas propias), así que su alta/edición/orden
// se maneja aquí con un formulario propio en vez de RecordForm.
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { useTable } from '../hooks/useTable';
import { supabase } from '../lib/supabase';
import { norm, cmpText, onlyDecimal } from '../lib/text';
import { useAuth } from '../context/AuthContext';
import { levelMeets } from '../lib/permissions';
import { useToast } from '../components/ToastProvider';
import { useConfirm } from '../components/ConfirmProvider';
import {
  ProductionRoute,
  ProductionRouteStatus,
  RouteStep,
  RouteCheckpointType,
  WorkCenter,
} from '../types/database';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

type ProductRow = { id: string; name: string; sku: string | null; item_kind: string | null };
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

const STATUS_INFO: Record<ProductionRouteStatus, { label: string; tone: Tone }> = {
  borrador: { label: '🟡 Borrador', tone: 'warning' },
  activa: { label: '🟢 Activa', tone: 'success' },
  obsoleta: { label: '⚪ Obsoleta', tone: 'info' },
};
const CHECKPOINT_INFO: Record<RouteCheckpointType, { icon: string; label: string }> = {
  foto: { icon: '📷', label: 'Foto' },
  medicion: { icon: '📏', label: 'Medición' },
  aprobacion: { icon: '✅', label: 'Aprobación' },
};

const fmtFecha = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(iso);
};

/** Lista desplegable buscable genérica (código/nombre). RecordForm tiene un
 *  selector equivalente (`lookup`), pero no está exportado y además está
 *  atado a guardar columnas de UNA fila de tabla — los pasos de la ruta viven
 *  en un array jsonb, no en filas propias, así que aquí se reimplementa el
 *  mismo patrón visual (toggle + buscador + lista) de forma independiente. */
function SearchDropdown({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: Option[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
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
          {selected ? selected.label : placeholder}
        </Text>
        <Text style={{ color: colors.primary, fontWeight: '800', marginLeft: spacing.sm }}>{open ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {open ? (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderTopWidth: 0, borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md, maxHeight: 240, overflow: 'hidden' }}>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="🔎 Buscar por código o nombre…"
            placeholderTextColor={colors.muted}
            style={{ padding: spacing.sm, color: colors.text, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}
          />
          <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
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

export default function RoutesScreen() {
  const { colors } = useTheme();
  const { moduleLevel } = useAuth();
  const level = moduleLevel('mangueras');
  const toast = useToast();
  const confirm = useConfirm();

  if (level === 'none') {
    return (
      <Screen>
        <SectionTitle>Rutas de producción</SectionTitle>
        <EmptyState title="Sin acceso" subtitle="No tienes permiso para ver este módulo. Pídeselo a un administrador." />
      </Screen>
    );
  }
  const canWrite = levelMeets(level, 'escritura');

  const { data: products, loading: loadingProducts } = useTable<ProductRow>('inventory_items', { select: 'id, name, sku, item_kind', orderBy: 'name' });
  const { data: workCenters } = useTable<WorkCenter>('work_centers', { select: 'id, code, name, type, active', orderBy: 'code' });
  const { data: routes, loading: loadingRoutes, refetch } = useTable<ProductionRoute>('production_routes', { orderBy: 'created_at', ascending: false });

  const finishedProducts = useMemo(() => products.filter((p) => p.item_kind === 'producto_terminado'), [products]);

  const workCenterMap = useMemo(() => {
    const m: Record<string, { code: string; name: string }> = {};
    workCenters.forEach((w) => { m[w.id] = { code: w.code, name: w.name }; });
    return m;
  }, [workCenters]);
  const workCenterOptions: Option[] = useMemo(
    () => workCenters.slice().sort((a, b) => cmpText(a.code, b.code)).map((w) => ({ label: `${w.code} · ${w.name}`, value: w.id })),
    [workCenters]
  );

  // ── Selector de producto ───────────────────────────────────────────────
  const [productQuery, setProductQuery] = useState('');
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState('');
  const selectedProduct = finishedProducts.find((p) => p.id === selectedProductId);

  const productOptions = useMemo(() => {
    const q = norm(productQuery.trim());
    const list = q ? finishedProducts.filter((p) => norm(`${p.name} ${p.sku ?? ''}`).includes(q)) : finishedProducts;
    return list.slice().sort((a, b) => cmpText(a.name, b.name)).slice(0, 30);
  }, [finishedProducts, productQuery]);

  const productRoutes = useMemo(
    () => routes.filter((r) => r.product_item_id === selectedProductId).slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    [routes, selectedProductId]
  );

  // ── Ruta abierta (editor de pasos) ─────────────────────────────────────
  const [openRouteId, setOpenRouteId] = useState('');
  const openRoute = routes.find((r) => r.id === openRouteId) || null;
  const sortedSteps: RouteStep[] = openRoute ? [...openRoute.steps].sort((a, b) => a.step_no - b.step_no) : [];

  const [creatingRoute, setCreatingRoute] = useState(false);
  const crearRuta = async () => {
    if (!selectedProductId || creatingRoute) return;
    setCreatingRoute(true);
    const { data: userData } = await supabase.auth.getUser();
    const nombre = `Ruta — ${fmtFecha(new Date().toISOString())}`;
    const { data, error } = await supabase
      .from('production_routes')
      .insert({ product_item_id: selectedProductId, name: nombre, status: 'borrador', steps: [], created_by: userData.user?.id ?? null })
      .select('id')
      .single();
    setCreatingRoute(false);
    if (error || !data) {
      toast.error('No se pudo crear la ruta: ' + (error?.message ?? ''));
      return;
    }
    await refetch();
    setOpenRouteId((data as any).id);
  };

  const [busyRoute, setBusyRoute] = useState(false);
  const activarRuta = async () => {
    if (!openRoute) return;
    setBusyRoute(true);
    const { error } = await supabase.from('production_routes').update({ status: 'activa' }).eq('id', openRoute.id);
    setBusyRoute(false);
    if (error) {
      if ((error as any).code === '23505' || /duplicate key|unique/i.test(error.message)) {
        toast.error('Ya hay una ruta activa para este producto — pásala a obsoleta primero.');
      } else {
        toast.error(error.message);
      }
      return;
    }
    toast.success('Ruta activada.');
    refetch();
  };
  const marcarObsoleta = async () => {
    if (!openRoute) return;
    const ok = await confirm('¿Pasar esta ruta a obsoleta? Dejará de ser la ruta activa del producto.');
    if (!ok) return;
    setBusyRoute(true);
    const { error } = await supabase.from('production_routes').update({ status: 'obsoleta' }).eq('id', openRoute.id);
    setBusyRoute(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Ruta marcada como obsoleta.');
    refetch();
  };

  // ── Formulario inline de paso (crear / editar) ─────────────────────────
  const [stepFormOpen, setStepFormOpen] = useState(false);
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);
  const [stepName, setStepName] = useState('');
  const [stepDescription, setStepDescription] = useState('');
  const [stepWorkCenterId, setStepWorkCenterId] = useState('');
  const [stepMinutes, setStepMinutes] = useState('');
  const [stepIsCheckpoint, setStepIsCheckpoint] = useState(false);
  const [stepCheckpointType, setStepCheckpointType] = useState<RouteCheckpointType>('foto');
  const [stepCheckpointSpec, setStepCheckpointSpec] = useState('');
  const [stepError, setStepError] = useState<string | null>(null);
  const [savingStep, setSavingStep] = useState(false);
  const [busyStep, setBusyStep] = useState<number | null>(null);

  const resetStepForm = () => {
    setStepName(''); setStepDescription(''); setStepWorkCenterId(''); setStepMinutes('');
    setStepIsCheckpoint(false); setStepCheckpointType('foto'); setStepCheckpointSpec(''); setStepError(null);
  };
  const openNewStep = () => { resetStepForm(); setEditingStepIndex(null); setStepFormOpen(true); };
  const openEditStep = (idx: number) => {
    const s = sortedSteps[idx];
    setStepName(s.name);
    setStepDescription(s.description ?? '');
    setStepWorkCenterId(s.work_center_id ?? '');
    setStepMinutes(s.standard_minutes != null ? String(s.standard_minutes) : '');
    setStepIsCheckpoint(!!s.is_quality_checkpoint);
    setStepCheckpointType(s.checkpoint_type ?? 'foto');
    setStepCheckpointSpec(s.checkpoint_spec ?? '');
    setStepError(null);
    setEditingStepIndex(idx);
    setStepFormOpen(true);
  };
  const closeStepForm = () => { setStepFormOpen(false); setEditingStepIndex(null); };

  const saveStep = async () => {
    if (!openRoute) return;
    if (!stepName.trim()) { setStepError('El nombre del paso es obligatorio.'); return; }
    if (!stepWorkCenterId) { setStepError('Selecciona un centro de trabajo.'); return; }
    setStepError(null);
    const minutes = Number(String(stepMinutes).replace(',', '.')) || 0;
    const base = editingStepIndex != null ? sortedSteps[editingStepIndex] : null;
    const newStep: RouteStep = {
      step_no: base ? base.step_no : sortedSteps.length + 1,
      work_center_id: stepWorkCenterId,
      name: stepName.trim(),
      description: stepDescription.trim() || null,
      standard_minutes: minutes,
      is_quality_checkpoint: stepIsCheckpoint,
      checkpoint_type: stepIsCheckpoint ? stepCheckpointType : null,
      checkpoint_spec: stepIsCheckpoint && stepCheckpointSpec.trim() ? stepCheckpointSpec.trim() : null,
    };
    const newSteps = editingStepIndex != null
      ? sortedSteps.map((s, i) => (i === editingStepIndex ? newStep : s))
      : [...sortedSteps, newStep];
    setSavingStep(true);
    const { error } = await supabase.from('production_routes').update({ steps: newSteps }).eq('id', openRoute.id);
    setSavingStep(false);
    if (error) { setStepError(error.message); return; }
    toast.success('Paso guardado.');
    refetch();
    closeStepForm();
  };

  const moveStep = async (idx: number, dir: -1 | 1) => {
    if (!openRoute) return;
    const target = idx + dir;
    if (target < 0 || target >= sortedSteps.length) return;
    const a = sortedSteps[idx];
    const b = sortedSteps[target];
    const newSteps = sortedSteps
      .map((s, i) => (i === idx ? { ...s, step_no: b.step_no } : i === target ? { ...s, step_no: a.step_no } : s))
      .sort((x, y) => x.step_no - y.step_no);
    setBusyStep(idx);
    const { error } = await supabase.from('production_routes').update({ steps: newSteps }).eq('id', openRoute.id);
    setBusyStep(null);
    if (error) toast.error('No se pudo reordenar: ' + error.message); else refetch();
  };

  const deleteStep = async (idx: number) => {
    if (!openRoute) return;
    const ok = await confirm({ message: `¿Eliminar el paso "${sortedSteps[idx]?.name ?? ''}"? Esta acción no se puede deshacer.`, danger: true });
    if (!ok) return;
    const newSteps = sortedSteps.filter((_, i) => i !== idx).map((s, i) => ({ ...s, step_no: i + 1 }));
    setBusyStep(idx);
    const { error } = await supabase.from('production_routes').update({ steps: newSteps }).eq('id', openRoute.id);
    setBusyStep(null);
    if (error) { toast.error('No se pudo eliminar el paso: ' + error.message); return; }
    toast.success('Paso eliminado.');
    refetch();
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  const Btn = ({ label, onPress, color, disabled }: { label: string; onPress: () => void; color: string; disabled?: boolean }) => (
    <TouchableOpacity onPress={onPress} disabled={disabled} style={{ flexGrow: 1, flexBasis: 110, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: color, opacity: disabled ? 0.6 : 1 }}>
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{label}</Text>
    </TouchableOpacity>
  );
  const IconBtn = ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => (
    <TouchableOpacity onPress={onPress} disabled={disabled} style={{ width: 40, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, opacity: disabled ? 0.35 : 1 }}>
      <Text style={{ fontSize: 15 }}>{label}</Text>
    </TouchableOpacity>
  );
  const Chip = ({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) => (
    <TouchableOpacity onPress={onPress} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: active ? colors.brand : colors.border, backgroundColor: active ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
      <Text style={{ color: active ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{label}</Text>
    </TouchableOpacity>
  );

  if ((loadingProducts && products.length === 0) || (loadingRoutes && routes.length === 0)) {
    return <Screen><Loading /></Screen>;
  }

  return (
    <Screen>
      <SectionTitle>🛣️ Rutas de producción</SectionTitle>

      {/* Selector de producto — punto de entrada de toda la pantalla */}
      <Card>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>📦 Producto</Text>
        <Text style={{ color: colors.muted, fontSize: 11, marginBottom: spacing.xs }}>
          Selecciona el producto terminado para ver o crear sus rutas de producción.
        </Text>
        <TouchableOpacity
          onPress={() => setProductPickerOpen((v) => !v)}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}
        >
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13, flex: 1 }} numberOfLines={1}>
            {selectedProduct ? `${selectedProduct.name}${selectedProduct.sku ? ` (${selectedProduct.sku})` : ''}` : 'Selecciona un producto…'}
          </Text>
          <Text style={{ color: colors.brandText, fontWeight: '800' }}>{productPickerOpen ? '▲' : '▼'}</Text>
        </TouchableOpacity>
        {productPickerOpen ? (
          <View style={{ marginTop: spacing.xs }}>
            <TextInput value={productQuery} onChangeText={setProductQuery} placeholder="🔎 Buscar por nombre o SKU…" placeholderTextColor={colors.muted} style={input} />
            <View style={{ maxHeight: 240, marginTop: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' }}>
              {productOptions.length === 0 ? (
                <Text style={{ color: colors.muted, fontSize: 12, padding: spacing.sm }}>
                  {finishedProducts.length === 0 ? 'No hay productos terminados registrados en Inventario.' : 'Sin resultados.'}
                </Text>
              ) : (
                <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {productOptions.map((p) => (
                    <TouchableOpacity
                      key={p.id}
                      onPress={() => { setSelectedProductId(p.id); setOpenRouteId(''); setProductPickerOpen(false); setProductQuery(''); }}
                      style={{ paddingVertical: 8, paddingHorizontal: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface }}
                    >
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{p.name}</Text>
                      {p.sku ? <Text style={{ color: colors.muted, fontSize: 11 }}>SKU {p.sku}</Text> : null}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
            </View>
          </View>
        ) : null}
      </Card>

      {!selectedProductId ? (
        <EmptyState title="Selecciona un producto" subtitle="Elige un producto terminado arriba para ver o crear sus rutas de producción." />
      ) : !openRoute ? (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }} numberOfLines={1}>Rutas de {selectedProduct?.name}</Text>
            {canWrite ? (
              <TouchableOpacity onPress={crearRuta} disabled={creatingRoute} style={{ backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, opacity: creatingRoute ? 0.6 : 1 }}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>{creatingRoute ? 'Creando…' : '+ Nueva ruta'}</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {productRoutes.length === 0 ? (
            <EmptyState title="Sin rutas" subtitle="Este producto todavía no tiene ninguna ruta de producción registrada." />
          ) : (
            productRoutes.map((r) => {
              const info = STATUS_INFO[r.status] ?? STATUS_INFO.borrador;
              return (
                <TouchableOpacity key={r.id} onPress={() => setOpenRouteId(r.id)} activeOpacity={0.75}>
                  <Card>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.xs }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>{r.name}</Text>
                      <Pill label={info.label} tone={info.tone} colors={colors} />
                    </View>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>
                      🔧 {r.steps.length} paso(s) · Creada el {fmtFecha(r.created_at)}
                    </Text>
                  </Card>
                </TouchableOpacity>
              );
            })
          )}
        </>
      ) : (
        <>
          <TouchableOpacity onPress={() => { setOpenRouteId(''); setStepFormOpen(false); }} style={{ marginTop: spacing.sm }}>
            <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 13 }}>← Volver a las rutas</Text>
          </TouchableOpacity>

          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.xs }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16, flex: 1 }}>{openRoute.name}</Text>
              <Pill label={(STATUS_INFO[openRoute.status] ?? STATUS_INFO.borrador).label} tone={(STATUS_INFO[openRoute.status] ?? STATUS_INFO.borrador).tone} colors={colors} />
            </View>
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              {openRoute.steps.length} paso(s) · Creada el {fmtFecha(openRoute.created_at)}
            </Text>
            {canWrite ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
                {openRoute.status === 'borrador' ? (
                  <Btn label="✅ Activar ruta" color="#059669" disabled={busyRoute} onPress={activarRuta} />
                ) : null}
                {openRoute.status === 'activa' ? (
                  <Btn label="⚪ Marcar obsoleta" color="#64748B" disabled={busyRoute} onPress={marcarObsoleta} />
                ) : null}
              </View>
            ) : null}
          </Card>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>Pasos</Text>
            {canWrite && !stepFormOpen ? (
              <TouchableOpacity onPress={openNewStep} style={{ backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>+ Agregar paso</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {sortedSteps.length === 0 ? (
            <EmptyState title="Sin pasos" subtitle="Esta ruta todavía no tiene pasos. Agrega el primero con el botón de arriba." />
          ) : (
            sortedSteps.map((s, idx) => {
              const wc = s.work_center_id ? workCenterMap[s.work_center_id] : undefined;
              const cp = s.checkpoint_type ? CHECKPOINT_INFO[s.checkpoint_type] : undefined;
              return (
                <Card key={idx}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.xs }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, flex: 1 }}>{s.step_no}. {s.name}</Text>
                    {s.is_quality_checkpoint ? <Pill label="🔍 Control de calidad" tone="info" colors={colors} /> : null}
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    🏭 {wc ? `${wc.code} · ${wc.name}` : '—'} · ⏱️ {s.standard_minutes} min
                  </Text>
                  {s.description ? <Text style={{ color: colors.text, fontSize: 13 }}>{s.description}</Text> : null}
                  {s.is_quality_checkpoint && cp ? (
                    <Text style={{ color: colors.muted, fontSize: 11 }}>
                      {cp.icon} {cp.label}{s.checkpoint_spec ? ` — ${s.checkpoint_spec}` : ''}
                    </Text>
                  ) : null}
                  {canWrite ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
                      <IconBtn label="⬆️" onPress={() => moveStep(idx, -1)} disabled={idx === 0 || busyStep === idx} />
                      <IconBtn label="⬇️" onPress={() => moveStep(idx, 1)} disabled={idx === sortedSteps.length - 1 || busyStep === idx} />
                      <Btn label="✏️ Editar" color="#475569" onPress={() => openEditStep(idx)} />
                      <Btn label="🗑️ Eliminar" color="#B91C1C" disabled={busyStep === idx} onPress={() => deleteStep(idx)} />
                    </View>
                  ) : null}
                </Card>
              );
            })
          )}

          {stepFormOpen ? (
            <Card>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>
                {editingStepIndex != null ? '✏️ Editar paso' : '+ Nuevo paso'}
              </Text>

              <Text style={{ color: colors.muted, fontSize: 12 }}>Nombre *</Text>
              <TextInput value={stepName} onChangeText={setStepName} placeholder="Ej. Corte de manguera" placeholderTextColor={colors.muted} style={input} />

              <Text style={{ color: colors.muted, fontSize: 12 }}>Descripción (opcional)</Text>
              <TextInput value={stepDescription} onChangeText={setStepDescription} placeholder="Detalle del trabajo…" placeholderTextColor={colors.muted} style={input} />

              <Text style={{ color: colors.muted, fontSize: 12 }}>Centro de trabajo *</Text>
              <SearchDropdown options={workCenterOptions} value={stepWorkCenterId} onChange={setStepWorkCenterId} placeholder="Seleccionar centro de trabajo…" />

              <Text style={{ color: colors.muted, fontSize: 12 }}>Minutos estándar</Text>
              <TextInput
                value={stepMinutes}
                onChangeText={(t) => setStepMinutes(onlyDecimal(t))}
                placeholder="0"
                placeholderTextColor={colors.muted}
                keyboardType="numeric"
                inputMode="numeric"
                style={input}
              />

              <Text style={{ color: colors.muted, fontSize: 12 }}>¿Es punto de control de calidad?</Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                <Chip label="No" active={!stepIsCheckpoint} onPress={() => setStepIsCheckpoint(false)} />
                <Chip label="🔍 Sí, es punto de control" active={stepIsCheckpoint} onPress={() => setStepIsCheckpoint(true)} />
              </View>

              {stepIsCheckpoint ? (
                <>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>Tipo de control</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                    <Chip label="📷 Foto" active={stepCheckpointType === 'foto'} onPress={() => setStepCheckpointType('foto')} />
                    <Chip label="📏 Medición" active={stepCheckpointType === 'medicion'} onPress={() => setStepCheckpointType('medicion')} />
                    <Chip label="✅ Aprobación" active={stepCheckpointType === 'aprobacion'} onPress={() => setStepCheckpointType('aprobacion')} />
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>Nota / especificación (opcional)</Text>
                  <TextInput
                    value={stepCheckpointSpec}
                    onChangeText={setStepCheckpointSpec}
                    placeholder="Ej. presión esperada entre 180-200 PSI"
                    placeholderTextColor={colors.muted}
                    style={input}
                  />
                </>
              ) : null}

              {stepError ? <Text style={{ color: colors.danger, marginTop: spacing.sm }}>{stepError}</Text> : null}

              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                <TouchableOpacity onPress={closeStepForm} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                  <Text style={{ color: colors.text, fontWeight: '600' }}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={saveStep} disabled={savingStep} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary, opacity: savingStep ? 0.6 : 1 }}>
                  <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>{savingStep ? 'Guardando…' : 'Guardar paso'}</Text>
                </TouchableOpacity>
              </View>
            </Card>
          ) : null}
        </>
      )}

      <View style={{ height: spacing.lg }} />
    </Screen>
  );
}
