// Sub-vista "👥 Inspectores" del coordinador de inspectores (dentro de SupervisorScreen).
// Lista cada inspector real, colapsable y buscable, con SUS máquinas repartidas por
// estado (iniciadas / pendientes / paradas / averiadas). Al tocar una máquina se abre
// el MISMO check-in del inspector (iniciar jornada, avería, parada, ubicación): lo que
// el coordinador haga se le marca al inspector dueño de la máquina. Es presentacional:
// recibe las filas ya clasificadas y delega la acción en onTapMachine.
import React from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { norm } from '../lib/text';

type MachineLike = {
  id: string; code: string; companyName?: string; tipo?: string | null;
  serial?: string | null; plate?: string | null; encargado?: string | null;
};
export type InspectorRow = {
  id: string; name: string; total: number;
  buckets: { iniciadas: MachineLike[]; pendientes: MachineLike[]; paradas: MachineLike[]; averiadas: MachineLike[] };
};

const BUCKETS: { key: keyof InspectorRow['buckets']; label: string; icon: string }[] = [
  { key: 'iniciadas', label: 'Iniciadas', icon: '🟢' },
  { key: 'pendientes', label: 'Pendientes por iniciar', icon: '⏳' },
  { key: 'paradas', label: 'Paradas', icon: '🟡' },
  { key: 'averiadas', label: 'Averiadas', icon: '🔴' },
];

const matchMachine = (m: MachineLike, q: string) => !q
  || norm(m.code).includes(q)
  || norm(m.companyName || '').includes(q)
  || norm(m.serial || '').includes(q)
  || norm(m.plate || '').includes(q)
  || norm(m.encargado || '').includes(q);

export default function CoordinadorInspectoresView({
  rows, query, onQueryChange, expanded, onToggle, onTapMachine,
}: {
  rows: InspectorRow[];
  query: string;
  onQueryChange: (t: string) => void;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onTapMachine: (m: MachineLike) => void;
}) {
  const { colors } = useTheme();
  const q = norm(query.trim());

  // Con búsqueda: si el texto coincide con el nombre del inspector, se muestran TODAS
  // sus máquinas; si no, solo las máquinas que coincidan (y se ocultan los inspectores
  // que quedan sin ninguna).
  const shown = rows
    .map((r) => {
      const nameHit = !q || norm(r.name).includes(q);
      if (nameHit) return r;
      const buckets = {
        iniciadas: r.buckets.iniciadas.filter((m) => matchMachine(m, q)),
        pendientes: r.buckets.pendientes.filter((m) => matchMachine(m, q)),
        paradas: r.buckets.paradas.filter((m) => matchMachine(m, q)),
        averiadas: r.buckets.averiadas.filter((m) => matchMachine(m, q)),
      };
      const total = buckets.iniciadas.length + buckets.pendientes.length + buckets.paradas.length + buckets.averiadas.length;
      return { ...r, buckets, total };
    })
    .filter((r) => r.total > 0);

  const pill = (icon: string, n: number, color: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      <Text style={{ fontSize: 11 }}>{icon}</Text>
      <Text style={{ color, fontWeight: '900', fontSize: 12, fontVariant: ['tabular-nums'] as any }}>{n}</Text>
    </View>
  );

  const machineRow = (m: MachineLike, color: string) => (
    <TouchableOpacity
      key={m.id}
      onPress={() => onTapMachine(m)}
      activeOpacity={0.7}
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 9, paddingHorizontal: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}
    >
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>{m.code}</Text>
        <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11 }}>
          {(m.tipo || 'Sin tipo')}{m.companyName ? ` · ${m.companyName}` : ''}
        </Text>
      </View>
      <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 11 }}>Abrir ›</Text>
    </TouchableOpacity>
  );

  return (
    <View>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
        Toca una máquina para operarla (iniciar jornada · avería · parada · ubicación). Lo que hagas se le marca a su inspector.
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginBottom: spacing.sm }}>
        <Text style={{ fontSize: 14 }}>🔎</Text>
        <TextInput
          value={query}
          onChangeText={onQueryChange}
          placeholder="Buscar inspector o máquina…"
          placeholderTextColor={colors.muted}
          style={{ flex: 1, color: colors.text, fontSize: 13, paddingVertical: 9 }}
        />
        {query ? <TouchableOpacity onPress={() => onQueryChange('')}><Text style={{ color: colors.muted, fontWeight: '800' }}>✕</Text></TouchableOpacity> : null}
      </View>

      {shown.length === 0 ? (
        <View style={{ padding: spacing.lg, alignItems: 'center' }}>
          <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center' }}>
            {q ? 'Ningún inspector o máquina coincide con la búsqueda.' : 'Aún no hay inspectores con máquinas asignadas.'}
          </Text>
        </View>
      ) : shown.map((r) => {
        const open = expanded.has(r.id);
        const c = { ini: colors.success, pend: colors.warning, par: colors.warning, ave: colors.danger };
        return (
          <View key={r.id} style={{ borderWidth: 1, borderColor: open ? colors.primary : colors.border, borderRadius: radius.md, backgroundColor: colors.surface, marginBottom: spacing.xs, overflow: 'hidden' }}>
            <TouchableOpacity onPress={() => onToggle(r.id)} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md }}>
              <Text style={{ fontSize: 20 }}>👮</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '900', fontSize: 14 }}>{r.name}</Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 3 }}>
                  {pill('🟢', r.buckets.iniciadas.length, c.ini)}
                  {pill('⏳', r.buckets.pendientes.length, colors.brandText)}
                  {pill('🟡', r.buckets.paradas.length, c.par)}
                  {pill('🔴', r.buckets.averiadas.length, c.ave)}
                </View>
              </View>
              <Text style={{ color: colors.muted, fontSize: 20 }}>{open ? '⌄' : '›'}</Text>
            </TouchableOpacity>
            {open ? (
              <View style={{ paddingHorizontal: spacing.sm, paddingBottom: spacing.sm }}>
                {BUCKETS.map(({ key, label, icon }) => {
                  const list = r.buckets[key];
                  if (list.length === 0) return null;
                  const color = key === 'averiadas' ? c.ave : key === 'paradas' ? c.par : key === 'iniciadas' ? c.ini : colors.brandText;
                  return (
                    <View key={key} style={{ marginTop: spacing.xs }}>
                      <Text style={{ color, fontWeight: '900', fontSize: 12, marginBottom: 2 }}>{icon} {label} ({list.length})</Text>
                      {list.map((m) => machineRow(m, color))}
                    </View>
                  );
                })}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
