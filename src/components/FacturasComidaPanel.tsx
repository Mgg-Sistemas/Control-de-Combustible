// 🧾 FACTURAS DE COMIDA · QUIÉN PAGÓ Y QUIÉN NO (03-nov-2026).
// El MISMO panel en el teléfono de la cocina y en el control:
//  · cocina: ve las facturas y pone «💵 Ya pagó» (no factura ni anula);
//  · control (permiso completo de comida): además anula, con motivo.
// Cada tarjeta dice en grande a quién, de qué días, cuánto, y si está PAGADA o
// cuánto FALTA. Lo anulado no se borra: se ve en «🚫 Anuladas».
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Modal, ScrollView, TouchableOpacity, Linking } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { useRealtimeRefresh } from '../hooks/useRealtime';
import { exportPdf, pdfDocument } from '../lib/pdf';
import {
  ESTADO_FACTURA, FacturaComida, FiltroFacturas, PagoComida, dmy, estadoFactura, filtrarFacturas, numeroFactura,
  pagosDe, periodoTexto, resumenFacturas, textoPago, urlComprobanteSegura, usd,
} from '../lib/comidaFacturas';
import { anularFacturaComida, anularPagoComida, cargarFacturasYPagos, MSG_SIN_TABLA } from '../lib/comidaFacturasDb';
import { CSS_FACTURA_COMIDA, cuerpoFacturaComida, tituloFacturaComida } from '../lib/comidaFacturaHtml';
import { PagoComidaModal } from './PagoComidaModal';

