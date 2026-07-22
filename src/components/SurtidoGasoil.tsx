import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import { insertMachineDispatch } from '../lib/dispatches';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';

const numOrNull = (s: string) => { const n = Number((s || '').replace(',', '.')); return isFinite(n) && s.trim() !== '' ? n : null; };
const todayISO = () => { const d = new Date(); const p = (n: number) => `${n}`.padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

type MachInfo = {
  id: string; code: string;
  last_horometro: number | null;
  expected_lph: number | null;
  daily_consumption_l: number | null;
};

/**
 * Modal reusable para SURTIR GASOIL a una máquina (desde inspector, coordinador de
 * patio y coordinadores de mantenimiento). Captura el HORÓMETRO actual y los LITROS
 * surtidos, y muestra el contraste SURTIDO vs CONSUMIDO estimado (horas desde el
 * último surtido × rendimiento L/h de la máquina).
 */
export function SurtidoGasoilModal({
  machineId, onClose, onSaved, authorName, authorId,
}: {
  machineId: string | null;
  onClose: () => void;
  onSaved?: () => void;
  authorName?: string | null;
  authorId?: string | null;
}) {
  const { colors } = useTheme();
  const [info, setInfo] = useState<MachInfo | null>(null);
  const [prevHoro, setPrevHoro] = useState<number | null>(null); // horómetro del último surtido
  const [surtidoTotal, setSurtidoTotal] = useState<number>(0);   // litros surtidos acumulados
  const [loading, setLoading] = useState(true);
  const [horo, setHoro] = useState('');
  const [liters, setLiters] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!machineId) { setInfo(null); return; }
    let active = true;
    setLoading(true); setNotice(null); setHoro(''); setLiters('');
    (async () => {
      const [{ data: m }, { data: disp }] = await Promise.all([
        supabase.from('machinery').select('id, code, last_horometro, expected_lph, daily_consumption_l').eq('id', machineId).maybeSingle(),
        supabase.from('dispatches').select('liters, fuel_end, dispatch_date').eq('machinery_id', machineId).order('dispatch_date', { ascending: false }).limit(500),
      ]);
      if (!active) return;
      const mi = m as MachInfo | null;
      setInfo(mi);
      const rows = (disp ?? []) as { liters: number; fuel_end: number | null }[];
      setSurtidoTotal(rows.reduce((a, r) => a + (Number(r.liters) || 0), 0));
      // Horómetro de referencia: el del último surtido con lectura, o la última lectura de la máquina.
      const lastWithHoro = rows.find((r) => r.fuel_end != null);
      setPrevHoro(lastWithHoro?.fuel_end ?? mi?.last_horometro ?? null);
      setHoro(mi?.last_horometro != null ? String(mi.last_horometro) : '');
      setLoading(false);
    })();
    return () => { active = false; };
  }, [machineId]);

  // Horas desde el último surtido y consumo estimado (horas × L/h).
  const horoNum = numOrNull(horo);
  const lph = info?.expected_lph != null ? Number(info.expected_lph) : null;
  const horas = horoNum != null && prevHoro != null ? Math.max(0, horoNum - prevHoro) : null;
  const consumidoEst = horas != null && lph != null ? horas * lph : null;
  const litersNum = numOrNull(liters);

  const fmt = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('es-VE', { maximumFractionDigits: 1 }));

  const guardar = async () => {
    if (!info) return;
    if (litersNum == null || litersNum <= 0) { setNotice('❌ Ingresa los litros surtidos (mayor a 0).'); return; }
    if (horoNum != null && prevHoro != null && horoNum < prevHoro) {
      setNotice(`❌ El horómetro (${horoNum}) no puede ser menor al del último surtido (${prevHoro}).`); return;
    }
    setBusy(true); setNotice(null);
    const { error } = await insertMachineDispatch({
      machineryId: info.id,
      dispatchDate: todayISO(),
      liters: litersNum,
      tankId: null, // carga directa de bomba (solo litros)
      operator: authorName ?? null,
      fuelStart: prevHoro,
      fuelEnd: horoNum,
      dailyConsumptionL: info.daily_consumption_l,
      createdBy: authorId ?? null,
    });
    setBusy(false);
    if (error) { setNotice('❌ ' + error); return; }
    setNotice(`✅ Surtido registrado: ${fmt(litersNum)} L a ${info.code}.`);
    setSurtidoTotal((t) => t + litersNum);
    setPrevHoro(horoNum ?? prevHoro);
    setLiters('');
    onSaved?.();
  };

  const box = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text } as const;

  return (
    <Modal visible={!!machineId} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg }}>
        <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, maxHeight: '90%' }}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
            {loading ? (
              <View style={{ paddingVertical: spacing.lg, alignItems: 'center' }}><ActivityIndicator color={colors.primary} /></View>
            ) : !info ? (
              <Text style={{ color: colors.danger, fontWeight: '700' }}>No se encontró la máquina.</Text>
            ) : (
              <>
                <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18, textAlign: 'center' }}>⛽ Surtir gasoil · {info.code}</Text>

                {/* Resumen: surtido vs consumido */}
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                  <View style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>Surtido total</Text>
                    <Text style={{ color: '#15803D', fontWeight: '900', fontSize: 18 }}>{fmt(surtidoTotal)} L</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.sm, alignItems: 'center' }}>
                    <Text style={{ color: colors.muted, fontSize: 11 }}>Consumido est.</Text>
                    <Text style={{ color: '#B45309', fontWeight: '900', fontSize: 18 }}>{consumidoEst != null ? `${fmt(consumidoEst)} L` : '—'}</Text>
                  </View>
                </View>
                <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4, textAlign: 'center' }}>
                  Rendimiento {lph != null ? `${fmt(lph)} L/h` : 'sin definir'} · último horómetro {prevHoro ?? '—'}
                  {horas != null ? ` · ${fmt(horas)} h desde el último surtido` : ''}
                </Text>

                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.md, marginBottom: 4 }}>Horómetro actual</Text>
                <TextInput value={horo} onChangeText={setHoro} keyboardType="numeric" placeholder="Ej: 1250" placeholderTextColor={colors.muted} style={box} />

                <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>Litros surtidos</Text>
                <TextInput value={liters} onChangeText={setLiters} keyboardType="numeric" placeholder="Ej: 40" placeholderTextColor={colors.muted} style={box} />

                {notice ? <Text style={{ color: notice.startsWith('✅') ? colors.success : colors.danger, fontWeight: '700', marginTop: spacing.sm }}>{notice}</Text> : null}

                <TouchableOpacity onPress={guardar} disabled={busy} style={{ marginTop: spacing.md, backgroundColor: '#15803D', borderRadius: radius.md, padding: spacing.md, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
                  <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>{busy ? 'Guardando…' : '⛽ Registrar surtido'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={onClose} style={{ marginTop: spacing.sm, padding: spacing.sm, alignItems: 'center' }}>
                  <Text style={{ color: colors.muted, fontWeight: '700' }}>Cerrar</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
