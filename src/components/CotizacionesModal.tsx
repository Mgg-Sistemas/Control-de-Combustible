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
import { Supplier, RequirementLine } from '../types/database';
import {
  CotizacionAlternativa,
  ArchivoPresupuestoCotizacion,
  PresupuestoLineaCotizacion,
  MonedaCotizacion,
  MONEDAS_COMUNES,
  calcularEquivalenteUsd,
  formatearMoneda,
  simboloMoneda,
} from '../lib/cotizaciones';
import { pickAndUploadRequirementFile, pickAndUploadRequirementFiles, captureAndUploadPhoto } from '../lib/photo';
import { onlyDecimal, norm } from '../lib/text';
import { leerNumero } from '../lib/numeros';
import { useToast } from './ToastProvider';
import { useConfirm } from './ConfirmProvider';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const parseNum = leerNumero;

interface DraftPresupuestoLine {
  id: string;
  item_index: number | null;
  descripcion: string;
  qty: string;
  unit: string;
  modo_precio: 'unidad' | 'total';
  valor_ingreso: string; // Lo que escribe el usuario (unitario o total según modo_precio)
  proveedor_sub: string;
  file_url: string | null;
  file_name: string | null;
}

interface CotizacionesModalProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  requirementCode?: string | null;
  requirementItems?: RequirementLine[];
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
  requirementItems = [],
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
  const [modoPrecioGeneral, setModoPrecioGeneral] = useState<'unidad' | 'total'>('total');
  const [qtyGeneral, setQtyGeneral] = useState('1');
  const [presupuestosDraft, setPresupuestosDraft] = useState<DraftPresupuestoLine[]>([]);
  const [currency, setCurrency] = useState<MonedaCotizacion>('USD');
  const [customCurrency, setCustomCurrency] = useState('');
  const [exchangeRate, setExchangeRate] = useState('');
  const [deliveryDays, setDeliveryDays] = useState('Inmediata');
  const [paymentTerms, setPaymentTerms] = useState('Contado');
  const [notes, setNotes] = useState('');
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [files, setFiles] = useState<ArchivoPresupuestoCotizacion[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Visor de archivo adjunto
  const [previewFile, setPreviewFile] = useState<{ url: string; name?: string } | null>(null);

  // Sincronizar lista al abrir
  React.useEffect(() => {
    setLista(cotizaciones || []);
  }, [cotizaciones, visible]);

  const monedaActiva = currency === '__OTRA__' ? customCurrency.trim().toUpperCase() || 'OTRA' : currency;

  const defaultTotalQty = useMemo(() => {
    const sum = (requirementItems || []).reduce((acc, it) => acc + (Number(it.qty) || 0), 0);
    return sum > 0 ? sum : 1;
  }, [requirementItems]);

  // Cálculo de cada presupuesto individual (unitario y total según modo_precio)
  const presupuestosCalculados = useMemo<PresupuestoLineaCotizacion[]>(() => {
    return presupuestosDraft.map((p) => {
      const q = Math.max(0.0001, parseNum(p.qty) || 1);
      const val = parseNum(p.valor_ingreso) || 0;
      const unitario = p.modo_precio === 'unidad' ? val : (Math.round((val / q) * 10000) / 10000);
      const total = p.modo_precio === 'total' ? val : (Math.round(val * q * 100) / 100);
      return {
        id: p.id,
        item_index: p.item_index,
        descripcion: p.descripcion.trim() || 'Presupuesto / Objeto',
        qty: parseNum(p.qty) || 1,
        unit: p.unit.trim() || 'UND',
        modo_precio: p.modo_precio,
        precio_unitario: unitario,
        precio_total: total,
        proveedor_sub: p.proveedor_sub.trim() || null,
        file_url: p.file_url,
        file_name: p.file_name,
      };
    });
  }, [presupuestosDraft]);

  const sumaPresupuestos = useMemo(() => {
    return presupuestosCalculados.reduce((acc, p) => acc + (p.precio_total || 0), 0);
  }, [presupuestosCalculados]);

  // Equivalente en USD calculado en vivo para el formulario
  const rawInputNum = parseNum(price) || 0;
  const qtyGenNum = Math.max(0.0001, parseNum(qtyGeneral) || defaultTotalQty);
  const livePriceNum = useMemo(() => {
    if (presupuestosCalculados.length > 0 && sumaPresupuestos > 0) {
      return Math.round(sumaPresupuestos * 100) / 100;
    }
    if (modoPrecioGeneral === 'unidad') {
      return Math.round(rawInputNum * qtyGenNum * 100) / 100;
    }
    return rawInputNum;
  }, [presupuestosCalculados.length, sumaPresupuestos, modoPrecioGeneral, rawInputNum, qtyGenNum]);

  const liveUnitPriceNum = useMemo(() => {
    if (modoPrecioGeneral === 'unidad') return rawInputNum;
    return qtyGenNum > 0 ? Math.round((livePriceNum / qtyGenNum) * 10000) / 10000 : livePriceNum;
  }, [modoPrecioGeneral, rawInputNum, qtyGenNum, livePriceNum]);

  const liveRateNum = parseNum(exchangeRate) || 0;
  const liveUsdEquiv = useMemo(() => {
    return calcularEquivalenteUsd(livePriceNum, monedaActiva, rateBcv, liveRateNum);
  }, [livePriceNum, monedaActiva, rateBcv, liveRateNum]);

  const crearLineasDesdeObjetos = (): DraftPresupuestoLine[] => {
    if (!requirementItems || requirementItems.length === 0) return [];
    return requirementItems.map((it, i) => ({
      id: `pres-item-${i}-${Date.now()}`,
      item_index: i,
      descripcion: it.name || `Objeto #${i + 1}`,
      qty: String(it.qty || 1),
      unit: it.unit || 'UND',
      modo_precio: it.modo_precio || 'unidad',
      valor_ingreso: '',
      proveedor_sub: '',
      file_url: null,
      file_name: null,
    }));
  };

  const resetForm = () => {
    setFormOpen(false);
    setEditingIndex(null);
    setSupplierId(null);
    setSupplierName('');
    setSupSearchQ('');
    setSupPickerOpen(false);
    setPrice('');
    setModoPrecioGeneral('total');
    setQtyGeneral(String(defaultTotalQty));
    setPresupuestosDraft([]);
    setCurrency('USD');
    setCustomCurrency('');
    setExchangeRate('');
    setDeliveryDays('Inmediata');
    setPaymentTerms('Contado');
    setNotes('');
    setFileUrl(null);
    setFileName(null);
    setFiles([]);
  };

  const abrirNuevo = () => {
    resetForm();
    setQtyGeneral(String(defaultTotalQty));
    if (requirementItems && requirementItems.length > 0) {
      setPresupuestosDraft(crearLineasDesdeObjetos());
    }
    setFormOpen(true);
  };

  const abrirEditar = (item: CotizacionAlternativa, idx: number) => {
    setEditingIndex(idx);
    setSupplierId(item.supplier_id || null);
    setSupplierName(item.supplier_name || '');
    const modo = item.modo_precio || 'total';
    setModoPrecioGeneral(modo);
    const qGen = item.qty_total || defaultTotalQty;
    setQtyGeneral(String(qGen));
    if (modo === 'unidad' && item.unit_price != null) {
      setPrice(String(item.unit_price));
    } else {
      setPrice(String(item.price || ''));
    }
    if (Array.isArray(item.presupuestos) && item.presupuestos.length > 0) {
      setPresupuestosDraft(
        item.presupuestos.map((p, pi) => ({
          id: p.id || `pres-${pi}-${Date.now()}`,
          item_index: p.item_index ?? null,
          descripcion: p.descripcion || '',
          qty: String(p.qty || 1),
          unit: p.unit || 'UND',
          modo_precio: p.modo_precio || 'unidad',
          valor_ingreso: String(p.modo_precio === 'total' ? (p.precio_total ?? 0) : (p.precio_unitario ?? 0)),
          proveedor_sub: p.proveedor_sub || '',
          file_url: p.file_url || null,
          file_name: p.file_name || null,
        }))
      );
    } else {
      setPresupuestosDraft([]);
    }
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
    const existingFiles: ArchivoPresupuestoCotizacion[] =
      Array.isArray(item.files) && item.files.length > 0
        ? item.files
        : item.file_url
        ? [{ id: 'f-0', url: item.file_url, name: item.file_name || 'Presupuesto' }]
        : [];
    setFiles(existingFiles);
    setFileUrl(existingFiles[0]?.url || item.file_url || null);
    setFileName(existingFiles[0]?.name || item.file_name || null);
    setFormOpen(true);
  };

  const agregarLineaPresupuesto = () => {
    setPresupuestosDraft((prev) => [
      ...prev,
      {
        id: `pres-extra-${Date.now()}-${prev.length}`,
        item_index: null,
        descripcion: `Presupuesto #${prev.length + 1}`,
        qty: '1',
        unit: 'UND',
        modo_precio: 'unidad',
        valor_ingreso: '',
        proveedor_sub: '',
        file_url: null,
        file_name: null,
      },
    ]);
  };

  const actualizarLineaPresupuesto = (id: string, campo: keyof DraftPresupuestoLine, valor: any) => {
    setPresupuestosDraft((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        // Si cambia entre 'unidad' y 'total', convertimos el valor_ingreso para que sea intuitivo
        if (campo === 'modo_precio' && valor !== p.modo_precio) {
          const q = Math.max(0.0001, parseNum(p.qty) || 1);
          const vActual = parseNum(p.valor_ingreso) || 0;
          let nuevoVal = p.valor_ingreso;
          if (vActual > 0) {
            if (valor === 'total') {
              // Pasó de unidad -> total
              nuevoVal = String(Math.round(vActual * q * 100) / 100);
            } else {
              // Pasó de total -> unidad
              nuevoVal = String(Math.round((vActual / q) * 10000) / 10000);
            }
          }
          return { ...p, modo_precio: valor, valor_ingreso: nuevoVal };
        }
        return { ...p, [campo]: valor };
      })
    );
  };

  const eliminarLineaPresupuesto = (id: string) => {
    setPresupuestosDraft((prev) => prev.filter((p) => p.id !== id));
  };

  const adjuntarSoporte = async (tipo: 'camara' | 'archivo') => {
    setUploading(true);
    try {
      if (tipo === 'camara') {
        const res = await captureAndUploadPhoto('cotizaciones');
        if (res.ok && res.url) {
          const nuevo: ArchivoPresupuestoCotizacion = {
            id: `f-cam-${Date.now()}`,
            url: res.url,
            name: `Foto_Presupuesto_${files.length + 1}.jpg`,
            kind: 'image',
          };
          const next = [...files, nuevo];
          setFiles(next);
          setFileUrl(next[0].url);
          setFileName(next[0].name);
          toast.success('Foto de presupuesto agregada.');
        } else if (res.error) {
          toast.error(res.error);
        }
      } else {
        const res = await pickAndUploadRequirementFiles('cotizaciones');
        if (res.ok && res.files && res.files.length > 0) {
          const nuevos: ArchivoPresupuestoCotizacion[] = res.files.map((f, idx) => ({
            id: `f-doc-${Date.now()}-${idx}`,
            url: f.url,
            name: f.name || `Presupuesto_${files.length + idx + 1}`,
            kind: f.kind,
          }));
          const next = [...files, ...nuevos];
          setFiles(next);
          setFileUrl(next[0].url);
          setFileName(next[0].name);
          toast.success(`${nuevos.length} presupuesto(s) cargado(s).`);
        } else if (res.error) {
          toast.error(res.error);
        }
      }
    } finally {
      setUploading(false);
    }
  };

  const quitarArchivoSoporte = (id: string) => {
    const next = files.filter((f) => f.id !== id);
    setFiles(next);
    setFileUrl(next[0]?.url || null);
    setFileName(next[0]?.name || null);
  };

  const guardarCotizacionForm = async () => {
    const provNombre = supplierName.trim() || (supplierId ? suppliers.find((s) => s.id === supplierId)?.name : '') || '';
    if (!provNombre) return toast.error('Indica o selecciona el proveedor que cotizó.');
    if (livePriceNum <= 0) return toast.error('Ingresa un precio cotizado mayor a cero (en los presupuestos o en el monto general).');

    const rateNum = currency === 'VES' ? (rateBcv || liveRateNum) : liveRateNum;
    const presupuestosValidos = presupuestosCalculados.filter((p) => p.precio_total > 0 || p.precio_unitario > 0);

    const nuevaCot: CotizacionAlternativa = {
      id: editingIndex !== null ? lista[editingIndex].id : ((globalThis as any)?.crypto?.randomUUID?.() || String(Date.now())),
      supplier_id: supplierId,
      supplier_name: provNombre,
      price: livePriceNum,
      modo_precio: modoPrecioGeneral,
      unit_price: liveUnitPriceNum,
      qty_total: qtyGenNum,
      currency: monedaActiva,
      exchange_rate: rateNum > 0 ? rateNum : undefined,
      price_usd_equiv: liveUsdEquiv > 0 ? liveUsdEquiv : livePriceNum,
      delivery_days: deliveryDays.trim() || null,
      payment_terms: paymentTerms.trim() || null,
      file_url: files[0]?.url || fileUrl,
      file_name: files[0]?.name || fileName,
      files: files.length > 0 ? files : undefined,
      presupuestos: presupuestosValidos.length > 0 ? presupuestosValidos : undefined,
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
                            MONTO TOTAL COTIZADO {c.modo_precio === 'unidad' && c.unit_price ? `(${formatearMoneda(c.unit_price, c.currency)} c/u × ${c.qty_total || 1})` : ''}
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

                      {/* Desglose de 1 o varios presupuestos / objetos dentro de la cotización */}
                      {Array.isArray(c.presupuestos) && c.presupuestos.length > 0 ? (
                        <View
                          style={{
                            marginTop: 4,
                            marginBottom: 4,
                            padding: 6,
                            borderRadius: radius.sm,
                            backgroundColor: colors.surfaceAlt,
                            borderWidth: 1,
                            borderColor: colors.border,
                            gap: 4,
                          }}
                        >
                          <Text style={{ fontSize: 10.5, fontWeight: '800', color: colors.brandText }}>
                            📋 Presupuestos / Objetos incluidos ({c.presupuestos.length}):
                          </Text>
                          {c.presupuestos.map((p, pi) => (
                            <View
                              key={p.id || pi}
                              style={{
                                flexDirection: 'row',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                borderTopWidth: pi > 0 ? 1 : 0,
                                borderTopColor: colors.border,
                                paddingTop: pi > 0 ? 3 : 0,
                              }}
                            >
                              <View style={{ flex: 1, marginRight: 6 }}>
                                <Text style={{ fontSize: 11.5, fontWeight: '700', color: colors.text }}>
                                  {pi + 1}. {p.descripcion} ({p.qty} {p.unit || 'UND'})
                                </Text>
                                <Text style={{ fontSize: 10, color: colors.muted }}>
                                  {p.modo_precio === 'total' ? '📦 Cotizado por Total' : '🎯 Cotizado por Unidad'} · Unit: {formatearMoneda(p.precio_unitario, c.currency)} c/u
                                  {p.proveedor_sub ? ` · 🏢 ${p.proveedor_sub}` : ''}
                                </Text>
                              </View>
                              <Text style={{ fontSize: 12, fontWeight: '900', color: colors.text }}>
                                {formatearMoneda(p.precio_total, c.currency)}
                              </Text>
                            </View>
                          ))}
                        </View>
                      ) : null}

                      {/* Notas u observaciones */}
                      {c.notes ? (
                        <Text style={{ fontSize: 11, color: colors.muted, marginVertical: 3, fontStyle: 'italic' }}>
                          💬 {c.notes}
                        </Text>
                      ) : null}

                      {/* Archivos de presupuestos adjuntos (1 o varios) */}
                      {(() => {
                        const adjuntos: ArchivoPresupuestoCotizacion[] =
                          Array.isArray(c.files) && c.files.length > 0
                            ? c.files
                            : c.file_url
                            ? [{ id: 'f0', url: c.file_url, name: c.file_name || 'Ver Presupuesto' }]
                            : [];
                        if (adjuntos.length === 0) return null;
                        return (
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                            {adjuntos.map((f, fi) => (
                              <TouchableOpacity
                                key={f.id || fi}
                                onPress={() => abrirArchivo(f.url)}
                                style={{
                                  backgroundColor: colors.surfaceAlt,
                                  borderWidth: 1,
                                  borderColor: colors.brand,
                                  borderRadius: radius.sm,
                                  paddingHorizontal: 8,
                                  paddingVertical: 4,
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  gap: 4,
                                }}
                              >
                                <Text style={{ fontSize: 11, color: colors.brandText, fontWeight: '700' }}>
                                  📎 {f.name || `Presupuesto #${fi + 1}`}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        );
                      })()}

                      {/* Botones de acción de la cotización */}
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, gap: 6, flexWrap: 'wrap' }}>
                        <View style={{ flexDirection: 'row', gap: 6 }}>
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

                {/* Moneda activa de la cotización */}
                <View style={{ marginBottom: spacing.sm }}>
                  <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>Moneda de la Cotización:</Text>
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
                            paddingHorizontal: 10,
                            paddingVertical: 7,
                            borderRadius: radius.md,
                            backgroundColor: sel ? colors.brand : colors.surfaceAlt,
                            borderWidth: 1,
                            borderColor: sel ? colors.brand : colors.border,
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 4,
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
                        paddingHorizontal: 10,
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

                {/* 📋 Uno o varios Presupuestos / Objetos dentro de esta Cotización */}
                <View
                  style={{
                    backgroundColor: colors.surfaceAlt,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: colors.border,
                    padding: spacing.sm,
                    marginBottom: spacing.sm,
                    gap: 6,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12, fontWeight: '800', color: colors.text }}>
                        📋 Presupuestos / Objetos en esta Cotización ({presupuestosDraft.length})
                      </Text>
                      <Text style={{ fontSize: 10.5, color: colors.muted }}>
                        Agrega uno o varios presupuestos y elige si el precio es por unidad o total para los objetos.
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 4 }}>
                      {requirementItems && requirementItems.length > 0 && presupuestosDraft.length === 0 ? (
                        <TouchableOpacity
                          onPress={() => setPresupuestosDraft(crearLineasDesdeObjetos())}
                          style={{
                            backgroundColor: colors.surface,
                            borderWidth: 1,
                            borderColor: colors.brand,
                            borderRadius: radius.sm,
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                          }}
                        >
                          <Text style={{ color: colors.brandText, fontSize: 10.5, fontWeight: '800' }}>
                            📦 Traer objetos ({requirementItems.length})
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                      <TouchableOpacity
                        onPress={agregarLineaPresupuesto}
                        style={{
                          backgroundColor: colors.brand,
                          borderRadius: radius.sm,
                          paddingHorizontal: 8,
                          paddingVertical: 4,
                        }}
                      >
                        <Text style={{ color: colors.brandContrast, fontSize: 11, fontWeight: '800' }}>
                          ＋ Agregar presupuesto
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {presupuestosDraft.map((p, pi) => {
                    const calc = presupuestosCalculados[pi];
                    const esTotal = p.modo_precio === 'total';
                    return (
                      <View
                        key={p.id}
                        style={{
                          backgroundColor: colors.surface,
                          borderRadius: radius.sm,
                          borderWidth: 1,
                          borderColor: colors.border,
                          padding: spacing.sm,
                          gap: 6,
                        }}
                      >
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Text style={{ fontSize: 11.5, fontWeight: '800', color: colors.brandText }}>
                            Presupuesto / Objeto #{pi + 1}
                          </Text>
                          <TouchableOpacity onPress={() => eliminarLineaPresupuesto(p.id)}>
                            <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700' }}>🗑 Quitar</Text>
                          </TouchableOpacity>
                        </View>

                        <View style={{ flexDirection: 'row', gap: 6 }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 2 }}>Objeto / Concepto</Text>
                            <TextInput
                              value={p.descripcion}
                              onChangeText={(t) => actualizarLineaPresupuesto(p.id, 'descripcion', t)}
                              placeholder="Nombre del objeto o presupuesto…"
                              placeholderTextColor={colors.muted}
                              style={[inp, { fontSize: 12, paddingVertical: 5 }]}
                            />
                          </View>
                          <View style={{ width: 65 }}>
                            <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 2 }}>Cant.</Text>
                            <TextInput
                              value={p.qty}
                              onChangeText={(t) => actualizarLineaPresupuesto(p.id, 'qty', onlyDecimal(t))}
                              keyboardType="numeric"
                              style={[inp, { fontSize: 12, paddingVertical: 5, textAlign: 'center', fontWeight: '700' }]}
                            />
                          </View>
                          <View style={{ width: 60 }}>
                            <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 2 }}>Und.</Text>
                            <TextInput
                              value={p.unit}
                              onChangeText={(t) => actualizarLineaPresupuesto(p.id, 'unit', t.toUpperCase())}
                              placeholder="UND"
                              placeholderTextColor={colors.muted}
                              style={[inp, { fontSize: 11.5, paddingVertical: 5, textAlign: 'center' }]}
                            />
                          </View>
                        </View>

                        {/* Selector: Precio por Unidad vs Precio Total para este objeto/presupuesto */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                          <View style={{ flexDirection: 'row', gap: 4 }}>
                            <TouchableOpacity
                              onPress={() => actualizarLineaPresupuesto(p.id, 'modo_precio', 'unidad')}
                              style={{
                                paddingHorizontal: 8,
                                paddingVertical: 4,
                                borderRadius: radius.pill,
                                borderWidth: 1,
                                borderColor: !esTotal ? colors.brand : colors.border,
                                backgroundColor: !esTotal ? colors.brand : colors.surfaceAlt,
                              }}
                            >
                              <Text style={{ fontSize: 10.5, fontWeight: '800', color: !esTotal ? colors.brandContrast : colors.text }}>
                                🎯 Por Unidad (c/u)
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => actualizarLineaPresupuesto(p.id, 'modo_precio', 'total')}
                              style={{
                                paddingHorizontal: 8,
                                paddingVertical: 4,
                                borderRadius: radius.pill,
                                borderWidth: 1,
                                borderColor: esTotal ? '#0D9488' : colors.border,
                                backgroundColor: esTotal ? '#0D9488' : colors.surfaceAlt,
                              }}
                            >
                              <Text style={{ fontSize: 10.5, fontWeight: '800', color: esTotal ? '#fff' : colors.text }}>
                                📦 Precio Total (x {p.qty || 1})
                              </Text>
                            </TouchableOpacity>
                          </View>

                          <View style={{ flex: 1, minWidth: 130 }}>
                            <TextInput
                              value={p.valor_ingreso}
                              onChangeText={(t) => actualizarLineaPresupuesto(p.id, 'valor_ingreso', onlyDecimal(t))}
                              keyboardType="numeric"
                              placeholder={esTotal ? `Total (${simboloMoneda(monedaActiva)})` : `Unitario (${simboloMoneda(monedaActiva)})`}
                              placeholderTextColor={colors.muted}
                              style={[inp, { fontSize: 13, fontWeight: '800', textAlign: 'right', paddingVertical: 5 }]}
                            />
                          </View>
                        </View>

                        {/* Resumen calculado en vivo del presupuesto */}
                        {calc && (calc.precio_total > 0 || calc.precio_unitario > 0) ? (
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.surfaceAlt, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm }}>
                            <Text style={{ fontSize: 10.5, color: colors.muted, fontWeight: '700' }}>
                              Unitario: {formatearMoneda(calc.precio_unitario, monedaActiva)} c/u
                            </Text>
                            <Text style={{ fontSize: 11, color: colors.brandText, fontWeight: '900' }}>
                              Total ({calc.qty} {calc.unit}): {formatearMoneda(calc.precio_total, monedaActiva)}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </View>

                {/* Monto General (se calcula automático de la suma de presupuestos o se ingresa por Unidad / Total) */}
                <View
                  style={{
                    backgroundColor: colors.surfaceAlt,
                    borderRadius: radius.md,
                    padding: spacing.sm,
                    borderWidth: 1,
                    borderColor: colors.border,
                    marginBottom: spacing.sm,
                  }}
                >
                  {presupuestosCalculados.length > 0 && sumaPresupuestos > 0 ? (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View>
                        <Text style={{ fontSize: 11, color: colors.muted, fontWeight: '700' }}>
                          TOTAL SUMA DE PRESUPUESTOS ({presupuestosCalculados.length}):
                        </Text>
                        <Text style={{ fontSize: 16, fontWeight: '900', color: colors.text }}>
                          {formatearMoneda(livePriceNum, monedaActiva)}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ fontSize: 10, color: colors.muted, fontWeight: '700' }}>EQUIVALENTE USD</Text>
                        <Text style={{ fontSize: 14, fontWeight: '900', color: colors.brandText }}>
                          ≈ ${liveUsdEquiv.toFixed(2)} USD
                        </Text>
                      </View>
                    </View>
                  ) : (
                    <View style={{ gap: 6 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                        <Text style={{ fontSize: 11, color: colors.text, fontWeight: '800' }}>
                          Precio Directo de la Cotización ({simboloMoneda(monedaActiva)}):
                        </Text>
                        <View style={{ flexDirection: 'row', gap: 4 }}>
                          <TouchableOpacity
                            onPress={() => {
                              if (modoPrecioGeneral !== 'unidad') {
                                const cur = parseNum(price) || 0;
                                if (cur > 0 && qtyGenNum > 0) {
                                  setPrice(String(Math.round((cur / qtyGenNum) * 10000) / 10000));
                                }
                                setModoPrecioGeneral('unidad');
                              }
                            }}
                            style={{
                              paddingHorizontal: 8,
                              paddingVertical: 4,
                              borderRadius: radius.pill,
                              borderWidth: 1,
                              borderColor: modoPrecioGeneral === 'unidad' ? colors.brand : colors.border,
                              backgroundColor: modoPrecioGeneral === 'unidad' ? colors.brand : colors.surface,
                            }}
                          >
                            <Text style={{ fontSize: 10.5, fontWeight: '800', color: modoPrecioGeneral === 'unidad' ? colors.brandContrast : colors.text }}>
                              🎯 Por Unidad (c/u)
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => {
                              if (modoPrecioGeneral !== 'total') {
                                const cur = parseNum(price) || 0;
                                if (cur > 0 && qtyGenNum > 0) {
                                  setPrice(String(Math.round(cur * qtyGenNum * 100) / 100));
                                }
                                setModoPrecioGeneral('total');
                              }
                            }}
                            style={{
                              paddingHorizontal: 8,
                              paddingVertical: 4,
                              borderRadius: radius.pill,
                              borderWidth: 1,
                              borderColor: modoPrecioGeneral === 'total' ? '#0D9488' : colors.border,
                              backgroundColor: modoPrecioGeneral === 'total' ? '#0D9488' : colors.surface,
                            }}
                          >
                            <Text style={{ fontSize: 10.5, fontWeight: '800', color: modoPrecioGeneral === 'total' ? '#fff' : colors.text }}>
                              📦 Precio Total
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>

                      <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
                        {modoPrecioGeneral === 'unidad' ? (
                          <View style={{ width: 80 }}>
                            <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 2 }}>Cant. Objetos</Text>
                            <TextInput
                              value={qtyGeneral}
                              onChangeText={(t) => setQtyGeneral(onlyDecimal(t))}
                              keyboardType="numeric"
                              style={[inp, { textAlign: 'center', fontWeight: '700' }]}
                            />
                          </View>
                        ) : null}
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 2 }}>
                            {modoPrecioGeneral === 'unidad' ? 'Precio por Unidad (c/u):' : 'Precio Total Cotizado:'}
                          </Text>
                          <TextInput
                            value={price}
                            onChangeText={(t) => setPrice(onlyDecimal(t))}
                            keyboardType="numeric"
                            placeholder="0.00"
                            placeholderTextColor={colors.muted}
                            style={[inp, { fontWeight: '800', fontSize: 15, textAlign: 'right' }]}
                          />
                        </View>
                      </View>

                      {rawInputNum > 0 ? (
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
                          <Text style={{ fontSize: 11, color: colors.muted, fontWeight: '700' }}>
                            Unitario: {formatearMoneda(liveUnitPriceNum, monedaActiva)} c/u
                          </Text>
                          <Text style={{ fontSize: 11.5, color: colors.brandText, fontWeight: '900' }}>
                            Total ({qtyGenNum} und.): {formatearMoneda(livePriceNum, monedaActiva)}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  )}
                </View>

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

                {/* Adjuntar uno o varios presupuestos (Fotos o PDFs) */}
                <View style={{ marginBottom: spacing.md }}>
                  <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>
                    Soportes / Presupuestos del Proveedor (Puedes subir 1 o varios PDFs/Fotos):
                  </Text>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' }}>
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
                        📄 Adjuntar 1 o varios PDF/Imágenes
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {files.length > 0 ? (
                    <View style={{ marginTop: 6, gap: 4 }}>
                      {files.map((f, fi) => (
                        <View
                          key={f.id || fi}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            backgroundColor: colors.surfaceAlt,
                            paddingHorizontal: 8,
                            paddingVertical: 5,
                            borderRadius: radius.sm,
                            borderWidth: 1,
                            borderColor: colors.border,
                          }}
                        >
                          <TouchableOpacity onPress={() => abrirArchivo(f.url)} style={{ flex: 1, marginRight: 8 }}>
                            <Text style={{ fontSize: 11, color: colors.success, fontWeight: '700' }} numberOfLines={1}>
                              ✅ Presupuesto #{fi + 1}: {f.name || 'Archivo adjunto'}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => quitarArchivoSoporte(f.id)}>
                            <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700' }}>✕ Quitar</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
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
