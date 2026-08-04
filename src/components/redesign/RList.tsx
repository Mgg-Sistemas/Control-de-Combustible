import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, TextInput, Platform } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius, AppColors } from '../../theme';
import { useTable } from '../../hooks/useTable';
import { norm } from '../../lib/text';
import { RecordForm, Field } from '../RecordForm';

/**
 * KIT DE REDISEÑO — pieza reutilizable del lenguaje visual nuevo (navy + ámbar).
 *
 * `RList` es la versión restilizada de `ListScreen`: encabezado navy, botón "+ Nuevo"
 * en ámbar (accionable), filtro por fecha, tarjetas y estados vacío/carga con el look
 * de la maqueta. NO reimplementa lógica de datos: usa el MISMO `useTable` para leer y
 * el MISMO `RecordForm` para crear/editar/borrar (los triggers y reglas de negocio de
 * la BD siguen intactos). Archivos nuevos y aislados — no toca los componentes
 * compartidos del equipo (ui.tsx / ListScreen.tsx) para no solaparse.
 */

/** Chip de estado (semáforo suave) — reutiliza los tokens soft del tema. */
export function RPill({ label, tone = 'neutral' }: { label: string; tone?: 'ok' | 'warn' | 'crit' | 'neutral' | 'brand' }) {
  const { colors } = useTheme();
  const map = {
    ok: { bg: colors.successSoftBg, fg: colors.successSoftText },
    warn: { bg: colors.accentSoftBg, fg: colors.accentSoftText },
    crit: { bg: colors.dangerSoftBg, fg: colors.dangerSoftText },
    brand: { bg: colors.accentSoftBg, fg: colors.accentSoftText },
    neutral: { bg: colors.surfaceAlt, fg: colors.muted },
  } as const;
  const t = map[tone];
  return (
    <View style={{ backgroundColor: t.bg, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color: t.fg, fontWeight: '800', fontSize: 10 }}>{label}</Text>
    </View>
  );
}

/** Fila etiqueta → valor dentro de una tarjeta. Los números salen en cifras alineadas. */
export function RRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: 1 }}>
      <Text style={{ color: colors.muted, fontSize: 12.5 }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 12.5, fontWeight: '600', textAlign: 'right', ...(mono ? { fontVariant: ['tabular-nums'] as any } : {}) }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/** Cifra grande (litros, monto…) en tabular-nums, como marca el rediseño.
 *  tone 'brand' usa `brandText` (azul que ADAPTA por tema) — nunca el navy de fondo,
 *  que sobre superficie oscura casi no se ve. */
export function RAmount({ children, tone }: { children: React.ReactNode; tone?: 'brand' | 'text' }) {
  const { colors } = useTheme();
  return (
    <Text style={{ color: tone === 'brand' ? colors.brandText : colors.text, fontWeight: '900', fontSize: 17, fontVariant: ['tabular-nums'] as any }}>
      {children}
    </Text>
  );
}

/** Gráfica de barras horizontales (sin librerías) para el rediseño. */
export function RBarChart({ data, fmt, max }: { data: { label: string; value: number }[]; fmt?: (n: number) => string; max?: number }) {
  const { colors } = useTheme();
  const top = Math.max(1, max ?? Math.max(...data.map((d) => d.value), 0));
  const format = fmt ?? ((n: number) => n.toLocaleString());
  return (
    <View style={{ gap: spacing.sm }}>
      {data.map((d, i) => (
        <View key={`${d.label}-${i}`}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
            <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '700', fontSize: 12.5, flex: 1, paddingRight: spacing.sm }}>{d.label}</Text>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12.5, fontVariant: ['tabular-nums'] as any }}>{format(d.value)}</Text>
          </View>
          <View style={{ height: 11, backgroundColor: colors.tankTrack, borderRadius: radius.pill, overflow: 'hidden' }}>
            <View style={{ height: 11, width: `${Math.max(2, (d.value / top) * 100)}%`, backgroundColor: colors.tankFill, borderRadius: radius.pill }} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Encabezado navy de una pantalla del rediseño: título + subtítulo + acción opcional. */
export function RHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ backgroundColor: colors.brand, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 20, letterSpacing: 0.4 }}>{title}</Text>
        {subtitle ? <Text style={{ color: colors.brandContrast, opacity: 0.8, fontSize: 12, marginTop: 2 }}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );
}

/** Botón de acción principal (ámbar) para el encabezado. */
export function RAddButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={{ backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 8 }}>
      <Text style={{ color: colors.accentContrast, fontWeight: '900', fontSize: 13 }}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Estado vacío (recuadro punteado) coherente con TanksPilot. */
export function REmpty({ icon = '📄', title, subtitle }: { icon?: string; title: string; subtitle?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', padding: spacing.xl, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, marginTop: spacing.md }}>
      <Text style={{ fontSize: 26, color: colors.muted }}>{icon}</Text>
      <Text style={{ color: colors.text, fontWeight: '800', marginTop: spacing.xs }}>{title}</Text>
      {subtitle ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2, textAlign: 'center' }}>{subtitle}</Text> : null}
    </View>
  );
}

/** Tarjeta base del rediseño (borde + superficie). */
export function RCard({ children, onPress, accent }: { children: React.ReactNode; onPress?: () => void; accent?: string }) {
  const { colors } = useTheme();
  const body = (
    <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: accent ?? colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm }}>
      {children}
    </View>
  );
  return onPress ? (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>{body}</TouchableOpacity>
  ) : body;
}

