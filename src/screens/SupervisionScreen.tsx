import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Screen, Card, SectionTitle, Loading, EmptyState } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import { supabase } from '../lib/supabase';
import { listVisits, VisitRow } from '../lib/supervisorVisits';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { VisitStatus } from '../types/database';
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
/** Suma día+noche (0/6/12) del round como horas trabajadas. */
const workedOf = (r: any) => (Number(r.day_hours) || 0) + (Number(r.night_hours) || 0);
const STATUS_META: Record<VisitStatus, { icon: string; label: string; color: string }> = {
  trabajando: { icon: '🟢', label: 'Trabajando', color: '#1E9E4A' },
  parada: { icon: '🟡', label: 'Parada', color: '#D9A200' },
  no_esta: { icon: '🔴', label: 'No está', color: '#D22B2B' },
};

type Round = { machinery_id: string; worked: number; code: string; companyName: string; operator: string | null };
type Jornada = {
  id: string; operator: string; cedula: string; code: string; companyName: string;
  started_at: string; ended_at: string | null; worked_hours: number | null;
  start_lat: number | null; start_lng: number | null; end_lat: number | null; end_lng: number | null;
};
const mapsUrl = (lat?: number | null, lng?: number | null) => `https://www.google.com/maps?q=${lat},${lng}`;
const openUrl = (url: string) => { try { (globalThis as any).open?.(url, '_blank'); } catch {} };

/** Cercanía de una visita: en sitio (near true), lejos (near false) o sin GPS (near null). */
type Proximity = 'sitio' | 'lejos' | 'nogps';
const proximityOf = (v: VisitRow): Proximity => (v.near === true ? 'sitio' : v.near === false ? 'lejos' : 'nogps');
/** Resume una lista de visitas: cuántas en sitio, lejos y sin GPS, y máquinas únicas. */
function summarize(list: VisitRow[]) {
  let sitio = 0, lejos = 0, nogps = 0;
  list.forEach((v) => { const p = proximityOf(v); if (p === 'sitio') sitio++; else if (p === 'lejos') lejos++; else nogps++; });
  return { sitio, lejos, nogps, total: list.length, maquinas: new Set(list.map((v) => v.machinery_id)).size };
}
/** ISO (YYYY-MM-DD) → DD/MM/YYYY. */
const dmy = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

/**
 * Módulo de SUPERVISIÓN (para el jefe): traza de las rondas de los supervisores
 * en un día. Muestra quién visitó qué máquina, a qué hora, con qué estado y qué
 * tan cerca estaba. Y lo clave: las JORNADAS SIN VALIDAR — máquinas que
 * trabajaron ese día pero que ningún supervisor marcó (regla: el operador no
 * cobra). Así el jefe evalúa la cobertura de cada supervisor.
 */
