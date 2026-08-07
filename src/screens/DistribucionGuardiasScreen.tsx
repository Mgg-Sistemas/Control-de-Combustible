// Distribución de guardias (submenú de Inspecciones): asigna a cada inspector su
// rango de descanso dentro de un ciclo, MANUAL o AUTOGENERANDO una rotación 14x7 por
// grupos (nunca descansan a la vez dos coordinadores ni dos nocturnos). Muestra el
// calendario inspector×día (T/D) y genera el PDF (ver src/lib/guardiasReport.ts).
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

const CARGOS = ['Coordinador', 'Nocturno', 'Inspector'];
const GRUPO_COLOR: Record<string, string> = { A: '#9AA3AB', B: '#4BB477', C: '#E0A040' };

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

  const load = async () => {
    setLoading(true);
    const [m, s, p] = await Promise.all([
      supabase.from('guard_inspector_meta').select('id, inspector_id, inspector_name, cedula, telefono, sector, cargo, grupo'),
      supabase.from('guard_shifts').select('id, inspector_name, from_date, to_date, kind, grupo'),
      supabase.from('profiles').select('id, full_name, cedula, role').in('role', ['supervisor', 'coordinador_patio']),
    ]);
    setMetas(((m.data ?? []) as any[]).sort((a, b) => cmpText(a.grupo || 'zzz', b.grupo || 'zzz') || cmpText(a.inspector_name, b.inspector_name)));
    setShifts((s.data ?? []) as any);
    setProfs(((p.data ?? []) as any[]).map((x) => ({ id: x.id, full_name: x.full_name || '—', cedula: x.cedula ?? null })));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

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

  // AUTOGENERAR 14x7: 3 grupos, cada grupo descansa una semana (7 días). Reparte los
  // cargos por grupo para que NO coincidan dos coordinadores (ni dos nocturnos) en la
  // misma semana de descanso. Borra las guardias previas y crea las nuevas.
  const autogenerar = async () => {
    if (metas.length === 0) { setNotice('❌ Primero agrega inspectores.'); return; }
    const ok = await confirm({ title: 'Autogenerar 14x7', message: `Se armará una rotación de 3 grupos (ciclo de 21 días desde ${dmy(from)}), repartiendo cargos para que no descansen juntos dos coordinadores ni dos nocturnos. Reemplaza las guardias actuales. ¿Continuar?`, confirmText: 'Autogenerar' });
    if (!ok) return;
    {
        setBusy(true); setNotice(null);
        const nGroups = 3;
        // Orden: coordinadores, nocturnos, resto → round-robin por categoría reparte
        // cada categoría en grupos distintos (≤1 coordinador y ≤1 nocturno por grupo).
        const cat = (m: Meta) => (m.cargo === 'Coordinador' ? 0 : m.cargo === 'Nocturno' ? 1 : 2);
        const orden = [...metas].sort((a, b) => cat(a) - cat(b) || cmpText(a.inspector_name, b.inspector_name));
        const counters = [0, 0, 0]; // siguiente grupo por categoría
        const grupoDe = new Map<string, number>();
        orden.forEach((m) => { const c = cat(m); const g = counters[c] % nGroups; counters[c]++; grupoDe.set(m.id, g); });
        const letra = ['A', 'B', 'C'];
        const cycleStart = from;
        // Actualiza grupo en meta y crea el descanso de su grupo.
        const nuevosShifts: any[] = [];
        for (const m of metas) {
          const g = grupoDe.get(m.id) ?? 0;
          await supabase.from('guard_inspector_meta').update({ grupo: letra[g], updated_by: uid }).eq('id', m.id);
          const dFromG = addDaysISO(cycleStart, g * 7);
          const dToG = addDaysISO(cycleStart, g * 7 + 6);
          nuevosShifts.push({ inspector_id: m.inspector_id, inspector_name: m.inspector_name, from_date: dFromG, to_date: dToG, kind: 'descanso', grupo: letra[g], created_by: uid });
        }
        await supabase.from('guard_shifts').delete().in('inspector_name', metas.map((m) => m.inspector_name));
        if (nuevosShifts.length) await supabase.from('guard_shifts').insert(nuevosShifts);
        setTo(addDaysISO(cycleStart, 20));
        setBusy(false); load();
        setNotice('✅ Rotación 14x7 generada.');
    }
  };

  const generarPDF = async () => {
    if (metas.length === 0) { setNotice('❌ Agrega inspectores primero.'); return; }
    setBusy(true);
    try {
      const inspectors: GuardInspector[] = metas.map((m) => ({ name: m.inspector_name, grupo: m.grupo, cargo: m.cargo, cedula: m.cedula, telefono: m.telefono, sector: m.sector }));
      const shiftsIn: GuardShift[] = shifts.map((s) => ({ inspector_name: s.inspector_name, from_date: s.from_date, to_date: s.to_date, kind: (s.kind === 'turno' ? 'turno' : 'descanso') }));
      await generateGuardiasReport({ from, to, rotation: '14x7', inspectors, shifts: shiftsIn });
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
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          <TouchableOpacity onPress={autogenerar} disabled={busy} style={{ flex: 1, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
            <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12.5 }}>⚙️ Autogenerar 14x7</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={generarPDF} disabled={busy} style={{ flex: 1, backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
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
                    <View style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: GRUPO_COLOR[m.grupo || ''] || colors.border, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: '#fff', fontSize: 8, fontWeight: '900' }}>{m.grupo || '·'}</Text>
                    </View>
                    <Text style={{ color: colors.text, fontSize: 9.5, fontWeight: '700', flex: 1 }} numberOfLines={1}>{m.inspector_name}</Text>
                  </View>
                  {days.map((d) => {
                    const st = estadoDe(m.inspector_name, d);
                    return (
                      <View key={d} style={{ width: 22, height: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: st === 'D' ? (GRUPO_COLOR[m.grupo || ''] || colors.muted) + '55' : 'transparent', borderWidth: 0.5, borderColor: colors.border }}>
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
                {['A', 'B', 'C'].map((g) => {
                  const on = (m.grupo || '') === g;
                  return (
                    <TouchableOpacity key={g} onPress={() => patchMeta(m, { grupo: on ? null : g })} style={{ width: 24, height: 24, borderRadius: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? (GRUPO_COLOR[g]) : colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }}>
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
