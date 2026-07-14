import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Screen, Card, SectionTitle, Loading, EmptyState } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import { listFoodByDate } from '../lib/foodDistributions';
import { FoodDistribution } from '../types/database';
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

  const load = useCallback(async () => {
    setLoading(true);
    setRows(await listFoodByDate(date));
    setLoading(false);
  }, [date]);
  useEffect(() => { load(); }, [load]);

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
          {kpi('Comidas repartidas', totalMeals, colors.primary)}
          {kpi('Personas', byPerson.length, colors.text)}
          {kpi('Entregas', rows.length, colors.text)}
        </View>
      </Card>

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
                  🍽️ {d.meals} · {caracasClock(d.delivered_at)}{d.created_by_name ? ` · por ${d.created_by_name}` : ''}{d.note ? ` · ${d.note}` : ''}
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
