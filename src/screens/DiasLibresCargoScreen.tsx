// Nómina → DISTRIBUCIÓN DE DÍAS LIBRES.
// Se navega POR CARGO pero el descanso es POR PERSONA: abres un cargo, ves su
// gente (del personal activo) y a cada persona le asignas su SEMANA LIBRE del
// ciclo (tocando la semana, con fechas reales). Cada persona puede descansar una
// semana distinta; se avisa el choque cuando dos personas del MISMO cargo caen en
// la misma semana. Datos en `dias_libres_cargo` (ver supabase/dias_libres_cargo.sql).
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, ScrollView, TextInput } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { cmpText, norm } from '../lib/text';
import { DateField } from '../components/DateField';
import { generateGuardiasReport, GuardInspector, GuardShift } from '../lib/guardiasReport';
import { useRealtimeRefresh } from '../hooks/useRealtime';

// Paleta por semana/grupo (soporta cualquier cantidad de semanas).
const GRUPO_PALETTE = ['#9AA3AB', '#4BB477', '#E0A040', '#5B8DEF', '#C77DD6', '#E0655B', '#3FBFB0', '#B0894A', '#8A7BE0', '#6AA84F', '#D98CA0', '#7F9CB5'];
const grupoColor = (g: string | null | undefined): string => {
  const i = g ? g.charCodeAt(0) - 65 : -1; // 'A'->0, 'B'->1…
  return i >= 0 ? GRUPO_PALETTE[i % GRUPO_PALETTE.length] : '#9AA3AB';
};

