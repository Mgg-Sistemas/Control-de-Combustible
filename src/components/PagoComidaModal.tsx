// 💵 REGISTRAR UN PAGO DE COMIDA (03-nov-2026). Hecho para la cocina: botones
// grandes, en palabras sencillas, y una pantalla de «¿es correcto?» antes de
// guardar. Al final dice clarito «✅ quedó registrado». La regla está en
// src/lib/comidaFacturas.ts (validarPago / filaNuevoPago).
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Modal, ScrollView, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { DateField } from './DateField';
import { useBcvRate } from '../lib/bcv';
import { leerNumero } from '../lib/numeros';
import { takePhotoAndUpload, pickPhotoFromGalleryAndUpload } from '../lib/photo';
import {
  FacturaComida, METODOS_PAGO_COMIDA, MetodoPagoComida, bs, filaNuevoPago, fraseConfirmarPago, metodoDe,
  numeroFactura, periodoTexto, usd, validarPago,
} from '../lib/comidaFacturas';
import { registrarPagoComida } from '../lib/comidaFacturasDb';

export function PagoComidaModal({ factura, falta, hoy, onClose, onGuardado }: {
  factura: FacturaComida | null;
  falta: number;
  hoy: string;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const { colors } = useTheme();
  const { rate } = useBcvRate();
  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState<MetodoPagoComida | null>(null);
  const [tasa, setTasa] = useState('');
  const [referencia, setReferencia] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [nota, setNota] = useState('');
  const [foto, setFoto] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [paso, setPaso] = useState<'datos' | 'confirmar' | 'listo'>('datos');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cada vez que se abre para otra factura, empieza limpio con lo que falta.
  useEffect(() => {
    if (!factura) return;
    setMonto(falta > 0 ? String(falta.toFixed(2)).replace('.', ',') : '');
    setMetodo(null); setReferencia(''); setFecha(hoy); setNota(''); setFoto(null);
    setPaso('datos'); setError(null); setGuardando(false);
  }, [factura?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (rate && !tasa) setTasa(String(rate).replace('.', ',')); }, [rate]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = metodo ? metodoDe(metodo) : null;
  const montoNum = leerNumero(monto);
  const tasaNum = leerNumero(tasa);
  const datos = { montoUsd: montoNum, metodo, tasa: tasaNum, referencia, fecha };
  const problema = useMemo(() => validarPago(datos, falta, hoy), [montoNum, metodo, tasaNum, referencia, fecha, falta, hoy]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!factura) return null;

  const subirFoto = async (camara: boolean) => {
    setSubiendo(true);
    try {
      const r = camara
        ? await takePhotoAndUpload('comida-pagos', factura.id)
        : await pickPhotoFromGalleryAndUpload('comida-pagos', factura.id);
      if (r.ok && r.url) setFoto(r.url);
      else if (r.error) setError(r.error);
    } finally { setSubiendo(false); }
  };

  const guardar = async () => {
    if (problema) { setError(problema); setPaso('datos'); return; }
    setGuardando(true);
    setError(null);
    const r = await registrarPagoComida(filaNuevoPago(factura.id, { ...datos, nota, comprobanteUrl: foto }, hoy));
    setGuardando(false);
    if (!r.ok) { setError(r.error); setPaso('datos'); return; }
    setPaso('listo');
    onGuardado();
  };

  const grande = { fontSize: 22, fontWeight: '900' as const, color: colors.text };
  const input = { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, fontSize: 16 } as const;
  const etiqueta = (t: string) => <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, marginTop: spacing.md, marginBottom: 6 }}>{t}</Text>;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: spacing.sm, zIndex: 9999 }}>
        <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, maxHeight: '96%', width: '100%', maxWidth: 560, alignSelf: 'center', overflow: 'hidden' }}>
          <ScrollView contentContainerStyle={{ padding: spacing.md }} keyboardShouldPersistTaps="handled">
            {/* A QUIÉN Y QUÉ: siempre arriba, para que nadie se equivoque de factura. */}
            <View style={{ backgroundColor: colors.brand, borderRadius: radius.md, padding: spacing.md }}>
              <Text style={{ color: colors.brandContrast, opacity: 0.85, fontSize: 12, fontWeight: '800' }}>REGISTRAR PAGO · FACTURA {numeroFactura(factura.numero)}</Text>
              <Text style={{ color: colors.brandContrast, fontSize: 20, fontWeight: '900', marginTop: 2 }}>{factura.cuenta_nombre}</Text>
              <Text style={{ color: colors.brandContrast, fontSize: 13, marginTop: 2 }}>Comidas {periodoTexto(factura.desde, factura.hasta)} · {factura.comidas} comida(s)</Text>
              <Text style={{ color: colors.brandContrast, fontSize: 15, fontWeight: '800', marginTop: 6 }}>Total {usd(factura.monto_usd)} · Falta {usd(falta)}</Text>
            </View>

            {paso === 'listo' ? (
              <View style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
                <Text style={{ fontSize: 56 }}>✅</Text>
                <Text style={[grande, { textAlign: 'center', marginTop: spacing.sm }]}>Quedó registrado</Text>
                <Text style={{ color: colors.text, fontSize: 15, textAlign: 'center', marginTop: spacing.sm }}>
                  {factura.cuenta_nombre} pagó {usd(montoNum)} con {m?.label.toLowerCase()}.
                </Text>
                <TouchableOpacity onPress={onClose} style={{ marginTop: spacing.lg, backgroundColor: colors.success, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xl }}>
                  <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>Listo</Text>
                </TouchableOpacity>
              </View>
            ) : paso === 'confirmar' ? (
              <View style={{ paddingVertical: spacing.md }}>
                <Text style={[grande, { textAlign: 'center' }]}>¿Es correcto?</Text>
                <Text style={{ color: colors.text, fontSize: 16, textAlign: 'center', marginTop: spacing.sm, lineHeight: 23 }}>
                  {fraseConfirmarPago(factura, datos, falta)}
                </Text>
                {m?.bs && tasaNum > 0 ? (
                  <Text style={{ color: colors.text, fontSize: 15, textAlign: 'center', marginTop: spacing.xs }}>
                    En bolívares: <Text style={{ fontWeight: '900' }}>{bs(montoNum * tasaNum)}</Text> (tasa {tasa})
                  </Text>
                ) : null}
                {referencia.trim() ? <Text style={{ color: colors.muted, fontSize: 14, textAlign: 'center', marginTop: 4 }}>Referencia: {referencia.trim()}</Text> : null}
                <Text style={{ color: colors.muted, fontSize: 14, textAlign: 'center', marginTop: 4 }}>Fecha del pago: {fecha.split('-').reverse().join('/')}{foto ? ' · 📎 con foto' : ''}</Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                  <TouchableOpacity onPress={() => setPaso('datos')} disabled={guardando} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>◀ Corregir</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={guardar} disabled={guardando} style={{ flex: 2, backgroundColor: colors.success, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: guardando ? 0.6 : 1 }}>
                    <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>{guardando ? 'Guardando…' : '✅ Sí, registrar el pago'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <>
                {etiqueta('1. ¿Cómo pagó?')}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {METODOS_PAGO_COMIDA.map((x) => {
                    const on = metodo === x.key;
                    return (
                      <TouchableOpacity key={x.key} onPress={() => setMetodo(x.key)}
                        style={{ flexGrow: 1, flexBasis: 150, paddingVertical: spacing.md, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 2, borderColor: on ? colors.success : colors.border, backgroundColor: on ? colors.successSoftBg : colors.surface, alignItems: 'center' }}>
                        <Text style={{ fontSize: 22 }}>{x.icon}</Text>
                        <Text style={{ color: on ? colors.successSoftText : colors.text, fontWeight: '800', fontSize: 13, textAlign: 'center' }}>{x.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {etiqueta('2. ¿Cuánto pagó? (en dólares)')}
                <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                  <Text style={grande}>$</Text>
                  <TextInput value={monto} onChangeText={setMonto} keyboardType="decimal-pad" inputMode="decimal" placeholder="0,00" placeholderTextColor={colors.muted} style={[input, { flex: 1, fontSize: 22, fontWeight: '900' }]} />
                </View>
                {falta > 0 && Math.abs(montoNum - falta) > 0.009 ? (
                  <TouchableOpacity onPress={() => setMonto(String(falta.toFixed(2)).replace('.', ','))} style={{ marginTop: 6 }}>
                    <Text style={{ color: colors.brandText, fontWeight: '800' }}>Pagó todo lo que falta ({usd(falta)})</Text>
                  </TouchableOpacity>
                ) : null}

                {m?.bs ? (
                  <>
                    {etiqueta('Tasa del día (Bs por dólar)')}
                    <TextInput value={tasa} onChangeText={setTasa} keyboardType="decimal-pad" inputMode="decimal" placeholder="Tasa BCV" placeholderTextColor={colors.muted} style={input} />
                    {tasaNum > 0 && montoNum > 0 ? (
                      <Text style={{ color: colors.text, fontSize: 15, marginTop: 6 }}>Equivale a <Text style={{ fontWeight: '900' }}>{bs(montoNum * tasaNum)}</Text></Text>
                    ) : null}
                  </>
                ) : null}

                {m?.ref ? (
                  <>
                    {etiqueta('Número de referencia')}
                    <TextInput value={referencia} onChangeText={setReferencia} placeholder="Ej. 004512" placeholderTextColor={colors.muted} style={input} />
                  </>
                ) : null}

                {etiqueta('3. ¿Qué día pagó?')}
                <DateField value={fecha} onChange={setFecha} maxISO={hoy} />

                {etiqueta('Foto del comprobante (si hay)')}
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <TouchableOpacity onPress={() => subirFoto(true)} disabled={subiendo} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', backgroundColor: colors.surface }}>
                    <Text style={{ color: colors.text, fontWeight: '800' }}>📷 Cámara</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => subirFoto(false)} disabled={subiendo} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', backgroundColor: colors.surface }}>
                    <Text style={{ color: colors.text, fontWeight: '800' }}>🖼️ Galería</Text>
                  </TouchableOpacity>
                </View>
                {subiendo ? <ActivityIndicator style={{ marginTop: 6 }} /> : null}
                {foto ? (
                  <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <Image source={{ uri: foto }} style={{ width: 70, height: 70, borderRadius: radius.md }} />
                    <TouchableOpacity onPress={() => setFoto(null)}><Text style={{ color: colors.danger, fontWeight: '800' }}>✕ Quitar foto</Text></TouchableOpacity>
                  </View>
                ) : null}

                {etiqueta('Nota (opcional)')}
                <TextInput value={nota} onChangeText={setNota} placeholder="Ej. lo trajo el encargado" placeholderTextColor={colors.muted} style={input} />

                {error || (problema && metodo) ? (
                  <View style={{ marginTop: spacing.md, borderWidth: 1, borderColor: colors.dangerSoftBorder, backgroundColor: colors.dangerSoftBg, borderRadius: radius.md, padding: spacing.sm }}>
                    <Text style={{ color: colors.dangerSoftText, fontWeight: '800' }}>⚠️ {error || problema}</Text>
                  </View>
                ) : null}

                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
                  <TouchableOpacity onPress={onClose} style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => { setError(null); if (problema) { setError(problema); return; } setPaso('confirmar'); }}
                    disabled={subiendo}
                    style={{ flex: 2, backgroundColor: problema ? colors.surfaceAlt : colors.success, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}>
                    <Text style={{ color: problema ? colors.muted : '#fff', fontWeight: '900', fontSize: 16 }}>Siguiente ▶</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
