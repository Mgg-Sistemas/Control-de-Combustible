import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { Screen, Card, SectionTitle, Loading, EmptyState } from '../components/ui';
import { DateField } from '../components/DateField';
import { supabase, selectAllRows } from '../lib/supabase';
import { cmpText, norm } from '../lib/text';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { listInspectorAssignments } from '../lib/machineInspectors';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

// Histórico de JORNADAS por inspector. Fuente: machine_rounds (horas de día/noche,
// turno y horómetro). Cada jornada se atribuye al inspector ASIGNADO (CHECK,
// machine_inspectors) SEGÚN SU TURNO — igual que el teléfono — NO a quien apretó el
// botón (recorded_by): así aparecen TODOS los inspectores (incluidos los de noche,
// que antes no salían) y las horas de noche cuentan para su inspector real. Se ve
// por rango de fechas. No requiere tabla nueva.

const CARACAS_TZ = 'America/Caracas';
// El cajón "MAQUINAS FALTANTES" (o sin asignar) no es un inspector real. Mismo
// criterio que InspectionsSummary para no mezclarlo con inspectores de verdad.
const sinInspectorReal = (name: string | null | undefined) => !name || /faltant/i.test(name);
function caracasToday(): string {
  const p: any = new Intl.DateTimeFormat('en-CA', { timeZone: CARACAS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((a: any, x: any) => { a[x.type] = x.value; return a; }, {});
  return `${p.year}-${p.month}-${p.day}`;
}
const dmy = (iso: string) => { const [y, m, d] = (iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : iso; };
const r2 = (n: number) => Math.round(n * 100) / 100;
function isoDaysAgo(n: number): string {
  const d = new Date(caracasToday() + 'T12:00:00');
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

type Row = {
  id: string; round_date: string; inspector: string; code: string; serial: string | null; plate: string | null;
  company: string; shift: 'day' | 'night' | null; dayH: number; nightH: number; total: number;
  horoIni: number | null; horoFin: number | null;
};

export default function HistoricoJornadasScreen() {
  const { colors } = useTheme();
  const [from, setFrom] = useState(isoDaysAgo(7));
  const [to, setTo] = useState(caracasToday());
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    // Asignaciones inspector↔máquina POR TURNO (CHECK) — la misma fuente que el
    // teléfono. Un inspector distinto para el día y para la noche de una misma máquina.
    const { rows: assigns } = await listInspectorAssignments();
    const dayInsp = new Map<string, string>();
    const nightInsp = new Map<string, string>();
    assigns.forEach((a) => { (a.shift === 'night' ? nightInsp : dayInsp).set(a.machinery_id, a.inspector_name || ''); });
    // Rondas del rango con horas (de día y/o de noche).
    const rs = await selectAllRows(
      'machine_rounds',
      'id, machinery_id, round_date, day_hours, night_hours, horometro_inicial, horometro_final, machine:machinery_id(code, serial, plate, company:company_id(name))',
      (q) => q.gte('round_date', from).lte('round_date', to),
    );
    // Cada ronda con horas se PARTE por turno: las horas de DÍA cuentan para el
    // inspector de día asignado; las de NOCHE, para el de noche. Así el trabajo
    // nocturno cuenta para su inspector real (antes se perdía) y aparecen todos.
    const list: Row[] = [];
    ((rs ?? []) as any[]).forEach((r) => {
      const dayH = Number(r.day_hours) || 0;
      const nightH = Number(r.night_hours) || 0;
      const mm = r.machine || {};
      const base = {
        round_date: r.round_date as string,
        code: mm.code ?? '—',
        serial: mm.serial ?? null,
        plate: mm.plate ?? null,
        company: mm.company?.name ?? 'Sin empresa',
        horoIni: r.horometro_inicial != null ? Number(r.horometro_inicial) : null,
        horoFin: r.horometro_final != null ? Number(r.horometro_final) : null,
      };
      if (dayH > 0) list.push({ ...base, id: `${r.id}:d`, inspector: dayInsp.get(r.machinery_id) || '', shift: 'day', dayH, nightH: 0, total: r2(dayH) });
      if (nightH > 0) list.push({ ...base, id: `${r.id}:n`, inspector: nightInsp.get(r.machinery_id) || '', shift: 'night', dayH: 0, nightH, total: r2(nightH) });
    });
    setRows(list);
    setLoading(false);
  }, [from, to]);
  useEffect(() => { load(); }, [load]);
  // Al finalizar/cerrar una jornada (o cambiar asignaciones), el histórico se
  // actualiza solo. machine_inspectors: porque la atribución depende del CHECK.
  useRealtimeRefresh(['machine_rounds', 'machine_inspectors'], () => { load(); });

  const byInspector = useMemo(() => {
    const nq = norm(query.trim());
    const inspLabel = (r: Row) => (sinInspectorReal(r.inspector) ? '⚠️ Por asignar' : r.inspector);
    const filtered = nq
      ? rows.filter((r) => norm(`${inspLabel(r)} ${r.code} ${r.company} ${r.serial ?? ''} ${r.plate ?? ''}`).includes(nq))
      : rows;
    const map = new Map<string, Row[]>();
    filtered.forEach((r) => { const k = inspLabel(r); if (!map.has(k)) map.set(k, []); map.get(k)!.push(r); });
    // Más recientes primero; dentro de una fecha, A→Z por código.
    map.forEach((l) => l.sort((a, b) => (a.round_date === b.round_date ? cmpText(a.code, b.code) : a.round_date < b.round_date ? 1 : -1)));
    return Array.from(map.entries()).sort((a, b) => cmpText(a[0], b[0]));
  }, [rows, query]);

  const totalHoras = useMemo(() => r2(rows.reduce((s, r) => s + r.total, 0)), [rows]);
  const toggle = (n: string) => setExpanded((p) => { const s = new Set(p); s.has(n) ? s.delete(n) : s.add(n); return s; });

  const exportarPDF = async () => {
    if (!rows.length) return;
    const esc = (t: any) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const secciones = byInspector.map(([name, list]) => {
      const tot = r2(list.reduce((s, r) => s + r.total, 0));
      const filas = list.map((r, i) =>
        `<tr><td>${i + 1}</td><td>${esc(dmy(r.round_date))}</td><td><b>${esc(r.code)}</b></td><td>${esc(r.serial || r.plate || '—')}</td><td>${esc(r.company)}</td><td>${r.shift === 'night' ? '🌙 noche' : '☀️ día'}</td><td class="r">${esc(r.horoIni ?? '—')} → ${esc(r.horoFin ?? '—')}</td><td class="r b">${r2(r.total)}</td></tr>`).join('');
      return `<h3>👷 ${esc(name)} · ${list.length} jornada(s) · ${tot} h</h3><table><thead><tr><th style="width:24px">Nº</th><th>Fecha</th><th>Máquina</th><th>Serial/Placa</th><th>Empresa</th><th>Turno</th><th class="r">Horómetro</th><th class="r">Horas</th></tr></thead><tbody>${filas}</tbody></table>`;
    }).join('');
    const html = pdfDocument({
      title: 'HISTÓRICO DE JORNADAS POR INSPECTOR',
      subtitle: `${dmy(from)} — ${dmy(to)} · ${rows.length} jornada(s) finalizada(s) · ${totalHoras} h`,
      extraCss: `table{width:100%;border-collapse:collapse;margin:4px 0 14px;font-size:11px}
        th,td{border:1px solid #c9d2dc;padding:5px 7px;text-align:left} th{background:#1E3A5F;color:#fff}
        td.r,th.r{text-align:right} td.b{font-weight:800} h3{margin:14px 0 3px;font-size:13px;color:#1E3A5F}`,
      body: secciones,
    });
    await exportPdf(html, `Historico jornadas ${dmy(from)}-${dmy(to)}`);
  };

  return (
    <Screen>
      <SectionTitle>📚 Histórico de jornadas por inspector</SectionTitle>
      <Card>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>Jornadas con horas en el rango, por inspector ASIGNADO según su turno (día/noche), igual que el teléfono. Más recientes primero.</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Desde</Text>
            <DateField value={from} onChange={setFrom} maxISO={to} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Hasta</Text>
            <DateField value={to} onChange={setTo} minISO={from} maxISO={caracasToday()} />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm, flexWrap: 'wrap', alignItems: 'center' }}>
          {[{ l: 'Hoy', d: 0 }, { l: '7 días', d: 7 }, { l: '30 días', d: 30 }].map((b) => (
            <TouchableOpacity key={b.l} onPress={() => { setFrom(isoDaysAgo(b.d)); setTo(caracasToday()); }} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: 5 }}>
              <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>{b.l}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={exportarPDF} disabled={!rows.length} style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: 5, opacity: rows.length ? 1 : 0.5 }}>
            <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12 }}>📄 PDF</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginTop: spacing.sm }}>
          <Text style={{ fontSize: 14 }}>🔎</Text>
          <TextInput value={query} onChangeText={setQuery} placeholder="Buscar: inspector, máquina o empresa…" placeholderTextColor={colors.muted} style={{ flex: 1, color: colors.text, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs }} />
          {query ? <TouchableOpacity onPress={() => setQuery('')}><Text style={{ color: colors.primary, fontWeight: '800', paddingHorizontal: spacing.xs }}>✕</Text></TouchableOpacity> : null}
        </View>
        {!loading ? (
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm }}>{rows.length} jornada(s) · {byInspector.length} inspector(es) · {totalHoras} h en total</Text>
        ) : null}
      </Card>

      {loading ? <Loading /> : byInspector.length === 0 ? (
        <EmptyState title="Sin jornadas finalizadas" subtitle="No hay jornadas con horas en el rango elegido." />
      ) : byInspector.map(([name, list]) => {
        const collapsed = query.trim() ? false : !expanded.has(name);
        const tot = r2(list.reduce((s, r) => s + r.total, 0));
        return (
          <Card key={name}>
            <TouchableOpacity onPress={() => toggle(name)} activeOpacity={0.7} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }} numberOfLines={1}>{collapsed ? '▸' : '▾'} 👷 {name}</Text>
              <Text style={{ fontSize: 12, fontWeight: '800' }}>
                <Text style={{ color: colors.text }}>{list.length} jorn</Text>
                <Text style={{ color: colors.success }}> · {tot} h</Text>
              </Text>
            </TouchableOpacity>
            {collapsed ? null : list.map((r) => (
              <View key={r.id} style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, flex: 1 }} numberOfLines={1}>🚜 {r.code} <Text style={{ color: colors.muted, fontWeight: '400', fontSize: 12 }}>· {r.company}</Text></Text>
                  <Text style={{ color: colors.success, fontWeight: '900', fontSize: 14 }}>{r.total} h</Text>
                </View>
                <Text style={{ color: colors.muted, fontSize: 11 }} numberOfLines={1}>📅 {dmy(r.round_date)} · {r.shift === 'night' ? '🌙 noche' : '☀️ día'} · 🔖 {r.serial || r.plate || '—'}</Text>
                <Text style={{ color: colors.muted, fontSize: 11 }} numberOfLines={1}>⏲️ Horómetro: {r.horoIni ?? '—'} → {r.horoFin ?? '—'} · ☀️ {r2(r.dayH)}h · 🌙 {r2(r.nightH)}h</Text>
              </View>
            ))}
          </Card>
        );
      })}
    </Screen>
  );
}
