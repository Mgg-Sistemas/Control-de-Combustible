// Módulo de Fabricación (MRP) — Fase 5: Reportes (OEE + Costeo por orden).
// Lee la vista `public.wo_oee` (supabase/fabricacion_calidad_oee.sql) con los
// insumos CRUDOS por centro de trabajo/período (tiempo en_proceso vs.
// pausada/falla, cantidad completada/planificada/scrap) y calcula OEE en el
// cliente (Disponibilidad × Rendimiento × Calidad). También muestra el
// costeo estimado/real de las `manufacturing_orders` del período, con edición
// rápida del costo real para órdenes cerradas que aún no lo tienen. Reutiliza
// el mismo permiso de módulo que el resto de Fabricación ('mangueras' =
// "Fabricación"): no se crea una clave de permiso nueva. Pantalla de solo
// LECTURA de datos (no crea MOs/WOs); el único guardado es el costo real.
//
// `wo_oee` (supabase/fabricacion_calidad_oee.sql) es de grano POR ORDEN DE
// TRABAJO (una fila por WO, no pre-agregada por centro/período): expone
// en_proceso_seconds/pausada_seconds/fallas_count + qty_planned/completed/
// scrap por WO. Esta pantalla filtra por fecha (started_at, o created_at si
// aún no arrancó) y agrega client-side por centro de trabajo — igual criterio
// que costMos usa created_at/closed_at para las órdenes de fabricación.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { DateField } from '../components/DateField';
import { useTable } from '../hooks/useTable';
import { supabase } from '../lib/supabase';
import { onlyDecimal, cmpText } from '../lib/text';
import { useAuth } from '../context/AuthContext';
import { levelMeets } from '../lib/permissions';
import { useToast } from '../components/ToastProvider';
import { fmtUsd } from '../lib/bcv';
import { dateRangeLabel } from '../lib/pdf';
import { generateManufacturingReport, OeeSummaryRow, CostRow } from '../lib/manufacturingReport';
import { ManufacturingOrder } from '../types/database';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

type WcRow = { id: string; code: string; name: string };
type ProductRow = { id: string; name: string };

/** Fila cruda de la vista `wo_oee` (grano por WO — ver supabase/fabricacion_calidad_oee.sql). */
interface WoOeeRow {
  wo_id: string;
  mo_id: string;
  wo_no: number;
  wo_name: string;
  work_center_id: string | null;
  work_center_code: string | null;
  work_center_name: string | null;
  status: string;
  qty_planned: number | null;
  qty_completed: number;
  qty_scrap: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  en_proceso_seconds: number;
  pausada_seconds: number;
  fallas_count: number;
}

