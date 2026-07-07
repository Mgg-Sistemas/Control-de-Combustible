import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, TextInput, Alert } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase } from '../lib/supabase';
import { Machinery, MachineRound } from '../types/database';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

export const ROUND_TIMES = ['07:00', '11:00', '15:00', '19:00'];
export const ROUND_LABELS = ['1ª RONDA', '2ª RONDA', '3ª RONDA', '4ª RONDA'];

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
  const [rounds, setRounds] = useState<Record<string, MachineRound>>({}); // key: machineryId-roundNo
  const [loading, setLoading] = useState(true);

  const key = (mId: string, no: number) => `${mId}-${no}`;

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: m }, { data: r }] = await Promise.all([
      supabase.from('machinery').select('*').order('code', { ascending: true }),
      supabase.from('machine_rounds').select('*').eq('round_date', date),
    ]);
    setMachines((m ?? []) as Machinery[]);
    const map: Record<string, MachineRound> = {};
    (r ?? []).forEach((row: any) => (map[key(row.machinery_id, row.round_no)] = row));
    setRounds(map);
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
            style={{ flex: 1, textAlign: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, fontWeight: '700' }}
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
          Cada máquina tiene sus 4 rondas. Toca una: verde = operativa, rojo = parada.
        </Text>
      </Card>

      {loading ? (
        <Loading />
      ) : machines.length === 0 ? (
        <EmptyState title="Sin maquinaria" subtitle="Agrega máquinas en Equipos." />
      ) : (
        machines.map((m) => {
          const hours = rounds[key(m.id, 1)]?.hours_stopped ?? 0;
          return (
            <Card key={m.id}>
              <Text style={{ fontWeight: '700', color: colors.text, fontSize: 16, marginBottom: spacing.xs }}>{m.code}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {ROUND_TIMES.map((time, i) => {
                  const no = i + 1;
                  const r = rounds[key(m.id, no)];
                  const st = r?.status;
                  const bg = st === 'operativa' ? colors.success : st === 'parada' ? colors.danger : colors.surfaceAlt;
                  const fg = st ? '#fff' : colors.text;
                  const next = st === 'operativa' ? 'parada' : 'operativa';
                  return (
                    <TouchableOpacity
                      key={no}
                      onPress={() => setRound(m, no, next)}
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
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm }}>
                <Text style={{ color: colors.muted, fontSize: 13, flex: 1 }}>Horas parada</Text>
                <TextInput
                  defaultValue={hours ? String(hours) : ''}
                  onEndEditing={(e) => setHours(m, e.nativeEvent.text)}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={colors.muted}
                  style={{ width: 90, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, textAlign: 'right' }}
                />
              </View>
            </Card>
          );
        })
      )}
    </Screen>
  );
}
