// Distribución de guardias (submenú de Inspecciones): asigna a cada inspector su
// rango de descanso dentro de un ciclo, MANUAL o AUTOGENERANDO una rotación 14x7 por
// grupos (nunca descansan a la vez dos coordinadores ni dos nocturnos), o el modo
// "1 día libre/semana" (cada inspector descansa UN día fijo por semana y el resto
// de la semana trabaja — a diferencia del modo por grupos, aquí nadie deja de
// trabajar la semana completa). Muestra el calendario inspector×día (T/D) y genera
// el PDF (ver src/lib/guardiasReport.ts).
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, ScrollView, TextInput } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useConfirm } from '../components/ConfirmProvider';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { cmpText } from '../lib/text';
import { DateField } from '../components/DateField';
import { generateGuardiasReport, GuardInspector, GuardShift } from '../lib/guardiasReport';
import { useRealtimeRefresh } from '../hooks/useRealtime';

const CARGOS = ['Coordinador', 'Nocturno', 'Inspector'];
// Paleta de colores por grupo (soporta cualquier cantidad de grupos, no solo A/B/C).
const GRUPO_PALETTE = ['#9AA3AB', '#4BB477', '#E0A040', '#5B8DEF', '#C77DD6', '#E0655B', '#3FBFB0', '#B0894A', '#8A7BE0', '#6AA84F', '#D98CA0', '#7F9CB5'];
const grupoColor = (g: string | null | undefined): string => {
  const i = g ? g.charCodeAt(0) - 65 : -1; // 'A'->0, 'B'->1, …
  return i >= 0 ? GRUPO_PALETTE[i % GRUPO_PALETTE.length] : '#9AA3AB';
};

// Modo "1 día libre/semana": cada inspector tiene un día fijo de la semana como
// descanso (se repite cada semana del ciclo), en vez de un grupo que descansa la
// semana completa.
const DIAS_SEMANA = [
  { code: 'Lu', label: 'Lunes', dow: 1 },
  { code: 'Ma', label: 'Martes', dow: 2 },
  { code: 'Mi', label: 'Miércoles', dow: 3 },
  { code: 'Ju', label: 'Jueves', dow: 4 },
  { code: 'Vi', label: 'Viernes', dow: 5 },
  { code: 'Sa', label: 'Sábado', dow: 6 },
  { code: 'Do', label: 'Domingo', dow: 0 },
] as const;
const DIA_CODES = DIAS_SEMANA.map((d) => d.code) as string[];
const dowOfCode = (code: string) => DIAS_SEMANA.find((d) => d.code === code)?.dow ?? 1;
const DIA_COLOR: Record<string, string> = { Lu: '#4BB477', Ma: '#5B8DEF', Mi: '#E0A040', Ju: '#C77DD6', Vi: '#3FBFB0', Sa: '#E0655B', Do: '#8A7BE0' };
const diaColor = (d: string | null | undefined): string => (d && DIA_COLOR[d]) || '#9AA3AB';
/** Color de la insignia "grupo": si es un código de día (modo semanal) usa diaColor,
 *  si es una letra de grupo (modo por semana completa) usa grupoColor. */
const badgeColorOf = (g: string | null | undefined): string => (g && DIA_CODES.includes(g)) ? diaColor(g) : grupoColor(g);
/** Orden de fila para que los que descansan el MISMO día queden juntos (efecto
 *  "escalera" Lu→Do en el calendario) en vez del orden alfabético (Do, Ju, Lu…).
 *  Las letras de grupo del modo 14x7 (A, B, C…) mantienen su orden alfabético. */
