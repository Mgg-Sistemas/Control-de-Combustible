import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { Screen, Card, SectionTitle, Loading, EmptyState } from '../components/ui';
import { DateField } from '../components/DateField';
import { supabase, selectAllRows } from '../lib/supabase';
import { cmpText, norm } from '../lib/text';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { listInspectorAssignments, inspectorSiempreActivo } from '../lib/machineInspectors';
import { paradaShiftOf } from '../lib/inspectorDaySets';
import { caracasParts } from '../lib/jornada';
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
// Día de NEGOCIO de una marca de avería/parada (turno noche cruza medianoche): una
// marca de 0–7am pertenece a la NOCHE del día ANTERIOR (mismo criterio que el panel).
function businessDayOf(iso: string): string {
  const p = caracasParts(new Date(iso));
  if (p.hour < 7) { const d = new Date(p.iso + 'T12:00:00'); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); }
  return p.iso;
}

type Row = {
  id: string; round_date: string; inspector: string; code: string; serial: string | null; plate: string | null;
  company: string; shift: 'day' | 'night' | null; dayH: number; nightH: number; total: number;
  horoIni: number | null; horoFin: number | null;
  // Fila de ESTADO (avería/parada) en vez de jornada trabajada: sin horas, atribuida al
  // inspector del turno de la marca (paradaShiftOf), igual que el panel/teléfono.
  estado?: 'averia' | 'parada' | null; motivo?: string | null;
};

