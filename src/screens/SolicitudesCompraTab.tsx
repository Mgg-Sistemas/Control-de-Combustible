import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Modal, ScrollView, Image, Linking, ActivityIndicator, Platform } from 'react-native';
import { Screen, Card, SectionTitle, EmptyState, Loading, SkeletonList } from '../components/ui';
import { ConfigBanner } from '../components/ConfigBanner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { useToast } from '../components/ToastProvider';
import { useTable } from '../hooks/useTable';
import { norm, onlyDecimal } from '../lib/text';
import { leerNumero } from '../lib/numeros';
import { InventoryRequirement, RequirementLine, Company, Supplier, Machinery, Vehicle, Employee } from '../types/database';
import { useBcvRate, bsFromUsd, usdFromBs, fmtBs } from '../lib/bcv';
import { pickAndUploadRequirementFile, captureAndUploadPhoto } from '../lib/photo';
import { exportPdf, urlToDataUri } from '../lib/pdf';
import {
  extraerFactura,
  inyectarFacturaEnObservaciones,
  extraerDespacho,
  inyectarDespachoEnObservaciones,
  expedienteCompletoHtml,
  type FacturaData,
  type DespachoAlmacenData,
  type EmpresaFactura,
} from '../lib/requerimientoExpediente';
import { machineLabel, machineMatches } from '../lib/machineLabel';
import {
  calcularEstadoRequerimiento,
  obtenerConfigAprobacionMonto,
  type ReglaAprobacionMonto,
} from '../lib/requerimientoFlujo';
import { spacing, radius } from '../theme';
import { useTheme } from '../theme/ThemeContext';

