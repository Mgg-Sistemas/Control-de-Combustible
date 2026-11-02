// 🚜 Selector de uno o varios equipos / tanques (02-nov-2026). El mismo en todo
// Combustible. Nada elegido = todos. Buscador por código, placa, serial o nombre;
// lo elegido queda en chips con ✕. Compacto para el teléfono (lista con tope).
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { OpcionSeleccion, buscarOpciones } from '../../lib/combustibleEquipos';

export default function SelectorMultiple({ titulo, todosTexto, opciones, seleccion, onChange, placeholder }: {
  titulo: string;
  /** Lo que dice cuando no hay nada elegido («Todos los equipos»). */
  todosTexto: string;
  opciones: OpcionSeleccion[];
  seleccion: string[];
  onChange: (sel: string[]) => void;
  placeholder?: string;
}) {
  const { colors } = useTheme();
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState('');
  const porKey = useMemo(() => new Map(opciones.map((o) => [o.key, o])), [opciones]);
  const visibles = useMemo(() => buscarOpciones(opciones, q, 60), [opciones, q]);
  const sel = new Set(seleccion);
  const alternar = (k: string) => onChange(sel.has(k) ? seleccion.filter((x) => x !== k) : [...seleccion, k]);

  return (
    <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: seleccion.length ? colors.brand : colors.border, borderRadius: radius.md, padding: spacing.sm, gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
        <Pressable onPress={() => setAbierto((v) => !v)} style={{ flexShrink: 1 }}>
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>
            {titulo}: <Text style={{ color: seleccion.length ? colors.brandText : colors.muted }}>{seleccion.length ? `${seleccion.length} elegido(s)` : todosTexto}</Text>
            {'  '}<Text style={{ color: colors.brandText }}>{abierto ? '▴' : '▾ Elegir'}</Text>
          </Text>
        </Pressable>
        {seleccion.length ? (
          <Pressable onPress={() => onChange([])}>
            <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 11 }}>✕ Limpiar</Text>
          </Pressable>
        ) : null}
      </View>

      {seleccion.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {seleccion.map((k) => (
            <Pressable key={k} onPress={() => alternar(k)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, backgroundColor: colors.brand, paddingVertical: 4, paddingHorizontal: spacing.sm }}>
              <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 11 }}>{porKey.get(k)?.label ?? k} ✕</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {abierto ? (
        <View style={{ gap: 4 }}>
          <TextInput value={q} onChangeText={setQ} placeholder={placeholder || 'Buscar por código, placa, serial o nombre…'} placeholderTextColor={colors.muted} autoCapitalize="characters"
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 6, color: colors.text, backgroundColor: colors.surfaceAlt, fontSize: 13 }} />
          <ScrollView style={{ maxHeight: 260 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {visibles.length === 0 ? <Text style={{ color: colors.muted, fontSize: 12, padding: 4 }}>Sin resultados.</Text> : null}
            {visibles.map((o) => {
              const on = sel.has(o.key);
              return (
                <Pressable key={o.key} onPress={() => alternar(o.key)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Text style={{ fontSize: 15, color: on ? colors.brandText : colors.muted }}>{on ? '☑' : '☐'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>{o.label}</Text>
                    {o.sub ? <Text style={{ color: colors.muted, fontSize: 11 }}>{o.sub}</Text> : null}
                  </View>
                </Pressable>
              );
            })}
            {opciones.length > visibles.length && !q.trim() ? (
              <Text style={{ color: colors.muted, fontSize: 11, padding: 4 }}>Escribe para buscar entre los {opciones.length}.</Text>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}
