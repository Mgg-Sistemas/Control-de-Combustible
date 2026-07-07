import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, TextInput, Alert, Platform } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase } from '../lib/supabase';
import { Machinery, MachineRound } from '../types/database';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

export const ROUND_TIMES = ['07:00', '11:00', '15:00', '19:00'];
export const ROUND_LABELS = ['1ª RONDA', '2ª RONDA', '3ª RONDA', '4ª RONDA'];
/** Horas del turno completo (07:00 → 19:00). Las horas trabajadas = turno − parada. */
export const SHIFT_HOURS = 12;
/** Horas que representa cada ronda (12 h / 4 rondas = 3 h). */
export const HOURS_PER_ROUND = SHIFT_HOURS / 4;
export const workedHours = (hoursStopped: number) => Math.max(0, SHIFT_HOURS - (hoursStopped || 0));

/** Campo de fecha con calendario: en web usa <input type="date">; en nativo, texto. */
function DateField({ value, onChange, colors }: { value: string; onChange: (v: string) => void; colors: any }) {
  if (Platform.OS === 'web') {
    return React.createElement('input', {
      type: 'date',
      value: value || '',
      onChange: (e: any) => onChange(e.target.value),
      style: {
        padding: '9px',
        borderRadius: '10px',
        border: '1px solid ' + colors.border,
        background: colors.surface,
        color: colors.text,
        fontSize: '14px',
        width: '100%',
        boxSizing: 'border-box',
      },
    });
  }
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder="AAAA-MM-DD"
      placeholderTextColor={colors.muted}
      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }}
    />
  );
}

