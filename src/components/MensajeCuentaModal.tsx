// 📲 Mensaje / PDF de pago (02-nov-2026). Una cuenta por pagar o varias marcadas:
// vista previa del texto, interruptores de lo que sale (recordados por persona en
// este equipo) y tres salidas: copiar, WhatsApp y PDF. Lo apagado no sale.
//
// ⚠️ Se monta AL FINAL de la pantalla, con zIndex 9999 (en web gana el último montado).
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, Switch, Text, TextInput, TouchableOpacity, View, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius } from '../theme';
import { exportPdf } from '../lib/pdf';
import {
  DatosMensajeCuenta,
  OpcionesMensajeCuenta,
  OPCIONES_MENSAJE_DEFECTO,
  normalizarOpcionesMensaje,
  construirMensajeCuentas,
  mensajeCuentasHtml,
  urlWhatsappMensaje,
  ModoMensajeCuenta,
  MotivoDecisionPago,
  DecisionCuentaPago,
  ETIQUETA_MOTIVO_DECISION,
  OpcionesListaTesoreria,
  OPCIONES_TESORERIA_DEFECTO,
  construirListaTesoreriaCuentas,
  listaTesoreriaCuentasHtml,
  claveCuentaDecision,
  construirResumenDecisionCuentas,
  resumenDecisionCuentasHtml,
  montoEs,
} from '../lib/cuentaMensaje';

const ETIQUETAS: { k: keyof OpcionesMensajeCuenta; t: string; soloPdf?: boolean }[] = [
  { k: 'nota', t: '📌 Nota del requerimiento' },
  { k: 'personas', t: '🙋 Solicita / analista / autorizó' },
  { k: 'condiciones', t: '🤝 Condiciones de pago' },
  { k: 'bs', t: '💱 Monto en Bs' },
  { k: 'banco', t: '🏦 Datos bancarios del proveedor' },
  { k: 'empresa', t: '🏢 Empresa que paga' },
  { k: 'logoBcv', t: 'Logo BCV', soloPdf: true },
  { k: 'logoSos', t: 'Logo SOS', soloPdf: true },
  { k: 'logoGolden', t: 'Logo Golden Touch', soloPdf: true },
  { k: 'logoRenace', t: 'Logo Renace', soloPdf: true },
  { k: 'logoJhenzaen', t: 'Logo Jhenzaen', soloPdf: true },
  { k: 'marcaTexto', t: 'Línea de la empresa en el membrete', soloPdf: true },
];

const ETIQUETAS_TESORERIA: { k: keyof Omit<OpcionesListaTesoreria, 'desde' | 'hasta' | 'empresaTexto'>; t: string }[] = [
  { k: 'incluirOrden', t: '🔢 Código de orden / documento (REQ)' },
  { k: 'incluirDetalle', t: '📝 Concepto / detalle del pedido' },
  { k: 'incluirPersonas', t: '🙋 Quién solicita / analista / autorizó' },
  { k: 'incluirCondiciones', t: '🤝 Condiciones de pago' },
  { k: 'incluirBs', t: '💱 Equivalente en Bs' },
  { k: 'incluirPorPreparar', t: '💳 Resumen «Por preparar» (por método)' },
];

const MOTIVOS_DECISION: MotivoDecisionPago[] = ['si', 'sin_fondos', 'esperando_jefe', 'otro'];

