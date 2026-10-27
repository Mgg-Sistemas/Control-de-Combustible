// ── Componente de Cotizaciones Múltiples y Multi-Moneda ────────────────────────
// Permite registrar 1 o más cotizaciones en cualquier moneda (USD, VES, EUR, COP, etc.),
// compararlas con cálculo homogéneo en USD y seleccionar la oferta ganadora.
// Optimizado para móvil (pantallas estrechas) y desktop (PC).

import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Modal,
  ScrollView,
  Platform,
  Image,
  Linking,
} from 'react-native';
import { Supplier } from '../types/database';
import {
  CotizacionAlternativa,
  MonedaCotizacion,
  MONEDAS_COMUNES,
  calcularEquivalenteUsd,
  formatearMoneda,
  simboloMoneda,
} from '../lib/cotizaciones';
import { pickAndUploadRequirementFile, captureAndUploadPhoto } from '../lib/photo';
import { onlyDecimal, norm } from '../lib/text';
import { useToast } from './ToastProvider';
import { useConfirm } from './ConfirmProvider';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

interface CotizacionesModalProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  requirementCode?: string | null;
  cotizaciones: CotizacionAlternativa[];
  suppliers: Supplier[];
  rateBcv?: number;
  canEdit?: boolean;
  onSaveCotizaciones: (cotizaciones: CotizacionAlternativa[], cotizacionGanadora?: CotizacionAlternativa | null) => Promise<void>;
}

