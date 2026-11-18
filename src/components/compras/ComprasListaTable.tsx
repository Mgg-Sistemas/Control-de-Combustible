// ≡ Vista Lista Compacta Responsiva para Compras (PC en tabla densa · Teléfono en filas apiladas) (18-nov-2026)
import React, { memo, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, useWindowDimensions } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { OrdenVistaItem } from '../../lib/comprasVista';

const fmtUsd = (n: number) =>
  `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function toneColors(colors: any, tono: OrdenVistaItem['estadoTono']) {
  switch (tono) {
    case 'warning':
      return { bg: colors.warningSoftBg, border: colors.warningSoftBorder, text: colors.warningSoftText };
    case 'danger':
      return { bg: colors.dangerSoftBg, border: colors.dangerSoftBorder, text: colors.dangerSoftText };
    case 'success':
      return { bg: colors.successSoftBg, border: colors.successSoftBorder, text: colors.successSoftText };
    case 'info':
      return { bg: colors.infoSoftBg, border: colors.infoSoftBorder, text: colors.infoSoftText };
    default:
      return { bg: colors.surfaceAlt, border: colors.border, text: colors.muted };
  }
}

interface ListaRowProps<T> {
  item: OrdenVistaItem<T>;
  isPhone: boolean;
  index: number;
  selected?: boolean;
  showCheckbox?: boolean;
  onPress: (item: OrdenVistaItem<T>) => void;
  onToggleSelect?: (id: string) => void;
}

const ListaRowInner = <T,>({
  item,
  isPhone,
  index,
  selected,
  showCheckbox,
  onPress,
  onToggleSelect,
}: ListaRowProps<T>) => {
  const { colors } = useTheme();
  const tc = toneColors(colors, item.estadoTono);
  const bg = selected
    ? colors.infoSoftBg
    : index % 2 === 1
      ? colors.surfaceAlt
      : colors.surface;

  if (isPhone) {
    return (
      <TouchableOpacity
        onPress={() => onPress(item)}
        activeOpacity={0.75}
        style={{
          backgroundColor: bg,
          paddingVertical: spacing.sm + 2,
          paddingHorizontal: spacing.md,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          borderLeftWidth: item.esUrgente ? 4 : 0,
          borderLeftColor: colors.danger,
          gap: 4,
        }}
      >
        {/* Línea 1: Checkbox + Código + Urgente | Monto */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, flexWrap: 'wrap' }}>
            {showCheckbox && onToggleSelect ? (
              <TouchableOpacity
                onPress={(e) => {
                  e?.stopPropagation?.();
                  onToggleSelect(item.id);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  borderWidth: 1.5,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.primary : colors.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {selected ? <Text style={{ color: colors.primaryContrast, fontSize: 12, fontWeight: '900' }}>✓</Text> : null}
              </TouchableOpacity>
            ) : null}
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13 }}>{item.codigo}</Text>
            {item.esUrgente ? (
              <View style={{ backgroundColor: colors.dangerSoftBg, borderWidth: 1, borderColor: colors.dangerSoftBorder, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1 }}>
                <Text style={{ color: colors.dangerSoftText, fontSize: 9.5, fontWeight: '900' }}>🔥 URGENTE</Text>
              </View>
            ) : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13.5, fontVariant: ['tabular-nums'] as any }}>
              {fmtUsd(item.saldoUsd > 0 && item.saldoUsd !== item.montoUsd ? item.saldoUsd : item.montoUsd)}
            </Text>
            {item.montoBsTexto ? (
              <Text style={{ color: colors.muted, fontSize: 10 }}>{item.montoBsTexto}</Text>
            ) : null}
          </View>
        </View>

        {/* Línea 2: Estado + Empresa + Maquinaria */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          <View style={{ backgroundColor: tc.bg, borderWidth: 1, borderColor: tc.border, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 1 }}>
            <Text style={{ color: tc.text, fontSize: 10.5, fontWeight: '800' }}>{item.estadoLabel}</Text>
          </View>
          <Text style={{ color: colors.brandText, fontSize: 11.5, fontWeight: '700' }} numberOfLines={1}>
            🏢 {item.empresaNombre || 'General'}
          </Text>
          {item.maquinariaTexto ? (
            <Text style={{ color: colors.muted, fontSize: 11 }} numberOfLines={1}>
              · 🚜 {item.maquinariaTexto}
            </Text>
          ) : null}
        </View>

        {/* Línea 3: Solicitante · Proveedor · Ítems · Fecha */}
        <Text style={{ color: colors.muted, fontSize: 11.5 }} numberOfLines={1}>
          {item.solicitanteNombre ? `👤 ${item.solicitanteNombre} · ` : ''}
          {item.proveedorNombre ? `🏭 ${item.proveedorNombre}` : 'Sin proveedor'}
          {` · ${item.itemsCount} ítem(s) · ${item.fechaCorta}`}
        </Text>
      </TouchableOpacity>
    );
  }

  // Modo PC: Fila de tabla proporcional
  return (
    <TouchableOpacity
      onPress={() => onPress(item)}
      activeOpacity={0.75}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: bg,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        borderLeftWidth: item.esUrgente ? 4 : 0,
        borderLeftColor: colors.danger,
        gap: spacing.sm,
      }}
    >
      {showCheckbox && onToggleSelect ? (
        <TouchableOpacity
          onPress={(e) => {
            e?.stopPropagation?.();
            onToggleSelect(item.id);
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{
            width: 20,
            height: 20,
            borderRadius: 4,
            borderWidth: 1.5,
            borderColor: selected ? colors.primary : colors.border,
            backgroundColor: selected ? colors.primary : colors.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {selected ? <Text style={{ color: colors.primaryContrast, fontSize: 12, fontWeight: '900' }}>✓</Text> : null}
        </TouchableOpacity>
      ) : null}

      {/* Código + Fecha + Urgente */}
      <View style={{ flex: 1.0, minWidth: 105, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <Text style={{ color: colors.text, fontWeight: '900', fontSize: 12.5 }}>{item.codigo}</Text>
          {item.esUrgente ? (
            <View style={{ backgroundColor: colors.dangerSoftBg, borderWidth: 1, borderColor: colors.dangerSoftBorder, borderRadius: radius.pill, paddingHorizontal: 5, paddingVertical: 1 }}>
              <Text style={{ color: colors.dangerSoftText, fontSize: 9, fontWeight: '900' }}>🔥</Text>
            </View>
          ) : null}
        </View>
        <Text style={{ color: colors.muted, fontSize: 11 }}>{item.fechaCorta}</Text>
      </View>

      {/* Estado */}
      <View style={{ flex: 1.25, minWidth: 125 }}>
        <View style={{ backgroundColor: tc.bg, borderWidth: 1, borderColor: tc.border, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2, alignSelf: 'flex-start' }}>
          <Text style={{ color: tc.text, fontSize: 10.5, fontWeight: '800' }} numberOfLines={1}>
            {item.estadoLabel}
          </Text>
        </View>
      </View>

      {/* Empresa / Maquinaria (con placa) */}
      <View style={{ flex: 1.35, minWidth: 130, gap: 1 }}>
        <Text style={{ color: colors.brandText, fontSize: 11.5, fontWeight: '700' }} numberOfLines={1}>
          {item.empresaNombre || 'General'}
        </Text>
        {item.maquinariaTexto ? (
          <Text style={{ color: colors.muted, fontSize: 10.5 }} numberOfLines={1}>
            🚜 {item.maquinariaTexto}
          </Text>
        ) : null}
      </View>

      {/* Solicitante / Proveedor */}
      <View style={{ flex: 1.5, minWidth: 145, gap: 1 }}>
        {item.solicitanteNombre ? (
          <Text style={{ color: colors.text, fontSize: 11.5 }} numberOfLines={1}>
            👤 {item.solicitanteNombre}
          </Text>
        ) : null}
        <Text style={{ color: item.proveedorNombre ? colors.muted : colors.warning, fontSize: 11, fontWeight: item.proveedorNombre ? '600' : '700' }} numberOfLines={1}>
          🏭 {item.proveedorNombre || 'Sin proveedor'}
        </Text>
      </View>

      {/* Título / Ítems */}
      <View style={{ flex: 1.4, minWidth: 130, gap: 1 }}>
        <Text style={{ color: colors.text, fontSize: 11.5, fontWeight: '600' }} numberOfLines={1}>
          {item.titulo || '—'}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 10.5 }}>
          {item.itemsCount} {item.itemsCount === 1 ? 'ítem' : 'ítems'}
          {item.monedaBadge ? ` · ${item.monedaBadge}` : ''}
        </Text>
      </View>

      {/* Monto */}
      <View style={{ flex: 1.0, minWidth: 100, alignItems: 'flex-end' }}>
        <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13, fontVariant: ['tabular-nums'] as any }}>
          {fmtUsd(item.saldoUsd > 0 && item.saldoUsd !== item.montoUsd ? item.saldoUsd : item.montoUsd)}
        </Text>
        {item.montoBsTexto ? (
          <Text style={{ color: colors.muted, fontSize: 10, fontVariant: ['tabular-nums'] as any }}>
            {item.montoBsTexto}
          </Text>
        ) : null}
      </View>

      {/* Acción */}
      <View style={{ width: 64, alignItems: 'flex-end' }}>
        <View
          style={{
            backgroundColor: colors.surfaceAlt,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.sm,
            paddingHorizontal: 8,
            paddingVertical: 4,
          }}
        >
          <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 11 }}>Abrir</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const ListaRow = memo(ListaRowInner) as typeof ListaRowInner;

export interface ComprasListaTableProps<T> {
  filas: OrdenVistaItem<T>[];
  onSelectItem: (item: OrdenVistaItem<T>) => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleAll?: () => void;
  emptyText?: string;
}

export function ComprasListaTable<T>({
  filas,
  onSelectItem,
  selectedIds,
  onToggleSelect,
  onToggleAll,
  emptyText = 'Sin registros para mostrar',
}: ComprasListaTableProps<T>) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const isPhone = width < 768;
  const [sortBy, setSortBy] = useState<'default' | 'monto' | 'fecha'>('default');
  const [sortAsc, setSortAsc] = useState(false);

  const filasOrdenadas = useMemo(() => {
    if (sortBy === 'default') return filas;
    return [...filas].sort((a, b) => {
      if (sortBy === 'monto') {
        const diff = (Number(a.montoUsd) || 0) - (Number(b.montoUsd) || 0);
        return sortAsc ? diff : -diff;
      }
      const cmp = String(a.fechaIso || '').localeCompare(String(b.fechaIso || ''));
      return sortAsc ? cmp : -cmp;
    });
  }, [filas, sortBy, sortAsc]);

  const toggleSort = (col: 'monto' | 'fecha') => {
    if (sortBy === col) {
      setSortAsc((p) => !p);
    } else {
      setSortBy(col);
      setSortAsc(false);
    }
  };

  const showCheckbox = !!onToggleSelect;
  const allSelected = filas.length > 0 && !!selectedIds && filas.every((f) => selectedIds.has(f.id));

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: 'hidden',
      }}
    >
      {/* Cabecera de tabla (en PC) */}
      {!isPhone ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: colors.surfaceAlt,
            paddingVertical: spacing.sm,
            paddingHorizontal: spacing.md,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
            gap: spacing.sm,
          }}
        >
          {showCheckbox && onToggleAll ? (
            <TouchableOpacity
              onPress={onToggleAll}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{
                width: 20,
                height: 20,
                borderRadius: 4,
                borderWidth: 1.5,
                borderColor: allSelected ? colors.primary : colors.border,
                backgroundColor: allSelected ? colors.primary : colors.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {allSelected ? <Text style={{ color: colors.primaryContrast, fontSize: 12, fontWeight: '900' }}>✓</Text> : null}
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={() => toggleSort('fecha')} style={{ flex: 1.0, minWidth: 105 }}>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' }}>
              Orden {sortBy === 'fecha' ? (sortAsc ? '↑' : '↓') : ''}
            </Text>
          </TouchableOpacity>
          <View style={{ flex: 1.25, minWidth: 125 }}>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' }}>Estado</Text>
          </View>
          <View style={{ flex: 1.35, minWidth: 130 }}>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' }}>Empresa / Unidad</Text>
          </View>
          <View style={{ flex: 1.5, minWidth: 145 }}>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' }}>Solicita / Proveedor</Text>
          </View>
          <View style={{ flex: 1.4, minWidth: 130 }}>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' }}>Detalle</Text>
          </View>
          <TouchableOpacity onPress={() => toggleSort('monto')} style={{ flex: 1.0, minWidth: 100, alignItems: 'flex-end' }}>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' }}>
              Monto {sortBy === 'monto' ? (sortAsc ? '↑' : '↓') : ''}
            </Text>
          </TouchableOpacity>
          <View style={{ width: 64, alignItems: 'flex-end' }}>
            <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' }}>Ver</Text>
          </View>
        </View>
      ) : null}

      {filasOrdenadas.length === 0 ? (
        <View style={{ padding: spacing.lg, alignItems: 'center' }}>
          <Text style={{ color: colors.muted, fontSize: 13 }}>{emptyText}</Text>
        </View>
      ) : (
        filasOrdenadas.map((item, idx) => (
          <ListaRow
            key={item.id}
            item={item}
            isPhone={isPhone}
            index={idx}
            selected={selectedIds?.has(item.id)}
            showCheckbox={showCheckbox}
            onPress={onSelectItem}
            onToggleSelect={onToggleSelect}
          />
        ))
      )}
    </View>
  );
}