function caracasTodayISO(): string {
  const p: any = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (t: string) => p.find((x: any) => x.type === t)?.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function daysBetween(from: string, to: string): string[] {
  const out: string[] = []; let cur = from;
  for (let i = 0; i < 400 && cur <= to; i++) { out.push(cur); cur = addDaysISO(cur, 1); }
  return out;
}
const dmy = (iso: string) => { const [y, m, d] = (iso || '').split('-'); return y && m && d ? `${d}/${m}` : iso; };

// Medidas de la MATRIZ Persona × Semana (nombres fijos a la izquierda, semanas con scroll).
const NAME_W = 134, WEEK_W = 66, HEADER_H = 46, CARGO_H = 26, PERSONA_H = 40, FOOTER_H = 30;

type Cargo = { name: string; count: number; departments: string[] };
type Persona = { id: string; name: string; cedula: string | null; cargo: string };
type Shift = { id: string; cargo: string; employee_id: string | null; persona: string | null; from_date: string; to_date: string; grupo: string | null };

export default function DiasLibresCargoScreen() {
  const { colors } = useTheme();
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;

  const today = caracasTodayISO();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDaysISO(today, 27)); // 4 semanas por defecto
  const [cargosAll, setCargosAll] = useState<Cargo[]>([]);
  const [personasByCargo, setPersonasByCargo] = useState<Map<string, Persona[]>>(new Map());
  const [deptList, setDeptList] = useState<string[]>([]);
  const [deptFiltro, setDeptFiltro] = useState<string>(''); // '' = todos los departamentos
  const [deptOpen, setDeptOpen] = useState(false);          // desplegable de departamento
  const [deptQuery, setDeptQuery] = useState('');           // búsqueda dentro del desplegable
  const [cargoQuery, setCargoQuery] = useState('');
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [descansoFor, setDescansoFor] = useState<Persona | null>(null); // detalle / semana en otra fecha de una persona
  const [dFrom, setDFrom] = useState(today);
  const [dTo, setDTo] = useState(addDaysISO(today, 6));

  // Cargos MOSTRADOS = filtrados por departamento y por búsqueda de cargo.
  const cargos = useMemo(
    () =>
      cargosAll.filter(
        (c) =>
          (!deptFiltro || c.departments.includes(deptFiltro)) &&
          (!cargoQuery.trim() || norm(c.name).includes(norm(cargoQuery)))
      ),
    [cargosAll, deptFiltro, cargoQuery]
  );
  // Personas mostradas (de los cargos filtrados).
  const personasShown = useMemo(
    () => cargos.flatMap((c) => personasByCargo.get(c.name) ?? []),
    [cargos, personasByCargo]
  );

  const days = useMemo(() => daysBetween(from, to), [from, to]);
  // Semanas del ciclo (con FECHAS REALES): tantas como quepan en el rango Desde→Hasta.
  const nSemanas = Math.max(1, Math.ceil(days.length / 7));
  const GRUPOS = useMemo(() => Array.from({ length: nSemanas }, (_, i) => String.fromCharCode(65 + i)), [nSemanas]);
  const semanas = useMemo(
    () => Array.from({ length: nSemanas }, (_, i) => ({
      idx: i,
      letra: GRUPOS[i],
      from: addDaysISO(from, i * 7),
      to: addDaysISO(from, i * 7 + 6),
    })),
    [nSemanas, GRUPOS, from]
  );

  const load = async () => {
    setLoading(true);
    const [emp, sh] = await Promise.all([
      supabase.from('employees').select('id, first_name, last_name, cedula, cargo, department, status'),
      supabase.from('dias_libres_cargo').select('id, cargo, employee_id, persona, from_date, to_date, grupo'),
    ]);
    // Cargos + personas EN VIVO del personal ACTIVO.
    const counts = new Map<string, number>();
    const depts = new Map<string, Set<string>>();
    const deptSet = new Set<string>();
    const pByCargo = new Map<string, Persona[]>();
    ((emp.data ?? []) as any[]).forEach((e) => {
      if ((e.status || '').toLowerCase() !== 'activo') return;
      const c = String(e.cargo ?? '').trim();
      if (!c) return;
      counts.set(c, (counts.get(c) ?? 0) + 1);
      const d = String(e.department ?? '').trim();
      if (d) { if (!depts.has(c)) depts.set(c, new Set()); depts.get(c)!.add(d); deptSet.add(d); }
      const nm = `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || '(sin nombre)';
      const arr = pByCargo.get(c) ?? []; arr.push({ id: e.id, name: nm, cedula: e.cedula ?? null, cargo: c }); pByCargo.set(c, arr);
    });
    pByCargo.forEach((arr) => arr.sort((a, b) => cmpText(a.name, b.name)));
    const list: Cargo[] = [...counts.entries()]
      .map(([name, count]) => ({ name, count, departments: [...(depts.get(name) ?? [])] }))
      .sort((a, b) => cmpText(a.name, b.name));
    setCargosAll(list);
    setPersonasByCargo(pByCargo);
    setDeptList([...deptSet].sort((a, b) => cmpText(a, b)));
    setShifts((sh.data ?? []) as Shift[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  useRealtimeRefresh(['dias_libres_cargo', 'employees'], () => { load(); });

  // Descansos por PERSONA (employee_id). Los registros sin persona (legado por cargo) se ignoran.
  const shiftsByPerson = useMemo(() => {
    const m = new Map<string, Shift[]>();
    shifts.forEach((s) => { if (!s.employee_id) return; const l = m.get(s.employee_id) ?? []; l.push(s); m.set(s.employee_id, l); });
    return m;
  }, [shifts]);
  // Semana (grupo) asignada a una persona, o -1.
  const grupoDePersona = (empId: string): string | null => {
    const list = (shiftsByPerson.get(empId) ?? []).slice().sort((a, b) => cmpText(b.from_date, a.from_date));
    return list[0]?.grupo ?? null;
  };
  const semanaIdxDePersona = (empId: string): number => {
    const g = grupoDePersona(empId);
    return g ? g.charCodeAt(0) - 65 : -1;
  };
  // Personas que descansan cada semana (para el resumen de choques).
  const ocupacion = useMemo(() => {
    const m = new Map<string, number>();
    personasShown.forEach((p) => { const g = grupoDePersona(p.id); if (g) m.set(g, (m.get(g) ?? 0) + 1); });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personasShown, shiftsByPerson]);

  // Filas de la MATRIZ: por cada cargo, una fila de encabezado + una por persona.
  // Left (nombres) y right (celdas) iteran esta MISMA lista para alinear alturas.
  type MRow = { kind: 'cargo'; name: string; count: number } | { kind: 'persona'; p: Persona };
  const matrixRows = useMemo<MRow[]>(() => {
    const rows: MRow[] = [];
    cargos.forEach((c) => {
      const ppl = personasByCargo.get(c.name) ?? [];
      rows.push({ kind: 'cargo', name: c.name, count: ppl.length });
      ppl.forEach((p) => rows.push({ kind: 'persona', p }));
    });
    return rows;
  }, [cargos, personasByCargo]);

  // Quita la semana libre de una persona (toque directo sobre su celda ya marcada).
  const quitarSemanaPersona = async (p: Persona) => {
    setBusy(true);
    await supabase.from('dias_libres_cargo').delete().eq('employee_id', p.id).not('grupo', 'is', null);
    setBusy(false); load();
  };

  // Asigna (o cambia) la semana libre de UNA persona tocando su botón.
  const asignarSemana = async (p: Persona, idx: number) => {
    setBusy(true); setNotice(null);
    const from_date = addDaysISO(from, idx * 7);
    const to_date = addDaysISO(from, idx * 7 + 6);
    // Reemplaza solo la semana de rotación (grupo no nulo); conserva las de "otra fecha".
    await supabase.from('dias_libres_cargo').delete().eq('employee_id', p.id).not('grupo', 'is', null);
    await supabase.from('dias_libres_cargo').insert({ cargo: p.cargo, employee_id: p.id, persona: p.name, from_date, to_date, grupo: GRUPOS[idx], created_by: uid });
    setBusy(false); load();
  };

  // REPARTIR AUTOMÁTICO: dentro de cada cargo, su gente se reparte en semanas
  // distintas (round-robin) para que no descanse todo el cargo la misma semana.
  const repartirAuto = async () => {
    if (personasShown.length === 0) { setNotice('❌ No hay personas en los cargos mostrados.'); return; }
    setBusy(true); setNotice(null);
    const nuevos: any[] = [];
    cargos.forEach((c) => {
      (personasByCargo.get(c.name) ?? []).forEach((p, i) => {
        const wk = i % nSemanas;
        nuevos.push({ cargo: c.name, employee_id: p.id, persona: p.name, from_date: addDaysISO(from, wk * 7), to_date: addDaysISO(from, wk * 7 + 6), grupo: GRUPOS[wk], created_by: uid });
      });
    });
    const ids = personasShown.map((p) => p.id);
    // Reemplaza las semanas de rotación (grupo no nulo); conserva las de "otra fecha".
    if (ids.length) await supabase.from('dias_libres_cargo').delete().in('employee_id', ids).not('grupo', 'is', null);
    if (nuevos.length) await supabase.from('dias_libres_cargo').insert(nuevos);
    setBusy(false); load();
    setNotice('✅ Semanas libres repartidas por persona (sin juntar la misma semana en un cargo).');
  };

  const agregarDescanso = async () => {
    if (!descansoFor) return;
    if (dTo < dFrom) { setNotice('❌ La fecha "hasta" no puede ser menor que "desde".'); return; }
    setBusy(true);
    const { error } = await supabase.from('dias_libres_cargo').insert({
      cargo: descansoFor.cargo, employee_id: descansoFor.id, persona: descansoFor.name, from_date: dFrom, to_date: dTo, grupo: null, created_by: uid,
    });
    setBusy(false);
    if (error) { setNotice('❌ ' + error.message); return; }
    setDescansoFor(null); load();
  };
  const quitarShift = async (id: string) => {
    await supabase.from('dias_libres_cargo').delete().eq('id', id);
    load();
  };

  const generarPDF = async () => {
    if (personasShown.length === 0) { setNotice('❌ No hay personas que mostrar.'); return; }
    setBusy(true);
    try {
      // Cada PERSONA es una fila del reporte (reusa el PDF de guardias).
      const inspectors: GuardInspector[] = personasShown.map((p) => ({ name: p.name, grupo: grupoDePersona(p.id), cargo: p.cargo, cedula: p.cedula, telefono: null, sector: null }));
      const shownIds = new Set(personasShown.map((p) => p.id));
      const shiftsIn: GuardShift[] = shifts
        .filter((s) => s.employee_id && s.persona && shownIds.has(s.employee_id))
        .map((s) => ({ inspector_name: s.persona!, from_date: s.from_date, to_date: s.to_date, kind: 'descanso' }));
      const alcance = deptFiltro ? `Departamento: ${deptFiltro}` : cargoQuery.trim() ? `Cargo: ${cargoQuery.trim()}` : 'Todo el personal activo';
      await generateGuardiasReport({
        from, to, rotation: 'Semana libre por persona', inspectors, shifts: shiftsIn,
        title: 'DISTRIBUCIÓN DE DÍAS LIBRES',
        subtitle: `${alcance} · semana libre por persona · Ciclo ${dmy(from)} — ${dmy(to)}`,
        personLabel: 'Trabajador', personLabelPlural: 'Trabajadores', showCoverage: false,
      });
    } finally { setBusy(false); }
  };

  if (loading) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <SectionTitle>🗓️ Distribución de días libres (por persona)</SectionTitle>

      {/* Ciclo */}
      <Card>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Ciclo · desde</Text>
        <DateField value={from} onChange={setFrom} />
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Hasta</Text>
        <DateField value={to} onChange={setTo} />
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' }}>
          <TouchableOpacity onPress={repartirAuto} disabled={busy} style={{ flex: 1, minWidth: 150, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
            <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12.5 }}>✨ Repartir automático</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={generarPDF} disabled={busy} style={{ flex: 1, minWidth: 130, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
            <Text style={{ color: colors.accentContrast, fontWeight: '800', fontSize: 12.5 }}>📄 Generar PDF</Text>
          </TouchableOpacity>
        </View>
      </Card>

      {/* FILTRO por departamento o por cargo (no todo junto) */}
      <Card>
        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, marginBottom: spacing.xs }}>🔎 Filtrar</Text>
        {deptList.length > 0 ? (
          <>
            <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>Por departamento</Text>
            <TouchableOpacity
              onPress={() => setDeptOpen((v) => !v)}
              activeOpacity={0.8}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md }}
            >
              <Text style={{ color: deptFiltro ? colors.text : colors.muted, fontSize: 14, flex: 1 }} numberOfLines={1}>
                {deptFiltro || 'Todos los departamentos'}
              </Text>
              <Text style={{ color: colors.primary, fontWeight: '800' }}>{deptOpen ? '▲' : '▼'}</Text>
            </TouchableOpacity>
            {deptOpen ? (
              <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, marginTop: 4, overflow: 'hidden' }}>
                <TextInput
                  value={deptQuery}
                  onChangeText={setDeptQuery}
                  placeholder="🔎 Buscar departamento…"
                  placeholderTextColor={colors.muted}
                  style={{ backgroundColor: colors.surface, color: colors.text, fontSize: 14, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}
                />
                <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {['', ...deptList]
                    .filter((d) => (d === '' ? !deptQuery.trim() : norm(d).includes(norm(deptQuery))))
                    .map((d) => {
                      const on = deptFiltro === d;
                      return (
                        <TouchableOpacity
                          key={d || '__all'}
                          onPress={() => { setDeptFiltro(d); setDeptOpen(false); setDeptQuery(''); }}
                          style={{ paddingVertical: 10, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: on ? colors.surfaceAlt : colors.surface }}
                        >
                          <Text style={{ color: colors.text, fontSize: 14, fontWeight: on ? '800' : '400' }}>{on ? '✓ ' : ''}{d || 'Todos los departamentos'}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  {deptQuery.trim() && !deptList.some((d) => norm(d).includes(norm(deptQuery))) ? (
                    <View style={{ padding: spacing.md }}><Text style={{ color: colors.muted, fontSize: 13 }}>Sin departamentos que coincidan.</Text></View>
                  ) : null}
                </ScrollView>
              </View>
            ) : null}
            <View style={{ height: spacing.sm }} />
          </>
        ) : null}
        <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>Por cargo</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <TextInput
            value={cargoQuery}
            onChangeText={setCargoQuery}
            placeholder="Buscar cargo…"
            placeholderTextColor={colors.muted}
            style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, color: colors.text }}
          />
          {(cargoQuery || deptFiltro) ? (
            <TouchableOpacity onPress={() => { setCargoQuery(''); setDeptFiltro(''); }} style={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.sm }}>
              <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>Limpiar ✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <Text style={{ color: colors.muted, fontSize: 10.5, marginTop: 6 }}>
          Mostrando {personasShown.length} persona(s) en {cargos.length} cargo(s){deptFiltro ? ` · Depto: ${deptFiltro}` : ''}. El descanso se asigna por persona; el PDF sale de lo filtrado.
        </Text>
      </Card>

      {notice ? <Text style={{ color: notice.startsWith('✅') ? colors.success : colors.danger, fontWeight: '700', marginBottom: spacing.sm }}>{notice}</Text> : null}

      {/* MATRIZ Persona × Semana: filas = personas (agrupadas por cargo), columnas = semanas.
          Celda coloreada = semana libre de esa persona; se toca para asignar/cambiar/quitar. */}
      {personasShown.length === 0 ? (
        <EmptyState title="Sin personas" subtitle="No hay personal activo con cargo en la nómina, o el filtro no arroja a nadie." />
      ) : (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '900', fontSize: 14, marginBottom: 2 }}>📅 Calendario · Persona × Semana</Text>
          <Text style={{ color: colors.muted, fontSize: 10.5, marginBottom: spacing.xs }}>Toca una celda para marcar la semana libre; toca la marcada para quitarla. Toca el nombre para una fecha suelta.</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View style={{ flexDirection: 'row' }}>
              {/* Columna fija: nombres */}
              <View>
                <View style={{ height: HEADER_H, width: NAME_W, justifyContent: 'flex-end', paddingBottom: 4 }}>
                  <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '800' }}>Persona</Text>
                </View>
                {matrixRows.map((r, i) => r.kind === 'cargo' ? (
                  <View key={`cn${i}`} style={{ height: CARGO_H, width: NAME_W, justifyContent: 'center', backgroundColor: colors.surfaceAlt, paddingHorizontal: 4 }}>
                    <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '900' }} numberOfLines={1}>🏷️ {r.name} ({r.count})</Text>
                  </View>
                ) : (
                  <TouchableOpacity key={r.p.id} onPress={() => { setDescansoFor(r.p); setDFrom(from); setDTo(addDaysISO(from, 6)); }} style={{ height: PERSONA_H, width: NAME_W, justifyContent: 'center', paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
                    <Text style={{ color: colors.text, fontSize: 11.5, fontWeight: '600' }} numberOfLines={2}>👤 {r.p.name}</Text>
                  </TouchableOpacity>
                ))}
                <View style={{ height: FOOTER_H, width: NAME_W, justifyContent: 'center' }}>
                  <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '800' }}>Libres / semana</Text>
                </View>
              </View>
              {/* Semanas (una columna cada una) */}
              <View>
                <View style={{ flexDirection: 'row' }}>
                  {semanas.map((w) => (
                    <View key={w.idx} style={{ width: WEEK_W, height: HEADER_H, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 3, borderBottomWidth: 2.5, borderBottomColor: grupoColor(w.letra) }}>
                      <Text style={{ color: colors.text, fontSize: 9.5, fontWeight: '800' }}>{dmy(w.from)}</Text>
                      <Text style={{ color: colors.muted, fontSize: 9 }}>{dmy(w.to)}</Text>
                      <Text style={{ color: colors.muted, fontSize: 8.5 }}>Sem {w.idx + 1}</Text>
                    </View>
                  ))}
                </View>
                {matrixRows.map((r, i) => r.kind === 'cargo' ? (
                  <View key={`cc${i}`} style={{ flexDirection: 'row', height: CARGO_H, backgroundColor: colors.surfaceAlt }}>
                    {semanas.map((w) => <View key={w.idx} style={{ width: WEEK_W }} />)}
                  </View>
                ) : (
                  <View key={r.p.id} style={{ flexDirection: 'row', height: PERSONA_H }}>
                    {semanas.map((w) => {
                      const on = semanaIdxDePersona(r.p.id) === w.idx;
                      return (
                        <TouchableOpacity
                          key={w.idx}
                          disabled={busy}
                          onPress={() => (on ? quitarSemanaPersona(r.p) : asignarSemana(r.p, w.idx))}
                          style={{ width: WEEK_W, height: PERSONA_H, alignItems: 'center', justifyContent: 'center', borderWidth: 0.5, borderColor: colors.border, backgroundColor: on ? grupoColor(w.letra) : 'transparent', opacity: busy ? 0.7 : 1 }}
                        >
                          <Text style={{ color: on ? '#fff' : colors.border, fontSize: 9.5, fontWeight: '800' }}>{on ? 'LIBRE' : '·'}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))}
                <View style={{ flexDirection: 'row', height: FOOTER_H }}>
                  {semanas.map((w) => {
                    const n = ocupacion.get(w.letra) ?? 0;
                    return (
                      <View key={w.idx} style={{ width: WEEK_W, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: n > 0 ? colors.brandText : colors.muted, fontSize: 12, fontWeight: '900' }}>{n}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            </View>
          </ScrollView>
        </Card>
      )}
      <View style={{ height: spacing.xl }} />

      {/* Modal: semana libre en otra fecha (a una persona) */}
      <Modal visible={!!descansoFor} transparent animationType="slide" onRequestClose={() => setDescansoFor(null)}>
        <Pressable onPress={() => setDescansoFor(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15, marginBottom: 2 }}>🛌 Días libres · {descansoFor?.name}</Text>
            <Text style={{ color: colors.muted, fontSize: 11.5, marginBottom: spacing.sm }}>{descansoFor?.cargo}</Text>
            {/* Descansos actuales de esta persona (semana de rotación + fechas sueltas) */}
            {descansoFor ? (() => {
              const list = (shiftsByPerson.get(descansoFor.id) ?? []).slice().sort((a, b) => cmpText(a.from_date, b.from_date));
              return list.length ? (
                <View style={{ marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' }}>
                  {list.map((s) => (
                    <View key={s.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7, paddingHorizontal: spacing.sm, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
                      <Text style={{ color: colors.text, fontSize: 12.5 }}>{s.grupo ? '🔁' : '🗓️'} {dmy(s.from_date)} al {dmy(s.to_date)}</Text>
                      <TouchableOpacity onPress={() => quitarShift(s.id)}><Text style={{ color: colors.danger, fontSize: 11.5, fontWeight: '800' }}>Borrar</Text></TouchableOpacity>
                    </View>
                  ))}
                </View>
              ) : <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>Aún sin días libres.</Text>;
            })() : null}
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, marginBottom: 4 }}>➕ Agregar días libres (otra fecha)</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Desde</Text>
            <DateField value={dFrom} onChange={setDFrom} />
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Hasta</Text>
            <DateField value={dTo} onChange={setDTo} />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <TouchableOpacity onPress={() => setDescansoFor(null)} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={agregarDescanso} disabled={busy} style={{ flex: 2, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.accent, opacity: busy ? 0.6 : 1 }}>
                <Text style={{ color: colors.accentContrast, fontWeight: '800' }}>{busy ? 'Guardando…' : 'Guardar'}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}
