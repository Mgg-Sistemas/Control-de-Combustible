import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, TextInput } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase } from '../lib/supabase';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

// ── Utilidades de fecha (semana lunes→domingo, rangos de 7 días) ──────────────
function toISO(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
function weekStartISO(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  const diff = (d.getDay() + 6) % 7; // días desde el lunes
  d.setDate(d.getDate() - diff);
  return toISO(d);
}
function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return toISO(d);
}

type MachineAgg = { machine: string; rounds: number; hours: number };
type Group = {
  company: string;
  weekStart: string;
  weekEnd: string;
  totalRounds: number;
  hours: number;
  machines: Record<string, MachineAgg>;
};

export default function ControlPagosScreen() {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<Group | null>(null);
  const [query, setQuery] = useState('');

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('machine_rounds')
      .select('round_date, round_no, hours_stopped, machinery:machinery_id(code, company:company_id(name))')
      .order('round_date', { ascending: false });

    const map = new Map<string, Group>();
    (data ?? []).forEach((r: any) => {
      const company = r.machinery?.company?.name ?? 'Sin empresa';
      const machine = r.machinery?.code ?? '—';
      const weekStart = weekStartISO(r.round_date);
      const k = `${company}|${weekStart}`;
      const g =
        map.get(k) ??
        ({ company, weekStart, weekEnd: addDaysISO(weekStart, 6), totalRounds: 0, hours: 0, machines: {} } as Group);
      g.totalRounds += 1;
      g.hours += Number(r.hours_stopped) || 0;
      const ma = g.machines[machine] ?? { machine, rounds: 0, hours: 0 };
      ma.rounds += 1;
      ma.hours += Number(r.hours_stopped) || 0;
      g.machines[machine] = ma;
      map.set(k, g);
    });

    const list = Array.from(map.values()).sort((a, b) =>
      a.weekStart === b.weekStart ? a.company.localeCompare(b.company) : b.weekStart.localeCompare(a.weekStart)
    );
    setGroups(list);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const q = query.trim().toLowerCase();
  const shown = !q ? groups : groups.filter((g) => g.company.toLowerCase().includes(q));

  // Agrupar visualmente por empresa
  const byCompany = useMemo(() => {
    const m = new Map<string, Group[]>();
    shown.forEach((g) => {
      const arr = m.get(g.company) ?? [];
      arr.push(g);
      m.set(g.company, arr);
    });
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [shown]);

  const machinesOf = (g: Group) => Object.values(g.machines).sort((a, b) => b.rounds - a.rounds);

  return (
    <Screen>
      <ConfigBanner />
      <SectionTitle>Control de pagos</SectionTitle>
      <Text style={{ color: colors.muted, fontSize: 13, marginBottom: spacing.sm }}>
        Cuentas por pagar generadas a partir de las rondas, por empresa y por semana (rangos de 7 días).
      </Text>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="🔎 Buscar empresa…"
        placeholderTextColor={colors.muted}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginBottom: spacing.sm }}
      />

      {loading ? (
        <Loading />
      ) : byCompany.length === 0 ? (
        <EmptyState title={q ? 'Sin resultados' : 'Sin cuentas por pagar'} subtitle={q ? 'Prueba con otra búsqueda.' : 'Registra rondas en Control de maquinaria y aparecerán aquí.'} />
      ) : (
        byCompany.map(([company, weeks]) => (
          <View key={company}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, marginTop: spacing.sm, marginBottom: spacing.xs }}>
              🏢 {company}
            </Text>
            {weeks.map((g) => {
              const machines = machinesOf(g);
              return (
                <TouchableOpacity key={g.weekStart} activeOpacity={0.7} onPress={() => setSelected(g)}>
                  <Card>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>
                        Semana {g.weekStart} → {g.weekEnd}
                      </Text>
                      <Text style={{ color: colors.primary, fontWeight: '800' }}>{g.totalRounds} rondas</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: spacing.xs }}>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>🚜 {machines.length} máquina(s)</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>⏸️ {g.hours.toLocaleString()} h parada</Text>
                    </View>
                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.xs }}>Toca para ver el detalle</Text>
                  </Card>
                </TouchableOpacity>
              );
            })}
          </View>
        ))
      )}

      {/* Detalle de la cuenta por pagar (empresa + semana) */}
      <Modal visible={!!selected} animationType="slide" onRequestClose={() => setSelected(null)}>
        <Screen>
          {selected ? (
            <>
              <SectionTitle>{selected.company}</SectionTitle>
              <Card>
                <Text style={{ color: colors.text, fontWeight: '700' }}>
                  Semana {selected.weekStart} → {selected.weekEnd}
                </Text>
                <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm }}>
                  <View style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm }}>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>Total rondas</Text>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 20 }}>{selected.totalRounds}</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm }}>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>Máquinas</Text>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 20 }}>{Object.keys(selected.machines).length}</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm }}>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>Horas parada</Text>
                    <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 20 }}>{selected.hours.toLocaleString()}</Text>
                  </View>
                </View>
              </Card>

              <Text style={{ color: colors.text, fontWeight: '700', marginTop: spacing.sm, marginBottom: spacing.xs }}>
                Máquinas utilizadas
              </Text>
              {machinesOf(selected).map((m) => (
                <Card key={m.machine}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14, flex: 1 }}>{m.machine}</Text>
                    <Text style={{ color: colors.primary, fontWeight: '700' }}>{m.rounds} rondas</Text>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                    ⏸️ {m.hours.toLocaleString()} h parada
                  </Text>
                </Card>
              ))}

              <TouchableOpacity
                style={{ marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary }}
                onPress={() => setSelected(null)}
              >
                <Text style={{ color: colors.primaryContrast, fontWeight: '700' }}>Volver</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </Screen>
      </Modal>
    </Screen>
  );
}