export function MensajeCuentaModal({
  visible,
  datos,
  usuarioId,
  modoInicial,
  desde,
  hasta,
  empresaTexto,
  onClose,
  copiar,
}: {
  visible: boolean;
  datos: DatosMensajeCuenta[];
  usuarioId?: string | null;
  modoInicial?: ModoMensajeCuenta;
  desde?: string | null;
  hasta?: string | null;
  empresaTexto?: string | null;
  onClose: () => void;
  copiar: (texto: string, msg?: string) => void | Promise<void>;
}) {
  const { colors } = useTheme();
  const [modo, setModo] = useState<ModoMensajeCuenta>(modoInicial ?? 'ficha');
  const [op, setOp] = useState<OpcionesMensajeCuenta>(OPCIONES_MENSAJE_DEFECTO);
  const [opTes, setOpTes] = useState<OpcionesListaTesoreria>(OPCIONES_TESORERIA_DEFECTO);
  const [verOpciones, setVerOpciones] = useState(false);
  const [generando, setGenerando] = useState(false);

  // Estado de decisiones por cuenta en el modo 'decision' (¿Se pagará?)
  const [decisiones, setDecisiones] = useState<Record<string, DecisionCuentaPago>>(() => {
    const ini: Record<string, DecisionCuentaPago> = {};
    datos.forEach((d, idx) => {
      const k = claveCuentaDecision(d, idx);
      const notaEsp = String(d.notaEspera ?? '').trim();
      ini[k] = {
        motivo: 'si',
        motivoOtro: notaEsp || '',
      };
    });
    return ini;
  });

  const clave = `cxp_mensaje_opciones:${usuarioId || 'anon'}`;
  const claveTes = `cxp_tesoreria_opciones:${usuarioId || 'anon'}`;

  useEffect(() => {
    if (modoInicial) setModo(modoInicial);
  }, [modoInicial]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [raw, rawTes] = await Promise.all([
          AsyncStorage.getItem(clave),
          AsyncStorage.getItem(claveTes),
        ]);
        if (vivo && raw) setOp(normalizarOpcionesMensaje(JSON.parse(raw)));
        if (vivo && rawTes) {
          const parsedTes = JSON.parse(rawTes);
          if (parsedTes && typeof parsedTes === 'object') {
            setOpTes((prev) => ({ ...prev, ...parsedTes }));
          }
        }
      } catch { /* sin opciones guardadas: las de fábrica */ }
    })();
    return () => { vivo = false; };
  }, [clave, claveTes]);

  const cambiar = (k: keyof OpcionesMensajeCuenta, v: boolean) => {
    const sig = { ...op, [k]: v };
    setOp(sig);
    try { AsyncStorage.setItem(clave, JSON.stringify(sig)).catch(() => {}); } catch { /* solo esta vez */ }
  };

  const cambiarTes = (k: keyof Omit<OpcionesListaTesoreria, 'desde' | 'hasta' | 'empresaTexto'>, v: boolean) => {
    const sig = { ...opTes, [k]: v };
    setOpTes(sig);
    try { AsyncStorage.setItem(claveTes, JSON.stringify(sig)).catch(() => {}); } catch { /* solo esta vez */ }
  };

  const cambiarMotivoCuenta = (k: string, motivo: MotivoDecisionPago) => {
    setDecisiones((prev) => ({
      ...prev,
      [k]: {
        motivo,
        motivoOtro: prev[k]?.motivoOtro ?? '',
      },
    }));
  };

  const cambiarTextoOtroCuenta = (k: string, motivoOtro: string) => {
    setDecisiones((prev) => ({
      ...prev,
      [k]: {
        motivo: 'otro',
        motivoOtro,
      },
    }));
  };

  const aplicarLoteDecision = (motivo: MotivoDecisionPago) => {
    setDecisiones((prev) => {
      const next: Record<string, DecisionCuentaPago> = {};
      datos.forEach((d, idx) => {
        const k = claveCuentaDecision(d, idx);
        next[k] = {
          motivo,
          motivoOtro: prev[k]?.motivoOtro || String(d.notaEspera ?? '').trim() || '',
        };
      });
      return next;
    });
  };

  const cargarNotasEsperaActivas = () => {
    setDecisiones((prev) => {
      const next: Record<string, DecisionCuentaPago> = {};
      datos.forEach((d, idx) => {
        const k = claveCuentaDecision(d, idx);
        const notaEsp = String(d.notaEspera ?? '').trim();
        if (notaEsp) {
          next[k] = { motivo: 'otro', motivoOtro: notaEsp };
        } else if (d.aprobacionEstado === 'esperando_aprobacion') {
          next[k] = { motivo: 'esperando_jefe', motivoOtro: prev[k]?.motivoOtro ?? '' };
        } else {
          next[k] = { motivo: 'si', motivoOtro: prev[k]?.motivoOtro ?? '' };
        }
      });
      return next;
    });
  };

  const hayNotasEspera = useMemo(
    () => datos.some((d) => Boolean(String(d.notaEspera ?? '').trim()) || d.aprobacionEstado === 'esperando_aprobacion'),
    [datos],
  );

  const faltaOtroMotivo = useMemo(() => {
    if (modo !== 'decision') return false;
    return datos.some((d, idx) => {
      const k = claveCuentaDecision(d, idx);
      const dec = decisiones[k];
      return dec?.motivo === 'otro' && !String(dec.motivoOtro ?? '').trim();
    });
  }, [modo, datos, decisiones]);

  const texto = useMemo(() => {
    if (modo === 'tesoreria') {
      return construirListaTesoreriaCuentas(datos, {
        ...opTes,
        desde,
        hasta,
        empresaTexto,
      });
    }
    if (modo === 'decision') {
      return construirResumenDecisionCuentas(datos, decisiones, {
        incluirDetalle: true,
        incluirPersonas: op.personas,
        incluirCondiciones: op.condiciones,
        incluirBs: op.bs,
        incluirEmpresa: op.empresa,
      });
    }
    return construirMensajeCuentas(datos, op);
  }, [modo, datos, op, opTes, decisiones, desde, hasta, empresaTexto]);

  const abrirWhatsapp = async () => {
    const url = urlWhatsappMensaje(texto);
    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(url, '_blank');
      else await Linking.openURL(url);
    } catch { /* sin WhatsApp: queda el botón de copiar */ }
  };

  const pdf = async () => {
    setGenerando(true);
    try {
      if (modo === 'tesoreria') {
        const nombre = `Reporte Tesoreria Por Pagar (${datos.length})`;
        await exportPdf(
          listaTesoreriaCuentasHtml(datos, { ...opTes, ...op, desde, hasta, empresaTexto }),
          nombre,
        );
      } else if (modo === 'decision') {
        const nombre = `Resumen Decision Pagos (${datos.length})`;
        await exportPdf(resumenDecisionCuentasHtml(datos, decisiones, op), nombre);
      } else {
        const nombre = datos.length === 1 ? `Pago ${datos[0].orden} - ${datos[0].proveedor}` : `Pagos pendientes (${datos.length})`;
        await exportPdf(mensajeCuentasHtml(datos, op), nombre);
      }
    } finally {
      setGenerando(false);
    }
  };

  const boton = (label: string, onPress: () => void, fondo: string, color: string, deshabilitado = false) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={generando || deshabilitado}
      style={{
        flexGrow: 1,
        flexBasis: 110,
        backgroundColor: fondo,
        borderRadius: radius.md,
        paddingVertical: spacing.sm,
        alignItems: 'center',
        opacity: generando || deshabilitado ? 0.5 : 1,
      }}
    >
      <Text style={{ color, fontWeight: '900', fontSize: 13 }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: spacing.md, zIndex: 9999 }}>
        <View style={{ width: '100%', maxWidth: 640, maxHeight: '94%', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, zIndex: 9999 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 16, flexShrink: 1 }}>
              📲 {datos.length > 1 ? `Mensajes y Reportes WS (${datos.length} cuentas)` : 'Mensaje / Reporte de Pago'}
            </Text>
            <TouchableOpacity onPress={onClose}><Text style={{ color: colors.muted, fontWeight: '900', fontSize: 18 }}>✕</Text></TouchableOpacity>
          </View>

          {/* ── Selector de Formato de Mensaje (3 Modos) ── */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.xs }}>
            {(
              [
                ['ficha', '🏦 Ficha de Pago (Completa)'],
                ['tesoreria', '🧾 Lista Tesorería (1 línea)'],
                ['decision', '⚖️ Resumen ¿Se pagará?'],
              ] as const
            ).map(([k, lbl]) => {
              const on = modo === k;
              return (
                <TouchableOpacity
                  key={k}
                  onPress={() => setModo(k)}
                  style={{
                    flexGrow: 1,
                    borderRadius: radius.pill,
                    borderWidth: 1,
                    borderColor: on ? colors.brand : colors.border,
                    backgroundColor: on ? colors.brand : colors.surfaceAlt,
                    paddingHorizontal: spacing.sm,
                    paddingVertical: 6,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 11.5 }}>
                    {lbl}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── Controles de Decisión por Cuenta cuando está en modo 'decision' ── */}
          {modo === 'decision' ? (
            <View
              style={{
                marginTop: spacing.xs,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.md,
                backgroundColor: colors.surfaceAlt,
                padding: spacing.xs,
                maxHeight: 210,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 11.5 }}>
                  🎯 Marcar decisión para todas:
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                  <TouchableOpacity
                    onPress={() => aplicarLoteDecision('si')}
                    style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.successSoftBg, borderWidth: 1, borderColor: colors.successSoftBorder }}
                  >
                    <Text style={{ color: colors.successSoftText, fontWeight: '800', fontSize: 10.5 }}>✓ Todas se pagan</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => aplicarLoteDecision('sin_fondos')}
                    style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.warningSoftBg, borderWidth: 1, borderColor: colors.warningSoftBorder }}
                  >
                    <Text style={{ color: colors.warningSoftText, fontWeight: '800', fontSize: 10.5 }}>⏸ Sin fondos</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => aplicarLoteDecision('esperando_jefe')}
                    style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.infoSoftBg, borderWidth: 1, borderColor: colors.infoSoftBorder }}
                  >
                    <Text style={{ color: colors.infoSoftText, fontWeight: '800', fontSize: 10.5 }}>⏳ Esperando al jefe</Text>
                  </TouchableOpacity>
                  {hayNotasEspera ? (
                    <TouchableOpacity
                      onPress={cargarNotasEsperaActivas}
                      style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.brand }}
                    >
                      <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 10.5 }}>📝 Usar notas de espera</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>

              <ScrollView nestedScrollEnabled style={{ maxHeight: 165 }}>
                {datos.map((d, idx) => {
                  const k = claveCuentaDecision(d, idx);
                  const dec = decisiones[k] ?? { motivo: 'si' as const };
                  const mUsd = d.saldoUsd != null ? Number(d.saldoUsd) || 0 : Number(d.totalUsd) || 0;
                  return (
                    <View
                      key={k}
                      style={{
                        borderTopWidth: idx === 0 ? 0 : 1,
                        borderTopColor: colors.border,
                        paddingVertical: 5,
                        gap: 4,
                      }}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 11.5, flex: 1 }} numberOfLines={1}>
                          {idx + 1}. {d.orden ? `${d.orden} · ` : ''}{d.proveedor}
                        </Text>
                        <Text style={{ color: colors.brandText, fontWeight: '900', fontSize: 11.5 }}>
                          ${montoEs(mUsd)}
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                        {MOTIVOS_DECISION.map((m) => {
                          const activo = dec.motivo === m;
                          return (
                            <TouchableOpacity
                              key={m}
                              onPress={() => cambiarMotivoCuenta(k, m)}
                              style={{
                                borderRadius: radius.pill,
                                borderWidth: 1,
                                borderColor: activo ? colors.brand : colors.border,
                                backgroundColor: activo ? colors.brand : colors.surface,
                                paddingHorizontal: 7,
                                paddingVertical: 2,
                              }}
                            >
                              <Text style={{ color: activo ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 10.5 }}>
                                {ETIQUETA_MOTIVO_DECISION[m]}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      {dec.motivo === 'otro' ? (
                        <TextInput
                          value={dec.motivoOtro ?? ''}
                          onChangeText={(t) => cambiarTextoOtroCuenta(k, t)}
                          placeholder="Escribe el motivo por el cual no se pagará (obligatorio)…"
                          placeholderTextColor={colors.muted}
                          style={{
                            backgroundColor: colors.surface,
                            borderWidth: 1,
                            borderColor: !String(dec.motivoOtro ?? '').trim() ? colors.danger : colors.border,
                            borderRadius: radius.sm,
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            color: colors.text,
                            fontSize: 11.5,
                          }}
                        />
                      ) : null}
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          <TouchableOpacity onPress={() => setVerOpciones((v) => !v)} style={{ marginTop: spacing.xs }}>
            <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>
              {verOpciones ? '▴ Ocultar opciones' : '⚙️ Opciones (qué sale en el mensaje y PDF)'}
            </Text>
          </TouchableOpacity>
          {verOpciones ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, marginTop: spacing.xs }}>
              {modo === 'tesoreria'
                ? ETIQUETAS_TESORERIA.map((e) => (
                    <View key={e.k} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexBasis: 230, flexGrow: 1, paddingVertical: 2 }}>
                      <Switch value={!!opTes[e.k]} onValueChange={(v) => cambiarTes(e.k, v)} />
                      <Text style={{ color: colors.text, fontSize: 12, flexShrink: 1 }}>{e.t}</Text>
                    </View>
                  ))
                : ETIQUETAS.map((e) => (
                    <View key={e.k} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexBasis: 230, flexGrow: 1, paddingVertical: 2 }}>
                      <Switch value={!!op[e.k]} onValueChange={(v) => cambiar(e.k, v)} />
                      <Text style={{ color: colors.text, fontSize: 12, flexShrink: 1 }}>{e.t}{e.soloPdf ? ' (PDF)' : ''}</Text>
                    </View>
                  ))}
            </View>
          ) : null}

          <ScrollView
            style={{ marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceAlt }}
            contentContainerStyle={{ padding: spacing.sm }}
          >
            <Text selectable style={{ color: colors.text, fontSize: 12.5, lineHeight: 18 }}>{texto}</Text>
          </ScrollView>

          {faltaOtroMotivo ? (
            <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700', marginTop: 4 }}>
              ⚠️ Escribe el motivo en las cuentas marcadas con «✏️ Otro motivo» antes de copiar o enviar.
            </Text>
          ) : null}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
            {boton('📋 Copiar', () => copiar(texto, '📋 Mensaje copiado al portapapeles.'), colors.surfaceAlt, colors.text, faltaOtroMotivo)}
            {boton('🟢 WhatsApp', abrirWhatsapp, '#16A34A', '#fff', faltaOtroMotivo)}
            {boton(generando ? 'Generando…' : '📄 PDF', pdf, colors.brand, colors.brandContrast, faltaOtroMotivo)}
          </View>
        </View>
      </View>
    </Modal>
  );
}
