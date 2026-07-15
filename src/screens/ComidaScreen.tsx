import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Screen, Card, SectionTitle, Loading, EmptyState } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import { listFoodByDate } from '../lib/foodDistributions';
import { listCompanyMealsByDate, MEALS, mealLabel } from '../lib/foodCompanyMeals';
import { FoodDistribution, FoodCompanyMeal } from '../types/database';
import { supabase } from '../lib/supabase';
import { comidaQrUrl, qrPngDataUri } from '../lib/qr';
import { exportCardImage } from '../lib/pdf';
import { LOGO_DATA_URI } from '../lib/logoData';
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

/**
 * Módulo "Distribución de comida" (para el jefe): por día, cuántas comidas se
 * repartieron y a quién. Agrupa por persona con su total y el detalle de cada
 * entrega (hora + quién la repartió).
 */
export default function ComidaScreen() {
  const { colors } = useTheme();
  const [date, setDate] = useState(caracasToday());
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<FoodDistribution[]>([]);
  const [companyMeals, setCompanyMeals] = useState<FoodCompanyMeal[]>([]);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [qrBusy, setQrBusy] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);

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
      const card = `<div class="qcard"><div class="qrow"><img class="qlogo" src="${LOGO_DATA_URI}"/><img class="qimg" src="${qr}"/></div><div class="qname">🍽️ ${c.name}</div></div>`;
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
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [rows]);

  if (loading) return <Screen><ConfigBanner /><Loading /></Screen>;

  const kpi = (label: string, value: React.ReactNode, color: string) => (
    <View style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
      <Text style={{ color, fontSize: 22, fontWeight: '900' }}>{value}</Text>
      <Text style={{ color: colors.muted, fontSize: 11, textAlign: 'center' }}>{label}</Text>
    </View>
  );

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>🍽️ Distribución de comida</SectionTitle>

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
    </Screen>
  );
}
