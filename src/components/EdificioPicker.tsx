// Desplegable ÚNICO de EDIFICIO, usado en todas las vistas de teléfono (inspector,
// combustible, etc.). Lee el catálogo compartido de `public.edificios`, deja buscar
// y —si el edificio no existe— agregarlo con "➕". Un solo campo EDIFICIO en todo el
// sistema (ya no hay "referencia" aparte). Ver src/lib/edificios.ts.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { fetchEdificios, addEdificio } from '../lib/edificios';
import { norm } from '../lib/text';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

type Props = {
  value: string;
  onChange: (name: string) => void;
  label?: string;          // por defecto "Edificio"
  placeholder?: string;    // por defecto "Selecciona el edificio…"
};

export default function EdificioPicker({ value, onChange, label = 'Edificio', placeholder = 'Selecciona el edificio…' }: Props) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setList(await fetchEdificios()); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const n = norm(q);
    return n ? list.filter((e) => norm(e).includes(n)) : list;
  }, [list, q]);

  // ¿Lo que se escribió NO existe todavía? → ofrecer agregarlo.
  const exacta = useMemo(() => list.some((e) => norm(e) === norm(q)), [list, q]);
  const puedeAgregar = q.trim().length >= 2 && !exacta;

  const agregar = async () => {
    const nombre = q.trim();
    if (!nombre) return;
    setAdding(true);
    try {
      const saved = await addEdificio(nombre);
      if (saved) {
        await load();
        onChange(saved);
        setQ('');
        setOpen(false);
      }
    } finally {
      setAdding(false);
    }
  };

  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, color: colors.text, fontSize: 14 } as const;

  return (
    <View>
      <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>{label}</Text>
      <TouchableOpacity
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.8}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md }}
      >
        <Text style={{ color: value ? colors.text : colors.muted, fontSize: 14, flex: 1 }} numberOfLines={1}>
          {value || placeholder}
        </Text>
        <Text style={{ color: colors.primary, fontWeight: '800' }}>{open ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {open ? (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, marginTop: 4, overflow: 'hidden' }}>
          <TextInput
            value={q}
            // Combobox: lo que se escribe ES el valor (se refleja al guardar aunque
            // NO se toque "➕ Agregar"). Elegir una sugerencia lo reemplaza; el ➕ y el
            // guardado registran el nombre nuevo en el catálogo compartido.
            onChangeText={(t) => { setQ(t); onChange(t); }}
            placeholder="🔎 Buscar o escribir edificio…"
            placeholderTextColor={colors.muted}
            style={[input, { borderWidth: 0, borderBottomWidth: 1, borderBottomColor: colors.border, borderRadius: 0 }]}
          />
          {puedeAgregar ? (
            <TouchableOpacity onPress={agregar} disabled={adding} style={{ paddingVertical: 10, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surfaceAlt }}>
              <Text style={{ color: colors.primary, fontSize: 14, fontWeight: '800' }}>
                {adding ? 'Agregando…' : `➕ Agregar "${q.trim()}"`}
              </Text>
            </TouchableOpacity>
          ) : null}
          <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {loading ? (
              <View style={{ padding: spacing.md, alignItems: 'center' }}><ActivityIndicator color={colors.primary} /></View>
            ) : filtered.length ? (
              filtered.map((e) => (
                <TouchableOpacity key={e} onPress={() => { onChange(e); setQ(''); setOpen(false); }} style={{ paddingVertical: 10, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: value === e ? colors.surfaceAlt : colors.surface }}>
                  <Text style={{ color: colors.text, fontSize: 14 }}>{value === e ? '✓ ' : ''}{e}</Text>
                </TouchableOpacity>
              ))
            ) : (
              <View style={{ padding: spacing.md }}><Text style={{ color: colors.muted, fontSize: 13 }}>Sin resultados. Escribe el nombre y toca ➕ para agregarlo.</Text></View>
            )}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}
