import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { useTable } from '../../hooks/useTable';
import { TankLevel as TankLevelType } from '../../types/database';
import { TankLevel, tankStatus } from '../../components/TankLevel';
import { cmpText } from '../../lib/text';
import { family, useBrandFonts } from '../../components/redesign/fonts';

// Umbral mínimo por defecto (la vista tank_levels aún no expone umbral por tanque).
const LOW_PCT = 20;

/**
 * SHOWCASE DE PLANTILLA — Tanques con el tratamiento COMPLETO del rediseño:
 *   1) Tipografía de marca real (Barlow Condensed títulos · IBM Plex Mono cifras).
 *   2) Banda de KPIs arriba (cifras grandes).
 *   3) Tarjetas "firma": franja de estado a la izquierda + jerarquía clara.
 *
 * MISMA información, mismos datos (nivel DERIVADO de tank_levels, no editable) y
 * misma facilidad: nada cambia de sitio, solo se ve mejor. Aislado en su archivo.
 */
export default function TanksShowcase() {
  const { colors } = useTheme();
  const fontsReady = useBrandFonts();
  const { data, loading } = useTable<TankLevelType>('tank_levels', { realtimeFrom: ['stock_movements', 'tanks'] });
  const [filter, setFilter] = useState<'all' | 'diesel' | 'gasolina' | 'low'>('all');

  const tanks = useMemo(() => {
    const list = [...(data ?? [])].sort((a, b) => cmpText(a.name, b.name));
    if (filter === 'diesel') return list.filter((t) => /dies/i.test(t.fuel));
    if (filter === 'gasolina') return list.filter((t) => /gasol/i.test(t.fuel));
    if (filter === 'low') return list.filter((t) => (Number(t.pct) || 0) <= LOW_PCT);
    return list;
  }, [data, filter]);

  const kpis = useMemo(() => {
    const all = data ?? [];
    const bajos = all.filter((t) => (Number(t.pct) || 0) <= LOW_PCT).length;
    const litros = all.reduce((s, t) => s + (Number(t.current_l) || 0), 0);
    return { total: all.length, bajos, litros };
  }, [data]);

  // Fuente segura: si aún no cargan las de marca, usa la del sistema (no rompe nada).
  const f = (fam: string) => (fontsReady ? { fontFamily: fam } : {});

  const chipTone = (tone: 'ok' | 'warn' | 'crit') =>
    tone === 'ok'
      ? { bg: colors.successSoftBg, fg: colors.successSoftText, stripe: colors.tankFill }
      : tone === 'warn'
      ? { bg: colors.accentSoftBg, fg: colors.accentSoftText, stripe: colors.tankWarn }
      : { bg: colors.dangerSoftBg, fg: colors.dangerSoftText, stripe: colors.tankCrit };

  const FILTERS: { k: typeof filter; label: string }[] = [
    { k: 'all', label: 'Todos' },
    { k: 'diesel', label: 'Diésel' },
    { k: 'gasolina', label: 'Gasolina' },
    { k: 'low', label: 'Bajos' },
  ];

  const Kpi = ({ n, label, tone }: { n: React.ReactNode; label: string; tone?: 'plain' | 'warn' }) => (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={[{ color: tone === 'warn' && Number(kpis.bajos) > 0 ? colors.accent : colors.brandContrast, fontSize: 30, lineHeight: 34 }, f(family.monoSemi)]}>
        {n}
      </Text>
      <Text style={[{ color: colors.brandContrast, opacity: 0.8, fontSize: 11, letterSpacing: 1, marginTop: 2, textTransform: 'uppercase' }, f(family.bodySemi)]}>
        {label}
      </Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Banda navy con título de marca + KPIs grandes. */}
      <View style={{ backgroundColor: colors.brand, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.lg }}>
        <Text style={[{ color: colors.brandContrast, fontSize: 26, letterSpacing: 0.5 }, f(family.display)]}>TANQUES</Text>
        <View style={{ flexDirection: 'row', marginTop: spacing.md, gap: spacing.sm }}>
          <Kpi n={kpis.total} label="Tanques" />
          <View style={{ width: 1, backgroundColor: colors.brandContrast, opacity: 0.2 }} />
          <Kpi n={kpis.bajos} label="Bajo umbral" tone="warn" />
          <View style={{ width: 1, backgroundColor: colors.brandContrast, opacity: 0.2 }} />
          <Kpi n={`${Math.round(kpis.litros).toLocaleString()}`} label="Litros" />
        </View>
      </View>

      {/* Chips de filtro. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ padding: spacing.sm, gap: spacing.xs }}>
        {FILTERS.map((ff) => {
          const on = filter === ff.k;
          return (
            <TouchableOpacity key={ff.k} onPress={() => setFilter(ff.k)} style={{ paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}>
              <Text style={[{ color: on ? colors.brandContrast : colors.text, fontSize: 12.5 }, f(family.bodySemi)]}>{ff.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={{ paddingTop: spacing.xl, alignItems: 'center' }}><ActivityIndicator color={colors.brand} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.sm, paddingBottom: spacing.xl }}>
          {tanks.length === 0 ? (
            <View style={{ alignItems: 'center', padding: spacing.xl, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, marginTop: spacing.md }}>
              <Text style={{ fontSize: 26, color: colors.muted }}>🛢️</Text>
              <Text style={[{ color: colors.text, marginTop: spacing.xs, fontSize: 15 }, f(family.displayBold)]}>Sin tanques</Text>
              <Text style={[{ color: colors.muted, fontSize: 12, marginTop: 2 }, f(family.body)]}>No hay tanques para este filtro.</Text>
            </View>
          ) : (
            tanks.map((t) => {
              const pct = Number(t.pct) || 0;
              const st = tankStatus(pct, LOW_PCT);
              const tone = chipTone(st.tone);
              const low = pct <= LOW_PCT;
              return (
                <View key={t.id} style={{ flexDirection: 'row', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, marginBottom: spacing.sm, overflow: 'hidden' }}>
                  {/* Franja de estado a la izquierda (la FORMA comunica el estado). */}
                  <View style={{ width: 5, backgroundColor: tone.stripe }} />
                  <View style={{ flex: 1, padding: spacing.md }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm }}>
                      <Text numberOfLines={1} style={[{ color: colors.text, fontSize: 17, flex: 1 }, f(family.displayBold)]}>{t.name}</Text>
                      <View style={{ backgroundColor: tone.bg, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 }}>
                        <Text style={[{ color: tone.fg, fontSize: 10, letterSpacing: 0.5 }, f(family.bodySemi)]}>{st.label.toUpperCase()}</Text>
                      </View>
                    </View>
                    <Text style={[{ color: colors.muted, fontSize: 12, marginTop: 2, marginBottom: spacing.sm, textTransform: 'capitalize' }, f(family.body)]}>
                      {t.fuel} · cap. {Number(t.capacity_l).toLocaleString()} L · umbral {LOW_PCT}%
                    </Text>

                    {/* Cifra grande en mono + % a la derecha. */}
                    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={[{ color: low ? colors.tankCrit : colors.text, fontSize: 22 }, f(family.monoSemi)]}>
                        {Number(t.current_l).toLocaleString()} <Text style={[{ fontSize: 13, color: colors.muted }, f(family.mono)]}>L</Text>
                      </Text>
                      <Text style={[{ color: low ? colors.tankCrit : colors.muted, fontSize: 16 }, f(family.monoSemi)]}>{Math.round(pct)}%</Text>
                    </View>
                    <TankLevel pct={pct} thresholdPct={LOW_PCT} height={10} />
                  </View>
                </View>
              );
            })
          )}

          {/* Nota discreta de que es una vista de muestra. */}
          <Text style={[{ color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: spacing.sm }, f(family.body)]}>
            Vista de muestra (plantilla nueva) · misma información y datos
          </Text>
        </ScrollView>
      )}
    </View>
  );
}
