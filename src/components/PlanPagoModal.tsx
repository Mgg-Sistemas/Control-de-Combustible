// 📋 Editor del PLAN DE PAGO (02-nov-2026). Se abre desde Por Pagar y desde la
// tarjeta del requerimiento. Plantillas de un toque, y cada parte con su monto en
// $, su método y (si es en Bs) su tasa: BCV (la de hoy), USDT, Euro u otra escrita.
// No deja guardar si las partes no suman el total de la cuenta.
//
// ⚠️ Se monta AL FINAL de la pantalla, con zIndex 9999 (en web gana el último montado).
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { leerNumero } from '../lib/numeros';
import {
  PlanPago, PartePlan, METODOS_PARTE, TASAS, CONCEPTOS, PLANTILLAS, PlantillaPlan, aplicarPlantilla,
  validarPlan, monedaDeMetodo, montoEnMoneda, baseEIva, nuevoIdParte, TasaTipo,
} from '../lib/planPago';

type Fila = PartePlan & { montoTxt: string; tasaTxt: string };

const aFila = (p: PartePlan): Fila => ({ ...p, montoTxt: p.monto_usd ? String(p.monto_usd) : '', tasaTxt: p.tasa ? String(p.tasa) : '' });
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const fmt = (n: number) => r2(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PlanPagoModal({ visible, titulo, totalUsd, alicuotaIva, planInicial, tasaBcv, onGuardar, onClose }: {
  visible: boolean;
  titulo: string;
  totalUsd: number;
  alicuotaIva?: number | null;
  planInicial: PlanPago | null;
  tasaBcv?: number | null;
  /** Devuelve true si se guardó. null = quitar el plan. */
  onGuardar: (plan: PlanPago | null) => Promise<boolean>;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const [filas, setFilas] = useState<Fila[]>([]);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setFilas((planInicial?.partes || []).map(aFila));
    setNota(String(planInicial?.nota ?? ''));
  }, [visible, planInicial]);

  const partes: PartePlan[] = useMemo(() => filas.map((f) => ({
    id: f.id, concepto: f.concepto, etiqueta: f.etiqueta?.trim() || null, metodo: f.metodo,
    monto_usd: r2(leerNumero(f.montoTxt)),
    tasa_tipo: monedaDeMetodo(f.metodo) === 'VES' ? (f.tasa_tipo ?? 'bcv') : null,
    tasa: monedaDeMetodo(f.metodo) === 'VES' ? (leerNumero(f.tasaTxt) || null) : null,
  })), [filas]);
  const error = validarPlan(partes, totalUsd);
  const suma = r2(partes.reduce((s, p) => s + p.monto_usd, 0));
  const { base, iva } = baseEIva(totalUsd, alicuotaIva);

  const setFila = (i: number, patch: Partial<Fila>) => setFilas((prev) => prev.map((f, k) => (k === i ? { ...f, ...patch } : f)));
  const plantilla = (k: PlantillaPlan) => setFilas(aplicarPlantilla(k, totalUsd, alicuotaIva, { bcv: tasaBcv }).map(aFila));
  const agregar = () => setFilas((prev) => [...prev, aFila({
    id: nuevoIdParte(), concepto: 'parte', monto_usd: Math.max(0, r2(totalUsd - suma)), metodo: 'transferencia_bs', tasa_tipo: 'bcv', tasa: Number(tasaBcv) > 0 ? Number(tasaBcv) : null,
  })]);
  const elegirTasa = (i: number, t: TasaTipo) => setFila(i, { tasa_tipo: t, ...(t === 'bcv' && Number(tasaBcv) > 0 ? { tasaTxt: String(tasaBcv) } : {}) });

  const guardar = async (quitar = false) => {
    if (!quitar && error) return;
    setGuardando(true);
    try {
      const ok = await onGuardar(quitar ? null : { partes, nota: nota.trim() || null });
      if (ok) onClose();
    } finally {
      setGuardando(false);
    }
  };

  const chip = (on: boolean, label: string, onPress: () => void, key?: string) => (
    <TouchableOpacity key={key ?? label} onPress={onPress}
      style={{ borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surfaceAlt, paddingVertical: 5, paddingHorizontal: spacing.sm }}>
      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 11 }}>{label}</Text>
    </TouchableOpacity>
  );
  const input = { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 6, color: colors.text, backgroundColor: colors.surface, fontSize: 13 } as const;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: spacing.md, zIndex: 9999 }}>
        <View style={{ width: '100%', maxWidth: 600, maxHeight: '94%', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, zIndex: 9999 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16, flexShrink: 1 }}>📋 Plan de pago · {titulo}</Text>
            <TouchableOpacity onPress={onClose}><Text style={{ color: colors.muted, fontWeight: '900', fontSize: 18 }}>✕</Text></TouchableOpacity>
          </View>
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
            Total ${fmt(totalUsd)}{Number(alicuotaIva) > 0 ? ` · base $${fmt(base)} + IVA ${alicuotaIva}% $${fmt(iva)}` : ''}{Number(tasaBcv) > 0 ? ` · BCV hoy ${fmt(Number(tasaBcv))}` : ''}
          </Text>

          <ScrollView style={{ marginTop: spacing.sm }} keyboardShouldPersistTaps="handled">
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12, marginBottom: 4 }}>Plantillas</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {PLANTILLAS.filter((p) => !p.necesitaIva || Number(alicuotaIva) > 0).map((p) => chip(false, p.label, () => plantilla(p.key), p.key))}
            </View>

            {filas.map((f, i) => {
              const ves = monedaDeMetodo(f.metodo) === 'VES';
              const p = partes[i];
              return (
                <View key={f.id} style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, gap: 6 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: colors.text, fontWeight: '900' }}>Parte {i + 1}</Text>
                    <TouchableOpacity onPress={() => setFilas((prev) => prev.filter((_, k) => k !== i))}>
                      <Text style={{ color: colors.danger, fontWeight: '800', fontSize: 12 }}>✕ Quitar</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {CONCEPTOS.map((c) => chip(f.concepto === c.key, c.label, () => setFila(i, { concepto: c.key }), c.key))}
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                    <TextInput value={f.montoTxt} onChangeText={(t) => setFila(i, { montoTxt: t })} keyboardType="decimal-pad" inputMode="decimal"
                      placeholder="Monto en $" placeholderTextColor={colors.muted} style={[input, { flexGrow: 1, flexBasis: 120 }]} />
                    <TextInput value={f.etiqueta ?? ''} onChangeText={(t) => setFila(i, { etiqueta: t })}
                      placeholder="Detalle (opcional)" placeholderTextColor={colors.muted} style={[input, { flexGrow: 2, flexBasis: 160 }]} />
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {METODOS_PARTE.map((m) => chip(f.metodo === m.key, m.label, () => setFila(i, {
                      metodo: m.key,
                      ...(m.moneda === 'VES' && !f.tasa_tipo ? { tasa_tipo: 'bcv' as TasaTipo, tasaTxt: Number(tasaBcv) > 0 ? String(tasaBcv) : f.tasaTxt } : {}),
                    }), m.key))}
                  </View>
                  {ves ? (
                    <View style={{ gap: 6 }}>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>Tasa:</Text>
                        {TASAS.map((t) => chip((f.tasa_tipo ?? 'bcv') === t.key, t.label, () => elegirTasa(i, t.key), t.key))}
                        <TextInput value={f.tasaTxt} onChangeText={(t) => setFila(i, { tasaTxt: t })} keyboardType="decimal-pad" inputMode="decimal"
                          placeholder="Bs por $" placeholderTextColor={colors.muted} style={[input, { width: 120 }]} />
                      </View>
                      <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>= Bs {fmt(montoEnMoneda(p))}</Text>
                    </View>
                  ) : null}
                </View>
              );
            })}

            <TouchableOpacity onPress={agregar} style={{ marginTop: spacing.sm, alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.brand, borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: spacing.md }}>
              <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>+ Agregar parte</Text>
            </TouchableOpacity>

            <TextInput value={nota} onChangeText={setNota} multiline placeholder="Nota del plan (opcional)" placeholderTextColor={colors.muted}
              style={[input, { marginTop: spacing.sm, minHeight: 50, textAlignVertical: 'top' }]} />
          </ScrollView>

          <Text style={{ marginTop: spacing.sm, fontWeight: '800', fontSize: 12, color: error ? colors.danger : colors.success }}>
            {filas.length === 0 ? 'Elige una plantilla o agrega partes.' : error ? `⚠️ ${error}` : `✅ Las partes suman $${fmt(suma)}, igual al total.`}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
            {planInicial ? (
              <TouchableOpacity disabled={guardando} onPress={() => guardar(true)} style={{ flexGrow: 1, flexBasis: 120, borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                <Text style={{ color: colors.danger, fontWeight: '800' }}>Quitar plan</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={onClose} style={{ flexGrow: 1, flexBasis: 120, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity disabled={!!error || guardando} onPress={() => guardar(false)} style={{ flexGrow: 1, flexBasis: 120, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', opacity: error || guardando ? 0.5 : 1 }}>
              {guardando ? <ActivityIndicator color={colors.brandContrast} /> : <Text style={{ color: colors.brandContrast, fontWeight: '900' }}>Guardar plan</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