/** Campo de fecha (calendario en web, texto en nativo) para el filtro por rango. */
function RDateInput({ value, onChange, colors }: { value: string; onChange: (v: string) => void; colors: AppColors }) {
  if (Platform.OS === 'web') {
    return React.createElement('input', {
      type: 'date',
      value: value || '',
      onChange: (e: any) => onChange(e.target.value),
      style: { padding: '9px', borderRadius: '10px', border: '1px solid ' + colors.border, background: colors.surface, color: colors.text, fontSize: '14px', width: '100%', boxSizing: 'border-box' },
    });
  }
  return (
    <TextInput value={value} onChangeText={onChange} placeholder="AAAA-MM-DD" placeholderTextColor={colors.muted}
      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
  );
}

type RListProps<T> = {
  title: string;
  table: string;
  orderBy?: string;
  ascending?: boolean;
  select?: string;
  editable?: boolean;
  dateField?: string;
  formFields?: Field[];
  formTitle?: string;
  autoUserField?: string;
  addLabel?: string;
  emptyTitle: string;
  emptySubtitle?: string;
  emptyIcon?: string;
  renderItem: (item: T) => React.ReactNode;
  /** Texto del subtítulo del encabezado (recibe las filas visibles). */
  subtitle?: (shown: T[]) => string;
  /** Contenido extra (resumen/KPIs/gráficas) arriba de la lista; recibe las filas
   *  visibles y el contexto de filtros (para mostrar más/menos según haya rango o búsqueda). */
  headerExtra?: (shown: T[], ctx: { from: string; to: string; dateActive: boolean; searching: boolean }) => React.ReactNode;
  /** Si se define, muestra un buscador que filtra por el texto que devuelva esta función
   *  (concatena todas las características por las que se pueda buscar). */
  searchText?: (item: T) => string;
  searchPlaceholder?: string;
};

/** Lista genérica restilizada. Misma API que ListScreen; look del rediseño. */
export function RList<T extends { id: string }>({
  title, table, orderBy = 'created_at', ascending, select = '*',
  editable = false, dateField, formFields, formTitle, autoUserField,
  addLabel = '+ Nuevo', emptyTitle, emptySubtitle, emptyIcon,
  renderItem, subtitle, headerExtra, searchText, searchPlaceholder = 'Buscar…',
}: RListProps<T>) {
  const { colors } = useTheme();
  const { data, loading, refetch } = useTable<T>(table, { orderBy, select, ...(ascending != null ? { ascending } : {}) });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');

  const shown = useMemo(() => {
    const nq = norm(q.trim());
    return data.filter((item) => {
      if (dateField && (from || to)) {
        const v = String((item as any)[dateField] ?? '').slice(0, 10);
        if (!v) return false;
        if (from && v < from) return false;
        if (to && v > to) return false;
      }
      if (nq && searchText && !norm(searchText(item)).includes(nq)) return false;
      return true;
    });
  }, [data, dateField, from, to, q, searchText]);

  const openNew = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (item: T) => { setEditing(item); setFormOpen(true); };

  const sub = subtitle ? subtitle(shown) : `${shown.length} registro(s)`;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <RHeader title={title.toUpperCase()} subtitle={sub} action={formFields ? <RAddButton label={addLabel} onPress={openNew} /> : undefined} />

      {loading ? (
        <View style={{ paddingTop: spacing.xl, alignItems: 'center' }}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.sm, paddingBottom: spacing.xl }} keyboardShouldPersistTaps="handled">
          {searchText ? (
            <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
              <Text style={{ fontSize: 15 }}>🔎</Text>
              <TextInput
                value={q}
                onChangeText={setQ}
                placeholder={searchPlaceholder}
                placeholderTextColor={colors.muted}
                style={{ flex: 1, color: colors.text, fontSize: 14, paddingVertical: 2 }}
              />
              {q ? (
                <TouchableOpacity onPress={() => setQ('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={{ color: colors.muted, fontWeight: '800', fontSize: 15 }}>✕</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
          {dateField ? (
            <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm }}>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.xs }}>Filtrar por rango de fecha</Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Desde</Text>
                  <RDateInput value={from} onChange={setFrom} colors={colors} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Hasta</Text>
                  <RDateInput value={to} onChange={setTo} colors={colors} />
                </View>
              </View>
              {from || to ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm }}>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{shown.length} resultado(s)</Text>
                  <TouchableOpacity onPress={() => { setFrom(''); setTo(''); }} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, backgroundColor: colors.surfaceAlt, borderRadius: radius.md }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Limpiar</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          ) : null}

          {headerExtra ? headerExtra(shown, { from, to, dateActive: !!(from || to), searching: !!q.trim() }) : null}

          {shown.length === 0 ? (
            <REmpty icon={emptyIcon} title={(from || to || q) ? 'Sin resultados' : emptyTitle} subtitle={(from || to || q) ? 'Prueba con otra búsqueda o rango de fechas.' : emptySubtitle} />
          ) : (
            shown.map((item) => (
              <RCard key={item.id} onPress={editable && formFields ? () => openEdit(item) : undefined}>
                {renderItem(item)}
                {editable && formFields ? (
                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: spacing.xs }}>Toca para editar</Text>
                ) : null}
              </RCard>
            ))
          )}
        </ScrollView>
      )}

      {formFields ? (
        <RecordForm
          visible={formOpen}
          title={editing ? `Editar: ${title}` : formTitle ?? `Nuevo: ${title}`}
          table={table}
          fields={formFields}
          autoUserField={autoUserField}
          record={editing as any}
          allowDelete={editable}
          onClose={() => setFormOpen(false)}
          onSaved={refetch}
        />
      ) : null}
    </View>
  );
}