export function FacturasComidaPanel({ visible, onClose, modo, hoy }: {
  visible: boolean;
  onClose: () => void;
  modo: 'control' | 'cocina';
  hoy: string;
}) {
  const { colors } = useTheme();
  const [facturas, setFacturas] = useState<FacturaComida[]>([]);
  const [pagos, setPagos] = useState<PagoComida[]>([]);
  const [sinTabla, setSinTabla] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroFacturas>('por_cobrar');
  const [q, setQ] = useState('');
  const [abierta, setAbierta] = useState<string | null>(null);
  const [pagando, setPagando] = useState<FacturaComida | null>(null);
  const [anulando, setAnulando] = useState<{ tipo: 'factura' | 'pago'; id: string; texto: string } | null>(null);
  const [motivo, setMotivo] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await cargarFacturasYPagos();
      setFacturas(r.facturas); setPagos(r.pagos); setSinTabla(r.sinTabla); setError(null);
    } catch (e: any) {
      setError(`No se pudieron leer las facturas (${e?.message ?? 'revisa la conexión'}).`);
    } finally { setCargando(false); }
  }, []);
  useEffect(() => { if (visible) cargar(); }, [visible, cargar]);
  useRealtimeRefresh(['comida_facturas', 'comida_pagos'], () => { if (visible) cargar(); });

  const lista = useMemo(() => filtrarFacturas(facturas, pagos, filtro, q), [facturas, pagos, filtro, q]);
  const tot = useMemo(() => resumenFacturas(facturas, pagos), [facturas, pagos]);

  const pdf = async (f: FacturaComida) => {
    const html = pdfDocument({
      title: tituloFacturaComida(f),
      subtitle: `${f.cuenta_nombre} · comidas ${periodoTexto(f.desde, f.hasta)}`,
      extraCss: CSS_FACTURA_COMIDA,
      body: cuerpoFacturaComida(f, pagos),
    });
    await exportPdf(html, `${numeroFactura(f.numero)} ${f.cuenta_nombre} ${dmy(f.desde)} a ${dmy(f.hasta)}`);
  };

  const confirmarAnular = async () => {
    if (!anulando) return;
    if (motivo.trim().length < 3) { setAviso('Escribe por qué se anula (mínimo 3 letras).'); return; }
    const r = anulando.tipo === 'factura' ? await anularFacturaComida(anulando.id, motivo) : await anularPagoComida(anulando.id, motivo);
    if (!r.ok) { setAviso(`⚠️ ${r.error}`); return; }
    setAviso(anulando.tipo === 'factura' ? '🚫 Factura anulada. Queda en «Anuladas».' : '🚫 Pago anulado. Queda a la vista, tachado.');
    setAnulando(null); setMotivo('');
    cargar();
  };

  const chip = (k: FiltroFacturas, label: string) => {
    const on = filtro === k;
    return (
      <TouchableOpacity key={k} onPress={() => setFiltro(k)} style={{ paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }}>
        <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 13 }}>{label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}>
          <Text style={{ color: colors.text, fontWeight: '900', fontSize: 18, flex: 1 }}>🧾 Facturas de comida · quién pagó</Text>
          <TouchableOpacity onPress={onClose} style={{ paddingHorizontal: spacing.md, paddingVertical: 6, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}>
            <Text style={{ color: colors.text, fontWeight: '800' }}>✕ Cerrar</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, maxWidth: 900, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
          {sinTabla ? (
            <View style={{ borderWidth: 1, borderColor: colors.warningSoftBorder, backgroundColor: colors.warningSoftBg, borderRadius: radius.md, padding: spacing.sm }}>
              <Text style={{ color: colors.warningSoftText, fontWeight: '800' }}>⚠️ {MSG_SIN_TABLA}</Text>
            </View>
          ) : null}
          {error ? <Text style={{ color: colors.danger, fontWeight: '800' }}>⚠️ {error}</Text> : null}

          {/* Lo que hay que saber de un vistazo. */}
          <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
            <View style={{ flexGrow: 1, flexBasis: 150, backgroundColor: colors.dangerSoftBg, borderColor: colors.dangerSoftBorder, borderWidth: 1, borderRadius: radius.md, padding: spacing.sm }}>
              <Text style={{ color: colors.dangerSoftText, fontWeight: '800', fontSize: 12 }}>⏳ FALTA POR COBRAR</Text>
              <Text style={{ color: colors.dangerSoftText, fontWeight: '900', fontSize: 22 }}>{usd(tot.porCobrar)}</Text>
              <Text style={{ color: colors.dangerSoftText, fontSize: 12 }}>{tot.pendientes} factura(s)</Text>
            </View>
            <View style={{ flexGrow: 1, flexBasis: 150, backgroundColor: colors.successSoftBg, borderColor: colors.successSoftBorder, borderWidth: 1, borderRadius: radius.md, padding: spacing.sm }}>
              <Text style={{ color: colors.successSoftText, fontWeight: '800', fontSize: 12 }}>✅ YA COBRADO</Text>
              <Text style={{ color: colors.successSoftText, fontWeight: '900', fontSize: 22 }}>{usd(tot.cobrado)}</Text>
              <Text style={{ color: colors.successSoftText, fontSize: 12 }}>{tot.pagadas} factura(s) pagadas completas</Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {chip('por_cobrar', '⏳ Por cobrar')}
            {chip('pagadas', '✅ Pagadas')}
            {chip('todas', '📋 Todas')}
            {chip('anuladas', '🚫 Anuladas')}
            <TouchableOpacity onPress={cargar} disabled={cargando} style={{ paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>{cargando ? '…' : '↻'}</Text>
            </TouchableOpacity>
          </View>
          <TextInput value={q} onChangeText={setQ} placeholder="🔎 Buscar empresa, persona o número de factura" placeholderTextColor={colors.muted}
            style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, fontSize: 15 }} />

          {aviso ? <Text style={{ color: colors.text, fontWeight: '800' }}>{aviso}</Text> : null}

          {!cargando && lista.length === 0 ? (
            <Text style={{ color: colors.muted, fontSize: 14, textAlign: 'center', marginTop: spacing.lg }}>
              {filtro === 'por_cobrar' ? '🎉 No hay nada pendiente por cobrar.' : 'No hay facturas en esta lista.'}
              {modo === 'cocina' && facturas.length === 0 ? '\nLas facturas las hace la oficina desde el cobro de comidas.' : ''}
            </Text>
          ) : null}

          {lista.map(({ f, estado, pagado, falta }) => {
            const ui = ESTADO_FACTURA[estado];
            const open = abierta === f.id;
            const todos = pagosDe(f.id, pagos, true);
            return (
              <View key={f.id} style={{ borderWidth: 2, borderColor: ui.color, borderRadius: radius.md, backgroundColor: colors.surface, overflow: 'hidden' }}>
                <View style={{ backgroundColor: ui.color, paddingVertical: 6, paddingHorizontal: spacing.sm, flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: '#fff', fontWeight: '900', fontSize: 14 }}>{ui.icon} {ui.texto}{estado === 'parcial' || estado === 'pendiente' ? ` · FALTAN ${usd(falta)}` : ''}</Text>
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>{numeroFactura(f.numero)}</Text>
                </View>
                <TouchableOpacity onPress={() => setAbierta(open ? null : f.id)} style={{ padding: spacing.sm }}>
                  <Text style={{ color: colors.text, fontWeight: '900', fontSize: 17 }}>{f.cuenta_clase === 'contacto' ? '📇' : '🏢'} {f.cuenta_nombre}</Text>
                  <Text style={{ color: colors.text, fontSize: 14, marginTop: 2 }}>📅 Comidas {periodoTexto(f.desde, f.hasta)} · {f.comidas} comida(s)</Text>
                  <Text style={{ color: colors.text, fontSize: 15, marginTop: 4 }}>
                    Total <Text style={{ fontWeight: '900' }}>{usd(f.monto_usd)}</Text> · Pagado <Text style={{ fontWeight: '900', color: colors.success }}>{usd(pagado)}</Text>
                    {estado !== 'anulada' ? <> · Falta <Text style={{ fontWeight: '900', color: falta > 0 ? colors.danger : colors.success }}>{usd(falta)}</Text></> : null}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{open ? '▲ ocultar pagos' : `▼ ver pagos (${todos.length})`}</Text>
                </TouchableOpacity>

                {open ? (
                  <View style={{ paddingHorizontal: spacing.sm, paddingBottom: spacing.sm, gap: 6 }}>
                    {todos.length === 0 ? <Text style={{ color: colors.muted }}>Todavía no hay pagos registrados.</Text> : null}
                    {todos.map((p) => (
                      <View key={p.id} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 6 }}>
                        <Text style={{ color: p.anulado_at ? colors.muted : colors.text, fontWeight: '800', textDecorationLine: p.anulado_at ? 'line-through' : 'none' }}>{p.anulado_at ? '🚫' : '💵'} {textoPago(p)}</Text>
                        <Text style={{ color: colors.muted, fontSize: 12 }}>Lo registró {p.created_by_nombre || '—'}{p.nota ? ` · ${p.nota}` : ''}</Text>
                        {p.anulado_at ? <Text style={{ color: colors.muted, fontSize: 12 }}>Anulado por {p.anulado_por_nombre || '—'}: {p.anulado_motivo}</Text> : null}
                        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 2 }}>
                          {urlComprobanteSegura(p.comprobante_url) ? (
                            <TouchableOpacity onPress={() => Linking.openURL(urlComprobanteSegura(p.comprobante_url)!)}><Text style={{ color: colors.brandText, fontWeight: '800' }}>📎 Ver comprobante</Text></TouchableOpacity>
                          ) : null}
                          {modo === 'control' && !p.anulado_at ? (
                            <TouchableOpacity onPress={() => { setAnulando({ tipo: 'pago', id: p.id, texto: textoPago(p) }); setMotivo(''); setAviso(null); }}><Text style={{ color: colors.danger, fontWeight: '800' }}>🚫 Anular pago</Text></TouchableOpacity>
                          ) : null}
                        </View>
                      </View>
                    ))}
                    {f.anulada_at ? <Text style={{ color: colors.muted, fontSize: 12 }}>Factura anulada por {f.anulada_por_nombre || '—'} el {dmy(f.anulada_at)}: {f.anulada_motivo}</Text> : null}
                    <Text style={{ color: colors.muted, fontSize: 12 }}>Factura hecha por {f.created_by_nombre || '—'} el {dmy(f.created_at)}{f.nota ? ` · ${f.nota}` : ''}</Text>
                  </View>
                ) : null}

                <View style={{ flexDirection: 'row', gap: spacing.sm, padding: spacing.sm, paddingTop: 0, flexWrap: 'wrap' }}>
                  {estado === 'pendiente' || estado === 'parcial' ? (
                    <TouchableOpacity onPress={() => { setPagando(f); setAviso(null); }} style={{ flexGrow: 2, backgroundColor: colors.success, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
                      <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>💵 Ya pagó · registrar pago</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity onPress={() => pdf(f)} style={{ flexGrow: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
                    <Text style={{ color: colors.text, fontWeight: '800' }}>📄 PDF</Text>
                  </TouchableOpacity>
                  {modo === 'control' && estado !== 'anulada' ? (
                    <TouchableOpacity onPress={() => { setAnulando({ tipo: 'factura', id: f.id, texto: `${numeroFactura(f.numero)} de ${f.cuenta_nombre}` }); setMotivo(''); setAviso(null); }} style={{ flexGrow: 1, borderWidth: 1, borderColor: colors.dangerSoftBorder, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
                      <Text style={{ color: colors.danger, fontWeight: '800' }}>🚫 Anular</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            );
          })}
          <View style={{ height: spacing.xl }} />
        </ScrollView>
      </View>

      {/* Anular: siempre con motivo; nada se borra. */}
      {anulando ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setAnulando(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: spacing.md, zIndex: 9999 }}>
            <View style={{ backgroundColor: colors.background, borderRadius: radius.md, padding: spacing.md, maxWidth: 480, width: '100%', alignSelf: 'center' }}>
              <Text style={{ color: colors.text, fontWeight: '900', fontSize: 17 }}>🚫 Anular {anulando.tipo === 'factura' ? 'factura' : 'pago'}</Text>
              <Text style={{ color: colors.text, marginTop: 6 }}>{anulando.texto}</Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>
                {anulando.tipo === 'factura'
                  ? 'La factura no se borra: queda en «🚫 Anuladas» con tu nombre y el motivo. Sus pagos quedan a la vista. Después puedes hacer una nueva de esos días.'
                  : 'El pago no se borra: queda tachado, con tu nombre y el motivo, y deja de contar como pagado.'}
              </Text>
              <TextInput value={motivo} onChangeText={setMotivo} placeholder="¿Por qué se anula?" placeholderTextColor={colors.muted}
                style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, marginTop: spacing.sm }} />
              {aviso ? <Text style={{ color: colors.danger, fontWeight: '700', marginTop: 6 }}>{aviso}</Text> : null}
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                <TouchableOpacity onPress={() => { setAnulando(null); setAviso(null); }} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                  <Text style={{ color: colors.text, fontWeight: '800' }}>No, volver</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={confirmarAnular} style={{ flex: 1, backgroundColor: colors.danger, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontWeight: '900' }}>Sí, anular</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}

      {/* Montado al final: el último modal montado es el que queda encima. */}
      <PagoComidaModal
        factura={pagando}
        falta={pagando ? estadoFactura(pagando, pagos).falta : 0}
        hoy={hoy}
        onClose={() => setPagando(null)}
        onGuardado={() => { cargar(); }}
      />
    </Modal>
  );
}
