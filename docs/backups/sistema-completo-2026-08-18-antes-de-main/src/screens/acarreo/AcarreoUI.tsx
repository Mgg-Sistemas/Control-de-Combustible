// ACARREO · componentes de UI compartidos (desplegable buscable, etiquetas).
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { norm } from '../../lib/text';

export type Opt = { value: string; label: string };

export function FieldLabel({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return <Text style={{ color: colors.muted, fontSize: 12.5, marginTop: spacing.sm, marginBottom: 2 }}>{children}</Text>;
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, marginTop: spacing.md, marginBottom: 2 }}>{children}</Text>
  );
}

/** Desplegable (toggle) buscable. `clearable` agrega la opción de vaciar. */
export function Dropdown({
  value, options, onChange, placeholder = 'Seleccionar…', clearable = true,
}: {
  value?: string | null;
  options: Opt[];
  onChange: (v: string) => void;
  placeholder?: string;
  clearable?: boolean;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const selected = options.find((o) => o.value === value);
  const nq = norm(q.trim());
  const filtered = nq ? options.filter((o) => norm(o.label).includes(nq)) : options;
  const showSearch = options.length > 6;
  const close = () => { setOpen(false); setQ(''); };

  return (
    <View>
      <TouchableOpacity
        onPress={() => (open ? close() : setOpen(true))}
        activeOpacity={0.8}
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Text style={{ color: selected ? colors.text : colors.muted, fontSize: 15, flex: 1 }} numberOfLines={1}>
          {selected ? selected.label : placeholder}
        </Text>
        <Text style={{ color: colors.primary, fontWeight: '800', marginLeft: spacing.sm }}>{open ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {open ? (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderTopWidth: 0, borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md, maxHeight: 280, overflow: 'hidden' }}>
          {showSearch ? (
            <TextInput
              value={q} onChangeText={setQ} placeholder="🔎 Buscar…" placeholderTextColor={colors.muted} autoFocus
              style={{ padding: spacing.sm, color: colors.text, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}
            />
          ) : null}
          <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {clearable ? (
              <TouchableOpacity onPress={() => { onChange(''); close(); }} style={{ paddingVertical: 10, paddingHorizontal: spacing.md }}>
                <Text style={{ color: colors.muted, fontSize: 14, fontStyle: 'italic' }}>— Sin seleccionar</Text>
              </TouchableOpacity>
            ) : null}
            {filtered.map((o) => {
              const active = o.value === value;
              return (
                <TouchableOpacity key={o.value} onPress={() => { onChange(o.value); close(); }}
                  style={{ paddingVertical: 10, paddingHorizontal: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: active ? colors.primary : 'transparent' }}>
                  <Text style={{ color: active ? colors.primaryContrast : colors.text, fontSize: 14, fontWeight: active ? '800' : '500' }}>{o.label}</Text>
                </TouchableOpacity>
              );
            })}
            {filtered.length === 0 ? <Text style={{ color: colors.muted, padding: spacing.md, fontSize: 13 }}>Sin resultados.</Text> : null}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  programado: { label: 'Programado', color: '#6B7280' },
  en_carga: { label: 'En carga', color: '#D97706' },
  en_transito: { label: 'En tránsito', color: '#2563EB' },
  en_descarga: { label: 'En descarga', color: '#7C3AED' },
  completado: { label: 'Completado', color: '#059669' },
  cancelado: { label: 'Cancelado', color: '#DC2626' },
};
export const statusMeta = (s: string) => STATUS_META[s] ?? { label: s, color: '#6B7280' };

export function StatusBadge({ status }: { status: string }) {
  const m = statusMeta(status);
  return (
    <View style={{ backgroundColor: m.color, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{m.label}</Text>
    </View>
  );
}