const usd = (n: number) =>
  `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const qtyFmt = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString();
const parseNum = leerNumero;
const nowISO = () => new Date().toISOString();

function fmtDate(iso?: string | null): string {
  if (!iso) return 'Sin fecha';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function ConvertItemSupplierPicker({
  itemIndex,
  itemName,
  itemQty,
  itemUnit,
  generalSupplierId,
  currentSupplierId,
  suppliers,
  onSelectSupplier,
}: {
  itemIndex: number;
  itemName: string;
  itemQty: number;
  itemUnit?: string | null;
  generalSupplierId: string | null;
  currentSupplierId: string | null;
  suppliers: Supplier[];
  onSelectSupplier: (supId: string | null) => void;
}) {
  const { colors } = useTheme();
  const tieneSupPropio = Boolean(currentSupplierId && currentSupplierId !== generalSupplierId);
  const [activo, setActivo] = useState(tieneSupPropio);
  const [abierto, setAbierto] = useState(!currentSupplierId);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (currentSupplierId && currentSupplierId !== generalSupplierId) {
      setActivo(true);
    }
  }, [currentSupplierId, generalSupplierId]);

  const toggleCheck = () => {
    if (activo) {
      setActivo(false);
      setSearch('');
      setAbierto(false);
      onSelectSupplier(null);
    } else {
      setActivo(true);
      setAbierto(true);
    }
  };

  const generalSupplierObj = suppliers.find((s) => s.id === generalSupplierId);
  const assignedSupplierObj = suppliers.find((s) => s.id === currentSupplierId);

  const filteredSuppliers = useMemo(() => {
    if (!search.trim()) return suppliers;
    const q = norm(search);
    return suppliers.filter((s) => norm(s.name).includes(q) || (s.rif && norm(s.rif).includes(q)));
  }, [suppliers, search]);

  return (
    <View style={{ marginBottom: 10, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      {/* Encabezado del artículo */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>
          #{itemIndex + 1}. {itemName} ({qtyFmt(itemQty)} {itemUnit || 'UND'})
        </Text>
      </View>

      {/* Checkbox: Asignar proveedor diferente a este artículo */}
      <TouchableOpacity
        onPress={toggleCheck}
        activeOpacity={0.7}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}
      >
        <View
          style={{
            width: 18,
            height: 18,
            borderRadius: 4,
            borderWidth: 1.5,
            borderColor: activo ? colors.brand : colors.border,
            backgroundColor: activo ? colors.brand : colors.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {activo ? <Text style={{ color: colors.brandContrast, fontSize: 11, fontWeight: '900', lineHeight: 12 }}>✓</Text> : null}
        </View>
        <Text style={{ color: activo ? colors.text : colors.muted, fontSize: 11.5, fontWeight: activo ? '700' : '500' }}>
          Asignar proveedor diferente a este artículo
        </Text>
      </TouchableOpacity>

      {/* Si no está activo: indica que usa el general */}
      {!activo ? (
        <Text style={{ color: colors.muted, fontSize: 11, marginLeft: 26, marginTop: 1, fontStyle: 'italic' }}>
          Usará el proveedor general: <Text style={{ color: colors.text, fontWeight: '700' }}>{generalSupplierObj?.name || 'Por cotizar'}</Text>
        </Text>
      ) : null}

      {/* Si está activo: opciones con buscador vertical */}
      {activo ? (
        <View style={{ marginTop: 6, marginLeft: 12, padding: 8, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
          {assignedSupplierObj && currentSupplierId !== generalSupplierId ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surfaceAlt, paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.brand, marginBottom: abierto ? 6 : 0 }}>
              <View style={{ flex: 1, marginRight: 6 }}>
                <Text style={{ color: colors.muted, fontSize: 9.5, fontWeight: '700', textTransform: 'uppercase' }}>
                  🏢 Proveedor Específico Asignado
                </Text>
                <Text style={{ color: colors.text, fontSize: 12.5, fontWeight: '800' }} numberOfLines={1}>
                  {assignedSupplierObj.name}
                </Text>
                {assignedSupplierObj.rif ? (
                  <Text style={{ color: colors.muted, fontSize: 10 }}>RIF: {assignedSupplierObj.rif}</Text>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <TouchableOpacity
                  onPress={() => setAbierto((v) => !v)}
                  style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm }}
                >
                  <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '700' }}>{abierto ? '▲ Cerrar' : '🔍 Cambiar'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { onSelectSupplier(null); setAbierto(true); }}
                  style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm }}
                >
                  <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700' }}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {abierto || !assignedSupplierObj || currentSupplierId === generalSupplierId ? (
            <View style={{ marginTop: (assignedSupplierObj && currentSupplierId !== generalSupplierId) ? 4 : 0 }}>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="🔍 Buscar proveedor por nombre o RIF…"
                placeholderTextColor={colors.muted}
                style={{
                  backgroundColor: colors.surfaceAlt,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: radius.sm,
                  paddingHorizontal: 8,
                  paddingVertical: 5,
                  fontSize: 11.5,
                  color: colors.text,
                  marginBottom: 4,
                }}
              />
              <View style={{ maxHeight: 150, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, overflow: 'hidden' }}>
                <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={{ maxHeight: 150 }}>
                  {filteredSuppliers.map((s) => {
                    const sel = currentSupplierId === s.id;
                    return (
                      <TouchableOpacity
                        key={s.id}
                        onPress={() => {
                          onSelectSupplier(s.id);
                          setAbierto(false);
                          setSearch('');
                        }}
                        style={{
                          paddingVertical: 7,
                          paddingHorizontal: 8,
                          borderBottomWidth: 1,
                          borderBottomColor: colors.border,
                          backgroundColor: sel ? colors.brand : 'transparent',
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <View style={{ flex: 1, marginRight: 4 }}>
                          <Text style={{ color: sel ? colors.brandContrast : colors.text, fontSize: 11.5, fontWeight: sel ? '800' : '600' }} numberOfLines={1}>
                            {s.name}
                          </Text>
                          {s.rif ? <Text style={{ color: sel ? colors.brandContrast : colors.muted, fontSize: 9.5 }}>{s.rif}</Text> : null}
                        </View>
                        {sel ? <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 11 }}>✓</Text> : null}
                      </TouchableOpacity>
                    );
                  })}
                  {filteredSuppliers.length === 0 ? (
                    <View style={{ padding: 10, alignItems: 'center' }}>
                      <Text style={{ color: colors.muted, fontSize: 11 }}>Sin coincidencias para «{search}»</Text>
                    </View>
                  ) : null}
                </ScrollView>
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function SolicitudesCompraTab({ canWrite }: { canWrite: boolean }) {
  const { colors, scheme } = useTheme();
  const isDark = scheme === 'dark';
  const { session, fullName } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const { rate } = useBcvRate();

  const { data: allReqs, loading, refetch } = useTable<InventoryRequirement>('inventory_requirements', {
    orderBy: 'created_at',
    ascending: false,
  });

  const { data: suppliers } = useTable<Supplier>('suppliers', { orderBy: 'name' });
  const { data: companies } = useTable<Company>('companies', { orderBy: 'name' });
  const { data: machines } = useTable<Machinery>('machinery', { orderBy: 'code' });
  const { data: vehicles } = useTable<Vehicle>('vehicles', { orderBy: 'plate' });
  const { data: employees } = useTable<Employee>('employees', { orderBy: 'name' });
  const [configAprobacion] = useState<ReglaAprobacionMonto>(obtenerConfigAprobacionMonto);

  // 🧾 Factura Fiscal / Comercial (Ilusiones / Golden Touch)
  const [facturaModalOpen, setFacturaModalOpen] = useState(false);
  const [facturaTarget, setFacturaTarget] = useState<InventoryRequirement | null>(null);
  const [facturaNumero, setFacturaNumero] = useState('');
  const [facturaEmpresa, setFacturaEmpresa] = useState<EmpresaFactura>('Inversiones Las Ilusiones');
  const [facturaFecha, setFacturaFecha] = useState('');
  const [facturaUrl, setFacturaUrl] = useState<string | null>(null);
  const [facturaTipo, setFacturaTipo] = useState<'image' | 'pdf' | null>('image');
  const [facturaNombre, setFacturaNombre] = useState<string | null>(null);
  const [subiendoFactura, setSubiendoFactura] = useState(false);
  const [guardandoFactura, setGuardandoFactura] = useState(false);

  // 👁️ Visor de Factura Modal
  const [facturaViewerOpen, setFacturaViewerOpen] = useState(false);
  const [facturaViewerUrl, setFacturaViewerUrl] = useState<string | null>(null);
  const [facturaViewerTipo, setFacturaViewerTipo] = useState<'image' | 'pdf' | null>('image');
  const [facturaViewerNombre, setFacturaViewerNombre] = useState<string | null>(null);

  // 📦 Control de Almacén: Despacho / Retiro Físico
  const [despachoModalOpen, setDespachoModalOpen] = useState(false);
  const [despachoTarget, setDespachoTarget] = useState<InventoryRequirement | null>(null);
  const [retiradoPor, setRetiradoPor] = useState('');
  const [retiradoCedula, setRetiradoCedula] = useState('');
  const [retiradoCargo, setRetiradoCargo] = useState('');
  const [retiradoEmployeeId, setRetiradoEmployeeId] = useState<string | null>(null);
  const [despachadoPor, setDespachadoPor] = useState('');
  const [despachoFecha, setDespachoFecha] = useState('');
  const [despachoNota, setDespachoNota] = useState('');
  const [despachoMaquinariaId, setDespachoMaquinariaId] = useState<string | null>(null);
  const [empBusquedaQ, setEmpBusquedaQ] = useState('');
  const [maqBusquedaQ, setMaqBusquedaQ] = useState('');
  const [guardandoDespacho, setGuardandoDespacho] = useState(false);

  // Buscador y filtros
  const [query, setQuery] = useState('');
  const [filterEstado, setFilterEstado] = useState<
    'todos' | 'por_cotizar' | 'esperando_pago' | 'aclaratoria' | 'convertido' | 'rechazado' | 'pendiente'
  >('todos');

  // Modales
  const [convertTarget, setConvertTarget] = useState<InventoryRequirement | null>(null);
  const [convertSupplierId, setConvertSupplierId] = useState<string | null>(null);
  const [convertCompanyId, setConvertCompanyId] = useState<string | null>(null);
  const [convertEmpresaPagadoraId, setConvertEmpresaPagadoraId] = useState<string | null>(null);
  const [convertPrice, setConvertPrice] = useState<string>('');
  const [convertCurrency, setConvertCurrency] = useState<'USD' | 'VES'>('USD');
  const [convertNote, setConvertNote] = useState<string>('');
  const [convertBusy, setConvertBusy] = useState(false);

  // Modal Aclaratoria Técnica
  const [aclaratoriaTarget, setAclaratoriaTarget] = useState<InventoryRequirement | null>(null);
  const [aclaratoriaPregunta, setAclaratoriaPregunta] = useState('');
  const [aclaratoriaBusy, setAclaratoriaBusy] = useState(false);

  // Modal Rechazo
  const [rechazoTarget, setRechazoTarget] = useState<InventoryRequirement | null>(null);
  const [motivoRechazo, setMotivoRechazo] = useState('');
  const [rechazoBusy, setRechazoBusy] = useState(false);

  // Modal Foto ampliada
  const [fotoModalUrl, setFotoModalUrl] = useState<string | null>(null);

  // Modal Edición de Solicitud
  const [editTarget, setEditTarget] = useState<InventoryRequirement | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editSolicitante, setEditSolicitante] = useState('');
  const [editArea, setEditArea] = useState('');
  const [editDestinoTipo, setEditDestinoTipo] = useState<'maquinaria' | 'vehiculo' | 'area' | 'otro'>('maquinaria');
  const [editDestinoTexto, setEditDestinoTexto] = useState('');
  const [editMachineSearch, setEditMachineSearch] = useState('');
  const [editVehicleSearch, setEditVehicleSearch] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editItems, setEditItems] = useState<Array<{
    key: string;
    product_id?: string | null;
    name: string;
    qty: string;
    unit: string;
    note: string;
    image_url: string;
    est_price: string;
    currency: 'USD' | 'VES';
    supplier_id?: string | null;
    supplier_name?: string | null;
  }>>([]);
  const [editBusy, setEditBusy] = useState(false);
  const [subiendoFotoKey, setSubiendoFotoKey] = useState<string | null>(null);

  // 1. Universo base de solicitudes técnicas pertenecientes a esta bandeja
  const solicitudesBase = useMemo(() => {
    return (allReqs || []).filter((r) => {
      const isTecnico =
        Boolean(r.solicitante_nombre) ||
        (r.title && r.title.toLowerCase().includes('pedido técnico')) ||
        (r.observaciones && r.observaciones.toLowerCase().includes('portal técnico')) ||
        r.items.some((it) => Boolean(it.note && it.note.trim()));
      return isTecnico;
    });
  }, [allReqs]);

  // 2. Filtrado por texto (búsqueda en código, título, solicitante, área, repuestos y notas)
  const solicitudesBuscadas = useMemo(() => {
    if (!query.trim()) return solicitudesBase;
    const q = norm(query);
    return solicitudesBase.filter((r) => {
      const matchCode = r.code && norm(r.code).includes(q);
      const matchTitle = r.title && norm(r.title).includes(q);
      const matchSolicitante = r.solicitante_nombre && norm(r.solicitante_nombre).includes(q);
      const matchArea = r.area && norm(r.area).includes(q);
      const matchItems = r.items.some(
        (it) => norm(it.name).includes(q) || (it.note && norm(it.note).includes(q))
      );
      return matchCode || matchTitle || matchSolicitante || matchArea || matchItems;
    });
  }, [solicitudesBase, query]);

  // 3. Evaluación dinámica de estados sincronizada con Requerimientos
  const solicitudesConEstado = useMemo(() => {
    return solicitudesBuscadas.map((r) => {
      const provGeneral = suppliers.find((s) => s.id === r.supplier_id);
      const est = calcularEstadoRequerimiento(r, rate, provGeneral, configAprobacion);
      return { req: r, est, provGeneral };
    });
  }, [solicitudesBuscadas, suppliers, rate, configAprobacion]);

  // Contadores reactivos precisos
  const countTodos = solicitudesConEstado.length;
  const countPorCotizar = useMemo(
    () =>
      solicitudesConEstado.filter(
        ({ est }) => est.codigo === 'esperando_proveedor' || est.codigo === 'esperando_cotizacion'
      ).length,
    [solicitudesConEstado]
  );
  const countEsperandoPago = useMemo(
    () =>
      solicitudesConEstado.filter(
        ({ est }) => est.codigo === 'esperando_pago' || est.codigo === 'esperando_aprobacion_gg'
      ).length,
    [solicitudesConEstado]
  );
  const countAclaratorias = useMemo(
    () => solicitudesConEstado.filter(({ est }) => est.codigo === 'aclaratoria_solicitada').length,
    [solicitudesConEstado]
  );
  const countConvertidos = useMemo(
    () =>
      solicitudesConEstado.filter(
        ({ est }) => est.codigo === 'aprobado' || est.codigo === 'esperando_recepcion' || est.codigo === 'recibido'
      ).length,
    [solicitudesConEstado]
  );
  const countRechazados = useMemo(
    () => solicitudesConEstado.filter(({ est }) => est.codigo === 'rechazado').length,
    [solicitudesConEstado]
  );

  // 4. Lista final a mostrar según el chip de estado activo
  const solicitudes = useMemo(() => {
    if (filterEstado === 'por_cotizar' || filterEstado === 'pendiente') {
      return solicitudesConEstado
        .filter(
          ({ est }) => est.codigo === 'esperando_proveedor' || est.codigo === 'esperando_cotizacion'
        )
        .map((x) => x.req);
    }
    if (filterEstado === 'esperando_pago') {
      return solicitudesConEstado
        .filter(
          ({ est }) => est.codigo === 'esperando_pago' || est.codigo === 'esperando_aprobacion_gg'
        )
        .map((x) => x.req);
    }
    if (filterEstado === 'aclaratoria') {
      return solicitudesConEstado
        .filter(({ est }) => est.codigo === 'aclaratoria_solicitada')
        .map((x) => x.req);
    }
    if (filterEstado === 'convertido') {
      return solicitudesConEstado
        .filter(
          ({ est }) => est.codigo === 'aprobado' || est.codigo === 'esperando_recepcion' || est.codigo === 'recibido'
        )
        .map((x) => x.req);
    }
    if (filterEstado === 'rechazado') {
      return solicitudesConEstado
        .filter(({ est }) => est.codigo === 'rechazado')
        .map((x) => x.req);
    }
    return solicitudesConEstado.map((x) => x.req);
  }, [solicitudesConEstado, filterEstado]);

  // Estado para acordeón plegable/desplegable individual y masivo
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const expandirTodas = () => {
    setExpandedIds(new Set(solicitudes.map((s) => s.id)));
  };
  const plegarTodas = () => {
    setExpandedIds(new Set());
  };

  // Asignación de proveedor por renglón en conversión (compras consolidadas multi-proveedor)
  const [convertItemSuppliers, setConvertItemSuppliers] = useState<Record<number, string | null>>({});
  const [convertSupQ, setConvertSupQ] = useState('');
  const [convertSupOpen, setConvertSupOpen] = useState(false);

  // Abrir Modal de Conversión a Requerimiento
  const abrirConvertir = (r: InventoryRequirement) => {
    setConvertTarget(r);
    setConvertSupplierId(r.supplier_id || null);
    setConvertCompanyId(r.company_id || null);
    setConvertEmpresaPagadoraId(r.empresa_pagadora_id || null);
    setConvertSupQ('');
    setConvertSupOpen(false);
    const primerItem = r.items[0];
    setConvertPrice(primerItem && Number(primerItem.est_price) > 0 ? String(primerItem.est_price) : '');
    setConvertCurrency((primerItem?.currency as 'USD' | 'VES') || 'USD');
    setConvertNote(r.note || '');

    // Precargar proveedores individuales de los renglones si ya tenían
    const itemSups: Record<number, string | null> = {};
    r.items.forEach((it, idx) => {
      itemSups[idx] = it.supplier_id || null;
    });
    setConvertItemSuppliers(itemSups);
  };

  const ejecutarConversion = async () => {
    if (!convertTarget) return;
    setConvertBusy(true);

    try {
      const priceNum = parseNum(convertPrice);
      const updatedItems = convertTarget.items.map((it, idx) => {
        const supId = convertItemSuppliers[idx] !== undefined ? convertItemSuppliers[idx] : convertSupplierId;
        const supObj = supId ? suppliers.find((s) => s.id === supId) : null;
        return {
          ...it,
          est_price: priceNum > 0 ? priceNum : it.est_price || 0,
          currency: convertCurrency,
          supplier_id: supId || null,
          supplier_name: supObj?.name || null,
        };
      });

      const empPagadora = companies.find((c) => c.id === convertEmpresaPagadoraId);

      const { error } = await supabase
        .from('inventory_requirements')
        .update({
          status: 'aprobado', // Oficializado / Aprobado para emisión de orden de compra
          supplier_id: convertSupplierId || null,
          company_id: convertCompanyId || null,
          empresa_pagadora_id: convertEmpresaPagadoraId || null,
          empresa_pagadora_nombre: empPagadora?.name || null,
          items: updatedItems,
          note: convertNote.trim() || convertTarget.note || null,
          decided_by: session?.user?.id || null,
          decided_by_name: fullName || 'Compras',
          decided_at: nowISO(),
          decision_note: 'Solicitud convertida a Requerimiento oficial de compra.',
        })
        .eq('id', convertTarget.id);

      if (error) throw error;

      toast.success(
        `¡Solicitud ${convertTarget.code} convertida en Requerimiento oficial de compra!`
      );
      setConvertTarget(null);
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo convertir la solicitud.');
    } finally {
      setConvertBusy(false);
    }
  };

  // Abrir y Enviar Aclaratoria Técnica
  const abrirAclaratoria = (r: InventoryRequirement) => {
    setAclaratoriaTarget(r);
    setAclaratoriaPregunta('');
  };

  const enviarAclaratoria = async () => {
    if (!aclaratoriaTarget) return;
    if (!aclaratoriaPregunta.trim()) {
      return toast.error('Ingresa la pregunta o especificación que debe aclarar el solicitante.');
    }

    setAclaratoriaBusy(true);
    try {
      const { error } = await supabase
        .from('inventory_requirements')
        .update({
          status: 'aclaratoria_solicitada',
          aclaratoria_motivo: aclaratoriaPregunta.trim(),
          aclaratoria_solicitada_por: fullName || 'Departamento de Compras',
          aclaratoria_fecha_solicitud: nowISO(),
        })
        .eq('id', aclaratoriaTarget.id);

      if (error) throw error;

      toast.success('Aclaratoria técnica solicitada. Se ha notificado al solicitante.');
      setAclaratoriaTarget(null);
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo solicitar la aclaratoria.');
    } finally {
      setAclaratoriaBusy(false);
    }
  };

  // Rechazar
  const abrirRechazar = (r: InventoryRequirement) => {
    setRechazoTarget(r);
    setMotivoRechazo('');
  };

  const confirmarRechazo = async () => {
    if (!rechazoTarget) return;
    setRechazoBusy(true);

    try {
      const { error } = await supabase
        .from('inventory_requirements')
        .update({
          status: 'rechazado',
          decision_note: motivoRechazo.trim() || 'Rechazada por el departamento de Compras',
          decided_by: session?.user?.id || null,
          decided_by_name: fullName || 'Compras',
          decided_at: nowISO(),
        })
        .eq('id', rechazoTarget.id);

      if (error) throw error;

      toast.success(`Solicitud ${rechazoTarget.code} rechazada.`);
      setRechazoTarget(null);
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? 'No se pudo rechazar la solicitud.');
    } finally {
      setRechazoBusy(false);
    }
  };

  // ── EDICIÓN DE SOLICITUD DE COMPRA ─────────────────────────────────────────
  const abrirEditar = (r: InventoryRequirement) => {
    setEditTarget(r);
    setEditTitle(r.title || '');
    setEditSolicitante(r.solicitante_nombre || r.requested_by_name || '');
    setEditArea(r.area || '');
    setEditDestinoTipo((r.destino_tipo as any) || 'maquinaria');

    let destText = '';
    if (r.title && r.title.includes('para ')) {
      destText = r.title.split('para ')[1]?.trim();
    } else if (r.observaciones && r.observaciones.includes('para ')) {
      destText = r.observaciones.split('para ')[1]?.trim();
    } else if (r.observaciones) {
      destText = r.observaciones;
    }
    setEditDestinoTexto(destText);
    setEditMachineSearch('');
    setEditVehicleSearch('');
    setEditNote(r.note || '');

    setEditItems(
      (r.items || []).map((it, idx) => ({
        key: `edit-item-${Date.now()}-${idx}`,
        product_id: it.product_id || null,
        name: it.name || '',
        qty: String(it.qty ?? 1),
        unit: (it.unit || 'UND').toUpperCase(),
        note: it.note || '',
        image_url: it.image_url || '',
        est_price: it.est_price ? String(it.est_price) : '',
        currency: (it.currency as 'USD' | 'VES') || 'USD',
        supplier_id: it.supplier_id || null,
        supplier_name: it.supplier_name || null,
      }))
    );
  };

  const agregarRenglonEdicion = () => {
    setEditItems((prev) => [
      ...prev,
      {
        key: `edit-item-${Date.now()}-${prev.length}`,
        name: '',
        qty: '1',
        unit: 'UND',
        note: '',
        image_url: '',
        est_price: '',
        currency: 'USD',
      },
    ]);
  };

  const eliminarRenglonEdicion = (idx: number) => {
    if (editItems.length <= 1) {
      toast.error('La solicitud debe tener al menos un renglón.');
      return;
    }
    setEditItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const actualizarItemEdicion = (idx: number, campo: string, valor: any) => {
    setEditItems((prev) => {
      const copia = [...prev];
      copia[idx] = { ...copia[idx], [campo]: valor };
      return copia;
    });
  };

  const subirFotoRenglon = async (idx: number) => {
    if (!editTarget) return;
    const it = editItems[idx];
    setSubiendoFotoKey(it.key);
    try {
      const res = await pickAndUploadRequirementFile(editTarget.id);
      if (res.ok && res.url) {
        actualizarItemEdicion(idx, 'image_url', res.url);
        toast.success('Foto cargada correctamente.');
      } else if (res.error && !res.error.includes('cancel')) {
        toast.error(res.error || 'No se pudo subir la foto.');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Error al subir la foto.');
    } finally {
      setSubiendoFotoKey(null);
    }
  };

  const guardarEdicion = async () => {
    if (!editTarget) return;

    if (!editTitle.trim()) {
      return toast.error('Ingresa un título o descripción general para la solicitud.');
    }
    if (editItems.length === 0) {
      return toast.error('Debe haber al menos 1 renglón en la solicitud.');
    }
    for (let i = 0; i < editItems.length; i++) {
      const it = editItems[i];
      if (!it.name.trim()) {
        return toast.error(`El renglón #${i + 1} no tiene nombre del repuesto/material.`);
      }
      const q = parseNum(it.qty);
      if (q <= 0) {
        return toast.error(`El renglón #${i + 1} («${it.name}») debe tener una cantidad mayor a 0.`);
      }
    }

    setEditBusy(true);
    try {
      const finalItems: RequirementLine[] = editItems.map((it) => ({
        product_id: it.product_id || null,
        name: it.name.trim(),
        qty: parseNum(it.qty),
        unit: (it.unit || 'UND').trim().toUpperCase(),
        est_price: it.est_price ? parseNum(it.est_price) : 0,
        currency: it.currency || 'USD',
        note: it.note.trim() || null,
        image_url: it.image_url.trim() || null,
        supplier_id: it.supplier_id || null,
        supplier_name: it.supplier_name || null,
      }));

      // 📷 La foto de un renglón es SOLO de ese renglón (28-oct-2026): con UN renglón su foto
      //    sirve también como foto de la solicitud; con varios no se copia a la solicitud.
      const firstPhoto = finalItems.length === 1 ? (finalItems[0].image_url || null) : null;

      const payload: Record<string, any> = {
        title: editTitle.trim(),
        solicitante_nombre: editSolicitante.trim() || null,
        area: editArea.trim() || null,
        destino_tipo: editDestinoTipo,
        observaciones: editDestinoTexto.trim() ? editDestinoTexto.trim() : null,
        note: editNote.trim() || null,
        items: finalItems,
        // Sin `updated_at`: inventory_requirements NO tiene esa columna y mandarla hacía
        // fallar el guardado entero («Could not find the 'updated_at' column…», 28-oct-2026).
      };
      if (firstPhoto) {
        payload.attachment_url = firstPhoto;
        payload.attachment_type = 'image';
      }

      const { data: upd, error } = await supabase
        .from('inventory_requirements')
        .update(payload)
        .eq('id', editTarget.id)
        .select('id');

      if (error) throw error;
      // 0 filas = la base no dejó guardar (permiso): se dice, no se finge el éxito.
      if (!upd || upd.length === 0) throw new Error('No se guardó: no tienes permiso para editar esta solicitud.');

      toast.success(`Solicitud ${editTarget.code} actualizada correctamente.`);
      setEditTarget(null);
      refetch();
    } catch (err: any) {
      toast.error(err?.message || 'Error al actualizar la solicitud.');
    } finally {
      setEditBusy(false);
    }
  };

  // ── Factura de Compra ──
  const abrirSubirFactura = (r: InventoryRequirement) => {
    setFacturaTarget(r);
    const fac = extraerFactura(r);
    if (fac) {
      setFacturaNumero(fac.numero || '');
      setFacturaEmpresa(fac.empresa || 'Inversiones Las Ilusiones');
      setFacturaFecha(fac.fecha || new Date().toISOString().slice(0, 10));
      setFacturaUrl(fac.url || null);
      setFacturaTipo(fac.tipo || 'image');
      setFacturaNombre(fac.nombre || null);
    } else {
      setFacturaNumero('');
      setFacturaEmpresa('Inversiones Las Ilusiones');
      setFacturaFecha(new Date().toISOString().slice(0, 10));
      setFacturaUrl(null);
      setFacturaTipo('image');
      setFacturaNombre(null);
    }
    setFacturaModalOpen(true);
  };

  const subirArchivoFactura = async () => {
    if (!facturaTarget) return;
    setSubiendoFactura(true);
    try {
      const res = await pickAndUploadRequirementFile(`facturas/${facturaTarget.id}`);
      if (!res.ok) {
        if (res.error) toast.error(res.error);
        return;
      }
      setFacturaUrl(res.url || null);
      setFacturaTipo(res.kind || 'image');
      setFacturaNombre(res.name || 'factura');
      toast.success('Archivo de factura cargado.');
    } catch (e: any) {
      toast.error('Error al subir archivo: ' + (e?.message ?? e));
    } finally {
      setSubiendoFactura(false);
    }
  };

  const tomarFotoFactura = async () => {
    if (!facturaTarget) return;
    setSubiendoFactura(true);
    try {
      const res = await captureAndUploadPhoto(`facturas/${facturaTarget.id}`);
      if (!res.ok) {
        if (res.error) toast.error(res.error);
        return;
      }
      setFacturaUrl(res.url || null);
      setFacturaTipo('image');
      setFacturaNombre('Foto Factura');
      toast.success('Foto de factura capturada.');
    } catch (e: any) {
      toast.error('Error al capturar foto: ' + (e?.message ?? e));
    } finally {
      setSubiendoFactura(false);
    }
  };

  const guardarFacturaModal = async () => {
    if (!facturaTarget) return;
    if (!facturaNumero.trim()) {
      toast.error('Indica el número de factura fiscal o comercial.');
      return;
    }
    setGuardandoFactura(true);
    try {
      const dataFac: FacturaData = {
        numero: facturaNumero.trim(),
        empresa: facturaEmpresa,
        fecha: facturaFecha || new Date().toISOString().slice(0, 10),
        url: facturaUrl || null,
        tipo: facturaTipo || 'image',
        nombre: facturaNombre || null,
        subidaPor: fullName || session?.user?.email || 'Administración',
        subidaAt: nowISO(),
      };

      const nuevaObs = inyectarFacturaEnObservaciones(facturaTarget.observaciones, dataFac);
      const patchPayload: Record<string, any> = {
        observaciones: nuevaObs,
      };
      if (dataFac.url && !facturaTarget.attachment_url) {
        patchPayload.attachment_url = dataFac.url;
        patchPayload.attachment_type = dataFac.tipo || 'image';
        patchPayload.attachment_name = dataFac.nombre || `Factura ${dataFac.numero}`;
      }

      const { error } = await supabase
        .from('inventory_requirements')
        .update(patchPayload)
        .eq('id', facturaTarget.id);

      if (error) throw error;
      setFacturaModalOpen(false);
      setFacturaTarget(null);
      refetch();
      toast.success(`Factura N° ${dataFac.numero} de ${dataFac.empresa} registrada.`);
    } catch (e: any) {
      toast.error('Error al guardar factura: ' + (e?.message ?? e));
    } finally {
      setGuardandoFactura(false);
    }
  };

  const abrirVisorFactura = (url?: string | null, tipo?: 'image' | 'pdf' | null, nombre?: string | null) => {
    if (!url) return;
    if (Platform.OS === 'web' && tipo === 'pdf') {
      window.open(url, '_blank');
      return;
    }
    setFacturaViewerUrl(url);
    setFacturaViewerTipo(tipo || 'image');
    setFacturaViewerNombre(nombre || 'Factura');
    setFacturaViewerOpen(true);
  };

  // ── Despacho Almacén (Falta 3) ──
  const abrirDespachoModal = (r: InventoryRequirement) => {
    setDespachoTarget(r);
    const desp = extraerDespacho(r);
    setRetiradoPor(desp.retiradoPor || r.solicitante_nombre || '');
    setRetiradoCedula(desp.retiradoCedula || '');
    setRetiradoCargo(desp.retiradoCargo || '');
    setRetiradoEmployeeId(desp.retiradoEmployeeId || null);
    setDespachadoPor(desp.despachadoPor || fullName || 'Almacén');
    setDespachoFecha(desp.fecha || new Date().toISOString());
    setDespachoNota(desp.nota || '');
    setEmpBusquedaQ('');
    setMaqBusquedaQ('');

    if (desp.maquinariaCodigo) {
      const maqEncontrada = machines.find((m) => m.code === desp.maquinariaCodigo);
      if (maqEncontrada) setDespachoMaquinariaId(maqEncontrada.id);
    } else {
      setDespachoMaquinariaId(null);
    }

    setDespachoModalOpen(true);
  };

  const guardarDespachoModal = async () => {
    if (!despachoTarget) return;
    if (!retiradoPor.trim()) {
      toast.error('Indica quién retiró físicamente el material (mecánico o chofer).');
      return;
    }
    setGuardandoDespacho(true);
    try {
      const maqObj = machines.find((m) => m.id === despachoMaquinariaId);
      const dataDespacho: DespachoAlmacenData = {
        estado: 'retirado',
        retiradoPor: retiradoPor.trim(),
        retiradoCedula: retiradoCedula.trim() || null,
        retiradoCargo: retiradoCargo.trim() || null,
        retiradoEmployeeId: retiradoEmployeeId || null,
        despachadoPor: fullName || despachadoPor || 'Almacén',
        fecha: despachoFecha || nowISO(),
        nota: despachoNota.trim() || null,
        maquinariaCodigo: maqObj?.code || null,
        maquinariaPlaca: maqObj?.plate || null,
      };

      const nuevaObs = inyectarDespachoEnObservaciones(despachoTarget.observaciones, dataDespacho);
      const { error } = await supabase
        .from('inventory_requirements')
        .update({ observaciones: nuevaObs })
        .eq('id', despachoTarget.id);

      if (error) throw error;
      setDespachoModalOpen(false);
      setDespachoTarget(null);
      refetch();
      toast.success(`Retiro físico registrado a nombre de ${dataDespacho.retiradoPor}.`);
    } catch (e: any) {
      toast.error('Error al registrar retiro: ' + (e?.message ?? e));
    } finally {
      setGuardandoDespacho(false);
    }
  };

  // ── Expediente Completo (PDF - Falta 2) ──
  const descargarExpediente = async (r: InventoryRequirement) => {
    try {
      toast.info('Generando Expediente Completo de Compra...');
      const factura = extraerFactura(r);
      const despacho = extraerDespacho(r);

      const prov = suppliers.find((s) => s.id === r.supplier_id);
      let provDatosPago: string | null = null;
      if (prov) {
        const parts = [
          prov.bank_name || prov.account_number ? `🏦 ${prov.bank_name ?? ''} Cta: ${prov.account_number ?? ''}${prov.account_holder ? ` (${prov.account_holder} ${prov.account_id_doc ?? ''})` : ''}`.trim() : '',
          prov.pago_movil_phone ? `📱 PM: ${prov.pago_movil_bank ?? ''} - ${prov.pago_movil_phone} (${prov.pago_movil_id ?? ''})` : '',
          prov.binance_id ? `🟡 Binance: ${prov.binance_id}` : '',
        ].filter(Boolean);
        provDatosPago = parts.join(' · ');
      }

      let pagoInfo: any = null;
      try {
        const { data: cuentaRows } = await supabase
          .from('cuentas')
          .select('id, estado, monto, concepto')
          .eq('inventory_requirement_id', r.id)
          .limit(1);

        if (cuentaRows && cuentaRows[0]) {
          const c = cuentaRows[0];
          const { data: abonoRows } = await supabase
            .from('cuenta_abonos')
            .select('fecha, monto, metodo, referencia, nota')
            .eq('cuenta_id', c.id)
            .order('fecha', { ascending: true });

          const abonos = abonoRows || [];
          const pagado = abonos.reduce((sum: number, ab: any) => sum + (Number(ab.monto) || 0), 0);
          pagoInfo = {
            estadoCuenta: c.estado,
            montoTotal: Number(c.monto) || 0,
            montoPagado: pagado,
            saldoPendiente: Math.max(0, (Number(c.monto) || 0) - pagado),
            concepto: c.concepto,
            abonos,
          };
        }
      } catch (e) {
        console.warn('No se pudo cargar cuentas:', e);
      }

      let maqLabel = '';
      if (despacho.maquinariaCodigo) {
        maqLabel = `${despacho.maquinariaCodigo}${despacho.maquinariaPlaca ? ` · Placa ${despacho.maquinariaPlaca}` : ''}`;
      } else if (r.title && r.title.includes('para ')) {
        maqLabel = r.title.split('para ')[1]?.trim();
      } else if (r.area) {
        maqLabel = r.area;
      }

      const itemsConImagenes = await Promise.all(
        (r.items || []).map(async (it) => ({
          name: it.name,
          unit: it.unit,
          qty: it.qty,
          est_price: it.est_price,
          currency: it.currency || 'USD',
          note: it.note,
          image_url: it.image_url ? ((await urlToDataUri(it.image_url)) || it.image_url) : null,
          supplier_name: it.supplier_name,
        }))
      );

      let facturaParaPdf = factura;
      if (factura && factura.url && factura.tipo === 'image') {
        const dataUri = await urlToDataUri(factura.url);
        facturaParaPdf = { ...factura, url: dataUri || factura.url };
      }

      const html = expedienteCompletoHtml({
        req: r,
        factura: facturaParaPdf,
        despacho,
        pagoInfo,
        proveedorNombre: prov?.name ?? null,
        proveedorRif: prov?.rif ?? null,
        proveedorDatosPago: provDatosPago,
        maquinariaLabel: maqLabel || 'Destino asignado',
        itemsConImagenes,
      });

      await exportPdf(html, `Expediente-${r.code || 'REQ'}`);
      toast.success('Expediente generado exitosamente.');
    } catch (err: any) {
      toast.error('Error al generar expediente: ' + (err?.message ?? err));
    }
  };

  const inp = {
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    fontSize: 13,
  };

  return (
    <Screen>
      <ConfigBanner />

      {/* Cabecera explicativa */}
      <View style={{ marginBottom: spacing.sm }}>
        <Text style={{ fontSize: 18, fontWeight: '900', color: colors.text }}>
          📥 Bandeja de Solicitudes de Compra
        </Text>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
          Peticiones de repuestos y materiales técnicos emitidas por mecánicos y personal de campo.
          Revisa las medidas obligatorias, pide aclaratorias o conviértelas en Requerimientos oficiales.
        </Text>
      </View>

      {/* Buscador */}
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="🔍 Buscar por código, repuesto, solicitante, medidas, máquina…"
        placeholderTextColor={colors.muted}
        style={[inp, { marginBottom: spacing.sm }]}
      />

      {/* Chips de filtro por estado */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginBottom: spacing.md }}>
        {[
          { key: 'todos', label: `Todos (${countTodos})` },
          { key: 'por_cotizar', label: `📋 Por Cotizar (${countPorCotizar})` },
          { key: 'esperando_pago', label: `💳 Esperando Pago (${countEsperandoPago})` },
          { key: 'aclaratoria', label: `⚠️ En Aclaratoria (${countAclaratorias})` },
          { key: 'convertido', label: `✅ Convertidos (${countConvertidos})` },
          { key: 'rechazado', label: `❌ Rechazados (${countRechazados})` },
        ].map((f) => {
          const sel = filterEstado === f.key || (f.key === 'por_cotizar' && filterEstado === 'pendiente');
          return (
            <TouchableOpacity
              key={f.key}
              onPress={() => setFilterEstado(f.key as any)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: radius.pill,
                backgroundColor: sel ? colors.brand : colors.surfaceAlt,
                borderWidth: 1,
                borderColor: sel ? colors.brand : colors.border,
              }}
            >
              <Text style={{ color: sel ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Barra de conteo y controles de acordeón masivo */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs, flexWrap: 'wrap', gap: 6 }}>
        <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700' }}>
          Mostrando {solicitudes.length} {solicitudes.length === 1 ? 'solicitud' : 'solicitudes'}
        </Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <TouchableOpacity
            onPress={expandirTodas}
            style={{
              backgroundColor: colors.surfaceAlt,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>📂 Desplegar todas</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={plegarTodas}
            style={{
              backgroundColor: colors.surfaceAlt,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text style={{ color: colors.text, fontSize: 11, fontWeight: '700' }}>📁 Plegar todas</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Lista de Solicitudes */}
      {loading ? (
        <SkeletonList count={4} />
      ) : solicitudes.length === 0 ? (
        <EmptyState
          title="Sin solicitudes de compra"
          subtitle={
            filterEstado !== 'todos'
              ? 'No hay solicitudes en este filtro.'
              : 'El taller y el personal de campo aún no han enviado solicitudes de compra técnica.'
          }
        />
      ) : (
        solicitudes.map((r) => {
          const provGeneral = suppliers.find((s) => s.id === r.supplier_id);
          const est = calcularEstadoRequerimiento(r, rate, provGeneral, configAprobacion);
          const primerItem = r.items[0];
          // 📷 Foto GENERAL de la solicitud (28-oct-2026): con un renglón, la de ese renglón; con
          //    varios, solo un adjunto propio de la solicitud, nunca la COPIA de la foto de un
          //    renglón (esa ya sale en su renglón y parecía la foto de todos).
          const esFotoDeRenglon = (url?: string | null) => !!url && r.items.some((x) => (x.image_url || '') === url);
          const tieneFoto = r.items.length <= 1
            ? (r.attachment_url || primerItem?.image_url)
            : (r.attachment_url && !esFotoDeRenglon(r.attachment_url) ? r.attachment_url : null);
          const isAbierto = expandedIds.has(r.id);
          const empresaPagadora = r.empresa_pagadora_nombre || companies.find((c) => c.id === r.empresa_pagadora_id)?.name;

          return (
            <Card key={r.id} style={{ gap: 8, marginBottom: spacing.sm, borderWidth: 1, borderColor: isAbierto ? colors.brand : colors.border }}>
              {/* Encabezado Responsivo: Código, Título, Estado y Botón Plegar/Desplegar */}
              <TouchableOpacity
                onPress={() => toggleExpand(r.id)}
                activeOpacity={0.8}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <View style={{ flex: 1, minWidth: 200 }}>
                  <Text style={{ fontWeight: '900', fontSize: 15, color: colors.text }}>
                    {r.code} · {r.items.length === 1 ? primerItem?.name : `Solicitud Multi-Ítem (${r.items.length} Renglones)`}
                  </Text>
                  {r.title && r.title !== primerItem?.name ? (
                    <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 1 }}>{r.title}</Text>
                  ) : null}
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <View
                    style={{
                      backgroundColor: est.bg,
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: radius.pill,
                      borderWidth: 1,
                      borderColor: est.color + '40',
                      maxWidth: 240,
                    }}
                  >
                    <Text style={{ color: est.color, fontWeight: '800', fontSize: 11 }} numberOfLines={1}>
                      {/* La etiqueta de `calcularEstadoRequerimiento` ya trae su icono: no se repite. */}
                      {est.label.startsWith(est.icon) ? est.label : `${est.icon} ${est.label}`}
                    </Text>
                  </View>

                  <View
                    style={{
                      backgroundColor: isAbierto ? colors.surfaceAlt : colors.brand,
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      borderRadius: radius.pill,
                      borderWidth: 1,
                      borderColor: isAbierto ? colors.border : colors.brand,
                    }}
                  >
                    <Text style={{ color: isAbierto ? colors.text : colors.brandContrast, fontSize: 11, fontWeight: '800' }}>
                      {isAbierto ? '▲ Plegar' : `▼ Ver ${r.items.length} ${r.items.length === 1 ? 'ítem' : 'ítems'}`}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>

              {/* Fila de Metadatos Obligatorios (Quién, Fecha/Hora, Destino, Área) */}
              <View
                style={{
                  backgroundColor: colors.surfaceAlt,
                  padding: spacing.sm,
                  borderRadius: radius.sm,
                  gap: 4,
                  borderLeftWidth: 3,
                  borderLeftColor: colors.brand,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                  <Text style={{ color: colors.text, fontSize: 12 }}>
                    👤 <Text style={{ fontWeight: '700' }}>Solicitado por:</Text>{' '}
                    <Text style={{ color: colors.brandText, fontWeight: '800' }}>
                      {r.solicitante_nombre || r.requested_by_name || 'Personal de Campo'}
                    </Text>
                    {r.requested_by_name && r.requested_by_name !== r.solicitante_nombre ? (
                      <Text style={{ color: colors.muted, fontSize: 11 }}> (registró: {r.requested_by_name})</Text>
                    ) : null}
                  </Text>

                  <Text style={{ color: colors.muted, fontSize: 11.5 }}>
                    🕒 <Text style={{ fontWeight: '700' }}>Fecha/Hora:</Text> {fmtDate(r.created_at)}
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap', marginTop: 2 }}>
                  {r.destino_tipo || r.title || r.observaciones ? (() => {
                    let destText = '';
                    if (r.title && r.title.includes('para ')) {
                      destText = r.title.split('para ')[1]?.trim();
                    } else if (r.observaciones && r.observaciones.includes('para ')) {
                      destText = r.observaciones.split('para ')[1]?.trim();
                    } else if (r.destino_tipo === 'maquinaria') {
                      destText = 'Maquinaria';
                    } else if (r.destino_tipo === 'vehiculo') {
                      destText = 'Vehículo';
                    } else if (r.area) {
                      destText = r.area;
                    }
                    if (!destText) return null;
                    return (
                      <Text style={{ color: colors.muted, fontSize: 11.5 }}>
                        🚜 <Text style={{ fontWeight: '700' }}>Destino:</Text> {destText}
                      </Text>
                    );
                  })() : null}

                  {r.area ? (
                    <Text style={{ color: colors.muted, fontSize: 11.5 }}>
                      📍 <Text style={{ fontWeight: '700' }}>Área:</Text> {r.area}
                    </Text>
                  ) : null}
                </View>

                {/* Sincronización comercial con Requerimientos: Proveedor asignado, Pagadora y Cotización */}
                {(provGeneral?.name || est.proveedoresNombres.length > 0 || empresaPagadora || est.totalUSD > 0) ? (
                  <View
                    style={{
                      flexDirection: 'row',
                      gap: 12,
                      flexWrap: 'wrap',
                      marginTop: 2,
                      paddingTop: 4,
                      borderTopWidth: 1,
                      borderTopColor: colors.border,
                    }}
                  >
                    {provGeneral?.name || est.proveedoresNombres.length > 0 ? (
                      <Text style={{ color: colors.text, fontSize: 11.5 }}>
                        🏢 <Text style={{ fontWeight: '700' }}>Proveedor:</Text>{' '}
                        <Text style={{ color: colors.brandText, fontWeight: '800' }}>
                          {provGeneral?.name || est.proveedoresNombres.join(', ')}
                        </Text>
                      </Text>
                    ) : null}

                    {empresaPagadora ? (
                      <Text style={{ color: colors.text, fontSize: 11.5 }}>
                        💳 <Text style={{ fontWeight: '700' }}>Pagadora:</Text>{' '}
                        <Text style={{ color: colors.brandText, fontWeight: '800' }}>{empresaPagadora}</Text>
                      </Text>
                    ) : null}

                    {est.totalUSD > 0 ? (
                      <Text style={{ color: colors.text, fontSize: 11.5 }}>
                        💵 <Text style={{ fontWeight: '700' }}>Cotizado:</Text>{' '}
                        <Text style={{ color: '#059669', fontWeight: '800' }}>
                          ${est.totalUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                          {rate ? ` (~ ${fmtBs(est.totalUSD * rate)})` : ''}
                        </Text>
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>

              {/* 🏬 Ficha de Proveedor Propuesto por el Solicitante (si existe) */}
              {(() => {
                const match = (r.observaciones || '').match(/\[PROVEEDOR SUGERIDO(?:\s*\([^)]*\))?: Nombre:\s*([^|]+)\|\s*Tel:\s*([^|]+)\|\s*Dirección:\s*([^\]]+)\]/i);
                if (!match) return null;
                const nombre = match[1].trim() === 'No indicado' ? '' : match[1].trim();
                const telefono = match[2].trim() === 'No indicado' ? '' : match[2].trim();
                const direccion = match[3].trim() === 'No indicada' ? '' : match[3].trim();
                if (!nombre && !telefono && !direccion) return null;

                return (
                  <View
                    style={{
                      backgroundColor: '#FEF3C7',
                      borderWidth: 1.5,
                      borderColor: '#F59E0B',
                      borderRadius: radius.md,
                      padding: spacing.sm,
                      gap: 4,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ fontSize: 16 }}>🏬</Text>
                        <Text style={{ color: '#92400E', fontWeight: '900', fontSize: 12.5 }}>
                          PROVEEDOR PROPUESTO POR EL SOLICITANTE
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 4 }}>
                        {telefono ? (
                          <>
                            <TouchableOpacity
                              onPress={() => Linking.openURL(`tel:${telefono.replace(/\s+/g, '')}`)}
                              style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#D97706', paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.sm }}
                            >
                              <Text style={{ color: '#B45309', fontSize: 11, fontWeight: '800' }}>📞 Llamar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => {
                                const clean = telefono.replace(/\D/g, '');
                                const wa = clean.startsWith('58') ? clean : clean.startsWith('0') ? '58' + clean.slice(1) : clean;
                                Linking.openURL(`https://wa.me/${wa}`);
                              }}
                              style={{ backgroundColor: '#059669', paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.sm }}
                            >
                              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>💬 WhatsApp</Text>
                            </TouchableOpacity>
                          </>
                        ) : null}
                      </View>
                    </View>

                    {nombre ? (
                      <Text style={{ color: '#78350F', fontSize: 12.5 }}>
                        🏢 <Text style={{ fontWeight: '800' }}>Nombre / Tienda:</Text> {nombre}
                      </Text>
                    ) : null}
                    {telefono ? (
                      <Text style={{ color: '#78350F', fontSize: 12 }}>
                        📞 <Text style={{ fontWeight: '800' }}>Teléfono:</Text> {telefono}
                      </Text>
                    ) : null}
                    {direccion ? (
                      <Text style={{ color: '#78350F', fontSize: 12 }}>
                        📍 <Text style={{ fontWeight: '800' }}>Dirección / Ubicación:</Text> {direccion}
                      </Text>
                    ) : null}
                  </View>
                );
              })()}

              {/* Vista compacta cuando está PLEGADO */}
              {!isAbierto && (
                <TouchableOpacity
                  onPress={() => toggleExpand(r.id)}
                  style={{
                    backgroundColor: colors.surfaceAlt,
                    padding: 8,
                    borderRadius: radius.sm,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }} numberOfLines={1}>
                    📦 Renglones ({r.items.length}):{' '}
                    <Text style={{ color: colors.muted, fontWeight: '500' }}>
                      {r.items.map((it, idx) => `${idx + 1}. ${it.name}`).join('  |  ')}
                    </Text>
                  </Text>
                  <Text style={{ color: colors.brand, fontSize: 11, fontWeight: '700', marginTop: 3 }}>
                    Toque para desplegar medidas técnicas y desglose detallado ➔
                  </Text>
                </TouchableOpacity>
              )}

              {/* Desglose Detallado por Renglón cuando está DESPLEGADO */}
              {isAbierto && (
                <View style={{ gap: 8, marginTop: 2 }}>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800' }}>
                    📋 Desglose Técnico por Renglón ({r.items.length} {r.items.length === 1 ? 'ítem' : 'ítems'}):
                  </Text>
                  {r.items.map((it, idx) => {
                    const tieneNota = Boolean(it.note && it.note.trim());
                    return (
                      <View
                        key={idx}
                        style={{
                          borderWidth: 1.5,
                          borderColor: tieneNota ? '#3B82F6' : colors.border,
                          backgroundColor: colors.surfaceAlt,
                          padding: spacing.sm,
                          borderRadius: radius.md,
                          gap: 6,
                        }}
                      >
                        {/* Cabecera del renglón con alto contraste */}
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                            <View style={{ backgroundColor: '#2563EB', paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.sm }}>
                              <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 11 }}>#{idx + 1}</Text>
                            </View>
                            <Text style={{ color: colors.text, fontWeight: '900', fontSize: 13.5, flexShrink: 1 }}>
                              {it.name}
                            </Text>
                          </View>
                          <View style={{ backgroundColor: colors.surface, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border }}>
                            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 11.5 }}>
                              Cantidad: <Text style={{ color: colors.brandText }}>{qtyFmt(it.qty)} {it.unit || 'UND'}</Text>
                            </Text>
                          </View>
                        </View>

                        {/* Caja Destacada de Especificación Técnica / Medidas */}
                        <View
                          style={{
                            backgroundColor: isDark ? '#0F172A' : '#EFF6FF',
                            borderWidth: 1,
                            borderColor: tieneNota ? '#60A5FA' : colors.border,
                            borderRadius: radius.sm,
                            padding: 8,
                            gap: 3,
                          }}
                        >
                          <Text style={{ color: tieneNota ? '#38BDF8' : colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 0.3 }}>
                            📐 ESPECIFICACIÓN Y MEDIDAS TÉCNICAS DEL ÍTEM #{idx + 1}:
                          </Text>
                          {tieneNota ? (
                            <Text style={{ color: isDark ? '#F8FAFC' : '#1E293B', fontSize: 13, fontWeight: '700', lineHeight: 18 }}>
                              {it.note}
                            </Text>
                          ) : (
                            <Text style={{ color: colors.muted, fontSize: 11.5, fontStyle: 'italic' }}>
                              Sin especificación ni medidas técnicas adicionales registradas para este artículo.
                            </Text>
                          )}
                        </View>

                        {/* Proveedor individual asignado a este renglón (si existe) */}
                        {it.supplier_name ? (
                          <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '700' }}>
                            🏢 Proveedor exclusivo del ítem: {it.supplier_name}
                          </Text>
                        ) : null}

                        {/* Foto propia del ítem */}
                        {it.image_url ? (
                          <TouchableOpacity onPress={() => setFotoModalUrl(it.image_url || null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                            <Image source={{ uri: it.image_url }} style={{ width: 38, height: 38, borderRadius: radius.sm, backgroundColor: colors.surface }} />
                            <Text style={{ color: colors.brand, fontSize: 11, fontWeight: '700' }}>Ver muestra técnica adjunta ➔</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Foto general adjunta de la solicitud */}
              {tieneFoto && isAbierto ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 }}>
                  <TouchableOpacity onPress={() => setFotoModalUrl(tieneFoto)}>
                    <Image
                      source={{ uri: tieneFoto }}
                      style={{
                        width: 60,
                        height: 60,
                        borderRadius: radius.sm,
                        borderWidth: 1,
                        borderColor: colors.border,
                        backgroundColor: colors.surfaceAlt,
                      }}
                    />
                  </TouchableOpacity>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>
                      📷 Fotografía de la pieza / muestra adjunta
                    </Text>
                    <TouchableOpacity onPress={() => setFotoModalUrl(tieneFoto)}>
                      <Text style={{ color: colors.brand, fontSize: 11, fontWeight: '700', marginTop: 2 }}>
                        Ver foto ampliada en detalle ➔
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}

              {/* Si hay Aclaratoria Técnica activa o respondida */}
              {r.aclaratoria_motivo ? (
                <View
                  style={{
                    backgroundColor: r.status === 'aclaratoria_solicitada' ? '#FFF7ED' : '#F0FDF4',
                    borderWidth: 1,
                    borderColor: r.status === 'aclaratoria_solicitada' ? '#FDBA74' : '#86EFAC',
                    padding: spacing.sm,
                    borderRadius: radius.sm,
                    gap: 3,
                  }}
                >
                  <Text
                    style={{
                      color: r.status === 'aclaratoria_solicitada' ? '#C2410C' : '#166534',
                      fontSize: 11.5,
                      fontWeight: '800',
                    }}
                  >
                    ⚠️ Consulta de Compras ({r.aclaratoria_solicitada_por || 'Compras'}):
                  </Text>
                  <Text
                    style={{
                      color: r.status === 'aclaratoria_solicitada' ? '#9A3412' : '#14532D',
                      fontSize: 12,
                      fontStyle: 'italic',
                    }}
                  >
                    "{r.aclaratoria_motivo}"
                  </Text>

                  {r.aclaratoria_respuesta ? (
                    <View style={{ marginTop: 4, paddingTop: 4, borderTopWidth: 1, borderTopColor: '#BBF7D0' }}>
                      <Text style={{ color: '#166534', fontSize: 11.5, fontWeight: '800' }}>
                        💬 Respuesta del Solicitante:
                      </Text>
                      <Text style={{ color: '#14532D', fontSize: 12 }}>{r.aclaratoria_respuesta}</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* 🧾 Sección Dedicada: Factura Fiscal / Comercial */}
              {(() => {
                const fac = extraerFactura(r);
                const tieneFac = Boolean(fac && fac.numero);
                const esGoldenFac = fac?.empresa?.toLowerCase().includes('golden');
                return (
                  <View
                    style={{
                      marginTop: spacing.sm,
                      backgroundColor: colors.surfaceAlt,
                      borderRadius: radius.md,
                      borderWidth: 1.5,
                      borderColor: tieneFac ? (esGoldenFac ? '#F59E0B' : '#6366F1') : colors.border,
                      padding: spacing.sm,
                      gap: 6,
                    }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ fontSize: 14 }}>🧾</Text>
                        <Text style={{ fontSize: 12.5, fontWeight: '800', color: colors.text }}>
                          Factura Fiscal / Comercial
                        </Text>
                      </View>
                      {tieneFac ? (
                        <View
                          style={{
                            backgroundColor: esGoldenFac ? '#FEF3C7' : '#E0E7FF',
                            borderColor: esGoldenFac ? '#F59E0B' : '#6366F1',
                            borderWidth: 1,
                            paddingHorizontal: 8,
                            paddingVertical: 2,
                            borderRadius: radius.pill,
                          }}
                        >
                          <Text style={{ color: esGoldenFac ? '#92400E' : '#3730A3', fontSize: 10.5, fontWeight: '800' }}>
                            {fac?.empresa}
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    {tieneFac ? (
                      <View style={{ gap: 4 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                          <Text style={{ fontSize: 12, color: colors.text }}>
                            <Text style={{ fontWeight: '700' }}>N° Factura:</Text>{' '}
                            <Text style={{ fontWeight: '900', color: colors.brandText }}>{fac?.numero}</Text>
                          </Text>
                          {fac?.fecha ? (
                            <Text style={{ fontSize: 11.5, color: colors.muted }}>
                              📅 Fecha: {fac.fecha}
                            </Text>
                          ) : null}
                        </View>
                        {fac?.subidaPor ? (
                          <Text style={{ fontSize: 11, color: colors.muted }}>
                            👤 Subida por: {fac.subidaPor}
                          </Text>
                        ) : null}
                        <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: 4 }}>
                          {fac?.url ? (
                            <TouchableOpacity
                              onPress={() => abrirVisorFactura(fac.url, fac.tipo, fac.nombre)}
                              style={{
                                backgroundColor: colors.surface,
                                borderWidth: 1,
                                borderColor: colors.brand,
                                borderRadius: radius.sm,
                                paddingHorizontal: spacing.sm,
                                paddingVertical: 4,
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              <Text style={{ fontSize: 11 }}>👁️</Text>
                              <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 11.5 }}>
                                Ver Factura Adjunta
                              </Text>
                            </TouchableOpacity>
                          ) : null}
                          {canWrite ? (
                            <TouchableOpacity
                              onPress={() => abrirSubirFactura(r)}
                              style={{
                                backgroundColor: colors.surface,
                                borderWidth: 1,
                                borderColor: colors.border,
                                borderRadius: radius.sm,
                                paddingHorizontal: spacing.sm,
                                paddingVertical: 4,
                              }}
                            >
                              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11.5 }}>
                                ✏️ Modificar Factura
                              </Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      </View>
                    ) : (
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                        <Text style={{ fontSize: 11.5, color: colors.muted, fontStyle: 'italic', flex: 1 }}>
                          Sin factura cargada todavía.
                        </Text>
                        {canWrite ? (
                          <TouchableOpacity
                            onPress={() => abrirSubirFactura(r)}
                            style={{
                              backgroundColor: colors.brand,
                              borderRadius: radius.sm,
                              paddingHorizontal: spacing.sm,
                              paddingVertical: 5,
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <Text style={{ fontSize: 12 }}>➕</Text>
                            <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 11.5 }}>
                              Subir Factura
                            </Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    )}
                  </View>
                );
              })()}

              {/* 📦 Sección Dedicada: Control Físico de Almacén (Falta 3) */}
              {r.status === 'recibido' && (() => {
                const desp = extraerDespacho(r);
                const esRetirado = desp.estado === 'retirado';
                return (
                  <View
                    style={{
                      marginTop: spacing.sm,
                      backgroundColor: esRetirado ? '#F8FAFC' : '#F0FDF4',
                      borderRadius: radius.md,
                      borderWidth: 1.5,
                      borderColor: esRetirado ? '#3B82F6' : '#22C55E',
                      padding: spacing.sm,
                      gap: 6,
                    }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ fontSize: 14 }}>{esRetirado ? '📦' : '🟢'}</Text>
                        <Text style={{ fontSize: 12.5, fontWeight: '800', color: colors.text }}>
                          Control Físico en Almacén: {esRetirado ? 'Retirado / Despachado' : 'Disponible en Almacén'}
                        </Text>
                      </View>
                      <View
                        style={{
                          backgroundColor: esRetirado ? '#DBEAFE' : '#DCFCE7',
                          borderColor: esRetirado ? '#2563EB' : '#16A34A',
                          borderWidth: 1,
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                          borderRadius: radius.pill,
                        }}
                      >
                        <Text style={{ color: esRetirado ? '#1E40AF' : '#15803D', fontSize: 10.5, fontWeight: '800' }}>
                          {esRetirado ? 'DESPACHADO' : 'LISTO PARA ENTREGA'}
                        </Text>
                      </View>
                    </View>

                    {esRetirado ? (
                      <View style={{ gap: 4 }}>
                        <Text style={{ fontSize: 12, color: colors.text }}>
                          👤 <Text style={{ fontWeight: '700' }}>Retirado por:</Text>{' '}
                          <Text style={{ fontWeight: '800', color: colors.brandText }}>{desp.retiradoPor}</Text>
                          {desp.retiradoCedula ? ` (CI: ${desp.retiradoCedula})` : ''}
                          {desp.retiradoCargo ? ` · ${desp.retiradoCargo}` : ''}
                        </Text>
                        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                          {desp.fecha ? (
                            <Text style={{ fontSize: 11.5, color: colors.muted }}>
                              🕒 Fecha: {fmtDate(desp.fecha)}
                            </Text>
                          ) : null}
                          {desp.despachadoPor ? (
                            <Text style={{ fontSize: 11.5, color: colors.muted }}>
                              📦 Entregó: {desp.despachadoPor}
                            </Text>
                          ) : null}
                        </View>
                        {desp.maquinariaCodigo || desp.maquinariaPlaca ? (
                          <Text style={{ fontSize: 11.5, color: '#1E3A5F', fontWeight: '700' }}>
                            🚜 Destino: {desp.maquinariaCodigo || ''} · Placa: {desp.maquinariaPlaca || 'Sin placa'}
                          </Text>
                        ) : null}
                        {desp.nota ? (
                          <Text style={{ fontSize: 11.5, color: colors.text, fontStyle: 'italic', backgroundColor: colors.surface, padding: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }}>
                            "{desp.nota}"
                          </Text>
                        ) : null}
                        {canWrite ? (
                          <TouchableOpacity
                            onPress={() => abrirDespachoModal(r)}
                            style={{
                              alignSelf: 'flex-start',
                              backgroundColor: colors.surface,
                              borderWidth: 1,
                              borderColor: colors.border,
                              borderRadius: radius.sm,
                              paddingHorizontal: spacing.sm,
                              paddingVertical: 4,
                              marginTop: 2,
                            }}
                          >
                            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 11 }}>
                              ✏️ Editar Registro de Retiro
                            </Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    ) : (
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                        <Text style={{ fontSize: 11.5, color: '#166534', fontWeight: '600', flex: 1 }}>
                          El repuesto ya está físicamente en el estante de almacén listo para ser retirado.
                        </Text>
                        {canWrite ? (
                          <TouchableOpacity
                            onPress={() => abrirDespachoModal(r)}
                            style={{
                              backgroundColor: '#16A34A',
                              borderRadius: radius.sm,
                              paddingHorizontal: spacing.sm,
                              paddingVertical: 6,
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <Text style={{ fontSize: 12 }}>📦</Text>
                            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 11.5 }}>
                              Registrar Retiro / Despacho
                            </Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    )}
                  </View>
                );
              })()}

              {/* Botones de Acción para el comprador / Admin */}
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 4, flexWrap: 'wrap' }}>
                {/* Botón Expediente Completo Oficial (Falta 2) */}
                <TouchableOpacity
                  onPress={() => descargarExpediente(r)}
                  style={{
                    paddingVertical: 9,
                    paddingHorizontal: spacing.md,
                    backgroundColor: '#1E3A5F',
                    borderRadius: radius.md,
                    alignItems: 'center',
                    flexDirection: 'row',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  <Text style={{ fontSize: 13 }}>📑</Text>
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>
                    Expediente Completo
                  </Text>
                </TouchableOpacity>

                {canWrite && r.status !== 'recibido' && (
                  <TouchableOpacity
                    onPress={() => abrirEditar(r)}
                    style={{
                      paddingVertical: 9,
                      paddingHorizontal: spacing.md,
                      backgroundColor: colors.surfaceAlt,
                      borderWidth: 1.5,
                      borderColor: colors.brand,
                      borderRadius: radius.md,
                      alignItems: 'center',
                      flexDirection: 'row',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    <Text style={{ fontSize: 13 }}>✏️</Text>
                    <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 12 }}>
                      Editar
                    </Text>
                  </TouchableOpacity>
                )}

                {canWrite && (
                  <TouchableOpacity
                    onPress={() => abrirConvertir(r)}
                    style={{
                      flex: 2,
                      minWidth: 160,
                      backgroundColor: colors.brand,
                      paddingVertical: 9,
                      paddingHorizontal: spacing.sm,
                      borderRadius: radius.md,
                      alignItems: 'center',
                      flexDirection: 'row',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    <Text style={{ fontSize: 14 }}>🔄</Text>
                    <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>
                      Convertir a Requerimiento
                    </Text>
                  </TouchableOpacity>
                )}

                {canWrite && (
                  <TouchableOpacity
                    onPress={() => abrirAclaratoria(r)}
                    style={{
                      flex: 1.5,
                      minWidth: 130,
                      backgroundColor: '#FFF7ED',
                      borderWidth: 1,
                      borderColor: '#EA580C',
                      paddingVertical: 9,
                      paddingHorizontal: spacing.sm,
                      borderRadius: radius.md,
                      alignItems: 'center',
                      flexDirection: 'row',
                      justifyContent: 'center',
                      gap: 4,
                    }}
                  >
                    <Text style={{ fontSize: 13 }}>⚠️</Text>
                    <Text style={{ color: '#EA580C', fontWeight: '800', fontSize: 11.5 }}>
                      Pedir Aclaratoria
                    </Text>
                  </TouchableOpacity>
                )}

                {canWrite && r.status !== 'rechazado' && (
                  <TouchableOpacity
                    onPress={() => abrirRechazar(r)}
                    style={{
                      paddingVertical: 9,
                      paddingHorizontal: spacing.md,
                      backgroundColor: colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: colors.danger,
                      borderRadius: radius.md,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>
                      ✕ Rechazar
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </Card>
          );
        })
      )}

      {/* ── MODAL: CONVERTIR A REQUERIMIENTO OFICIAL ───────────────────────────── */}
      <Modal visible={Boolean(convertTarget)} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: spacing.md }}>
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              padding: spacing.lg,
              borderWidth: 1,
              borderColor: colors.border,
              maxHeight: '85%',
            }}
          >
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={{ fontSize: 17, fontWeight: '900', color: colors.text, marginBottom: 2 }}>
                🔄 Convertir en Requerimiento Oficial
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.md }}>
                Asigna proveedor cotizado, precio y empresa pagadora para oficializar el requerimiento{' '}
                <Text style={{ fontWeight: '800', color: colors.text }}>{convertTarget?.code}</Text>.
              </Text>

              {/* Proveedor cotizado General con Buscador */}
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>
                Proveedor General Sugerido / Cotizado:
              </Text>
              <TouchableOpacity
                onPress={() => setConvertSupOpen((v) => !v)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderWidth: 1,
                  borderColor: convertSupplierId ? colors.brand : colors.border,
                  backgroundColor: colors.surfaceAlt,
                  borderRadius: radius.md,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                  marginBottom: spacing.xs,
                }}
              >
                <Text style={{ color: convertSupplierId ? colors.text : colors.muted, fontWeight: '700', fontSize: 12.5 }} numberOfLines={1}>
                  {convertSupplierId ? (suppliers.find((s) => s.id === convertSupplierId)?.name ?? '—') : 'Por cotizar (Sin proveedor general)'}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{convertSupOpen ? '▲' : '▼'}</Text>
              </TouchableOpacity>

              {convertSupOpen ? (
                <View style={{ marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface }}>
                  <TextInput
                    value={convertSupQ}
                    onChangeText={setConvertSupQ}
                    placeholder="🔍 Buscar proveedor por nombre o RIF…"
                    placeholderTextColor={colors.muted}
                    style={[inp, { margin: 6, fontSize: 12 }]}
                  />
                  <View style={{ maxHeight: 180 }}>
                    <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                      <TouchableOpacity
                        onPress={() => { setConvertSupplierId(null); setConvertSupOpen(false); setConvertSupQ(''); }}
                        style={{
                          paddingVertical: 8,
                          paddingHorizontal: spacing.md,
                          borderBottomWidth: 1,
                          borderBottomColor: colors.border,
                          backgroundColor: !convertSupplierId ? colors.brand : 'transparent',
                        }}
                      >
                        <Text style={{ color: !convertSupplierId ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>
                          Por cotizar (Sin proveedor general)
                        </Text>
                      </TouchableOpacity>
                      {suppliers
                        .filter((s) => !convertSupQ.trim() || norm(s.name).includes(norm(convertSupQ)) || (s.rif && norm(s.rif).includes(norm(convertSupQ))))
                        .map((s) => {
                          const on = convertSupplierId === s.id;
                          return (
                            <TouchableOpacity
                              key={s.id}
                              onPress={() => { setConvertSupplierId(s.id); setConvertSupOpen(false); setConvertSupQ(''); }}
                              style={{
                                paddingVertical: 8,
                                paddingHorizontal: spacing.md,
                                borderBottomWidth: 1,
                                borderBottomColor: colors.border,
                                backgroundColor: on ? colors.brand : 'transparent',
                                flexDirection: 'row',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                              }}
                            >
                              <View style={{ flex: 1, marginRight: 6 }}>
                                <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }} numberOfLines={1}>
                                  🏭 {s.name}
                                </Text>
                                {s.rif ? <Text style={{ color: on ? colors.brandContrast : colors.muted, fontSize: 10 }}>{s.rif}</Text> : null}
                              </View>
                              {on ? <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 12 }}>✓</Text> : null}
                            </TouchableOpacity>
                          );
                        })}
                    </ScrollView>
                  </View>
                </View>
              ) : null}

              {/* Asignación individual de proveedores por renglón con CHECK y BUSCADOR (Compras consolidadas multi-proveedor) */}
              {convertTarget && convertTarget.items.length > 1 && (
                <View style={{ marginBottom: spacing.sm, padding: spacing.sm, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.text, fontSize: 12, fontWeight: '800', marginBottom: 2 }}>
                    🏢 Asignación individual de proveedor por artículo (opcional):
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 8 }}>
                    Si activas el check de un artículo, podrás buscar y asignarle un proveedor diferente al principal.
                  </Text>
                  {convertTarget.items.map((it, idx) => {
                    const currentSupId = convertItemSuppliers[idx] !== undefined ? convertItemSuppliers[idx] : convertSupplierId;
                    return (
                      <ConvertItemSupplierPicker
                        key={idx}
                        itemIndex={idx}
                        itemName={it.name}
                        itemQty={it.qty}
                        itemUnit={it.unit}
                        generalSupplierId={convertSupplierId}
                        currentSupplierId={currentSupId}
                        suppliers={suppliers}
                        onSelectSupplier={(supId) => setConvertItemSuppliers((prev) => ({ ...prev, [idx]: supId }))}
                      />
                    );
                  })}
                </View>
              )}

              {/* Empresa Pagadora */}
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>
                Empresa Pagadora (Desembolso):
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginBottom: spacing.sm, paddingVertical: 2 }}>
                <TouchableOpacity
                  onPress={() => setConvertEmpresaPagadoraId(null)}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: radius.pill,
                    backgroundColor: !convertEmpresaPagadoraId ? colors.brand : colors.surfaceAlt,
                    borderWidth: 1,
                    borderColor: !convertEmpresaPagadoraId ? colors.brand : colors.border,
                  }}
                >
                  <Text style={{ color: !convertEmpresaPagadoraId ? colors.brandContrast : colors.text, fontSize: 11, fontWeight: '700' }}>
                    Por definir
                  </Text>
                </TouchableOpacity>
                {companies.map((c) => {
                  const sel = convertEmpresaPagadoraId === c.id;
                  return (
                    <TouchableOpacity
                      key={c.id}
                      onPress={() => setConvertEmpresaPagadoraId(c.id)}
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                        borderRadius: radius.pill,
                        backgroundColor: sel ? colors.brand : colors.surfaceAlt,
                        borderWidth: 1,
                        borderColor: sel ? colors.brand : colors.border,
                      }}
                    >
                      <Text style={{ color: sel ? colors.brandContrast : colors.text, fontSize: 11, fontWeight: '700' }}>
                        🏢 {c.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Precio estimado / cotizado */}
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
                <View style={{ flex: 2 }}>
                  <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>Precio Unitario Estimado:</Text>
                  <TextInput
                    value={convertPrice}
                    onChangeText={(t) => setConvertPrice(onlyDecimal(t))}
                    placeholder="0.00"
                    placeholderTextColor={colors.muted}
                    keyboardType="numeric"
                    style={inp}
                  />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>Moneda:</Text>
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    {(['USD', 'VES'] as const).map((curr) => {
                      const sel = convertCurrency === curr;
                      return (
                        <TouchableOpacity
                          key={curr}
                          onPress={() => setConvertCurrency(curr)}
                          style={{
                            flex: 1,
                            paddingVertical: 9,
                            borderRadius: radius.md,
                            backgroundColor: sel ? colors.brand : colors.surfaceAlt,
                            alignItems: 'center',
                            borderWidth: 1,
                            borderColor: sel ? colors.brand : colors.border,
                          }}
                        >
                          <Text style={{ color: sel ? colors.brandContrast : colors.text, fontWeight: '800', fontSize: 11 }}>
                            {curr}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </View>

              {/* Notas de compra */}
              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>
                Observaciones o notas de compra:
              </Text>
              <TextInput
                value={convertNote}
                onChangeText={setConvertNote}
                placeholder="Tiempo de entrega, condiciones de pago, etc."
                placeholderTextColor={colors.muted}
                multiline
                numberOfLines={2}
                style={[inp, { height: 60, textAlignVertical: 'top', marginBottom: spacing.md }]}
              />

              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <TouchableOpacity
                  onPress={() => setConvertTarget(null)}
                  disabled={convertBusy}
                  style={{
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: radius.md,
                    backgroundColor: colors.surfaceAlt,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={ejecutarConversion}
                  disabled={convertBusy}
                  style={{
                    flex: 2,
                    paddingVertical: 10,
                    borderRadius: radius.md,
                    backgroundColor: colors.brand,
                    alignItems: 'center',
                    opacity: convertBusy ? 0.6 : 1,
                  }}
                >
                  <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>
                    {convertBusy ? 'Convirtiendo…' : '✓ Oficializar Requerimiento'}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── MODAL: SOLICITAR ACLARATORIA TÉCNICA ───────────────────────────────── */}
      <Modal visible={Boolean(aclaratoriaTarget)} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: spacing.md }}>
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              padding: spacing.lg,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '900', color: colors.text, marginBottom: 2 }}>
              ⚠️ Solicitar Aclaratoria Técnica — {aclaratoriaTarget?.code}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.md }}>
              Indica qué medidas, paso de rosca o especificación técnica necesita el proveedor para no parar la compra.
            </Text>

            <TextInput
              value={aclaratoriaPregunta}
              onChangeText={setAclaratoriaPregunta}
              placeholder="Ej: Confirmar si el diámetro exterior es 50mm o 52mm, y enviar foto de la rosca con calibre…"
              placeholderTextColor={colors.muted}
              multiline
              numberOfLines={4}
              style={[inp, { height: 90, textAlignVertical: 'top', marginBottom: spacing.md }]}
            />

            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TouchableOpacity
                onPress={() => setAclaratoriaTarget(null)}
                disabled={aclaratoriaBusy}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: radius.md,
                  backgroundColor: colors.surfaceAlt,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={enviarAclaratoria}
                disabled={aclaratoriaBusy}
                style={{
                  flex: 1.5,
                  paddingVertical: 10,
                  borderRadius: radius.md,
                  backgroundColor: '#EA580C',
                  alignItems: 'center',
                  opacity: aclaratoriaBusy ? 0.6 : 1,
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '800' }}>
                  {aclaratoriaBusy ? 'Enviando…' : 'Enviar Aclaratoria'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── MODAL: RECHAZAR SOLICITUD ─────────────────────────────────────────── */}
      <Modal visible={Boolean(rechazoTarget)} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: spacing.md }}>
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              padding: spacing.lg,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '900', color: colors.text, marginBottom: 2 }}>
              Rechazar Solicitud {rechazoTarget?.code}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.md }}>
              Indica la razón por la que no se tramitará esta compra.
            </Text>

            <TextInput
              value={motivoRechazo}
              onChangeText={setMotivoRechazo}
              placeholder="Ej: Repuesto existente en taller B, equipo en desincorporación…"
              placeholderTextColor={colors.muted}
              multiline
              numberOfLines={3}
              style={[inp, { height: 80, textAlignVertical: 'top', marginBottom: spacing.md }]}
            />

            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TouchableOpacity
                onPress={() => setRechazoTarget(null)}
                disabled={rechazoBusy}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: radius.md,
                  backgroundColor: colors.surfaceAlt,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={confirmarRechazo}
                disabled={rechazoBusy}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: radius.md,
                  backgroundColor: colors.danger,
                  alignItems: 'center',
                  opacity: rechazoBusy ? 0.6 : 1,
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '800' }}>
                  {rechazoBusy ? 'Rechazando…' : 'Confirmar Rechazo'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── MODAL: FOTO AMPLIADA ─────────────────────────────────────────────── */}
      <Modal visible={Boolean(fotoModalUrl)} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: spacing.md }}>
          <View style={{ width: '100%', maxWidth: 500, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '800', color: colors.text, fontSize: 14 }}>📷 Muestra Técnica Adjunta</Text>
              <TouchableOpacity onPress={() => setFotoModalUrl(null)}>
                <Text style={{ color: colors.muted, fontWeight: '800', fontSize: 18 }}>✕</Text>
              </TouchableOpacity>
            </View>
            {fotoModalUrl ? (
              <Image source={{ uri: fotoModalUrl }} style={{ width: '100%', height: 350, borderRadius: radius.md, resizeMode: 'contain', backgroundColor: '#000' }} />
            ) : null}
            <TouchableOpacity
              onPress={() => setFotoModalUrl(null)}
              style={{ backgroundColor: colors.brand, paddingVertical: 10, borderRadius: radius.md, alignItems: 'center' }}
            >
              <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── MODAL: EDITAR SOLICITUD DE COMPRA ─────────────────────────────────── */}
      <Modal visible={Boolean(editTarget)} animationType="slide" onRequestClose={() => setEditTarget(null)}>
        <Screen>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: spacing.xl }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <SectionTitle>✏️ Editar Solicitud {editTarget?.code}</SectionTitle>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  Corrige los renglones, medidas técnicas, cantidades, solicitante o equipo destino.
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setEditTarget(null)}
                style={{
                  backgroundColor: colors.surfaceAlt,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Text style={{ color: colors.muted, fontWeight: '800', fontSize: 13 }}>✕ Cerrar</Text>
              </TouchableOpacity>
            </View>

            {/* TARJETA 1: DATOS GENERALES */}
            <Card style={{ marginBottom: spacing.md }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, marginBottom: spacing.sm }}>
                📌 Información General de la Solicitud
              </Text>

              {/* Título */}
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>
                Título / Descripción Principal *
              </Text>
              <TextInput
                value={editTitle}
                onChangeText={setEditTitle}
                placeholder="Ej. PEDIDO TÉCNICO: FILTROS Y CORREAS PARA PAYLOADER"
                placeholderTextColor={colors.muted}
                style={[inp, { marginBottom: spacing.sm }]}
              />

              <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>
                    👤 Solicitado por:
                  </Text>
                  <TextInput
                    value={editSolicitante}
                    onChangeText={setEditSolicitante}
                    placeholder="Ej. Osmar Zambrano"
                    placeholderTextColor={colors.muted}
                    style={inp}
                  />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>
                    📍 Área operativa:
                  </Text>
                  <TextInput
                    value={editArea}
                    onChangeText={setEditArea}
                    placeholder="Ej. Taller, Cantera, Mina..."
                    placeholderTextColor={colors.muted}
                    style={inp}
                  />
                </View>
              </View>

              {/* Destino Tipo */}
              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>
                Tipo de Destino / Equipo:
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.xs }}>
                {[
                  { key: 'maquinaria', label: '🚜 Maquinaria' },
                  { key: 'vehiculo', label: '🚗 Vehículo' },
                  { key: 'area', label: '📍 Área / Planta' },
                  { key: 'otro', label: '🏷️ Otro' },
                ].map((t) => {
                  const on = editDestinoTipo === t.key;
                  return (
                    <TouchableOpacity
                      key={t.key}
                      onPress={() => setEditDestinoTipo(t.key as any)}
                      style={{
                        borderRadius: radius.pill,
                        borderWidth: 1,
                        borderColor: on ? colors.brand : colors.border,
                        backgroundColor: on ? colors.brand : colors.surfaceAlt,
                        paddingHorizontal: spacing.md,
                        paddingVertical: 5,
                      }}
                    >
                      <Text style={{ color: on ? colors.brandContrast : colors.text, fontWeight: '700', fontSize: 12 }}>
                        {t.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Selector interactivo para Maquinaria con CÓDIGO y PLACA */}
              {editDestinoTipo === 'maquinaria' && (
                <View style={{ marginTop: 6, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surface }}>
                  <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4, fontWeight: '700' }}>
                    🚜 Seleccionar Maquinaria (con Código y Placa):
                  </Text>
                  <TextInput
                    value={editMachineSearch}
                    onChangeText={setEditMachineSearch}
                    placeholder="🔍 Buscar por código, tipo o placa…"
                    placeholderTextColor={colors.muted}
                    style={[inp, { fontSize: 12, paddingVertical: 6, marginBottom: 6 }]}
                  />
                  <View style={{ maxHeight: 140 }}>
                    <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                      {machines
                        .filter((m) => {
                          if (!editMachineSearch.trim()) return true;
                          const q = norm(editMachineSearch);
                          return (
                            norm(m.code).includes(q) ||
                            (m.plate && norm(m.plate).includes(q)) ||
                            (m.description && norm(m.description).includes(q)) ||
                            (m.machinery_type && norm(m.machinery_type).includes(q))
                          );
                        })
                        .map((m) => (
                          <TouchableOpacity
                            key={m.id}
                            onPress={() => {
                              setEditDestinoTexto(
                                `MAQUINARIA ${m.code} - ${m.description || m.machinery_type || ''} (PLACA: ${m.plate || 'S/P'}${m.serial ? ` · SERIAL: ${m.serial}` : ''})`
                              );
                              setEditMachineSearch('');
                            }}
                            style={{
                              paddingVertical: 6,
                              paddingHorizontal: 8,
                              borderBottomWidth: 1,
                              borderBottomColor: colors.border,
                            }}
                          >
                            <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>
                              🚜 {m.code} - {m.description || m.machinery_type || 'Maquinaria'}
                            </Text>
                            <Text style={{ color: colors.muted, fontSize: 10.5 }}>
                              Placa: <Text style={{ color: colors.brandText, fontWeight: '800' }}>{m.plate || 'Sin Placa'}</Text>
                              {m.serial ? ` · Serial: ${m.serial}` : ''}
                            </Text>
                          </TouchableOpacity>
                        ))}
                    </ScrollView>
                  </View>
                </View>
              )}

              {/* Selector interactivo para Vehículo con MARCA y PLACA */}
              {editDestinoTipo === 'vehiculo' && (
                <View style={{ marginTop: 6, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.surface }}>
                  <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4, fontWeight: '700' }}>
                    🚗 Seleccionar Vehículo (con Marca y Placa):
                  </Text>
                  <TextInput
                    value={editVehicleSearch}
                    onChangeText={setEditVehicleSearch}
                    placeholder="🔍 Buscar por placa, marca o modelo…"
                    placeholderTextColor={colors.muted}
                    style={[inp, { fontSize: 12, paddingVertical: 6, marginBottom: 6 }]}
                  />
                  <View style={{ maxHeight: 140 }}>
                    <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                      {vehicles
                        .filter((v) => {
                          if (!editVehicleSearch.trim()) return true;
                          const q = norm(editVehicleSearch);
                          return (
                            (v.plate && norm(v.plate).includes(q)) ||
                            (v.brand && norm(v.brand).includes(q)) ||
                            (v.model && norm(v.model).includes(q))
                          );
                        })
                        .map((v) => (
                          <TouchableOpacity
                            key={v.id}
                            onPress={() => {
                              setEditDestinoTexto(`VEHÍCULO ${v.brand || ''} ${v.model || ''} (PLACA: ${v.plate || 'S/P'})`);
                              setEditVehicleSearch('');
                            }}
                            style={{
                              paddingVertical: 6,
                              paddingHorizontal: 8,
                              borderBottomWidth: 1,
                              borderBottomColor: colors.border,
                            }}
                          >
                            <Text style={{ color: colors.text, fontSize: 12, fontWeight: '700' }}>
                              🚗 {v.brand || 'Vehículo'} {v.model || ''}
                            </Text>
                            <Text style={{ color: colors.muted, fontSize: 10.5 }}>
                              Placa: <Text style={{ color: colors.brandText, fontWeight: '800' }}>{v.plate || 'Sin Placa'}</Text>
                            </Text>
                          </TouchableOpacity>
                        ))}
                    </ScrollView>
                  </View>
                </View>
              )}

              {/* Campo para editar el texto final del destino */}
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: spacing.sm, marginBottom: 4 }}>
                Texto detallado del Destino / Equipo:
              </Text>
              <TextInput
                value={editDestinoTexto}
                onChangeText={setEditDestinoTexto}
                placeholder="Ej. MAQUINARIA PAYLOADER - SERIAL: XUG0050GNRKL10889 (PLACA: S/P)"
                placeholderTextColor={colors.muted}
                style={[inp, { marginBottom: spacing.sm }]}
              />

              <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>
                Nota / Justificación Adicional (opcional):
              </Text>
              <TextInput
                value={editNote}
                onChangeText={setEditNote}
                placeholder="Motivo de la solicitud, urgencia, observaciones..."
                placeholderTextColor={colors.muted}
                multiline
                numberOfLines={2}
                style={[inp, { minHeight: 50, textAlignVertical: 'top' }]}
              />
            </Card>

            {/* TARJETA 2: RENGLONES Y MEDIDAS TÉCNICAS */}
            <Card style={{ marginBottom: spacing.md }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
                <View>
                  <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }}>
                    📦 Renglones y Medidas Técnicas ({editItems.length})
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>
                    Edita el nombre, cantidades, medidas exactas o fotos de muestra.
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={agregarRenglonEdicion}
                  style={{
                    backgroundColor: colors.brand,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: radius.md,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Text style={{ color: colors.brandContrast, fontWeight: '800', fontSize: 12 }}>
                    ➕ Agregar Renglón
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={{ gap: spacing.md }}>
                {editItems.map((it, idx) => {
                  const tieneFoto = Boolean(it.image_url && it.image_url.trim());
                  const estaSubiendo = subiendoFotoKey === it.key;

                  return (
                    <View
                      key={it.key}
                      style={{
                        borderWidth: 1.5,
                        borderColor: colors.border,
                        borderRadius: radius.md,
                        backgroundColor: colors.surfaceAlt,
                        padding: spacing.sm,
                        gap: 8,
                      }}
                    >
                      {/* Cabecera del renglón */}
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <View style={{ backgroundColor: colors.brand, paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.sm }}>
                            <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 11 }}>#{idx + 1}</Text>
                          </View>
                          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13 }}>
                            Renglón #{idx + 1}
                          </Text>
                        </View>

                        {editItems.length > 1 && (
                          <TouchableOpacity
                            onPress={() => eliminarRenglonEdicion(idx)}
                            style={{
                              backgroundColor: colors.surface,
                              borderWidth: 1,
                              borderColor: colors.danger,
                              paddingHorizontal: 8,
                              paddingVertical: 3,
                              borderRadius: radius.sm,
                            }}
                          >
                            <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 11 }}>
                              🗑️ Eliminar
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>

                      {/* Nombre del repuesto / material */}
                      <View>
                        <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>
                          Nombre del Repuesto / Material *
                        </Text>
                        <TextInput
                          value={it.name}
                          onChangeText={(v) => actualizarItemEdicion(idx, 'name', v)}
                          placeholder="Ej. PROTECTOR DE TRIPA, FILTRO DE AIRE..."
                          placeholderTextColor={colors.muted}
                          style={[inp, { backgroundColor: colors.surface, fontWeight: '700' }]}
                        />
                      </View>

                      {/* Cantidad y Unidad */}
                      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                        <View style={{ flex: 1.2 }}>
                          <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>
                            Cantidad *
                          </Text>
                          <TextInput
                            value={it.qty}
                            onChangeText={(v) => actualizarItemEdicion(idx, 'qty', onlyDecimal(v))}
                            placeholder="1"
                            keyboardType="numeric"
                            placeholderTextColor={colors.muted}
                            style={[inp, { backgroundColor: colors.surface, fontWeight: '700' }]}
                          />
                        </View>

                        <View style={{ flex: 1.2 }}>
                          <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>
                            Unidad
                          </Text>
                          <TextInput
                            value={it.unit}
                            onChangeText={(v) => actualizarItemEdicion(idx, 'unit', v.toUpperCase())}
                            placeholder="UND"
                            placeholderTextColor={colors.muted}
                            autoCapitalize="characters"
                            style={[inp, { backgroundColor: colors.surface }]}
                          />
                        </View>
                      </View>

                      {/* Chips rápidos de unidad */}
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                        {['UND', 'JUEGO', 'MTS', 'LTS', 'KG', 'PZA', 'PAQ'].map((u) => (
                          <TouchableOpacity
                            key={u}
                            onPress={() => actualizarItemEdicion(idx, 'unit', u)}
                            style={{
                              backgroundColor: it.unit === u ? colors.brand : colors.surface,
                              borderWidth: 1,
                              borderColor: it.unit === u ? colors.brand : colors.border,
                              borderRadius: radius.pill,
                              paddingHorizontal: 7,
                              paddingVertical: 2,
                            }}
                          >
                            <Text style={{ color: it.unit === u ? colors.brandContrast : colors.text, fontSize: 10, fontWeight: '700' }}>
                              {u}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>

                      {/* Medidas Técnicas / Especificaciones Obligatorias */}
                      <View
                        style={{
                          backgroundColor: isDark ? '#0F172A' : '#EFF6FF',
                          borderWidth: 1.5,
                          borderColor: '#3B82F6',
                          borderRadius: radius.sm,
                          padding: 8,
                          gap: 4,
                        }}
                      >
                        <Text style={{ color: '#1D4ED8', fontSize: 11, fontWeight: '800' }}>
                          📐 Especificaciones y Medidas Técnicas:
                        </Text>
                        <TextInput
                          value={it.note}
                          onChangeText={(v) => actualizarItemEdicion(idx, 'note', v)}
                          placeholder="Ej. Medidas 23.5-25, paso fino, calibre 1/2 pulgada, serial de parte..."
                          placeholderTextColor={colors.muted}
                          multiline
                          numberOfLines={2}
                          style={{
                            backgroundColor: colors.surface,
                            color: colors.text,
                            borderWidth: 1,
                            borderColor: colors.border,
                            borderRadius: radius.sm,
                            padding: 6,
                            fontSize: 12,
                            minHeight: 46,
                            textAlignVertical: 'top',
                          }}
                        />
                      </View>

                      {/* Foto / Muestra Técnica */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {tieneFoto ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <Image
                              source={{ uri: it.image_url }}
                              style={{ width: 50, height: 50, borderRadius: radius.sm, backgroundColor: '#000' }}
                            />
                            <TouchableOpacity
                              onPress={() => setFotoModalUrl(it.image_url)}
                              style={{
                                backgroundColor: colors.surface,
                                borderWidth: 1,
                                borderColor: colors.border,
                                paddingHorizontal: 8,
                                paddingVertical: 4,
                                borderRadius: radius.sm,
                              }}
                            >
                              <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '700' }}>
                                🔍 Ver Ampliada
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => actualizarItemEdicion(idx, 'image_url', '')}
                              style={{
                                backgroundColor: colors.surface,
                                borderWidth: 1,
                                borderColor: colors.danger,
                                paddingHorizontal: 8,
                                paddingVertical: 4,
                                borderRadius: radius.sm,
                              }}
                            >
                              <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700' }}>
                                ✕ Quitar
                              </Text>
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <TouchableOpacity
                            onPress={() => subirFotoRenglon(idx)}
                            disabled={estaSubiendo}
                            style={{
                              backgroundColor: colors.surface,
                              borderWidth: 1,
                              borderColor: colors.border,
                              paddingHorizontal: 10,
                              paddingVertical: 6,
                              borderRadius: radius.sm,
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 6,
                              opacity: estaSubiendo ? 0.6 : 1,
                            }}
                          >
                            {estaSubiendo ? (
                              <ActivityIndicator size="small" color={colors.brand} />
                            ) : (
                              <Text style={{ fontSize: 13 }}>📷</Text>
                            )}
                            <Text style={{ color: colors.text, fontSize: 11.5, fontWeight: '700' }}>
                              {estaSubiendo ? 'Subiendo imagen…' : 'Subir Foto de Muestra'}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>

              <TouchableOpacity
                onPress={agregarRenglonEdicion}
                style={{
                  marginTop: spacing.md,
                  borderWidth: 1,
                  borderColor: colors.brand,
                  borderStyle: 'dashed',
                  borderRadius: radius.md,
                  paddingVertical: 10,
                  alignItems: 'center',
                  backgroundColor: colors.surfaceAlt,
                }}
              >
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13 }}>
                  ➕ Agregar otro repuesto a la solicitud
                </Text>
              </TouchableOpacity>
            </Card>

            {/* BOTONES FINALES DE GUARDADO */}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
              <TouchableOpacity
                onPress={() => setEditTarget(null)}
                disabled={editBusy}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: radius.md,
                  backgroundColor: colors.surfaceAlt,
                  borderWidth: 1,
                  borderColor: colors.border,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>
                  Cancelar
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={guardarEdicion}
                disabled={editBusy}
                style={{
                  flex: 2,
                  paddingVertical: 12,
                  borderRadius: radius.md,
                  backgroundColor: colors.brand,
                  alignItems: 'center',
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: 8,
                  opacity: editBusy ? 0.6 : 1,
                }}
              >
                {editBusy ? (
                  <ActivityIndicator size="small" color={colors.brandContrast} />
                ) : (
                  <Text style={{ fontSize: 15 }}>💾</Text>
                )}
                <Text style={{ color: colors.brandContrast, fontWeight: '900', fontSize: 14 }}>
                  {editBusy ? 'Guardando cambios…' : 'Guardar Cambios'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Screen>
      </Modal>

      {/* ── Modal: Carga de Factura Fiscal / Comercial ── */}
      <Modal visible={facturaModalOpen} animationType="slide" onRequestClose={() => setFacturaModalOpen(false)}>
        <Screen>
          <ScrollView keyboardShouldPersistTaps="handled">
            <SectionTitle>🧾 Carga de Factura de Compra</SectionTitle>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
              Requerimiento {facturaTarget?.code ?? ''}: Asigna la empresa fiscal/comercial emisora e ingresa los datos de control para trazabilidad en Cuentas por Pagar.
            </Text>

            <Card>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 13, marginBottom: 4 }}>
                Empresa Pagadora / Emisora de la Factura:
              </Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
                {(['Inversiones Las Ilusiones', 'Golden Touch'] as const).map((emp) => {
                  const sel = facturaEmpresa === emp;
                  return (
                    <TouchableOpacity
                      key={emp}
                      onPress={() => setFacturaEmpresa(emp)}
                      style={{
                        flex: 1,
                        paddingVertical: spacing.sm,
                        paddingHorizontal: spacing.xs,
                        borderRadius: radius.md,
                        borderWidth: 1.5,
                        borderColor: sel ? (emp === 'Golden Touch' ? '#F59E0B' : '#6366F1') : colors.border,
                        backgroundColor: sel ? (emp === 'Golden Touch' ? '#FEF3C7' : '#EEF2FF') : colors.surfaceAlt,
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ color: sel ? (emp === 'Golden Touch' ? '#92400E' : '#3730A3') : colors.text, fontWeight: '800', fontSize: 12 }}>
                        {emp === 'Golden Touch' ? '✨ Golden Touch' : '🏢 Las Ilusiones'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>N° de Factura / Control</Text>
              <TextInput
                value={facturaNumero}
                onChangeText={setFacturaNumero}
                placeholder="Ej. FACT-00892 o 0001248"
                placeholderTextColor={colors.muted}
                style={[inp, { marginBottom: spacing.sm }]}
              />

              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Fecha de Emisión (AAAA-MM-DD)</Text>
              <TextInput
                value={facturaFecha}
                onChangeText={setFacturaFecha}
                placeholder="2026-10-26"
                placeholderTextColor={colors.muted}
                style={[inp, { marginBottom: spacing.sm }]}
              />

              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 4 }}>Documento Adjunto (PDF o Imagen de la Factura)</Text>
              {facturaUrl ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surfaceAlt, padding: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm }}>
                  <Text style={{ fontSize: 22 }}>{facturaTipo === 'pdf' ? '📄' : '🖼️'}</Text>
                  <Text style={{ flex: 1, fontSize: 12, color: colors.text }} numberOfLines={1}>
                    {facturaNombre || 'Factura adjunta'}
                  </Text>
                  <TouchableOpacity
                    onPress={() => abrirVisorFactura(facturaUrl, facturaTipo, facturaNombre)}
                    style={{ backgroundColor: colors.surface, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }}
                  >
                    <Text style={{ color: colors.brandText, fontSize: 11, fontWeight: '700' }}>Ver</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => { setFacturaUrl(null); setFacturaNombre(null); }}>
                    <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 11 }}>Quitar</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm }}>
                  <TouchableOpacity
                    onPress={tomarFotoFactura}
                    disabled={subiendoFactura}
                    style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.brand, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', opacity: subiendoFactura ? 0.6 : 1 }}
                  >
                    <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 12 }}>
                      {subiendoFactura ? '⏳ Subiendo…' : '📷 Tomar Foto'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={subirArchivoFactura}
                    disabled={subiendoFactura}
                    style={{ flex: 1, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.brand, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', opacity: subiendoFactura ? 0.6 : 1 }}
                  >
                    <Text style={{ color: colors.brandText, fontWeight: '700', fontSize: 12 }}>
                      {subiendoFactura ? '⏳ Subiendo…' : '📎 Subir Archivo/PDF'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </Card>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.xl }}>
              <TouchableOpacity
                onPress={() => setFacturaModalOpen(false)}
                style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={guardarFacturaModal}
                disabled={guardandoFactura}
                style={{ flex: 2, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: guardandoFactura ? 0.6 : 1 }}
              >
                <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>
                  {guardandoFactura ? 'Guardando…' : '💾 Guardar Factura'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Screen>
      </Modal>

      {/* ── Modal: Visor de Factura Adjunta ── */}
      <Modal visible={facturaViewerOpen} animationType="fade" transparent onRequestClose={() => setFacturaViewerOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: spacing.md }}>
          <View style={{ backgroundColor: colors.background, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, maxHeight: '90%', overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14, flex: 1 }} numberOfLines={1}>
                🧾 {facturaViewerNombre || 'Factura'}
              </Text>
              <TouchableOpacity onPress={() => setFacturaViewerOpen(false)} style={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}>
                <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 16 }}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ padding: spacing.md }}>
              {facturaViewerUrl ? (
                facturaViewerTipo === 'pdf' ? (
                  Platform.OS === 'web'
                    ? React.createElement('iframe', { src: facturaViewerUrl, style: { width: '100%', height: '65vh', border: 'none', borderRadius: 8 } })
                    : <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center', marginVertical: 20 }}>Toca "⬇️ Descargar / Abrir" para ver el PDF.</Text>
                ) : (
                  <Image source={{ uri: facturaViewerUrl }} style={{ width: '100%', height: 420, borderRadius: radius.md }} resizeMode="contain" />
                )
              ) : null}
            </ScrollView>
            <View style={{ padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: 'row', gap: spacing.sm }}>
              <TouchableOpacity
                onPress={() => setFacturaViewerOpen(false)}
                style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cerrar</Text>
              </TouchableOpacity>
              {facturaViewerUrl ? (
                <TouchableOpacity
                  onPress={() => {
                    if (Platform.OS === 'web') {
                      window.open(facturaViewerUrl, '_blank');
                    } else {
                      Linking.openURL(facturaViewerUrl);
                    }
                  }}
                  style={{ flex: 2, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' }}
                >
                  <Text style={{ color: colors.brandContrast, fontWeight: '800' }}>⬇️ Abrir / Descargar</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Modal: Control Físico de Retiro en Almacén (Falta 3) ── */}
      <Modal visible={despachoModalOpen} animationType="slide" onRequestClose={() => setDespachoModalOpen(false)}>
        <Screen>
          <ScrollView keyboardShouldPersistTaps="handled">
            <SectionTitle>📦 Retiro / Despacho Físico de Almacén</SectionTitle>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: spacing.sm }}>
              Requerimiento {despachoTarget?.code ?? ''}: Registra a qué mecánico o chofer se le entregó el material y para cuál maquinaria o vehículo (código y placa).
            </Text>

            {/* Persona que retira */}
            <Card>
              <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13, marginBottom: spacing.xs }}>
                👤 Personal que Retira (Mecánico / Chofer)
              </Text>
              <TextInput
                value={empBusquedaQ}
                onChangeText={setEmpBusquedaQ}
                placeholder="🔎 Buscar en nómina (nombre, cargo, cédula)…"
                placeholderTextColor={colors.muted}
                style={[inp, { marginBottom: 6, fontSize: 12 }]}
              />
              {empBusquedaQ.trim().length > 0 ? (
                <View style={{ maxHeight: 150, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, marginBottom: 8, overflow: 'hidden' }}>
                  <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                    {employees
                      .map((e) => ({
                        e,
                        fullName: [e.first_name, e.last_name].filter(Boolean).join(' ') || 'Sin Nombre',
                      }))
                      .filter(({ e, fullName }) => {
                        const q = norm(empBusquedaQ);
                        return norm(fullName).includes(q) || (e.cedula && norm(e.cedula).includes(q)) || (e.cargo && norm(e.cargo).includes(q));
                      })
                      .map(({ e, fullName }) => (
                        <TouchableOpacity
                          key={e.id}
                          onPress={() => {
                            setRetiradoPor(fullName);
                            setRetiradoCedula(e.cedula || '');
                            setRetiradoCargo(e.cargo || '');
                            setRetiradoEmployeeId(e.id);
                            setEmpBusquedaQ('');
                          }}
                          style={{ padding: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}
                        >
                          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>{fullName}</Text>
                          <Text style={{ color: colors.muted, fontSize: 11 }}>
                            {e.cedula ? `CI: ${e.cedula} · ` : ''}{e.cargo || 'Personal'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                  </ScrollView>
                </View>
              ) : null}

              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Nombre Completo de quien retira</Text>
              <TextInput
                value={retiradoPor}
                onChangeText={setRetiradoPor}
                placeholder="Nombre y Apellido"
                placeholderTextColor={colors.muted}
                style={[inp, { marginBottom: 6 }]}
              />

              <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: 6 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Cédula</Text>
                  <TextInput
                    value={retiradoCedula}
                    onChangeText={setRetiradoCedula}
                    placeholder="V-12345678"
                    placeholderTextColor={colors.muted}
                    style={inp}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Cargo / Rol</Text>
                  <TextInput
                    value={retiradoCargo}
                    onChangeText={setRetiradoCargo}
                    placeholder="Ej. Mecánico, Chofer"
                    placeholderTextColor={colors.muted}
                    style={inp}
                  />
                </View>
              </View>
            </Card>

            {/* Maquinaria o Vehículo de Destino (con PLACA y Buscador) */}
            <Card>
              <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13, marginBottom: spacing.xs }}>
                🚜 Maquinaria o Vehículo de Destino
              </Text>
              <Text style={{ color: colors.muted, fontSize: 11.5, marginBottom: 6 }}>
                Identifica la unidad que recibirá el repuesto mostrando siempre Código y Placa.
              </Text>

              {despachoMaquinariaId ? (() => {
                const selMaq = machines.find((m) => m.id === despachoMaquinariaId);
                return (
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#3B82F6', borderRadius: radius.md, padding: 8, marginBottom: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: '#1E3A8A', fontWeight: '800', fontSize: 12.5 }}>
                        🚜 {selMaq ? machineLabel(selMaq) : 'Maquinaria seleccionada'}
                      </Text>
                      <Text style={{ color: '#2563EB', fontSize: 11 }}>
                        Placa: {selMaq?.plate || 'Sin placa'}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => setDespachoMaquinariaId(null)}>
                      <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 12 }}>Cambiar</Text>
                    </TouchableOpacity>
                  </View>
                );
              })() : null}

              <TextInput
                value={maqBusquedaQ}
                onChangeText={setMaqBusquedaQ}
                placeholder="🔎 Buscar maquinaria por código, placa, serial…"
                placeholderTextColor={colors.muted}
                style={[inp, { marginBottom: 6, fontSize: 12 }]}
              />
              <View style={{ maxHeight: 180, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, overflow: 'hidden' }}>
                <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                  {machines
                    .filter((m) => machineMatches(m, maqBusquedaQ))
                    .map((m) => {
                      const isSel = m.id === despachoMaquinariaId;
                      return (
                        <TouchableOpacity
                          key={m.id}
                          onPress={() => {
                            setDespachoMaquinariaId(m.id);
                            setMaqBusquedaQ('');
                          }}
                          style={{
                            padding: 8,
                            borderBottomWidth: 1,
                            borderBottomColor: colors.border,
                            backgroundColor: isSel ? '#DBEAFE' : 'transparent',
                            flexDirection: 'row',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 12 }}>
                              {machineLabel(m)}
                            </Text>
                            <Text style={{ color: colors.muted, fontSize: 11 }}>
                              Placa: <Text style={{ fontWeight: '700', color: colors.brandText }}>{m.plate || 'Sin placa'}</Text>{m.serial ? ` · Serial: ${m.serial}` : ''}
                            </Text>
                          </View>
                          {isSel ? <Text style={{ color: '#2563EB', fontWeight: '900', fontSize: 14 }}>✓</Text> : null}
                        </TouchableOpacity>
                      );
                    })}
                </ScrollView>
              </View>
            </Card>

            {/* Detalles de Almacén */}
            <Card>
              <Text style={{ color: colors.brandText, fontWeight: '800', fontSize: 13, marginBottom: spacing.xs }}>
                📋 Trazabilidad de Entrega
              </Text>

              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Almacenista que Despacha</Text>
              <TextInput
                value={despachadoPor}
                onChangeText={setDespachadoPor}
                placeholder="Nombre del almacenista"
                placeholderTextColor={colors.muted}
                style={[inp, { marginBottom: 6 }]}
              />

              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Fecha / Hora de Retiro</Text>
              <TextInput
                value={despachoFecha}
                onChangeText={setDespachoFecha}
                placeholder="2026-10-26T14:30:00Z"
                placeholderTextColor={colors.muted}
                style={[inp, { marginBottom: 6 }]}
              />

              <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>Observaciones / Notas de Entrega</Text>
              <TextInput
                value={despachoNota}
                onChangeText={setDespachoNota}
                placeholder="Ej. Entregado en galpón principal, verificado con mecánico..."
                placeholderTextColor={colors.muted}
                multiline
                style={[inp, { minHeight: 60, textAlignVertical: 'top' }]}
              />
            </Card>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.xl }}>
              <TouchableOpacity
                onPress={() => setDespachoModalOpen(false)}
                style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' }}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={guardarDespachoModal}
                disabled={guardandoDespacho}
                style={{ flex: 2, backgroundColor: '#16A34A', borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', opacity: guardandoDespacho ? 0.6 : 1 }}
              >
                <Text style={{ color: '#fff', fontWeight: '800' }}>
                  {guardandoDespacho ? 'Guardando…' : '📦 Confirmar Despacho Físico'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Screen>
      </Modal>
    </Screen>
  );
}
