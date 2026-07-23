import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Image, Alert, ActivityIndicator } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import QrScanner from '../components/QrScanner';
import { parseEmployeeId } from './ScanQrScreen';
import { supabase, selectAllRows } from '../lib/supabase';
import { caracasParts } from '../lib/jornada';
import { markAttendance, pairMarks, fmtDuration, fmtHora, nextKind, shiftOfTs, SHIFT_LABEL } from '../lib/attendance';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { norm } from '../lib/text';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { Employee, Attendance } from '../types/database';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

type Emp = Pick<Employee, 'id' | 'first_name' | 'last_name' | 'cedula' | 'cargo' | 'company_id' | 'photo_url'>;
type Mark = Attendance & { emp?: Emp };
const EMP_COLS = 'id, first_name, last_name, cedula, cargo, company_id, photo_url';
const fullName = (e?: Emp | null) => e ? `${e.first_name} ${e.last_name}`.trim() : '';
const fmtDMY = (iso?: string | null) => { const [y, m, d] = String(iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : (iso || '—'); };
const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── Utilidades de calendario (mes 'YYYY-MM', semana empieza en LUNES) ──────────
const MES_NOMBRE = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DOW_CORTO = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const DIA_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const monthLabel = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${MES_NOMBRE[m - 1]} ${y}`; };
const shiftMonth = (ym: string, delta: number) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + delta, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
/** Celdas del mes: null para el relleno inicial y 'YYYY-MM-DD' para cada día. */
function monthGrid(ym: string): (string | null)[] {
  const [y, m] = ym.split('-').map(Number);
  const startDow = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Lunes = 0
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells: (string | null)[] = Array(startDow).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${ym}-${String(d).padStart(2, '0')}`);
  return cells;
}
/** Día de la semana en texto (Lunes…Domingo) de un ISO 'YYYY-MM-DD'. */
const dowLabel = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return DIA_SEMANA[(new Date(y, m - 1, d).getDay() + 6) % 7]; };

