// 🗂️ Tablero Kanban Responsivo para Compras (PC en columnas · Teléfono en selector de columna) (18-nov-2026)
import React, { memo, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, useWindowDimensions } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { ColumnaKanbanConItems, OrdenVistaItem } from '../../lib/comprasVista';

const fmtUsd = (n: number) =>
  `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function colorTono(colors: any, tono: ColumnaKanbanConItems['tono']) {
  switch (tono) {
    case 'warning':
      return {
        accent: colors.warning,
        bg: colors.warningSoftBg,
        border: colors.warningSoftBorder,
        text: colors.warningSoftText,
      };
    case 'danger':
      return {
        accent: colors.danger,
        bg: colors.dangerSoftBg,
        border: colors.dangerSoftBorder,
        text: colors.dangerSoftText,
      };
    case 'success':
      return {
        accent: colors.success,
        bg: colors.successSoftBg,
        border: colors.successSoftBorder,
        text: colors.successSoftText,
      };
    case 'info':
      return {
        accent: colors.info,
        bg: colors.infoSoftBg,
        border: colors.infoSoftBorder,
        text: colors.infoSoftText,
      };
    default:
      return {
        accent: colors.muted,
        bg: colors.surfaceAlt,
        border: colors.border,
        text: colors.muted,
      };
  }
}

interface KanbanCardProps<T> {
  item: OrdenVistaItem<T>;
  accentColor: string;
  selected?: boolean;
  showCheckbox?: boolean;
  onPress: (item: OrdenVistaItem<T>) => void;
  onToggleSelect?: (id: string) => void;
  renderQuickAction?: (item: OrdenVistaItem<T>) => React.ReactNode;
}

const KanbanCardInner = <T,>({
  item,
  accentColor,
  selected,
  showCheckbox,
  onPress,
  onToggleSelect,
  renderQuickAction,
}: KanbanCardProps<T>) => {
  const { colors } = useTheme();
  const bordeIzq = item.esUrgente ? colors.danger : accentColor;

  return (
    <TouchableOpacity
      onPress={() => onPress(item)}
      activeOpacity={0.78}
      style={{
        backgroundColor: colors.surface,
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: selected ? colors.primary : item.esUrgente ? colors.danger : colors.border,
        borderLeftWidth: 4,
        borderLeftColor: bordeIzq,
        padding: spacing.sm + 2,
        gap: 5,
      }}
    >
      {/* Cabecera: Código + Urgente + Checkbox */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, flexWrap: 'wrap' }}>
          {showCheckbox && onToggleSelect ? (
            <TouchableOpacity
              onPress={(e) => {
                e?.stopPropagation?.();
                onToggleSelect(item.id);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: !!selected }}
              style={{
                width: 20,
                height: 20,
                borderRadius: 4,
                borderWidth: 1.5,
                borderColor: selected ? colors.primary : colors.border,
                backgroundColor: selected ? colors.primary : colors.surfaceAlt,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {selected ? (
                <Text style={{ color: colors.primaryContrast, fontSize: 12, fontWeight: '900' }}>✓</Text>
              ) : null}
            </TouchableOpacity>
          ) : null}
          <Text style={{ color: colors.text, fontWeight: '900', fontSize: 12.5 }}>
            {item.codigo}
          </Text>
          {item.esUrgente ? (
            <View
              style={{
                backgroundColor: colors.dangerSoftBg,
                borderWidth: 1,
                borderColor: colors.dangerSoftBorder,
                borderRadius: radius.pill,
                paddingHorizontal: 6,
                paddingVertical: 1,
              }}
            >
              <Text style={{ color: colors.dangerSoftText, fontSize: 9.5, fontWeight: '900' }}>
                🔥 {item.motivoUrgencia ? item.motivoUrgencia.toUpperCase() : 'URGENTE'}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={{ color: colors.muted, fontSize: 10.5, fontWeight: '600' }}>
          {item.fechaCorta}
        </Text>
      </View>

      {/* Título / Primer ítem */}
      {item.titulo ? (
        <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }} numberOfLines={2}>
          {item.titulo}
        </Text>
      ) : null}

      {/* Empresa + Maquinaria (siempre con placa) */}
      <View style={{ gap: 2 }}>
        <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '700' }} numberOfLines={1}>
          🏢 {item.empresaNombre || 'General'}
        </Text>
        {item.maquinariaTexto ? (
          <Text style={{ color: colors.muted, fontSize: 10.5, fontWeight: '600' }} numberOfLines={1}>
            🚜 {item.maquinariaTexto}
          </Text>
        ) : null}
      </View>

      {/* Solicitante y Proveedor */}
      <View style={{ gap: 2 }}>
        {item.solicitanteNombre ? (
          <Text style={{ color: colors.muted, fontSize: 11 }} numberOfLines={1}>
            👤 {item.solicitanteNombre}
          </Text>
        ) : null}
        <Text
          style={{
            color: item.proveedorNombre ? colors.text : colors.warning,
            fontSize: 11,
            fontWeight: item.proveedorNombre ? '600' : '700',
          }}
          numberOfLines={1}
        >
          🏭 {item.proveedorNombre || 'Sin proveedor asignado'}
        </Text>
      </View>

      {/* Pie financiero */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          paddingTop: 5,
          marginTop: 2,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          gap: 6,
        }}
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, flex: 1 }}>
          <Text style={{ color: colors.muted, fontSize: 10.5, fontWeight: '600' }}>
            {item.itemsCount} {item.itemsCount === 1 ? 'ítem' : 'ítems'}
          </Text>
          {item.monedaBadge ? (
            <View
              style={{
                backgroundColor: colors.surfaceAlt,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.pill,
                paddingHorizontal: 5,
                paddingVertical: 1,
              }}
            >
              <Text style={{ color: colors.text, fontSize: 9.5, fontWeight: '700' }}>
                {item.monedaBadge}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13.5, fontVariant: ['tabular-nums'] as any }}>
            {fmtUsd(item.saldoUsd > 0 && item.saldoUsd !== item.montoUsd ? item.saldoUsd : item.montoUsd)}
          </Text>
          {item.montoBsTexto ? (
            <Text style={{ color: colors.muted, fontSize: 10, fontWeight: '600', fontVariant: ['tabular-nums'] as any }}>
              {item.montoBsTexto}
            </Text>
          ) : null}
        </View>
      </View>

      {renderQuickAction ? (
        <View style={{ marginTop: 4 }}>{renderQuickAction(item)}</View>
      ) : null}
    </TouchableOpacity>
  );
};

const KanbanCard = memo(KanbanCardInner) as typeof KanbanCardInner;

export interface ComprasKanbanBoardProps<T> {
  columnas: ColumnaKanbanConItems<T>[];
  onSelectItem: (item: OrdenVistaItem<T>) => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleColumna?: (ids: string[], allSelected: boolean) => void;
  renderQuickAction?: (item: OrdenVistaItem<T>) => React.ReactNode;
  emptyText?: string;
}

export function ComprasKanbanBoard<T>({
  columnas,
  onSelectItem,
  selectedIds,
  onToggleSelect,
  onToggleColumna,
  renderQuickAction,
  emptyText = 'Sin órdenes en esta columna',
}: ComprasKanbanBoardProps<T>) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const isPhone = width < 768;

  // En móvil, seleccionar por defecto la primera columna con ítems (o la primera)
  const [colMovilId, setColMovilId] = useState<string>(
    () => columnas.find((c) => c.count > 0)?.id ?? columnas[0]?.id ?? '',
  );

  useEffect(() => {
    if (!columnas.some((c) => c.id === colMovilId)) {
      setColMovilId(columnas.find((c) => c.count > 0)?.id ?? columnas[0]?.id ?? '');
    }
  }, [columnas, colMovilId]);

  const showCheckbox = !!onToggleSelect;

  if (isPhone) {
    const colActiva = columnas.find((c) => c.id === colMovilId) ?? columnas[0];
    const idsCol = colActiva ? colActiva.items.map((x) => x.id) : [];
    const allColSelected = idsCol.length > 0 && !!selectedIds && idsCol.every((id) => selectedIds.has(id));

    return (
      <View style={{ gap: spacing.sm }}>
        {/* Selector de columnas en chips con flexWrap (sin scroll horizontal rígido) */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {columnas.map((col) => {
            const on = col.id === colActiva?.id;
            const tono = colorTono(colors, col.tono);
            return (
              <TouchableOpacity
                key={col.id}
                onPress={() => setColMovilId(col.id)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 5,
                  paddingHorizontal: 10,
                  paddingVertical: 7,
                  borderRadius: radius.pill,
                  borderWidth: 1.5,
                  borderColor: on ? tono.accent : col.urgentesCount > 0 ? colors.danger : colors.border,
                  backgroundColor: on ? tono.bg : colors.surface,
                }}
              >
                <Text style={{ fontSize: 12 }}>{col.icono}</Text>
                <Text style={{ color: on ? tono.text : colors.text, fontSize: 11.5, fontWeight: on ? '800' : '600' }}>
                  {col.titulo} ({col.count})
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {colActiva ? (
          <View style={{ gap: spacing.xs }}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: colors.surfaceAlt,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs + 2,
                borderRadius: radius.sm,
                borderWidth: 1,
                borderColor: colors.border,
                flexWrap: 'wrap',
                gap: 6,
              }}
            >
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12.5 }}>
                {colActiva.icono} {colActiva.titulo} · {colActiva.count}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12.5 }}>
                  {fmtUsd(colActiva.totalUsd)}
                </Text>
                {onToggleColumna && idsCol.length > 0 ? (
                  <TouchableOpacity
                    onPress={() => onToggleColumna(idsCol, allColSelected)}
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: radius.sm,
                      borderWidth: 1,
                      borderColor: colors.border,
                      backgroundColor: colors.surface,
                    }}
                  >
                    <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>
                      {allColSelected ? '☐ Desmarcar' : '☑ Marcar col.'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>

            {colActiva.items.length === 0 ? (
              <View
                style={{
                  padding: spacing.lg,
                  alignItems: 'center',
                  backgroundColor: colors.surface,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Text style={{ color: colors.muted, fontSize: 12.5 }}>{emptyText}</Text>
              </View>
            ) : (
              colActiva.items.map((it) => (
                <KanbanCard
                  key={it.id}
                  item={it}
                  accentColor={colorTono(colors, colActiva.tono).accent}
                  selected={selectedIds?.has(it.id)}
                  showCheckbox={showCheckbox}
                  onPress={onSelectItem}
                  onToggleSelect={onToggleSelect}
                  renderQuickAction={renderQuickAction}
                />
              ))
            )}
          </View>
        ) : null}
      </View>
    );
  }

  // Modo PC: Columnas lado a lado con flexWrap responsivo (sin ScrollView horizontal rígido)
  const basisPct = width >= 1400 ? '23.5%' : width >= 1020 ? '31.5%' : '48%';

  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'stretch',
        gap: spacing.sm + 2,
        width: '100%',
      }}
    >
      {columnas.map((col) => {
        const tono = colorTono(colors, col.tono);
        const idsCol = col.items.map((x) => x.id);
        const allColSelected = idsCol.length > 0 && !!selectedIds && idsCol.every((id) => selectedIds.has(id));

        return (
          <View
            key={col.id}
            style={{
              flexGrow: 1,
              flexShrink: 1,
              flexBasis: basisPct as any,
              minWidth: 265,
              backgroundColor: colors.surfaceAlt,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.border,
              borderTopWidth: 3,
              borderTopColor: tono.accent,
              overflow: 'hidden',
            }}
          >
            {/* Cabecera fija de columna */}
            <View
              style={{
                backgroundColor: colors.surface,
                paddingHorizontal: spacing.sm + 2,
                paddingVertical: spacing.sm,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
                gap: 4,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <Text style={{ color: colors.text, fontWeight: '900', fontSize: 12.5, flex: 1 }} numberOfLines={1}>
                  {col.icono} {col.titulo}
                </Text>
                <View
                  style={{
                    backgroundColor: tono.bg,
                    borderWidth: 1,
                    borderColor: tono.border,
                    borderRadius: radius.pill,
                    paddingHorizontal: 8,
                    paddingVertical: 1,
                  }}
                >
                  <Text style={{ color: tono.text, fontWeight: '900', fontSize: 11 }}>{col.count}</Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <Text style={{ color: colors.muted, fontSize: 11.5, fontWeight: '700' }}>
                  {fmtUsd(col.totalUsd)}
                  {col.urgentesCount > 0 ? ` · 🔥 ${col.urgentesCount}` : ''}
                </Text>
                {onToggleColumna && idsCol.length > 0 ? (
                  <TouchableOpacity onPress={() => onToggleColumna(idsCol, allColSelected)}>
                    <Text style={{ color: colors.primary, fontSize: 10.5, fontWeight: '700' }}>
                      {allColSelected ? '☐ Quitar' : '☑ Col.'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>

            {/* Tarjetas con scroll vertical independiente */}
            <ScrollView
              nestedScrollEnabled
              style={{ maxHeight: 520 }}
              contentContainerStyle={{ padding: spacing.xs + 2, gap: spacing.xs + 2 }}
            >
              {col.items.length === 0 ? (
                <View style={{ paddingVertical: spacing.lg, alignItems: 'center' }}>
                  <Text style={{ color: colors.muted, fontSize: 11.5 }}>{emptyText}</Text>
                </View>
              ) : (
                col.items.map((it) => (
                  <KanbanCard
                    key={it.id}
                    item={it}
                    accentColor={tono.accent}
                    selected={selectedIds?.has(it.id)}
                    showCheckbox={showCheckbox}
                    onPress={onSelectItem}
                    onToggleSelect={onToggleSelect}
                    renderQuickAction={renderQuickAction}
                  />
                ))
              )}
            </ScrollView>
          </View>
        );
      })}
    </View>
  );
}
