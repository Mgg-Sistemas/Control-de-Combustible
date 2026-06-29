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

type DayTotal = { date: string; liters: number };

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export default function ReportsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [from, setFrom] = useState(isoDaysAgo(7));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<DayTotal[] | null>(null);
  const [count, setCount] = useState(0);
  const [preview, setPreview] = useState(false);

  const total = (rows ?? []).reduce((s, r) => s + r.liters, 0);
  const maxL = Math.max(1, ...(rows ?? []).map((r) => r.liters));

  const generate = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('dispatches')
      .select('dispatch_date, liters')
      .gte('dispatch_date', from)
      .lte('dispatch_date', to)
      .order('dispatch_date', { ascending: true });
    const byDay = new Map<string, number>();
    (data ?? []).forEach((d: any) => {
      byDay.set(d.dispatch_date, (byDay.get(d.dispatch_date) ?? 0) + Number(d.liters));
    });
    const agg = Array.from(byDay.entries()).map(([date, liters]) => ({ date, liters }));
    setRows(agg);
    setCount((data ?? []).length);
    setLoading(false);
    setPreview(true);
  };

  const setRange = (days: number) => {
    setFrom(isoDaysAgo(days));
    setTo(isoDaysAgo(0));
  };

  const downloadPdf = async () => {
    const bars = (rows ?? [])
      .map((r) => {
        const h = Math.round((r.liters / maxL) * 120);
        return `<div class="col"><div class="bar" style="height:${h}px"></div><div class="lbl">${r.date.slice(5)}</div><div class="val">${r.liters.toLocaleString()}</div></div>`;
      })
      .join('');
    const tableRows = (rows ?? [])
      .map((r) => `<tr><td>${r.date}</td><td style="text-align:right">${r.liters.toLocaleString()} L</td></tr>`)
      .join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1C1C1E;padding:24px}
      h1{font-size:20px;margin:0 0 4px}
      .muted{color:#6B7280;font-size:13px}
      .summary{display:flex;gap:24px;margin:16px 0}
      .summary div b{display:block;font-size:22px}
      .chart{display:flex;align-items:flex-end;gap:8px;height:170px;border-bottom:1px solid #D6D5D2;padding-bottom:4px;margin:12px 0;overflow-x:auto}
      .col{display:flex;flex-direction:column;align-items:center;justify-content:flex-end}
      .bar{width:26px;background:#3F3F46;border-radius:4px 4px 0 0}
      .lbl{font-size:10px;color:#6B7280;margin-top:4px}
      .val{font-size:10px;color:#1C1C1E}
      table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
      td,th{border-bottom:1px solid #EAEAE8;padding:6px}
    </style></head><body>
      <h1>Reporte de consumo de combustible</h1>
      <div class="muted">Del ${from} al ${to}</div>
      <div class="summary">
        <div><span class="muted">Total consumido</span><b>${total.toLocaleString()} L</b></div>
        <div><span class="muted">Despachos</span><b>${count}</b></div>
        <div><span class="muted">Días con consumo</span><b>${(rows ?? []).length}</b></div>
      </div>
      <div class="chart">${bars || '<span class="muted">Sin datos en el rango</span>'}</div>
      <table><thead><tr><th style="text-align:left">Fecha</th><th style="text-align:right">Litros</th></tr></thead>
        <tbody>${tableRows}</tbody></table>
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
          {[
            { label: 'Hoy', d: 0 },
            { label: '7 días', d: 7 },
            { label: '30 días', d: 30 },
          ].map((q) => (
            <TouchableOpacity key={q.label} style={styles.quick} onPress={() => setRange(q.d)}>
              <Text style={{ color: colors.text, fontSize: 13 }}>{q.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity style={styles.genBtn} onPress={generate} disabled={loading}>
          <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>
            📊 Generar reporte
          </Text>
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
                <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>{count}</Text>
              </View>
            </View>
          </Card>

          <Card>
            <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.sm }}>Consumo diario (L)</Text>
            {(rows ?? []).length === 0 ? (
              <Text style={{ color: colors.muted }}>Sin consumos en el rango seleccionado.</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, height: 160 }}>
                  {(rows ?? []).map((r) => (
                    <View key={r.date} style={{ alignItems: 'center', justifyContent: 'flex-end' }}>
                      <Text style={{ fontSize: 10, color: colors.text }}>{r.liters.toLocaleString()}</Text>
                      <View
                        style={{
                          width: 28,
                          height: Math.max(4, (r.liters / maxL) * 120),
                          backgroundColor: colors.primary,
                          borderRadius: 4,
                        }}
                      />
                      <Text style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>{r.date.slice(5)}</Text>
                    </View>
                  ))}
                </View>
              </ScrollView>
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
  genBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  btn: { flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center' },
});