export default function AsistenciaScreen() {
  const { colors } = useTheme();
  const { session } = useAuth();
  const confirm = useConfirm();
  const uid = session?.user?.id ?? null;
  const todayISO = caracasParts(new Date()).iso;

  const [scanning, setScanning] = useState(false);
  const [emp, setEmp] = useState<Emp | null>(null);
  const [today, setToday] = useState<Attendance[]>([]);       // marcas de HOY del empleado elegido
  const [busy, setBusy] = useState(false);
  const [companies, setCompanies] = useState<Record<string, string>>({});

  // Calendario del mes: mes visible → día seleccionado → turno (día/noche) → detalle.
  const [month, setMonth] = useState<string>(todayISO.slice(0, 7)); // 'YYYY-MM'
  const [monthRows, setMonthRows] = useState<Mark[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedShift, setSelectedShift] = useState<'dia' | 'noche' | null>(null);

  // Búsqueda manual (por si el carnet no escanea)
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Emp[]>([]);

  // Reporte
  const [repOpen, setRepOpen] = useState(false);
  const [rFrom, setRFrom] = useState(todayISO);
  const [rTo, setRTo] = useState(todayISO);
  const [rBusy, setRBusy] = useState(false);

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;
  const companyName = (id?: string | null) => (id ? companies[id] ?? 'Empresa' : 'Sin empresa');

  useEffect(() => {
    supabase.from('companies').select('id, name').then(({ data }) => {
      const m: Record<string, string> = {}; (data ?? []).forEach((c: any) => (m[c.id] = c.name)); setCompanies(m);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Carga TODAS las marcas del mes visible (paginado por si supera 1000 filas).
  useEffect(() => { loadMonth(month); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [month]);
  const loadMonth = async (ym: string) => {
    const start = `${ym}-01`, end = `${shiftMonth(ym, 1)}-01`; // [start, end)
    const rows = await selectAllRows(
      'attendance',
      `id, employee_id, ts, work_date, kind, emp:employee_id(${EMP_COLS})`,
      (qb) => qb.gte('work_date', start).lt('work_date', end)
    );
    setMonthRows((rows ?? []) as Mark[]);
  };

  // Marcas agrupadas por día del mes visible.
  const marksByDay = useMemo(() => {
    const m = new Map<string, Mark[]>();
    monthRows.forEach((x) => { const a = m.get(x.work_date) ?? []; a.push(x); m.set(x.work_date, a); });
    return m;
  }, [monthRows]);
  const distinctEmp = (marks: Mark[]) => new Set(marks.map((m) => m.employee_id)).size;
  const shiftMarks = (dayMarks: Mark[], sh: 'dia' | 'noche') => dayMarks.filter((m) => shiftOfTs(m.ts) === sh);

  // Detalle del turno seleccionado: por persona, con sus pares entrada→salida.
  const detail = useMemo(() => {
    if (!selectedDay || !selectedShift) return [] as { emp: Emp | null; total: number; pairs: ReturnType<typeof pairMarks>['pairs'] }[];
    const dm = shiftMarks(marksByDay.get(selectedDay) ?? [], selectedShift);
    const byEmp = new Map<string, { emp: Emp | null; marks: Mark[] }>();
    dm.forEach((m) => { const g = byEmp.get(m.employee_id) ?? { emp: m.emp ?? null, marks: [] }; g.marks.push(m); byEmp.set(m.employee_id, g); });
    return Array.from(byEmp.values())
      .map((g) => { const p = pairMarks(g.marks); return { emp: g.emp, total: p.totalMinutes, pairs: p.pairs }; })
      .sort((a, b) => norm(fullName(a.emp)).localeCompare(norm(fullName(b.emp))));
  }, [selectedDay, selectedShift, marksByDay]);

  const loadToday = async (employeeId: string) => {
    const { data } = await supabase
      .from('attendance')
      .select('id, employee_id, ts, work_date, kind, recorded_by, created_at')
      .eq('employee_id', employeeId)
      .eq('work_date', todayISO)
      .order('ts', { ascending: true });
    setToday((data ?? []) as Attendance[]);
  };

  // Sincroniza en TIEMPO REAL: si otro dispositivo marca una asistencia, el
  // calendario del mes (y las marcas de hoy del empleado abierto) se refrescan solos.
  useRealtimeRefresh(['attendance'], () => {
    loadMonth(month);
    if (emp) loadToday(emp.id);
  });

  const pickEmployee = async (employeeId: string) => {
    setQ(''); setResults([]);
    const { data, error } = await supabase.from('employees').select(EMP_COLS).eq('id', employeeId).maybeSingle();
    if (error || !data) { Alert.alert('Aviso', 'No se encontró ese empleado. Verifica el carnet.'); return; }
    setEmp(data as Emp);
    await loadToday(employeeId);
  };

  const onScanned = (text: string) => {
    setScanning(false);
    const id = parseEmployeeId(text);
    if (!id) { Alert.alert('Aviso', 'Ese QR no es un carnet de empleado válido.'); return; }
    pickEmployee(id);
  };

  // Búsqueda manual con debounce simple.
  useEffect(() => {
    const term = norm(q.trim());
    if (term.length < 2) { setResults([]); return; }
    let alive = true;
    const t = setTimeout(async () => {
      const { data } = await supabase.from('employees').select(EMP_COLS)
        .or(`first_name.ilike.*${q.trim()}*,last_name.ilike.*${q.trim()}*,cedula.ilike.*${q.trim()}*`)
        .order('first_name').limit(20);
      if (alive) setResults((data ?? []) as Emp[]);
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  const lastKindToday = today.length ? today[today.length - 1].kind : null;
  const willMark = nextKind(lastKindToday);
  const { totalMinutes, open } = useMemo(() => pairMarks(today), [today]);

  const marcar = async () => {
    if (!emp) return;
    // Si la próxima marca es SALIDA, confirmar (evita registrar salida por un doble escaneo).
    if (willMark === 'salida') {
      const lastIn = [...today].reverse().find((m) => m.kind === 'entrada');
      // Minutos desde la última ENTRADA: si son < 2, casi seguro es un DOBLE ESCANEO
      // del mismo carnet (no una salida real), así que se avisa con más fuerza.
      const minsSince = lastIn ? Math.round((Date.now() - new Date(lastIn.ts).getTime()) / 60000) : null;
      const dobleEscaneo = minsSince !== null && minsSince < 2;
      const ok = await confirm({
        title: dobleEscaneo ? '¿Doble escaneo?' : '¿Registrar SALIDA?',
        message: dobleEscaneo
          ? `La ENTRADA de ${fullName(emp)} fue hace ${minsSince! < 1 ? 'menos de 1 minuto' : `${minsSince} min`}. ` +
            `Parece un doble escaneo del carnet, no una salida real.\n\n¿Quieres registrar la SALIDA de todas formas?`
          : `¿Seguro que quieres registrar la SALIDA de ${fullName(emp)}?` +
            (lastIn ? `\n\nSu última ENTRADA fue a las ${fmtHora(lastIn.ts)} (${SHIFT_LABEL[shiftOfTs(lastIn.ts)]}).` : ''),
        confirmText: 'Sí, registrar salida',
        cancelText: dobleEscaneo ? 'No, fue doble escaneo' : 'Cancelar',
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    const r = await markAttendance(emp.id, uid);
    setBusy(false);
    if (!r.ok) { Alert.alert('Aviso', r.error); return; }
    await Promise.all([loadToday(emp.id), loadMonth(month)]);
  };

  // ── Reporte PDF por rango (o de un día concreto si se pasan fechas) ────────
  const generarReporte = async (fromArg?: string, toArg?: string) => {
    const from = fromArg ?? rFrom ?? todayISO, to = toArg ?? rTo ?? todayISO;
    if (from > to) { Alert.alert('Aviso', 'La fecha "Desde" no puede ser mayor que "Hasta".'); return; }
    setRBusy(true);
    try {
      const rows = await selectAllRows(
        'attendance',
        `employee_id, ts, work_date, kind, emp:employee_id(${EMP_COLS})`,
        (qb) => qb.gte('work_date', from).lte('work_date', to)
      );
      // Agrupa por empleado; empareja entrada→salida sobre TODO su historial (así una
      // jornada de noche que cruza la medianoche se empareja bien). Cada par se ubica en
      // la fecha de su ENTRADA y su turno (☀️ Día / 🌙 Noche) según la hora de entrada.
      const byEmp = new Map<string, { emp: Emp | null; marks: { kind: 'entrada' | 'salida'; ts: string }[] }>();
      (rows ?? []).forEach((r: any) => {
        const g = byEmp.get(r.employee_id) ?? { emp: (r.emp as Emp) ?? null, marks: [] };
        g.marks.push({ kind: r.kind, ts: r.ts });
        byEmp.set(r.employee_id, g);
      });
      if (byEmp.size === 0) { setRBusy(false); Alert.alert('Aviso', 'No hay marcas de asistencia en ese rango.'); return; }

      const groups = Array.from(byEmp.values()).sort((a, b) => norm(fullName(a.emp)).localeCompare(norm(fullName(b.emp))));
      let grandMin = 0, grandDia = 0, grandNoche = 0;
      const bodies = groups.map((g) => {
        const { pairs } = pairMarks(g.marks);
        let empDia = 0, empNoche = 0;
        const trs = pairs.slice().sort((a, b) => a.in.localeCompare(b.in)).map((p) => {
          const date = caracasParts(new Date(p.in)).iso;
          const sh = shiftOfTs(p.in);
          if (sh === 'dia') empDia += p.minutes; else empNoche += p.minutes;
          return `<tr><td>${esc(fmtDMY(date))}</td><td>${SHIFT_LABEL[sh]}</td><td class="c">${esc(fmtHora(p.in))}</td>` +
            `<td class="c">${p.out ? esc(fmtHora(p.out)) : '—'}</td>` +
            `<td style="text-align:right;font-weight:700">${esc(fmtDuration(p.minutes))}${p.out ? '' : ' <span style="color:#B45309">(abierta)</span>'}</td></tr>`;
        }).join('');
        const empMin = empDia + empNoche;
        grandMin += empMin; grandDia += empDia; grandNoche += empNoche;
        return `<h3 class="emp">${esc(fullName(g.emp) || '—')} <span class="sub">· ${esc(g.emp?.cargo ?? '—')} · ${esc(companyName(g.emp?.company_id))}${g.emp?.cedula ? ` · C.I. ${esc(g.emp.cedula)}` : ''}</span></h3>
          <table><thead><tr><th>Fecha</th><th>Turno</th><th class="c">Entrada</th><th class="c">Salida</th><th style="text-align:right">Horas</th></tr></thead>
          <tbody>${trs || '<tr><td colspan="5" class="c">Sin jornadas completas</td></tr>'}</tbody>
          <tfoot><tr><td colspan="4" style="text-align:right">Total ${esc(fullName(g.emp))} (☀️ ${esc(fmtDuration(empDia))} · 🌙 ${esc(fmtDuration(empNoche))})</td><td style="text-align:right">${esc(fmtDuration(empMin))}</td></tr></tfoot></table>`;
      }).join('');

      const html = pdfDocument({
        title: 'Control de asistencia',
        subtitle: `${fmtDMY(from)} → ${fmtDMY(to)} · ${groups.length} persona(s) · Total: ${fmtDuration(grandMin)} (☀️ ${fmtDuration(grandDia)} · 🌙 ${fmtDuration(grandNoche)})`,
        extraCss: `h3.emp{margin:16px 0 4px;font-size:13px;color:#1E3A5F} h3.emp .sub{font-weight:400;color:#555;font-size:11px}
          table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:6px}
          th,td{border:1px solid #ccc;padding:4px 7px;text-align:left} th{background:#1E3A5F;color:#fff}
          td.c{text-align:center} tfoot td{background:#EEF2F7;font-weight:800}`,
        body: bodies,
      });
      setRBusy(false); setRepOpen(false);
      await exportPdf(html, `Asistencia ${from} a ${to}`);
    } catch (e: any) {
      setRBusy(false);
      Alert.alert('Aviso', e?.message ?? 'No se pudo generar el reporte.');
    }
  };

  return (
    <Screen>
      <ConfigBanner />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>Control de asistencia</SectionTitle>
        <TouchableOpacity onPress={() => { setRFrom(todayISO); setRTo(todayISO); setRepOpen(true); }} style={{ backgroundColor: '#111827', paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>📊 Reporte</Text>
        </TouchableOpacity>
      </View>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>Escanea el carnet del trabajador para marcar su ENTRADA o SALIDA (fecha y hora automáticas). Se permiten varias marcas al día.</Text>

      {/* Escanear carnet */}
      <TouchableOpacity onPress={() => setScanning(true)} style={{ backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm }}>
        <Text style={{ fontSize: 20 }}>📷</Text>
        <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 15 }}>Escanear carnet</Text>
      </TouchableOpacity>

      {/* Búsqueda manual */}
      <TextInput value={q} onChangeText={setQ} placeholder="🔎 …o busca por nombre o cédula" placeholderTextColor={colors.muted} style={{ ...input, marginTop: spacing.sm }} />
      {results.length ? (
        <Card>
          {results.map((r) => (
            <TouchableOpacity key={r.id} onPress={() => pickEmployee(r.id)} style={{ paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>{fullName(r)}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{[r.cargo, r.cedula ? `C.I. ${r.cedula}` : ''].filter(Boolean).join(' · ')}</Text>
            </TouchableOpacity>
          ))}
        </Card>
      ) : null}

      {/* Empleado elegido + marca inteligente */}
      {emp ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            {emp.photo_url ? (
              <Image source={{ uri: emp.photo_url }} style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: colors.surfaceAlt }} />
            ) : (
              <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 24 }}>🪪</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>{fullName(emp)}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{[emp.cargo, companyName(emp.company_id)].filter(Boolean).join(' · ')}</Text>
              {emp.cedula ? <Text style={{ color: colors.muted, fontSize: 12 }}>C.I. {emp.cedula}</Text> : null}
            </View>
            <TouchableOpacity onPress={() => { setEmp(null); setToday([]); }} style={{ padding: spacing.xs }}>
              <Text style={{ color: colors.muted, fontWeight: '800', fontSize: 16 }}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Estado de hoy */}
          <View style={{ marginTop: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm }}>
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              Hoy: {today.length ? `${today.length} marca(s) · ${fmtDuration(totalMinutes)} presente${open ? ' · jornada abierta' : ''}` : 'sin marcas todavía'}
            </Text>
            {today.map((m) => (
              <Text key={m.id} style={{ color: m.kind === 'entrada' ? colors.success : colors.danger, fontSize: 13, fontWeight: '700', marginTop: 2 }}>
                {m.kind === 'entrada' ? '➡️ Entrada' : '⬅️ Salida'} · {fmtHora(m.ts)} · {SHIFT_LABEL[shiftOfTs(m.ts)]}
              </Text>
            ))}
          </View>

          <TouchableOpacity onPress={marcar} disabled={busy} style={{ marginTop: spacing.sm, backgroundColor: willMark === 'entrada' ? colors.success : colors.danger, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: busy ? 0.7 : 1 }}>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>
              {busy ? 'Guardando…' : willMark === 'entrada' ? '➡️ Marcar ENTRADA' : '⬅️ Marcar SALIDA'}
            </Text>
          </TouchableOpacity>
        </Card>
      ) : null}

      {/* Calendario del mes: día → turno → detalle */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md }}>
        <TouchableOpacity onPress={() => { setMonth(shiftMonth(month, -1)); setSelectedDay(null); setSelectedShift(null); }} style={{ padding: spacing.sm }}>
          <Text style={{ color: colors.primary, fontSize: 20, fontWeight: '800' }}>◀</Text>
        </TouchableOpacity>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>{monthLabel(month)}</Text>
        <TouchableOpacity onPress={() => { setMonth(shiftMonth(month, 1)); setSelectedDay(null); setSelectedShift(null); }} style={{ padding: spacing.sm }}>
          <Text style={{ color: colors.primary, fontSize: 20, fontWeight: '800' }}>▶</Text>
        </TouchableOpacity>
      </View>

      <Card>
        {/* Cabecera de días de la semana */}
        <View style={{ flexDirection: 'row' }}>
          {DOW_CORTO.map((d, i) => (
            <Text key={i} style={{ flex: 1, textAlign: 'center', color: colors.muted, fontSize: 11, fontWeight: '700', marginBottom: 4 }}>{d}</Text>
          ))}
        </View>
        {/* Cuadrícula del mes (6 filas máx.) */}
        {Array.from({ length: Math.ceil(monthGrid(month).length / 7) }).map((_, row) => (
          <View key={row} style={{ flexDirection: 'row' }}>
            {monthGrid(month).slice(row * 7, row * 7 + 7).map((iso, col) => {
              if (!iso) return <View key={col} style={{ flex: 1, aspectRatio: 1 }} />;
              const dayMarks = marksByDay.get(iso) ?? [];
              const has = dayMarks.length > 0;
              const isToday = iso === todayISO;
              const isSel = iso === selectedDay;
              const num = Number(iso.slice(-2));
              return (
                <TouchableOpacity
                  key={col}
                  onPress={() => { setSelectedDay(isSel ? null : iso); setSelectedShift(null); }}
                  activeOpacity={0.7}
                  style={{ flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', margin: 1, borderRadius: radius.sm,
                    backgroundColor: isSel ? colors.primary : has ? colors.surfaceAlt : 'transparent',
                    borderWidth: isToday ? 2 : 0, borderColor: colors.primary }}
                >
                  <Text style={{ color: isSel ? colors.primaryContrast : colors.text, fontWeight: isToday || has ? '800' : '500', fontSize: 13 }}>{num}</Text>
                  {has ? (
                    <View style={{ minWidth: 16, paddingHorizontal: 3, borderRadius: 8, marginTop: 1, backgroundColor: isSel ? colors.primaryContrast : colors.primary }}>
                      <Text style={{ color: isSel ? colors.primary : colors.primaryContrast, fontSize: 9, fontWeight: '800', textAlign: 'center' }}>{distinctEmp(dayMarks)}</Text>
                    </View>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
        <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>El número en el globo = personas con marcas ese día. Toca un día para ver ☀️ Día / 🌙 Noche.</Text>
      </Card>

      {/* Día seleccionado → dos tarjetas de turno + reporte del día */}
      {selectedDay ? (() => {
        const dm = marksByDay.get(selectedDay) ?? [];
        const dia = shiftMarks(dm, 'dia'), noche = shiftMarks(dm, 'noche');
        const shiftCard = (sh: 'dia' | 'noche', marks: Mark[]) => {
          const active = selectedShift === sh;
          return (
            <TouchableOpacity
              onPress={() => setSelectedShift(active ? null : sh)}
              activeOpacity={0.7}
              style={{ flex: 1, backgroundColor: active ? colors.primary : colors.surfaceAlt, borderWidth: 1, borderColor: active ? colors.primary : colors.border, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' }}
            >
              <Text style={{ fontSize: 20 }}>{sh === 'dia' ? '☀️' : '🌙'}</Text>
              <Text style={{ color: active ? colors.primaryContrast : colors.text, fontWeight: '800', fontSize: 14, marginTop: 2 }}>{sh === 'dia' ? 'Día' : 'Noche'}</Text>
              <Text style={{ color: active ? colors.primaryContrast : colors.muted, fontSize: 12 }}>{distinctEmp(marks)} persona(s)</Text>
              <Text style={{ color: active ? colors.primaryContrast : colors.muted, fontSize: 11 }}>{marks.length} marca(s)</Text>
            </TouchableOpacity>
          );
        };
        return (
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{dowLabel(selectedDay)} {fmtDMY(selectedDay)}</Text>
              <TouchableOpacity onPress={() => generarReporte(selectedDay, selectedDay)} disabled={rBusy} style={{ backgroundColor: '#111827', paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>📊 Reporte del día</Text>
              </TouchableOpacity>
            </View>
            {dm.length === 0 ? (
              <Text style={{ color: colors.muted, fontSize: 13 }}>Sin marcas este día.</Text>
            ) : (
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                {shiftCard('dia', dia)}
                {shiftCard('noche', noche)}
              </View>
            )}

            {/* Detalle del turno elegido */}
            {selectedShift ? (
              <View style={{ marginTop: spacing.md }}>
                <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>{SHIFT_LABEL[selectedShift]} · detalle</Text>
                {detail.length === 0 ? (
                  <Text style={{ color: colors.muted, fontSize: 13 }}>Nadie en este turno.</Text>
                ) : detail.map((g, i) => (
                  <View key={i} style={{ paddingVertical: spacing.xs, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14, flex: 1 }}>{fullName(g.emp) || 'Empleado'}</Text>
                      <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>{fmtDuration(g.total)}</Text>
                    </View>
                    {g.emp?.cargo ? <Text style={{ color: colors.muted, fontSize: 11 }}>{g.emp.cargo}</Text> : null}
                    {g.pairs.map((p, j) => (
                      <Text key={j} style={{ color: colors.muted, fontSize: 12, marginTop: 1 }}>
                        <Text style={{ color: colors.success }}>➡️ {fmtHora(p.in)}</Text>
                        {'  →  '}
                        {p.out ? <Text style={{ color: colors.danger }}>⬅️ {fmtHora(p.out)}</Text> : <Text style={{ color: '#B45309' }}>abierta</Text>}
                        {'   '}({fmtDuration(p.minutes)})
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            ) : null}
          </Card>
        );
      })() : (
        <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: spacing.sm }}>Toca un día del calendario para ver el detalle.</Text>
      )}
      <View style={{ height: spacing.lg }} />

      {/* Escáner (pantalla completa) */}
      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <QrScanner onDetected={onScanned} onClose={() => setScanning(false)} />
      </Modal>

      {/* Reporte por rango */}
      <Modal visible={repOpen} transparent animationType="slide" onRequestClose={() => setRepOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18, marginBottom: spacing.sm }}>📊 Reporte de asistencia</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>Por persona y día: entradas/salidas y horas presentes (suma de pares). Una entrada sin salida sale como “abierta”.</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}><Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Desde</Text><DateField value={rFrom} onChange={setRFrom} /></View>
              <View style={{ flex: 1 }}><Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Hasta</Text><DateField value={rTo} onChange={setRTo} /></View>
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
              <TouchableOpacity style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }} onPress={() => setRepOpen(false)}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 2, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary, opacity: rBusy ? 0.7 : 1 }} onPress={() => generarReporte()} disabled={rBusy}>
                {rBusy ? <ActivityIndicator color={colors.primaryContrast} /> : <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>Generar PDF</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
