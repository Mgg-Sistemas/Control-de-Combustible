// Hub de Reportes: acordeones por categoría, cada uno con tarjetas de reporte
// (icono + título + descripción + chips de campos). Rediseño pedido por el cliente
// (docs/reportes-rediseno.html) pero con los COLORES DEL SISTEMA (src/theme), no la
// paleta teal del mockup. Reutilizable: recibe las secciones y las acciones por tarjeta.
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { norm } from '../lib/text';

export type ReportCard = {
  key: string;
  icon: string;          // emoji del icono de la tarjeta
  title: string;
  desc: string;
  fields?: string[];     // chips de campos (Hora de inicio, Máquina, …)
  onPress?: () => void;
  disabled?: boolean;    // "Próximamente" (aún no implementado)
  badge?: string;        // etiqueta opcional (ej. "Próximamente")
};
export type ReportSection = {
  key: string;
  icon: string;          // emoji del icono de la sección
  title: string;
  cards: ReportCard[];
  defaultOpen?: boolean;
};

export default function ReportesHub(props: { sections: ReportSection[]; subtitle?: string }) {
  const { colors } = useTheme();
  const { sections } = props;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    sections.forEach((s) => { o[s.key] = s.defaultOpen ?? false; });
    return o;
  });

  const nq = norm(q.trim());
  // Al buscar, filtra las tarjetas por título/descripción/campos y abre todo.
  const shown = useMemo(() => {
    if (!nq) return sections;
    return sections
      .map((s) => ({ ...s, cards: s.cards.filter((c) => [c.title, c.desc, ...(c.fields || [])].some((v) => norm(v).includes(nq))) }))
      .filter((s) => s.cards.length > 0);
  }, [sections, nq]);

  return (
    <View>
      {/* Buscador de reportes */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginBottom: spacing.md }}>
        <Text style={{ fontSize: 15 }}>🔎</Text>
        <TextInput value={q} onChangeText={setQ} placeholder="Buscar reporte…" placeholderTextColor={colors.muted} style={{ flex: 1, color: colors.text, fontSize: 14, paddingVertical: 9 }} />
        {q ? <TouchableOpacity onPress={() => setQ('')}><Text style={{ color: colors.muted, fontWeight: '800' }}>✕</Text></TouchableOpacity> : null}
      </View>

      {shown.length === 0 ? (
        <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center', paddingVertical: spacing.lg }}>Sin reportes que coincidan con “{q.trim()}”.</Text>
      ) : shown.map((s) => {
        const isOpen = nq ? true : (open[s.key] ?? false);
        return (
          <View key={s.key} style={{ marginBottom: spacing.sm }}>
            {/* Cabecera de la sección (acordeón) */}
            <TouchableOpacity
              onPress={() => setOpen((p) => ({ ...p, [s.key]: !isOpen }))}
              activeOpacity={0.7}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm }}
            >
              <View style={{ width: 26, height: 26, borderRadius: radius.sm, backgroundColor: isOpen ? colors.accentSoftBg : colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: colors.brandText, fontSize: 14, fontWeight: '900' }}>{isOpen ? '▾' : '▸'}</Text>
              </View>
              <View style={{ width: 34, height: 34, borderRadius: radius.md, backgroundColor: colors.accentSoftBg, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 18 }}>{s.icon}</Text>
              </View>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16, flex: 1 }} numberOfLines={2}>{s.title}</Text>
              <View style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 }}>
                <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 11 }}>{s.cards.length} reporte{s.cards.length === 1 ? '' : 's'}</Text>
              </View>
            </TouchableOpacity>

            {/* Cuerpo: tarjetas de reporte */}
            {isOpen ? (
              <View style={{ gap: spacing.sm, paddingLeft: 4 }}>
                {s.cards.map((c) => (
                  <TouchableOpacity
                    key={c.key}
                    onPress={c.disabled ? undefined : c.onPress}
                    activeOpacity={c.disabled ? 1 : 0.7}
                    style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, opacity: c.disabled ? 0.6 : 1 }}
                  >
                    <View style={{ width: 38, height: 38, borderRadius: radius.md, backgroundColor: colors.accentSoftBg, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 19 }}>{c.icon}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' }}>
                        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>{c.title}</Text>
                        {c.badge ? (
                          <View style={{ backgroundColor: colors.warningSoftBg, borderWidth: 1, borderColor: colors.warningSoftBorder, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 1 }}>
                            <Text style={{ color: colors.warningSoftText, fontSize: 9.5, fontWeight: '800' }}>{c.badge}</Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={{ color: colors.muted, fontSize: 12.5, marginTop: 2, lineHeight: 17 }}>{c.desc}</Text>
                      {c.fields && c.fields.length ? (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: spacing.sm }}>
                          {c.fields.map((f, i) => (
                            <View key={`${f}-${i}`} style={{ backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 7, paddingVertical: 2 }}>
                              <Text style={{ color: colors.muted, fontSize: 10.5, fontWeight: '600' }}>{f}</Text>
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </View>
                    {!c.disabled ? <Text style={{ color: colors.brandText, fontSize: 20, fontWeight: '800', marginTop: 6 }}>›</Text> : null}
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
