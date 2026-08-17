// Nómina → DISTRIBUCIÓN DE DÍAS LIBRES por TIPO DE CARGO.
// Misma idea que "Distribución de guardias" (Inspecciones) pero la unidad es el
// CARGO, no la persona: cada cargo tiene una SEMANA LIBRE dentro del ciclo,
// autogenerada (rotación) y editable. Toda la gente de ese cargo descansa esa
// semana. Los cargos salen EN VIVO del personal activo (employees.status='activo').
// Datos en la tabla `dias_libres_cargo` (ver supabase/dias_libres_cargo.sql).
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, ScrollView, TextInput } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useConfirm } from '../components/ConfirmProvider';
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
const DOW = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const dowOf = (iso: string) => DOW[new Date(iso + 'T00:00:00Z').getUTCDay()];
const ddOf = (iso: string) => iso.slice(-2);
const dmy = (iso: string) => { const [y, m, d] = (iso || '').split('-'); return y && m && d ? `${d}/${m}` : iso; };

type Cargo = { name: string; count: number; departments: string[] };
type Shift = { id: string; cargo: string; from_date: string; to_date: string; grupo: string | null };

export default function DiasLibresCargoScreen() {
  const { colors } = useTheme();
  const confirm = useConfirm();
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;

  const today = caracasTodayISO();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDaysISO(today, 27)); // 4 semanas por defecto
  const [cargosAll, setCargosAll] = useState<Cargo[]>([]);
  const [deptList, setDeptList] = useState<string[]>([]);
  const [deptFiltro, setDeptFiltro] = useState<string>(''); // '' = todos los departamentos
  const [cargoQuery, setCargoQuery] = useState('');
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [semanaOpen, setSemanaOpen] = useState(false);       // armar semana libre por cargo
  const [semanaSel, setSemanaSel] = useState<Record<string, string>>({}); // cargo → letra de semana
  const [descansoFor, setDescansoFor] = useState<string | null>(null);    // agregar descanso manual a un cargo
  const [dFrom, setDFrom] = useState(today);
  const [dTo, setDTo] = useState(addDaysISO(today, 6));

  // Cargos MOSTRADOS = todos filtrados por departamento y por búsqueda de cargo. Todo lo
  // de abajo (calendario, lista, PDF, rotación) trabaja sobre esta lista filtrada — así la
  // semana libre se puede armar por departamento o por cargo, no todo junto.
  const cargos = useMemo(
    () =>
      cargosAll.filter(
        (c) =>
          (!deptFiltro || c.departments.includes(deptFiltro)) &&
          (!cargoQuery.trim() || norm(c.name).includes(norm(cargoQuery)))
      ),
    [cargosAll, deptFiltro, cargoQuery]
  );

  // Una SEMANA por cargo (rotación): tantas semanas como cargos haya.
  const nSemanas = Math.max(1, cargos.length);
  const GRUPOS = useMemo(() => Array.from({ length: nSemanas }, (_, i) => String.fromCharCode(65 + i)), [nSemanas]);

  const load = async () => {
    setLoading(true);
    const [emp, sh] = await Promise.all([
      supabase.from('employees').select('cargo, department, status'),
      supabase.from('dias_libres_cargo').select('id, cargo, from_date, to_date, grupo'),
    ]);
    // Cargos EN VIVO del personal ACTIVO (con su conteo de personas y su(s) departamento(s)).
    const counts = new Map<string, number>();
    const depts = new Map<string, Set<string>>();
    const deptSet = new Set<string>();
    ((emp.data ?? []) as any[]).forEach((e) => {
      if ((e.status || '').toLowerCase() !== 'activo') return;
      const c = String(e.cargo ?? '').trim();
      if (!c) return;
      counts.set(c, (counts.get(c) ?? 0) + 1);
      const d = String(e.department ?? '').trim();
      if (d) {
        if (!depts.has(c)) depts.set(c, new Set());
        depts.get(c)!.add(d);
        deptSet.add(d);
      }
    });
    const list: Cargo[] = [...counts.entries()]
      .map(([name, count]) => ({ name, count, departments: [...(depts.get(name) ?? [])] }))
      .sort((a, b) => cmpText(a.name, b.name));
    setCargosAll(list);
    setDeptList([...deptSet].sort((a, b) => cmpText(a, b)));
    setShifts((sh.data ?? []) as Shift[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  // Realtime: un descanso asignado desde otro dispositivo aparece sin recargar.
  useRealtimeRefresh(['dias_libres_cargo', 'employees'], () => { load(); });

  const days = useMemo(() => daysBetween(from, to), [from, to]);
  const shiftsByCargo = useMemo(() => {
    const map = new Map<string, Shift[]>();
    shifts.forEach((sh) => { const l = map.get(sh.cargo) ?? []; l.push(sh); map.set(sh.cargo, l); });
    return map;
  }, [shifts]);
  // 'L' si el día cae en la semana libre de ese cargo; si no, 'T' (trabaja).
  const estadoDe = (cargo: string, day: string): 'L' | 'T' => {
    const list = shiftsByCargo.get(cargo) ?? [];
    for (const sh of list) if (sh.from_date <= day && day <= sh.to_date) return 'L';
    return 'T';
  };
  const libreCount = (day: string) => cargos.reduce((n, c) => n + (estadoDe(c.name, day) === 'L' ? 1 : 0), 0);
  // Semana (grupo) actual asignada a un cargo (de su shift más reciente).
  const grupoDe = (cargo: string): string | null => {
    const list = (shiftsByCargo.get(cargo) ?? []).slice().sort((a, b) => cmpText(b.from_date, a.from_date));
    return list[0]?.grupo ?? null;
  };

  // Sugerencia AUTOMÁTICA: cada cargo a una semana distinta, en orden (A, B, C…).
  const computeAutoSemanas = (): Record<string, string> => {
    const out: Record<string, string> = {};
    cargos.forEach((c, i) => { out[c.name] = GRUPOS[i % GRUPOS.length]; });
    return out;
  };

  const abrirSemana = () => {
    if (cargos.length === 0) { setNotice('❌ No hay cargos con personal activo en la nómina.'); return; }
    const init: Record<string, string> = {};
    let alguno = false;
    cargos.forEach((c) => { const g = grupoDe(c.name); if (g && GRUPOS.includes(g)) { init[c.name] = g; alguno = true; } });
    setSemanaSel(alguno ? init : computeAutoSemanas());
    setNotice(null);
    setSemanaOpen(true);
  };

  // GENERA la rotación de semana libre: cada cargo descansa la semana que se le
  // asignó (A = semana 1, B = semana 2…) desde el inicio del ciclo. Reemplaza lo previo.
  const generarSemanas = async () => {
    const faltan = cargos.filter((c) => !semanaSel[c.name]);
    if (faltan.length) { setNotice(`❌ Falta asignar semana a ${faltan.length} cargo(s).`); return; }
    setBusy(true); setNotice(null);
    const semanaDe: Record<string, number> = {}; GRUPOS.forEach((l, i) => { semanaDe[l] = i; });
    const cycleStart = from;
    const nuevos: any[] = [];
    let maxWk = 0;
    for (const c of cargos) {
      const letra = semanaSel[c.name];
      const wk = semanaDe[letra] ?? 0;
      maxWk = Math.max(maxWk, wk);
      nuevos.push({ cargo: c.name, from_date: addDaysISO(cycleStart, wk * 7), to_date: addDaysISO(cycleStart, wk * 7 + 6), grupo: letra, created_by: uid });
    }
    await supabase.from('dias_libres_cargo').delete().in('cargo', cargos.map((c) => c.name));
    if (nuevos.length) await supabase.from('dias_libres_cargo').insert(nuevos);
    setTo(addDaysISO(cycleStart, (maxWk + 1) * 7 - 1));
    setBusy(false); setSemanaOpen(false); load();
    setNotice('✅ Semana libre por cargo generada.');
  };

  const agregarDescanso = async () => {
    if (!descansoFor) return;
    if (dTo < dFrom) { setNotice('❌ La fecha "hasta" no puede ser menor que "desde".'); return; }
    setBusy(true);
    const { error } = await supabase.from('dias_libres_cargo').insert({
      cargo: descansoFor, from_date: dFrom, to_date: dTo, grupo: grupoDe(descansoFor), created_by: uid,
    });
    setBusy(false);
    if (error) { setNotice('❌ ' + error.message); return; }
    setDescansoFor(null); load();
  };
  const quitarShift = async (id: string) => {
    await supabase.from('dias_libres_cargo').delete().eq('id', id);
    load();
  };
  const limpiarCargo = async (cargo: string) => {
    const ok = await confirm({ title: 'Quitar días libres', message: `¿Borrar la semana libre de "${cargo}"?`, confirmText: 'Quitar', danger: true });
    if (!ok) return;
    await supabase.from('dias_libres_cargo').delete().eq('cargo', cargo);
    load();
  };

  const generarPDF = async () => {
    if (cargos.length === 0) { setNotice('❌ No hay cargos que mostrar.'); return; }
    setBusy(true);
    try {
      // Se reusa el reporte de guardias mapeando cada CARGO como una "fila" (name=cargo).
      const inspectors: GuardInspector[] = cargos.map((c) => ({ name: c.name, grupo: grupoDe(c.name), cargo: `${c.count} persona(s)`, cedula: null, telefono: null, sector: null }));
      const shiftsIn: GuardShift[] = shifts.map((s) => ({ inspector_name: s.cargo, from_date: s.from_date, to_date: s.to_date, kind: 'descanso' }));
      const alcance = deptFiltro ? `Departamento: ${deptFiltro}` : cargoQuery.trim() ? `Cargo: ${cargoQuery.trim()}` : 'Todos los cargos';
      await generateGuardiasReport({
        from, to, rotation: 'Semana libre por cargo', inspectors, shifts: shiftsIn,
        title: 'DISTRIBUCIÓN DE DÍAS LIBRES POR CARGO',
        subtitle: `${alcance} · semana libre rotativa · Ciclo ${dmy(from)} — ${dmy(to)}`,
      });
    } finally { setBusy(false); }
  };

  if (loading) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <SectionTitle>🗓️ Distribución de días libres (por cargo)</SectionTitle>

      {/* Ciclo */}
      <Card>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Ciclo · desde</Text>
        <DateField value={from} onChange={setFrom} />
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Hasta</Text>
        <DateField value={to} onChange={setTo} />
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' }}>
          <TouchableOpacity onPress={abrirSemana} disabled={busy} style={{ flex: 1, minWidth: 150, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
            <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12.5 }}>⚙️ Semana libre por cargo</Text>
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
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {['', ...deptList].map((d) => {
                  const on = deptFiltro === d;
                  return (
                    <TouchableOpacity key={d || '__all'} onPress={() => setDeptFiltro(d)} style={{ paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: on ? colors.brand : colors.surfaceAlt, borderWidth: 1, borderColor: on ? colors.brand : colors.border }}>
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{d || 'Todos'}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
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
          Mostrando {cargos.length} de {cargosAll.length} cargo(s){deptFiltro ? ` · Depto: ${deptFiltro}` : ''}. La semana libre y el PDF se generan solo sobre lo filtrado.
        </Text>
      </Card>

      {notice ? <Text style={{ color: notice.startsWith('✅') ? colors.success : colors.danger, fontWeight: '700', marginBottom: spacing.sm }}>{notice}</Text> : null}

      {/* Calendario cargo × día */}
      {cargos.length > 0 ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, marginBottom: spacing.xs }}>Calendario del ciclo</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View>
              <View style={{ flexDirection: 'row' }}>
                <View style={{ width: 130 }}><Text style={{ color: colors.muted, fontSize: 10, fontWeight: '800' }}>Cargo</Text></View>
                {days.map((d) => (
                  <View key={d} style={{ width: 22, alignItems: 'center' }}>
                    <Text style={{ color: colors.text, fontSize: 9, fontWeight: '800' }}>{ddOf(d)}</Text>
                    <Text style={{ color: dowOf(d) === 'S' || dowOf(d) === 'D' ? colors.danger : colors.muted, fontSize: 8 }}>{dowOf(d)}</Text>
                  </View>
                ))}
              </View>
              {cargos.map((c) => {
                const g = grupoDe(c.name);
                return (
                  <View key={c.name} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                    <View style={{ width: 130, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                      <View style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: g ? grupoColor(g) : colors.border, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: '#fff', fontSize: 8, fontWeight: '900' }}>{g || '·'}</Text>
                      </View>
                      <Text style={{ color: colors.text, fontSize: 9.5, fontWeight: '700', flex: 1 }} numberOfLines={1}>{c.name}</Text>
                    </View>
                    {days.map((d) => {
                      const st = estadoDe(c.name, d);
                      return (
                        <View key={d} style={{ width: 22, height: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: st === 'L' ? grupoColor(g) + '55' : 'transparent', borderWidth: 0.5, borderColor: colors.border }}>
                          <Text style={{ color: st === 'L' ? colors.text : colors.muted, fontSize: 9, fontWeight: st === 'L' ? '800' : '400' }}>{st}</Text>
                        </View>
                      );
                    })}
                  </View>
                );
              })}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                <View style={{ width: 130 }}><Text style={{ color: colors.muted, fontSize: 9, fontWeight: '800' }}>Cargos libres</Text></View>
                {days.map((d) => (
                  <View key={d} style={{ width: 22, alignItems: 'center' }}><Text style={{ color: colors.text, fontSize: 9, fontWeight: '700' }}>{libreCount(d)}</Text></View>
                ))}
              </View>
            </View>
          </ScrollView>
          <Text style={{ color: colors.muted, fontSize: 10, marginTop: spacing.xs }}>L = semana libre · T = trabaja. Color = semana asignada.</Text>
        </Card>
      ) : null}

      {/* Lista de cargos */}
      <Text style={{ color: colors.text, fontWeight: '900', fontSize: 14, marginTop: spacing.sm, marginBottom: spacing.xs }}>🏷️ Cargos ({cargos.length})</Text>

      {cargos.length === 0 ? (
        <EmptyState title="Sin cargos" subtitle="No hay personal activo con cargo en la nómina. Agrega empleados (con su cargo) en Empleados." />
      ) : cargos.map((c) => {
        const desc = (shiftsByCargo.get(c.name) ?? []).slice().sort((a, b) => cmpText(a.from_date, b.from_date));
        return (
          <Card key={c.name}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, flex: 1 }} numberOfLines={1}>🏷️ {c.name}</Text>
              <Text style={{ color: colors.muted, fontSize: 11.5, marginRight: spacing.sm }}>{c.count} persona(s)</Text>
              {desc.length ? <TouchableOpacity onPress={() => limpiarCargo(c.name)}><Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>Limpiar ✕</Text></TouchableOpacity> : null}
            </View>
            <View style={{ marginTop: spacing.xs }}>
              {desc.length === 0 ? <Text style={{ color: colors.muted, fontSize: 11.5 }}>Sin semana libre definida.</Text> : desc.map((s) => (
                <View key={s.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 }}>
                  <Text style={{ color: colors.text, fontSize: 12 }}>🛌 Libre: {dmy(s.from_date)} al {dmy(s.to_date)}</Text>
                  <TouchableOpacity onPress={() => quitarShift(s.id)}><Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700' }}>Borrar</Text></TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity onPress={() => { setDescansoFor(c.name); setDFrom(from); setDTo(addDaysISO(from, 6)); }} style={{ marginTop: 4, alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 11.5 }}>➕ Agregar semana libre</Text>
              </TouchableOpacity>
            </View>
          </Card>
        );
      })}
      <View style={{ height: spacing.xl }} />

      {/* Modal: ARMAR SEMANA LIBRE por cargo */}
      <Modal visible={semanaOpen} transparent animationType="slide" onRequestClose={() => setSemanaOpen(false)}>
        <Pressable onPress={() => setSemanaOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '88%', padding: spacing.lg }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15, marginBottom: 2 }}>⚙️ Semana libre por cargo</Text>
            <Text style={{ color: colors.muted, fontSize: 11.5, marginBottom: spacing.sm }}>
              Asigna a cada cargo la semana en que descansa (A = semana 1, B = semana 2…), desde {dmy(from)}. Toda la gente de ese cargo descansa esa semana. Al generar se reemplazan las semanas libres actuales.
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginBottom: spacing.sm }}>
              <TouchableOpacity onPress={() => setSemanaSel(computeAutoSemanas())} style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 5 }}>
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 11.5 }}>✨ Sugerir automático</Text>
              </TouchableOpacity>
            </View>
            {notice && semanaOpen ? <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12, marginBottom: spacing.xs }}>{notice}</Text> : null}
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 400 }}>
              {cargos.map((c) => (
                <View key={c.name} style={{ paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>{c.name} <Text style={{ color: colors.muted, fontWeight: '400', fontSize: 11 }}>· {c.count} persona(s)</Text></Text>
                  <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', marginTop: 5 }}>
                    {GRUPOS.map((g, i) => {
                      const on = semanaSel[c.name] === g;
                      return (
                        <TouchableOpacity key={g} onPress={() => setSemanaSel((prev) => ({ ...prev, [c.name]: g }))} style={{ minWidth: 44, paddingHorizontal: 6, height: 30, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? grupoColor(g) : colors.surfaceAlt, borderWidth: 1.5, borderColor: on ? grupoColor(g) : colors.border }}>
                          <Text style={{ color: on ? '#fff' : colors.muted, fontWeight: '900', fontSize: 11 }}>Sem {i + 1}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <TouchableOpacity onPress={() => setSemanaOpen(false)} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={generarSemanas} disabled={busy} style={{ flex: 2, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.brand, opacity: busy ? 0.6 : 1 }}>
                <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{busy ? 'Generando…' : '⚙️ Generar semana libre'}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Modal: agregar semana libre manual a un cargo */}
      <Modal visible={!!descansoFor} transparent animationType="slide" onRequestClose={() => setDescansoFor(null)}>
        <Pressable onPress={() => setDescansoFor(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15, marginBottom: spacing.sm }}>🛌 Semana libre · {descansoFor}</Text>
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
