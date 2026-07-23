import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Screen, Card, SectionTitle, Loading, EmptyState } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import { listFoodByDate } from '../lib/foodDistributions';
import { listCompanyMealsByDate, listCompanyMealsBetween, MEALS, mealLabel } from '../lib/foodCompanyMeals';
import { FoodDistribution, FoodCompanyMeal } from '../types/database';
import { supabase } from '../lib/supabase';
import { cmpText } from '../lib/text';
import { comidaQrUrl, qrPngDataUri } from '../lib/qr';
import { exportCardImage, exportPdf } from '../lib/pdf';
import { LOGO_DATA_URI } from '../lib/logoData';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

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
  const [mode, setMode] = useState<'dia' | 'control'>('dia');
  const [date, setDate] = useState(caracasToday());
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<FoodDistribution[]>([]);
  const [companyMeals, setCompanyMeals] = useState<FoodCompanyMeal[]>([]);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [qrBusy, setQrBusy] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  // ── Control por empresa (rango de fechas) ──
  const [from, setFrom] = useState(addDaysISO(caracasToday(), -6)); // últimos 7 días
  const [to, setTo] = useState(caracasToday());
  const [rangeRows, setRangeRows] = useState<FoodCompanyMeal[]>([]);
  const [rangePersons, setRangePersons] = useState<FoodDistribution[]>([]); // entregas individuales del rango
  const [rangeLoading, setRangeLoading] = useState(false);
  const [companyFilter, setCompanyFilter] = useState<string>('all'); // 'all' o company_id
  const [pdfBusy, setPdfBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [rr, cm, { data: comps }] = await Promise.all([
      listFoodByDate(date),
      listCompanyMealsByDate(date),
      // Solo empresas ACTIVAS (las ocultas/desactivadas, p. ej. HBS, no generan QR).
      supabase.from('companies').select('id, name, hidden').order('name', { ascending: true }),
    ]);
    setRows(rr);
    setCompanyMeals(cm);
    setCompanies(((comps ?? []) as any[]).filter((c) => !c.hidden).map((c) => ({ id: c.id, name: c.name })));
    setLoading(false);
  }, [date]);
  useEffect(() => { load(); }, [load]);

  // Carga del control por rango (solo en modo control): comidas por empresa + entregas por persona.
  const loadRange = useCallback(async () => {
    setRangeLoading(true);
    const [comp, persons] = await Promise.all([
      listCompanyMealsBetween(from, to),
      listFoodByDate(from, to),
    ]);
    setRangeRows(comp);
    setRangePersons(persons);
    setRangeLoading(false);
  }, [from, to]);
  useEffect(() => { if (mode === 'control') loadRange(); }, [mode, loadRange]);

  // TIEMPO REAL: cuando la cocina registra/borra una comida (por persona o por
  // empresa), esta pantalla se actualiza sola, sin tener que refrescar a mano.
  useRealtimeRefresh(['food_distributions', 'food_company_meals'], () => {
    load();
    if (mode === 'control') loadRange();
  });

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

  // Empresas presentes en el rango (para el filtro).
  const rangeCompanies = useMemo(() => {
    const m = new Map<string, string>();
    rangeRows.forEach((r) => m.set(r.company_id ?? r.company_name, r.company_name));
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
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

  // Reporte PDF del control por empresa (rango).
  const downloadRangePdf = async () => {
    setPdfBusy(true);
    try {
      const esc = (s: any) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
      const mealHeads = MEALS.map((m) => `<th>${esc(m.label)}</th>`).join('');
      const bodyRows = rangeByCompany.map((g) => `
        <tr>
          <td class="l">${esc(g.name)}</td>
          ${MEALS.map((m) => `<td>${g.by[m.key] || 0}</td>`).join('')}
          <td class="b">${g.total}</td>
          <td>${g.days.size}</td>
        </tr>`).join('');
      const totalRow = `
        <tr class="tot">
          <td class="l">TOTAL</td>
          ${MEALS.map((m) => `<td>${rangeTotals.by[m.key] || 0}</td>`).join('')}
          <td class="b">${rangeTotals.total}</td>
          <td></td>
        </tr>`;
      // Tabla POR PERSONA (solo cuando se ven todas las empresas y hay entregas individuales).
      const personaTable = (companyFilter === 'all' && rangeByPerson.length > 0) ? `
        <h2>👤 Entregas por persona</h2>
        <table>
          <thead><tr><th class="l">Persona</th><th>Cédula</th>${mealHeads}<th>Total</th><th>Días</th></tr></thead>
          <tbody>
            ${rangeByPerson.map((p) => `
              <tr>
                <td class="l">${esc(p.name)}</td>
                <td>${esc(p.cedula || '—')}</td>
                ${MEALS.map((m) => `<td>${p.by[m.key] || 0}</td>`).join('')}
                <td class="b">${p.total}</td>
                <td>${p.days.size}</td>
              </tr>`).join('')}
            <tr class="tot">
              <td class="l">TOTAL</td><td></td>
              ${MEALS.map(() => '<td></td>').join('')}
              <td class="b">${rangePersonsTotal}</td><td></td>
            </tr>
          </tbody>
        </table>` : '';
      const html = `
        <style>
          *{font-family:Arial,Helvetica,sans-serif}
          h1{font-size:18px;margin:0 0 2px} h2{font-size:14px;margin:18px 0 6px;color:#16324F}
          .sub{color:#555;font-size:12px;margin:0 0 12px}
          table{border-collapse:collapse;width:100%;font-size:12px}
          th,td{border:1px solid #ccc;padding:6px 8px;text-align:center}
          th{background:#16324F;color:#fff} td.l{text-align:left} td.b{font-weight:800}
          tr.tot td{background:#EAF1FB;font-weight:800}
        </style>
        <h1>🍽️ Control de entregas de comida</h1>
        <p class="sub">${esc(rangeCompanyName)} · ${esc(niceDay(from))} a ${esc(niceDay(to))}</p>
        <h2>🏢 Entregas por empresa</h2>
        <table>
          <thead><tr><th class="l">Empresa</th>${mealHeads}<th>Total</th><th>Días</th></tr></thead>
          <tbody>${bodyRows}${totalRow}</tbody>
        </table>
        ${personaTable}`;
      await exportPdf(html, `Control comida - ${rangeCompanyName} (${from} a ${to})`);
    } finally {
      setPdfBusy(false);
    }
  };

  // Agrupa las comidas por empresa → { desayuno, almuerzo, cena }.
  const companyGroups = useMemo(() => {
    const map = new Map<string, { name: string; meals: Partial<Record<string, FoodCompanyMeal>>; total: number }>();
    companyMeals.forEach((cm) => {
      const k = cm.company_id ?? cm.company_name;
      if (!map.has(k)) map.set(k, { name: cm.company_name, meals: {}, total: 0 });
      const g = map.get(k)!;
      g.meals[cm.meal_type] = cm;
      g.total += Number(cm.delivered) || 0;
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
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

  if (loading) return <Screen><ConfigBanner /><Loading /></Screen>;

  const kpi = (label: string, value: React.ReactNode, color: string) => (
    <View style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
      <Text style={{ color, fontSize: 22, fontWeight: '900' }}>{value}</Text>
      <Text style={{ color: colors.muted, fontSize: 11, textAlign: 'center' }}>{label}</Text>
    </View>
  );

  const modeTab = (key: 'dia' | 'control', label: string) => (
    <TouchableOpacity
      onPress={() => setMode(key)}
      style={{ flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: mode === key ? colors.primary : colors.surface, borderWidth: 1, borderColor: mode === key ? colors.primary : colors.border }}
    >
      <Text style={{ color: mode === key ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Screen>
      <ConfigBanner />
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
              <Text style={{ color: colors.primary, fontWeight: '800' }}>◀</Text>
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
              <Text style={{ color: colors.primary, fontWeight: '800' }}>▶</Text>
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
                <TouchableOpacity key={p.lbl} onPress={() => { setFrom(p.f); setTo(p.t); }} style={{ paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : colors.surface }}>
                  <Text style={{ color: active ? colors.primaryContrast : colors.text, fontSize: 12, fontWeight: '700' }}>{p.lbl}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Card>

        {/* Filtro por empresa */}
        <Card>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Empresa</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            <TouchableOpacity onPress={() => setCompanyFilter('all')} style={{ paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: companyFilter === 'all' ? colors.primary : colors.border, backgroundColor: companyFilter === 'all' ? colors.primary : colors.surface }}>
              <Text style={{ color: companyFilter === 'all' ? colors.primaryContrast : colors.text, fontSize: 12, fontWeight: '700' }}>Todas</Text>
            </TouchableOpacity>
            {rangeCompanies.map((c) => (
              <TouchableOpacity key={c.id} onPress={() => setCompanyFilter(c.id)} style={{ paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: companyFilter === c.id ? colors.primary : colors.border, backgroundColor: companyFilter === c.id ? colors.primary : colors.surface }}>
                <Text style={{ color: companyFilter === c.id ? colors.primaryContrast : colors.text, fontSize: 12, fontWeight: '700' }}>{c.name}</Text>
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
                {kpi('Por empresa', rangeTotals.total, colors.primary)}
                {kpi('Por persona', rangePersonsTotal, colors.text)}
                {kpi('Total', rangeTotals.total + rangePersonsTotal, colors.success)}
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                {MEALS.map((m) => kpi(m.label, rangeTotals.by[m.key] || 0, colors.text))}
              </View>
            </Card>

            <TouchableOpacity onPress={downloadRangePdf} disabled={pdfBusy} style={{ backgroundColor: '#B91C1C', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: pdfBusy ? 0.6 : 1 }}>
              <Text style={{ color: '#fff', fontWeight: '800' }}>{pdfBusy ? 'Generando…' : '📄 Descargar reporte PDF'}</Text>
            </TouchableOpacity>

            {/* Resumen por empresa */}
            {rangeByCompany.length > 0 ? (
              <>
                <SectionTitle>🏢 Resumen por empresa</SectionTitle>
                {rangeByCompany.map((g) => (
                  <Card key={g.name}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>🏢 {g.name}</Text>
                      <Text style={{ color: colors.primary, fontWeight: '900' }}>{g.total} comida(s)</Text>
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
                      <Text style={{ color: colors.primary, fontWeight: '900' }}>{p.total} comida(s)</Text>
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
                        <Text style={{ color: colors.primary, fontWeight: '900' }}>{dayTotal} comida(s)</Text>
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
            <Text style={{ color: colors.primary, fontWeight: '800' }}>◀</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}><DateField value={date} onChange={setDate} maxISO={caracasToday()} /></View>
          <TouchableOpacity onPress={() => shiftDay(1)} disabled={date >= caracasToday()} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, opacity: date >= caracasToday() ? 0.4 : 1 }}>
            <Text style={{ color: colors.primary, fontWeight: '800' }}>▶</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          {kpi('Por empresa', companyTotal, colors.primary)}
          {kpi('Por persona', totalMeals, colors.text)}
          {kpi('Empresas', companyGroups.length, colors.text)}
        </View>
      </Card>

      <TouchableOpacity
        onPress={() => setQrOpen((v) => !v)}
        style={{ backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}
      >
        <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>{qrOpen ? '▲ Ocultar QR por empresa' : '🖼️ QR por empresa (imágenes)'}</Text>
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
                  style={{ backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, opacity: qrBusy === c.id ? 0.6 : 1 }}
                >
                  <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 12 }}>{qrBusy === c.id ? 'Generando…' : '🖼️ Descargar QR'}</Text>
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
              <Text style={{ color: colors.primary, fontWeight: '900' }}>{g.total} comida(s)</Text>
            </View>
            {MEALS.map((mt) => {
              const cm = g.meals[mt.key];
              return (
                <View key={mt.key} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <Text style={{ color: colors.text, fontSize: 13 }}>{mt.icon} {mt.label}</Text>
                  {cm ? (
                    <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'right', flex: 1, marginLeft: spacing.sm }}>
                      <Text style={{ color: colors.success, fontWeight: '800' }}>{cm.delivered}</Text> entregadas · sug. {cm.suggested} · {caracasClock(cm.delivered_at)}{cm.created_by_name ? ` · ${cm.created_by_name}` : ''}
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
              <Text style={{ color: colors.primary, fontWeight: '900' }}>{p.total} comida(s)</Text>
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
    </Screen>
  );
}
