// ACARREO · Dashboard: KPIs del período y alertas (vencimientos de documentos/
// licencias, mantenimiento de unidades por km, y viajes retrasados en ruta).
import React, { useMemo } from 'react';
import { View, Text } from 'react-native';
import { Screen, Card, SectionTitle } from '../../components/ui';
import { useTable } from '../../hooks/useTable';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { caracasParts } from '../../lib/jornada';
import { HaulOrder, HaulExpense, HaulTruck, HaulDriver, HaulDocument } from '../../types/database';

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export default function HaulDashboard() {
  const { colors } = useTheme();
  const { data: orders } = useTable<HaulOrder>('haul_orders', { orderBy: 'created_at', ascending: false, realtimeFrom: ['haul_orders', 'haul_expenses'] });
  const { data: expenses } = useTable<HaulExpense>('haul_expenses', { orderBy: 'at' });
  const { data: trucks } = useTable<HaulTruck>('haul_trucks', { orderBy: 'plate' });
  const { data: drivers } = useTable<HaulDriver>('haul_drivers', { orderBy: 'full_name' });
  const { data: docs } = useTable<HaulDocument>('haul_documents', { orderBy: 'expires_at' });

  const hoy = caracasParts(new Date()).iso;
  const pronto = addDays(hoy, 30);
  const nowMs = Date.now();

  const kpis = useMemo(() => {
    const completadas = orders.filter((o) => o.status === 'completado');
    // Tiempo promedio de tránsito (h) entre salida y llegada reales.
    const dur = completadas.filter((o) => o.departed_at && o.arrived_at)
      .map((o) => (new Date(o.arrived_at!).getTime() - new Date(o.departed_at!).getTime()) / 3_600_000)
      .filter((h) => h > 0);
    const avgTransito = dur.length ? dur.reduce((s, h) => s + h, 0) / dur.length : null;
    // On-time: llegada real <= llegada requerida.
    const conMeta = completadas.filter((o) => o.arrived_at && o.required_arrival_at);
    const onTime = conMeta.filter((o) => o.arrived_at! <= o.required_arrival_at!).length;
    const pctOnTime = conMeta.length ? Math.round((onTime / conMeta.length) * 100) : null;
    // Costo promedio por km (gastos / km recorridos estimados).
    const gastoTotal = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const kmTotal = orders.reduce((s, o) => s + (Number(o.route_km_est) || 0), 0);
    const costoPorKm = kmTotal > 0 ? gastoTotal / kmTotal : null;
    return { total: orders.length, completadas: completadas.length, avgTransito, pctOnTime, costoPorKm };
  }, [orders, expenses]);

  const alerts = useMemo(() => {
    const out: { level: 'error' | 'warn'; text: string }[] = [];
    const truckName = new Map(trucks.map((t) => [t.id, t.plate]));
    const driverName = new Map(drivers.map((d) => [d.id, d.full_name]));
    // Documentos vencidos / por vencer.
    docs.forEach((d) => {
      if (!d.expires_at) return;
      const owner = d.owner_type === 'truck' ? `Chuto ${truckName.get(d.owner_id) ?? ''}` : d.owner_type === 'driver' ? `Chofer ${driverName.get(d.owner_id) ?? ''}` : 'Remolque';
      if (d.expires_at < hoy) out.push({ level: 'error', text: `⛔ ${owner}: ${d.doc_type} VENCIDO (${d.expires_at}).` });
      else if (d.expires_at <= pronto) out.push({ level: 'warn', text: `⏳ ${owner}: ${d.doc_type} vence ${d.expires_at}.` });
    });
    // Licencias de chofer.
    drivers.forEach((dr) => {
      if (dr.license_expires_at && dr.license_expires_at < hoy) out.push({ level: 'error', text: `⛔ Licencia vencida: ${dr.full_name} (${dr.license_expires_at}).` });
      else if (dr.license_expires_at && dr.license_expires_at <= pronto) out.push({ level: 'warn', text: `⏳ Licencia por vencer: ${dr.full_name} (${dr.license_expires_at}).` });
    });
    // Mantenimiento preventivo por km.
    trucks.forEach((t) => {
      if (t.maint_interval_km != null && Number(t.maint_interval_km) > 0) {
        const falta = Number(t.maint_interval_km) - (Number(t.odometer_km) % Number(t.maint_interval_km));
        if (falta <= 1000) out.push({ level: 'warn', text: `🛠️ Chuto ${t.plate}: faltan ${Math.round(falta).toLocaleString('es-VE')} km para mantenimiento.` });
      }
    });
    // Retrasos en ruta: en tránsito y ya pasó la llegada requerida.
    orders.forEach((o) => {
      if (o.status === 'en_transito' && o.required_arrival_at && new Date(o.required_arrival_at).getTime() < nowMs) {
        out.push({ level: 'error', text: `🚨 ${o.folio}: retrasado (llegada requerida ${o.required_arrival_at.slice(0, 10)}).` });
      }
    });
    return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
  }, [docs, drivers, trucks, orders, hoy, pronto, nowMs]);

  const Kpi = ({ label, value }: { label: string; value: string }) => (
    <View style={{ flexGrow: 1, flexBasis: 130, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md }}>
      <Text style={{ color: colors.muted, fontSize: 11 }}>{label}</Text>
      <Text style={{ color: colors.text, fontWeight: '900', fontSize: 20 }}>{value}</Text>
    </View>
  );

  return (
    <Screen>
      <SectionTitle>📊 Acarreo · Panel</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
        <Kpi label="Acarreos" value={String(kpis.total)} />
        <Kpi label="Completados" value={String(kpis.completadas)} />
        <Kpi label="Tránsito prom." value={kpis.avgTransito != null ? `${kpis.avgTransito.toFixed(1)} h` : '—'} />
        <Kpi label="A tiempo" value={kpis.pctOnTime != null ? `${kpis.pctOnTime}%` : '—'} />
        <Kpi label="Costo/km" value={kpis.costoPorKm != null ? `$${kpis.costoPorKm.toFixed(2)}` : '—'} />
      </View>

      <Card style={{ marginTop: spacing.md }}>
        <Text style={{ color: colors.text, fontWeight: '800', marginBottom: spacing.xs }}>🔔 Alertas ({alerts.length})</Text>
        {alerts.length === 0 ? (
          <Text style={{ color: colors.muted, fontSize: 13 }}>Todo al día: sin vencimientos, mantenimientos ni retrasos.</Text>
        ) : (
          alerts.map((a, i) => (
            <Text key={i} style={{ color: a.level === 'error' ? colors.danger : '#B45309', fontSize: 12.5, marginTop: 3 }}>{a.text}</Text>
          ))
        )}
      </Card>
    </Screen>
  );
}
