// Editor de renglones de una receta (BoM): lista de componentes con cantidad
// por unidad de salida, unidad, % de merma, sustitutos y notas. Modelado sobre
// el editor de renglones JSONB de ComprasScreen (LineEditor: tarjeta por
// renglón + "+ Agregar renglón") y el buscador desplegable de equipo de
// ManguerasScreen (botón que abre una lista buscable y se cierra al elegir).
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { norm, cmpText } from '../lib/text';
import { InventoryItem, BomComponentLine } from '../types/database';

function parseNum(t: string): number {
  const n = Number(String(t ?? '').replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : 0;
}
function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/** Selector buscable de un producto de inventario: botón que muestra el
 *  elegido y, al tocarlo, despliega una lista filtrable (se cierra al elegir).
 *  Mismo espíritu que el filtro de equipo de ManguerasScreen. */
function ItemPicker({
  items,
  value,
  onPick,
  placeholder = 'Seleccionar producto…',
}: {
  items: InventoryItem[];
  value?: string | null;
  onPick: (item: InventoryItem) => void;
  placeholder?: string;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = value ? items.find((i) => i.id === value) : undefined;
  const q = norm(query.trim());
  const filtered = useMemo(() => {
    const list = q ? items.filter((i) => norm(`${i.name} ${i.sku ?? ''}`).includes(q)) : items;
    return list.slice().sort((a, b) => cmpText(a.name, b.name)).slice(0, 30);
  }, [items, q]);

  const close = () => { setOpen(false); setQuery(''); };

  return (
    <View>
      <TouchableOpacity
        onPress={() => (open ? close() : setOpen(true))}
        activeOpacity={0.8}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm }}
      >
        <Text style={{ color: selected ? colors.text : colors.muted, fontSize: 13, flex: 1, fontWeight: selected ? '700' : '400' }} numberOfLines={1}>
          {selected ? selected.name : placeholder}
        </Text>
        <Text style={{ color: colors.brandText, fontWeight: '800' }}>{open ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {open ? (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderTopWidth: 0, borderBottomLeftRadius: radius.md, borderBottomRightRadius: radius.md, maxHeight: 240, overflow: 'hidden' }}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="🔎 Buscar producto…"
            placeholderTextColor={colors.muted}
            autoFocus
            style={{ padding: spacing.sm, color: colors.text, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}
          />
          <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {filtered.length === 0 ? (
              <Text style={{ color: colors.muted, padding: spacing.md, fontSize: 13 }}>Sin resultados.</Text>
            ) : filtered.map((it) => {
              const active = it.id === value;
              return (
                <TouchableOpacity key={it.id} onPress={() => { onPick(it); close(); }} style={{ paddingVertical: 10, paddingHorizontal: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: active ? colors.primary : 'transparent' }}>
                  <Text style={{ color: active ? colors.primaryContrast : colors.text, fontSize: 13, fontWeight: active ? '800' : '600' }}>{it.name}</Text>
                  {it.unit ? <Text style={{ color: active ? colors.primaryContrast : colors.muted, fontSize: 11 }}>Unidad: {it.unit}</Text> : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

/** Editor de la lista de componentes de una receta (BoM). `items` es el
 *  catálogo buscable de `inventory_items` (se carga UNA vez en la pantalla y
 *  se pasa como prop, igual que `catalog` en ComprasScreen.LineEditor). */
export function BomLinesEditor({
  value,
  onChange,
  items,
  readOnly,
}: {
  value: BomComponentLine[];
  onChange: (lines: BomComponentLine[]) => void;
  items: InventoryItem[];
  readOnly?: boolean;
}) {
  const { colors } = useTheme();
  const itemsById = useMemo(() => {
    const m: Record<string, InventoryItem> = {};
    items.forEach((i) => { m[i.id] = i; });
    return m;
  }, [items]);

  // Índice de la línea que tiene abierto su buscador de "+ agregar sustituto"
  // (uno solo a la vez, para no saturar la pantalla).
  const [subPickerFor, setSubPickerFor] = useState<number | null>(null);

  const upd = (i: number, patch: Partial<BomComponentLine>) =>
    onChange(value.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) => onChange(value.filter((_, j) => j !== i));
  const addLine = () =>
    onChange([...value, { component_item_id: '', qty_per_output: 1, unit: '', waste_pct: 0, substitutes: [], notes: '' }]);

  const pickComponent = (i: number, it: InventoryItem) => {
    // Autocompleta la unidad desde el producto elegido, si el renglón aún no tenía una.
    upd(i, { component_item_id: it.id, unit: value[i]?.unit || it.unit || '' });
  };
  const addSubstitute = (i: number, it: InventoryItem) => {
    const current = value[i]?.substitutes ?? [];
    if (current.some((s) => s.item_id === it.id)) return; // ya está agregado
    upd(i, { substitutes: [...current, { item_id: it.id, name: it.name }] });
  };
  const removeSubstitute = (i: number, itemId: string) => {
    upd(i, { substitutes: (value[i]?.substitutes ?? []).filter((s) => s.item_id !== itemId) });
  };

  const inputStyle = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 6, color: colors.text, fontSize: 13 } as const;

  return (
    <View style={{ gap: spacing.sm }}>
      {value.map((line, i) => {
        const comp = line.component_item_id ? itemsById[line.component_item_id] : undefined;
        return (
          <View key={i} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, gap: 6, backgroundColor: colors.surfaceAlt }}>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '700' }}>Componente</Text>
            {readOnly ? (
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{comp?.name ?? '—'}</Text>
            ) : (
              <ItemPicker items={items} value={line.component_item_id} onPick={(it) => pickComponent(i, it)} />
            )}

            <View style={{ flexDirection: 'row', gap: 6 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Cant. por unidad</Text>
                <TextInput
                  value={line.qty_per_output ? String(line.qty_per_output) : ''}
                  editable={!readOnly}
                  onChangeText={(t) => upd(i, { qty_per_output: parseNum(t) })}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={colors.muted}
                  style={inputStyle}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Unidad</Text>
                <TextInput
                  value={line.unit ?? ''}
                  editable={!readOnly}
                  onChangeText={(t) => upd(i, { unit: t.toUpperCase() })}
                  placeholder="UND"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="characters"
                  style={inputStyle}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Merma %</Text>
                <TextInput
                  value={line.waste_pct != null ? String(line.waste_pct) : ''}
                  editable={!readOnly}
                  onChangeText={(t) => upd(i, { waste_pct: clampPct(parseNum(t)) })}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={colors.muted}
                  style={inputStyle}
                />
              </View>
            </View>

            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>Notas (opcional)</Text>
            <TextInput
              value={line.notes ?? ''}
              editable={!readOnly}
              onChangeText={(t) => upd(i, { notes: t.toUpperCase() })}
              placeholder="OBSERVACIÓN…"
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
              style={inputStyle}
            />

            {/* Sustitutos: chips + "+ agregar sustituto" (abre el mismo buscador de productos). */}
            <View style={{ marginTop: 2 }}>
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>Sustitutos</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {(line.substitutes ?? []).map((s) => (
                  <View key={s.item_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.infoSoftBg, borderWidth: 1, borderColor: colors.infoSoftBorder, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 }}>
                    <Text style={{ color: colors.infoSoftText, fontSize: 11, fontWeight: '700' }}>{s.name}</Text>
                    {!readOnly ? (
                      <TouchableOpacity onPress={() => removeSubstitute(i, s.item_id)}>
                        <Text style={{ color: colors.infoSoftText, fontWeight: '900', fontSize: 12 }}>✕</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ))}
                {!readOnly ? (
                  <TouchableOpacity onPress={() => setSubPickerFor(subPickerFor === i ? null : i)} style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 }}>
                    <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '700' }}>+ agregar sustituto</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              {subPickerFor === i ? (
                <View style={{ marginTop: spacing.xs }}>
                  <ItemPicker
                    items={items.filter((it) => it.id !== line.component_item_id)}
                    onPick={(it) => { addSubstitute(i, it); setSubPickerFor(null); }}
                    placeholder="Buscar sustituto…"
                  />
                </View>
              ) : null}
            </View>

            {!readOnly ? (
              <TouchableOpacity onPress={() => removeLine(i)} style={{ alignSelf: 'flex-end', marginTop: 2 }}>
                <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>🗑️ Quitar componente</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        );
      })}

      {!readOnly ? (
        <TouchableOpacity onPress={addLine} style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
          <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 13 }}>+ Agregar componente</Text>
        </TouchableOpacity>
      ) : null}
      {value.length === 0 ? (
        <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center' }}>Sin componentes. Agrega el primero.</Text>
      ) : null}
    </View>
  );
}