export default function SupervisionScreen({ navigation }: any) {
  const { colors } = useTheme();
  // Abre el Catálogo filtrado a ESA máquina (por serial único; si no hay, por código).
  const openMachine = (v: VisitRow) => {
    const term = v.machineSerial || v.machineCode;
    if (term) navigation?.navigate?.('Equipos', { q: String(term) });
  };
  const [date, setDate] = useState(caracasToday());
  const [loading, setLoading] = useState(true);
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [jornadas, setJornadas] = useState<Jornada[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [vs, { data: rs }, { data: js }] = await Promise.all([
      listVisits(date),
      supabase
        .from('machine_rounds')
        .select('machinery_id, day_hours, night_hours, day_operator, night_operator, machine:machinery_id(code, company:company_id(name))')
        .eq('round_date', date),
      supabase
        .from('operator_assignments')
        .select('id, first_name, last_name, cedula, company_name, started_at, ended_at, worked_hours, start_lat, start_lng, end_lat, end_lng, machine:machinery_id(code)')
        .eq('work_date', date)
        .order('started_at', { ascending: true }),
    ]);
    setVisits(vs);
    setJornadas(((js ?? []) as any[]).map((j) => ({
      id: j.id,
      operator: `${j.first_name ?? ''} ${j.last_name ?? ''}`.trim() || '—',
      cedula: j.cedula ?? '',
      code: j.machine?.code ?? '—',
      companyName: j.company_name ?? 'Sin empresa',
      started_at: j.started_at, ended_at: j.ended_at, worked_hours: j.worked_hours,
      start_lat: j.start_lat, start_lng: j.start_lng, end_lat: j.end_lat, end_lng: j.end_lng,
    })));
    const rounds = ((rs ?? []) as any[])
      .filter((r) => workedOf(r) > 0)
      .map((r) => ({
        machinery_id: r.machinery_id as string,
        worked: workedOf(r),
        code: r.machine?.code ?? '—',
        companyName: r.machine?.company?.name ?? 'Sin empresa',
        operator: (r.day_operator || r.night_operator || null) as string | null,
      }));
    rounds.sort((a, b) => a.companyName.localeCompare(b.companyName) || a.code.localeCompare(b.code));
    setRounds(rounds);
    setLoading(false);
  }, [date]);
  useEffect(() => { load(); }, [load]);

  // TIEMPO REAL: al marcar una máquina (supervisor) o registrar/finalizar una
  // jornada, la supervisión del día se actualiza sola.
  useRealtimeRefresh(['supervisor_visits', 'machine_rounds', 'operator_assignments'], () => { load(); });

  const shiftDay = (delta: number) => {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    setDate(d.toISOString().slice(0, 10));
  };

  const visitedIds = useMemo(() => new Set(visits.map((v) => v.machinery_id)), [visits]);
  const unvalidated = useMemo(() => rounds.filter((r) => !visitedIds.has(r.machinery_id)), [rounds, visitedIds]);
  const validated = rounds.length - unvalidated.length;

  // Traza agrupada por supervisor.
  const bySupervisor = useMemo(() => {
    const map = new Map<string, VisitRow[]>();
    visits.forEach((v) => {
      const k = v.supervisor_name || '—';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(v);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [visits]);

  // ── Reporte PDF de la traza del día (resumen por supervisor + detalle) ──────
  const reporte = async () => {
    if (bySupervisor.length === 0) return;
    const esc = (t: any) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const proxTxt = (v: VisitRow) => {
      const p = proximityOf(v);
      if (p === 'sitio') return `en sitio ✓ (~${v.distance_m} m)`;
      if (p === 'lejos') return `lejos ⚠️ (~${v.distance_m} m)`;
      return 'sin GPS';
    };
    const proxColor = (v: VisitRow) => (proximityOf(v) === 'sitio' ? '#1E9E4A' : proximityOf(v) === 'lejos' ? '#D9A200' : '#6B7280');
    const secciones = bySupervisor.map(([name, list]) => {
      const s = summarize(list);
      const filas = list.map((v) => `<tr>
        <td>${esc(caracasClock(v.visited_at))}</td>
        <td>${esc(v.machineCode)}</td>
        <td>${esc(v.companyName)}</td>
        <td>${esc(STATUS_META[v.status].label)}</td>
        <td style="color:${proxColor(v)};font-weight:700">${esc(proxTxt(v))}</td>
      </tr>`).join('');
      return `<h3>👮 ${esc(name)}</h3>
        <p class="sum">${s.total} check-in(s) · ${s.maquinas} máquina(s) única(s) —
          <b style="color:#1E9E4A">${s.sitio} en sitio</b> ·
          <b style="color:#D9A200">${s.lejos} lejos</b> ·
          <b style="color:#6B7280">${s.nogps} sin GPS</b></p>
        <table><thead><tr><th>Hora</th><th>Máquina</th><th>Empresa</th><th>Estado</th><th>Ubicación</th></tr></thead>
          <tbody>${filas}</tbody></table>`;
    }).join('');
    const sinValidar = unvalidated.length === 0
      ? `<p class="ok">✓ Todas las jornadas del día están validadas.</p>`
      : `<table><thead><tr><th>Máquina</th><th>Empresa</th><th>Operador</th><th class="r">Horas</th></tr></thead><tbody>${
          unvalidated.map((r) => `<tr><td>${esc(r.code)}</td><td>${esc(r.companyName)}</td><td>${esc(r.operator ?? '—')}</td><td class="r">${r.worked} h</td></tr>`).join('')
        }</tbody></table>`;
    const html = pdfDocument({
      title: 'Reporte de supervisión',
      subtitle: `Rondas del ${dmy(date)} · ${visits.length} visita(s) · ${validated} jornada(s) validada(s) · ${unvalidated.length} sin validar`,
      extraCss: `table{width:100%;border-collapse:collapse;margin:6px 0 14px;font-size:11px}
        th,td{border:1px solid #c9d2dc;padding:5px 7px;text-align:left} th{background:#16324F;color:#fff}
        td.r,th.r{text-align:right} tr:nth-child(even) td{background:#f4f7fb}
        h3{margin:14px 0 2px;font-size:14px;color:#16324F} .sum{margin:0 0 4px;font-size:11px;color:#333}
        .ok{color:#1E9E4A;font-weight:700} h2{font-size:15px;color:#16324F;margin-top:18px}`,
      body: `${secciones}<h2>⛔ Jornadas sin validar</h2>${sinValidar}`,
    });
    await exportPdf(html, `Supervision ${dmy(date)}`);
  };

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
      <SectionTitle>🪖 Supervisión — rondas del día</SectionTitle>

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <TouchableOpacity onPress={() => shiftDay(-1)} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}>
            <Text style={{ color: colors.primary, fontWeight: '800' }}>◀</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <DateField value={date} onChange={setDate} maxISO={caracasToday()} />
          </View>
          <TouchableOpacity onPress={() => shiftDay(1)} disabled={date >= caracasToday()} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, opacity: date >= caracasToday() ? 0.4 : 1 }}>
            <Text style={{ color: colors.primary, fontWeight: '800' }}>▶</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          {kpi('Visitas', visits.length, colors.text)}
          {kpi('Jornadas validadas', validated, colors.success)}
          {kpi('Sin validar', unvalidated.length, unvalidated.length > 0 ? colors.danger : colors.success)}
        </View>
      </Card>

      {/* ── JORNADAS SIN VALIDAR (el operador no cobra) ── */}
      <SectionTitle>⛔ Jornadas sin validar</SectionTitle>
      <Card>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
          Máquinas que trabajaron este día pero que <Text style={{ fontWeight: '800', color: colors.danger }}>ningún supervisor marcó</Text>. Regla: sin visita, el operador no cobra.
        </Text>
        {unvalidated.length === 0 ? (
          <Text style={{ color: colors.success, fontWeight: '800' }}>✓ Todas las jornadas del día están validadas.</Text>
        ) : (
          unvalidated.map((r) => (
            <View key={r.machinery_id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>{r.code}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{r.companyName}{r.operator ? ` · ${r.operator}` : ''}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>{r.worked} h</Text>
                <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '800' }}>NO cobra</Text>
              </View>
            </View>
          ))
        )}
      </Card>

      {/* ── JORNADAS DEL DÍA (operadores) — traza de inicio/fin + ubicación ── */}
      <SectionTitle>🚜 Jornadas de operadores</SectionTitle>
      {jornadas.length === 0 ? (
        <EmptyState title="Sin jornadas este día" subtitle="Aquí aparece cada jornada que los operadores inician y finalizan al escanear el QR de la máquina." />
      ) : (
        jornadas.map((j) => {
          const enCurso = !j.ended_at;
          return (
            <Card key={j.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>👷 {j.operator}{j.cedula ? <Text style={{ color: colors.muted, fontWeight: '400', fontSize: 12 }}>  · C.I {j.cedula}</Text> : null}</Text>
                  <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600' }}>🚜 {j.code} · {j.companyName}</Text>
                </View>
                {enCurso ? (
                  <Text style={{ color: colors.warning, fontWeight: '800', fontSize: 12 }}>● En curso</Text>
                ) : (
                  <Text style={{ color: colors.success, fontWeight: '900', fontSize: 15 }}>{j.worked_hours ?? 0} h</Text>
                )}
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>Inicio</Text>
                  <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>{caracasClock(j.started_at)}</Text>
                  {j.start_lat != null && j.start_lng != null ? (
                    <Text onPress={() => openUrl(mapsUrl(j.start_lat, j.start_lng))} style={{ color: colors.primary, fontSize: 11, fontWeight: '700' }}>📍 Ver ubicación ↗</Text>
                  ) : <Text style={{ color: colors.muted, fontSize: 11 }}>sin ubicación</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>Fin</Text>
                  <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>{j.ended_at ? caracasClock(j.ended_at) : '—'}</Text>
                  {j.end_lat != null && j.end_lng != null ? (
                    <Text onPress={() => openUrl(mapsUrl(j.end_lat, j.end_lng))} style={{ color: colors.primary, fontSize: 11, fontWeight: '700' }}>📍 Ver ubicación ↗</Text>
                  ) : <Text style={{ color: colors.muted, fontSize: 11 }}>{enCurso ? '—' : 'sin ubicación'}</Text>}
                </View>
              </View>
            </Card>
          );
        })
      )}

      {/* ── TRAZA POR SUPERVISOR ── */}
      <SectionTitle>Traza por supervisor</SectionTitle>
      {bySupervisor.length > 0 ? (
        <>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Toca una máquina para ver su ficha en el Catálogo.</Text>
          <TouchableOpacity onPress={reporte} style={{ marginBottom: spacing.sm, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
            <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 13 }}>📄 Reporte de supervisión (PDF)</Text>
          </TouchableOpacity>
        </>
      ) : null}
      {bySupervisor.length === 0 ? (
        <EmptyState title="Sin visitas este día" subtitle="Ningún supervisor marcó máquinas en la fecha elegida." />
      ) : (
        bySupervisor.map(([name, list]) => {
          const s = summarize(list);
          return (
          <Card key={name}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>👮 {name}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{s.total} check-in(s) · {s.maquinas} máq.</Text>
            </View>
            {/* Resumen de cercanía: cuántas confiables (en sitio), de lejos y sin GPS. */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs }}>
              <View style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: '#1E9E4A', paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
                <Text style={{ color: '#1E9E4A', fontSize: 11, fontWeight: '800' }}>✓ {s.sitio} en sitio</Text>
              </View>
              <View style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: colors.warning, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
                <Text style={{ color: colors.warning, fontSize: 11, fontWeight: '800' }}>⚠️ {s.lejos} lejos</Text>
              </View>
              <View style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
                <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800' }}>• {s.nogps} sin GPS</Text>
              </View>
            </View>
            {list.map((v) => {
              const sm = STATUS_META[v.status];
              return (
                <TouchableOpacity key={v.id} onPress={() => openMachine(v)} activeOpacity={0.6} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{v.machineCode} <Text style={{ color: colors.muted, fontWeight: '400' }}>· {v.companyName}</Text></Text>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>
                      {caracasClock(v.visited_at)} · {sm.icon} {sm.label}
                      {v.distance_m != null ? ` · a ~${v.distance_m} m ${v.near ? '(en sitio ✓)' : '(lejos ⚠️)'}` : ' · sin GPS'}
                    </Text>
                    {v.note ? <Text style={{ color: colors.muted, fontSize: 11, fontStyle: 'italic' }}>“{v.note}”</Text> : null}
                  </View>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: v.near === false ? colors.warning : sm.color }} />
                  <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 16 }}>›</Text>
                </TouchableOpacity>
              );
            })}
          </Card>
          );
        })
      )}
      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}
