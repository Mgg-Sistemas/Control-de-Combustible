import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Modal, TextInput, Pressable } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { useTable } from '../../hooks/useTable';
import { TankLevel as TankLevelType } from '../../types/database';
import { TankLevel, tankStatus } from '../../components/TankLevel';
import { cmpText } from '../../lib/text';
import { family, useBrandFonts } from '../../components/redesign/fonts';
import { supabase } from '../../lib/supabase';

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
  const { data, loading, refetch } = useTable<TankLevelType>('tank_levels', { realtimeFrom: ['stock_movements', 'tanks'] });
  // Usuarios que tienen combustible (conductores/choferes de combustible) para
  // vincular el RESPONSABLE del tanque a una persona real en vez de texto libre.
  const { data: usuarios } = useTable<any>('profiles', { orderBy: 'full_name' });
  const candidatos = useMemo(
    () => (usuarios ?? [])
      .filter((u: any) => u.active !== false && u.role === 'conductor' && String(u.full_name ?? '').trim())
      .map((u: any) => String(u.full_name).trim())
      .filter((v: string, i: number, arr: string[]) => arr.indexOf(v) === i)
      .sort(cmpText),
    [usuarios],
  );
  const [filter, setFilter] = useState<'all' | 'diesel' | 'gasolina' | 'low'>('all');
  // Edición del RESPONSABLE del tanque directamente desde la tarjeta (toca el renglón
  // "Responsable"). Actualiza `tanks.responsable` (la vista tank_levels es de solo
  // lectura, pero el id coincide). Tras guardar refrescamos nosotros mismos (refetch):
  // la vista `tank_levels` no siempre está en la publicación de realtime, así que no
  // dependemos de que el evento llegue solo — el que edita ve su cambio al instante.
  const [editTank, setEditTank] = useState<{ id: string; name: string } | null>(null);
  const [respInput, setRespInput] = useState('');
  const [savingResp, setSavingResp] = useState(false);
  const openEditResp = (t: TankLevelType) => { setEditTank({ id: t.id, name: t.name }); setRespInput(String(t.responsable ?? '')); };
  const saveResp = async () => {
    if (!editTank || savingResp) return;
    setSavingResp(true);
    const clean = respInput.trim();
    const { error } = await supabase.from('tanks').update({ responsable: clean || null }).eq('id', editTank.id);
    setSavingResp(false);
    if (!error) { setEditTank(null); refetch(); }
  };

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
      <Text style={[{ color: tone === 'warn' && Number(kpis.bajos) > 0 ? colors.accent : colors.brandContrast, fontSize: 30, lineHeight: 34, fontWeight: '900' }, f(family.monoSemi)]}>
        {n}
      </Text>
      <Text style={[{ color: colors.brandContrast, opacity: 0.8, fontSize: 11, letterSpacing: 1, marginTop: 2, textTransform: 'uppercase', fontWeight: '800' }, f(family.bodySemi)]}>
        {label}
      </Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Banda navy con título de marca + KPIs grandes. */}
      <View style={{ backgroundColor: colors.brand, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.lg }}>
        <Text style={[{ color: colors.brandContrast, fontSize: 26, letterSpacing: 0.5, fontWeight: '900' }, f(family.display)]}>TANQUES</Text>
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
              <Text style={[{ color: colors.text, marginTop: spacing.xs, fontSize: 15, fontWeight: '900' }, f(family.displayBold)]}>Sin tanques</Text>
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
                      <Text numberOfLines={1} style={[{ color: colors.text, fontSize: 17, flex: 1, fontWeight: '900' }, f(family.displayBold)]}>{t.name}</Text>
                      <View style={{ backgroundColor: tone.bg, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 }}>
                        <Text style={[{ color: tone.fg, fontSize: 10, letterSpacing: 0.5 }, f(family.bodySemi)]}>{st.label.toUpperCase()}</Text>
                      </View>
                    </View>
                    <Text style={[{ color: colors.muted, fontSize: 12, marginTop: 2, textTransform: 'capitalize' }, f(family.body)]}>
                      {t.fuel} · cap. {Number(t.capacity_l).toLocaleString()} L · umbral {LOW_PCT}%
                    </Text>
                    {/* Ubicación del tanque (si la tiene) — ayuda a distinguir tanques con
                        el mismo nombre. */}
                    {t.location && String(t.location).trim() ? (
                      <Text style={[{ color: colors.muted, fontSize: 12, marginTop: 2 }, f(family.body)]}>📍 {t.location}</Text>
                    ) : null}
                    {/* Responsable / encargado — EDITABLE: toca el renglón para asignarlo. */}
                    <TouchableOpacity onPress={() => openEditResp(t)} activeOpacity={0.6} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, marginBottom: spacing.sm }}>
                      <Text style={[{ color: t.responsable ? colors.text : colors.muted, fontSize: 12, fontWeight: t.responsable ? '700' : '400', flexShrink: 1 }, f(family.bodySemi)]}>
                        👤 Responsable: {t.responsable && String(t.responsable).trim() ? t.responsable : 'sin asignar'}
                      </Text>
                      <Text style={[{ color: colors.brandText, fontSize: 11, fontWeight: '800' }, f(family.bodySemi)]}>✏️ {t.responsable ? 'cambiar' : 'asignar'}</Text>
                    </TouchableOpacity>

                    {/* Cifra grande en mono + % a la derecha. */}
                    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={[{ color: low ? colors.tankCrit : colors.text, fontSize: 22, fontWeight: '900' }, f(family.monoSemi)]}>
                        {Number(t.current_l).toLocaleString()} <Text style={[{ fontSize: 13, color: colors.muted }, f(family.mono)]}>L</Text>
                      </Text>
                      <Text style={[{ color: low ? colors.tankCrit : colors.muted, fontSize: 16, fontWeight: '900' }, f(family.monoSemi)]}>{Math.round(pct)}%</Text>
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

      {/* Modal para asignar/cambiar el RESPONSABLE del tanque (escribe el nombre). */}
      <Modal visible={editTank != null} transparent animationType="fade" onRequestClose={() => setEditTank(null)}>
        <Pressable onPress={() => setEditTank(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.lg }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm }}>
            <Text style={[{ color: colors.text, fontSize: 16, fontWeight: '900' }, f(family.displayBold)]}>Responsable del tanque</Text>
            <Text style={[{ color: colors.muted, fontSize: 12.5 }, f(family.body)]}>{editTank?.name}</Text>
            <TextInput
              value={respInput}
              onChangeText={setRespInput}
              placeholder="Buscar o escribir el encargado…"
              placeholderTextColor={colors.muted}
              autoFocus
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10, color: colors.text, fontSize: 15 }}
            />
            {/* Usuarios de combustible: toca uno para asignarlo (o escribe arriba). */}
            {(() => {
              const q = respInput.trim().toLowerCase();
              const lista = q ? candidatos.filter((n) => n.toLowerCase().includes(q)) : candidatos;
              if (lista.length === 0) return null;
              return (
                <View style={{ maxHeight: 180, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' }}>
                  <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                    {lista.map((n) => {
                      const on = n.toLowerCase() === respInput.trim().toLowerCase();
                      return (
                        <TouchableOpacity key={n} onPress={() => setRespInput(n)}
                          style={{ paddingVertical: 10, paddingHorizontal: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: on ? colors.primary : 'transparent' }}>
                          <Text style={[{ color: on ? colors.primaryContrast : colors.text, fontSize: 14, fontWeight: on ? '800' : '500' }, f(family.bodySemi)]}>👤 {n}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              );
            })()}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
              <TouchableOpacity onPress={() => setEditTank(null)} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: 11, alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveResp} disabled={savingResp} style={{ flex: 1, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 11, alignItems: 'center', opacity: savingResp ? 0.6 : 1 }}>
                <Text style={{ color: colors.primaryContrast, fontWeight: '900' }}>{savingResp ? 'Guardando…' : 'Guardar'}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
