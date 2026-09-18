import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Screen, Card, SectionTitle, Loading, EmptyState, SkeletonList } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import { listFoodByDate } from '../lib/foodDistributions';
import { listCompanyMealsByDate, listCompanyMealsBetween, MEALS, COMPANY_MEALS, mealLabel } from '../lib/foodCompanyMeals';
import { fmtUsd } from '../lib/bcv';
import { FoodDistribution, FoodCompanyMeal } from '../types/database';
import { supabase } from '../lib/supabase';
import { cmpText } from '../lib/text';
import { comidaQrUrl, qrPngDataUri } from '../lib/qr';
// Solo la imagen del QR: el PDF ahora lo arma <ComidaReporteModal>.
import { exportCardImage } from '../lib/pdf';
import { LOGO_DATA_URI } from '../lib/logoData';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useAuth } from '../context/AuthContext';
import { levelMeets } from '../lib/permissions';
import { CobroComidasResumen } from '../components/CobroComidasResumen';
import { ComidaEditor } from '../components/ComidaEditor';
import { ComidaMovimientos } from '../components/ComidaMovimientos';
import { ComidaReporteModal } from '../components/ComidaReporteModal';
import { cargarPreciosComida } from '../lib/cobroComidasDb';
import { PrecioComida } from '../lib/cobroComidas';