export function CotizacionesModal({
  visible,
  onClose,
  title = 'Cotizaciones de Compra',
  requirementCode,
  cotizaciones,
  suppliers,
  rateBcv = 0,
  canEdit = true,
  onSaveCotizaciones,
}: CotizacionesModalProps) {
  const { colors, scheme } = useTheme();
  const isDark = scheme === 'dark';
  const toast = useToast();
  const confirm = useConfirm();

  const [lista, setLista] = useState<CotizacionAlternativa[]>(cotizaciones || []);
  const [formOpen, setFormOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  // Campos del formulario
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [supplierName, setSupplierName] = useState('');
  const [supSearchQ, setSupSearchQ] = useState('');
  const [supPickerOpen, setSupPickerOpen] = useState(false);

  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState<MonedaCotizacion>('USD');
  const [customCurrency, setCustomCurrency] = useState('');
  const [exchangeRate, setExchangeRate] = useState('');
  const [deliveryDays, setDeliveryDays] = useState('Inmediata');
  const [paymentTerms, setPaymentTerms] = useState('Contado');
  const [notes, setNotes] = useState('');
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Visor de archivo adjunto
  const [previewFile, setPreviewFile] = useState<{ url: string; name?: string } | null>(null);

  // Sincronizar lista al abrir
  React.useEffect(() => {
    setLista(cotizaciones || []);
  }, [cotizaciones, visible]);

  const monedaActiva = currency === '__OTRA__' ? customCurrency.trim().toUpperCase() || 'OTRA' : currency;

  // Equivalente en USD calculado en vivo para el formulario
  const livePriceNum = Number(onlyDecimal(price)) || 0;
  const liveRateNum = Number(onlyDecimal(exchangeRate)) || 0;
  const liveUsdEquiv = useMemo(() => {
    return calcularEquivalenteUsd(livePriceNum, monedaActiva, rateBcv, liveRateNum);
  }, [livePriceNum, monedaActiva, rateBcv, liveRateNum]);

  const resetForm = () => {
    setFormOpen(false);
    setEditingIndex(null);
    setSupplierId(null);
    setSupplierName('');
    setSupSearchQ('');
    setSupPickerOpen(false);
    setPrice('');
    setCurrency('USD');
    setCustomCurrency('');
    setExchangeRate('');
    setDeliveryDays('Inmediata');
    setPaymentTerms('Contado');
    setNotes('');
    setFileUrl(null);
    setFileName(null);
  };

  const abrirNuevo = () => {
    resetForm();
    setFormOpen(true);
  };

  const abrirEditar = (item: CotizacionAlternativa, idx: number) => {
    setEditingIndex(idx);
    setSupplierId(item.supplier_id || null);
    setSupplierName(item.supplier_name || '');
    setPrice(String(item.price || ''));
    const isComun = MONEDAS_COMUNES.some((m) => m.codigo === item.currency);
    if (isComun) {
      setCurrency(item.currency);
      setCustomCurrency('');
    } else {
      setCurrency('__OTRA__');
      setCustomCurrency(item.currency);
    }
    setExchangeRate(item.exchange_rate ? String(item.exchange_rate) : '');
    setDeliveryDays(item.delivery_days || 'Inmediata');
    setPaymentTerms(item.payment_terms || 'Contado');
    setNotes(item.notes || '');
    setFileUrl(item.file_url || null);
    setFileName(item.file_name || null);
    setFormOpen(true);
  };

  const adjuntarSoporte = async (tipo: 'camara' | 'archivo') => {
    setUploading(true);
    try {
      if (tipo === 'camara') {
        const res = await captureAndUploadPhoto('cotizaciones');
        if (res.ok && res.url) {
          setFileUrl(res.url);
          setFileName('Foto_Presupuesto.jpg');
          toast.success('Foto de cotización capturada.');
        } else if (res.error) {
          toast.error(res.error);
        }
      } else {
        const res = await pickAndUploadRequirementFile('cotizaciones');
        if (res.ok && res.url) {
          setFileUrl(res.url);
          setFileName(res.name || 'Cotizacion');
          toast.success('Archivo de cotización cargado.');
        } else if (res.error) {
          toast.error(res.error);
        }
      }
    } finally {
      setUploading(false);
    }
  };

  const guardarCotizacionForm = async () => {
    const provNombre = supplierName.trim() || (supplierId ? suppliers.find((s) => s.id === supplierId)?.name : '') || '';
    if (!provNombre) return toast.error('Indica o selecciona el proveedor que cotizó.');
    if (livePriceNum <= 0) return toast.error('Ingresa un precio cotizado mayor a cero.');

    const rateNum = currency === 'VES' ? (rateBcv || liveRateNum) : liveRateNum;

    const nuevaCot: CotizacionAlternativa = {
      id: editingIndex !== null ? lista[editingIndex].id : ((globalThis as any)?.crypto?.randomUUID?.() || String(Date.now())),
      supplier_id: supplierId,
      supplier_name: provNombre,
      price: livePriceNum,
      currency: monedaActiva,
      exchange_rate: rateNum > 0 ? rateNum : undefined,
      price_usd_equiv: liveUsdEquiv > 0 ? liveUsdEquiv : livePriceNum,
      delivery_days: deliveryDays.trim() || null,
      payment_terms: paymentTerms.trim() || null,
      file_url: fileUrl,
      file_name: fileName,
      is_selected: editingIndex !== null ? !!lista[editingIndex].is_selected : lista.length === 0, // si es la primera, queda seleccionada
      notes: notes.trim() || null,
      created_at: editingIndex !== null ? lista[editingIndex].created_at : new Date().toISOString(),
    };

    let nuevaLista = [...lista];
    if (editingIndex !== null) {
      nuevaLista[editingIndex] = nuevaCot;
    } else {
      nuevaLista.push(nuevaCot);
    }

    setSaving(true);
    try {
      const ganadora = nuevaLista.find((c) => c.is_selected) || nuevaLista[0] || null;
      await onSaveCotizaciones(nuevaLista, ganadora);
      setLista(nuevaLista);
      resetForm();
      toast.success(editingIndex !== null ? 'Cotización actualizada.' : 'Cotización agregada exitosamente.');
    } catch (err: any) {
      toast.error(err?.message || 'No se pudo guardar la cotización.');
    } finally {
      setSaving(false);
    }
  };

  const marcarGanadora = async (item: CotizacionAlternativa) => {
    const ok = await confirm({
      title: 'Elegir Cotización Ganadora',
      message: `¿Deseas seleccionar la oferta de "${item.supplier_name}" por ${formatearMoneda(item.price, item.currency)} (≈ $${item.price_usd_equiv.toFixed(2)} USD) como la ganadora para este requerimiento?`,
      confirmText: 'Sí, seleccionar',
      cancelText: 'Cancelar',
    });
    if (!ok) return;

    const nuevaLista = lista.map((c) => ({
      ...c,
      is_selected: c.id === item.id,
    }));

    setSaving(true);
    try {
      await onSaveCotizaciones(nuevaLista, item);
      setLista(nuevaLista);
      toast.success(`Oferta de "${item.supplier_name}" seleccionada como ganadora.`);
    } catch (err: any) {
      toast.error(err?.message || 'No se pudo actualizar la cotización seleccionada.');
    } finally {
      setSaving(false);
    }
  };

  const eliminarCotizacion = async (item: CotizacionAlternativa) => {
    const ok = await confirm({
      title: 'Eliminar Cotización',
      message: `¿Eliminar la cotización de "${item.supplier_name}"?`,
      confirmText: 'Sí, eliminar',
      cancelText: 'Cancelar',
      danger: true,
    });
    if (!ok) return;

    let nuevaLista = lista.filter((c) => c.id !== item.id);
    // Si la eliminada era la ganadora y quedan otras, marcar la primera
    if (item.is_selected && nuevaLista.length > 0) {
      nuevaLista[0] = { ...nuevaLista[0], is_selected: true };
    }

    setSaving(true);
    try {
      const ganadora = nuevaLista.find((c) => c.is_selected) || null;
      await onSaveCotizaciones(nuevaLista, ganadora);
      setLista(nuevaLista);
      toast.success('Cotización eliminada.');
    } catch (err: any) {
      toast.error(err?.message || 'No se pudo eliminar la cotización.');
    } finally {
      setSaving(false);
    }
  };

  const abrirArchivo = (url: string) => {
    if (Platform.OS === 'web') {
      window.open(url, '_blank');
    } else {
      Linking.openURL(url);
    }
  };

  const inp = {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: 13,
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.65)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: spacing.sm,
        }}
      >
        <View
          style={{
            backgroundColor: colors.background,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: colors.border,
            width: '100%',
            maxWidth: 680,
            maxHeight: '92%',
            overflow: 'hidden',
            shadowColor: '#000',
            shadowOpacity: 0.25,
            shadowRadius: 12,
            elevation: 10,
          }}
        >
          {/* Cabecera */}
          <View
            style={{
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm + 2,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              backgroundColor: colors.surface,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={{ fontSize: 16, fontWeight: '900', color: colors.text }} numberOfLines={1}>
                📋 {title}
              </Text>
              <Text style={{ fontSize: 11, color: colors.muted }}>
                {requirementCode ? `Requerimiento ${requirementCode} · ` : ''}
                {lista.length} {lista.length === 1 ? 'oferta registrada' : 'ofertas comparadas'}
                {rateBcv ? ` · BCV: Bs. ${rateBcv.toFixed(2)}` : ''}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: colors.surfaceAlt,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={{ padding: spacing.md }} showsVerticalScrollIndicator={false}>
            {/* Banner Informativo Multi-moneda */}
            <View
              style={{
                backgroundColor: colors.surfaceAlt,
                borderRadius: radius.md,
                padding: spacing.sm,
                borderWidth: 1,
                borderColor: colors.border,
                marginBottom: spacing.md,
              }}
            >
              <Text style={{ fontSize: 11.5, color: colors.text, lineHeight: 16 }}>
                💡 <Text style={{ fontWeight: '800' }}>Comparador Multi-Moneda:</Text> Puedes cotizar en{' '}
                <Text style={{ fontWeight: '700' }}>USD ($), Bolívares (Bs.), Euros (€), Pesos (COP)</Text> o cualquier otra divisa. El sistema calcula automáticamente el valor normalizado en USD para que compares las ofertas de manera justa.
              </Text>
            </View>

            {/* Lista de Cotizaciones Registradas */}
            <View style={{ marginBottom: spacing.md }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
                <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text }}>
                  Ofertas Recibidas ({lista.length})
                </Text>
                {canEdit && !formOpen ? (
                  <TouchableOpacity
                    onPress={abrirNuevo}
                    style={{
                      backgroundColor: colors.brand,
                      borderRadius: radius.md,
                      paddingHorizontal: spacing.sm + 4,
                      paddingVertical: 6,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>
                      ＋ Nueva Oferta
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {lista.length === 0 ? (
                <View
                  style={{
                    padding: spacing.lg,
                    backgroundColor: colors.surface,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: colors.border,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ fontSize: 26, marginBottom: 6 }}>🏷️</Text>
                  <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text, marginBottom: 2 }}>
                    Sin cotizaciones registradas
                  </Text>
                  <Text style={{ fontSize: 11.5, color: colors.muted, textAlign: 'center', marginBottom: spacing.md }}>
                    Agrega la primera cotización para registrar proveedor, precio y moneda.
                  </Text>
                  {canEdit && !formOpen ? (
                    <TouchableOpacity
                      onPress={abrirNuevo}
                      style={{
                        backgroundColor: colors.brand,
                        borderRadius: radius.md,
                        paddingHorizontal: spacing.md,
                        paddingVertical: spacing.sm,
                      }}
                    >
                      <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>
                        ＋ Cargar Primera Cotización
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : (
                lista.map((c, idx) => {
                  const isSelected = !!c.is_selected;
                  return (
                    <View
                      key={c.id || idx}
                      style={{
                        backgroundColor: isSelected ? (isDark ? '#143026' : '#F0FDF4') : colors.surface,
                        borderWidth: isSelected ? 2 : 1,
                        borderColor: isSelected ? '#16A34A' : colors.border,
                        borderRadius: radius.md,
                        padding: spacing.sm + 2,
                        marginBottom: spacing.sm,
                      }}
                    >
                      {/* Fila superior: Proveedor y Badge de Ganadora */}
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6, marginBottom: 4 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 14, fontWeight: '900', color: colors.text }} numberOfLines={1}>
                            🏭 {c.supplier_name}
                          </Text>
                          <Text style={{ fontSize: 11, color: colors.muted }}>
                            Opción {idx + 1} · {c.delivery_days ? `Entrega: ${c.delivery_days}` : 'Entrega no indicada'}
                            {c.payment_terms ? ` · Pago: ${c.payment_terms}` : ''}
                          </Text>
                        </View>
                        {isSelected ? (
                          <View
                            style={{
                              backgroundColor: '#16A34A',
                              paddingHorizontal: 8,
                              paddingVertical: 3,
                              borderRadius: radius.pill,
                            }}
                          >
                            <Text style={{ color: '#fff', fontSize: 10.5, fontWeight: '900' }}>
                              ⭐ SELECCIONADA
                            </Text>
                          </View>
                        ) : null}
                      </View>

                      {/* Montos: Monto en moneda original + Equivalente USD */}
                      <View
                        style={{
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          alignItems: 'baseline',
                          backgroundColor: colors.surfaceAlt,
                          paddingHorizontal: spacing.sm,
                          paddingVertical: 6,
                          borderRadius: radius.sm,
                          marginVertical: 4,
                        }}
                      >
                        <View>
                          <Text style={{ fontSize: 10, color: colors.muted, fontWeight: '700' }}>
                            MONTO COTIZADO
                          </Text>
                          <Text style={{ fontSize: 16, fontWeight: '900', color: colors.text }}>
                            {formatearMoneda(c.price, c.currency)}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={{ fontSize: 10, color: colors.muted, fontWeight: '700' }}>
                            EQUIVALENTE BASE
                          </Text>
                          <Text style={{ fontSize: 14, fontWeight: '900', color: colors.brandText }}>
                            ≈ ${c.price_usd_equiv.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                          </Text>
                          {c.currency !== 'USD' && c.exchange_rate ? (
                            <Text style={{ fontSize: 9.5, color: colors.muted }}>
                              (Tasa: {c.exchange_rate})
                            </Text>
                          ) : null}
                        </View>
                      </View>

                      {/* Notas u observaciones */}
                      {c.notes ? (
                        <Text style={{ fontSize: 11, color: colors.muted, marginVertical: 3, fontStyle: 'italic' }}>
                          💬 {c.notes}
                        </Text>
                      ) : null}

                      {/* Botones de acción de la cotización */}
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, gap: 6, flexWrap: 'wrap' }}>
                        <View style={{ flexDirection: 'row', gap: 6 }}>
                          {c.file_url ? (
                            <TouchableOpacity
                              onPress={() => abrirArchivo(c.file_url!)}
                              style={{
                                backgroundColor: colors.surfaceAlt,
                                borderWidth: 1,
                                borderColor: colors.border,
                                borderRadius: radius.sm,
                                paddingHorizontal: 8,
                                paddingVertical: 4,
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              <Text style={{ fontSize: 11, color: colors.brandText, fontWeight: '700' }}>
                                📎 Ver Soporte
                              </Text>
                            </TouchableOpacity>
                          ) : null}
                          {canEdit ? (
                            <TouchableOpacity
                              onPress={() => abrirEditar(c, idx)}
                              style={{
                                backgroundColor: colors.surfaceAlt,
                                borderWidth: 1,
                                borderColor: colors.border,
                                borderRadius: radius.sm,
                                paddingHorizontal: 8,
                                paddingVertical: 4,
                              }}
                            >
                              <Text style={{ fontSize: 11, color: colors.text, fontWeight: '700' }}>
                                ✏️ Editar
                              </Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>

                        <View style={{ flexDirection: 'row', gap: 6 }}>
                          {canEdit && !isSelected ? (
                            <TouchableOpacity
                              onPress={() => marcarGanadora(c)}
                              disabled={saving}
                              style={{
                                backgroundColor: '#16A34A',
                                borderRadius: radius.sm,
                                paddingHorizontal: 10,
                                paddingVertical: 4,
                              }}
                            >
                              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>
                                ✅ Elegir esta
                              </Text>
                            </TouchableOpacity>
                          ) : null}
                          {canEdit ? (
                            <TouchableOpacity
                              onPress={() => eliminarCotizacion(c)}
                              disabled={saving}
                              style={{
                                backgroundColor: 'transparent',
                                paddingHorizontal: 6,
                                paddingVertical: 4,
                              }}
                            >
                              <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700' }}>
                                🗑️
                              </Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      </View>
                    </View>
                  );
                })
              )}
            </View>

            {/* Formulario para Crear / Editar Cotización */}
            {formOpen ? (
              <View
                style={{
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.brand,
                  borderRadius: radius.md,
                  padding: spacing.md,
                  marginBottom: spacing.lg,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
                  <Text style={{ fontSize: 13.5, fontWeight: '900', color: colors.text }}>
                    {editingIndex !== null ? '✏️ Modificar Cotización' : '＋ Registrar Nueva Cotización'}
                  </Text>
                  <TouchableOpacity onPress={resetForm}>
                    <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700' }}>Cancelar</Text>
                  </TouchableOpacity>
                </View>

                {/* Proveedor */}
                <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>
                  Proveedor (seleccionar de la lista o escribir nuevo):
                </Text>
                <TouchableOpacity
                  onPress={() => setSupPickerOpen((v) => !v)}
                  style={[
                    inp,
                    {
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: spacing.xs,
                    },
                  ]}
                >
                  <Text style={{ color: supplierName || supplierId ? colors.text : colors.muted, fontSize: 12.5, fontWeight: '700' }} numberOfLines={1}>
                    {supplierName || (supplierId ? suppliers.find((s) => s.id === supplierId)?.name : '🔍 Seleccionar proveedor…')}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>{supPickerOpen ? '▲' : '▼'}</Text>
                </TouchableOpacity>

                {supPickerOpen ? (
                  <View
                    style={{
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radius.md,
                      backgroundColor: colors.surfaceAlt,
                      padding: 6,
                      marginBottom: spacing.sm,
                      maxHeight: 180,
                    }}
                  >
                    <TextInput
                      value={supSearchQ}
                      onChangeText={setSupSearchQ}
                      placeholder="Buscar por nombre o RIF…"
                      placeholderTextColor={colors.muted}
                      style={[inp, { fontSize: 11.5, marginBottom: 4 }]}
                    />
                    <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                      {suppliers
                        .filter((s) => !supSearchQ.trim() || norm(s.name).includes(norm(supSearchQ)) || (s.rif && norm(s.rif).includes(norm(supSearchQ))))
                        .slice(0, 15)
                        .map((s) => (
                          <TouchableOpacity
                            key={s.id}
                            onPress={() => {
                              setSupplierId(s.id);
                              setSupplierName(s.name);
                              setSupPickerOpen(false);
                            }}
                            style={{
                              paddingVertical: 6,
                              paddingHorizontal: 8,
                              borderBottomWidth: 1,
                              borderBottomColor: colors.border,
                            }}
                          >
                            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>{s.name}</Text>
                            {s.rif ? <Text style={{ fontSize: 10, color: colors.muted }}>{s.rif}</Text> : null}
                          </TouchableOpacity>
                        ))}
                    </ScrollView>
                  </View>
                ) : null}

                {/* Si no está en el catálogo, permite escribirlo directamente */}
                <TextInput
                  value={supplierName}
                  onChangeText={(t) => {
                    setSupplierName(t);
                    setSupplierId(null);
                  }}
                  placeholder="O escribe el nombre del proveedor directamente…"
                  placeholderTextColor={colors.muted}
                  style={[inp, { fontSize: 12, marginBottom: spacing.sm }]}
                />

                {/* Monto y Moneda */}
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
                  <View style={{ flex: 1.2 }}>
                    <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>Precio Cotizado:</Text>
                    <TextInput
                      value={price}
                      onChangeText={(t) => setPrice(onlyDecimal(t))}
                      keyboardType="numeric"
                      placeholder="0.00"
                      placeholderTextColor={colors.muted}
                      style={[inp, { fontWeight: '800', fontSize: 15 }]}
                    />
                  </View>

                  <View style={{ flex: 1.8 }}>
                    <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>Moneda:</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
                      {MONEDAS_COMUNES.map((m) => {
                        const sel = currency === m.codigo;
                        return (
                          <TouchableOpacity
                            key={m.codigo}
                            onPress={() => {
                              setCurrency(m.codigo);
                              if (m.codigo === 'VES' && rateBcv > 0) {
                                setExchangeRate(String(rateBcv));
                              }
                            }}
                            style={{
                              paddingHorizontal: 8,
                              paddingVertical: 7,
                              borderRadius: radius.md,
                              backgroundColor: sel ? colors.brand : colors.surfaceAlt,
                              borderWidth: 1,
                              borderColor: sel ? colors.brand : colors.border,
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 2,
                            }}
                          >
                            <Text style={{ fontSize: 11 }}>{m.bandera}</Text>
                            <Text style={{ fontSize: 11, fontWeight: '800', color: sel ? colors.brandContrast : colors.text }}>
                              {m.codigo}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                      <TouchableOpacity
                        onPress={() => setCurrency('__OTRA__')}
                        style={{
                          paddingHorizontal: 8,
                          paddingVertical: 7,
                          borderRadius: radius.md,
                          backgroundColor: currency === '__OTRA__' ? colors.brand : colors.surfaceAlt,
                          borderWidth: 1,
                          borderColor: currency === '__OTRA__' ? colors.brand : colors.border,
                        }}
                      >
                        <Text style={{ fontSize: 11, fontWeight: '800', color: currency === '__OTRA__' ? colors.brandContrast : colors.text }}>
                          🌐 Otra
                        </Text>
                      </TouchableOpacity>
                    </ScrollView>
                  </View>
                </View>

                {/* Si eligió OTRA moneda */}
                {currency === '__OTRA__' ? (
                  <View style={{ marginBottom: spacing.sm }}>
                    <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>
                      Nombre o Código de la Moneda (ej. BRL, GBP, USDT):
                    </Text>
                    <TextInput
                      value={customCurrency}
                      onChangeText={(t) => setCustomCurrency(t.toUpperCase())}
                      placeholder="Ej. BRL"
                      placeholderTextColor={colors.muted}
                      style={inp}
                    />
                  </View>
                ) : null}

                {/* Tasa de cambio respecto a USD (si no es USD) */}
                {monedaActiva !== 'USD' ? (
                  <View
                    style={{
                      backgroundColor: colors.surfaceAlt,
                      borderRadius: radius.sm,
                      padding: spacing.sm,
                      marginBottom: spacing.sm,
                      borderWidth: 1,
                      borderColor: colors.border,
                    }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ fontSize: 11, color: colors.text, fontWeight: '700' }}>
                        Tasa de Conversión a USD:
                      </Text>
                      {monedaActiva === 'VES' && rateBcv ? (
                        <TouchableOpacity onPress={() => setExchangeRate(String(rateBcv))}>
                          <Text style={{ fontSize: 10, color: colors.brandText, fontWeight: '700' }}>
                            Usar BCV ({rateBcv.toFixed(2)})
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 }}>
                      <TextInput
                        value={exchangeRate}
                        onChangeText={(t) => setExchangeRate(onlyDecimal(t))}
                        keyboardType="numeric"
                        placeholder={monedaActiva === 'VES' ? String(rateBcv || 'Tasa Bs/$') : 'Tasa a USD'}
                        placeholderTextColor={colors.muted}
                        style={[inp, { flex: 1, height: 36, paddingVertical: 4 }]}
                      />
                      <Text style={{ fontSize: 12, fontWeight: '900', color: colors.brandText }}>
                        ≈ ${liveUsdEquiv.toFixed(2)} USD
                      </Text>
                    </View>
                  </View>
                ) : null}

                {/* Tiempo de entrega y Condiciones de pago */}
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>Tiempo de Entrega:</Text>
                    <TextInput
                      value={deliveryDays}
                      onChangeText={setDeliveryDays}
                      placeholder="Ej. Inmediata, 3 días…"
                      placeholderTextColor={colors.muted}
                      style={inp}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>Condiciones de Pago:</Text>
                    <TextInput
                      value={paymentTerms}
                      onChangeText={setPaymentTerms}
                      placeholder="Ej. Contado, Crédito…"
                      placeholderTextColor={colors.muted}
                      style={inp}
                    />
                  </View>
                </View>

                {/* Notas u observaciones técnicas */}
                <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>
                  Observaciones Técnicas o Garantía:
                </Text>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Garantía de 6 meses, incluye transporte, repuesto original o alternativo…"
                  placeholderTextColor={colors.muted}
                  style={[inp, { marginBottom: spacing.sm, height: 50 }]}
                  multiline
                />

                {/* Adjuntar presupuesto (Foto o PDF) */}
                <View style={{ marginBottom: spacing.md }}>
                  <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>
                    Soporte / Presupuesto del Proveedor (Opcional):
                  </Text>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                    <TouchableOpacity
                      disabled={uploading}
                      onPress={() => adjuntarSoporte('camara')}
                      style={{
                        backgroundColor: colors.surfaceAlt,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: radius.md,
                        paddingHorizontal: spacing.sm + 2,
                        paddingVertical: 7,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Text style={{ fontSize: 11.5, fontWeight: '700', color: colors.text }}>
                        📷 Foto Cámara
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      disabled={uploading}
                      onPress={() => adjuntarSoporte('archivo')}
                      style={{
                        backgroundColor: colors.surfaceAlt,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: radius.md,
                        paddingHorizontal: spacing.sm + 2,
                        paddingVertical: 7,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Text style={{ fontSize: 11.5, fontWeight: '700', color: colors.text }}>
                        📄 Adjuntar PDF/Imagen
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {fileUrl ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                      <Text style={{ fontSize: 11, color: colors.success, fontWeight: '700' }} numberOfLines={1}>
                        ✅ Adjunto: {fileName || 'Presupuesto cargado'}
                      </Text>
                      <TouchableOpacity onPress={() => { setFileUrl(null); setFileName(null); }}>
                        <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700' }}>Quitar</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>

                {/* Botón Guardar Cotización */}
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm }}>
                  <TouchableOpacity
                    onPress={resetForm}
                    disabled={saving}
                    style={{
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.sm,
                      borderRadius: radius.md,
                      backgroundColor: colors.surfaceAlt,
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={guardarCotizacionForm}
                    disabled={saving}
                    style={{
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.sm,
                      borderRadius: radius.md,
                      backgroundColor: colors.brand,
                      minWidth: 120,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>
                      {saving ? 'Guardando…' : editingIndex !== null ? 'Actualizar Oferta' : 'Guardar Cotización'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
          </ScrollView>

          {/* Pie del modal */}
          <View
            style={{
              padding: spacing.md,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              backgroundColor: colors.surface,
              flexDirection: 'row',
              justifyContent: 'flex-end',
            }}
          >
            <TouchableOpacity
              onPress={onClose}
              style={{
                backgroundColor: colors.brand,
                borderRadius: radius.md,
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.sm,
              }}
            >
              <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 13 }}>
                Listo / Cerrar
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
