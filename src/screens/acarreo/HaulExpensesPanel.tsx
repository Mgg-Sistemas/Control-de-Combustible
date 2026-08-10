// ACARREO · Control de costos de una orden: gastos (combustible, viáticos, peajes),
// viáticos otorgados vs. comprobados y rendimiento km/L. Comprobantes por foto.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image, ScrollView } from 'react-native';
import { Card } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import { captureAndUploadPhoto } from '../../lib/photo';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { onlyDecimal } from '../../lib/text';
import { HaulOrder, HaulExpense } from '../../types/database';

const KINDS = [
  { label: '⛽ Combustible', value: 'combustible' },
  { label: '🍽️ Comida', value: 'viatico_comida' },
  { label: '🛏️ Hospedaje', value: 'viatico_hospedaje' },
  { label: '🛣️ Peaje', value: 'peaje' },
  { label: '📎 Otro', value: 'otro' },
];
const kindLabel = (v: string) => KINDS.find((k) => k.value === v)?.label ?? v;

export default function HaulExpensesPanel({
  order, onError, onChanged,
}: {
  order: HaulOrder;
  onError: (m: string) => void;
  onChanged?: () => void;
}) {
  const { colors } = useTheme();
  const [rows, setRows] = useState<HaulExpense[]>([]);
  const [kind, setKind] = useState('combustible');
  const [amount, setAmount] = useState('');
  const [liters, setLiters] = useState('');
  const [note, setNote] = useState('');
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase.from('haul_expenses').select('*').eq('order_id', order.id).order('at', { ascending: true });
    setRows((data ?? []) as HaulExpense[]);
  };
  useEffect(() => { load(); }, [order.id]);

  const totals = useMemo(() => {
    const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const viaticosComprob = rows.filter((r) => r.kind === 'viatico_comida' || r.kind === 'viatico_hospedaje').reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const combLitros = rows.filter((r) => r.kind === 'combustible').reduce((s, r) => s + (Number(r.liters) || 0), 0);
    const combMonto = rows.filter((r) => r.kind === 'combustible').reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const otorgado = Number(order.per_diem_advanced) || 0;
    const rendimiento = combLitros > 0 && order.route_km_est != null ? Number(order.route_km_est) / combLitros : null;
    return { total, viaticosComprob, combLitros, combMonto, otorgado, rendimiento };
  }, [rows, order]);

  const addReceipt = async () => {
    setBusy(true);
    const r = await captureAndUploadPhoto(order.id, 'acarreo-comprobante');
    setBusy(false);
    if (!r.ok) { if (r.error) onError(r.error); return; }
    setReceiptUrl(r.url ?? null);
  };

  const add = async () => {
    if (!amount) { onError('Indica el monto.'); return; }
    setBusy(true);
    const by = (await supabase.auth.getUser()).data.user?.id ?? null;
    const { error } = await supabase.from('haul_expenses').insert({
      order_id: order.id, kind, amount: Number(amount), currency: 'USD',
      liters: kind === 'combustible' && liters ? Number(liters) : null,
      note: note.trim() || null, receipt_url: receiptUrl, by,
    });
    setBusy(false);
    if (error) { onError(error.message); return; }
    setAmount(''); setLiters(''); setNote(''); setReceiptUrl(null);
    load(); onChanged?.();
  };

  const del = async (id: string) => {
    const { error } = await supabase.from('haul_expenses').delete().eq('id', id);
    if (error) { onError(error.message); return; }
    load(); onChanged?.();
  };

  const money = (n: number) => `$${n.toFixed(2)}`;

  return (
    <Card>
      <Text style={{ color: colors.text, fontWeight: '800', marginBottom: spacing.xs }}>💵 Costos del viaje</Text>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.sm }}>
        <View><Text style={{ color: colors.muted, fontSize: 11 }}>Total gastos</Text><Text style={{ color: colors.text, fontWeight: '900', fontSize: 15 }}>{money(totals.total)}</Text></View>
        <View><Text style={{ color: colors.muted, fontSize: 11 }}>Viáticos otorg./compr.</Text><Text style={{ color: totals.viaticosComprob > totals.otorgado ? colors.danger : colors.text, fontWeight: '900', fontSize: 15 }}>{money(totals.otorgado)} / {money(totals.viaticosComprob)}</Text></View>
        {totals.combLitros > 0 ? (
          <View><Text style={{ color: colors.muted, fontSize: 11 }}>Combustible</Text><Text style={{ color: colors.text, fontWeight: '900', fontSize: 15 }}>{totals.combLitros.toFixed(0)} L · {money(totals.combMonto)}</Text></View>
        ) : null}
        {totals.rendimiento != null ? (
          <View><Text style={{ color: colors.muted, fontSize: 11 }}>Rendimiento</Text><Text style={{ color: colors.text, fontWeight: '900', fontSize: 15 }}>{totals.rendimiento.toFixed(1)} km/L</Text></View>
        ) : null}
      </View>

      {rows.map((r) => (
        <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 3, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Text style={{ color: colors.text, fontSize: 12.5, flex: 1 }}>
            {kindLabel(r.kind)} <Text style={{ color: colors.muted }}>{r.liters ? `· ${r.liters} L ` : ''}{r.note ? `· ${r.note}` : ''}</Text>
          </Text>
          {r.receipt_url ? <Image source={{ uri: r.receipt_url }} style={{ width: 26, height: 26, borderRadius: 4, marginRight: 6, backgroundColor: colors.surfaceAlt }} /> : null}
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12.5, marginRight: 8 }}>{money(Number(r.amount) || 0)}</Text>
          <TouchableOpacity onPress={() => del(r.id)}><Text style={{ color: colors.danger, fontSize: 12 }}>✕</Text></TouchableOpacity>
        </View>
      ))}

      {/* Alta de un gasto */}
      <View style={{ marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
          {KINDS.map((k) => (
            <TouchableOpacity key={k.value} onPress={() => setKind(k.value)}
              style={{ paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: kind === k.value ? colors.primary : colors.border, backgroundColor: kind === k.value ? colors.primary : colors.surface }}>
              <Text style={{ color: kind === k.value ? colors.primaryContrast : colors.text, fontSize: 12, fontWeight: '600' }}>{k.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
          <TextInput value={amount} onChangeText={(t) => setAmount(onlyDecimal(t))} keyboardType="numeric" placeholder="Monto $" placeholderTextColor={colors.muted}
            style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
          {kind === 'combustible' ? (
            <TextInput value={liters} onChangeText={(t) => setLiters(onlyDecimal(t))} keyboardType="numeric" placeholder="Litros" placeholderTextColor={colors.muted}
              style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text }} />
          ) : null}
        </View>
        <TextInput value={note} onChangeText={setNote} placeholder="Nota (opcional)" placeholderTextColor={colors.muted}
          style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginTop: spacing.xs }} />
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs, alignItems: 'center' }}>
          <TouchableOpacity onPress={addReceipt} disabled={busy} style={{ backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>{receiptUrl ? '✓ Comprobante' : '📷 Comprobante'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={add} disabled={busy} style={{ flex: 1, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
            <Text style={{ color: colors.primaryContrast, fontWeight: '800', fontSize: 13 }}>{busy ? '…' : '+ Agregar gasto'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Card>
  );
}