const CARACAS_TZ = 'America/Caracas';
function caracasToday(): string {
  const p: any = new Intl.DateTimeFormat('en-CA', { timeZone: CARACAS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((a: any, x: any) => { a[x.type] = x.value; return a; }, {});
  return `${p.year}-${p.month}-${p.day}`;
}
function caracasClock(iso: string): string {
  return new Intl.DateTimeFormat('es-VE', { timeZone: CARACAS_TZ, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso));
}
function niceDay(iso: string): string {
  return new Intl.DateTimeFormat('es-VE', { timeZone: CARACAS_TZ, weekday: 'short', day: '2-digit', month: 'short' }).format(new Date(iso + 'T12:00:00'));
}
function addDaysISO(iso: string, delta: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}
/** Lunes de la semana de `iso` (semana lunes→domingo). */
function startOfWeekISO(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  const dow = (d.getDay() + 6) % 7; // lunes = 0
  d.setDate(d.getDate() - dow);
  return d.toISOString().slice(0, 10);
}
/** Primer día del mes de `iso`. */
function startOfMonthISO(iso: string): string {
  return iso.slice(0, 8) + '01';
}

/**
 * Módulo "Distribución de comida" (para el jefe): por día, cuántas comidas se
 * repartieron y a quién. Agrupa por persona con su total y el detalle de cada
 * entrega (hora + quién la repartió).
 */
export default function ComidaScreen() {
  const { colors } = useTheme();
  const { session, moduleLevel, fullName } = useAuth();
  // El cobro (montos y precios) solo lo ve quien tiene permiso completo de Comida.
  // El MISMO nivel manda para corregir el histórico (18-sep-2026): quien ya puede
  // ver y poner precios es quien responde por lo que se cobra.
  const canCobro = levelMeets(moduleLevel('comida'), 'full');
  const canEditar = canCobro;
  const [mode, setMode] = useState<'dia' | 'control'>('dia');
  const [date, setDate] = useState(caracasToday());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<FoodDistribution[]>([]);
  const [companyMeals, setCompanyMeals] = useState<FoodCompanyMeal[]>([]);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [qrBusy, setQrBusy] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  // ── Control por empresa (rango de fechas) ──
  const [from, setFrom] = useState(caracasToday()); // por defecto: solo el día de hoy
  const [to, setTo] = useState(caracasToday());
  const [rangeRows, setRangeRows] = useState<FoodCompanyMeal[]>([]);
  const [rangePersons, setRangePersons] = useState<FoodDistribution[]>([]); // entregas individuales del rango
  const [rangeLoading, setRangeLoading] = useState(false);
  const [companyFilter, setCompanyFilter] = useState<string>('all'); // 'all' o company_id
  // Reporte con opciones (18-sep-2026): el modal con filtros y pastillas.
  const [reporteOpen, setReporteOpen] = useState(false);
  // Los precios viven acá para que el PDF cobre EXACTAMENTE lo mismo que muestra
  // la tarjeta de cobro. Dos maneras de calcular la misma plata es como se
  // termina discutiendo una factura.
  const [precios, setPrecios] = useState<PrecioComida[] | null>(null);
  // Lectura fallida: antes la pantalla se quedaba vacía o con datos viejos sin avisar.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rr, cm, { data: comps }] = await Promise.all([
        listFoodByDate(date),
        listCompanyMealsByDate(date),
        // Solo empresas ACTIVAS (las ocultas/desactivadas, p. ej. HBS, no generan QR).
        supabase.from('companies').select('id, name, hidden').order('name', { ascending: true }),
      ]);
      setRows(rr);
      setCompanyMeals(cm);
      setCompanies(((comps ?? []) as any[]).filter((c) => !c.hidden).map((c) => ({ id: c.id, name: c.name })));
      setLoadError(null);
    } catch (e: any) {
      setLoadError(`No se pudieron cargar las comidas del día (${e?.message ?? 'revisa la conexión'}). Desliza hacia abajo para reintentar.`);
    } finally {
      // SIEMPRE se apaga el "cargando", aunque alguna consulta falle (p. ej. sin
      // conexión desde el teléfono): si no, la pantalla se quedaba congelada en el
      // esqueleto para siempre, aunque los datos sí hayan llegado a bajar antes.
      setLoading(false);
    }
  }, [date]);
  useEffect(() => { load(); }, [load]);

  // Carga del control por rango (solo en modo control): comidas por empresa + entregas por persona.
  const loadRange = useCallback(async () => {
    setRangeLoading(true);
    try {
      const [comp, persons] = await Promise.all([
        listCompanyMealsBetween(from, to),
        listFoodByDate(from, to),
      ]);
      setRangeRows(comp);
      setRangePersons(persons);
      setRangeError(null);
    } catch (e: any) {
      setRangeError(`No se pudieron cargar todas las comidas del rango (${e?.message ?? 'revisa la conexión'}). El reporte no se muestra incompleto: desliza hacia abajo para reintentar.`);
    } finally {
      setRangeLoading(false);
    }
  }, [from, to]);
  useEffect(() => { if (mode === 'control') loadRange(); }, [mode, loadRange]);

  // Los precios se leen una sola vez, y solo si se pueden ver: sin permiso
  // completo el reporte sale sin montos y esta consulta no haría falta.
  useEffect(() => {
    if (!canCobro) return;
    // Que fallen los precios no puede tumbar la pantalla: el reporte sale sin
    // montos y el resto sigue funcionando.
    cargarPreciosComida().then(setPrecios, () => setPrecios(null));
  }, [canCobro]);

  // TIEMPO REAL: cuando la cocina registra/borra una comida (por persona o por
  // empresa), esta pantalla se actualiza sola, sin tener que refrescar a mano.
  useRealtimeRefresh(['food_distributions', 'food_company_meals'], () => {
    load();
    if (mode === 'control') loadRange();
  });

  // Pull-to-refresh: recarga el día actual y, si está en modo "control", también el rango.
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([load(), mode === 'control' ? loadRange() : Promise.resolve()]);
    setRefreshing(false);
  };

  // Resumen POR PERSONA en el rango (entregas individuales por carnet).
  const rangeByPerson = useMemo(() => {
    const map = new Map<string, { name: string; cedula: string; total: number; by: Record<string, number>; days: Set<string> }>();
    rangePersons.forEach((r) => {
      const k = r.employee_id ?? (r.cedula || r.employee_name);
      if (!map.has(k)) map.set(k, { name: r.employee_name, cedula: (r as any).cedula ?? '', total: 0, by: {}, days: new Set() });
      const g = map.get(k)!;
      const n = Number(r.meals) || 0;
      g.total += n;
      if (r.meal_type) g.by[r.meal_type] = (g.by[r.meal_type] || 0) + n;
      g.days.add(r.distribution_date);
    });
    return Array.from(map.values()).sort((a, b) => cmpText(a.name, b.name));
  }, [rangePersons]);
  const rangePersonsTotal = useMemo(() => rangePersons.reduce((a, r) => a + (Number(r.meals) || 0), 0), [rangePersons]);
  const rangePersonsByMeal = useMemo(() => {
    const by: Record<string, number> = {};
    rangePersons.forEach((r) => { if (r.meal_type) by[r.meal_type] = (by[r.meal_type] || 0) + (Number(r.meals) || 0); });
    return by;
  }, [rangePersons]);

  // Empresas presentes en el rango (para el filtro).
  const rangeCompanies = useMemo(() => {
    const m = new Map<string, string>();
    rangeRows.forEach((r) => m.set(r.company_id ?? r.company_name, r.company_name));
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) => cmpText(a.name, b.name));
  }, [rangeRows]);

  const rangeFiltered = useMemo(
    () => (companyFilter === 'all' ? rangeRows : rangeRows.filter((r) => (r.company_id ?? r.company_name) === companyFilter)),
    [rangeRows, companyFilter]
  );

  // Resumen por empresa: total por tiempo de comida + total + días con entrega.
  const rangeByCompany = useMemo(() => {
    const map = new Map<string, { name: string; by: Record<string, number>; total: number; days: Set<string> }>();
    rangeFiltered.forEach((r) => {
      const k = r.company_id ?? r.company_name;
      if (!map.has(k)) map.set(k, { name: r.company_name, by: {}, total: 0, days: new Set() });
      const g = map.get(k)!;
      g.by[r.meal_type] = (g.by[r.meal_type] || 0) + (Number(r.delivered) || 0);
      g.total += Number(r.delivered) || 0;
      g.days.add(r.meal_date);
    });
    return Array.from(map.values()).sort((a, b) => cmpText(a.name, b.name));
  }, [rangeFiltered]);

  // Totales generales del rango (por tiempo de comida + total).
  const rangeTotals = useMemo(() => {
    const by: Record<string, number> = {}; let total = 0;
    rangeFiltered.forEach((r) => { by[r.meal_type] = (by[r.meal_type] || 0) + (Number(r.delivered) || 0); total += Number(r.delivered) || 0; });
    return { by, total };
  }, [rangeFiltered]);

  // Historial día por día (solo cuando hay UNA empresa elegida) → { fecha: {meal: cm} }.
  const rangeHistory = useMemo(() => {
    if (companyFilter === 'all') return [];
    const map = new Map<string, Partial<Record<string, FoodCompanyMeal>>>();
    rangeFiltered.forEach((r) => {
      if (!map.has(r.meal_date)) map.set(r.meal_date, {});
      map.get(r.meal_date)![r.meal_type] = r;
    });
    return Array.from(map, ([d, meals]) => ({ date: d, meals })).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [rangeFiltered, companyFilter]);

  const rangeCompanyName = companyFilter === 'all' ? 'Todas las empresas' : (rangeCompanies.find((c) => c.id === companyFilter)?.name ?? '');

  const shiftRange = (delta: number) => { setFrom(addDaysISO(from, delta)); setTo(addDaysISO(to, delta)); };

  // ⚠️ EL PDF VIEJO SE FUE (18-sep-2026). Era un botón sin opciones que armaba su
  //    propio HTML sin membrete, distinto a todos los demás papeles del sistema.
  //    Lo reemplaza <ComidaReporteModal>, que saca EL MISMO papel por defecto
  //    (`OPCIONES_COMIDA_COMO_ANTES`) y encima deja filtrar y quitar columnas.

  // Agrupa las comidas por empresa, SUMANDO las varias entregas del día por comida
  // (17-sep-2026: ya no es 1 por día; se acumulan) + costo en $.
  const companyGroups = useMemo(() => {
    type Sum = { delivered: number; count: number; lastAt: string; usd: number };
    const map = new Map<string, { name: string; meals: Record<string, Sum>; total: number }>();
    companyMeals.forEach((cm) => {
      const k = cm.company_id ?? cm.company_name;
      if (!map.has(k)) map.set(k, { name: cm.company_name, meals: {}, total: 0 });
      const g = map.get(k)!;
      const cur = g.meals[cm.meal_type] || { delivered: 0, count: 0, lastAt: '', usd: 0 };
      cur.delivered += Number(cm.delivered) || 0;
      cur.count += 1;
      const at = String(cm.delivered_at ?? '');
      if (at > cur.lastAt) cur.lastAt = at;
      cur.usd += (Number(cm.delivered) || 0) * (Number((cm as any).unit_cost) || 0);
      g.meals[cm.meal_type] = cur;
      g.total += Number(cm.delivered) || 0;
    });
    return Array.from(map.values()).sort((a, b) => cmpText(a.name, b.name));
  }, [companyMeals]);
  const companyTotal = companyMeals.reduce((a, c) => a + (Number(c.delivered) || 0), 0);

  // Descarga el QR de UNA empresa como IMAGEN (logo + QR horizontal + nombre).
  const downloadCompanyQr = async (c: { id: string; name: string }) => {
    setQrBusy(c.id);
    try {
      const qr = await qrPngDataUri(comidaQrUrl(c.id), 520);
      const styles = `
        *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        html,body{margin:0;padding:0}
        .qcard{width:90mm;height:54mm;background:#fff;font-family:Tahoma,Geneva,Verdana,sans-serif;
          display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4mm}
        .qrow{display:flex;align-items:center;gap:7mm}
        .qlogo{height:28mm;width:auto}
        .qimg{width:36mm;height:36mm}
        .qname{margin-top:3mm;font-weight:800;font-size:5mm;color:#16324F;text-align:center;letter-spacing:.2mm}`;
      // Escapar el nombre: si trae &, < o > rompe el XML del SVG y no descarga
      // nada (p. ej. "INGENIERIA & LOGISTICA COSTA BRAVA, C.A").
      const safeName = c.name.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] as string));
      const card = `<div class="qcard"><div class="qrow"><img class="qlogo" src="${LOGO_DATA_URI}"/><img class="qimg" src="${qr}"/></div><div class="qname">🍽️ ${safeName}</div></div>`;
      await exportCardImage({
        styles, card, mmW: 90, mmH: 54, dpi: 300,
        fileName: `QR comida - ${c.name}`,
        // En NATIVO (teléfono) no hay canvas/DOM para rasterizar la imagen: sin este
        // respaldo, exportCardImage simplemente no hacía nada (botón "Generando…" y
        // listo, sin descarga ni aviso). Con esto cae al PDF, igual que el resto de
        // pantallas (ficha aliado, carnet, organigrama).
        htmlForFallback: `<!doctype html><html><head><meta charset="utf-8"/><style>${styles}</style></head><body>${card}</body></html>`,
      });
    } finally {
      setQrBusy(null);
    }
  };

  const shiftDay = (delta: number) => {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    setDate(d.toISOString().slice(0, 10));
  };

  const totalMeals = rows.reduce((a, r) => a + (Number(r.meals) || 0), 0);
  const byPerson = useMemo(() => {
    const map = new Map<string, { name: string; total: number; items: FoodDistribution[] }>();
    rows.forEach((r) => {
      const k = r.employee_id ?? r.employee_name;
      if (!map.has(k)) map.set(k, { name: r.employee_name, total: 0, items: [] });
      const g = map.get(k)!;
      g.total += Number(r.meals) || 0;
      g.items.push(r);
    });
    return Array.from(map.values()).sort((a, b) => cmpText(a.name, b.name));
  }, [rows]);

  // Conteo del día por comida (empresa entregadas + personas), para las tarjetas.
  const dayByMeal = useMemo(() => {
    const by: Record<string, number> = {};
    rows.forEach((r) => { if (r.meal_type) by[r.meal_type] = (by[r.meal_type] || 0) + (Number(r.meals) || 0); });
    companyMeals.forEach((cm) => { by[cm.meal_type] = (by[cm.meal_type] || 0) + (Number(cm.delivered) || 0); });
    return by;
  }, [rows, companyMeals]);

  if (loading) return <Screen><ConfigBanner /><SkeletonList /></Screen>;

  const kpi = (label: string, value: React.ReactNode, color: string) => (
    <View style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
      <Text style={{ color, fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] as any }}>{value}</Text>
      <Text style={{ color: colors.muted, fontSize: 11, textAlign: 'center' }}>{label}</Text>
    </View>
  );

  const modeTab = (key: 'dia' | 'control', label: string) => (
    <TouchableOpacity
      onPress={() => setMode(key)}
      style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: mode === key ? colors.brand : colors.surface, borderWidth: 1, borderColor: mode === key ? colors.brand : colors.border }}
    >
      <Text style={{ color: mode === key ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      <ConfigBanner />
      {loadError || rangeError ? (
        <View style={{ borderWidth: 1, borderColor: '#DC2626', backgroundColor: '#FEF2F2', borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
          <Text style={{ color: '#991B1B', fontWeight: '700' }}>⚠️ {loadError ?? rangeError}</Text>
        </View>
      ) : null}
      <SectionTitle>🍽️ Distribución de comida</SectionTitle>

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
        {modeTab('dia', '📅 Por día')}
        {modeTab('control', '📊 Reportes (día/semana/rango)')}
      </View>

      {mode === 'control' ? (
      <>
        {/* Rango de fechas */}
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <TouchableOpacity onPress={() => shiftRange(-1)} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}>
              <Text style={{ color: colors.brandText, fontWeight: '800' }}>◀</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Desde</Text>
              <DateField value={from} onChange={setFrom} maxISO={to} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Hasta</Text>
              <DateField value={to} onChange={setTo} maxISO={caracasToday()} />
            </View>
            <TouchableOpacity onPress={() => shiftRange(1)} disabled={to >= caracasToday()} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, opacity: to >= caracasToday() ? 0.4 : 1 }}>
              <Text style={{ color: colors.brandText, fontWeight: '800' }}>▶</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm }}>
            {([
              { lbl: 'Hoy', f: caracasToday(), t: caracasToday() },
              { lbl: 'Ayer', f: addDaysISO(caracasToday(), -1), t: addDaysISO(caracasToday(), -1) },
              { lbl: 'Esta semana', f: startOfWeekISO(caracasToday()), t: caracasToday() },
              { lbl: 'Este mes', f: startOfMonthISO(caracasToday()), t: caracasToday() },
              { lbl: '7 días', f: addDaysISO(caracasToday(), -6), t: caracasToday() },
              { lbl: '30 días', f: addDaysISO(caracasToday(), -29), t: caracasToday() },
            ]).map((p) => {
              const active = from === p.f && to === p.t;
              return (
                <TouchableOpacity key={p.lbl} onPress={() => { setFrom(p.f); setTo(p.t); }} style={{ paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: active ? colors.brand : colors.border, backgroundColor: active ? colors.brand : colors.surface }}>
                  <Text style={{ color: active ? colors.brandContrast : colors.text, fontSize: 12, fontWeight: '700' }}>{p.lbl}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Card>

        {/* Filtro por empresa */}
        <Card>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Empresa</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            <TouchableOpacity onPress={() => setCompanyFilter('all')} style={{ paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: companyFilter === 'all' ? colors.brand : colors.border, backgroundColor: companyFilter === 'all' ? colors.brand : colors.surface }}>
              <Text style={{ color: companyFilter === 'all' ? colors.brandContrast : colors.text, fontSize: 12, fontWeight: '700' }}>Todas</Text>
            </TouchableOpacity>
            {rangeCompanies.map((c) => (
              <TouchableOpacity key={c.id} onPress={() => setCompanyFilter(c.id)} style={{ paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: companyFilter === c.id ? colors.brand : colors.border, backgroundColor: companyFilter === c.id ? colors.brand : colors.surface }}>
                <Text style={{ color: companyFilter === c.id ? colors.brandContrast : colors.text, fontSize: 12, fontWeight: '700' }}>{c.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Card>

        {rangeLoading ? (
          <Loading />
        ) : (rangeRows.length === 0 && rangePersons.length === 0) ? (
          <EmptyState title="Sin entregas en este rango" subtitle="No hay comidas registradas (por empresa ni por persona) en las fechas elegidas." />
        ) : (
          <>
            {/* Totales generales del rango */}
            <Card>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                {kpi('Por empresa', rangeTotals.total, colors.brandText)}
                {kpi('Por persona', rangePersonsTotal, colors.text)}
                {kpi('Total', rangeTotals.total + rangePersonsTotal, colors.success)}
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                {MEALS.map((m) => kpi(m.label, (rangeTotals.by[m.key] || 0) + (rangePersonsByMeal[m.key] || 0), colors.text))}
              </View>
            </Card>

            {/* Con la lectura del rango fallida no se ofrece el PDF: saldría con
                datos incompletos o viejos y nadie lo notaría al leerlo. */}
            <TouchableOpacity
              onPress={() => setReporteOpen(true)}
              disabled={!!rangeError}
              style={{ backgroundColor: colors.accent, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: rangeError ? 0.5 : 1 }}
            >
              <Text style={{ color: colors.accentContrast, fontWeight: '800' }}>📄 Reporte PDF (con opciones)</Text>
            </TouchableOpacity>
            <Text style={{ color: colors.muted, fontSize: 11, textAlign: 'center' }}>
              Elige empresa, persona, comida y fechas · con monto o sin monto · quita las columnas que no quieras.
            </Text>

            {/* Cobro de comidas: el mismo rango y las mismas entregas, con precio. Con la lectura
                del rango fallida no se muestra: cobraría con datos a medias. */}
            {canCobro && !rangeError ? (
              <CobroComidasResumen
                desde={from}
                hasta={to}
                hoy={caracasToday()}
                empresas={rangeRows}
                personas={rangePersons}
                filtroEmpresa={companyFilter}
                canEdit={canCobro}
                usuarioId={session?.user?.id ?? null}
              />
            ) : null}

            {/* Quién agregó, corrigió o borró comidas en estas fechas. Solo con
                permiso completo: la bitácora dice nombres. */}
            {canEditar ? <ComidaMovimientos desde={from} hasta={to} /> : null}

            {/* Resumen por empresa */}
            {rangeByCompany.length > 0 ? (
              <>
                <SectionTitle>🏢 Resumen por empresa</SectionTitle>
                {rangeByCompany.map((g) => (
                  <Card key={g.name}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>🏢 {g.name}</Text>
                      <Text style={{ color: colors.brandText, fontWeight: '900', fontVariant: ['tabular-nums'] as any }}>{g.total} comida(s)</Text>
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                      {MEALS.map((m) => (
                        <Text key={m.key} style={{ color: colors.muted, fontSize: 12 }}>{m.icon} {m.label}: <Text style={{ color: colors.text, fontWeight: '800' }}>{g.by[m.key] || 0}</Text></Text>
                      ))}
                      <Text style={{ color: colors.muted, fontSize: 12 }}>📆 {g.days.size} día(s)</Text>
                    </View>
                  </Card>
                ))}
              </>
            ) : null}

            {/* Resumen POR PERSONA en el rango (entregas por carnet). Independiente de la empresa. */}
            {companyFilter === 'all' && rangeByPerson.length > 0 ? (
              <>
                <SectionTitle>👤 Por persona (rango)</SectionTitle>
                {rangeByPerson.map((p) => (
                  <Card key={(p.cedula || p.name) + p.total}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }} numberOfLines={1}>👤 {p.name}{p.cedula ? <Text style={{ color: colors.muted, fontWeight: '400', fontSize: 12 }}>  · C.I {p.cedula}</Text> : null}</Text>
                      <Text style={{ color: colors.brandText, fontWeight: '900', fontVariant: ['tabular-nums'] as any }}>{p.total} comida(s)</Text>
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                      {MEALS.map((m) => (
                        <Text key={m.key} style={{ color: colors.muted, fontSize: 12 }}>{m.icon} {m.label}: <Text style={{ color: colors.text, fontWeight: '800' }}>{p.by[m.key] || 0}</Text></Text>
                      ))}
                      <Text style={{ color: colors.muted, fontSize: 12 }}>📆 {p.days.size} día(s)</Text>
                    </View>
                  </Card>
                ))}
              </>
            ) : null}

            {/* Historial día por día (una empresa seleccionada) */}
            {companyFilter !== 'all' ? (
              <>
                <SectionTitle>📅 Historial día por día · {rangeCompanyName}</SectionTitle>
                {rangeHistory.map((h) => {
                  const dayTotal = MEALS.reduce((a, m) => a + (Number(h.meals[m.key]?.delivered) || 0), 0);
                  return (
                    <Card key={h.date}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
                        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, textTransform: 'capitalize' }}>{niceDay(h.date)}</Text>
                        <Text style={{ color: colors.brandText, fontWeight: '900', fontVariant: ['tabular-nums'] as any }}>{dayTotal} comida(s)</Text>
                      </View>
                      {MEALS.map((m) => {
                        const cm = h.meals[m.key];
                        return (
                          <View key={m.key} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5, borderTopWidth: 1, borderTopColor: colors.border }}>
                            <Text style={{ color: colors.text, fontSize: 13 }}>{m.icon} {m.label}</Text>
                            {cm ? (
                              <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'right', flex: 1, marginLeft: spacing.sm }}>
                                <Text style={{ color: colors.success, fontWeight: '800' }}>{cm.delivered}</Text> entregadas · sug. {cm.suggested} · {caracasClock(cm.delivered_at)}{cm.created_by_name ? ` · ${cm.created_by_name}` : ''}
                              </Text>
                            ) : (
                              <Text style={{ color: colors.muted, fontSize: 12 }}>— sin registrar</Text>
                            )}
                          </View>
                        );
                      })}
                    </Card>
                  );
                })}
              </>
            ) : (
              <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: spacing.sm }}>
                Elige una empresa arriba para ver su historial de asistencia/entrega día por día.
              </Text>
            )}
          </>
        )}
        <View style={{ height: spacing.xl }} />
      </>
      ) : (
      <>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <TouchableOpacity onPress={() => shiftDay(-1)} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}>
            <Text style={{ color: colors.brandText, fontWeight: '800' }}>◀</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}><DateField value={date} onChange={setDate} maxISO={caracasToday()} /></View>
          <TouchableOpacity onPress={() => shiftDay(1)} disabled={date >= caracasToday()} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, opacity: date >= caracasToday() ? 0.4 : 1 }}>
            <Text style={{ color: colors.brandText, fontWeight: '800' }}>▶</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          {kpi('Por empresa', companyTotal, colors.brandText)}
          {kpi('Por persona', totalMeals, colors.text)}
          {kpi('Empresas', companyGroups.length, colors.text)}
        </View>
      </Card>

      {/* Tarjetas de conteo del día por comida (empresa + persona). Suben en vivo. */}
      <Card>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>🍽️ Comidas del día (empresa + persona)</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {MEALS.map((m) => kpi(`${m.icon} ${m.label}`, dayByMeal[m.key] || 0, m.color))}
        </View>
      </Card>

      {/* Agregar y corregir las comidas de ESTE día, sea hoy o cualquier día
          pasado. Va acá arriba, pegado a la fecha: configurar en un sitio y
          corregir en otro es como se termina corrigiendo el día equivocado. */}
      {canEditar ? (
        <ComidaEditor
          fecha={date}
          hoy={caracasToday()}
          entregasEmpresa={companyMeals}
          entregasPersona={rows}
          empresas={companies}
          usuario={{ id: session?.user?.id ?? null, nombre: fullName }}
          onCambio={load}
        />
      ) : null}

      <TouchableOpacity
        onPress={() => setQrOpen((v) => !v)}
        style={{ backgroundColor: colors.brand, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}
      >
        <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{qrOpen ? '▲ Ocultar QR por empresa' : '🖼️ QR por empresa (imágenes)'}</Text>
      </TouchableOpacity>
      {qrOpen ? (
        <Card>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
            Descarga el QR de cada empresa como imagen (logo + QR + nombre) para imprimir y pegar. Las empresas desactivadas no aparecen.
          </Text>
          {companies.length === 0 ? (
            <Text style={{ color: colors.muted, fontSize: 12 }}>No hay empresas activas.</Text>
          ) : (
            companies.map((c) => (
              <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Text style={{ color: colors.text, fontSize: 13, flex: 1 }} numberOfLines={1}>🏢 {c.name}</Text>
                <TouchableOpacity
                  onPress={() => downloadCompanyQr(c)}
                  disabled={qrBusy === c.id}
                  style={{ backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, opacity: qrBusy === c.id ? 0.6 : 1 }}
                >
                  <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>{qrBusy === c.id ? 'Generando…' : '🖼️ Descargar QR'}</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </Card>
      ) : null}

      {/* ── Por empresa (desayuno / almuerzo / cena) ── */}
      <SectionTitle>🏢 Por empresa</SectionTitle>
      {companyGroups.length === 0 ? (
        <EmptyState title="Sin comidas por empresa este día" subtitle="Escanea el QR de una empresa para registrar sus comidas." />
      ) : (
        companyGroups.map((g) => (
          <Card key={g.name}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>🏢 {g.name}</Text>
              <Text style={{ color: colors.brandText, fontWeight: '900', fontVariant: ['tabular-nums'] as any }}>{g.total} comida(s)</Text>
            </View>
            {COMPANY_MEALS.map((mt) => {
              const cm = g.meals[mt.key];
              return (
                <View key={mt.key} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <Text style={{ color: colors.text, fontSize: 13 }}>{mt.icon} {mt.label}</Text>
                  {cm && cm.delivered > 0 ? (
                    <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'right', flex: 1, marginLeft: spacing.sm }}>
                      <Text style={{ color: colors.success, fontWeight: '800' }}>{cm.delivered}</Text> entregadas{cm.usd > 0 ? ` · ${fmtUsd(cm.usd)}` : ''} · {cm.count} entrega(s){cm.lastAt ? ` · ${caracasClock(cm.lastAt)}` : ''}
                    </Text>
                  ) : (
                    <Text style={{ color: colors.muted, fontSize: 12 }}>—</Text>
                  )}
                </View>
              );
            })}
          </Card>
        ))
      )}

      {/* ── Por persona (entrega individual escaneando el carnet) ── */}
      <SectionTitle>👤 Por persona</SectionTitle>
      {byPerson.length === 0 ? (
        <EmptyState title="Sin entregas este día" subtitle="No se registró distribución de comida en la fecha elegida." />
      ) : (
        byPerson.map((p) => (
          <Card key={p.name + p.total}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>👤 {p.name}</Text>
              <Text style={{ color: colors.brandText, fontWeight: '900', fontVariant: ['tabular-nums'] as any }}>{p.total} comida(s)</Text>
            </View>
            {p.items.map((d) => (
              <View key={d.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  🍽️ {d.meal_type ? mealLabel(d.meal_type) : `${d.meals} comida(s)`} · {caracasClock(d.delivered_at)}{d.created_by_name ? ` · por ${d.created_by_name}` : ''}{d.note ? ` · ${d.note}` : ''}
                </Text>
              </View>
            ))}
          </Card>
        ))
      )}
      <View style={{ height: spacing.xl }} />
      </>
      )}

      {/* El reporte con opciones. Recibe lo que la pantalla YA trajo del rango:
          así el papel y lo que se ve arriba nunca pueden discrepar. */}
      <ComidaReporteModal
        visible={reporteOpen}
        onClose={() => setReporteOpen(false)}
        entregasEmpresa={rangeRows}
        entregasPersona={rangePersons}
        precios={precios}
        puedeVerMontos={canCobro}
        desdeInicial={from}
        hastaInicial={to}
        hoy={caracasToday()}
      />
    </Screen>
  );
}
