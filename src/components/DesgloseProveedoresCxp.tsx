// 💳 DESGLOSE POR PROVEEDOR EN POR PAGAR (04-nov-2026, a pedido: «me sale un
// proveedor y un monto completo, y no se entiende cuánto hay que pagarle a cada
// proveedor»). Cuando la cuenta viene de un requerimiento con renglones de varios
// proveedores, dice cuánto pagarle a CADA uno, qué productos son y sus datos de
// pago. Y el botón del PDF del requerimiento, el mismo papel de Requerimientos.
// Solo lee: no cambia la cuenta ni el requerimiento.
import React, { useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing } from '../theme';
import { useToast } from './ToastProvider';
import { exportPdf } from '../lib/pdf';
import { requerimientoHtml } from '../lib/requerimiento';
import { armarReqPdfData, desgloseProveedoresDeReq } from '../lib/requerimientoPdfDatos';
import type { InventoryRequirement, Supplier } from '../types/database';

const money = (n: number) => (Math.round((Number(n) || 0) * 100) / 100)
  .toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function DesgloseProveedoresCxp(props: {
  req: InventoryRequirement;
  suppliers: readonly Supplier[];
  rate: number | null;
  companyName: (id: string | null | undefined) => string | null;
  /** false (por defecto) = siempre actualizado a la tasa del día de hoy; true = usa la tasa de ese día (del requerimiento). */
  usarTasaDeEseDia?: boolean;
  tasaDeEseDia?: number | null;
  montoBsEseDia?: number;
  montoBsHoy?: number;
  onToggleTasaDeEseDia?: () => void;
}) {
  const { colors } = useTheme();
  const toast = useToast();
  const [generando, setGenerando] = useState(false);
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});
  const [pagosAbiertos, setPagosAbiertos] = useState<Record<string, boolean>>({});

  const usarEseDia = Boolean(props.usarTasaDeEseDia);
  const tasaEfectiva = usarEseDia && props.tasaDeEseDia && props.tasaDeEseDia > 0 ? props.tasaDeEseDia : props.rate;
  const grupos = useMemo(
    () =>
      desgloseProveedoresDeReq(props.req, props.suppliers, tasaEfectiva, {
        actualizarATasaDelDia: !usarEseDia,
      }),
    [props.req, props.suppliers, tasaEfectiva, usarEseDia],
  );
  const varios = grupos.length > 1;
  const totalUsd = grupos.reduce((a, g) => a + g.totalUsd, 0);
  const totalBsActual = grupos.reduce((a, g) => a + g.totalBs, 0);
  const totalBsEseDia = props.montoBsEseDia && props.montoBsEseDia > 0
    ? props.montoBsEseDia
    : grupos.reduce((a, g) => a + (g.totalBsEseDia ?? g.totalBs), 0);

  const verPdf = async () => {
    setGenerando(true);
    try {
      const datos = await armarReqPdfData(props.req, {
        suppliers: props.suppliers,
        companyName: props.companyName,
        rate: tasaEfectiva,
        actualizarATasaDelDia: !usarEseDia,
      });
      await exportPdf(requerimientoHtml(datos), `Requerimiento ${props.req.code ?? ''}`.trim());
    } catch (e: any) {
      toast.error('No se pudo generar el PDF: ' + (e?.message ?? e));
    } finally {
      setGenerando(false);
    }
  };

  return (
    <View style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surface, width: '100%', maxWidth: '100%', minWidth: 0 }}>
      {props.onToggleTasaDeEseDia ? (
        <TouchableOpacity
          onPress={props.onToggleTasaDeEseDia}
          activeOpacity={0.85}
          style={{
            marginBottom: spacing.sm,
            paddingVertical: 11,
            paddingHorizontal: 12,
            borderRadius: radius.md,
            borderWidth: 2,
            borderColor: usarEseDia ? '#F59E0B' : '#16A34A',
            backgroundColor: usarEseDia ? 'rgba(245, 158, 11, 0.14)' : 'rgba(22, 163, 74, 0.14)',
            gap: 4,
            width: '100%',
            maxWidth: '100%',
            minWidth: 0,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, width: '100%', maxWidth: '100%', minWidth: 0 }}>
            <Text style={{ color: usarEseDia ? '#F59E0B' : '#16A34A', fontSize: 12.5, fontWeight: '900', flexShrink: 1 }}>
              {usarEseDia
                ? `📅 USANDO LA TASA DE ESE DÍA (DEL REQUERIMIENTO${props.tasaDeEseDia ? ` · Bs ${money(props.tasaDeEseDia)}/$` : ''})`
                : `💱 ACTUALIZADO A LA TASA DEL DÍA DE HOY${props.rate ? ` (BCV: Bs ${money(props.rate)}/$)` : ''}`}
            </Text>
            <View
              style={{
                backgroundColor: usarEseDia ? '#F59E0B' : '#16A34A',
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: radius.sm,
                maxWidth: '100%',
                flexShrink: 1,
              }}
            >
              <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '900', flexShrink: 1 }}>
                {usarEseDia
                  ? '💱 VOLVER A ACTUALIZAR A LA TASA DEL DÍA DE HOY'
                  : `📅 ¿QUIERES LA TASA DE ESE DÍA? TOCA AQUÍ${totalBsEseDia > 0 ? ` (Bs ${money(totalBsEseDia)})` : ''}`}
              </Text>
            </View>
          </View>
          <Text style={{ color: colors.text, fontSize: 11.5, fontWeight: '800', flexShrink: 1 }}>
            {usarEseDia
              ? `Viendo Bs de ese día: Bs ${money(totalBsActual)}${props.rate ? ` · Toca este botón enorme para volver a actualizar a la tasa BCV de hoy (Bs ${money(props.montoBsHoy || totalUsd * props.rate)}).` : ''}`
              : `Total en Bs actualizado a hoy: Bs ${money(totalBsActual)}${totalBsEseDia > 0 ? ` · Si quieres ver y pagar con la tasa de ese día (Bs ${money(totalBsEseDia)}), toca este botón enorme.` : ''}`}
          </Text>
        </TouchableOpacity>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, width: '100%', maxWidth: '100%', minWidth: 0 }}>
        <Text style={{ color: colors.brandText, fontSize: 11.5, fontWeight: '900', flexShrink: 1 }}>
          {varios
            ? `💳 DESGLOSE POR PROVEEDOR · ${grupos.length} proveedores · cuánto pagarle a cada uno`
            : '💳 PRODUCTOS DE ESTE PAGO'}
        </Text>
        <TouchableOpacity onPress={() => void verPdf()} disabled={generando}
          style={{ borderWidth: 1, borderColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, opacity: generando ? 0.5 : 1, maxWidth: '100%', flexShrink: 1 }}>
          <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 11.5, flexShrink: 1 }}>
            {generando ? 'Generando…' : `📄 Ver / descargar PDF${props.req.code ? ` (${props.req.code})` : ''}`}
          </Text>
        </TouchableOpacity>
      </View>

      {grupos.map((g, gi) => {
        const k = `${gi}-${g.proveedor}`;
        const abierto = abiertos[k] ?? true;
        const pagoAbierto = pagosAbiertos[k] ?? false;
        return (
          <View key={k} style={{ marginTop: spacing.xs, borderTopWidth: gi === 0 ? 0 : 1, borderTopColor: colors.border, paddingTop: gi === 0 ? 0 : spacing.xs }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
              <View style={{ flex: 1, minWidth: 150 }}>
                <Text selectable style={{ color: colors.text, fontWeight: '900', fontSize: 13 }}>🏭 {g.proveedor}</Text>
                <TouchableOpacity
                  onPress={() => setPagosAbiertos((p) => ({ ...p, [k]: !pagoAbierto }))}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  style={{ alignSelf: 'flex-start', marginTop: 2 }}
                >
                  <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '800' }}>
                    {pagoAbierto ? '▲ 💳 Ocultar método de pago' : '▼ 💳 Método de pago'}
                  </Text>
                </TouchableOpacity>
                {pagoAbierto ? (
                  g.pago ? (
                    <Text selectable style={{ color: colors.text, fontSize: 11.5, marginTop: 2 }}>{g.pago}</Text>
                  ) : (
                    <Text style={{ color: colors.warningSoftText, fontSize: 11, fontWeight: '700', marginTop: 2 }}>⚠️ Este proveedor no tiene datos de pago cargados (Compras → Proveedores).</Text>
                  )
                ) : null}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text selectable style={{ color: colors.text, fontWeight: '900', fontSize: 14 }}>A pagar: ${money(g.totalUsd)}</Text>
                {g.totalBs > 0 ? <Text selectable style={{ color: colors.successSoftText, fontSize: 11, fontWeight: '800' }}>Bs {money(g.totalBs)}</Text> : null}
                <Text style={{ color: colors.muted, fontSize: 10.5 }}>
                  Subtotal ${money(g.subtotalUsd)}{g.ivaUsd > 0 ? ` + IVA $${money(g.ivaUsd)}` : ' · sin IVA'}{g.exentoUsd > 0 ? ` · exento $${money(g.exentoUsd)}` : ''}
                </Text>
              </View>
            </View>

            <TouchableOpacity onPress={() => setAbiertos((p) => ({ ...p, [k]: !abierto }))} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '800', marginTop: 3 }}>
                {abierto ? '▲' : '▼'} {g.renglones} producto(s)
              </Text>
            </TouchableOpacity>
            {abierto ? g.items.map((it, ii) => (
              <View key={ii} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingVertical: 2 }}>
                <Text selectable style={{ color: colors.text, fontSize: 11.5, flex: 1 }}>
                  {ii + 1}. {it.name} · {money(it.qty)} {it.unit} × ${money(it.uUsd)}{it.exento ? ' · 🛡️ exento' : ''}
                </Text>
                <Text selectable style={{ color: colors.text, fontSize: 11.5, fontWeight: '800' }}>${money(it.lineUsd)}</Text>
              </View>
            )) : null}
          </View>
        );
      })}

      {varios ? (
        <Text style={{ color: colors.muted, fontSize: 10.5, marginTop: spacing.xs }}>
          La suma de los proveedores da el total de la cuenta: ${money(grupos.reduce((a, g) => a + g.totalUsd, 0))}.
        </Text>
      ) : null}
    </View>
  );
}
