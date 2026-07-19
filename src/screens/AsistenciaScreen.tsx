import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Image, Alert, ActivityIndicator } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { DateField } from '../components/DateField';
import QrScanner from '../components/QrScanner';
import { parseEmployeeId } from './ScanQrScreen';
import { supabase, selectAllRows } from '../lib/supabase';
import { caracasParts } from '../lib/jornada';
import { markAttendance, pairMarks, fmtDuration, fmtHora, nextKind } from '../lib/attendance';
import { exportPdf, pdfDocument } from '../lib/pdf';
import { norm } from '../lib/text';
import { useAuth } from '../context/AuthContext';
import { Employee, Attendance } from '../types/database';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

type Emp = Pick<Employee, 'id' | 'first_name' | 'last_name' | 'cedula' | 'cargo' | 'company_id' | 'photo_url'>;
const EMP_COLS = 'id, first_name, last_name, cedula, cargo, company_id, photo_url';
const fullName = (e?: Emp | null) => e ? `${e.first_name} ${e.last_name}`.trim() : '';
const fmtDMY = (iso?: string | null) => { const [y, m, d] = String(iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : (iso || '—'); };
const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export default function AsistenciaScreen() {
  const { colors } = useTheme();
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const todayISO = caracasParts(new Date()).iso;

  const [scanning, setScanning] = useState(false);
  const [emp, setEmp] = useState<Emp | null>(null);
  const [today, setToday] = useState<Attendance[]>([]);       // marcas de HOY del empleado elegido
  const [feed, setFeed] = useState<(Attendance & { emp?: Emp })[]>([]); // marcas de HOY (todas las personas)
  const [busy, setBusy] = useState(false);
  const [companies, setCompanies] = useState<Record<string, string>>({});

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
    loadFeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadFeed = async () => {
    const { data } = await supabase
      .from('attendance')
      .select(`id, employee_id, ts, work_date, kind, recorded_by, created_at, emp:employee_id(${EMP_COLS})`)
      .eq('work_date', todayISO)
      .order('ts', { ascending: false })
      .limit(60);
    setFeed((data ?? []) as any);
  };

  const loadToday = async (employeeId: string) => {
    const { data } = await supabase
      .from('attendance')
      .select('id, employee_id, ts, work_date, kind, recorded_by, created_at')
      .eq('employee_id', employeeId)
      .eq('work_date', todayISO)
      .order('ts', { ascending: true });
    setToday((data ?? []) as Attendance[]);
  };

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
    setBusy(true);
    const r = await markAttendance(emp.id, uid);
    setBusy(false);
    if (!r.ok) { Alert.alert('Aviso', r.error); return; }
    await Promise.all([loadToday(emp.id), loadFeed()]);
  };

  // ── Reporte PDF por rango ────────────────────────────────────────────────
  const generarReporte = async () => {
    const from = rFrom || todayISO, to = rTo || todayISO;
    if (from > to) { Alert.alert('Aviso', 'La fecha "Desde" no puede ser mayor que "Hasta".'); return; }
    setRBusy(true);
    try {
      const rows = await selectAllRows(
        'attendance',
        `employee_id, ts, work_date, kind, emp:employee_id(${EMP_COLS})`,
        (qb) => qb.gte('work_date', from).lte('work_date', to)
      );
      // Agrupa por empleado → por día.
      type Day = { date: string; marks: { kind: 'entrada' | 'salida'; ts: string }[] };
      const byEmp = new Map<string, { emp: Emp | null; days: Map<string, Day> }>();
      (rows ?? []).forEach((r: any) => {
        const g = byEmp.get(r.employee_id) ?? { emp: (r.emp as Emp) ?? null, days: new Map<string, Day>() };
        const d: Day = g.days.get(r.work_date) ?? { date: r.work_date, marks: [] };
        d.marks.push({ kind: r.kind, ts: r.ts });
        g.days.set(r.work_date, d);
        byEmp.set(r.employee_id, g);
      });
      if (byEmp.size === 0) { setRBusy(false); Alert.alert('Aviso', 'No hay marcas de asistencia en ese rango.'); return; }

      const groups = Array.from(byEmp.values()).sort((a, b) => norm(fullName(a.emp)).localeCompare(norm(fullName(b.emp))));
      let grandMin = 0;
      const bodies = groups.map((g) => {
        const days = Array.from(g.days.values()).sort((a, b) => a.date.localeCompare(b.date));
        let empMin = 0;
        const trs = days.map((day) => {
          const { pairs, totalMinutes, open } = pairMarks(day.marks);
          empMin += totalMinutes;
          const ins = pairs.map((p) => fmtHora(p.in)).join(' · ') || '—';
          const outs = pairs.map((p) => (p.out ? fmtHora(p.out) : '—')).join(' · ');
          return `<tr><td>${esc(fmtDMY(day.date))}</td><td>${esc(ins)}</td><td>${esc(outs || '—')}</td>` +
            `<td style="text-align:center">${pairs.length}</td>` +
            `<td style="text-align:right;font-weight:700">${esc(fmtDuration(totalMinutes))}${open ? ' <span style="color:#B45309">(abierta)</span>' : ''}</td></tr>`;
        }).join('');
        grandMin += empMin;
        return `<h3 class="emp">${esc(fullName(g.emp) || '—')} <span class="sub">· ${esc(g.emp?.cargo ?? '—')} · ${esc(companyName(g.emp?.company_id))}${g.emp?.cedula ? ` · C.I. ${esc(g.emp.cedula)}` : ''}</span></h3>
          <table><thead><tr><th>Fecha</th><th>Entrada(s)</th><th>Salida(s)</th><th style="text-align:center">Pares</th><th style="text-align:right">Horas presentes</th></tr></thead>
          <tbody>${trs}</tbody>
          <tfoot><tr><td colspan="4" style="text-align:right">Total ${esc(fullName(g.emp))}</td><td style="text-align:right">${esc(fmtDuration(empMin))}</td></tr></tfoot></table>`;
      }).join('');

      const html = pdfDocument({
        title: 'Control de asistencia',
        subtitle: `${fmtDMY(from)} → ${fmtDMY(to)} · ${groups.length} persona(s) · Total: ${fmtDuration(grandMin)}`,
        extraCss: `h3.emp{margin:16px 0 4px;font-size:13px;color:#1E3A5F} h3.emp .sub{font-weight:400;color:#555;font-size:11px}
          table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:6px}
          th,td{border:1px solid #ccc;padding:4px 7px;text-align:left} th{background:#1E3A5F;color:#fff}
          tfoot td{background:#EEF2F7;font-weight:800}`,
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
                {m.kind === 'entrada' ? '➡️ Entrada' : '⬅️ Salida'} · {fmtHora(m.ts)}
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

      {/* Marcas de hoy (todas las personas) */}
      <SectionTitle>Marcas de hoy</SectionTitle>
      {feed.length === 0 ? (
        <EmptyState title="Sin marcas hoy" subtitle="Escanea un carnet para registrar la primera." />
      ) : (
        feed.map((m) => (
          <Card key={m.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>{fullName(m.emp) || 'Empleado'}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{m.emp?.cargo ?? ''}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: m.kind === 'entrada' ? colors.success : colors.danger, fontWeight: '800', fontSize: 13 }}>{m.kind === 'entrada' ? '➡️ Entrada' : '⬅️ Salida'}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{fmtHora(m.ts)}</Text>
              </View>
            </View>
          </Card>
        ))
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
              <TouchableOpacity style={{ flex: 2, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary, opacity: rBusy ? 0.7 : 1 }} onPress={generarReporte} disabled={rBusy}>
                {rBusy ? <ActivityIndicator color={colors.primaryContrast} /> : <Text style={{ color: colors.primaryContrast, fontWeight: '800' }}>Generar PDF</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
