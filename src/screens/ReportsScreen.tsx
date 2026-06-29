import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { Screen, Card, SectionTitle, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase } from '../lib/supabase';
import { exportPdf } from '../lib/pdf';
import { spacing, radius, AppColors } from '../theme';
import { useTheme } from '../theme/ThemeContext';

type Row = {
  dispatch_date: string;
  liters: number;
  asset_kind: string;
  driver_operator: string | null;
  asset: string;
  tank: string;
};

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function totalsBy<T extends string>(rows: Row[], key: (r: Row) => T): { label: T; liters: number }[] {
  const m = new Map<T, number>();
  rows.forEach((r) => m.set(key(r), (m.get(key(r)) ?? 0) + r.liters));
  return Array.from(m.entries())
    .map(([label, liters]) => ({ label, liters }))
    .sort((a, b) => b.liters - a.liters);
}

export default function ReportsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [from, setFrom] = useState(isoDaysAgo(7));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [preview, setPreview] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const all = rows ?? [];
  const total = all.reduce((s, r) => s + r.liters, 0);
  const byDay = useMemo(() => totalsBy(all, (r) => r.dispatch_date), [rows]);
  const byAsset = useMemo(() => totalsBy(all, (r) => r.asset as any), [rows]);
  const maxDay = Math.max(1, ...byDay.map((d) => d.liters));
  const maxAsset = Math.max(1, ...byAsset.map((d) => d.liters));
  const dayDetail = selectedDay ? all.filter((r) => r.dispatch_date === selectedDay) : [];

  const generate = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('dispatches')
      .select('dispatch_date, liters, asset_kind, driver_operator, vehicle:vehicle_id(plate), machinery:machinery_id(code), tank:tank_id(name)')
      .gte('dispatch_date', from)
      .lte('dispatch_date', to)
      .order('dispatch_date', { ascending: true });
    const mapped: Row[] = (data ?? []).map((d: any) => ({
      dispatch_date: d.dispatch_date,
      liters: Number(d.liters),
      asset_kind: d.asset_kind,
      driver_operator: d.driver_operator,
      asset: d.vehicle?.plate ?? d.machinery?.code ?? '—',
      tank: d.tank?.name ?? '—',
    }));
    setRows(mapped);
    setLoading(false);
    setPreview(true);
  };

  const setRange = (days: number) => {
    setFrom(isoDaysAgo(days));
    setTo(isoDaysAgo(0));
  };

  const downloadPdf = async () => {
    const dayBars = byDay
      .map((r) => `<div class="col"><div class="bar" style="height:${Math.round((r.liters / maxDay) * 120)}px"></div><div class="lbl">${r.label.slice(5)}</div><div class="val">${r.liters.toLocaleString()}</div></div>`)
      .join('');
    const assetRows = byAsset
      .map((r) => `<tr><td>${r.label}</td><td style="text-align:right">${r.liters.toLocaleString()} L</td></tr>`)
      .join('');
    const dayRows = byDay
      .map((r) => `<tr><td>${r.label}</td><td style="text-align:right">${r.liters.toLocaleString()} L</td></tr>`)
      .join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1C1C1E;padding:24px}
      h1{font-size:20px;margin:0 0 4px} h2{font-size:15px;margin:18px 0 6px}
      .muted{color:#6B7280;font-size:13px}
      .summary{display:flex;gap:24px;margin:12px 0}.summary b{display:block;font-size:22px}
      .chart{display:flex;align-items:flex-end;gap:8px;height:170px;border-bottom:1px solid #D6D5D2;padding-bottom:4px;overflow-x:auto}
      .col{display:flex;flex-direction:column;align-items:center;justify-content:flex-end}
      .bar{width:26px;background:#3F3F46;border-radius:4px 4px 0 0}
      .lbl{font-size:10px;color:#6B7280;margin-top:4px}.val{font-size:10px}
      table{width:100%;border-collapse:collapse;font-size:13px}td,th{border-bottom:1px solid #EAEAE8;padding:6px}
    </style></head><body>
      <h1>Reporte de consumo de combustible</h1>
      <div class="muted">Del ${from} al ${to}</div>
      <div class="summary"><div><span class="muted">Total</span><b>${total.toLocaleString()} L</b></div>
        <div><span class="muted">Despachos</span><b>${all.length}</b></div></div>
      <h2>Consumo por día</h2>
      <div class="chart">${dayBars || '<span class="muted">Sin datos</span>'}</div>
      <table><tbody>${dayRows}</tbody></table>
      <h2>Consumo por equipo / máquina</h2>
      <table><thead><tr><th style="text-align:left">Equipo/Máquina</th><th style="text-align:right">Litros</th></tr></thead><tbody>${assetRows}</tbody></table>
    </body></html>`;
    await exportPdf(html);
  };

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Reportes</SectionTitle>

      <Card>
        <Text style={{ color: colors.muted, fontSize: 13 }}>Rango de fechas</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.lbl}>Desde</Text>
            <TextInput style={styles.input} value={from} onChangeText={setFrom} placeholder="AAAA-MM-DD" placeholderTextColor={colors.muted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.lbl}>Hasta</Text>
            <TextInput style={styles.input} value={to} onChangeText={setTo} placeholder="AAAA-MM-DD" placeholderTextColor={colors.muted} />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
          {[{ label: 'Hoy', d: 0 }, { label: '7 días', d: 7 }, { label: '30 días', d: 30 }].map((q) => (
            <TouchableOpacity key={q.label} style={styles.quick} onPress={() => setRange(q.d)}>
              <Text style={{ color: colors.text, fontSize: 13 }}>{q.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity style={styles.genBtn} onPress={generate} disabled={loading}>
          <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>📊 Generar reporte</Text>
        </TouchableOpacity>
      </Card>

      {loading ? <Loading /> : null}

      <Modal visible={preview} animationType="slide" onRequestClose={() => setPreview(false)}>
        <Screen>
          <SectionTitle>Vista previa del reporte</SectionTitle>
          <Card>
            <Text style={{ color: colors.muted, fontSize: 13 }}>Del {from} al {to}</Text>
            <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: spacing.xs }}>
              <View>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Total</Text>
                <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>{total.toLocaleString()} L</Text>
              </View>
              <View>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Despachos</Text>
                <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>{all.length}</Text>
              </View>
            </View>
          </Card>

          <Card>
            <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.sm }}>
              Consumo diario (L) · toca un día para ver el detalle
            </Text>
            {byDay.length === 0 ? (
              <Text style={{ color: colors.muted }}>Sin consumos en el rango.</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, height: 160 }}>
                  {byDay.map((r) => (
                    <TouchableOpacity key={r.label} onPress={() => setSelectedDay(r.label)} style={{ alignItems: 'center', justifyContent: 'flex-end' }}>
                      <Text style={{ fontSize: 10, color: colors.text }}>{r.liters.toLocaleString()}</Text>
                      <View style={{ width: 28, height: Math.max(4, (r.liters / maxDay) * 120), backgroundColor: colors.primary, borderRadius: 4 }} />
                      <Text style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>{r.label.slice(5)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            )}
          </Card>

          <Card>
            <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.sm }}>Consumo por equipo / máquina (L)</Text>
            {byAsset.length === 0 ? (
              <Text style={{ color: colors.muted }}>Sin datos.</Text>
            ) : (
              byAsset.map((r) => (
                <View key={r.label} style={{ marginBottom: spacing.sm }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{r.label}</Text>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>{r.liters.toLocaleString()} L</Text>
                  </View>
                  <View style={{ height: 8, backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, marginTop: 2 }}>
                    <View style={{ height: 8, width: `${(r.liters / maxAsset) * 100}%`, backgroundColor: colors.primary, borderRadius: radius.pill }} />
                  </View>
                </View>
              ))
            )}
          </Card>

          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <TouchableOpacity style={[styles.btn, { backgroundColor: colors.surfaceAlt }]} onPress={() => setPreview(false)}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, { backgroundColor: colors.primary }]} onPress={downloadPdf}>
              <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>⬇️ Descargar PDF</Text>
            </TouchableOpacity>
          </View>

          {/* Detalle del día seleccionado */}
          <Modal visible={!!selectedDay} animationType="slide" onRequestClose={() => setSelectedDay(null)}>
            <Screen>
              <SectionTitle>Detalle del {selectedDay}</SectionTitle>
              <Card>
                <Text style={{ color: colors.muted, fontSize: 13 }}>
                  {dayDetail.length} despacho(s) · {dayDetail.reduce((s, r) => s + r.liters, 0).toLocaleString()} L
                </Text>
              </Card>
              {dayDetail.map((r, i) => (
                <Card key={i}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontWeight: '700', color: colors.text }}>{r.asset}</Text>
                    <Text style={{ fontWeight: '700', color: colors.text }}>{r.liters.toLocaleString()} L</Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 13 }}>{r.asset_kind} · Tanque: {r.tank}</Text>
                  {r.driver_operator ? <Text style={{ color: colors.muted, fontSize: 13 }}>Operó: {r.driver_operator}</Text> : null}
                </Card>
              ))}
              <TouchableOpacity style={[styles.btn, { backgroundColor: colors.primary }]} onPress={() => setSelectedDay(null)}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>Volver</Text>
              </TouchableOpacity>
            </Screen>
          </Modal>
        </Screen>
      </Modal>
    </Screen>
  );
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  lbl: { color: colors.muted, fontSize: 12, marginBottom: 2 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    color: colors.text,
  },
  quick: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  genBtn: { backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.md },
  btn: { flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center' },
});