export default function HistoricoJornadasScreen() {
  const { colors } = useTheme();
  const [from, setFrom] = useState(caracasToday()); // por defecto: solo el día de hoy
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
    // Rondas del rango con horas (de día y/o de noche) + avería/parada marcada ESE DÍA
    // (INCL. las ya resueltas: cada fecha muestra lo que pasó ese día, no cambia al
    // resolverlas) + ficha de máquina (una máquina averiada que NO trabajó no tiene
    // ronda, así que su código/empresa hay que traerlo aparte).
    // La marca se acota por `created_at`: una marca aparece SOLO en su día de negocio,
    // que va de las 7am de ese día a las 7am del siguiente (el turno noche cruza la
    // medianoche), así que basta con created_at en [from 00:00, (to+1) 07:00).
    const toPlus1 = (() => { const d = new Date(to + 'T12:00:00'); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();
    const [rs, maintRows, machRows] = await Promise.all([
      selectAllRows(
        'machine_rounds',
        'id, machinery_id, round_date, day_hours, night_hours, horometro_inicial, horometro_final, jornada_start_at, jornada_shift, declared_day, declared_night, machine:machinery_id(code, serial, plate, company:company_id(name))',
        (q) => q.gte('round_date', from).lte('round_date', to),
      ),
      selectAllRows('maintenance_requests', 'machinery_id, material, notes, created_at, status, resolved_at', (q) => q.gte('created_at', `${from}T00:00:00-04:00`).lt('created_at', `${toPlus1}T07:00:00-04:00`)),
      selectAllRows('machinery', 'id, code, serial, plate, company:company_id(name)', (q) => q),
    ]);
    const machInfo = new Map<string, { code: string; serial: string | null; plate: string | null; company: string }>();
    ((machRows ?? []) as any[]).forEach((m) => machInfo.set(m.id, { code: m.code ?? '—', serial: m.serial ?? null, plate: m.plate ?? null, company: m.company?.name ?? 'Sin empresa' }));
    // Ronda por máquina+día (para la regla de reactivación: si la jornada de ESE turno
    // arrancó DESPUÉS de la marca, la máquina volvió a trabajar → no cuenta averiada).
    const roundByMD = new Map<string, { jStart: string | null; jShift: string | null }>();
    ((rs ?? []) as any[]).forEach((r) => roundByMD.set(`${r.machinery_id}|${r.round_date}`, { jStart: r.jornada_start_at ?? null, jShift: r.jornada_shift ?? null }));

    const list: Row[] = [];

    // 1) AVERÍA/PARADA POR TURNO (se calcula PRIMERO — tiene PRECEDENCIA sobre las horas):
    // una máquina "iniciada pero que se quedó averiada/parada" banca horas fantasma con el
    // auto-cierre (día = 12h fijas) aunque NO trabajara. Si estuvo averiada/parada ese
    // día+turno NO debe mostrar "trabajó 12h" — muestra AVERIADA/PARADA. Cada marca del día
    // se atribuye al inspector del turno de la HORA en que se marcó (paradaShiftOf), en su
    // día de negocio; se muestra UNA vez. Reglas idénticas al resto: avería > parada,
    // SIEMPRE ACTIVO (SOS) nunca averiada, y reactivación (jornada del turno tras la marca).
    const openShiftOf = (jShift: string | null, jStart: string | null): 'day' | 'night' | null =>
      (jShift as any) || (jStart ? paradaShiftOf(jStart) : null);
    const estadoKey = new Set<string>(); // `${mid}|${bday}|${shift}` con avería/parada — tapa la fila de horas
    const seen = new Set<string>(); // avería gana a su parada compañera (dedup del mismo key)
    // Avería (0) antes que parada (1); dentro del mismo tipo, la MÁS RECIENTE primero
    // (así el dedup conserva el motivo de la última marca de ese día+turno).
    const ordered = ((maintRows ?? []) as any[]).slice().sort((a, b) => {
      const pa = a.material === 'MÁQUINA PARADA' ? 1 : 0, pb = b.material === 'MÁQUINA PARADA' ? 1 : 0;
      if (pa !== pb) return pa - pb;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    ordered.forEach((m) => {
      const shift = paradaShiftOf(m.created_at) as 'day' | 'night';
      const bday = businessDayOf(m.created_at);
      if (bday < from || bday > to) return;
      // Solo cuenta como "se mantuvo averiada/parada" ese día si seguía PENDIENTE o se
      // resolvió DESPUÉS del cierre del día (7am del día siguiente). Si se resolvió el
      // MISMO día, la máquina se recuperó y trabajó → sus horas sí valen (no se tapa).
      const finDia = new Date(`${bday}T12:00:00-04:00`); finDia.setUTCDate(finDia.getUTCDate() + 1);
      const finDiaMs = new Date(`${finDia.toISOString().slice(0, 10)}T07:00:00-04:00`).getTime();
      const seMantuvo = m.status === 'pendiente' || (m.resolved_at && new Date(m.resolved_at).getTime() > finDiaMs);
      if (!seMantuvo) return;
      const inspector = (shift === 'night' ? nightInsp : dayInsp).get(m.machinery_id) || '';
      if (inspectorSiempreActivo(inspector)) return; // SOS LA GUAIRA: nunca averiada/parada
      const rmd = roundByMD.get(`${m.machinery_id}|${bday}`);
      if (rmd?.jStart && openShiftOf(rmd.jShift, rmd.jStart) === shift && new Date(rmd.jStart).getTime() >= new Date(m.created_at).getTime()) return; // reactivada → sí trabajó
      const key = `${m.machinery_id}|${bday}|${shift}`;
      if (seen.has(key)) return;
      seen.add(key);
      estadoKey.add(key);
      const tipo: 'averia' | 'parada' = m.material === 'MÁQUINA PARADA' ? 'parada' : 'averia';
      const mi = machInfo.get(m.machinery_id) || { code: '—', serial: null, plate: null, company: 'Sin empresa' };
      list.push({
        id: `mr:${m.machinery_id}:${bday}:${shift}`, round_date: bday, inspector,
        code: mi.code, serial: mi.serial, plate: mi.plate, company: mi.company,
        shift, dayH: 0, nightH: 0, total: 0, horoIni: null, horoFin: null,
        estado: tipo, motivo: m.notes || (tipo === 'averia' ? (m.material || null) : null),
      });
    });

    // 2) Jornadas con horas, PARTIDAS por turno (día→inspector de día, noche→de noche).
    // Se SALTA el turno que ya quedó como avería/parada arriba (no mostrar 12h fantasma
    // de una máquina que en realidad estuvo averiada/parada ese turno).
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
      const avDia = estadoKey.has(`${r.machinery_id}|${r.round_date}|day`);
      const avNoche = estadoKey.has(`${r.machinery_id}|${r.round_date}|night`);
      if (dayH > 0 && !avDia) list.push({ ...base, id: `${r.id}:d`, inspector: dayInsp.get(r.machinery_id) || '', shift: 'day', dayH, nightH: 0, total: r2(dayH) });
      if (nightH > 0 && !avNoche) list.push({ ...base, id: `${r.id}:n`, inspector: nightInsp.get(r.machinery_id) || '', shift: 'night', dayH: 0, nightH, total: r2(nightH) });
      // ARRANCÓ la jornada del turno pero cerró con 0h (sin avería/parada marcada) → PARADA
      // (regla del cliente: 0 horas = parada). Mismo criterio que buildDaySets (jornada_shift
      // persiste tras el auto-cierre). SIEMPRE ACTIVO (SOS) nunca queda parada.
      const dInsp = dayInsp.get(r.machinery_id) || '';
      const nInsp = nightInsp.get(r.machinery_id) || '';
      // "Declaró" con señal DURABLE por-turno (declared_day/declared_night, no se pisan
      // entre turnos), con FALLBACK a jornada_shift si la fila no la trae (blindaje 14-ago).
      const declDay = r.declared_day == null ? r.jornada_shift === 'day' : r.declared_day === true;
      const declNight = r.declared_night == null ? r.jornada_shift === 'night' : r.declared_night === true;
      if (dayH <= 0 && !avDia && declDay && !inspectorSiempreActivo(dInsp)) {
        list.push({ ...base, id: `${r.id}:pd`, inspector: dInsp, shift: 'day', dayH: 0, nightH: 0, total: 0, horoIni: null, horoFin: null, estado: 'parada', motivo: null });
      }
      if (nightH <= 0 && !avNoche && declNight && !inspectorSiempreActivo(nInsp)) {
        list.push({ ...base, id: `${r.id}:pn`, inspector: nInsp, shift: 'night', dayH: 0, nightH: 0, total: 0, horoIni: null, horoFin: null, estado: 'parada', motivo: null });
      }
    });

    setRows(list);
    setLoading(false);
  }, [from, to]);
  useEffect(() => { load(); }, [load]);
  // Al finalizar/cerrar una jornada (o cambiar asignaciones), el histórico se
  // actualiza solo. machine_inspectors: porque la atribución depende del CHECK.
  useRealtimeRefresh(['machine_rounds', 'machine_inspectors', 'maintenance_requests'], () => { load(); });

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
  const jornCount = useMemo(() => rows.filter((r) => !r.estado).length, [rows]);
  const estadoCount = useMemo(() => rows.filter((r) => r.estado).length, [rows]);
  const toggle = (n: string) => setExpanded((p) => { const s = new Set(p); s.has(n) ? s.delete(n) : s.add(n); return s; });

  const esc = (t: any) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const seccionHtml = ([name, list]: [string, Row[]]) => {
    const tot = r2(list.reduce((s, r) => s + r.total, 0));
    const jn = list.filter((r) => !r.estado).length;
    const en = list.filter((r) => r.estado).length;
    const filas = list.map((r, i) => {
      if (r.estado) {
        const badge = r.estado === 'averia' ? '🔴 Averiada' : '🟡 Parada';
        const mot = r.motivo ? ` · ${esc(r.motivo)}` : '';
        return `<tr><td>${i + 1}</td><td>${esc(dmy(r.round_date))}</td><td><b>${esc(r.code)}</b></td><td>${esc(r.serial || r.plate || '—')}</td><td>${esc(r.company)}</td><td>${r.shift === 'night' ? '🌙 noche' : '☀️ día'}</td><td colspan="2">${badge}${mot}</td></tr>`;
      }
      return `<tr><td>${i + 1}</td><td>${esc(dmy(r.round_date))}</td><td><b>${esc(r.code)}</b></td><td>${esc(r.serial || r.plate || '—')}</td><td>${esc(r.company)}</td><td>${r.shift === 'night' ? '🌙 noche' : '☀️ día'}</td><td class="r">${esc(r.horoIni ?? '—')} → ${esc(r.horoFin ?? '—')}</td><td class="r b">${r2(r.total)}</td></tr>`;
    }).join('');
    return `<h3>👷 ${esc(name)} · ${jn} jornada(s)${en ? ` · ${en} avería/parada` : ''} · ${tot} h</h3><table><thead><tr><th style="width:24px">Nº</th><th>Fecha</th><th>Máquina</th><th>Serial/Placa</th><th>Empresa</th><th>Turno</th><th class="r">Horómetro</th><th class="r">Horas</th></tr></thead><tbody>${filas}</tbody></table>`;
  };
  // Genera el PDF para un conjunto de inspectores (todos, o uno solo desde su tarjeta).
  const exportPdfEntries = async (entries: [string, Row[]][], soloInspector?: string) => {
    if (!entries.length) return;
    const allRows = entries.flatMap(([, l]) => l);
    if (!allRows.length) return;
    const jn = allRows.filter((r) => !r.estado).length;
    const en = allRows.filter((r) => r.estado).length;
    const th = r2(allRows.reduce((s, r) => s + r.total, 0));
    const html = pdfDocument({
      title: soloInspector ? `HISTÓRICO DE JORNADAS · ${esc(soloInspector).toUpperCase()}` : 'HISTÓRICO DE JORNADAS POR INSPECTOR',
      subtitle: `${dmy(from)} — ${dmy(to)} · ${jn} jornada(s)${en ? ` · ${en} avería/parada` : ''} · ${th} h`,
      extraCss: `table{width:100%;border-collapse:collapse;margin:4px 0 14px;font-size:11px}
        th,td{border:1px solid #c9d2dc;padding:5px 7px;text-align:left} th{background:#1E3A5F;color:#fff}
        td.r,th.r{text-align:right} td.b{font-weight:800} h3{margin:14px 0 3px;font-size:13px;color:#1E3A5F}`,
      body: entries.map(seccionHtml).join(''),
    });
    const quien = soloInspector ? soloInspector.replace(/[^\p{L}\p{N} ]/gu, '').trim() : 'jornadas';
    await exportPdf(html, `Historico ${quien} ${dmy(from)}-${dmy(to)}`);
  };
  const exportarPDF = () => exportPdfEntries(byInspector);
  const exportInspectorPDF = (name: string, list: Row[]) => exportPdfEntries([[name, list]], name);

  return (
    <Screen>
      <SectionTitle>📚 Histórico de jornadas por inspector</SectionTitle>
      <Card>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>Jornadas con horas + averías/paradas marcadas, por inspector ASIGNADO según su turno (día/noche), igual que el teléfono. Más recientes primero.</Text>
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
          <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.sm }}>{jornCount} jornada(s){estadoCount ? ` · ${estadoCount} avería/parada` : ''} · {byInspector.length} inspector(es) · {totalHoras} h en total</Text>
        ) : null}
      </Card>

      {loading ? <Loading /> : byInspector.length === 0 ? (
        <EmptyState title="Sin registros" subtitle="No hay jornadas con horas ni averías/paradas en el rango elegido." />
      ) : byInspector.map(([name, list]) => {
        const collapsed = query.trim() ? false : !expanded.has(name);
        const tot = r2(list.reduce((s, r) => s + r.total, 0));
        const jn = list.filter((r) => !r.estado).length;
        const en = list.filter((r) => r.estado).length;
        return (
          <Card key={name}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TouchableOpacity onPress={() => toggle(name)} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }} numberOfLines={1}>{collapsed ? '▸' : '▾'} 👷 {name}</Text>
                <Text style={{ fontSize: 12, fontWeight: '800' }}>
                  <Text style={{ color: colors.text }}>{jn} jorn</Text>
                  {en ? <Text style={{ color: colors.warning }}> · {en} av/par</Text> : null}
                  <Text style={{ color: colors.success }}> · {tot} h</Text>
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => exportInspectorPDF(name, list)} activeOpacity={0.7} style={{ marginLeft: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.primary, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 12 }}>📄 PDF</Text>
              </TouchableOpacity>
            </View>
            {collapsed ? null : list.map((r) => (
              <View key={r.id} style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, flex: 1 }} numberOfLines={1}>🚜 {r.code} <Text style={{ color: colors.muted, fontWeight: '400', fontSize: 12 }}>· {r.company}</Text></Text>
                  {r.estado ? (
                    <Text style={{ color: r.estado === 'averia' ? colors.danger : colors.warning, fontWeight: '900', fontSize: 13 }}>{r.estado === 'averia' ? '🔴 Averiada' : '🟡 Parada'}</Text>
                  ) : (
                    <Text style={{ color: colors.success, fontWeight: '900', fontSize: 14 }}>{r.total} h</Text>
                  )}
                </View>
                <Text style={{ color: colors.muted, fontSize: 11 }} numberOfLines={1}>📅 {dmy(r.round_date)} · {r.shift === 'night' ? '🌙 noche' : '☀️ día'} · 🔖 {r.serial || r.plate || '—'}</Text>
                {r.estado ? (
                  r.motivo ? <Text style={{ color: colors.muted, fontSize: 11 }} numberOfLines={2}>📝 {r.motivo}</Text> : null
                ) : (
                  <Text style={{ color: colors.muted, fontSize: 11 }} numberOfLines={1}>⏲️ Horómetro: {r.horoIni ?? '—'} → {r.horoFin ?? '—'} · ☀️ {r2(r.dayH)}h · 🌙 {r2(r.nightH)}h</Text>
                )}
              </View>
            ))}
          </Card>
        );
      })}
    </Screen>
  );
}