type OeeAgg = OeeSummaryRow & { work_center_id: string | null };

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function parseNum(t: string): number {
  const n = Number(String(t ?? '').replace(',', '.').replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : 0;
}

const qtyFmt = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString();

// Umbrales estándar de OEE (mundo-clase ≥85%, típico 60-84%, bajo <60%).
function oeeBand(n: number | null): { icon: string; tone: Tone } {
  if (n == null) return { icon: '⚪', tone: 'info' };
  if (n >= 85) return { icon: '🟢', tone: 'success' };
  if (n >= 60) return { icon: '🟡', tone: 'warning' };
  return { icon: '🔴', tone: 'danger' };
}
const pctTxt = (n: number | null) => (n == null ? '—' : `${(Math.round(n * 10) / 10).toLocaleString('es-VE')}%`);

/** Disponibilidad/Rendimiento/Calidad/OEE a partir de los insumos crudos
 *  sumados. Guarda contra división por cero devolviendo null (se muestra "—"). */
function computeOee(agg: {
  en_proceso_seconds: number;
  pausada_seconds: number;
  qty_completed: number;
  qty_planned: number;
  qty_scrap: number;
}): { availability: number | null; performance: number | null; quality: number | null; oee: number | null } {
  const totalTime = (agg.en_proceso_seconds || 0) + (agg.pausada_seconds || 0);
  const availability = totalTime > 0 ? ((agg.en_proceso_seconds || 0) / totalTime) * 100 : null;
  const performance = (agg.qty_planned || 0) > 0 ? ((agg.qty_completed || 0) / agg.qty_planned) * 100 : null;
  const quality = (agg.qty_completed || 0) > 0 ? (((agg.qty_completed || 0) - (agg.qty_scrap || 0)) / agg.qty_completed) * 100 : null;
  const oee =
    availability != null && performance != null && quality != null
      ? (availability / 100) * (performance / 100) * (quality / 100) * 100
      : null;
  return { availability, performance, quality, oee };
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

/** Panel grande de OEE (banda + % prominente + Disponibilidad/Rendimiento/Calidad). */
function OeeDashboard({ agg, title, colors }: { agg: OeeSummaryRow; title: string; colors: any }) {
  const band = oeeBand(agg.oee);
  return (
    <Card>
      <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700' }}>{title}</Text>
      <View style={{ alignItems: 'center', paddingVertical: spacing.sm }}>
        <Text style={{ fontSize: 34 }}>{band.icon}</Text>
        <Text style={{ color: colors.text, fontSize: 40, fontWeight: '900' }}>{pctTxt(agg.oee)}</Text>
        <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700' }}>OEE (Disponibilidad × Rendimiento × Calidad)</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
        {[
          { label: 'Disponibilidad', value: agg.availability },
          { label: 'Rendimiento', value: agg.performance },
          { label: 'Calidad', value: agg.quality },
        ].map((s) => (
          <View key={s.label} style={{ flex: 1, minWidth: 90, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>{pctTxt(s.value)}</Text>
            <Text style={{ color: colors.muted, fontSize: 11, textAlign: 'center' }}>{s.label}</Text>
          </View>
        ))}
      </View>
      <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>
        📦 {qtyFmt(agg.qty_completed)}/{qtyFmt(agg.qty_planned)} completado · ♻️ {qtyFmt(agg.qty_scrap)} scrap
      </Text>
    </Card>
  );
}

export default function ManufacturingReportsScreen() {
  const { colors } = useTheme();
  const { moduleLevel } = useAuth();
  const toast = useToast();
  const level = moduleLevel('mangueras');

  if (level === 'none') {
    return (
      <Screen>
        <SectionTitle>Reportes de Fabricación</SectionTitle>
        <EmptyState title="Sin acceso" subtitle="No tienes permiso para ver este módulo. Pídeselo a un administrador." />
      </Screen>
    );
  }
  const canWrite = levelMeets(level, 'escritura');

  // ── Datos base ───────────────────────────────────────────────────────────
  const { data: workCenters } = useTable<WcRow>('work_centers', { select: 'id, code, name', orderBy: 'code' });
  const { data: products } = useTable<ProductRow>('inventory_items', { select: 'id, name' });
  const { data: mos, loading: loadingMos, refetch: refetchMos } = useTable<ManufacturingOrder>('manufacturing_orders', { orderBy: 'created_at', ascending: false });

  // `wo_oee` es una VISTA (posiblemente sin columna `id` estable): se lee con
  // un fetch propio en vez de `useTable` (que asume `id` para paginar/ordenar).
  const [oeeRows, setOeeRows] = useState<WoOeeRow[]>([]);
  const [oeeLoading, setOeeLoading] = useState(true);
  const [oeeError, setOeeError] = useState<string | null>(null);
  const fetchOee = useCallback(async () => {
    setOeeLoading(true);
    const { data, error } = await supabase.from('wo_oee').select('*');
    if (error) { setOeeError(error.message); setOeeRows([]); }
    else { setOeeError(null); setOeeRows((data as any[]) ?? []); }
    setOeeLoading(false);
  }, []);
  useEffect(() => { fetchOee(); }, [fetchOee]);

  const workCenterMap = useMemo(() => {
    const m: Record<string, WcRow> = {};
    workCenters.forEach((w) => { m[w.id] = w; });
    return m;
  }, [workCenters]);
  const productMap = useMemo(() => {
    const m: Record<string, string> = {};
    products.forEach((p) => { m[p.id] = p.name; });
    return m;
  }, [products]);
  const wcLabel = (id: string) => (workCenterMap[id] ? `${workCenterMap[id].code} · ${workCenterMap[id].name}` : id);

  // ── Filtros ─────────────────────────────────────────────────────────────
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [workCenterId, setWorkCenterId] = useState(''); // '' = todos
  const setRange = (days: number) => { setFrom(isoDaysAgo(days)); setTo(isoDaysAgo(0)); };

  const filteredOee = useMemo(() => {
    return oeeRows.filter((r) => {
      if (workCenterId && r.work_center_id !== workCenterId) return false;
      const d = String(r.started_at || r.created_at || '').slice(0, 10);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [oeeRows, workCenterId, from, to]);

  // ── OEE: agregado general + desglose por centro de trabajo ─────────────
  const overallAgg: OeeAgg = useMemo(() => {
    const base = filteredOee.reduce(
      (acc, r) => ({
        en_proceso_seconds: acc.en_proceso_seconds + (Number(r.en_proceso_seconds) || 0),
        pausada_seconds: acc.pausada_seconds + (Number(r.pausada_seconds) || 0),
        qty_completed: acc.qty_completed + (Number(r.qty_completed) || 0),
        qty_planned: acc.qty_planned + (Number(r.qty_planned) || 0),
        qty_scrap: acc.qty_scrap + (Number(r.qty_scrap) || 0),
      }),
      { en_proceso_seconds: 0, pausada_seconds: 0, qty_completed: 0, qty_planned: 0, qty_scrap: 0 }
    );
    return { work_center_id: null, label: 'Todos los centros', ...base, ...computeOee(base) };
  }, [filteredOee]);

  const byWorkCenterAgg: OeeAgg[] = useMemo(() => {
    const map = new Map<string, typeof overallAgg>();
    filteredOee.forEach((r) => {
      const wcId = r.work_center_id || '—';
      const label = r.work_center_id
        ? (r.work_center_code && r.work_center_name ? `${r.work_center_code} · ${r.work_center_name}` : wcLabel(r.work_center_id))
        : 'Sin centro de trabajo';
      const cur = map.get(wcId) ?? {
        work_center_id: r.work_center_id, label,
        en_proceso_seconds: 0, pausada_seconds: 0, qty_completed: 0, qty_planned: 0, qty_scrap: 0,
        availability: null, performance: null, quality: null, oee: null,
      };
      cur.en_proceso_seconds += Number(r.en_proceso_seconds) || 0;
      cur.pausada_seconds += Number(r.pausada_seconds) || 0;
      cur.qty_completed += Number(r.qty_completed) || 0;
      cur.qty_planned += Number(r.qty_planned) || 0;
      cur.qty_scrap += Number(r.qty_scrap) || 0;
      map.set(wcId, cur);
    });
    return Array.from(map.values())
      .map((a) => ({ ...a, ...computeOee(a) }))
      .sort((a, b) => cmpText(a.label, b.label));
  }, [filteredOee, workCenterMap]);

  // ── Costeo por orden: MOs del período (por closed_at si existe, si no created_at) ─
  const dateOf = (m: ManufacturingOrder) => (m.closed_at || m.created_at || '').slice(0, 10);
  const costMos = useMemo(() => {
    return mos
      .filter((m) => {
        const d = dateOf(m);
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      })
      .sort((a, b) => (dateOf(b) < dateOf(a) ? -1 : dateOf(b) > dateOf(a) ? 1 : 0));
  }, [mos, from, to]);

  // ── Edición rápida de costo real (solo órdenes cerradas sin costo real) ──
  const [editingCost, setEditingCost] = useState<Record<string, string>>({});
  const [savingCost, setSavingCost] = useState<string | null>(null);
  const saveRealCost = async (m: ManufacturingOrder) => {
    const val = parseNum(editingCost[m.id] ?? '');
    if (val <= 0) { toast.error('Ingresa un costo real mayor que cero.'); return; }
    setSavingCost(m.id);
    const { error } = await supabase.from('manufacturing_orders').update({ real_cost: val }).eq('id', m.id);
    setSavingCost(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`Costo real de ${m.code} actualizado.`);
    setEditingCost((s) => { const n = { ...s }; delete n[m.id]; return n; });
    refetchMos();
  };

  // ── PDF ─────────────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);
  const periodLabel = `${dateRangeLabel(from, to) || `${from} → ${to}`}`;
  const workCenterFilterLabel = workCenterId ? wcLabel(workCenterId) : 'Todos los centros';
  const exportarPdf = async () => {
    setExporting(true);
    try {
      const byWc: OeeSummaryRow[] = workCenterId ? [] : byWorkCenterAgg.map(({ work_center_id, ...r }) => r);
      const costRows: CostRow[] = costMos.map((m) => ({
        code: m.code,
        product: productMap[m.product_item_id] ?? '—',
        qty_produced: Number(m.qty_produced) || 0,
        estimated_cost: Number(m.estimated_cost) || 0,
        real_cost: Number(m.real_cost) || 0,
      }));
      await generateManufacturingReport({
        periodLabel,
        workCenterLabel: workCenterFilterLabel,
        overall: overallAgg,
        byWorkCenter: byWc,
        costRows,
      });
    } finally {
      setExporting(false);
    }
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  if ((oeeLoading && oeeRows.length === 0) || (loadingMos && mos.length === 0)) {
    return <Screen><Loading /></Screen>;
  }

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>📊 Reportes de Fabricación</SectionTitle>
        <TouchableOpacity
          onPress={exportarPdf}
          disabled={exporting}
          style={{ backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, opacity: exporting ? 0.6 : 1 }}
        >
          <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>{exporting ? 'Generando…' : '📄 Exportar PDF'}</Text>
        </TouchableOpacity>
      </View>

      {/* ── Filtros ────────────────────────────────────────────────────── */}
      <Card>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>Filtros</Text>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>Rango de fechas</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.muted, fontSize: 11 }}>Desde</Text>
            <DateField value={from} onChange={setFrom} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.muted, fontSize: 11 }}>Hasta</Text>
            <DateField value={to} onChange={setTo} />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs, flexWrap: 'wrap' }}>
          {[{ label: 'Hoy', d: 0 }, { label: '7 días', d: 7 }, { label: '30 días', d: 30 }, { label: '90 días', d: 90 }].map((q) => (
            <TouchableOpacity key={q.label} onPress={() => setRange(q.d)} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}>
              <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>{q.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm }}>Centro de trabajo</Text>
        <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs, flexWrap: 'wrap' }}>
          <TouchableOpacity
            onPress={() => setWorkCenterId('')}
            style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: !workCenterId ? colors.brand : colors.border, backgroundColor: !workCenterId ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}
          >
            <Text style={{ color: !workCenterId ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>Todos</Text>
          </TouchableOpacity>
          {workCenters.map((w) => {
            const on = workCenterId === w.id;
            return (
              <TouchableOpacity
                key={w.id}
                onPress={() => setWorkCenterId(w.id)}
                style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }}
              >
                <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{w.code}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Card>

      {/* ── Dashboard OEE ─────────────────────────────────────────────── */}
      <SectionTitle>⚙️ OEE del período</SectionTitle>
      {oeeError ? (
        <EmptyState title="No se pudo leer wo_oee" subtitle={oeeError} />
      ) : filteredOee.length === 0 ? (
        <EmptyState title="Sin datos de OEE" subtitle="No hay registros de producción para este período/centro de trabajo." />
      ) : (
        <>
          <OeeDashboard agg={overallAgg} title={workCenterId ? wcLabel(workCenterId) : 'Agregado — todos los centros'} colors={colors} />
          {!workCenterId && byWorkCenterAgg.length > 1 ? (
            <>
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: spacing.xs }}>Por centro de trabajo</Text>
              {byWorkCenterAgg.map((a) => {
                const band = oeeBand(a.oee);
                return (
                  <Card key={a.work_center_id}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.xs }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, flex: 1 }}>{a.label}</Text>
                      <Pill label={`${band.icon} OEE ${pctTxt(a.oee)}`} tone={band.tone} colors={colors} />
                    </View>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>
                      Disp. {pctTxt(a.availability)} · Rend. {pctTxt(a.performance)} · Cal. {pctTxt(a.quality)}
                    </Text>
                  </Card>
                );
              })}
            </>
          ) : null}
        </>
      )}

      {/* ── Costeo por orden ─────────────────────────────────────────── */}
      <SectionTitle>💰 Costeo por orden</SectionTitle>
      {costMos.length === 0 ? (
        <EmptyState title="Sin órdenes" subtitle="No hay órdenes de fabricación en este período." />
      ) : (
        costMos.map((m) => {
          const estimated = Number(m.estimated_cost) || 0;
          const real = Number(m.real_cost) || 0;
          const variance = real - estimated;
          const needsCost = canWrite && m.status === 'cerrada' && real <= 0;
          const editing = editingCost[m.id];
          return (
            <Card key={m.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.xs }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>{m.code}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{productMap[m.product_item_id] ?? '—'}</Text>
                </View>
                <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 12 }}>📦 {qtyFmt(m.qty_produced)} {m.uom || ''}</Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.xs }}>
                <Text style={{ color: colors.text, fontSize: 12 }}>Estimado: <Text style={{ fontWeight: '800' }}>{fmtUsd(estimated)}</Text></Text>
                <Text style={{ color: colors.text, fontSize: 12 }}>Real: <Text style={{ fontWeight: '800' }}>{fmtUsd(real)}</Text></Text>
                {real > 0 || estimated > 0 ? (
                  <Text style={{ color: variance > 0 ? colors.dangerSoftText : colors.successSoftText, fontSize: 12, fontWeight: '800' }}>
                    Variación: {variance > 0 ? '+' : ''}{fmtUsd(variance)}
                  </Text>
                ) : null}
              </View>
              {needsCost ? (
                editing != null ? (
                  <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs, alignItems: 'center' }}>
                    <TextInput
                      value={editing}
                      onChangeText={(t) => setEditingCost((s) => ({ ...s, [m.id]: onlyDecimal(t) }))}
                      placeholder="Costo real (US$)"
                      placeholderTextColor={colors.muted}
                      keyboardType="numeric"
                      inputMode="decimal"
                      style={[input, { flex: 1 }]}
                    />
                    <TouchableOpacity onPress={() => saveRealCost(m)} disabled={savingCost === m.id} style={{ backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, opacity: savingCost === m.id ? 0.6 : 1 }}>
                      <Text style={{ color: colors.primaryContrast, fontWeight: '700', fontSize: 12 }}>Guardar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setEditingCost((s) => { const n = { ...s }; delete n[m.id]; return n; })} style={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.sm }}>
                      <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 12 }}>Cancelar</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity onPress={() => setEditingCost((s) => ({ ...s, [m.id]: '' }))} style={{ alignSelf: 'flex-start', marginTop: spacing.xs }}>
                    <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 12 }}>✏️ Registrar costo real</Text>
                  </TouchableOpacity>
                )
              ) : null}
            </Card>
          );
        })
      )}

      <View style={{ height: spacing.lg }} />
    </Screen>
  );
}
