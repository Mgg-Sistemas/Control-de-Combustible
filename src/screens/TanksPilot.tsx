import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useTable } from '../hooks/useTable';
import { TankLevel as TankLevelType } from '../types/database';
import { TankLevel, TankLevelLabel, tankStatus } from '../components/TankLevel';
import { cmpText } from '../lib/text';

// Umbral mínimo por defecto (la vista tank_levels aún no expone umbral por tanque).
const LOW_PCT = 20;

/**
 * PILOTO DE REDISEÑO — Tanques (maqueta B). Reviste el listado de tanques con el
 * lenguaje visual nuevo (navy + ámbar, medidor con marca de umbral, chips de estado)
 * SIN cambiar la lógica: el nivel sigue siendo DERIVADO de tank_levels (no editable).
 * Archivo nuevo y aislado — no toca la TanksScreen actual (para no solaparse con el equipo).
 */
export default function TanksPilot() {
  const { colors } = useTheme();
  const { data, loading } = useTable<TankLevelType>('tank_levels', { realtimeFrom: ['stock_movements', 'tanks'] });
  const [filter, setFilter] = useState<'all' | 'diesel' | 'gasolina' | 'low'>('all');

  const tanks = useMemo(() => {
    const list = [...(data ?? [])].sort((a, b) => cmpText(a.name, b.name));
    if (filter === 'diesel') return list.filter((t) => /dies/i.test(t.fuel));
    if (filter === 'gasolina') return list.filter((t) => /gasol/i.test(t.fuel));
    if (filter === 'low') return list.filter((t) => (Number(t.pct) || 0) <= LOW_PCT);
    return list;
  }, [data, filter]);

  const bajos = useMemo(() => (data ?? []).filter((t) => (Number(t.pct) || 0) <= LOW_PCT).length, [data]);

  const chipTone = (tone: 'ok' | 'warn' | 'crit') =>
    tone === 'ok'
      ? { bg: colors.successSoftBg, fg: colors.successSoftText }
      : tone === 'warn'
      ? { bg: colors.accentSoftBg, fg: colors.accentSoftText }
      : { bg: colors.dangerSoftBg, fg: colors.dangerSoftText };

  const FILTERS: { k: typeof filter; label: string }[] = [
    { k: 'all', label: 'Todos' },
    { k: 'diesel', label: 'Diésel' },
    { k: 'gasolina', label: 'Gasolina' },
    { k: 'low', label: 'Bajos' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Encabezado navy con el resumen (cuántos y cuántos bajo umbral). */}
      <View style={{ backgroundColor: colors.brand, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.md }}>
        <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 20, letterSpacing: 0.4 }}>TANQUES</Text>
        <Text style={{ color: colors.brandContrast, opacity: 0.8, fontSize: 12, marginTop: 2 }}>
          {(data ?? []).length} tanque(s){bajos > 0 ? ` · ${bajos} bajo umbral` : ''}
        </Text>
      </View>

      {/* Chips de filtro. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ padding: spacing.sm, gap: spacing.xs }}>
        {FILTERS.map((f) => {
          const on = filter === f.k;
          return (
            <TouchableOpacity key={f.k} onPress={() => setFilter(f.k)} style={{ paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}>
              <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>{f.label}</Text>
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
              <Text style={{ color: colors.text, fontWeight: '800', marginTop: spacing.xs }}>Sin tanques</Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>No hay tanques para este filtro.</Text>
            </View>
          ) : (
            tanks.map((t) => {
              const pct = Number(t.pct) || 0;
              const st = tankStatus(pct, LOW_PCT);
              const tone = chipTone(st.tone);
              const low = pct <= LOW_PCT;
              return (
                <View key={t.id} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: low ? colors.tankCrit : colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
                    <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '800', fontSize: 15, flex: 1 }}>{t.name}</Text>
                    <View style={{ backgroundColor: tone.bg, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
                      <Text style={{ color: tone.fg, fontWeight: '800', fontSize: 10 }}>{st.label}</Text>
                    </View>
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2, marginBottom: spacing.sm, textTransform: 'capitalize' }}>
                    {t.fuel} · capacidad {Number(t.capacity_l).toLocaleString()} L · umbral {LOW_PCT}%
                  </Text>
                  <TankLevel pct={pct} thresholdPct={LOW_PCT} />
                  <TankLevelLabel liters={Number(t.current_l) || 0} pct={pct} low={low} />
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}