function todayISO(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
function shiftDay(iso: string, delta: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export default function ControlMaquinariaScreen({ navigation }: any) {
  const { colors } = useTheme();
  const [date, setDate] = useState(todayISO());
  const [machines, setMachines] = useState<Machinery[]>([]);
  const [companies, setCompanies] = useState<Record<string, string>>({}); // id → nombre
  const [rounds, setRounds] = useState<Record<string, MachineRound>>({}); // key: machineryId-roundNo
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [hoursInput, setHoursInput] = useState<Record<string, string>>({}); // texto en edición por máquina

  const key = (mId: string, no: number) => `${mId}-${no}`;

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: m }, { data: r }, { data: c }] = await Promise.all([
      supabase.from('machinery').select('*').order('code', { ascending: true }),
      supabase.from('machine_rounds').select('*').eq('round_date', date),
      supabase.from('companies').select('id, name'),
    ]);
    setMachines((m ?? []) as Machinery[]);
    const cmap: Record<string, string> = {};
    (c ?? []).forEach((row: any) => (cmap[row.id] = row.name));
    setCompanies(cmap);
    const map: Record<string, MachineRound> = {};
    (r ?? []).forEach((row: any) => (map[key(row.machinery_id, row.round_no)] = row));
    setRounds(map);
    setHoursInput({}); // refrescar los campos con los valores del día cargado
    setLoading(false);
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  const setRound = async (m: Machinery, no: number, status: 'operativa' | 'parada') => {
    const existing = rounds[key(m.id, no)];
    const payload: any = {
      machinery_id: m.id,
      round_date: date,
      round_no: no,
      status,
      hours_stopped: existing?.hours_stopped ?? 0,
    };
    const { data, error } = await supabase
      .from('machine_rounds')
      .upsert(payload, { onConflict: 'machinery_id,round_date,round_no' })
      .select()
      .single();
    if (error) return Alert.alert('Aviso', error.message);
    setRounds((p) => ({ ...p, [key(m.id, no)]: data as MachineRound }));
  };

  /** Cicla el estado de la ronda: gris (sin registro) → verde → rojo → gris. */
  const cycleRound = async (m: Machinery, no: number) => {
    const cur = rounds[key(m.id, no)];
    if (cur?.status === 'parada') {
      // Volver a gris: eliminar el registro de la ronda.
      const { error } = await supabase.from('machine_rounds').delete().eq('id', cur.id);
      if (error) return Alert.alert('Aviso', error.message);
      setRounds((p) => {
        const n = { ...p };
        delete n[key(m.id, no)];
        return n;
      });
      return;
    }
    await setRound(m, no, cur?.status === 'operativa' ? 'parada' : 'operativa');
  };

  const setMoveDate = async (m: Machinery, field: 'entry_date' | 'exit_date', value: string | null) => {
    const { error } = await supabase.from('machinery').update({ [field]: value }).eq('id', m.id);
    if (error) return Alert.alert('Aviso', error.message);
    setMachines((prev) => prev.map((x) => (x.id === m.id ? ({ ...x, [field]: value } as Machinery) : x)));
  };

  const setHours = async (m: Machinery, hours: string) => {
    const h = Number(hours.replace(',', '.')) || 0;
    // Guarda las horas de parada en la 1ª ronda del día (registro base).
    const existing = rounds[key(m.id, 1)];
    const payload: any = {
      machinery_id: m.id,
      round_date: date,
      round_no: 1,
      status: existing?.status ?? 'operativa',
      hours_stopped: h,
    };
    const { data, error } = await supabase
      .from('machine_rounds')
      .upsert(payload, { onConflict: 'machinery_id,round_date,round_no' })
      .select()
      .single();
    if (error) return Alert.alert('Aviso', error.message);
    setRounds((p) => ({ ...p, [key(m.id, 1)]: data as MachineRound }));
  };

  const q = query.trim().toLowerCase();
  const shown = !q
    ? machines
    : machines.filter(
        (m) =>
          m.code.toLowerCase().includes(q) ||
          (m.serial ?? '').toLowerCase().includes(q) ||
          (m.company_id ? (companies[m.company_id] ?? '').toLowerCase().includes(q) : false),
      );

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Control de maquinaria</SectionTitle>

      <Card>
        <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 2 }}>Día del control</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <TouchableOpacity
            onPress={() => setDate(shiftDay(date, -1))}
            style={{ paddingVertical: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>◀</Text>
          </TouchableOpacity>
          <TextInput
            value={date}
            onChangeText={setDate}
            placeholder="AAAA-MM-DD"
            placeholderTextColor={colors.muted}
            style={{ flex: 1, minWidth: 0, textAlign: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, fontWeight: '700' }}
          />
          <TouchableOpacity
            onPress={() => setDate(shiftDay(date, 1))}
            style={{ paddingVertical: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>▶</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          <TouchableOpacity
            onPress={() => setDate(todayISO())}
            style={{ flex: 1, paddingVertical: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ color: colors.text, fontWeight: '700' }}>📅 Hoy</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => navigation?.navigate('Reports')}
            style={{ flex: 1, paddingVertical: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center' }}
          >
            <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>📊 Ver reporte</Text>
          </TouchableOpacity>
        </View>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>
          Cada máquina tiene sus 4 rondas. Toca una vez = ✓ operativa (verde), otra = ✕ parada (rojo), otra = gris (sin registro).
        </Text>
      </Card>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="🔎 Buscar por nombre, serial o empresa…"
        placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: spacing.sm }}
      />

      {loading ? (
        <Loading />
      ) : shown.length === 0 ? (
        <EmptyState title={query ? 'Sin resultados' : 'Sin maquinaria'} subtitle={query ? 'Prueba con otra búsqueda.' : 'Agrega máquinas en Equipos.'} />
      ) : (
        shown.map((m) => {
          const hours = rounds[key(m.id, 1)]?.hours_stopped ?? 0;
          return (
            <Card key={m.id}>
              <Text style={{ fontWeight: '700', color: colors.text, fontSize: 16 }}>{m.code}</Text>
              <Text style={{ color: m.company_id ? colors.primary : colors.muted, fontSize: 13, fontWeight: '600', marginBottom: spacing.xs }}>
                🏢 {m.company_id ? (companies[m.company_id] ?? 'Empresa') : 'Sin empresa'}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {ROUND_TIMES.map((time, i) => {
                  const no = i + 1;
                  const r = rounds[key(m.id, no)];
                  const st = r?.status;
                  const bg = st === 'operativa' ? colors.success : st === 'parada' ? colors.danger : colors.surfaceAlt;
                  const fg = st ? '#fff' : colors.text;
                  return (
                    <TouchableOpacity
                      key={no}
                      onPress={() => cycleRound(m, no)}
                      style={{
                        flexGrow: 1,
                        flexBasis: 70,
                        minHeight: 56,
                        borderRadius: radius.md,
                        borderWidth: 1,
                        borderColor: st ? bg : colors.border,
                        backgroundColor: bg,
                        alignItems: 'center',
                        justifyContent: 'center',
                        paddingVertical: spacing.xs,
                      }}
                    >
                      <Text style={{ color: fg, fontWeight: '700', fontSize: 11 }}>{ROUND_LABELS[i]}</Text>
                      <Text style={{ color: fg, fontSize: 12, fontWeight: '700' }}>{time}</Text>
                      <Text style={{ color: fg, fontSize: 10 }}>{st === 'operativa' ? '✓ Oper.' : st === 'parada' ? '✕ Parada' : '—'}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Entrada / Salida (con calendario, solo si se tildan) */}
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                {(['entry_date', 'exit_date'] as const).map((field) => {
                  const label = field === 'entry_date' ? '📥 ENTRADA' : '📤 SALIDA';
                  const val = (m as any)[field] as string | null;
                  const active = !!val;
                  return (
                    <View key={field} style={{ flex: 1 }}>
                      <TouchableOpacity
                        onPress={() => setMoveDate(m, field, active ? null : date)}
                        style={{ paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : colors.surfaceAlt, alignItems: 'center' }}
                      >
                        <Text style={{ color: active ? colors.primaryContrast : colors.text, fontWeight: '700', fontSize: 13 }}>
                          {active ? '✓ ' : ''}{label}
                        </Text>
                      </TouchableOpacity>
                      {active ? (
                        <View style={{ marginTop: 4 }}>
                          <DateField value={val ?? ''} onChange={(v) => setMoveDate(m, field, v || null)} colors={colors} />
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm }}>
                <Text style={{ color: colors.muted, fontSize: 13, flex: 1 }}>Horas parada</Text>
                <TextInput
                  value={hoursInput[m.id] !== undefined ? hoursInput[m.id] : hours ? String(hours) : ''}
                  onChangeText={(t) => setHoursInput((p) => ({ ...p, [m.id]: t }))}
                  onBlur={() => hoursInput[m.id] !== undefined && setHours(m, hoursInput[m.id])}
                  onSubmitEditing={() => hoursInput[m.id] !== undefined && setHours(m, hoursInput[m.id])}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={colors.muted}
                  style={{ width: 90, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, textAlign: 'right' }}
                />
              </View>
              <View style={{ marginTop: spacing.xs, paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    Turno {SHIFT_HOURS}h − parada {hours || 0}h (≈ {(Number(hours) / HOURS_PER_ROUND).toFixed(1)} rondas)
                  </Text>
                  <Text style={{ color: workedHours(hours) === 0 ? colors.danger : colors.success, fontWeight: '700', fontSize: 13 }}>
                    Trabajadas: {workedHours(hours)} h
                  </Text>
                </View>
                {/* Barra: rojo = parada, verde = trabajadas (descontado del turno) */}
                <View style={{ flexDirection: 'row', height: 8, borderRadius: radius.pill, overflow: 'hidden', marginTop: 4, backgroundColor: colors.surfaceAlt }}>
                  <View style={{ flex: Math.min(SHIFT_HOURS, Number(hours) || 0), backgroundColor: colors.danger }} />
                  <View style={{ flex: workedHours(hours), backgroundColor: colors.success }} />
                </View>
              </View>
            </Card>
          );
        })
      )}
    </Screen>
  );
}