const grupoRank = (g: string | null | undefined): number => {
  if (!g) return 999;
  const i = DIA_CODES.indexOf(g);
  return i >= 0 ? i : 500 + g.charCodeAt(0);
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

type Meta = { id: string; inspector_id: string | null; inspector_name: string; cedula: string | null; telefono: string | null; sector: string | null; cargo: string | null; grupo: string | null };
type Shift = { id: string; inspector_name: string; from_date: string; to_date: string; kind: string; grupo: string | null };
type Prof = { id: string; full_name: string; cedula: string | null };

export default function DistribucionGuardiasScreen() {
  const { colors } = useTheme();
  const confirm = useConfirm();
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;

  const today = caracasTodayISO();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDaysISO(today, 20)); // 21 días (ciclo 14x7)
  const [metas, setMetas] = useState<Meta[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [profs, setProfs] = useState<Prof[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);         // agregar inspector
  const [descansoFor, setDescansoFor] = useState<Meta | null>(null); // agregar descanso a inspector
  const [dFrom, setDFrom] = useState(today);
  const [dTo, setDTo] = useState(addDaysISO(today, 6));
  const [grupoOpen, setGrupoOpen] = useState(false);     // armar grupos 14x7 a mano
  const [grupoSel, setGrupoSel] = useState<Record<string, string>>({}); // metaId → grupo ('A','B','C',…)
  const [diaOpen, setDiaOpen] = useState(false);         // armar "1 día libre/semana" a mano
  const [diaSel, setDiaSel] = useState<Record<string, string>>({}); // metaId → código de día ('Lu','Ma',…)

  // Grupos DINÁMICOS: tantos como hagan falta para ~2 inspectores por grupo (mínimo 3).
  // Antes estaba fijo en A/B/C (3 grupos), y con más inspectores quedaban afuera.
  const nGroups = Math.max(3, Math.ceil(metas.length / 2));
  const GRUPOS = useMemo(() => Array.from({ length: nGroups }, (_, i) => String.fromCharCode(65 + i)), [nGroups]);

  const load = async () => {
    setLoading(true);
    const [m, s, p] = await Promise.all([
      supabase.from('guard_inspector_meta').select('id, inspector_id, inspector_name, cedula, telefono, sector, cargo, grupo'),
      supabase.from('guard_shifts').select('id, inspector_name, from_date, to_date, kind, grupo'),
      supabase.from('profiles').select('id, full_name, cedula, role').in('role', ['supervisor', 'coordinador_patio']),
    ]);
    setMetas(((m.data ?? []) as any[]).sort((a, b) => grupoRank(a.grupo) - grupoRank(b.grupo) || cmpText(a.inspector_name, b.inspector_name)));
    setShifts((s.data ?? []) as any);
    setProfs(((p.data ?? []) as any[]).map((x) => ({ id: x.id, full_name: x.full_name || '—', cedula: x.cedula ?? null })));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  // Sin esto, un descanso/grupo asignado desde otro dispositivo no aparecía hasta
  // recargar — riesgo de que dos inspectores del mismo grupo quedaran "descansando"
  // el mismo día por estar viendo datos viejos.
  useRealtimeRefresh(['guard_inspector_meta', 'guard_shifts'], () => { load(); });

  const days = useMemo(() => daysBetween(from, to), [from, to]);
  const shiftsByName = useMemo(() => {
    const map = new Map<string, Shift[]>();
    shifts.forEach((sh) => { const l = map.get(sh.inspector_name) ?? []; l.push(sh); map.set(sh.inspector_name, l); });
    return map;
  }, [shifts]);
  // 'D' si el día cae en un descanso de ese inspector; si no, 'T'.
  const estadoDe = (name: string, day: string): 'D' | 'T' => {
    const list = shiftsByName.get(name) ?? [];
    for (const sh of list) if (sh.kind === 'descanso' && sh.from_date <= day && day <= sh.to_date) return 'D';
    return 'T';
  };
  const descansoCount = (day: string) => metas.reduce((n, m) => n + (estadoDe(m.inspector_name, day) === 'D' ? 1 : 0), 0);
  // Conflicto: dos COORDINADORES en descanso el mismo día.
  const conflicto = useMemo(() => {
    for (const day of days) {
      const coords = metas.filter((m) => (m.cargo || '') === 'Coordinador' && estadoDe(m.inspector_name, day) === 'D');
      if (coords.length >= 2) return { day, coords: coords.map((c) => c.inspector_name) };
    }
    return null;
  }, [days, metas, shiftsByName]);

  const disponibles = useMemo(() => {
    const usados = new Set(metas.map((m) => (m.inspector_name || '').toLowerCase()));
    return profs.filter((p) => !usados.has((p.full_name || '').toLowerCase())).sort((a, b) => cmpText(a.full_name, b.full_name));
  }, [profs, metas]);

  const agregarInspector = async (p: Prof) => {
    setBusy(true); setNotice(null);
    const { error } = await supabase.from('guard_inspector_meta').insert({
      inspector_id: p.id, inspector_name: p.full_name, cedula: p.cedula, cargo: 'Inspector', updated_by: uid,
    });
    setBusy(false);
    if (error) { setNotice('❌ ' + error.message); return; }
    setAddOpen(false); load();
  };
  const patchMeta = async (m: Meta, patch: Partial<Meta>) => {
    setMetas((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...patch } : x))); // optimista
    await supabase.from('guard_inspector_meta').update({ ...patch, updated_by: uid, updated_at: new Date().toISOString() }).eq('id', m.id);
  };
  const quitarInspector = async (m: Meta) => {
    const ok = await confirm({ title: 'Quitar inspector', message: `¿Quitar a ${m.inspector_name} de la distribución? (se borran también sus guardias)`, confirmText: 'Quitar', danger: true });
    if (!ok) return;
    await supabase.from('guard_shifts').delete().eq('inspector_name', m.inspector_name);
    await supabase.from('guard_inspector_meta').delete().eq('id', m.id);
    load();
  };
  const agregarDescanso = async () => {
    if (!descansoFor) return;
    if (dTo < dFrom) { setNotice('❌ La fecha "hasta" no puede ser menor que "desde".'); return; }
    setBusy(true);
    const { error } = await supabase.from('guard_shifts').insert({
      inspector_id: descansoFor.inspector_id, inspector_name: descansoFor.inspector_name,
      from_date: dFrom, to_date: dTo, kind: 'descanso', grupo: descansoFor.grupo, created_by: uid,
    });
    setBusy(false);
    if (error) { setNotice('❌ ' + error.message); return; }
    setDescansoFor(null); load();
  };
  const quitarShift = async (sh: Shift) => {
    await supabase.from('guard_shifts').delete().eq('id', sh.id);
    load();
  };

  // Sugerencia AUTOMÁTICA de grupos (round-robin por categoría): coordinadores,
  // nocturnos y resto se reparten en A/B/C para que NO coincidan dos coordinadores
  // (ni dos nocturnos) en la misma semana de descanso. Devuelve metaId → 'A'|'B'|'C'.
  const computeAutoGroups = (): Record<string, string> => {
    const letra = GRUPOS;
    const cat = (m: Meta) => (m.cargo === 'Coordinador' ? 0 : m.cargo === 'Nocturno' ? 1 : 2);
    const orden = [...metas].sort((a, b) => cat(a) - cat(b) || cmpText(a.inspector_name, b.inspector_name));
    const counters = [0, 0, 0];
    const out: Record<string, string> = {};
    orden.forEach((m) => { const c = cat(m); const g = counters[c] % nGroups; counters[c]++; out[m.id] = letra[g]; });
    return out;
  };

  // AUTOGENERAR 14x7: abre el modal para ARMAR LOS GRUPOS A MANO. Precarga con los
  // grupos ya asignados (si hay) o con la sugerencia automática, y desde el modal se
  // ajusta y se genera la rotación.
  const abrirGrupos = () => {
    if (metas.length === 0) { setNotice('❌ Primero agrega inspectores.'); return; }
    const init: Record<string, string> = {};
    let alguno = false;
    metas.forEach((m) => { if (m.grupo && GRUPOS.includes(m.grupo)) { init[m.id] = m.grupo; alguno = true; } });
    setGrupoSel(alguno ? init : computeAutoGroups());
    setNotice(null);
    setGrupoOpen(true);
  };

  // GENERAR la rotación 14x7 a partir de los grupos elegidos a mano (grupoSel).
  // Cada grupo descansa una semana: A = semana 1, B = semana 2, C = semana 3 (desde
  // el inicio del ciclo). Borra las guardias previas y crea las nuevas.
  const generarRotacion = async () => {
    const faltan = metas.filter((m) => !grupoSel[m.id]);
    if (faltan.length) { setNotice(`❌ Falta asignar grupo a ${faltan.length} inspector(es).`); return; }
    setBusy(true); setNotice(null);
    const semanaDe: Record<string, number> = {}; GRUPOS.forEach((l, i) => { semanaDe[l] = i; });
    const cycleStart = from;
    const nuevosShifts: any[] = [];
    for (const m of metas) {
      const letra = grupoSel[m.id];
      await supabase.from('guard_inspector_meta').update({ grupo: letra, updated_by: uid }).eq('id', m.id);
      const wk = semanaDe[letra] ?? 0;
      const dFromG = addDaysISO(cycleStart, wk * 7);
      const dToG = addDaysISO(cycleStart, wk * 7 + 6);
      nuevosShifts.push({ inspector_id: m.inspector_id, inspector_name: m.inspector_name, from_date: dFromG, to_date: dToG, kind: 'descanso', grupo: letra, created_by: uid });
    }
    await supabase.from('guard_shifts').delete().in('inspector_name', metas.map((m) => m.inspector_name));
    if (nuevosShifts.length) await supabase.from('guard_shifts').insert(nuevosShifts);
    setTo(addDaysISO(cycleStart, nGroups * 7 - 1));
    setBusy(false); setGrupoOpen(false); load();
    setNotice('✅ Rotación 14x7 generada.');
  };

  // Sugerencia AUTOMÁTICA del modo "1 día libre/semana" (round-robin por categoría,
  // igual criterio que los grupos: nunca dos coordinadores ni dos nocturnos el mismo
  // día). Devuelve metaId → código de día ('Lu'..'Do').
  const computeAutoDias = (): Record<string, string> => {
    const cat = (m: Meta) => (m.cargo === 'Coordinador' ? 0 : m.cargo === 'Nocturno' ? 1 : 2);
    const orden = [...metas].sort((a, b) => cat(a) - cat(b) || cmpText(a.inspector_name, b.inspector_name));
    const counters = [0, 0, 0];
    const out: Record<string, string> = {};
    orden.forEach((m) => { const c = cat(m); const d = DIA_CODES[counters[c] % DIA_CODES.length]; counters[c]++; out[m.id] = d; });
    return out;
  };

  // AUTOGENERAR "1 día libre/semana": abre el modal para asignar a mano el día de
  // descanso fijo de cada inspector.
  const abrirDias = () => {
    if (metas.length === 0) { setNotice('❌ Primero agrega inspectores.'); return; }
    const init: Record<string, string> = {};
    let alguno = false;
    metas.forEach((m) => { if (m.grupo && DIA_CODES.includes(m.grupo)) { init[m.id] = m.grupo; alguno = true; } });
    setDiaSel(alguno ? init : computeAutoDias());
    setNotice(null);
    setDiaOpen(true);
  };

  // GENERA el modo "1 día libre/semana": cada inspector descansa SOLO su día fijo,
  // repetido cada semana, dentro del rango [from, to] QUE EL USUARIO ELIGIÓ en la
  // tarjeta "Ciclo" (antes se forzaba a 4 semanas fijas desde el inicio, ignorando
  // el "Hasta" elegido — generaba días de descanso más allá del rango pedido). A
  // diferencia del 14x7, nadie deja de trabajar la semana completa.
  // Borra las guardias previas y crea las nuevas.
  const generarRotacionSemanal = async () => {
    const faltan = metas.filter((m) => !diaSel[m.id]);
    if (faltan.length) { setNotice(`❌ Falta asignar día libre a ${faltan.length} inspector(es).`); return; }
    if (to < from) { setNotice('❌ "Hasta" no puede ser menor que "Desde".'); return; }
    setBusy(true); setNotice(null);
    const rango = daysBetween(from, to);
    const nuevosShifts: any[] = [];
    for (const m of metas) {
      const code = diaSel[m.id];
      await supabase.from('guard_inspector_meta').update({ grupo: code, updated_by: uid }).eq('id', m.id);
      const dow = dowOfCode(code);
      rango.forEach((day) => {
        if (new Date(day + 'T00:00:00Z').getUTCDay() === dow) {
          nuevosShifts.push({ inspector_id: m.inspector_id, inspector_name: m.inspector_name, from_date: day, to_date: day, kind: 'descanso', grupo: code, created_by: uid });
        }
      });
    }
    await supabase.from('guard_shifts').delete().in('inspector_name', metas.map((m) => m.inspector_name));
    if (nuevosShifts.length) await supabase.from('guard_shifts').insert(nuevosShifts);
    setBusy(false); setDiaOpen(false); load();
    setNotice('✅ Turno de 1 día libre por semana generado.');
  };

  const generarPDF = async () => {
    if (metas.length === 0) { setNotice('❌ Agrega inspectores primero.'); return; }
    setBusy(true);
    try {
      const inspectors: GuardInspector[] = metas.map((m) => ({ name: m.inspector_name, grupo: m.grupo, cargo: m.cargo, cedula: m.cedula, telefono: m.telefono, sector: m.sector }));
      const shiftsIn: GuardShift[] = shifts.map((s) => ({ inspector_name: s.inspector_name, from_date: s.from_date, to_date: s.to_date, kind: (s.kind === 'turno' ? 'turno' : 'descanso') }));
      // Detecta el modo por la duración de los descansos: 1 día = "1 día libre/semana",
      // 7 días = 14x7 (grupo completo descansa la semana), mixto = editado a mano.
      const largos = shifts.filter((s) => s.kind === 'descanso').map((s) => daysBetween(s.from_date, s.to_date).length);
      const rotation = largos.length === 0 ? undefined
        : largos.every((n) => n === 1) ? '6x1 (1 día libre/semana)'
        : largos.every((n) => n === 7) ? '14x7'
        : 'Personalizada';
      await generateGuardiasReport({ from, to, rotation, inspectors, shifts: shiftsIn });
    } finally { setBusy(false); }
  };

  if (loading) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <SectionTitle>🗓️ Distribución de guardias</SectionTitle>

      {/* Ciclo */}
      <Card>
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Ciclo · desde</Text>
        <DateField value={from} onChange={setFrom} />
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Hasta</Text>
        <DateField value={to} onChange={setTo} />
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' }}>
          <TouchableOpacity onPress={abrirGrupos} disabled={busy} style={{ flex: 1, minWidth: 130, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
            <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12.5 }}>⚙️ Grupo x semana</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={abrirDias} disabled={busy} style={{ flex: 1, minWidth: 130, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12.5 }}>📅 1 libre/semana</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={generarPDF} disabled={busy} style={{ flex: 1, minWidth: 130, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
            <Text style={{ color: colors.accentContrast, fontWeight: '800', fontSize: 12.5 }}>📄 Generar PDF</Text>
          </TouchableOpacity>
        </View>
      </Card>

      {notice ? <Text style={{ color: notice.startsWith('✅') ? colors.success : colors.danger, fontWeight: '700', marginBottom: spacing.sm }}>{notice}</Text> : null}

      {conflicto ? (
        <View style={{ backgroundColor: colors.dangerSoftBg, borderWidth: 1, borderColor: colors.dangerSoftBorder, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm }}>
          <Text style={{ color: colors.dangerSoftText, fontWeight: '800', fontSize: 12.5 }}>⚠️ Dos coordinadores descansan el {dmy(conflicto.day)}: {conflicto.coords.join(' y ')}. Ajusta sus rangos o grupos.</Text>
        </View>
      ) : null}

      {/* Calendario inspector × día */}
      {metas.length > 0 ? (
        <Card>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, marginBottom: spacing.xs }}>Calendario del ciclo</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View>
              {/* Cabecera */}
              <View style={{ flexDirection: 'row' }}>
                <View style={{ width: 118 }}><Text style={{ color: colors.muted, fontSize: 10, fontWeight: '800' }}>Inspector</Text></View>
                {days.map((d) => (
                  <View key={d} style={{ width: 22, alignItems: 'center' }}>
                    <Text style={{ color: colors.text, fontSize: 9, fontWeight: '800' }}>{ddOf(d)}</Text>
                    <Text style={{ color: dowOf(d) === 'S' || dowOf(d) === 'D' ? colors.danger : colors.muted, fontSize: 8 }}>{dowOf(d)}</Text>
                  </View>
                ))}
              </View>
              {/* Filas */}
              {metas.map((m) => (
                <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                  <View style={{ width: 118, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <View style={{ width: m.grupo && m.grupo.length > 1 ? 20 : 14, height: 14, borderRadius: 3, backgroundColor: m.grupo ? badgeColorOf(m.grupo) : colors.border, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: '#fff', fontSize: 8, fontWeight: '900' }}>{m.grupo || '·'}</Text>
                    </View>
                    <Text style={{ color: colors.text, fontSize: 9.5, fontWeight: '700', flex: 1 }} numberOfLines={1}>{m.inspector_name}</Text>
                  </View>
                  {days.map((d) => {
                    const st = estadoDe(m.inspector_name, d);
                    return (
                      <View key={d} style={{ width: 22, height: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: st === 'D' ? grupoColor(m.grupo) + '55' : 'transparent', borderWidth: 0.5, borderColor: colors.border }}>
                        <Text style={{ color: st === 'D' ? colors.text : colors.muted, fontSize: 9, fontWeight: st === 'D' ? '800' : '400' }}>{st}</Text>
                      </View>
                    );
                  })}
                </View>
              ))}
              {/* En descanso */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                <View style={{ width: 118 }}><Text style={{ color: colors.muted, fontSize: 9, fontWeight: '800' }}>En descanso</Text></View>
                {days.map((d) => (
                  <View key={d} style={{ width: 22, alignItems: 'center' }}><Text style={{ color: colors.text, fontSize: 9, fontWeight: '700' }}>{descansoCount(d)}</Text></View>
                ))}
              </View>
            </View>
          </ScrollView>
          <Text style={{ color: colors.muted, fontSize: 10, marginTop: spacing.xs }}>D = en descanso · T = en turno. Color = grupo.</Text>
        </Card>
      ) : null}

      {/* Inspectores + metadata + guardias */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm, marginBottom: spacing.xs }}>
        <Text style={{ color: colors.text, fontWeight: '900', fontSize: 14 }}>👮 Inspectores ({metas.length})</Text>
        <TouchableOpacity onPress={() => setAddOpen(true)} style={{ backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 }}>
          <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>➕ Agregar</Text>
        </TouchableOpacity>
      </View>

      {metas.length === 0 ? (
        <EmptyState title="Sin inspectores" subtitle="Agrega inspectores y define sus rangos de descanso, o usa Autogenerar 14x7." />
      ) : metas.map((m) => {
        const desc = (shiftsByName.get(m.inspector_name) ?? []).filter((s) => s.kind === 'descanso');
        return (
          <Card key={m.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, flex: 1 }}>👮 {m.inspector_name}</Text>
              <TouchableOpacity onPress={() => quitarInspector(m)}><Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>Quitar ✕</Text></TouchableOpacity>
            </View>
            {/* Cargo + grupo */}
            <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs, flexWrap: 'wrap' }}>
              {CARGOS.map((c) => {
                const on = (m.cargo || '') === c;
                return (
                  <TouchableOpacity key={c} onPress={() => patchMeta(m, { cargo: c })} style={{ borderWidth: 1.5, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary + '18' : colors.surface, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11 }}>{c}</Text>
                  </TouchableOpacity>
                );
              })}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Text style={{ color: colors.muted, fontSize: 11 }}>Gr.</Text>
                {GRUPOS.map((g) => {
                  const on = (m.grupo || '') === g;
                  return (
                    <TouchableOpacity key={g} onPress={() => patchMeta(m, { grupo: on ? null : g })} style={{ width: 24, height: 24, borderRadius: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? (grupoColor(g)) : colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}>
                      <Text style={{ color: on ? '#fff' : colors.muted, fontWeight: '800', fontSize: 11 }}>{g}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            {/* Cédula / teléfono / sector editables */}
            <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
              {([['cedula', 'Cédula'], ['telefono', 'Teléfono'], ['sector', 'Sector']] as const).map(([k, ph]) => (
                <TextInput key={k} defaultValue={(m as any)[k] ?? ''} onEndEditing={(e) => patchMeta(m, { [k]: e.nativeEvent.text.trim() || null } as any)} placeholder={ph} placeholderTextColor={colors.muted}
                  style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 6, color: colors.text, fontSize: 12 }} />
              ))}
            </View>
            {/* Descansos */}
            <View style={{ marginTop: spacing.xs }}>
              {desc.length === 0 ? <Text style={{ color: colors.muted, fontSize: 11.5 }}>Sin descanso definido.</Text> : desc.map((s) => (
                <View key={s.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 }}>
                  <Text style={{ color: colors.text, fontSize: 12 }}>🛌 Descanso: {dmy(s.from_date)} al {dmy(s.to_date)}</Text>
                  <TouchableOpacity onPress={() => quitarShift(s)}><Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700' }}>Borrar</Text></TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity onPress={() => { setDescansoFor(m); setDFrom(from); setDTo(addDaysISO(from, 6)); }} style={{ marginTop: 4, alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
                <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 11.5 }}>➕ Agregar descanso</Text>
              </TouchableOpacity>
            </View>
          </Card>
        );
      })}
      <View style={{ height: spacing.xl }} />

      {/* Modal: agregar inspector */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <Pressable onPress={() => setAddOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '80%', padding: spacing.lg }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15, marginBottom: spacing.sm }}>➕ Agregar inspector</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              {disponibles.length === 0 ? <Text style={{ color: colors.muted, fontSize: 13 }}>Todos los inspectores ya están en la distribución.</Text> : disponibles.map((p) => (
                <TouchableOpacity key={p.id} onPress={() => agregarInspector(p)} disabled={busy} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>{p.full_name}</Text>
                  {p.cedula ? <Text style={{ color: colors.muted, fontSize: 11 }}>C.I {p.cedula}</Text> : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity onPress={() => setAddOpen(false)} style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Modal: ARMAR GRUPOS 14x7 a mano */}
      <Modal visible={grupoOpen} transparent animationType="slide" onRequestClose={() => setGrupoOpen(false)}>
        <Pressable onPress={() => setGrupoOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '88%', padding: spacing.lg }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15, marginBottom: 2 }}>⚙️ Armar grupos 14x7</Text>
            <Text style={{ color: colors.muted, fontSize: 11.5, marginBottom: spacing.sm }}>
              Asigna cada inspector a un grupo. Cada grupo descansa una semana distinta (A = semana 1, B = semana 2, …). Hay {nGroups} grupos ({GRUPOS.join(' · ')}), desde {dmy(from)}. Al generar se reemplazan las guardias actuales.
            </Text>
            {/* Sugerir automático + conteo por grupo */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
              <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', flex: 1, marginRight: spacing.sm }}>
                {GRUPOS.map((g) => (
                  <View key={g} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <View style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: grupoColor(g), alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: '#fff', fontSize: 9, fontWeight: '900' }}>{g}</Text>
                    </View>
                    <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>{metas.filter((m) => grupoSel[m.id] === g).length}</Text>
                  </View>
                ))}
              </View>
              <TouchableOpacity onPress={() => setGrupoSel(computeAutoGroups())} style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 5 }}>
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 11.5 }}>✨ Sugerir automático</Text>
              </TouchableOpacity>
            </View>
            {notice && grupoOpen ? <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12, marginBottom: spacing.xs }}>{notice}</Text> : null}
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 380 }}>
              {[...metas].sort((a, b) => cmpText(a.inspector_name, b.inspector_name)).map((m) => (
                <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <View style={{ flex: 1, paddingRight: spacing.sm }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>{m.inspector_name}</Text>
                    <Text style={{ color: colors.muted, fontSize: 10.5 }}>{m.cargo || 'Inspector'}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end', flexShrink: 1 }}>
                    {GRUPOS.map((g) => {
                      const on = grupoSel[m.id] === g;
                      return (
                        <TouchableOpacity key={g} onPress={() => setGrupoSel((prev) => ({ ...prev, [m.id]: g }))} style={{ width: 30, height: 30, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? grupoColor(g) : colors.surfaceAlt, borderWidth: 1.5, borderColor: on ? grupoColor(g) : colors.border }}>
                          <Text style={{ color: on ? '#fff' : colors.muted, fontWeight: '900', fontSize: 13 }}>{g}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <TouchableOpacity onPress={() => setGrupoOpen(false)} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={generarRotacion} disabled={busy} style={{ flex: 2, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.brand, opacity: busy ? 0.6 : 1 }}>
                <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>{busy ? 'Generando…' : '⚙️ Generar rotación 14x7'}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Modal: ARMAR "1 día libre/semana" a mano */}
      <Modal visible={diaOpen} transparent animationType="slide" onRequestClose={() => setDiaOpen(false)}>
        <Pressable onPress={() => setDiaOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '88%', padding: spacing.lg }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15, marginBottom: 2 }}>📅 1 día libre por semana</Text>
            <Text style={{ color: colors.muted, fontSize: 11.5, marginBottom: spacing.sm }}>
              Asigna a cada inspector UN día fijo de descanso a la semana; los demás días trabaja normal. A diferencia del modo por grupos, ninguna semana queda alguien sin trabajar toda la semana. Se repite cada semana dentro del ciclo {dmy(from)} — {dmy(to)} (ajusta "Ciclo" arriba si necesitas otro rango). Al generar se reemplazan las guardias actuales.
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
              <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', flex: 1, marginRight: spacing.sm }}>
                {DIAS_SEMANA.map((d) => (
                  <View key={d.code} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <View style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: diaColor(d.code), alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: '#fff', fontSize: 8, fontWeight: '900' }}>{d.code}</Text>
                    </View>
                    <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>{metas.filter((m) => diaSel[m.id] === d.code).length}</Text>
                  </View>
                ))}
              </View>
              <TouchableOpacity onPress={() => setDiaSel(computeAutoDias())} style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 5 }}>
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 11.5 }}>✨ Sugerir automático</Text>
              </TouchableOpacity>
            </View>
            {notice && diaOpen ? <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12, marginBottom: spacing.xs }}>{notice}</Text> : null}
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 380 }}>
              {[...metas].sort((a, b) => cmpText(a.inspector_name, b.inspector_name)).map((m) => (
                <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <View style={{ flex: 1, paddingRight: spacing.sm }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>{m.inspector_name}</Text>
                    <Text style={{ color: colors.muted, fontSize: 10.5 }}>{m.cargo || 'Inspector'}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end', flexShrink: 1 }}>
                    {DIAS_SEMANA.map((d) => {
                      const on = diaSel[m.id] === d.code;
                      return (
                        <TouchableOpacity key={d.code} onPress={() => setDiaSel((prev) => ({ ...prev, [m.id]: d.code }))} style={{ width: 30, height: 30, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? diaColor(d.code) : colors.surfaceAlt, borderWidth: 1.5, borderColor: on ? diaColor(d.code) : colors.border }}>
                          <Text style={{ color: on ? '#fff' : colors.muted, fontWeight: '900', fontSize: 11 }}>{d.code}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <TouchableOpacity onPress={() => setDiaOpen(false)} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={generarRotacionSemanal} disabled={busy} style={{ flex: 2, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary, opacity: busy ? 0.6 : 1 }}>
                <Text style={{ color: '#fff', fontWeight: '800' }}>{busy ? 'Generando…' : '📅 Generar 1 libre/semana'}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Modal: agregar descanso */}
      <Modal visible={!!descansoFor} transparent animationType="slide" onRequestClose={() => setDescansoFor(null)}>
        <Pressable onPress={() => setDescansoFor(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 15, marginBottom: spacing.sm }}>🛌 Descanso · {descansoFor?.inspector_name}</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 2 }}>Desde</Text>
            <DateField value={dFrom} onChange={setDFrom} />
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 2 }}>Hasta</Text>
            <DateField value={dTo} onChange={setDTo} />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <TouchableOpacity onPress={() => setDescansoFor(null)} style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceAlt }}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={agregarDescanso} disabled={busy} style={{ flex: 2, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.accent, opacity: busy ? 0.6 : 1 }}>
                <Text style={{ color: colors.accentContrast, fontWeight: '800' }}>{busy ? 'Guardando…' : 'Guardar descanso'}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}
