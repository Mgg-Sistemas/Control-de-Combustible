// Sub-vista "👥 Inspectores" del coordinador de inspectores (dentro de SupervisorScreen).
// Lista cada inspector real, colapsable y buscable. Dentro de cada inspector, las
// máquinas van repartidas en grupos COLAPSABLES: 🟢 Iniciadas · ⏳ Pendientes ·
// 🟡🔴 Paradas / averiadas. Al tocar una máquina se abre el MISMO check-in del
// inspector (iniciar jornada, avería, parada, ubicación): lo que el coordinador haga
// se le marca al inspector dueño de la máquina. Es presentacional: recibe las filas ya
// clasificadas y delega la acción en onTapMachine.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { norm } from '../lib/text';

type MachineLike = {
  id: string; code: string; companyName?: string; tipo?: string | null;
  serial?: string | null; plate?: string | null; encargado?: string | null;
  [k: string]: any;
};
export type InspectorRow = {
  id: string; name: string; total: number;
  buckets: { iniciadas: MachineLike[]; pendientes: MachineLike[]; paradas: MachineLike[]; averiadas: MachineLike[] };
};

// Buscador por TODAS las características posibles de la máquina: recorre CADA campo del
// objeto (código, descripción, empresa, serial, placa, identificador, grupo, encargado,
// tipo, clasificación, tipo de maquinaria, parroquia, sector, edificio/referencia,
// estado, etc.) y compara los valores de texto/número. Solo salta campos TÉCNICOS que
// no son características legibles (ids, coordenadas, fechas, fotos/URLs).
const SKIP_KEY = /(^id$|_id$|_at$|^created|^updated|latitude|longitude|^lat$|^lng$|photo|url|uuid)/i;
const matchMachine = (m: MachineLike, q: string): boolean => {
  if (!q) return true;
  for (const k in m) {
    if (SKIP_KEY.test(k)) continue;
    const v = (m as any)[k];
    if (v == null) continue;
    if ((typeof v === 'string' || typeof v === 'number') && norm(String(v)).includes(q)) return true;
  }
  return false;
};

export default function CoordinadorInspectoresView({
  rows, shiftLabel, query, onQueryChange, expanded, onToggle, onTapMachine,
}: {
  rows: InspectorRow[];
  shiftLabel: string;
  query: string;
  onQueryChange: (t: string) => void;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onTapMachine: (m: MachineLike) => void;
}) {
  const { colors } = useTheme();
  const q = norm(query.trim());
  // Grupos de estado COLAPSADOS por inspector (clave `${inspId}:${grupo}`). Con
  // búsqueda activa se fuerzan abiertos para no esconder los resultados.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (k: string) => setOpenGroups((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

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

  const machineRow = (m: MachineLike, color: string, tag?: string) => (
    <TouchableOpacity
      key={m.id}
      onPress={() => onTapMachine(m)}
      activeOpacity={0.6}
      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 9, paddingHorizontal: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}
    >
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>{m.code}</Text>
        <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11 }}>
          {(m.tipo || 'Sin tipo')}{m.companyName ? ` · ${m.companyName}` : ''}{tag ? ` · ${tag}` : ''}
        </Text>
      </View>
      <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 11 }}>Abrir ›</Text>
    </TouchableOpacity>
  );

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.brand + '18', borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, paddingVertical: 6, paddingHorizontal: spacing.sm, marginBottom: spacing.xs }}>
        <Text style={{ fontSize: 14 }}>🕒</Text>
        <Text style={{ flex: 1, color: colors.brandText, fontSize: 12, fontWeight: '800' }}>Turno actual: {shiftLabel} · solo se muestran los inspectores de este turno.</Text>
      </View>
      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>
        Toca una máquina para operarla (iniciar jornada · avería · parada · ubicación). Lo que hagas se le marca a su inspector.
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginBottom: spacing.sm }}>
        <Text style={{ fontSize: 14 }}>🔎</Text>
        <TextInput
          value={query}
          onChangeText={onQueryChange}
          placeholder="Buscar inspector o máquina (todas las características)…"
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
        const open = q ? true : expanded.has(r.id);
        const parAve = [
          ...r.buckets.paradas.map((m) => ({ m, color: colors.warning, tag: 'Parada' })),
          ...r.buckets.averiadas.map((m) => ({ m, color: colors.danger, tag: 'Averiada' })),
        ];
        // 3 grupos colapsables dentro del inspector.
        const groups = [
          { key: 'iniciadas', label: 'Iniciadas', icon: '🟢', color: colors.success, items: r.buckets.iniciadas.map((m) => ({ m, color: colors.success, tag: undefined as string | undefined })) },
          { key: 'pendientes', label: 'Pendientes por iniciar', icon: '⏳', color: colors.brandText, items: r.buckets.pendientes.map((m) => ({ m, color: colors.brandText, tag: undefined as string | undefined })) },
          { key: 'paradas_averias', label: 'Paradas / averiadas', icon: '🟡', color: colors.warning, items: parAve },
        ];
        return (
          <View key={r.id} style={{ borderWidth: 1, borderColor: open ? colors.primary : colors.border, borderRadius: radius.md, backgroundColor: colors.surface, marginBottom: spacing.xs, overflow: 'hidden' }}>
            <TouchableOpacity onPress={() => onToggle(r.id)} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md }}>
              <Text style={{ fontSize: 20 }}>👮</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '900', fontSize: 14 }}>{r.name}</Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 3 }}>
                  {pill('🟢', r.buckets.iniciadas.length, colors.success)}
                  {pill('⏳', r.buckets.pendientes.length, colors.brandText)}
                  {pill('🟡🔴', r.buckets.paradas.length + r.buckets.averiadas.length, colors.warning)}
                </View>
              </View>
              <Text style={{ color: colors.muted, fontSize: 20 }}>{open ? '⌄' : '›'}</Text>
            </TouchableOpacity>
            {open ? (
              <View style={{ paddingHorizontal: spacing.sm, paddingBottom: spacing.sm, gap: spacing.xs }}>
                {groups.map((g) => {
                  const gk = `${r.id}:${g.key}`;
                  const gopen = q ? true : openGroups.has(gk);
                  return (
                    <View key={g.key} style={{ borderWidth: 1, borderColor: gopen ? g.color : colors.border, borderRadius: radius.md, overflow: 'hidden' }}>
                      <TouchableOpacity onPress={() => toggleGroup(gk)} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 10, paddingHorizontal: spacing.sm }}>
                        <Text style={{ fontSize: 16 }}>{g.icon}</Text>
                        <Text style={{ flex: 1, color: colors.text, fontWeight: '800', fontSize: 13 }}>{g.label}</Text>
                        <Text style={{ color: g.color, fontWeight: '900', fontSize: 14, fontVariant: ['tabular-nums'] as any, minWidth: 18, textAlign: 'right' }}>{g.items.length}</Text>
                        <Text style={{ color: colors.muted, fontSize: 16 }}>{gopen ? '⌄' : '›'}</Text>
                      </TouchableOpacity>
                      {gopen ? (
                        <View style={{ paddingHorizontal: spacing.xs }}>
                          {g.items.length === 0
                            ? <Text style={{ color: colors.muted, fontSize: 12, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs }}>Sin máquinas {g.label.toLowerCase()}.</Text>
                            : g.items.map(({ m, color, tag }) => machineRow(m, color, tag))}
                        </View>
                      ) : null}
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
