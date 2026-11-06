import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  Image,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme';
import { useToast } from '../ToastProvider';
import {
  armarDatosMensajeDesdeDespacho,
  construirMensajeWhatsapp,
  copiarMensajeCombustible,
  compartirPorWhatsapp,
  copiarImagenDespachoPortapapeles,
  descargarImagenesDespacho,
  compartirImagenYMensajeCombustible,
} from '../../lib/fuelRules';

export interface DetalleDespachoModalProps {
  visible: boolean;
  despacho: any | null;
  machineryList?: any[] | null;
  vehiclesList?: any[] | null;
  tanksList?: any[] | null;
  registradoPor?: string | null;
  onClose: () => void;
}

const fmtNum = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString('es-VE', { maximumFractionDigits: 2 });

export default function DetalleDespachoModal({
  visible,
  despacho,
  machineryList,
  vehiclesList,
  tanksList,
  registradoPor,
  onClose,
}: DetalleDespachoModalProps) {
  const { colors } = useTheme();
  const toast = useToast();

  const [fotoActivaIdx, setFotoActivaIdx] = useState(0);
  const [fotoZoomUrl, setFotoZoomUrl] = useState<string | null>(null);
  const [copiadoMsg, setCopiadoMsg] = useState(false);
  const [copiadoImg, setCopiadoImg] = useState(false);
  const [procesandoImg, setProcesandoImg] = useState(false);

  useEffect(() => {
    if (visible) {
      setFotoActivaIdx(0);
      setFotoZoomUrl(null);
      setCopiadoMsg(false);
      setCopiadoImg(false);
    }
  }, [visible, despacho?.id]);

  const datosEfectivos = useMemo(() => {
    if (!despacho) return null;
    return armarDatosMensajeDesdeDespacho(despacho, {
      machineryList,
      vehiclesList,
      tanksList,
      registradoPor,
    });
  }, [despacho, machineryList, vehiclesList, tanksList, registradoPor]);

  const textoMensaje = useMemo(() => {
    if (!datosEfectivos) return '';
    return construirMensajeWhatsapp(datosEfectivos);
  }, [datosEfectivos]);

  if (!visible || !despacho || !datosEfectivos) return null;

  const esEntrada = datosEfectivos.tipo === 'entrada';
  const fotos = (datosEfectivos.fotos || []).filter(Boolean);
  const fotoSeleccionada = fotos[fotoActivaIdx] || fotos[0] || null;
  const placaMostrar = datosEfectivos.equipoPlaca || 'S/P';
  const serialMostrar = datosEfectivos.equipoSerial || 'S/S';

  const handleCopiarMensaje = async () => {
    const ok = await copiarMensajeCombustible(textoMensaje);
    if (ok) {
      setCopiadoMsg(true);
      toast.success('📋 Mensaje de combustible copiado al portapapeles.');
      setTimeout(() => setCopiadoMsg(false), 3000);
    } else {
      toast.info('Selecciona el texto del recuadro para copiarlo manualmente.');
    }
  };

  const handleCopiarImagen = async () => {
    if (!fotoSeleccionada || procesandoImg) return;
    setProcesandoImg(true);
    try {
      const res = await copiarImagenDespachoPortapapeles(fotoSeleccionada);
      if (res.ok) {
        setCopiadoImg(true);
        toast.success(res.msg);
        setTimeout(() => setCopiadoImg(false), 3500);
      } else {
        toast.info(res.msg);
      }
    } finally {
      setProcesandoImg(false);
    }
  };

  const handleDescargarFoto = async () => {
    if (fotos.length === 0) return;
    const prefijo = esEntrada
      ? `entrada-${String(datosEfectivos.tanqueNombre || 'tanque').replace(/[^a-zA-Z0-9_-]/g, '_')}`
      : `despacho-${String(datosEfectivos.equipoCodigo || 'maquinaria').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    await descargarImagenesDespacho(fotos, prefijo);
    toast.success(
      fotos.length > 1
        ? `⬇️ Descargando las ${fotos.length} imágenes…`
        : '⬇️ Descargando imagen del comprobante…'
    );
  };

  const handleEnviarImagenYMensaje = async () => {
    if (procesandoImg) return;
    setProcesandoImg(true);
    try {
      const res = await compartirImagenYMensajeCombustible(datosEfectivos, fotos);
      setCopiadoMsg(true);
      toast.success(res.msg);
      setTimeout(() => setCopiadoMsg(false), 3500);
    } finally {
      setProcesandoImg(false);
    }
  };

  const handleReenviarWhatsapp = async () => {
    await copiarMensajeCombustible(textoMensaje);
    await compartirPorWhatsapp(datosEfectivos);
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.65)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: spacing.md,
          zIndex: 9999,
        }}
      >
        <View
          style={{
            width: '100%',
            maxWidth: 680,
            maxHeight: '92%',
            backgroundColor: colors.surface,
            borderRadius: radius.lg,
            padding: spacing.lg,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
            {/* Encabezado */}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 4,
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: '900', color: colors.text, letterSpacing: 0.4 }}>
                {esEntrada ? 'DETALLE DE LA ENTRADA' : 'DETALLE DEL DESPACHO'}
              </Text>
              <TouchableOpacity
                onPress={onClose}
                style={{ paddingHorizontal: 8, paddingVertical: 4 }}
              >
                <Text style={{ fontSize: 16, fontWeight: '900', color: colors.muted }}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Tarjeta destacada de Maquinaria / Equipo o Entrada */}
            <View
              style={{
                backgroundColor: colors.surfaceAlt,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.md,
                padding: spacing.sm,
                gap: 6,
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '900', color: colors.text }}>
                {esEntrada
                  ? `📥 RECEPCIÓN EN ${datosEfectivos.tanqueNombre}`
                  : `🚜 ${datosEfectivos.equipoCodigo || 'Vehículo general'}`}
              </Text>
              {esEntrada ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {datosEfectivos.proveedor ? (
                    <View
                      style={{
                        backgroundColor: colors.surface,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: radius.sm,
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                      }}
                    >
                      <Text style={{ fontSize: 11.5, fontWeight: '900', color: colors.text }}>
                        🏭 PROVEEDOR: {datosEfectivos.proveedor}
                      </Text>
                    </View>
                  ) : null}
                  {datosEfectivos.factura ? (
                    <View
                      style={{
                        backgroundColor: colors.surface,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: radius.sm,
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                      }}
                    >
                      <Text style={{ fontSize: 11.5, fontWeight: '900', color: colors.text }}>
                        🧾 GUÍA / FACTURA: {datosEfectivos.factura}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  <View
                    style={{
                      backgroundColor: colors.dangerSoftBg,
                      borderWidth: 1,
                      borderColor: colors.danger,
                      borderRadius: radius.sm,
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                    }}
                  >
                    <Text style={{ fontSize: 11.5, fontWeight: '900', color: colors.danger }}>
                      🚗 PLACA: {placaMostrar}
                    </Text>
                  </View>
                  <View
                    style={{
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.sm,
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                    }}
                  >
                    <Text style={{ fontSize: 11.5, fontWeight: '900', color: colors.text }}>
                      🔢 SERIAL: {serialMostrar}
                    </Text>
                  </View>
                  <View
                    style={{
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.sm,
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                    }}
                  >
                    <Text style={{ fontSize: 11.5, fontWeight: '800', color: colors.muted }}>
                      ⛽ TANQUE: {datosEfectivos.tanqueNombre}
                    </Text>
                  </View>
                </View>
              )}
            </View>

            {/* Filas de detalle */}
            <View style={{ gap: 6, marginTop: 2 }}>
              {!esEntrada && (
                <>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                    <Text style={{ color: colors.muted, fontSize: 12.5 }}>MAQUINARIA / EQUIPO:</Text>
                    <Text style={{ fontWeight: '800', color: colors.text, fontSize: 12.5, flexShrink: 1, textAlign: 'right' }}>
                      {datosEfectivos.equipoCodigo || '—'}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                    <Text style={{ color: colors.muted, fontSize: 12.5 }}>PLACA / SERIAL:</Text>
                    <Text style={{ fontWeight: '800', color: colors.text, fontSize: 12.5, flexShrink: 1, textAlign: 'right' }}>
                      Placa: {placaMostrar} · Serial: {serialMostrar}
                    </Text>
                  </View>
                </>
              )}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ color: colors.muted, fontSize: 12.5 }}>FECHA Y HORA:</Text>
                <Text style={{ fontWeight: '700', color: colors.text, fontSize: 12.5 }}>
                  {datosEfectivos.fecha || '—'} {datosEfectivos.hora || ''}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ color: colors.muted, fontSize: 12.5 }}>
                  {esEntrada ? 'LITROS RECIBIDOS:' : 'LITROS SURTIDOS:'}
                </Text>
                <Text style={{ fontWeight: '900', color: colors.primary, fontSize: 16 }}>
                  {fmtNum(datosEfectivos.litros)} L
                </Text>
              </View>
              {!esEntrada && (
                <>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                    <Text style={{ color: colors.muted, fontSize: 12.5 }}>CONTADOR BOMBA:</Text>
                    <Text style={{ fontWeight: '700', color: colors.text, fontSize: 12.5 }}>
                      {datosEfectivos.contadorIni ?? '—'} ➔ {datosEfectivos.contadorFin ?? '—'}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                    <Text style={{ color: colors.muted, fontSize: 12.5 }}>HORÓMETRO:</Text>
                    <Text style={{ fontWeight: '700', color: colors.text, fontSize: 12.5 }}>
                      {datosEfectivos.horometroFin ?? '—'} h
                    </Text>
                  </View>
                </>
              )}
              {datosEfectivos.kilometraje != null ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={{ color: colors.muted, fontSize: 12.5 }}>ODÓMETRO:</Text>
                  <Text style={{ fontWeight: '700', color: colors.text, fontSize: 12.5 }}>
                    {fmtNum(datosEfectivos.kilometraje)} km
                  </Text>
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ color: colors.muted, fontSize: 12.5 }}>
                  {esEntrada ? 'RECIBIDO POR:' : 'AUTORIZADO / OPERADOR:'}
                </Text>
                <Text style={{ fontWeight: '700', color: colors.text, fontSize: 12.5 }}>
                  {datosEfectivos.autorizadoPor || '—'}
                </Text>
              </View>
              {datosEfectivos.nota ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={{ color: colors.muted, fontSize: 12.5 }}>NOTA:</Text>
                  <Text style={{ fontWeight: '700', color: colors.text, fontSize: 12.5, flexShrink: 1, textAlign: 'right' }}>
                    {datosEfectivos.nota}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Fotos adjuntas + acciones para mandar/copiar/descargar todas las imágenes subidas */}
            {fotos.length > 0 && (
              <View
                style={{
                  marginTop: spacing.xs,
                  backgroundColor: colors.surfaceAlt,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: colors.border,
                  padding: spacing.sm,
                  gap: spacing.xs,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                  <Text style={{ fontSize: 12, fontWeight: '900', color: colors.text }}>
                    📷 FOTOS SUBIDAS ({fotos.length})
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>
                    {fotos.length > 1
                      ? `Se enviarán las ${fotos.length} imágenes juntas sin links en el mensaje`
                      : 'Toca la foto para ampliarla o enviarla junto al mensaje'}
                  </Text>
                </View>

                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
                  {fotos.map((url, i) => {
                    const sel = i === fotoActivaIdx;
                    return (
                      <TouchableOpacity
                        key={`${url}-${i}`}
                        onPress={() => {
                          setFotoActivaIdx(i);
                          setFotoZoomUrl(url);
                        }}
                        style={{
                          borderRadius: radius.sm,
                          borderWidth: sel ? 2.5 : 1,
                          borderColor: sel ? colors.primary : colors.border,
                          overflow: 'hidden',
                          position: 'relative',
                        }}
                      >
                        <Image source={{ uri: url }} style={{ width: 96, height: 96 }} resizeMode="cover" />
                        {fotos.length > 1 && (
                          <View
                            style={{
                              position: 'absolute',
                              bottom: 4,
                              right: 4,
                              backgroundColor: 'rgba(0,0,0,0.72)',
                              paddingHorizontal: 5,
                              paddingVertical: 1,
                              borderRadius: 4,
                            }}
                          >
                            <Text style={{ color: '#fff', fontSize: 10, fontWeight: '900' }}>
                              #{i + 1}
                            </Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                {/* Botones para mandar o copiar las imágenes subidas */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  <TouchableOpacity
                    onPress={handleEnviarImagenYMensaje}
                    disabled={procesandoImg}
                    style={{
                      flexGrow: 1,
                      flexBasis: 170,
                      backgroundColor: colors.primary,
                      borderRadius: radius.sm,
                      paddingVertical: 8,
                      paddingHorizontal: 10,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    {procesandoImg ? (
                      <ActivityIndicator size="small" color={colors.primaryContrast} />
                    ) : (
                      <Text style={{ fontSize: 13 }}>📤</Text>
                    )}
                    <Text style={{ fontSize: 12, fontWeight: '900', color: colors.primaryContrast }}>
                      {fotos.length > 1
                        ? `MANDAR LAS ${fotos.length} IMÁGENES + MENSAJE`
                        : 'MANDAR IMAGEN + MENSAJE'}
                    </Text>
                  </TouchableOpacity>

                  {Platform.OS === 'web' && (
                    <TouchableOpacity
                      onPress={handleCopiarImagen}
                      disabled={procesandoImg}
                      style={{
                        flexGrow: 1,
                        flexBasis: 130,
                        backgroundColor: copiadoImg ? '#16A34A' : colors.surface,
                        borderWidth: 1,
                        borderColor: copiadoImg ? '#16A34A' : colors.border,
                        borderRadius: radius.sm,
                        paddingVertical: 8,
                        paddingHorizontal: 10,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 5,
                      }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: '800', color: copiadoImg ? '#fff' : colors.text }}>
                        {copiadoImg
                          ? '✅ IMAGEN COPIADA'
                          : fotos.length > 1
                          ? `🖼️ COPIAR IMAGEN #${fotoActivaIdx + 1}`
                          : '🖼️ COPIAR IMAGEN'}
                      </Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    onPress={handleDescargarFoto}
                    style={{
                      flexGrow: 1,
                      flexBasis: 120,
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.sm,
                      paddingVertical: 8,
                      paddingHorizontal: 10,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 5,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '800', color: colors.text }}>
                      {fotos.length > 1 ? `⬇️ DESCARGAR FOTO (${fotos.length})` : '⬇️ DESCARGAR FOTO'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Cuadro del Mensaje de Combustible (seleccionable y copiable) */}
            <View
              style={{
                marginTop: spacing.xs,
                backgroundColor: colors.surfaceAlt,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.border,
                padding: spacing.sm,
                gap: 6,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <Text style={{ fontSize: 12, fontWeight: '900', color: colors.text }}>
                  📋 MENSAJE DE COMBUSTIBLE (COPIAR Y PEGAR)
                </Text>
              </View>

              <TextInput
                value={textoMensaje}
                editable={false}
                multiline
                selectTextOnFocus
                style={{
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: radius.sm,
                  padding: spacing.sm,
                  fontSize: 12,
                  color: colors.text,
                  minHeight: 145,
                  textAlignVertical: 'top',
                  fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
                }}
              />
            </View>

            {/* Botones principales: Copiar Mensaje y Reenviar por WhatsApp */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 4 }}>
              <TouchableOpacity
                onPress={handleCopiarMensaje}
                style={{
                  flex: 1,
                  minWidth: 180,
                  backgroundColor: copiadoMsg ? '#16A34A' : colors.primary,
                  borderRadius: radius.md,
                  paddingVertical: spacing.sm + 2,
                  paddingHorizontal: spacing.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  gap: 6,
                }}
              >
                <Text style={{ fontSize: 15 }}>{copiadoMsg ? '✅' : '📋'}</Text>
                <Text style={{ fontWeight: '900', color: '#fff', fontSize: 13.5 }}>
                  {copiadoMsg ? '¡MENSAJE COPIADO!' : 'COPIAR MENSAJE'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleReenviarWhatsapp}
                style={{
                  flex: 1,
                  minWidth: 180,
                  backgroundColor: '#25D366',
                  borderRadius: radius.md,
                  paddingVertical: spacing.sm + 2,
                  paddingHorizontal: spacing.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  gap: 6,
                }}
              >
                <Text style={{ fontSize: 16 }}>💬</Text>
                <Text style={{ fontWeight: '900', color: '#fff', fontSize: 13.5 }}>
                  REENVIAR POR WHATSAPP
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>

        {/* Visor de foto ampliada dentro del modal */}
        {fotoZoomUrl ? (
          <Modal visible transparent animationType="fade" onRequestClose={() => setFotoZoomUrl(null)}>
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => setFotoZoomUrl(null)}
              style={{
                flex: 1,
                backgroundColor: 'rgba(0,0,0,0.9)',
                justifyContent: 'center',
                alignItems: 'center',
                padding: spacing.md,
                zIndex: 10000,
              }}
            >
              <Image
                source={{ uri: fotoZoomUrl }}
                style={{ width: '92%', height: '80%' }}
                resizeMode="contain"
              />
              <Text style={{ color: '#fff', fontWeight: '800', marginTop: spacing.sm }}>
                Toca para cerrar vista ampliada ✕
              </Text>
            </TouchableOpacity>
          </Modal>
        ) : null}
      </View>
    </Modal>
  );
}

